import {localDate,occurrenceStatus} from './engine.js';

export const UPCOMING_WINDOW_MS=30*60000;

/** Whole-lesson progress counts teaching time only; it pauses during a real break. */
export function courseLive(occurrence,now=Date.now(),nextIds=new Set()){
  const status=occurrenceStatus(occurrence,now),active=status.phase==='class'||status.phase==='break';
  const upcoming=status.phase==='before'&&nextIds.has(occurrence.id);
  const total=occurrence.breakMode==='continuous'?occurrence.endMs-occurrence.startMs:occurrence.segments.reduce((sum,p)=>sum+p.endMs-p.startMs,0);
  const progress=Math.max(0,Math.min(100,total?status.elapsedTeachingMs/total*100:0));
  const label=upcoming?(occurrence.kind==='exam'?'即将考试':'即将上课'):status.phase==='break'?'课间休息':occurrence.kind==='exam'?'考试中':'上课中';
  const target=status.phase==='break'?'继续上课':status.nextBoundaryMs<occurrence.endMs?'课间':occurrence.kind==='exam'?'结束':'下课';
  const detail=upcoming?`${label} · ${occurrence.date||''} ${occurrence.segments[0].start||''}`.trim():active?`${label} · 距${target} ${Math.max(1,Math.ceil(status.remainingMs/60000))} 分钟`:'';
  return {active,upcoming,phase:status.phase,progress,label,detail,aria:upcoming?detail:`${label}，授课进度 ${Math.round(progress)}%`};
}

/** Highlight the next actual arrangement today, only within 30 minutes of its start.
 * An ongoing lesson or break does not suppress it. Equal next starts all remain visible.
 */
export function nextOccurrenceIds(occurrences,now=Date.now()){
  const ms=now instanceof Date?now.getTime():Number(now);
  if(!Number.isFinite(ms))throw Error('课程状态时间无效');
  const today=localDate(new Date(ms));
  let nextStart=Infinity;
  const ids=new Set();
  for(const item of occurrences){
    if(!Number.isFinite(item.startMs)||!Number.isFinite(item.endMs)||item.endMs<=item.startMs||item.startMs<=ms||item.startMs-ms>UPCOMING_WINDOW_MS)continue;
    if(localDate(new Date(item.startMs))!==today)continue;
    if(item.startMs<nextStart){nextStart=item.startMs;ids.clear();}
    if(item.startMs===nextStart)ids.add(item.id);
  }
  return ids;
}

/** Choose an explicit reference date so mixed summer/winter weeks still have a time axis. */
export function axisDate(dates,today){return dates.includes(today)?today:dates[0];}
