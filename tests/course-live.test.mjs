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

test('空闲时按实际开始时间挑选下一安排，同刻冲突全部保留，结束后不重复标记',()=>{
  const make=(id,startMs,endMs)=>({...sample,id,startMs,endMs}),events=[make('later',400,500),make('next-b',200,300),make('past',0,100),make('next-a',200,250)];
  assert.deepEqual([...nextOccurrenceIds(events,100)].sort(),['next-a','next-b']);
  assert.deepEqual([...nextOccurrenceIds(events,200)],[]);
  assert.deepEqual([...nextOccurrenceIds(events,299)],[]);
  assert.deepEqual([...nextOccurrenceIds(events,300)],['later']);
  assert.deepEqual([...nextOccurrenceIds(events,500)],[]);
});

test('课间仍突出正在上的整堂课，不给其他课程重复打即将上课标记',()=>{
  const next={...sample,id:'next',startMs:120*60000,endMs:180*60000};
  assert.deepEqual([...nextOccurrenceIds([{...sample,id:'lesson'},next],50*60000)],[]);
  assert.deepEqual([...nextOccurrenceIds([{...sample,id:'lesson'},next],100*60000)],['next']);
});

test('调课后的下一安排跨日跨周选择，停课和取消不入选，查看别周不会误标',()=>{
  const s=makeSemester({name:'合成下一安排',startDate:'2026-09-07',totalWeeks:3});
  const course=(id,day)=>({id,name:id,shortName:'',color:0,assessment:'未设置',nature:'',note:'',sessions:[{id:`${id}-session`,day,startPeriod:1,endPeriod:2,weeks:[1,2,3],teacher:'',location:'A101',breakMode:'normal'}]});
  s.courses=[course('monday',1),course('tuesday',2)];
  s.dayRules=[{id:'off',type:'off',date:'2026-09-07',label:''}];
  s.exceptions=[{id:'cancel',type:'cancel',sessionId:'tuesday-session',sourceDate:'2026-09-08'},{id:'move',type:'move',sessionId:'tuesday-session',sourceDate:'2026-09-15',date:'2026-09-13',startPeriod:3,endPeriod:4,location:'B202'}];
  const events=notificationEvents(s),now=new Date(2026,8,7,7).getTime(),next=nextOccurrenceIds(events,now);
  assert.deepEqual([...next],['tuesday-session@2026-09-15']);
  const moved=events.find(o=>next.has(o.id));assert.equal(moved.date,'2026-09-13');assert.equal(moved.location,'B202');
  assert.equal(courseLive(moved,now,next).upcoming,true);assert.match(courseLive(moved,now,next).detail,/即将上课.*2026-09-13/);
  assert.equal(courseLive(events.find(o=>o.id==='monday-session@2026-09-14'),now,next).upcoming,false);
  assert.equal(courseLive(moved,moved.startMs,next).upcoming,false);
});

test('独立考试可以成为下一安排，考试进行中不标下一课程',()=>{
  const s=makeSemester({name:'合成考试',startDate:'2026-09-07',totalWeeks:1});
  s.exams=[{id:'exam',name:'独立考试',date:'2026-09-07',startTime:'08:30',endTime:'10:00',location:'考场',note:''}];
  const events=notificationEvents(s),now=new Date(2026,8,7,8).getTime(),next=nextOccurrenceIds(events,now);
  assert.deepEqual([...next],['exam:exam']);assert.equal(courseLive(events[0],now,next).label,'即将考试');
  assert.deepEqual([...nextOccurrenceIds(events,events[0].startMs)],[]);
});
