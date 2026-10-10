import test from 'node:test';
import assert from 'node:assert/strict';
import {courseLive,axisDate,nextOccurrenceIds} from '../www/course-live.js';
import {makeSemester,notificationEvents} from '../www/engine.js';
const sample={startMs:0,endMs:100*60000,kind:'course',breakMode:'normal',segments:[{period:1,startMs:0,endMs:45*60000},{period:2,startMs:55*60000,endMs:100*60000}]};
test('课程进度扣除课间，并在休息期间冻结，开始结束边界不误标当前课',()=>{
  assert.equal(courseLive(sample,-1).active,false);
  assert.equal(courseLive(sample,0).active,true);
  assert.equal(courseLive(sample,45*60000).progress,50);
  assert.equal(courseLive(sample,50*60000).progress,50);
  assert.equal(courseLive(sample,50*60000).phase,'break');
  assert.equal(courseLive(sample,55*60000).phase,'class');
  assert.equal(courseLive(sample,100*60000).active,false);
  assert.equal(courseLive(sample,200*60000).progress,100);
});
test('连上课使用连续进度，独立考试保持考试文案',()=>{
  assert.equal(courseLive({...sample,breakMode:'continuous'},50*60000).progress,50);
  assert.equal(courseLive({...sample,breakMode:'continuous'},50*60000).phase,'class');
  assert.match(courseLive({...sample,kind:'exam',breakMode:'continuous'},50*60000).detail,/考试中.*结束/);
});
test('混合作息时间轴优先展示可见今天，否则明确采用第一天',()=>{
  const dates=['2026-09-30','2026-10-01','2026-10-02'];
  assert.equal(axisDate(dates,'2026-10-02'),'2026-10-02');
  assert.equal(axisDate(dates,'2026-10-03'),'2026-09-30');
});

const at=(date,time)=>new Date(`${date}T${time}:00`).getTime();
const arrangement=(id,date,start,end)=>({...sample,id,date,startMs:at(date,start),endMs:at(date,end),segments:[{period:1,start,end,startMs:at(date,start),endMs:at(date,end)}]});

test('当天仅在开始前30分钟内标记，材料力学中午不标、15:40开始标、16:10清标',()=>{
  const materials=arrangement('materials','2026-10-09','16:10','17:00'),events=[materials];
  for(const now of [at(materials.date,'12:00'),materials.startMs-30*60000-1])assert.deepEqual([...nextOccurrenceIds(events,now)],[]);
  for(const now of [at(materials.date,'15:40'),materials.startMs-1]){
    const ids=nextOccurrenceIds(events,new Date(now));
    assert.deepEqual([...ids],['materials']);
    assert.equal(courseLive(materials,now,ids).upcoming,true);
  }
  for(const now of [materials.startMs,materials.endMs,at('2026-10-10','15:40')]){
    const ids=nextOccurrenceIds(events,now);
    assert.deepEqual([...ids],[]);
    assert.equal(courseLive(materials,now,ids).upcoming,false);
  }
  assert.equal(courseLive(materials,materials.startMs,new Set(['materials'])).upcoming,false);
});

test('只标最早未来安排，同刻冲突全标，正在上课不会阻止下一安排',()=>{
  const date='2026-10-09',events=[arrangement('later',date,'16:00','17:00'),arrangement('next-b',date,'15:50','16:40'),arrangement('ongoing',date,'15:00','16:30'),arrangement('next-a',date,'15:50','16:20')];
  assert.deepEqual([...nextOccurrenceIds(events,at(date,'15:40'))].sort(),['next-a','next-b']);
  assert.deepEqual([...nextOccurrenceIds(events,at(date,'15:50'))],['later']);
  assert.deepEqual([...nextOccurrenceIds(events,at(date,'16:00'))],[]);
  assert.deepEqual([...nextOccurrenceIds(events,at(date,'17:00'))],[]);
});

test('第六节结束后的课间会标记第七节，整堂课内部休息也不抑制后续安排',()=>{
  const date='2026-10-09',sixth=arrangement('sixth',date,'15:15','16:00'),seventh=arrangement('seventh',date,'16:10','16:55');
  assert.deepEqual([...nextOccurrenceIds([sixth,seventh],at(date,'15:40'))],['seventh']);
  assert.deepEqual([...nextOccurrenceIds([sixth,seventh],at(date,'16:05'))],['seventh']);
  const overlapping={...arrangement('overlapping',date,'15:00','16:40'),segments:[
    {period:5,startMs:at(date,'15:00'),endMs:at(date,'15:45')},
    {period:6,startMs:at(date,'15:55'),endMs:at(date,'16:40')}
  ]};
  const now=at(date,'15:50'),ids=nextOccurrenceIds([overlapping,seventh],now);
  assert.equal(courseLive(overlapping,now,ids).phase,'break');
  assert.deepEqual([...ids],['seventh']);
  assert.equal(courseLive(seventh,now,ids).upcoming,true);
});

test('按本地民用日期判断当天，即使距离开始不足30分钟也不提前标记明日课程',()=>{
  const tomorrow=arrangement('tomorrow','2026-10-10','00:10','00:55');
  assert.deepEqual([...nextOccurrenceIds([tomorrow],at('2026-10-09','23:50'))],[]);
  assert.deepEqual([...nextOccurrenceIds([tomorrow],at('2026-10-10','00:00'))],['tomorrow']);
  const late=arrangement('late','2026-10-09','23:50','23:59');
  assert.deepEqual([...nextOccurrenceIds([late,tomorrow],at('2026-10-09','23:30'))],['late']);
});

test('调课按实际日期和时间进入30分钟窗口，停课、取消及原调出日期不入选',()=>{
  const s=makeSemester({name:'合成下一安排',startDate:'2026-09-07',totalWeeks:3});
  const course=(id,day)=>({id,name:id,shortName:'',color:0,assessment:'未设置',nature:'',note:'',sessions:[{id:`${id}-session`,day,startPeriod:1,endPeriod:2,weeks:[1,2,3],teacher:'',location:'A101',breakMode:'normal'}]});
  s.courses=[course('monday',1),course('tuesday',2)];
  s.dayRules=[{id:'off',type:'off',date:'2026-09-07',label:''}];
  s.exceptions=[{id:'cancel',type:'cancel',sessionId:'tuesday-session',sourceDate:'2026-09-08'},{id:'move',type:'move',sessionId:'tuesday-session',sourceDate:'2026-09-15',date:'2026-09-13',startPeriod:3,endPeriod:4,location:'B202'}];
  const events=notificationEvents(s);
  for(const [date,time] of [['2026-09-07','07:30'],['2026-09-08','07:30'],['2026-09-13','09:29'],['2026-09-15','07:30']])assert.deepEqual([...nextOccurrenceIds(events,at(date,time))],[]);
  const now=at('2026-09-13','09:30'),next=nextOccurrenceIds(events,now);
  assert.deepEqual([...next],['tuesday-session@2026-09-15']);
  const moved=events.find(o=>next.has(o.id));assert.equal(moved.date,'2026-09-13');assert.equal(moved.location,'B202');
  assert.equal(courseLive(moved,now,next).upcoming,true);assert.match(courseLive(moved,now,next).detail,/即将上课.*2026-09-13/);
  assert.equal(courseLive(events.find(o=>o.id==='monday-session@2026-09-14'),now,next).upcoming,false);
  assert.equal(courseLive(moved,moved.startMs,next).upcoming,false);
});

test('独立考试也仅提前30分钟标记，考试进行中可标下一安排',()=>{
  const s=makeSemester({name:'合成考试',startDate:'2026-09-07',totalWeeks:1});
  s.exams=[{id:'exam',name:'独立考试',date:'2026-09-07',startTime:'08:30',endTime:'10:00',location:'考场',note:''},{id:'next-exam',name:'另一考试',date:'2026-09-07',startTime:'09:50',endTime:'11:00',location:'考场2',note:''}];
  const events=notificationEvents(s),now=new Date(2026,8,7,8).getTime(),next=nextOccurrenceIds(events,now);
  assert.deepEqual([...next],['exam:exam']);assert.equal(courseLive(events[0],now,next).label,'即将考试');
  assert.deepEqual([...nextOccurrenceIds(events,now-1)],[]);
  assert.deepEqual([...nextOccurrenceIds(events,events[0].startMs)],[]);
  assert.deepEqual([...nextOccurrenceIds(events,at('2026-09-07','09:20'))],['exam:next-exam']);
});
