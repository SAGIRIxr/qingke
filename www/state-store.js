import { createState, migrateState, validateState, uid } from './engine.js';
export const STATE_KEY='qingke.data.v2';
const RECOVERY_KEY='qingke.recovery.v2';
export function recoveries(){return JSON.parse(localStorage.getItem(RECOVERY_KEY)||'[]');}
export function snapshot(raw,label,kind='change'){
  if(!raw)return;
  const list=recoveries();
  if(list[0]?.raw===raw&&list[0]?.kind===kind)return;
  const item={id:uid(),at:new Date().toISOString(),label,kind,raw};
  const next=[item,...list];
  const retained=[...next.filter(x=>x.kind==='upgrade').slice(0,1),...next.filter(x=>x.kind==='schema-upgrade').slice(0,1),...next.filter(x=>!['upgrade','schema-upgrade'].includes(x.kind)).slice(0,4)].sort((a,b)=>b.at.localeCompare(a.at));
  localStorage.setItem(RECOVERY_KEY,JSON.stringify(retained));
}
export function loadState(){
  const existing=localStorage.getItem(STATE_KEY);
  if(existing){
    const parsed=JSON.parse(existing),next=validateState(parsed);
    if(JSON.stringify(next)!==JSON.stringify(parsed)){
      snapshot(existing,'年度作息与考试支持升级前','schema-upgrade');
      localStorage.setItem(STATE_KEY,JSON.stringify(next));
    }
    return next;
  }
  const old=localStorage.getItem('qingke.data.v1');
  if(old){const next=migrateState(JSON.parse(old));snapshot(old,'升级前的第一版课表','upgrade');localStorage.setItem(STATE_KEY,JSON.stringify(next));return next;}
  return createState();
}
export function commitState(next,label=''){
  const checked=validateState(next);
  if(label)snapshot(localStorage.getItem(STATE_KEY),label);
  localStorage.setItem(STATE_KEY,JSON.stringify(checked));
  return checked;
}
