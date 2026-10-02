import {esc,button,field,input,select,submit,sheet,toast} from './ui.js';
import {uid} from './engine.js';

const KEY='qingke.updates.v1',DEFAULT_PROXY='https://ghfast.top/';
const FORMATS=[['default','默认代理 · GHFast'],['direct','直接连接 GitHub'],['custom','自定义 HTTPS 代理']];
const labels={idle:'检查是否有新版本',checking:'正在检查更新…',available:'发现新版本',latest:'当前已是最新版本',downloading:'正在下载安装包…',progress:'正在下载安装包…',downloaded:'下载已校验，可以安装',verifying:'正在核验安装包…',installing:'请在系统安装界面确认',cancelled:'更新已取消',permission:'需要允许安装应用',error:'本次更新未完成'};
function settings(){
  const raw=JSON.parse(localStorage.getItem(KEY)||'{}');
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.mode&&!FORMATS.some(([v])=>v===raw.mode))throw Error('更新设置无法读取，请重新保存代理设置');
  return {mode:raw.mode||'default',customProxy:typeof raw.customProxy==='string'?raw.customProxy:''};
}
export function updateProxy(config){
  if(config.mode==='direct')return '';
  if(config.mode==='default')return DEFAULT_PROXY;
  let url;try{url=new URL(config.customProxy.trim());}catch{throw Error('请输入有效的 HTTPS 代理根地址');}
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||/[?#]/.test(config.customProxy)||config.customProxy.length>500)throw Error('代理只填写 HTTPS 根地址，不带路径、参数或账号密码');
  return url.origin+'/';
}
const size=value=>Number.isFinite(Number(value))?`${(Number(value)/1048576).toFixed(1)} MB`:'大小待确认';

export function createUpdateUI({onMessage}={}){
  let state={phase:'idle',busy:false,currentVersion:'3.2.0',ready:false},configError='';
  const supported=()=>!!window.Android?.checkForUpdate;
  const notify=message=>(onMessage||toast)(message);
  function refresh(){if(window.Android?.getUpdateStatus)try{state={...state,...JSON.parse(Android.getUpdateStatus())};}catch{state={...state,phase:'error',message:'无法读取更新状态，请重新打开应用'};}}
  function statusMarkup(){
    const m=state.manifest,phase=state.phase||'idle',progress=m?.size?Math.min(100,Math.max(0,Number(state.downloadedBytes||0)/m.size*100)):0;
    if(!supported())return '<p class="helper-box">应用内更新需要 Android 安装版。网页预览可以保存代理设置。</p>';
    return `<div class="share-summary"><strong>${esc(labels[phase]||'应用更新')}</strong>${state.message?`<p>${esc(state.message)}</p>`:''}${m?`<p>清课 ${esc(m.versionName)} · ${size(m.size)}</p>${m.notes?`<p style="white-space:pre-wrap">${esc(m.notes)}</p>`:''}`:''}${state.busy&&phase==='downloading'?`<progress max="100" value="${progress}" style="width:100%" aria-label="下载进度"></progress><p>${size(state.downloadedBytes)} / ${size(m?.size)}</p>`:''}</div><div class="sheet-actions">${state.busy?button('update-cancel','取消本次操作','secondary'):button('update-check','重新检查','secondary')}${!state.busy&&state.ready?button('update-install',state.canInstallUnknown?'安装更新':'允许安装并继续','primary'):!state.busy&&m&&m.versionCode>Number(state.currentVersionCode||0)?button('update-download','下载更新','primary'):''}</div>${state.ready?'<p class="source-note">系统仍会要求你确认安装；课表和设置通过覆盖安装保留。</p>':''}`;
  }
  function updateVisible(){const node=document.querySelector('#app-update-status');if(node)node.innerHTML=statusMarkup();}
  function open(){
    refresh();let config;try{config=settings();configError='';}catch(e){config={mode:'default',customProxy:''};configError=e.message;}
    sheet('应用更新',`<p class="sheet-subtitle">当前版本 ${esc(state.currentVersion||'3.2.0')} · 官方来源 SAGIRIxr/qingke</p><div id="app-update-status" aria-live="polite">${statusMarkup()}</div><div class="divider">下载连接</div><form id="app-update-settings">${field('连接方式',select('mode',FORMATS,config.mode))}${field('自定义代理根地址',input('customProxy',config.customProxy,'url','maxlength="500" placeholder="https://代理域名/"'),'自定义模式使用此地址作为 GitHub 下载链接前缀。')}${configError?`<p class="helper-box warning-box">${esc(configError)}</p>`:''}<p class="source-note">默认使用第三方 GHFast 代理，可切换直连或自己的代理。更新仍来自固定项目，安装前校验文件摘要与当前应用签名。</p>${submit('保存连接方式')}</form>`);
  }
  window.onAppUpdateEvent=event=>{
    if(!event||typeof event!=='object')return;
    // Only replace the status region; proxy inputs and unrelated editing sheets stay untouched.
    state={...state,...event};updateVisible();
    if(['downloaded','error','cancelled'].includes(event.type)&&!document.querySelector('#app-update-status'))notify(event.message||labels[event.type]);
  };
  function click(action){
    if(!['app-update','update-check','update-download','update-cancel','update-install'].includes(action))return false;
    if(action==='app-update'){open();return true;}
    if(!supported()){notify('请在 Android 安装版中使用应用内更新');return true;}
    if(action==='update-check'){const proxy=updateProxy(settings());state={...state,phase:'checking',busy:true,message:''};updateVisible();Android.checkForUpdate(uid(),proxy);}
    if(action==='update-download'){state={...state,phase:'downloading',busy:true,downloadedBytes:0,message:''};updateVisible();Android.downloadUpdate(uid());}
    if(action==='update-cancel')Android.cancelUpdate();
    if(action==='update-install')Android.installUpdate();
    return true;
  }
  function submitForm(form,values){
    if(form.id!=='app-update-settings')return false;
    const next={mode:values.mode,customProxy:(values.customProxy||'').trim()};
    if(!FORMATS.some(([mode])=>mode===next.mode))throw Error('请选择连接方式');updateProxy(next);
    localStorage.setItem(KEY,JSON.stringify(next));notify('更新连接方式已保存');return true;
  }
  return {click,submit:submitForm,open};
}
