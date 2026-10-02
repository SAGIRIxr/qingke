import {shareCode,shareServer} from './share-links.js';
import {sheet,submit,toast} from './ui.js';

/** External entries stay in the native queue until an editor is closed. */
export function createShareEntry({openShare,isOwnShare=()=>false}){
  let offeredNotice=false,draining=false,scheduled=false;
  const supported=()=>!!window.Android?.consumeShareLink;
  function settings(){try{return JSON.parse(window.Android?.getShareEntrySettings?.()||'{"clipboardEnabled":true}');}catch{return {clipboardEnabled:false};}}
  function flush(){
    if(draining||document.hidden||!supported())return;
    if(document.querySelector('#modal-root')?.firstChild)return;
    draining=true;
    try{
      for(let i=0;i<8;i++){
        const raw=Android.consumeShareLink();if(!raw){offeredNotice=false;break;}
        let entry;try{const candidate=JSON.parse(raw);entry={code:shareCode(candidate.code),server:shareServer(candidate.server),source:candidate.source==='clipboard'?'clipboard':'link'};}catch{toast('分享链接内容无效，请重新复制完整消息');continue;}
        if(entry.source==='clipboard'){
          if(!settings().clipboardEnabled)continue;
          let own=false;try{own=isOwnShare(entry);}catch{toast('分享管理记录暂时无法读取，请核对本次分享来源');}
          if(own)continue;
        }
        offeredNotice=false;openShare(entry);break;
      }
    }finally{draining=false;}
  }
  function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;flush();});}
  window.onShareLinkAvailable=()=>{
    if(document.querySelector('#modal-root')?.firstChild&&!offeredNotice){toast('收到清课分享，结束当前编辑后可预览');offeredNotice=true;}
    schedule();
  };
  const root=document.querySelector('#modal-root');
  if(root&&typeof MutationObserver!=='undefined')new MutationObserver(schedule).observe(root,{childList:true});
  function click(action){
    if(action!=='share-entry-settings')return false;
    const config=settings();
    sheet('分享链接与剪贴板',`<form id="share-entry-settings-form"><label class="check-row"><input type="checkbox" name="clipboardEnabled" ${config.clipboardEnabled?'checked':''} ${supported()?'':'disabled'}><span><strong>打开 App 时识别清课分享</strong><small>只在手机本地识别清课分享链接；其他剪贴板文字不会保存或上传。同一份消息不反复提示。</small></span></label><p class="helper-box">识别后先显示口令与服务地址，点“读取并预览”才会访问该服务。正在编辑时会暂缓提示，原有课程始终保留。</p>${supported()?submit('保存设置'):'<p class="source-note">剪贴板自动识别需要 Android 安装版。系统可能显示正常的粘贴访问提示。</p>'}</form>`);return true;
  }
  function submitForm(form,values){
    if(form.id!=='share-entry-settings-form')return false;
    if(!window.Android?.setClipboardShareEnabled)throw Error('请在 Android 安装版中设置');
    Android.setClipboardShareEnabled(values.clipboardEnabled==='on');toast('分享识别设置已保存');return true;
  }
  return {click,submit:submitForm,foreground:schedule};
}
