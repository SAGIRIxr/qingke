import {UPCOMING_WINDOW_MS} from './course-live.js';

/** Seconds are useful only for a visible running progress bar. Idle cards need
 * updates at the next eligibility/start boundary, with a minute clock fallback. */
export function courseRefreshDelay(occurrences,now=Date.now()){
  let delay=60000;
  for(const item of occurrences){
    if(item.startMs<=now&&now<item.endMs)return 1000;
    for(const boundary of [item.startMs-UPCOMING_WINDOW_MS,item.startMs]){
      if(Number.isFinite(boundary)&&boundary>now)delay=Math.min(delay,boundary-now);
    }
  }
  return Math.max(50,delay);
}

/** No live-card timer while hidden or while a settings/editor sheet covers it. */
export function createLiveClock({document,view,roots,selectRoot,occurrences,refresh}){
  let timer=null,disposed=false;
  const stop=()=>{if(timer!==null){view.clearTimeout(timer);timer=null;}};
  function wake(){
    stop();
    if(disposed||document.hidden)return;
    const root=selectRoot(),cards=root?.querySelectorAll('[data-live-id],[data-conflict-ids]');
    if(!cards?.length)return;
    refresh(root);
    const ids=new Set(Array.from(cards,card=>card.dataset.liveId?[card.dataset.liveId]:JSON.parse(card.dataset.conflictIds||'[]')).flat());
    const source=occurrences(),items=Array.from(ids,id=>source.get(id)).filter(Boolean);
    timer=view.setTimeout(wake,courseRefreshDelay(items,Date.now()));
  }
  // Text/progress updates must not schedule a second refresh loop.
  const observer=new view.MutationObserver(records=>{
    if(records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1)))wake();
  });
  for(const root of roots)observer.observe(root,{childList:true,subtree:true});
  document.addEventListener('visibilitychange',wake);
  view.addEventListener('resize',wake);
  document.fonts?.addEventListener?.('loadingdone',wake);
  return {wake,dispose(){disposed=true;stop();observer.disconnect();document.removeEventListener('visibilitychange',wake);view.removeEventListener('resize',wake);document.fonts?.removeEventListener?.('loadingdone',wake);}};
}
