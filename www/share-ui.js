import {createFollowManager} from './share-follow.js';
import {shareMessage,parseShareInput,shareCode,shareServer,prettyCode} from './share-links.js';
import {uid,validateState,createState} from './engine.js';
import {esc,clone,icon,button,field,input,select,submit,sheet,closeSheet,toast} from './ui.js';
import {newTransferCode,normalizeTransferCode,sealTransfer,openTransfer,transferId,sha256} from './transfer-seal.js';

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

const FOLLOW_KEY='qingke.follows.v1';
const storedList=key=>{try{const v=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(v)?v:[];}catch{return [];}};
const httpsServer=value=>{try{return endpoint(value)===value;}catch{return false;}};
const validShare=r=>r&&CODE.test(r.code)&&typeof r.deleteToken==='string'&&r.deleteToken.length<=500&&httpsServer(r.server)&&new Date(r.expiresAt).getTime()>Date.now();
/** Records arriving from a backup file or a transfer code keep only known fields with their types. */
function cleanShare(r){
  const text=(value,max)=>typeof value==='string'?value.slice(0,max):'',flag=value=>value===true;
  return {code:r.code,deleteToken:r.deleteToken,expiresAt:r.expiresAt,server:r.server,name:text(r.name,120)||'未命名学期',
    createdAt:text(r.createdAt,40)||new Date().toISOString(),localSemesterId:text(r.localSemesterId,120),
    revision:Number.isSafeInteger(r.revision)&&r.revision>0?r.revision:1,allowFollow:flag(r.allowFollow),autoPublish:flag(r.autoPublish),
    includeNotes:flag(r.includeNotes),includeExams:flag(r.includeExams),lastFingerprint:text(r.lastFingerprint,4*1024*1024),
    lastPublishedAt:text(r.lastPublishedAt,40),...(typeof r.handedOffAt==='string'?{handedOffAt:r.handedOffAt.slice(0,40)}:{})};
}
const MAX_TRANSFER=128*1024;
const fingerprintDigest=text=>text?[...sha256(new TextEncoder().encode(text))].map(b=>b.toString(16).padStart(2,'0')).join(''):'';
/** Share credentials and follow records travel inside a full backup, outside the timetable state, so a
 * new phone can keep publishing to, revoking and following the same shares. */
export function shareBackup(){
  const shares=storedList(RECORD_KEY).filter(r=>r&&CODE.test(r.code)&&typeof r.deleteToken==='string');
  const follows=storedList(FOLLOW_KEY).filter(r=>r&&typeof r.code==='string'&&typeof r.localSemesterId==='string');
  return shares.length||follows.length?{format:'qingke-sharing',version:1,shares,follows}:null;
}
export function shareBackupSummary(data){
  if(data?.format!=='qingke-sharing'||data.version!==1)return null;
  return {shares:Array.isArray(data.shares)?data.shares.length:0,follows:Array.isArray(data.follows)?data.follows.length:0};
}
/** After a full restore: merge owned shares (the newer revision wins) and take the backup's follows,
 * keeping only those whose semester came back with it. */
export function restoreShareBackup(data,semesterIds){
  if(!shareBackupSummary(data))return {shares:0,follows:0};
  const ids=new Set(semesterIds),key=r=>`${r.server}|${r.code}`;
  const shares=(Array.isArray(data.shares)?data.shares:[]).filter(validShare).slice(0,100).map(cleanShare);
  const follows=(Array.isArray(data.follows)?data.follows:[]).filter(r=>r&&CODE.test(r.code)&&httpsServer(r.server)&&ids.has(r.localSemesterId)).slice(0,30);
  let current=[];try{current=records();}catch{}
  const merged=new Map(current.map(r=>[key(r),r]));
  for(const r of shares){const old=merged.get(key(r));if(!old||Number(r.revision||0)>=Number(old.revision||0))merged.set(key(r),r);}
  writeRecords([...merged.values()]);
  localStorage.setItem(FOLLOW_KEY,JSON.stringify(follows));
  return {shares:shares.length,follows:follows.length};
}

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
  const method={create:'POST',get:'GET',delete:'DELETE',update:'PUT','transfer-create':'POST','transfer-get':'GET'}[action];
  if(action.startsWith('transfer-')&&!/^[0-9a-f]{32}$/.test(payload.id))throw Error('换机码无效');
  const path=action==='create'?'/api/shares':action==='transfer-create'?'/api/transfers':action==='transfer-get'?`/api/transfers/${payload.id}`:`/api/shares/${normalizeCode(payload.code)}`;
  const headers={Accept:'application/json'},sends=['create','update','transfer-create'].includes(action);if(sends)headers['Content-Type']='application/json';if(action==='delete'||action==='update')headers.Authorization=`Bearer ${payload.deleteToken}`;
  const response=await fetch(server+path,{method,headers,body:sends?JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([key])=>!['code','deleteToken'].includes(key)))):undefined,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)});
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
  const row=(action,i,title,description,attrs='')=>`<button type="button" class="setting-row" data-action="${action}" ${attrs}><span class="setting-icon">${icon(i)}</span><span class="row-text"><strong>${title}</strong>${description?`<small>${description}</small>`:''}</span>${icon('right',15)}</button>`;
  const group=(name,content)=>`<section class="settings-section">${name?`<h2>${name}</h2>`:''}<div class="setting-group">${content}</div></section>`;
  const recordAttrs=r=>`data-code="${r.code}" data-server="${esc(r.server)}"`;
  const localOf=r=>r.localSemesterId?state().semesters.find(s=>s.id===r.localSemesterId)||null:null;
  const isEmpty=s=>!s.courses.length&&!(s.exams||[]).length;
  const expired=r=>new Date(r.expiresAt).getTime()<=Date.now();
  // No local semester, or linked to an empty one (e.g. a fresh install's blank semester).
  const needsTimetable=r=>{const s=localOf(r);return !s||isEmpty(s);};
  const needsAttention=r=>!expired(r)&&!!(r.handedOffAt||needsTimetable(r)||r.error||r.transferNote);
  function statusText(r){
    if(expired(r))return '已到期';
    if(r.handedOffAt)return '已移交到其他设备';
    if(needsTimetable(r))return localOf(r)?'关联的学期是空的，需要取回课表':'本机没有这份课表，需要取回';
    if(r.error)return r.error;
    if(r.transferNote)return '待确认：发布一次后恢复自动更新';
    return r.allowFollow?`持续分享中 · 版本 ${r.revision||1}`:`单次分享 · ${new Date(r.expiresAt).toLocaleDateString('zh-CN')} 到期`;
  }
  function home(){
    let owned=[],followed=0;
    try{owned=records();}catch{}
    try{followed=follow.list().filter(r=>state().semesters.some(s=>s.id===r.localSemesterId)).length;}catch{}
    const pending=owned.filter(needsAttention).length;
    sheet('分享课表',`<p class="sheet-subtitle">把一个学期分享给朋友，或输入朋友的口令导入。</p><div class="sheet-actions">${button('share-create',`${icon('upload',17)} 分享我的课表`,'primary')}${button('share-receive',`${icon('download',17)} 输入口令导入`)}</div>${group('我的分享',row('share-manage','upload','我创建的分享',`${owned.length} 个${pending?` · ${pending} 个需要处理`:''}`)+row('follow-list','download','我跟随的课表',followed?`${followed} 个 · 打开 App 时检查更新`:'导入朋友的分享时可选择跟随'))}${group('更多',row('transfer-home','swap','换手机','用换机码把我创建的分享转到新手机')+row('share-server','settings','分享服务',esc(new URL(server()).hostname))+row('share-entry-settings','note','链接与剪贴板','打开分享链接、识别剪贴板中的口令'))}<p class="source-note">持有口令的人可读取这份课表，请只发给需要的人。可设置到期时间或主动撤销。只有双方选择持续更新与跟随时，之后的修改才会同步。</p>`);
  }
  function serverForm(){
    sheet('分享服务',`<form id="share-server-form">${field('分享服务地址',input('server',server(),'url','required maxlength="500" placeholder="https://课表分享域名"'),'填写部署好的 HTTPS 域名。换机时两台手机需使用同一个服务。')}${submit('保存服务地址')}</form>${button('share-home','返回','text-button full-width')}`);
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
    const text=shareMessage(record),attributes=`data-code="${record.code}" data-server="${esc(record.server)}"`;
    sheet('分享课表',`<div class="share-summary"><strong>${esc(record.name)}</strong><p>有效至 ${esc(new Date(record.expiresAt).toLocaleString('zh-CN'))}</p></div><label class="field"><span>分享口令</span><input readonly class="share-code" value="${displayCode(record.code)}" aria-label="分享口令"></label>${field('发给朋友的消息',`<textarea class="share-message" readonly rows="6">${esc(text)}</textarea>`)}<div class="sheet-actions">${button('share-copy','复制分享消息','primary',attributes)}${button('share-system','系统分享','secondary',attributes)}</div>${message?`<p class="helper-box warning-box">${esc(message)}</p>`:''}<p class="helper-box">朋友可点链接打开清课，或复制整段消息后打开 App。未安装时可从链接页面下载；读取后仍需预览并确认导入。</p><p class="source-note">${esc(record.server)}<br>管理凭证只留在本机，不包含在消息中。</p><div class="sheet-actions">${button('share-manage','管理分享')}${button('share-home','完成')}</div>`);
  }
  function receiveForm(entry=null){
    const source=shareServer(entry?.server||server()),code=entry?prettyCode(entry.code):'',title=entry?.source==='clipboard'?'发现剪贴板中的清课分享':entry?'打开分享课表':'导入分享课表';
    sheet(title,`<form id="share-receive-form">${field('分享消息、链接或口令',`<textarea name="code" rows="3" required maxlength="16384" autocomplete="off" placeholder="粘贴朋友发来的整段消息，也可填写口令">${esc(code)}</textarea>`)}${field('本次读取的分享服务',input('server',source,'url','readonly'),'请核对来源；不会改变你默认的分享服务。')}<p class="helper-box">点下方按钮后才访问此服务。先预览内容，确认后保存为新学期，现有课程保留。</p>${submit('读取并预览')}</form>`);
  }
  function receivePreview(){
    const s=receiveDraft.semester;
    sheet('预览分享课表',`<form id="share-import-form">${field('新学期名称',input('name',s.name,'text','required maxlength="80"'))}<div class="share-summary"><p>${s.startDate} 开始 · ${s.totalWeeks} 周</p><p>${s.courses.length} 门课程 · ${s.exams.length} 场考试 · ${s.profiles.length} 套作息</p></div><div class="share-course-preview">${s.courses.map(c=>`<p><strong>${esc(c.name)}</strong><small>${c.sessions.map(t=>esc(t.location||'地点待定')).join(' / ')}</small></p>`).join('')}</div><p class="helper-box">导入后保存为独立学期。请核对学校校历和作息，原有学期不会被覆盖。</p>${receiveDraft.allowFollow?'<label class="check-row"><input type="checkbox" name="follow" checked><span><strong>跟随分享者的后续更新</strong><small>导入后开启，可取消勾选。打开 App 或回到前台时检查，保留我自己的修改，有冲突先核对。</small></span></label>':'<p class="source-note">分享者未开启持续更新，将导入当前副本。</p>'}${submit('导入为新学期')}</form>`);
  }
  /** One row per share; everything else lives on the share's own page, with the one action that
   * share needs right now shown first. */
  function manage(){
    const list=records().sort((a,b)=>Number(needsAttention(b))-Number(needsAttention(a))||b.createdAt.localeCompare(a.createdAt));
    sheet('我创建的分享',`${list.length?group('',list.map(r=>row('share-detail',needsAttention(r)?'bell':'upload',esc(r.name),`${displayCode(r.code)}<br>${esc(statusText(r))}`,recordAttrs(r))).join('')):'<p class="helper-box">还没有在这台设备上创建过分享。</p>'}<p class="source-note">持续分享会在 App 前台联网时自动发布修改；撤销口令不会删除朋友已导入的副本。</p>${button('share-home','返回','secondary full-width')}`);
  }
  function detail(r){
    const a=recordAttrs(r),local=localOf(r),live=!expired(r),active=state().semesters.find(s=>s.id===state().activeSemesterId);
    const publishable=live&&local&&!isEmpty(local)&&!r.handedOffAt;
    let primary='';
    if(live&&needsTimetable(r))primary=button('transfer-adopt',`${icon('download',17)} 从分享取回课表`,'primary full-width',a);
    else if(r.handedOffAt)primary=button('transfer-reclaim','收回到本机','primary full-width',a);
    else if(publishable&&(r.transferNote||r.error))primary=button('owner-publish-now','发布最新修改','primary full-width',a);
    const rows=[row('share-show','upload','查看 / 发送口令',displayCode(r.code),a)];
    if(publishable&&!primary)rows.push(row('owner-publish-now','upload','发布最新修改','把本机这个学期发布到分享',a));
    if(publishable)rows.push(row('owner-toggle-follow','swap',r.allowFollow?'关闭持续跟随':'开启持续跟随',r.allowFollow?'朋友保留现有副本，不再收到更新':'允许朋友跟随之后的修改',a));
    if(active&&!isEmpty(active)&&active.id!==local?.id&&(!local||isEmpty(local)))rows.push(row('transfer-link','calendar','改用当前学期',`把这份分享关联到「${esc(active.name)}」`,a));
    const note=r.handedOffAt?'这份分享已移交到其他设备，本机不再自动发布。没用上换机码时可收回。':needsTimetable(r)&&live?`${local?`关联的「${esc(local.name)}」是空学期。`:'本机还没有这份课表。'}取回后会用分享里的课程替换，并恢复自动更新；分享时未包含的备注、考试不会恢复。`:r.transferNote||r.error?esc(r.transferNote||r.error):'';
    sheet('分享详情',`<div class="share-summary"><strong>${esc(r.name)}</strong><p>${esc(statusText(r))}</p><p>${live?`有效至 ${esc(new Date(r.expiresAt).toLocaleDateString('zh-CN'))}`:'已到期'} · ${esc(new URL(r.server).hostname)}</p>${local?`<p>本机学期：${esc(local.name)}${isEmpty(local)?'（空）':''}</p>`:''}</div>${note?`<p class="helper-box">${note}</p>`:''}${primary}${group('',rows.join(''))}${button('share-revoke','撤销分享','text-button full-width',a)}${button('share-manage','返回','secondary full-width')}`);
  }
  // After an action, come back to the same share when it still exists.
  const reopen=record=>{const r=records().find(x=>shareKey(x)===shareKey(record));if(r)detail(r);else manage();};
  async function click(action,el){
    if(await follow.click(action,el))return true;
    if(!['share-home','share-create','share-receive','share-manage','share-detail','share-server','share-publish','share-copy','share-show','share-system','share-revoke','share-revoke-confirm','transfer-home','transfer-out','transfer-make','transfer-in','transfer-copy','transfer-reclaim','transfer-link','transfer-adopt'].includes(action))return false;
    if(busy){toast('正在处理分享请求，请稍候');return true;}
    if(action==='share-home')home();
    if(action==='share-create')createForm();
    if(action==='share-receive')receiveForm();
    if(action==='share-manage')manage();
    if(action==='share-server')serverForm();
    if(action==='share-detail'){const record=records().find(r=>r.code===el.dataset.code&&r.server===el.dataset.server);if(!record)throw Error('找不到这份分享，请重新打开分享管理');detail(record);return true;}
    if(action.startsWith('transfer-')){await transferClick(action,el);return true;}
    if(['share-copy','share-show','share-system'].includes(action)){
      const record=records().find(r=>r.code===el.dataset.code&&r.server===el.dataset.server);if(!record)throw Error('找不到这份分享，请重新打开分享管理');
      if(action==='share-show'){showCode(record);return true;}
      const text=shareMessage(record);
      if(action==='share-system'){
        if(window.Android?.shareText){if(!Android.shareText(text))throw Error('无法打开系统分享，请复制消息发送');return true;}
        if(navigator.share){try{await navigator.share({title:'清课课表分享',text});}catch(e){if(e.name!=='AbortError')throw e;}return true;}
      }
      if(window.Android?.copyText&&Android.copyText(text)){toast('分享消息已复制');return true;}
      try{await navigator.clipboard.writeText(text);toast('分享消息已复制');}catch{const field=document.querySelector('.share-message');field?.focus();field?.select();toast('请长按消息文本复制');}
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
      sheet('撤销分享？',`<p class="helper-box">撤销「${esc(deleteDraft.name)}」的分享口令 ${displayCode(deleteDraft.code)}。朋友已导入的副本不受影响，但之后无法再读取或跟随这个口令。</p><div class="sheet-actions">${button('share-detail','返回',undefined,recordAttrs(deleteDraft))}${button('share-revoke-confirm','确认撤销','danger')}</div>`);
    }
    if(action==='share-revoke-confirm'){
      if(!deleteDraft)return true;const r=deleteDraft,view=currentView();busy=true;el.disabled=true;
      try{await request(r.server,'delete',{code:r.code,deleteToken:r.deleteToken});writeRecords(records().filter(x=>!(x.code===r.code&&x.server===r.server)));deleteDraft=null;if(currentView()===view)manage();toast('分享已撤销');}finally{busy=false;el.disabled=false;}
    }
    return true;
  }
  async function submitForm(form,values){
    if(!['share-server-form','share-create-form','share-receive-form','share-import-form','transfer-in-form'].includes(form.id))return false;
    if(busy)throw Error('正在处理分享请求，请稍候');
    if(form.id==='share-server-form'){const url=endpoint(values.server.trim());if(ctx.save({...state(),preferences:{...state().preferences,shareServerUrl:url}})){toast('服务地址已保存');home();}return true;}
    if(form.id==='share-create-form'){
      const s=state().semesters.find(s=>s.id===values.semesterId);if(!s)throw Error('所选学期已不存在');createDraft={server:endpoint(server()),payload:sharePayload(s,{includeNotes:values.includeNotes==='on',includeExams:values.includeExams==='on',expiresInDays:Number(values.expiresInDays)}),};createDraft.payload.allowFollow=values.allowFollow==='on';if(!createDraft.payload.allowFollow&&createDraft.payload.expiresInDays>30)throw Error('单次分享最多 30 天；持续分享可选更长时间');createPreview();return true;
    }
    if(form.id==='share-receive-form'){
      const source=shareServer(values.server||server()),parsed=parseShareInput(values.code,source);
      if(parsed.server!==source){receiveForm(parsed);toast('消息使用另一分享服务，请核对地址后再读取');return true;}
      const code=parsed.code,submitButton=form.querySelector('[type="submit"]'),view=currentView();busy=true;submitButton.disabled=true;
      try{const payload=await request(source,'get',{code});if(currentView()===view){receiveDraft=follow.prepare(payload,source,code);receivePreview();}}finally{busy=false;submitButton.disabled=false;}return true;
    }
    if(form.id==='transfer-in-form'){const submitButton=form.querySelector('[type="submit"]');busy=true;submitButton.disabled=true;try{await redeemTransfer(values.code);}finally{busy=false;submitButton.disabled=false;}return true;}
    if(form.id==='share-import-form'){
      if(!receiveDraft)throw Error('请重新读取分享课表');const s={...receiveDraft.semester,name:values.name};
      if(ctx.save({...state(),semesters:[...state().semesters,s],activeSemesterId:s.id},'导入分享课表前')){let message='课表已导入为新学期';if(receiveDraft.allowFollow&&values.follow==='on')try{follow.subscribe(receiveDraft);message+='，跟随已开启';}catch(e){message+='；跟随未保存：'+e.message;}receiveDraft=null;ctx.refresh();toast(message);}return true;
    }
    return false;
  }
  // ---------- Moving owned shares to another phone ----------
  // Only management credentials move; timetables stay on the phones. The sending phone hands its
  // shares off (stops auto-publishing) so two phones never publish the same share against each other.
  const shareKey=r=>`${r.server}|${r.code}`;
  const transferable=()=>records().filter(validShare);
  function transferHome(){
    sheet('换手机',`<p class="sheet-subtitle">把你创建的分享移到另一台手机（安卓和苹果通用），之后由新手机继续更新、续期和撤销。</p>${button('transfer-out','在旧手机：生成换机码','primary full-width')}${button('transfer-in','在新手机：输入换机码','secondary full-width','style="margin-top:10px"')}<p class="helper-box" style="margin-top:16px">换机码只转移分享的管理凭证。新手机上没有对应课表时，接手后可直接从分享取回课表（分享时未包含的备注、考试不会恢复）。跟随朋友的课表请在新手机重新输入朋友的口令。</p><p class="source-note">换机码在本机加密，服务器只保存无法解读的密文，24 小时内有效，读取一次后即删除。</p>${button('share-home','返回','text-button full-width')}`);
  }
  function transferOut(){
    const list=transferable(),active=list.filter(r=>!r.handedOffAt);
    sheet('生成换机码',`${list.length?`<div class="share-summary"><strong>${list.length} 个分享</strong>${list.map(r=>`<p>${esc(r.name)} · ${displayCode(r.code)}</p>`).join('')}</div><p class="helper-box">生成后，本机${active.length?'会暂停这些分享的自动发布，':''}仍可查看口令；新手机接手后由它发布修改。万一没用上，可在「管理我创建的分享」中收回。</p>${button('transfer-make','生成换机码','primary full-width')}`:'<p class="helper-box">这台手机上没有有效的分享可以转移。</p>'}${button('transfer-home','返回','text-button full-width')}`);
  }
  async function makeTransfer(el){
    const list=transferable();if(!list.length)throw Error('没有可转移的分享');
    // The publish fingerprint is the whole semester as text; a digest is enough to tell on the new
    // phone whether its copy already matches what was last published.
    const shares=list.map(r=>{const {lastFingerprint,...rest}=cleanShare(r);return {...rest,fingerprintDigest:fingerprintDigest(lastFingerprint)};});
    const code=newTransferCode(),sealed=sealTransfer(code,{format:'qingke-transfer',version:1,createdAt:new Date().toISOString(),shares});
    if(sealed.data.length>MAX_TRANSFER)throw Error('分享记录太多，换机码装不下；请先撤销不再使用的分享');
    const view=currentView();busy=true;el.disabled=true;
    try{
      const result=await request(server(),'transfer-create',sealed);
      const moved=new Set(list.map(shareKey)),at=new Date().toISOString();
      writeRecords(records().map(r=>moved.has(shareKey(r))?{...r,handedOffAt:r.handedOffAt||at,autoPublish:false}:r));
      if(currentView()===view)sheet('换机码',`<label class="field"><span>换机码</span><input readonly class="share-code" value="${displayCode(code)}" aria-label="换机码"></label>${button('transfer-copy','复制换机码','primary full-width',`data-code="${code}"`)}<p class="helper-box">在新手机打开清课：设置 → 分享与跟随 → 换手机 → 输入换机码。<br>有效至 ${esc(new Date(result.expiresAt).toLocaleString('zh-CN'))}，只能使用一次。</p><p class="source-note">换机码就是解密钥匙，请勿发给别人。新手机需使用同一个分享服务。</p>${button('share-manage','完成','text-button full-width')}`);
    }finally{busy=false;el.disabled=false;}
  }
  async function redeemTransfer(value){
    const code=normalizeTransferCode(value),view=currentView();
    let data;
    try{({data}=await request(server(),'transfer-get',{id:transferId(code)}));}
    catch(e){if(e.status===404)throw Error('换机码不存在、已使用或已过期。可在旧手机「管理我创建的分享」点「收回到本机」后重新生成');throw e;}
    const payload=openTransfer(code,data);
    if(payload?.format!=='qingke-transfer'||payload.version!==1||!Array.isArray(payload.shares))throw Error('换机数据格式不受支持');
    const semesters=state().semesters,incoming=payload.shares.filter(validShare).slice(0,100).map(r=>({...cleanShare(r),digest:typeof r.fingerprintDigest==='string'?r.fingerprintDigest:''}));let linked=0,named=0;
    const received=incoming.map(r=>{
      // Same id: the timetable came over by backup. A unique name match is linked but stays paused
      // until the owner checks it and publishes once, so a wrong match never reaches followers.
      let local=semesters.find(s=>s.id===r.localSemesterId),how='id';
      if(!local){const same=semesters.filter(s=>s.name===r.name);if(same.length===1){local=same[0];how='name';}}
      if(local){if(how==='id')linked++;else named++;}
      const {handedOffAt,digest,...rest}=r;
      // Unchanged since the last publish: keep the fingerprint so nothing is republished on arrival.
      const current=local&&how==='id'?follow.initialFingerprint(sharePayload(local,{includeNotes:r.includeNotes,includeExams:r.includeExams}).semester):'';
      return {...rest,lastFingerprint:current&&fingerprintDigest(current)===digest?current:'',localSemesterId:local?.id||'',autoPublish:how==='id'&&!!local&&r.allowFollow===true,
        transferNote:!local?'本机还没有这份课表：点「导入这份课表」从分享取回':how==='name'?'已按学期名称关联：核对后点「发布最新修改」恢复自动更新':''};
    });
    const merged=new Map(records().map(r=>[shareKey(r),r]));received.forEach(r=>merged.set(shareKey(r),r));writeRecords([...merged.values()]);
    if(currentView()===view)manage();
    const unlinked=received.length-linked-named;
    toast(`已接手 ${received.length} 个分享${named?`，${named} 个按名称关联待确认`:''}${unlinked?`；${unlinked} 个在本机还没有课表，可点「导入这份课表」取回`:''}`);
  }
  /** The share already holds this semester: bring it back with its original ids, so the next
   * publish is not a wholesale replacement for followers, and link the share to it. */
  async function adoptShare(record,el){
    busy=true;el.disabled=true;
    try{
      const remote=await request(record.server,'get',{code:record.code});
      if(remote?.format!=='qingke-semester'||remote.version!==1||!remote.semester)throw Error('分享内容不是支持的课表格式');
      if(!remote.semester.courses?.length&&!remote.semester.exams?.length)throw Error('云端分享里也没有课程（可能已发布过空课表）。请在仍有这份课表的手机上发布一次，或恢复备份后用「改用当前学期」再发布');
      const s=validateState({...createState(),semesters:[remote.semester],activeSemesterId:remote.semester.id}).semesters[0],current=state();
      // A share linked to an empty semester (a fresh install's blank one, linked by mistake) gets that
      // semester replaced in place; otherwise the semester is added, replacing a lone blank one.
      const linked=localOf(record),replacing=linked&&isEmpty(linked)?linked:null;
      if(current.semesters.some(x=>x.id===s.id&&x.id!==replacing?.id))throw Error('本机已有这个学期，请打开它后点「改用当前学期」');
      const lone=current.semesters.length===1&&isEmpty(current.semesters[0])&&!records().some(r=>r.localSemesterId===current.semesters[0].id);
      const semesters=replacing?current.semesters.map(x=>x.id===replacing.id?s:x):lone?[s]:[...current.semesters,s];
      if(!ctx.save({...current,semesters,activeSemesterId:s.id},'从分享取回课表前'))return;
      const fingerprint=follow.initialFingerprint(sharePayload(s,{includeNotes:record.includeNotes===true,includeExams:record.includeExams===true}).semester);
      writeRecords(records().map(r=>shareKey(r)!==shareKey(record)?r:{...r,localSemesterId:s.id,name:s.name,revision:Number(remote.revision)||r.revision,
        autoPublish:r.allowFollow===true&&remote.allowFollow===true,lastFingerprint:fingerprint,transferNote:'',error:''}));
      ctx.refresh();reopen(record);
      toast(`已取回「${s.name}」并关联分享${record.includeNotes&&record.includeExams?'':'；分享时未包含的备注或考试不会恢复'}`);
    }finally{busy=false;el.disabled=false;}
  }
  async function transferClick(action,el){
    if(action==='transfer-home'){transferHome();return true;}
    if(action==='transfer-out'){transferOut();return true;}
    if(action==='transfer-make'){await makeTransfer(el);return true;}
    if(action==='transfer-in'){sheet('输入换机码',`<form id="transfer-in-form">${field('换机码',input('code','','text','required maxlength="40" autocomplete="off" autocapitalize="characters" placeholder="XXXXX-XXXXX-XXXXX-XXXXX"'),'在旧手机「生成换机码」后得到，24 小时内有效。')}<p class="helper-box">接手后，新手机负责发布这些分享的修改，旧手机已自动暂停发布。</p>${submit('接手分享')}</form>`);return true;}
    if(action==='transfer-copy'){const text=displayCode(el.dataset.code);if(window.Android?.copyText&&Android.copyText(text)){toast('换机码已复制');return true;}try{await navigator.clipboard.writeText(text);toast('换机码已复制');}catch{toast('请长按换机码复制');}return true;}
    if(!['transfer-reclaim','transfer-link','transfer-adopt'].includes(action))return false;
    const record=records().find(r=>r.code===el.dataset.code&&r.server===el.dataset.server);
    if(!record)throw Error('找不到这份分享，请重新打开分享管理');
    const patch=fields=>writeRecords(records().map(r=>{if(shareKey(r)!==shareKey(record))return r;const {handedOffAt,...rest}=r;return {...rest,...fields};}));
    if(action==='transfer-adopt'){await adoptShare(record,el);return true;}
    if(action==='transfer-reclaim'){
      patch({autoPublish:false,transferNote:'已收回：核对后点「发布最新修改」恢复自动更新'});
      reopen(record);toast('已收回。若另一台手机也接手了，请只在一台上发布');return true;
    }
    const active=state().semesters.find(s=>s.id===state().activeSemesterId);
    // Linking an empty semester and publishing it would empty the friends' copies.
    if(!active||isEmpty(active))throw Error('当前学期是空的，不能关联。请用「从分享取回课表」，或先打开有课程的学期');
    patch({localSemesterId:active.id,autoPublish:false,transferNote:`已关联「${active.name}」：核对后点「发布最新修改」恢复自动更新`});
    reopen(record);return true;
  }
  function change(target){if(target.closest('#share-create-form')&&target.name==='allowFollow'){const el=document.querySelector('#share-create-form [name="expiresInDays"]');const values=target.checked?[[7,'7 天'],[30,'30 天'],[180,'180 天'],[365,'365 天']]:[[1,'1 天'],[7,'7 天'],[30,'30 天']];el.innerHTML=values.map(([v,t])=>`<option value="${v}">${t}</option>`).join('');el.value=target.checked?'180':'7';return true;}return false;}
  return {click,submit:submitForm,change,home,isOwnShare:entry=>records().some(r=>r.code===entry.code&&r.server===entry.server),openShare:entry=>receiveForm({code:shareCode(entry.code),server:shareServer(entry.server),source:entry.source}),onStateSaved:follow.schedule,onForeground:follow.foreground};
}
