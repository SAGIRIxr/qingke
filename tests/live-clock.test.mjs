import test from 'node:test';
import assert from 'node:assert/strict';
import {courseRefreshDelay,createLiveClock} from '../www/live-clock.js';

test('空闲按分钟检查，临近30分钟和上课边界准点刷新，进行中保留秒级进度',()=>{
  const now=Date.now(),event={startMs:now+30*60000+1234,endMs:now+90*60000};
  assert.equal(courseRefreshDelay([],now),60000);
  assert.equal(courseRefreshDelay([event],now),1234);
  assert.equal(courseRefreshDelay([event],event.startMs-100),100);
  assert.equal(courseRefreshDelay([event],event.startMs),1000);
  assert.equal(courseRefreshDelay([event],event.endMs),60000);
});

test('后台和设置编辑页停止课程计时，回前台/关闭弹窗恢复，文本更新不重复刷新',()=>{
  const timers=new Map(),listeners=new Map();let seq=0,observer,refreshes=0,showCards=true;
  const document={hidden:false,addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k)};
  const view={setTimeout:(fn,ms)=>{timers.set(++seq,{fn,ms});return seq;},clearTimeout:id=>timers.delete(id),
    addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k),
    MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){}}};
  const root={querySelectorAll:()=>showCards?[{dataset:{liveId:'course'}}]:[]};
  const clock=createLiveClock({document,view,roots:[root],selectRoot:()=>root,occurrences:()=>new Map([['course',{startMs:Date.now()-60000,endMs:Date.now()+60000}]]),refresh:()=>refreshes++});
  clock.wake();assert.equal(timers.size,1);assert.equal(refreshes,1);
  observer([{addedNodes:[{nodeType:3}],removedNodes:[]}]);assert.equal(refreshes,1);
  document.hidden=true;listeners.get('visibilitychange')();assert.equal(timers.size,0);
  document.hidden=false;listeners.get('visibilitychange')();assert.equal(refreshes,2);assert.equal(timers.size,1);
  showCards=false;observer([{addedNodes:[{nodeType:1}],removedNodes:[]}]);assert.equal(timers.size,0);
  showCards=true;observer([{addedNodes:[],removedNodes:[{nodeType:1}]}]);assert.equal(timers.size,1);
  listeners.get('resize')();assert.equal(timers.size,1);
  clock.dispose();assert.equal(timers.size,0);
});

test('全折叠冲突组尚无当前课子卡时，仍按成员时间进入即将/上课刷新',()=>{
  let delay=0,refreshes=0;const now=Date.now();
  const document={hidden:false,addEventListener(){},removeEventListener(){}};
  const view={setTimeout:(fn,ms)=>{delay=ms;return 1;},clearTimeout(){},addEventListener(){},removeEventListener(){},MutationObserver:class{observe(){}disconnect(){}}};
  const root={querySelectorAll:()=>[{dataset:{conflictIds:'["future","running"]'}}]};
  const events=new Map([['future',{startMs:now+31*60000,endMs:now+60*60000}],['running',{startMs:now-60000,endMs:now+60000}]]);
  const clock=createLiveClock({document,view,roots:[root],selectRoot:()=>root,occurrences:()=>events,refresh:()=>refreshes++});
  clock.wake();assert.equal(refreshes,1);assert.equal(delay,1000);
  events.delete('running');clock.wake();assert.ok(delay>58000&&delay<=60000);
  clock.dispose();
});
