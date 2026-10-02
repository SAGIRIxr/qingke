import {createFollowManager} from './share-follow.js';
import {uid,validateState,createState} from './engine.js';
import {esc,clone,icon,button,field,input,select,submit,sheet,closeSheet,toast} from './ui.js';

const RECORD_KEY='qingke.shares.v1';
const CODE=/^[0-9A-HJKMNP-TV-Z]{20}$/;
const pending=new Map();
let memoryRecords=[];

function endpoint(value){
  let url;try{url=new URL(value);}catch{throw Error('请先填写分享服务的 HTTPS 域名');}
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||/[?#]/.test(value)||value.length>500)throw Error('服务地址仅填写 HTTPS 域名，不带路径或账号密码');
  return url.origin;
}
function normalizeCode(value){const code=String(value||'').toUpperCase().replace(/[\s-]/g,'');if(!CODE.test(code))throw Error('请输入完整的 20 位分享口令');return code;}
const displayCode=code=>code.match(/.{1,5}/g).join('-');
function records(){
  try{const list=JSON.parse(localStorage.getItem(RECORD_KEY)||'[]');if(!Array.isArray(list))throw Error();return [...list,...memoryRecords].filter((r,i,a)=>r&&CODE.test(r.code)&&typeof r.deleteToken==='string'&&a.findIndex(x=>x.code===r.code&&x.server===r.server)===i);}
  catch{throw Error('本机分享管理记录无法读取，请先导出应用数据，不要继续创建分享');}
}
function writeRecords(list){localStorage.setItem(RECORD_KEY,JSON.stringify(list));memoryRecords=[];}

/** Only the chosen semester leaves this device; import metadata and private preferences never do. */
export function sharePayload(semester,{includeNotes=false,includeExams=false,expiresInDays=7}={}){
  const s=clone(semester);
  const note=value=>includeNotes?String(value||''):'';
  s.courses=s.courses.map(c=>({id:c.id,name:c.name,shortName:c.shortName,color:c.color,assessment:c.assessment,nature:c.nature,note:note(c.note),sessions:c.sessions.map(t=>({id:t.id,day:t.day,startPeriod:t.startPeriod,endPeriod:t.endPeriod,weeks:[...t.weeks],teacher:t.teacher,location:t.location,breakMode:t.breakMode}))}));
  s.exceptions=s.exceptions.map(e=>Object.fromEntries(['id','sessionId','sourceDate','type','date','startPeriod','endPeriod','location','teacher','note'].filter(k=>e[k]!==undefined).map(k=>[k,k==='note'?note(e[k]):e[k]])));
  s.dayRules=s.dayRules.map(r=>({id:r.id,date:r.date,type:r.type,...(r.sourceDate?{sourceDate:r.sourceDate}:{}),label:note(r.label)}));
  s.exams=includeExams?(s.exams||[]).map(e=>({id:e.id,name:e.name,date:e.date,startTime:e.startTime,endTime:e.endTime,location:e.location,note:note(e.note),...(e.courseId?{courseId:e.courseId}:{})})):[];
  const safe={id:s.id,name:s.name,startDate:s.startDate,totalWeeks:s.totalWeeks,showWeekend:s.showWeekend,profiles:s.profiles.map(p=>({id:p.id,name:p.name,effectiveFrom:p.effectiveFrom,periods:p.periods.map(t=>({start:t.start,end:t.end,group:t.group}))})),courses:s.courses,exceptions:s.exceptions,dayRules:s.dayRules,holidayLabels:s.holidayLabels.map(h=>({id:h.id,date:h.date,name:h.name})),exams:s.exams};
  return {format:'qingke-semester',version:1,semester:safe,includeNotes,includeExams,expiresInDays:Number(expiresInDays)};
}

/** Validate and replace every imported identity before adding a separate semester. */
export function importedSemester(payload){
  if(payload?.format!=='qingke-semester'||payload.version!==1||!payload.semester)throw Error('分享内容不是支持的课表格式');
  const state=createState(),raw=payload.semester;
  const s=validateState({...state,semesters:[raw],activeSemesterId:raw.id}).semesters[0];
  const courses=new Map(),sessions=new Map();
  s.id=uid();s.profiles.forEach(p=>p.id=uid());
  s.courses.forEach(c=>{const id=uid();courses.set(c.id,id);c.id=id;c.sessions.forEach(t=>{const sid=uid();sessions.set(t.id,sid);t.id=sid;delete t.importSource;});});
  s.exceptions.forEach(e=>{e.id=uid();e.sessionId=sessions.get(e.sessionId);});
  s.dayRules.forEach(r=>r.id=uid());s.holidayLabels.forEach(h=>h.id=uid());
  s.exams.forEach(e=>{e.id=uid();if(e.courseId){const id=courses.get(e.courseId);if(id)e.courseId=id;else delete e.courseId;}});
  return validateState({...state,semesters:[s],activeSemesterId:s.id}).semesters[0];
}

async function request(server,action,payload){
  server=endpoint(server);
  if(window.Android?.shareRequest){
    return new Promise((resolve,reject)=>{const requestId=uid(),timer=setTimeout(()=>{pending.delete(requestId);reject(Error('服务响应超时，请检查网络；创建分享不会自动重试'));},45000);pending.set(requestId,{resolve,reject,timer});try{Android.shareRequest(requestId,action,server,JSON.stringify(payload));}catch(e){clearTimeout(timer);pending.delete(requestId);reject(e);}});
  }
  const method={create:'POST',get:'GET',delete:'DELETE',update:'PUT'}[action];
  const path=action==='create'?'/api/shares':`/api/shares/${normalizeCode(payload.code)}`;
  const headers={Accept:'application/json'};if(action==='create'||action==='update')headers['Content-Type']='application/json';if(action==='delete'||action==='update')headers.Authorization=`Bearer ${payload.deleteToken}`;
  const response=await fetch(server+path,{method,headers,body:action==='create'||action==='update'?JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([key])=>!['code','deleteToken'].includes(key)))):undefined,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)});
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>2*1024*1024)throw Error('服务响应过大，已停止读取');
  let data;try{data=bytes.length?JSON.parse(new TextDecoder().decode(bytes)):{};}catch{throw Error('服务返回了无法识别的内容');}
  if(!response.ok)throw Object.assign(Error(data.error?.message||`请求失败（${response.status}）`),{status:response.status});return data;
}
if(typeof window!=='undefined')window.onShareResult=result=>{const p=pending.get(result?.requestId);if(!p)return;pending.delete(result.requestId);clearTimeout(p.timer);if(result.ok)p.resolve(result.data||{});else p.reject(Object.assign(Error(result.message||result.data?.error?.message||'分享请求失败'),{status:result.status}));};

export function createShareUI(ctx){
  let createDraft=null,receiveDraft=null,deleteDraft=null,busy=false;
  const currentView=()=>document.querySelector('#modal-root')?.firstChild??null;
  const state=()=>ctx.getState();
  const server=()=>state().preferences.shareServerUrl||'https://qk.sagiri.org';
  const follow=createFollowManager(ctx,{request,sharePayload,records,writeRecords,showOwners:manage});
  function home(){
    sheet('口令分享课表',`<p class="sheet-subtitle">分享一个学期，对方输入口令后预览并导入。分享会上传你确认的课表内容。</p><form id="share-server-form">${field('分享服务地址',input('server',server(),'url','required maxlength="500" placeholder="https://课表分享域名"'),'填写部署好的 HTTPS 域名。')}<button type="submit" class="secondary full-width">保存服务地址</button><div class="error-message" id="form-error" role="alert"></div></form><div class="sheet-actions">${button('share-create',`${icon('upload',17)} 分享我的课表`,'primary')}${button('share-receive',`${icon('download',17)} 输入口令导入`)}</div>${button('follow-list','我跟随的课表与同步状态','secondary full-width','style="margin-top:16px"')}${button('share-manage','管理我创建的分享','text-button full-width','style="margin-top:16px"')}<p class="source-note" style="margin-top:14px">持有口令的人可读取这份课表，请只发给需要的人。可设置到期时间或主动撤销。只有双方选择持续更新与跟随时，之后的修改才会同步。</p>`);
  }
  function createForm(){
    endpoint(server());
    sheet('选择分享内容',`<form id="share-create-form">${field('选择学期',select('semesterId',state().semesters.map(s=>[s.id,s.name]),state().activeSemesterId))}<label class="check-row"><input type="checkbox" name="allowFollow"><span><strong>允许朋友持续跟随更新</strong><small>我修改课表后，前台联网时自动发布；对方自行选择跟随。</small></span></label>${field('有效期',select('expiresInDays',[[1,'1 天'],[7,'7 天'],[30,'30 天']],7))}<label class="check-row"><input type="checkbox" name="includeNotes"><span><strong>包含备注和调课说明</strong><small>默认不分享私人笔记</small></span></label><label class="check-row"><input type="checkbox" name="includeExams"><span><strong>包含考试安排</strong><small>可能包含个人考场与座位信息</small></span></label><p class="helper-box">包含课程、教师、教室、作息和教学调整。不包含教务网址、登录信息、通知偏好或导入来源。</p>${submit('预览将要分享的内容')}</form>`);
  }
  function createPreview(){
    const s=createDraft.payload.semester;
    sheet('确认分享',`<p class="sheet-subtitle">以下内容将上传到 ${esc(new URL(createDraft.server).hostname)}，并在 ${createDraft.payload.expiresInDays} 天后失效。</p><div class="share-summary"><strong>${esc(s.name)}</strong><p>${s.startDate} 开始 · ${s.totalWeeks} 周</p><p>${s.courses.length} 门课程 · ${s.courses.reduce((n,c)=>n+c.sessions.length,0)} 条安排 · ${s.exams.length} 场考试</p><p>${s.profiles.length} 套作息 · ${s.dayRules.length+s.exceptions.length} 条教学调整</p><p>${createDraft.payload.allowFollow?'持续分享：允许对方选择跟随变化':'单次分享：保存当前课表副本'}</p></div><div class="share-course-preview">${s.courses.map(c=>`<p><strong>${esc(c.name)}</strong><small>${c.sessions.map(t=>esc([t.teacher,t.location].filter(Boolean).join(' · '))).join('<br>')}</small></p>`).join('')}</div><p class="source-note">备注${createDraft.payload.includeNotes?'包含':'不包含'}，考试${createDraft.payload.includeExams?'包含':'不包含'}。</p><div class="sheet-actions">${button('share-create','返回修改')}${button('share-publish','上传并生成口令','primary')}</div>`);
  }
  function showCode(record,message=''){
    sheet('分享口令已生成',`<div class="share-summary"><strong>${esc(record.name)}</strong><p>有效至 ${esc(new Date(record.expiresAt).toLocaleString('zh-CN'))}</p></div><label class="field"><span>长按可选择复制口令</span><input readonly class="share-code" value="${displayCode(record.code)}" aria-label="分享口令"></label>${button('share-copy','复制口令','primary full-width',`data-code="${record.code}"`)}${message?`<p class="helper-box warning-box">${esc(message)}</p>`:''}<p class="helper-box">让对方在“口令分享课表”中使用同一服务地址，再输入口令。口令和服务地址一起发送即可。</p><p class="source-note">${esc(record.server)}<br>管理凭证只留在本机，清除应用数据前请先撤销不需要的分享。</p><div class="sheet-actions">${button('share-manage','管理分享')}${button('share-home','完成')}</div>`);
  }
  function receiveForm(){endpoint(server());sheet('导入分享课表',`<form id="share-receive-form">${field('分享口令',input('code','','text','required maxlength="80" autocomplete="off" autocapitalize="characters" placeholder="XXXXX-XXXXX-XXXXX-XXXXX"'))}<p class="sheet-subtitle">会先读取预览。确认后保存为一个新学期，现有课程继续保留。</p>${submit('读取并预览')}</form>`);}
  function receivePreview(){
    const s=receiveDraft.semester;
    sheet('预览分享课表',`<form id="share-import-form">${field('新学期名称',input('name',s.name,'text','required maxlength="80"'))}<div class="share-summary"><p>${s.startDate} 开始 · ${s.totalWeeks} 周</p><p>${s.courses.length} 门课程 · ${s.exams.length} 场考试 · ${s.profiles.length} 套作息</p></div><div class="share-course-preview">${s.courses.map(c=>`<p><strong>${esc(c.name)}</strong><small>${c.sessions.map(t=>esc(t.location||'地点待定')).join(' / ')}</small></p>`).join('')}</div><p class="helper-box">导入后保存为独立学期。请核对学校校历和作息，原有学期不会被覆盖。</p>${receiveDraft.allowFollow?'<label class="check-row"><input type="checkbox" name="follow"><span><strong>跟随分享者的后续更新</strong><small>打开 App 或回到前台时检查，保留我自己的修改，有冲突先核对。</small></span></label>':'<p class="source-note">分享者未开启持续更新，将导入当前副本。</p>'}${submit('导入为新学期')}</form>`);
  }
  function manage(){
    const list=records().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    sheet('我创建的分享',`<p class="sheet-subtitle">持续分享会在前台联网时发布修改；朋友需自行选择跟随。撤销口令不会远程删除已导入的本地副本。</p>${list.map(r=>`<div class="change-row" style="display:block"><strong>${esc(r.name)}</strong><small>${displayCode(r.code)} · 版本 ${r.revision||1}<br>${new Date(r.expiresAt).getTime()<=Date.now()?'已到期':`有效至 ${esc(new Date(r.expiresAt).toLocaleDateString('zh-CN'))}`}<br>${esc(new URL(r.server).hostname)}</small><p class="follow-status">${r.allowFollow?'允许持续跟随':'单次课表副本'}${r.error?`<br>${esc(r.error)}`:''}</p><div class="follow-actions">${r.localSemesterId?`${button('owner-publish-now','发布最新修改','secondary',`data-code="${r.code}" data-server="${esc(r.server)}"`)}${button('owner-toggle-follow',r.allowFollow?'关闭持续跟随':'开启持续跟随','secondary',`data-code="${r.code}" data-server="${esc(r.server)}"`)}`:''}${button('share-revoke','撤销分享','text-button',`data-code="${r.code}" data-server="${esc(r.server)}"`)}</div></div>`).join('')||'<p class="helper-box">还没有在这台设备上创建过分享。</p>'}${button('share-home','返回','secondary full-width','style="margin-top:18px"')}`);
  }
  async function click(action,el){
    if(await follow.click(action,el))return true;
    if(!['share-home','share-create','share-receive','share-manage','share-publish','share-copy','share-revoke','share-revoke-confirm'].includes(action))return false;
    if(busy){toast('正在处理分享请求，请稍候');return true;}
    if(action==='share-home')home();
    if(action==='share-create')createForm();
    if(action==='share-receive')receiveForm();
    if(action==='share-manage')manage();
    if(action==='share-copy'){
      const record=records().find(r=>r.code===el.dataset.code),text=record?`清课课表口令：${displayCode(record.code)}\n服务地址：${record.server}`:displayCode(el.dataset.code);
      try{await navigator.clipboard.writeText(text);toast('口令和服务地址已复制');}catch{const field=document.querySelector('.share-code');field?.focus();field?.select();toast('请长按输入框复制口令');}
    }
    if(action==='share-publish'){
      if(!createDraft)throw Error('请重新预览分享内容');
      const list=records().filter(r=>new Date(r.expiresAt).getTime()>Date.now());if(list.length>=100)throw Error('本机已有 100 个有效分享，请先撤销不需要的记录');writeRecords(list);
      busy=true;el.disabled=true;const draft=createDraft,view=currentView();
      try{const data=await request(draft.server,'create',draft.payload);const code=normalizeCode(data.code);if(typeof data.deleteToken!=='string'||!Number.isFinite(Date.parse(data.expiresAt)))throw Error('服务返回的分享信息不完整');
        const allowed=draft.payload.allowFollow===true&&data.allowFollow===true;
        const r={code,deleteToken:data.deleteToken,expiresAt:data.expiresAt,server:draft.server,name:draft.payload.semester.name,createdAt:new Date().toISOString(),localSemesterId:draft.payload.semester.id,revision:data.revision||1,allowFollow:allowed,autoPublish:allowed,includeNotes:draft.payload.includeNotes,includeExams:draft.payload.includeExams,lastFingerprint:follow.initialFingerprint(draft.payload.semester),lastPublishedAt:new Date().toISOString()};
        // A previous background publish may have advanced another record while
        // this request was pending; merge into the latest management records.
        let message='';try{writeRecords([...records().filter(x=>new Date(x.expiresAt).getTime()>Date.now()),r]);}catch{memoryRecords.push(r);message='本机存储不足，撤销凭证暂存在当前会话中，请及时撤销此分享。';}
        createDraft=null;if(currentView()===view)showCode(r,message);else toast(message||'分享已创建，可在“管理我创建的分享”中查看口令');
      }finally{busy=false;el.disabled=false;}
    }
    if(action==='share-revoke'){
      deleteDraft=records().find(r=>r.code===el.dataset.code&&r.server===el.dataset.server);if(!deleteDraft)throw Error('没有这条分享的管理凭证');
      sheet('撤销分享？',`<p class="helper-box">撤销「${esc(deleteDraft.name)}」的分享口令 ${displayCode(deleteDraft.code)}。</p><div class="sheet-actions">${button('share-manage','返回')}${button('share-revoke-confirm','确认撤销','danger')}</div>`);
    }
    if(action==='share-revoke-confirm'){
      if(!deleteDraft)return true;const r=deleteDraft,view=currentView();busy=true;el.disabled=true;
      try{await request(r.server,'delete',{code:r.code,deleteToken:r.deleteToken});writeRecords(records().filter(x=>!(x.code===r.code&&x.server===r.server)));deleteDraft=null;if(currentView()===view)manage();toast('分享已撤销');}finally{busy=false;el.disabled=false;}
    }
    return true;
  }
  async function submitForm(form,values){
    if(!['share-server-form','share-create-form','share-receive-form','share-import-form'].includes(form.id))return false;
    if(busy)throw Error('正在处理分享请求，请稍候');
    if(form.id==='share-server-form'){const url=endpoint(values.server.trim());if(ctx.save({...state(),preferences:{...state().preferences,shareServerUrl:url}})){toast('服务地址已保存');home();}return true;}
    if(form.id==='share-create-form'){
      const s=state().semesters.find(s=>s.id===values.semesterId);if(!s)throw Error('所选学期已不存在');createDraft={server:endpoint(server()),payload:sharePayload(s,{includeNotes:values.includeNotes==='on',includeExams:values.includeExams==='on',expiresInDays:Number(values.expiresInDays)}),};createDraft.payload.allowFollow=values.allowFollow==='on';if(!createDraft.payload.allowFollow&&createDraft.payload.expiresInDays>30)throw Error('单次分享最多 30 天；持续分享可选更长时间');createPreview();return true;
    }
    if(form.id==='share-receive-form'){
      const code=normalizeCode(values.code),submitButton=form.querySelector('[type="submit"]'),view=currentView(),source=endpoint(server());busy=true;submitButton.disabled=true;
      try{const payload=await request(source,'get',{code});if(currentView()===view){receiveDraft=follow.prepare(payload,source,code);receivePreview();}}finally{busy=false;submitButton.disabled=false;}return true;
    }
    if(form.id==='share-import-form'){
      if(!receiveDraft)throw Error('请重新读取分享课表');const s={...receiveDraft.semester,name:values.name};
      if(ctx.save({...state(),semesters:[...state().semesters,s],activeSemesterId:s.id},'导入分享课表前')){let message='课表已导入为新学期';if(values.follow==='on')try{follow.subscribe(receiveDraft);message+='，跟随已开启';}catch(e){message+='；跟随未保存：'+e.message;}receiveDraft=null;ctx.refresh();toast(message);}return true;
    }
    return false;
  }
  function change(target){if(target.closest('#share-create-form')&&target.name==='allowFollow'){const el=document.querySelector('#share-create-form [name="expiresInDays"]');const values=target.checked?[[7,'7 天'],[30,'30 天'],[180,'180 天'],[365,'365 天']]:[[1,'1 天'],[7,'7 天'],[30,'30 天']];el.innerHTML=values.map(([v,t])=>`<option value="${v}">${t}</option>`).join('');el.value=target.checked?'180':'7';return true;}return false;}
  return {click,submit:submitForm,change,home,onStateSaved:follow.schedule,onForeground:follow.foreground};
}
