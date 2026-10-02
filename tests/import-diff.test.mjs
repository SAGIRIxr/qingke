import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSemester, createState, validateState } from '../www/engine.js';
import { diffImport, applyImport } from '../www/import-diff.js';
import { parseSchedule } from '../www/importer.js';
import { parsePdfTextPages } from '../www/pdf-import.js';

const options={kind:'pdf',source:'学校课表.pdf'};
const flat=(patch={})=>({name:'高等数学',day:1,startPeriod:1,endPeriod:2,weeks:[1,2,3,4],teacher:'王老师',location:'A201',...patch});
const empty=()=>makeSemester({name:'测试学期',startDate:'2026-09-07',totalWeeks:20});
const imported=()=>{const semester=empty();return applyImport(semester,diffImport(semester,[flat()],options));};
const checked=semester=>{const state=createState();state.semesters=[semester];state.activeSemesterId=semester.id;return validateState(state).semesters[0];};

test('初次导入默认仅新增，再次导入去重，source快照经过验证保存',()=>{
  const semester=empty(),diff=diffImport(semester,[flat(),flat()],options);
  assert.equal(diff.counts.new,1);assert.equal(diff.warnings.length,1);
  const next=checked(applyImport(semester,diff));
  assert.equal(semester.courses.length,0);
  assert.equal(next.courses[0].sessions[0].importSource.snapshot.location,'A201');
  const repeat=diffImport(next,[flat()],options);
  assert.equal(repeat.counts.same,1);assert.equal(applyImport(next,repeat).courses.length,1);
});
test('changed需明确选择，更新身份不变且课程手动元数据保留',()=>{
  const semester=imported(),course=semester.courses[0],session=course.sessions[0];
  course.shortName='高数';course.note='手动笔记';course.color=6;course.assessment='考试';session.breakMode='continuous';
  const diff=diffImport(semester,[flat({location:'B301'})],options),item=diff.items.find(item=>item.status==='changed');
  assert.ok(item);assert.equal(applyImport(semester,diff).courses[0].sessions[0].location,'A201');
  const next=checked(applyImport(semester,diff,[item.key]));
  assert.equal(next.courses[0].id,course.id);assert.equal(next.courses[0].sessions[0].id,session.id);
  assert.equal(next.courses[0].sessions[0].location,'B301');assert.equal(next.courses[0].note,'手动笔记');assert.equal(next.courses[0].shortName,'高数');assert.equal(next.courses[0].color,6);assert.equal(next.courses[0].sessions[0].breakMode,'continuous');
});
test('手动修改教室和名称不会被相同或变更导入覆盖',()=>{
  const semester=imported();semester.courses[0].name='高数自己的名称';semester.courses[0].sessions[0].location='手动教室';
  const same=diffImport(semester,[flat()],options);assert.equal(same.counts.same,1);
  const diff=diffImport(semester,[flat({location:'B301',teacher:'李老师'})],options),item=diff.items.find(item=>item.status==='changed');
  assert.ok(item.protectedFields.includes('location'));assert.ok(item.protectedFields.includes('name'));
  const next=checked(applyImport(semester,diff,[item.key]));
  assert.equal(next.courses[0].name,'高数自己的名称');assert.equal(next.courses[0].sessions[0].location,'手动教室');assert.equal(next.courses[0].sessions[0].teacher,'李老师');
});
test('单次取消/调课的原身份和基础时间被保护',()=>{
  const semester=imported(),session=semester.courses[0].sessions[0];
  semester.exceptions=[{id:'exception-1',sessionId:session.id,sourceDate:'2026-09-07',type:'cancel'}];
  const diff=diffImport(semester,[flat({weeks:[2,3,4],location:'B301'})],options),item=diff.items.find(item=>item.status==='changed');
  const next=checked(applyImport(semester,diff,[item.key]));
  assert.deepEqual(next.exceptions,semester.exceptions);assert.deepEqual(next.courses[0].sessions[0].weeks,[1,2,3,4]);assert.equal(next.courses[0].sessions[0].location,'B301');
});
test('缺失课程永不自动删除，其他来源不报告missing',()=>{
  const semester=imported(),diff=diffImport(semester,[],options);
  assert.equal(diff.counts.missing,1);assert.deepEqual(applyImport(semester,diff,diff.items.map(item=>item.key)),semester);
  assert.equal(diffImport(semester,[],{kind:'web',source:'其他'}).counts.missing,0);
});
test('手动同名课程与多重候选保持ambiguous，只有明确add才新增',()=>{
  const semester=imported();delete semester.courses[0].sessions[0].importSource;
  const diff=diffImport(semester,[flat({location:'新教室'})],options),item=diff.items[0];
  assert.equal(item.status,'ambiguous');assert.equal(applyImport(semester,diff,[item.key]).courses.length,1);
  assert.equal(applyImport(semester,diff,[{key:item.key,action:'add'}]).courses.length,2);
});
test('先匹配未变安排，避免输入顺序抢占身份；新同名不同安排独立新增',()=>{
  const semester=empty(),base=applyImport(semester,diffImport(semester,[flat(),flat({day:3})],options));
  const diff=diffImport(base,[flat({day:3,location:'B301'}),flat()],options);
  assert.equal(diff.counts.same,1);assert.equal(diff.counts.changed,1);
  assert.equal(diff.items.find(item=>item.status==='changed').sessionId,base.courses[1].sessions[0].id);
});
test('预览后课表改变时拒绝套用过期计划，输入越界拒绝',()=>{
  const semester=imported(),diff=diffImport(semester,[flat({location:'B301'})],options);
  semester.courses[0].note='预览后修改';
  assert.throws(()=>applyImport(semester,diff),/重新/);
  assert.throws(()=>diffImport(semester,[flat({weeks:[21]})]),/学期范围/);
});
test('导入修正的考核方式用于新增，重新导入不覆盖现有课程考核',()=>{
  const semester=empty(),created=applyImport(semester,diffImport(semester,[flat({assessment:'考查'})],options));
  assert.equal(checked(created).courses[0].assessment,'考查');
  const diff=diffImport(created,[flat({assessment:'考试',location:'B301'})],options);
  const changed=applyImport(created,diff,diff.items.map(item=>item.key));
  assert.equal(changed.courses[0].assessment,'考查');
  assert.throws(()=>diffImport(semester,[flat({assessment:{x:1}})]),/文字/);
});

test('网页与PDF宽度空白尾星号字段标签差异不重复，保留原文与手改',()=>{
  const semester=empty(),web=flat({name:'高等数学*',location:'市中校区 A201'});
  const stored=applyImport(semester,diffImport(semester,[web],{kind:'web',source:'jwgl.example.edu'}));
  stored.courses[0].name='自己的高数';stored.courses[0].sessions[0].location='自习室';
  const incoming=flat({name:'高 等 数 学＊\u200b',teacher:'任课教师： 王 老 师',location:'上课地点：Ａ２０１',weeks:[4,2,1,3]});
  const diff=diffImport(stored,[incoming],options);
  assert.equal(diff.counts.same,1);assert.equal(diff.counts.new,0);assert.equal(diff.counts.changed,0);
  const next=applyImport(stored,diff);assert.equal(next.courses.length,1);assert.equal(next.courses[0].name,'自己的高数');assert.equal(next.courses[0].sessions[0].location,'自习室');
});

test('校区前缀仅容忍单方省略，不把明确不同校区当作相同安排',()=>{
  const semester=empty(),stored=applyImport(semester,diffImport(semester,[flat({location:'[市中校区]A201'})],options));
  assert.equal(diffImport(stored,[flat({location:'A201'})],options).counts.same,1);
  const other=diffImport(stored,[flat({location:'薛城校区-A201'})],options);
  assert.equal(other.counts.same,0);assert.equal(other.counts.changed,1);
  assert.equal(applyImport(stored,other).courses[0].sessions[0].location,'[市中校区]A201');
});

test('同名不同星期或节次始终不自动合并，规范化后多重候选仍需核对',()=>{
  const stored=imported();
  for(const patch of [{day:3},{startPeriod:3,endPeriod:4}]){
    const diff=diffImport(stored,[flat({...patch,name:'高 等 数 学*'})],options);
    assert.equal(diff.counts.same,0);assert.equal(diff.counts.changed,0);assert.equal(diff.counts.ambiguous,1);
    assert.deepEqual(applyImport(stored,diff),stored);
  }
  const semester=empty(),two=applyImport(semester,diffImport(semester,[flat({location:'市中校区A201'}),flat({location:'薛城校区A201'})],options));
  const unclear=diffImport(two,[flat({location:'A201'})],options);
  assert.equal(unclear.counts.ambiguous,1);assert.equal(unclear.counts.same,0);assert.equal(unclear.counts.new,0);
});

test('迁移的无来源课程也可规范化去重，缺失教师不清除已有教师',()=>{
  const stored=imported();delete stored.courses[0].sessions[0].importSource;
  const diff=diffImport(stored,[flat({name:'高 等数学*',teacher:'',location:'教室：A201'})],options);
  assert.equal(diff.counts.same,1);assert.equal(applyImport(stored,diff).courses[0].sessions[0].teacher,'王老师');
});

test('同次导入尾星号与空格重复被折叠，不合并不同周次安排',()=>{
  const diff=diffImport(empty(),[flat(),flat({name:'高 等数学*'}),flat({weeks:[5,6,7,8]})],options);
  assert.equal(diff.counts.new,2);assert.equal(diff.warnings.length,1);
});

test('文字网页与坐标PDF表达不同周次格式，完整解析链仍识别相同课表',()=>{
  const web=parseSchedule({text:'高等数学* | 周一 | 第1-2节 | 1-4周 | 王老师 | 市中校区A201'});
  const item=(text,x,y)=>({text,x,y,width:text.length*8,height:10});
  const pdf=parsePdfTextPages([{width:800,height:500,items:[
    ...['一','二','三','四','五'].map((day,i)=>item(`星期${day}`,100+i*130,50)),
    ...['高 等 数 学','第1-2节 第1、2、3、4周','任课教师：王老师','上课地点：A201'].map((line,i)=>item(line,90,100+i*15))
  ]}]);
  assert.equal(web.courses.length,1);assert.equal(pdf.courses.length,1,JSON.stringify(pdf.warnings));
  const semester=empty(),stored=applyImport(semester,diffImport(semester,web.courses,{kind:'web'}));
  const diff=diffImport(stored,pdf.courses,options);assert.equal(diff.counts.same,1);assert.equal(diff.counts.new,0);
});
