export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const clone=value=>JSON.parse(JSON.stringify(value));
const paths={plus:'M12 5v14M5 12h14',close:'m6 6 12 12M18 6 6 18',right:'m9 5 7 7-7 7',left:'m15 5-7 7 7 7',down:'m6 9 6 6 6-6',grid:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',sun:'M12 3v2M12 19v2M3 12h2M19 12h2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',settings:'M4 7h16M4 17h16M8 4v6M16 14v6',arrow:'M5 12h14m-5-5 5 5-5 5',leaf:'M6 18C0 5 11 2 20 4c1 11-6 17-14 14Zm0 0 8-8M6 18l-2 3',school:'m3 9 9-6 9 6M5 10v10h14V10M9 20v-6h6v6M10 9h4',clock:'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',pin:'M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',person:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',calendar:'M4 5h16v16H4zM8 3v4M16 3v4M4 10h16',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',upload:'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',check:'m5 12 4 4L19 6',note:'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5',bell:'M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10M10 21h4',trash:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',swap:'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4',file:'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6',undo:'M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14'};
export const icon=(name,size=20)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.note}"/></svg>`;
export const DAYS=['一','二','三','四','五','六','日'];
export const button=(action,text,cls='secondary',extra='')=>`<button type="button" class="${cls}" data-action="${action}" ${extra}>${text}</button>`;
export const select=(name,options,value)=>`<select name="${name}">${options.map(o=>{const [v,t]=Array.isArray(o)?o:[o,o];return `<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(t)}</option>`}).join('')}</select>`;
export const field=(label,html,hint='')=>`<label class="field"><span>${label}</span>${html}${hint?`<small>${hint}</small>`:''}</label>`;
export const input=(name,value='',type='text',attrs='')=>`<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}>`;
export function weeksText(weeks){const ranges=[];let first,last;for(const w of weeks){if(first==null){first=last=w;}else if(w===last+1)last=w;else{ranges.push(first===last?first:`${first}–${last}`);first=last=w;}}if(first!=null)ranges.push(first===last?first:`${first}–${last}`);return `第 ${ranges.join('、')} 周`;}
let timer;
export function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');clearTimeout(timer);timer=setTimeout(()=>el.classList.remove('show'),4500);}
const sheetStates=new WeakMap();
function sheetState(root){if(!sheetStates.has(root))sheetStates.set(root,{stack:[],current:null,lastFocus:null});return sheetStates.get(root);}
function captureSheet(root,state){return {node:root.firstChild,title:state.current?.title,scroll:root.querySelector('.sheet-body')?.scrollTop||0,focus:document.activeElement};}
export function sheet(title,content,{replace=false}={}){
  const root=document.querySelector('#modal-root'),state=sheetState(root);
  if(!root.firstChild||state.current?.node!==root.firstChild){state.stack=[];state.current=null;state.lastFocus=document.activeElement;}
  if(state.current&&state.current.title!==title&&!replace){
    const earlier=state.stack.findLastIndex(entry=>entry.title===title);
    if(earlier>=0)state.stack=state.stack.slice(0,earlier);
    else {state.stack.push(captureSheet(root,state));if(state.stack.length>20)state.stack.shift();}
  }
  root.innerHTML=`<div class="backdrop" data-backdrop><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="sheet-handle"></div><header class="sheet-head">${state.stack.length?button('sheet-back',icon('left',18),'sheet-back','aria-label="返回上一页"'):''}<h2 id="sheet-title">${esc(title)}</h2>${button('close',icon('close',18),'close-sheet','aria-label="关闭所有设置页面"')}</header><div class="sheet-body">${content}</div></section></div>`;
  state.current={node:root.firstChild,title};document.body.style.overflow='hidden';root.querySelector('.close-sheet').focus({preventScroll:true});
}
export function backSheet(){
  const root=document.querySelector('#modal-root');if(!root.firstChild)return false;
  const state=sheetState(root),previous=state.stack.pop();
  if(!previous){closeSheet();return true;}
  root.replaceChildren(previous.node);state.current={node:previous.node,title:previous.title};
  const body=root.querySelector('.sheet-body');if(body)body.scrollTop=previous.scroll;
  if(previous.focus?.isConnected)previous.focus.focus({preventScroll:true});else root.querySelector('.close-sheet')?.focus({preventScroll:true});
  return true;
}
export function closeSheet(){const root=document.querySelector('#modal-root'),state=sheetState(root);root.innerHTML='';state.stack=[];state.current=null;document.body.style.overflow='';if(state.lastFocus?.isConnected)state.lastFocus.focus({preventScroll:true});state.lastFocus=null;}
export const errorBox='<div class="error-message" id="form-error" role="alert"></div>';
export const submit=(label='保存')=>`${errorBox}<button class="primary full-width" type="submit">${icon('check',16)}${label}</button>`;
