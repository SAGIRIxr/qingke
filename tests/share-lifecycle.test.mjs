import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../www/engine.js';
import {createFollowManager} from '../www/share-follow.js';
import {createShareUI,sharePayload} from '../www/share-ui.js';

const CODE='0123456789ABCDEFGHJK',SERVER='https://share.example';
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function environment(t){
  const previous=new Map(['document','window','localStorage'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const data=new Map(),modal={firstChild:null,_html:'',querySelector:()=>({focus(){}}),get innerHTML(){return this._html;},set innerHTML(value){this._html=value;this.firstChild=value?{html:value}:null;}};
  const toast={textContent:'',classList:{add(){},remove(){}}};
  globalThis.document={hidden:false,body:{style:{}},querySelector:selector=>selector==='#modal-root'?modal:selector==='#toast'?toast:null};
  globalThis.window={};globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  t.mock.method(globalThis,'setInterval',()=>0);t.mock.method(globalThis,'setTimeout',()=>0);t.mock.method(globalThis,'clearTimeout',()=>{});
  t.after(()=>{for(const [key,value]of previous)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
  let state=createState(),saved=0;
  state.preferences.shareServerUrl=SERVER;
  const ctx={getState:()=>state,save:next=>{state=next;saved++;return true;},canSync:()=>!document.hidden&&!modal.firstChild,onSynced(){},refresh(){}};
  return {modal,data,ctx,get state(){return state;},set state(value){state=value;},get saved(){return saved;}};
}
function remote(semester,revision=1,allowFollow=true){return {...sharePayload(semester),allowFollow,revision,expiresAt:'2099-01-01T00:00:00Z'};}
function owner(env,allowFollow=true){return {code:CODE,server:SERVER,deleteToken:'valid-management-token-1234',localSemesterId:env.state.semesters[0].id,name:'共享学期',allowFollow,autoPublish:allowFollow,revision:1,includeNotes:false,includeExams:false,createdAt:'2026-01-01T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z'};}
const button=dataset=>({dataset,disabled:false});

test('外部链接只展示确认表单，不请求网络、不改变默认服务或现有学期',t=>{
 const env=environment(t);let network=0;t.mock.method(globalThis,'fetch',()=>{network++;throw Error('Must not fetch before confirmation');});
 const ui=createShareUI(env.ctx);ui.openShare({code:'0123456789ABCDEFGHJK',server:'https://friend.example',source:'clipboard'});
 assert.match(env.modal.innerHTML,/发现剪贴板中的清课分享/);assert.match(env.modal.innerHTML,/https:\/\/friend.example/);
 assert.equal(network,0);assert.equal(env.saved,0);assert.equal(env.state.preferences.shareServerUrl,SERVER);
});

test('粘贴的整段消息指向不同服务时先核对来源，未确认不联网',async t=>{
 const env=environment(t);let network=0;t.mock.method(globalThis,'fetch',()=>{network++;throw Error('Must not fetch before source review');});
 const ui=createShareUI(env.ctx),{shareMessage}=await import('../www/share-links.js');
 await ui.submit({id:'share-receive-form'},{code:shareMessage({code:'0123456789ABCDEFGHJK',server:'https://friend.example'}),server:SERVER});
 assert.equal(network,0);assert.equal(env.saved,0);assert.match(env.modal.innerHTML,/https:\/\/friend.example/);
});

test('手动检查慢响应不能覆盖新编辑弹窗，也不直接修改正在编辑的学期',async t=>{
  const env=environment(t),waiting=defer(),source=env.state.semesters[0];
  const manager=createFollowManager(env.ctx,{records:()=>[],request:()=>waiting.promise});
  const draft=manager.prepare(remote(source),SERVER,CODE);env.state={...env.state,semesters:[draft.semester],activeSemesterId:draft.semester.id};manager.subscribe(draft);
  await manager.click('follow-list',button({}));
  const task=manager.click('follow-check',button({}));
  env.modal.innerHTML='课程编辑：尚未保存的草稿';const editor=env.modal.firstChild;
  waiting.resolve(remote({...source,name:'远端新名称'},2));await task;
  assert.equal(env.modal.firstChild,editor);assert.equal(env.saved,0);
  assert.equal(manager.list()[0].pending.revision,2);assert.equal(env.state.semesters[0].name,draft.semester.name);
});

test('手动检查仍停留原列表时可以合并无冲突更新',async t=>{
  const env=environment(t),source=env.state.semesters[0];
  const manager=createFollowManager(env.ctx,{records:()=>[],request:async()=>remote({...source,name:'远端新名称'},2)});
  const draft=manager.prepare(remote(source),SERVER,CODE);env.state={...env.state,semesters:[draft.semester],activeSemesterId:draft.semester.id};manager.subscribe(draft);
  await manager.click('follow-list',button({}));await manager.click('follow-check',button({}));
  assert.equal(env.saved,1);assert.equal(env.state.semesters[0].name,'远端新名称');assert.equal(manager.list()[0].revision,2);
});

test('读取分享预览时跳转编辑，旧响应不抢占弹窗或导入数据',async t=>{
  const env=environment(t),waiting=defer();t.mock.method(globalThis,'fetch',()=>waiting.promise);
  const ui=createShareUI(env.ctx);env.modal.innerHTML='输入分享口令';
  const task=ui.submit({id:'share-receive-form',querySelector:()=>button({})},{code:CODE});
  env.modal.innerHTML='编辑课程：私人草稿';const editor=env.modal.firstChild;
  waiting.resolve(new Response(JSON.stringify(remote(env.state.semesters[0]))));await task;
  assert.equal(env.modal.firstChild,editor);assert.equal(env.saved,0);
});

test('发布预览慢响应不能覆盖刚打开的课程编辑',async t=>{
  const env=environment(t),waiting=defer(),record=owner(env);
  const manager=createFollowManager(env.ctx,{records:()=>[record],request:()=>waiting.promise,sharePayload});env.modal.innerHTML='分享管理';
  const task=manager.click('owner-publish-now',button({code:CODE,server:SERVER}));
  env.modal.innerHTML='编辑课程：私人草稿';const editor=env.modal.firstChild;
  waiting.resolve(remote(env.state.semesters[0]));await task;
  assert.equal(env.modal.firstChild,editor);assert.equal(env.saved,0);
});

test('单次分享不能被服务器返回的 allowFollow=true 升级为自动上传',async t=>{
  const env=environment(t);t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({code:CODE,deleteToken:'valid-management-token-1234',expiresAt:'2099-01-01T00:00:00Z',revision:1,allowFollow:true})));
  const ui=createShareUI(env.ctx);await ui.submit({id:'share-create-form'},{semesterId:env.state.activeSemesterId,expiresInDays:7});
  await ui.click('share-publish',button({}));
  const record=JSON.parse(env.data.get('qingke.shares.v1'))[0];assert.equal(record.allowFollow,false);assert.equal(record.autoPublish,false);
});

test('已确认创建的请求离开弹窗后仍保存管理凭证，但不覆盖编辑草稿',async t=>{
  const env=environment(t),waiting=defer();t.mock.method(globalThis,'fetch',()=>waiting.promise);
  const ui=createShareUI(env.ctx);await ui.submit({id:'share-create-form'},{semesterId:env.state.activeSemesterId,expiresInDays:7,allowFollow:'on'});
  const task=ui.click('share-publish',button({}));
  // click awaits follow.click before invoking the network request.
  await Promise.resolve();env.modal.innerHTML='编辑课程：私人草稿';const editor=env.modal.firstChild;
  waiting.resolve(new Response(JSON.stringify({code:CODE,deleteToken:'valid-management-token-1234',expiresAt:'2099-01-01T00:00:00Z',revision:1,allowFollow:true})));await task;
  assert.equal(env.modal.firstChild,editor);assert.equal(JSON.parse(env.data.get('qingke.shares.v1'))[0].code,CODE);
});

test('关闭持续分享时，服务返回 true 也不能恢复本地自动发布',async t=>{
  const env=environment(t);let record=owner(env),sent;
  const manager=createFollowManager(env.ctx,{records:()=>[record],writeRecords:items=>record=items[0],sharePayload,showOwners(){},request:async(server,action,payload)=>{if(action==='update')sent=payload;return remote(env.state.semesters[0],action==='update'?2:1,true);}});
  env.modal.innerHTML='分享管理';await manager.click('owner-toggle-follow',button({code:CODE,server:SERVER}));await manager.click('owner-publish-confirm',button({}));
  assert.equal(sent.allowFollow,false);assert.equal(record.autoPublish,false);assert.equal(record.allowFollow,false);
});

test('课表保存失败时不前进跟随版本，不丢掉现有学期',async t=>{
  const env=environment(t),source=env.state.semesters[0];env.ctx.save=()=>false;
  const manager=createFollowManager(env.ctx,{records:()=>[],request:async()=>remote({...source,name:'远端新名称'},2)});
  const draft=manager.prepare(remote(source),SERVER,CODE);env.state={...env.state,semesters:[draft.semester],activeSemesterId:draft.semester.id};manager.subscribe(draft);
  await manager.sync();assert.equal(manager.list()[0].revision,1);assert.match(manager.list()[0].error,/保存失败/);assert.equal(env.state.semesters[0].name,draft.semester.name);
});

test('服务器关闭跟随或撤销分享时保留本地副本',async t=>{
  const env=environment(t),source=env.state.semesters[0];let revoked=false;
  const manager=createFollowManager(env.ctx,{records:()=>[],request:async()=>{if(revoked)throw Object.assign(Error('gone'),{status:404});return remote({...source,name:'不允许接收的新名称'},2,false);}});
  const draft=manager.prepare(remote(source),SERVER,CODE);env.state={...env.state,semesters:[draft.semester],activeSemesterId:draft.semester.id};manager.subscribe(draft);
  await manager.sync(true);assert.equal(env.saved,0);assert.match(manager.list()[0].error,/暂未允许/);
  revoked=true;await manager.sync(true);assert.equal(env.saved,0);assert.match(manager.list()[0].error,/撤销/);assert.equal(env.state.semesters[0].name,draft.semester.name);
});

test('所有者遇到不同远端版本时只记录冲突，不盲目重试覆盖',async t=>{
  const env=environment(t);let record=owner(env),updates=0;
  const manager=createFollowManager(env.ctx,{records:()=>[record],writeRecords:items=>record=items[0],sharePayload,request:async(server,action,payload)=>{if(action==='update'){updates++;assert.equal(payload.expectedRevision,1);throw Object.assign(Error('conflict'),{status:409});}return remote({...env.state.semesters[0],name:'另一设备修改'},2);}});
  await manager.sync();assert.equal(updates,1);assert.equal(record.revision,1);assert.match(record.error,/云端已有另一份修改/);assert.equal(env.saved,0);
});

test('创建慢请求合并最新管理记录，保留同时完成的发布版本',async t=>{
  const env=environment(t),waiting=defer(),existing=owner(env);existing.code='ABCDEFGHJK0123456789';env.data.set('qingke.shares.v1',JSON.stringify([existing]));t.mock.method(globalThis,'fetch',()=>waiting.promise);
  const ui=createShareUI(env.ctx);await ui.submit({id:'share-create-form'},{semesterId:env.state.activeSemesterId,expiresInDays:7});
  const task=ui.click('share-publish',button({}));await Promise.resolve();
  env.data.set('qingke.shares.v1',JSON.stringify([{...existing,revision:4,lastFingerprint:'completed-concurrent-publish'}]));
  waiting.resolve(new Response(JSON.stringify({code:CODE,deleteToken:'valid-management-token-1234',expiresAt:'2099-01-01T00:00:00Z',revision:1,allowFollow:false})));await task;
  const rows=JSON.parse(env.data.get('qingke.shares.v1'));assert.equal(rows.length,2);assert.equal(rows.find(r=>r.code===existing.code).revision,4);
});
