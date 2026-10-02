import {occurrenceStatus} from './engine.js';

/** Whole-lesson progress counts teaching time only; it pauses during a real break. */
export function courseLive(occurrence,now=Date.now()){
  const status=occurrenceStatus(occurrence,now),active=status.phase==='class'||status.phase==='break';
  const total=occurrence.breakMode==='continuous'?occurrence.endMs-occurrence.startMs:occurrence.segments.reduce((sum,p)=>sum+p.endMs-p.startMs,0);
  const progress=Math.max(0,Math.min(100,total?status.elapsedTeachingMs/total*100:0));
  const label=status.phase==='break'?'课间休息':occurrence.kind==='exam'?'考试中':'上课中';
  const target=status.phase==='break'?'继续上课':status.nextBoundaryMs<occurrence.endMs?'课间':occurrence.kind==='exam'?'结束':'下课';
  return {active,phase:status.phase,progress,label,detail:active?`${label} · 距${target} ${Math.max(1,Math.ceil(status.remainingMs/60000))} 分钟`:'',aria:`${label}，授课进度 ${Math.round(progress)}%`};
}

/** Choose an explicit reference date so mixed summer/winter weeks still have a time axis. */
export function axisDate(dates,today){return dates.includes(today)?today:dates[0];}
