import test from 'node:test';
import assert from 'node:assert/strict';
import {courseLive,axisDate} from '../www/course-live.js';
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
