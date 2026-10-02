import test from 'node:test';
import assert from 'node:assert/strict';
import {installTimetableMotion} from '../www/motion.js';

function setup({reduced=false, navigate=()=>true}={}) {
  let time=0, frameId=0;
  const frames=new Map(), listeners=new Map();
  const makeNode=()=>({style:{transform:'',opacity:'',transition:'',willChange:''},isConnected:true,
    getBoundingClientRect:()=>({width:360}),animations:[],animate(keyframes,options){
      const animation={keyframes,options,cancel(){this.oncancel?.();}};this.animations.push(animation);return animation;
    }});
  const root={current:makeNode(),page:makeNode(),ownerDocument:{defaultView:{innerWidth:390,
    performance:{now:()=>time},matchMedia:()=>({matches:reduced,addEventListener(){},removeEventListener(){}}),
    requestAnimationFrame(fn){frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id)}},
    querySelector:selector=>selector==='.table-shell'?root.current:root.page,contains:node=>node===root.current,
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};
  const directions=[];
  const motion=installTimetableMotion({root,onNavigate:delta=>{directions.push(delta);return navigate(delta,root,makeNode);}});
  function touch(name,x,y,{after=0,outside=false,count=1}={}) {
    time+=after;
    const point={identifier:1,clientX:x,clientY:y};
    const event={target:{closest:selector=>selector==='.table-shell'&&!outside?root.current:null},cancelable:true,
      touches:name==='touchend'?[]:Array.from({length:count},(_,index)=>({...point,identifier:index+1})),
      changedTouches:[point],prevented:false,preventDefault(){this.prevented=true;}};
    listeners.get(name)?.(event);
    return event;
  }
  const flush=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());};
  return {root,motion,directions,touch,flush,advance:amount=>{time+=amount;},listeners};
}

test('vertical intent keeps native scrolling and never changes week',()=>{
  const f=setup();f.touch('touchstart',200,100);
  assert.equal(f.touch('touchmove',203,130,{after:30}).prevented,false);
  assert.equal(f.touch('touchmove',70,140,{after:30}).prevented,false);
  f.touch('touchend',70,140);assert.deepEqual(f.directions,[]);assert.equal(f.motion.suppressClick(),false);
});
test('horizontal drag follows finger and commits next week with click suppression',()=>{
  const f=setup({navigate:(_,root,makeNode)=>{root.current.isConnected=false;root.current=makeNode();return true;}});
  f.touch('touchstart',260,100);assert.equal(f.touch('touchmove',120,104,{after:100}).prevented,true);f.flush();
  assert.match(f.root.current.style.transform,/translate3d\(-/);
  f.touch('touchend',120,104);assert.deepEqual(f.directions,[1]);assert.equal(f.motion.suppressClick(),true);
  assert.equal(f.root.current.animations.length,1);assert.equal(f.root.current.animations[0].options.duration,220);
  f.advance(421);assert.equal(f.motion.suppressClick(),false);
});
test('right swipe requests previous week',()=>{
  const f=setup();f.touch('touchstart',90,100);f.touch('touchmove',220,102,{after:120});f.touch('touchend',220,102);
  assert.deepEqual(f.directions,[-1]);
});
test('short slow drag snaps back without navigation or accidental course click',()=>{
  const f=setup();f.touch('touchstart',200,100);f.touch('touchmove',178,102,{after:300});f.flush();f.touch('touchend',178,102,{after:300});
  assert.deepEqual(f.directions,[]);assert.equal(f.motion.suppressClick(),true);
  assert.equal(f.root.current.animations.length,1);f.root.current.animations[0].onfinish();assert.equal(f.root.current.style.transform,'');
});
test('first/last week refusal springs back and repeated drag has stronger resistance',()=>{
  const f=setup({navigate:()=>false});f.touch('touchstart',260,100);f.touch('touchmove',120,100,{after:100});f.flush();
  const first=Math.abs(parseFloat(f.root.current.style.transform.slice(12)));
  f.touch('touchend',120,100);f.root.current.animations.at(-1).onfinish();
  f.touch('touchstart',260,100,{after:500});f.touch('touchmove',120,100,{after:100});f.flush();
  const second=Math.abs(parseFloat(f.root.current.style.transform.slice(12)));
  assert.ok(second<first);f.touch('touchcancel',120,100);assert.equal(f.root.current.style.transform,'');
});
test('canceled and multi-touch gestures do not navigate',()=>{
  const f=setup();f.touch('touchstart',260,100);f.touch('touchmove',100,100,{after:60});f.touch('touchcancel',100,100);
  f.touch('touchstart',260,100);f.touch('touchmove',100,100,{after:60,count:2});f.touch('touchend',100,100);
  assert.deepEqual(f.directions,[]);
});
test('reduced-motion supports swipe navigation without transitions',()=>{
  const f=setup({reduced:true});f.motion.animatePage(1);f.motion.animateTab();
  f.touch('touchstart',260,100);f.touch('touchmove',100,100,{after:60});f.flush();f.touch('touchend',100,100);
  assert.deepEqual(f.directions,[1]);assert.equal(f.root.current.animations.length,0);assert.equal(f.root.page.animations.length,0);
});
test('outside grid and system screen-edge gestures are untouched',()=>{
  const f=setup();f.touch('touchstart',260,100,{outside:true});f.touch('touchmove',100,100,{outside:true});f.touch('touchend',100,100);
  f.touch('touchstart',10,100);f.touch('touchmove',150,100);f.touch('touchend',150,100);
  assert.deepEqual(f.directions,[]);assert.equal(f.motion.suppressClick(),false);
});
test('parent-triggered page animation is not duplicated',()=>{
  let motion;
  const f=setup({navigate:(_,root,makeNode)=>{root.current=makeNode();motion.animatePage(1);return true;}});motion=f.motion;
  f.touch('touchstart',260,100);f.touch('touchmove',100,100,{after:60});f.touch('touchend',100,100);
  assert.equal(f.root.current.animations.length,1);
});
