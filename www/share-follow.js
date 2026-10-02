import {remapSharedSemester,mergeFollowedSemester} from './share-sync.js';
import {esc,clone,button,field,input,submit,sheet,toast} from './ui.js';

const KEY='qingke.follows.v1';
const stable=value=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')}}`:JSON.stringify(value);
const timeLabel=value=>value?new Date(value).toLocaleString('zh-CN'):'尚未同步';
const fields={name:'名称',startDate:'开学日期',totalWeeks:'总周数',showWeekend:'周末显示',profiles:'作息方案',periods:'小节时间',effectiveFrom:'生效月日',courses:'课程',sessions:'上课安排',weeks:'周次',day:'星期',startPeriod:'开始节次',endPeriod:'结束节次',teacher:'教师',location:'地点',note:'备注',dayRules:'停补课',exceptions:'单次调课',holidayLabels:'日期标记',exams:'考试',date:'日期',startTime:'开始时间',endTime:'结束时间',shortName:'简称',assessment:'考核方式',nature:'课程性质'};
const pathLabel=path=>String(path).split(/[.\[\]]+/).filter(Boolean).map(s=>fields[s]||s).filter(s=>!/[a-f\d]{8}-[a-f\d-]{20,}/i.test(s)).join(' / ');
const valueText=value=>value===undefined?'已删除':typeof value==='string'?value:typeof value==='number'||typeof value==='boolean'?String(value):Array.isArray(value)&&value.every(x=>typeof x!=='object')?value.join('、'):JSON.stringify(value).slice(0,650);

export function createFollowManager(ctx,api){
  let running=false,timer=null,lastCheck=0,ownerDraft=null,ownersDirty=false,lastForeground=0;
  // A sheet is replaced as a whole. Keep its identity across awaits so a late
  // response cannot replace a new form or silently apply beneath its draft.
  const currentView=()=>document.querySelector('#modal-root')?.firstChild??null;
  const state=()=>ctx.getState();
  const list=()=>{const values=JSON.parse(localStorage.getItem(KEY)||'[]');if(!Array.isArray(values)||values.length>30)throw Error('跟随记录无法读取');return values;};
  const store=values=>localStorage.setItem(KEY,JSON.stringify(values));
  function patchFollow(id,patch){const items=list(),index=items.findIndex(r=>r.localSemesterId===id);if(index<0)return;items[index]={...items[index],...patch};store(items);}
  function patchOwner(record,patch){const items=api.records(),index=items.findIndex(r=>r.code===record.code&&r.server===record.server);if(index<0)return;items[index]={...items[index],...patch};api.writeRecords(items);}
  const findLocal=id=>state().semesters.find(s=>s.id===id);
  function prepare(payload,server,code){
    if(payload?.format!=='qingke-semester'||payload.version!==1)throw Error('不是支持的课表分享格式');
    const remapped=remapSharedSemester(payload.semester);
    return {...remapped,server,code,revision:Number(payload.revision||1),allowFollow:payload.allowFollow===true,expiresAt:payload.expiresAt};
  }
  function subscribe(draft){
    if(!draft.allowFollow)throw Error('分享者没有允许跟随更新');
    const items=list().filter(r=>r.localSemesterId!==draft.semester.id);if(items.length>=30)throw Error('最多跟随 30 个学期');
    items.push({localSemesterId:draft.semester.id,server:draft.server,code:draft.code,revision:draft.revision,map:draft.map,baseline:clone(draft.semester),enabled:true,lastSyncedAt:new Date().toISOString(),expiresAt:draft.expiresAt,error:'',pending:null});store(items);
  }
  function showList(){
    const items=list().filter(r=>findLocal(r.localSemesterId));
    sheet('我跟随的课表',`<p class="sheet-subtitle">打开 App、回到前台或手动检查时同步。离线仍可查看；分享撤销或到期不会删除本地副本。</p>${button('follow-check','立即检查更新','primary full-width')}${items.map(r=>{const s=findLocal(r.localSemesterId);return `<div class="change-row" style="display:block"><strong>${esc(s.name)}</strong><p class="follow-status ${r.pending?'needs-review':''}">${r.enabled?'跟随已开启':'已暂停跟随'} · 版本 ${r.revision}<br>${esc(r.error||`上次同步：${timeLabel(r.lastSyncedAt)}`)}</p><div class="follow-actions">${r.pending?button('follow-review','核对这次更新','primary',`data-id="${esc(r.localSemesterId)}"`):''}${button('follow-toggle',r.enabled?'暂停跟随':'继续跟随','secondary',`data-id="${esc(r.localSemesterId)}"`)}${button('follow-remove','解除跟随','text-button',`data-id="${esc(r.localSemesterId)}"`)}</div></div>`;}).join('')||'<p class="helper-box">导入支持持续更新的分享时，可以选择跟随。</p>'}${button('share-home','返回','secondary full-width','style="margin-top:15px"')}`);
  }
  function pendingReview(id){
    const r=list().find(r=>r.localSemesterId===id),local=findLocal(id);if(!r?.pending||!local)throw Error('没有待核对的更新');
    const merged=mergeFollowedSemester(local,r.baseline,r.pending.incoming);
    sheet('核对跟随更新',`<p class="sheet-subtitle">${esc(local.name)} · 分享版本 ${r.revision} → ${r.pending.revision}</p><div class="helper-box">${merged.changes.length} 项可合并变化，${merged.conflicts.length} 项需要核对。${merged.validationError?`<br>${esc(merged.validationError)}`:''}</div>${merged.conflicts.slice(0,50).map(c=>`<div class="sync-conflict"><strong>${esc(pathLabel(c.path))}</strong><br>你的版本：${esc(valueText(c.local))}<br>分享者版本：${esc(valueText(c.incoming))}</div>`).join('')}${merged.changes.length?`<p class="source-note">变化：${[...new Set(merged.changes.map(c=>pathLabel(c.path)))].slice(0,20).map(esc).join('、')}</p>`:''}<p class="source-note">合并保留你改过的字段和自己添加的考试，同时接收其他变化。“使用分享者版本”会替换这个学期，操作前会保留恢复版本。</p><div class="sheet-actions">${button('follow-list','稍后处理')}${button('follow-merge','合并并保留我的修改','primary',`data-id="${esc(id)}" ${merged.validationError?'disabled':''}`)}</div>${button('follow-replace-preview','使用分享者版本…','text-button full-width',`data-id="${esc(id)}" style="margin-top:15px"`)}`);
  }
  function applyFollow(r,semester,pending){
    if(!ctx.save({...state(),semesters:state().semesters.map(s=>s.id===r.localSemesterId?semester:s)},'同步分享课表前'))throw Error('保存失败，更新尚未应用');
    patchFollow(r.localSemesterId,{baseline:clone(pending.incoming),map:pending.map,revision:pending.revision,expiresAt:pending.expiresAt,pending:null,error:'',lastSyncedAt:new Date().toISOString()});
    ctx.onSynced?.();
  }
  async function checkFollower(record,manual=false,manualView=null){
    let local=findLocal(record.localSemesterId);if(!local||!record.enabled)return;
    const remote=await api.request(record.server,'get',{code:record.code});
    record=list().find(r=>r.localSemesterId===record.localSemesterId);local=record?findLocal(record.localSemesterId):null;if(!record?.enabled||!local)return;
    if(!remote.allowFollow){patchFollow(record.localSemesterId,{error:'分享者暂未允许继续跟随，本地课表保留'});return;}
    if(Number(remote.revision)<=record.revision){patchFollow(record.localSemesterId,{error:'',lastSyncedAt:new Date().toISOString(),expiresAt:remote.expiresAt});return;}
    const remapped=remapSharedSemester(remote.semester,record.map),pending={incoming:remapped.semester,map:remapped.map,revision:Number(remote.revision),expiresAt:remote.expiresAt};
    const merged=mergeFollowedSemester(local,record.baseline,pending.incoming);
    const canApply=manual?!document.hidden&&currentView()===manualView:ctx.canSync?.();
    if(merged.needsReview||!canApply){const isNew=record.pending?.revision!==pending.revision;patchFollow(record.localSemesterId,{pending,error:`版本 ${pending.revision} 有变化需要核对`});if(isNew)toast('分享课表有更新，请在“我跟随的课表”中核对');}
    else applyFollow(record,merged.semester,pending);
  }
  function ownerPayload(record,allowFollow=record.allowFollow){
    const local=findLocal(record.localSemesterId);if(!local)throw Error('分享对应的本地学期已删除，可在分享管理中撤销口令');
    const payload=api.sharePayload(local,{includeNotes:record.includeNotes===true,includeExams:record.includeExams===true});
    delete payload.expiresInDays;return {...payload,allowFollow};
  }
  async function publish(record,payload,expectedRevision){
    const remote=await api.request(record.server,'update',{...payload,code:record.code,deleteToken:record.deleteToken,expectedRevision});
    const allowed=payload.allowFollow===true&&remote.allowFollow===true;
    patchOwner(record,{name:payload.semester.name,revision:remote.revision,allowFollow:allowed,autoPublish:allowed,lastFingerprint:stable(payload.semester),lastPublishedAt:new Date().toISOString(),expiresAt:remote.expiresAt,error:''});
  }
  async function checkOwner(record){
    if(!record.allowFollow||record.autoPublish===false||!record.localSemesterId||!findLocal(record.localSemesterId))return;
    const payload=ownerPayload(record);if(stable(payload.semester)===record.lastFingerprint)return;
    try{await publish(record,payload,record.revision||1);}
    catch(error){
      if(error.status===409){const remote=await api.request(record.server,'get',{code:record.code});if(stable(remote.semester)===stable(payload.semester)&&remote.allowFollow===payload.allowFollow){patchOwner(record,{revision:remote.revision,lastFingerprint:stable(payload.semester),lastPublishedAt:new Date().toISOString(),expiresAt:remote.expiresAt,error:''});return;}throw Error('云端已有另一份修改，请在分享管理中核对后重新发布');}
      throw error;
    }
  }
  async function sync(manual=false,manualView=currentView()){
    if(running||(!manual&&!ctx.canSync?.()))return;
    const pull=manual||Date.now()-lastCheck>=300000;
    if(!pull&&!ownersDirty)return;
    if(pull)lastCheck=Date.now();ownersDirty=false;running=true;
    try{
      for(const record of api.records())try{await checkOwner(record);}catch(e){patchOwner(record,{error:e.message});}
      if(pull)for(const record of list())try{await checkFollower(record,manual,manualView);}catch(e){patchFollow(record.localSemesterId,{error:e.status===404?'分享已到期、撤销或不可用，本地课表保留':e.message});}
      if(manual)toast('已完成检查，结果见同步状态');
    }finally{running=false;}
  }
  function schedule(){ownersDirty=true;clearTimeout(timer);timer=setTimeout(()=>{sync(false).catch(()=>{});},1500);}
  function foreground(){if(Date.now()-lastForeground>=15000){lastCheck=0;lastForeground=Date.now();}schedule();}
  setInterval(()=>{sync(false).catch(()=>{});},60000);
  async function ownerPreview(el,toggle){
    const view=currentView();
    const record=api.records().find(r=>r.code===el.dataset.code&&r.server===el.dataset.server);if(!record)throw Error('没有此分享的管理凭证');
    const remote=await api.request(record.server,'get',{code:record.code});
    if(currentView()!==view)return;
    // A server response cannot grant local permission to upload future changes.
    const allowFollow=toggle?!record.allowFollow:record.allowFollow===true&&remote.allowFollow===true;
    const payload=ownerPayload(record,allowFollow);if(toggle&&allowFollow)payload.expiresInDays=180;
    ownerDraft={record,payload,expectedRevision:remote.revision};
    sheet(toggle?(allowFollow?'允许朋友持续跟随？':'暂停分享更新？'):'发布最新课表？',`<p class="helper-box">${esc(payload.semester.name)}<br>${allowFollow?'允许导入者选择跟随，之后本机修改会在 App 前台联网时自动发布。':'关闭持续跟随；已经导入的本地副本保留。'}${toggle&&allowFollow?'<br>本次将有效期续至 180 天。':''}<br>本次会将当前本机课表发布到云端。</p><p class="source-note">${payload.semester.courses.length} 门课程 · ${payload.semester.exams.length} 场考试；备注${payload.includeNotes?'包含':'不包含'}。云端当前版本 ${remote.revision}。</p><div class="sheet-actions">${button('share-manage','返回')}${button('owner-publish-confirm','确认发布','primary')}</div>`);
  }
  async function click(action,el){
    if(!['follow-list','follow-check','follow-toggle','follow-remove','follow-remove-confirm','follow-review','follow-merge','follow-replace-preview','follow-replace-confirm','owner-publish-now','owner-toggle-follow','owner-publish-confirm'].includes(action))return false;
    if(running&&action!=='follow-list')throw Error('正在同步，请稍候');
    const id=el.dataset.id;
    if(action==='follow-list')showList();
    if(action==='follow-check'){const view=currentView();el.disabled=true;try{await sync(true,view);if(currentView()===view)showList();}finally{el.disabled=false;}}
    if(action==='follow-toggle'){const r=list().find(r=>r.localSemesterId===id);if(r){patchFollow(id,{enabled:!r.enabled});showList();if(!r.enabled){lastCheck=0;schedule();}}}
    if(action==='follow-remove'){sheet('解除跟随？',`<p class="helper-box">本地课表保留，以后不再检查这个分享的更新。</p><div class="sheet-actions">${button('follow-list','返回')}${button('follow-remove-confirm','确认解除','danger',`data-id="${esc(id)}"`)}</div>`);}
    if(action==='follow-remove-confirm'){store(list().filter(r=>r.localSemesterId!==id));showList();}
    if(action==='follow-review')pendingReview(id);
    if(action==='follow-merge'){
      const r=list().find(r=>r.localSemesterId===id);if(!r?.pending)throw Error('更新已变化，请重新检查');const merged=mergeFollowedSemester(findLocal(id),r.baseline,r.pending.incoming);if(merged.validationError)throw Error(merged.validationError);applyFollow(r,merged.semester,r.pending);showList();toast('更新已合并，保留你的修改');
    }
    if(action==='follow-replace-preview'){sheet('替换这个学期？',`<p class="helper-box warning-box">将使用分享者的版本替换这个学期。你在本地添加的课程、考试及修改也会被替换；操作前自动保留恢复版本。</p><div class="sheet-actions">${button('follow-review','返回核对','secondary',`data-id="${esc(id)}"`)}${button('follow-replace-confirm','确认替换','danger',`data-id="${esc(id)}"`)}</div>`);}
    if(action==='follow-replace-confirm'){const r=list().find(r=>r.localSemesterId===id);if(!r?.pending)throw Error('没有待应用的更新');applyFollow(r,clone(r.pending.incoming),r.pending);showList();}
    if(action==='owner-publish-now'||action==='owner-toggle-follow'){el.disabled=true;try{await ownerPreview(el,action==='owner-toggle-follow');}finally{el.disabled=false;}}
    if(action==='owner-publish-confirm'){if(!ownerDraft)throw Error('请重新确认发布内容');const view=currentView(),draft=ownerDraft;el.disabled=true;try{await publish(draft.record,draft.payload,draft.expectedRevision);if(ownerDraft===draft)ownerDraft=null;if(currentView()===view)api.showOwners();toast('分享已更新');}finally{el.disabled=false;}}
    return true;
  }
  return {prepare,subscribe,click,schedule,foreground,sync,initialFingerprint:stable,list};
}
