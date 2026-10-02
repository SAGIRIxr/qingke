import test from 'node:test';
import assert from 'node:assert/strict';
import {createShareEntry} from '../www/share-entry.js';
const entry={code:'0123456789ABCDEFGHJK',server:'https://share.example',source:'clipboard'};
function fixture(t,{enabled=true,own=false}={}){
 const old=new Map(['window','document','Android','MutationObserver'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const queue=[],opened=[],root={firstChild:null},toast={textContent:'',classList:{add(){},remove(){}}};let consumes=0;
 const bridge={consumeShareLink(){consumes++;return queue.length?JSON.stringify(queue.shift()):'';},getShareEntrySettings(){return JSON.stringify({clipboardEnabled:enabled});}};
 globalThis.Android=bridge;globalThis.window={Android:bridge};globalThis.document={hidden:false,querySelector:s=>s==='#modal-root'?root:s==='#toast'?toast:null};
 t.mock.method(globalThis,'setTimeout',()=>0);t.mock.method(globalThis,'clearTimeout',()=>{});
 const manager=createShareEntry({isOwnShare:()=>typeof own==='function'?own():own,openShare:value=>{opened.push(value);root.firstChild={view:'confirmation'};}});
 t.after(()=>{for(const[k,v]of old)v?Object.defineProperty(globalThis,k,v):delete globalThis[k];});
 return {manager,queue,opened,root,get consumes(){return consumes;},async tick(){await new Promise(r=>queueMicrotask(r));}};
}
test('编辑时不取走原生待导入记录，关闭后才提示；不覆盖草稿或自动联网',async t=>{
 const e=fixture(t);e.root.firstChild={draft:'未保存'};const draft=e.root.firstChild;e.queue.push(entry);
 window.onShareLinkAvailable();await e.tick();assert.equal(e.consumes,0);assert.equal(e.root.firstChild,draft);assert.equal(e.opened.length,0);
 e.root.firstChild=null;e.manager.foreground();await e.tick();assert.deepEqual(e.opened,[entry]);assert.equal(e.queue.length,0);
});
test('后台收到链接不弹窗，回前台才显示并逐个消费',async t=>{
 const e=fixture(t);e.queue.push({...entry,source:'link'},entry);document.hidden=true;
 window.onShareLinkAvailable();await e.tick();assert.equal(e.consumes,0);
 document.hidden=false;e.manager.foreground();await e.tick();assert.equal(e.opened.length,1);assert.equal(e.queue.length,1);
 e.manager.foreground();await e.tick();assert.equal(e.opened.length,1);
});
test('关闭剪贴板识别后丢弃迟到剪贴板提示，明确点击的链接仍可打开',async t=>{
 const e=fixture(t,{enabled:false});e.queue.push(entry,{...entry,source:'link'});e.manager.foreground();await e.tick();
 assert.deepEqual(e.opened,[{...entry,source:'link'}]);
});
test('复制自己创建的分享不提示导入，显式链接不受此限制',async t=>{
 const e=fixture(t,{own:true});e.queue.push(entry,{...entry,source:'link'});e.manager.foreground();await e.tick();assert.deepEqual(e.opened,[{...entry,source:'link'}]);
});
test('本人分享管理记录损坏时仍显示外部分享确认，不吞掉已取出的口令',async t=>{
 const e=fixture(t,{own(){throw Error('Storage unavailable');}});e.queue.push(entry);e.manager.foreground();await e.tick();assert.deepEqual(e.opened,[entry]);
});
