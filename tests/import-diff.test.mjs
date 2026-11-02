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

test('旧版快照没有考核字段，重新导入须勾选才补全且快照结构不变',()=>{
  const semester=imported(),before=structuredClone(semester),session=semester.courses[0].sessions[0];
  assert.equal(Object.hasOwn(session.importSource.snapshot,'assessment'),false);
  const diff=diffImport(semester,[flat({assessment:'考查'})],options),item=diff.items[0];
  assert.equal(item.status,'changed');assert.equal(item.before.assessment,'未设置');assert.equal(item.after.assessment,'考查');
  assert.deepEqual(applyImport(semester,diff),before);assert.deepEqual(applyImport(semester,diff,[]),before);
  const next=checked(applyImport(semester,diff,[item.key]));
  assert.equal(next.courses[0].assessment,'考查');assert.equal(next.courses[0].id,semester.courses[0].id);
  assert.equal(next.courses[0].sessions[0].id,session.id);
  assert.deepEqual(Object.keys(next.courses[0].sessions[0].importSource.snapshot).sort(),Object.keys(session.importSource.snapshot).sort());
  assert.deepEqual(semester,before);
  const repeat=diffImport(next,[flat({assessment:'考查'})],options);
  assert.equal(repeat.counts.same,1);assert.equal(repeat.counts.changed,0);assert.deepEqual(applyImport(next,repeat),next);
});

test('网页与PDF跨来源补齐考核，手动名称地点和单次调课保留',()=>{
  const semester=empty(),stored=applyImport(semester,diffImport(semester,[flat({name:'高等数学*',location:'市中校区 A201'})],{kind:'web',source:'jwgl.example.edu'}));
  const course=stored.courses[0],session=course.sessions[0];
  course.name='我的高数';session.location='手动教室';
  stored.exceptions=[{id:'move-one',sessionId:session.id,sourceDate:'2026-09-07',type:'move',date:'2026-09-08',startPeriod:3,endPeriod:4,location:'调课教室'}];
  const before=structuredClone(stored),diff=diffImport(stored,[flat({name:'高 等数学＊',assessment:'考试'})],options),item=diff.items[0];
  assert.equal(item.status,'changed');assert.equal(item.after.name,'我的高数');assert.equal(item.after.location,'手动教室');
  const next=checked(applyImport(stored,diff,[item.key]));
  assert.equal(next.courses[0].assessment,'考试');assert.equal(next.courses[0].name,'我的高数');assert.equal(next.courses[0].sessions[0].location,'手动教室');
  assert.equal(next.courses[0].sessions[0].id,session.id);assert.deepEqual(next.exceptions,stored.exceptions);assert.deepEqual(stored,before);
});

test('已有明确考核方式无论同安排或安排变化都保留，并展示来源和保留值',()=>{
  const stored=imported();stored.courses[0].assessment='课程论文';
  for(const change of [{},{location:'B301'}]){
    const diff=diffImport(stored,[flat({...change,assessment:'考试'})],options),item=diff.items[0];
    assert.equal(item.before.assessment,'课程论文');assert.equal(item.after.assessment,'课程论文');
    assert.match(item.message,/课程论文/);assert.match(item.message,/考试/);assert.match(item.message,/保留/);
    assert.ok(diff.warnings.some(warning=>warning.includes('课程论文')&&warning.includes('考试')));
    assert.equal(checked(applyImport(stored,diff,[item.key])).courses[0].assessment,'课程论文');
  }
  const absent=diffImport(stored,[flat()],options);
  assert.equal(absent.counts.same,1);assert.equal(absent.warnings.length,0);assert.deepEqual(applyImport(stored,absent),stored);
});

test('同安排重复条目一条缺考核一条有考核，输入顺序不影响明确元数据',()=>{
  for(const assessments of [[undefined,'考查'],['考查',undefined],['未设置','考查','考查']]){
    const semester=empty(),rows=assessments.map(assessment=>flat({assessment})),diff=diffImport(semester,rows,options);
    assert.equal(diff.counts.new,1);assert.equal(diff.items[0].incoming.assessment,'考查');assert.equal(diff.items[0].after.assessment,'考查');
    assert.equal(checked(applyImport(semester,diff)).courses[0].assessment,'考查');
    const existing=imported(),update=diffImport(existing,rows,options);
    assert.equal(update.counts.changed,1);assert.equal(checked(applyImport(existing,update,update.items.map(item=>item.key))).courses[0].assessment,'考查');
  }
});

test('同安排互相冲突的考核聚合成警告，第三条重复值不能覆盖冲突',()=>{
  for(const assessments of [['考试','考查','考试'],['考查','考试','考查'],[undefined,'考试','考查']]){
    const semester=empty(),rows=assessments.map(assessment=>flat({assessment})),diff=diffImport(semester,rows,options);
    assert.equal(diff.counts.new,1);assert.equal(diff.items[0].incoming.assessment,'未设置');assert.equal(diff.items[0].after.assessment,'未设置');
    assert.ok(diff.warnings.some(warning=>/考核方式.*冲突/.test(warning)));
    assert.equal(checked(applyImport(semester,diff)).courses[0].assessment,'未设置');
    const existing=imported(),update=diffImport(existing,rows,options);
    assert.equal(update.counts.same,1);assert.equal(update.counts.changed,0);
    assert.deepEqual(applyImport(existing,update,update.items.map(item=>item.key)),existing);
  }
});

function withTwoSessions(){
  const stored=imported(),course=stored.courses[0],second=structuredClone(course.sessions[0]);
  second.id='second-session';second.day=3;second.importSource.key=second.id;second.importSource.snapshot.day=3;course.sessions.push(second);
  return stored;
}

test('同课程多安排的考核冲突不随输入顺序更新，其他教务变更仍可单独确认',()=>{
  for(const reverse of [false,true]){
    const stored=withTwoSessions(),rows=[flat({assessment:'考试',location:'B301'}),flat({day:3,assessment:'考查'})];
    if(reverse)rows.reverse();
    const diff=diffImport(stored,rows,options);
    assert.equal(diff.counts.changed,1);assert.equal(diff.counts.same,1);
    assert.ok(diff.warnings.some(warning=>warning.includes('考试')&&warning.includes('考查')&&warning.includes('冲突')));
    assert.ok(diff.items.every(item=>item.after.assessment==='未设置'));
    const next=checked(applyImport(stored,diff,diff.items.map(item=>item.key)));
    assert.equal(next.courses[0].assessment,'未设置');assert.equal(next.courses[0].sessions[0].location,'B301');
    assert.deepEqual(next.courses[0].sessions.map(session=>session.id),stored.courses[0].sessions.map(session=>session.id));
  }
});

test('同课程多安排补齐考核，缺字段的兄弟安排不清空已确认结果或替用户授权',()=>{
  for(const reverse of [false,true]){
    const stored=withTwoSessions(),rows=[flat({assessment:'考试'}),flat({day:3,location:'B301'})];
    stored.exceptions=[{id:'cancel-first',sessionId:stored.courses[0].sessions[0].id,sourceDate:'2026-09-07',type:'cancel'}];
    if(reverse)rows.reverse();
    const diff=diffImport(stored,rows,options),explicit=diff.items.find(item=>item.incoming.assessment==='考试'),missing=diff.items.find(item=>item.incoming.assessment==='未设置');
    assert.equal(explicit.status,'changed');assert.equal(missing.status,'changed');
    assert.equal(applyImport(stored,diff,[missing.key]).courses[0].assessment,'未设置');
    const next=checked(applyImport(stored,diff,diff.items.map(item=>item.key)));
    assert.equal(next.courses[0].assessment,'考试');assert.equal(next.courses[0].sessions[1].location,'B301');
    assert.deepEqual(next.exceptions,stored.exceptions);assert.deepEqual(next.courses[0].sessions.map(session=>session.id),stored.courses[0].sessions.map(session=>session.id));
  }
});

test('无来源的迁移课程也能凭唯一安排补齐，模糊匹配不补齐',()=>{
  const stored=imported();delete stored.courses[0].assessment;delete stored.courses[0].sessions[0].importSource;
  const diff=diffImport(stored,[flat({assessment:'考查'})],options);
  assert.equal(diff.counts.changed,1);assert.equal(diff.items[0].before.assessment,'未设置');
  assert.equal(checked(applyImport(stored,diff,[diff.items[0].key])).courses[0].assessment,'考查');
  const unclear=diffImport(stored,[flat({day:3,assessment:'考查'})],options);
  assert.equal(unclear.counts.ambiguous,1);assert.deepEqual(applyImport(stored,unclear,unclear.items.map(item=>item.key)),stored);
});

test('解析器消去的考核冲突阻止兄弟安排补齐，临时标记不会持久化',()=>{
  const stored=withTwoSessions(),rows=[flat({assessment:'未设置',assessmentConflict:true}),flat({day:3,assessment:'考试',location:'B301'})];
  const diff=diffImport(stored,rows,options);
  assert.equal(diff.counts.same,1);assert.equal(diff.counts.changed,1);
  const next=checked(applyImport(stored,diff,diff.items.map(item=>item.key)));
  assert.equal(next.courses[0].assessment,'未设置');assert.equal(next.courses[0].sessions[1].location,'B301');
  assert.equal(JSON.stringify(next).includes('assessmentConflict'),false);
  const semester=empty(),initial=diffImport(semester,[flat({assessmentConflict:true}),flat({assessment:'考试'})],options);
  const created=checked(applyImport(semester,initial));
  assert.equal(initial.items[0].incoming.assessmentConflict,true);assert.equal(created.courses[0].assessment,'未设置');
  assert.equal(JSON.stringify(created).includes('assessmentConflict'),false);
});

test('网页旧课到坐标PDF的完整链路补齐自定义考核且保留身份调课，再次导入幂等',()=>{
  const web=parseSchedule({text:'高等数学* | 周一 | 第1-2节 | 1-4周 | 王老师 | 市中校区A201'});
  const item=(text,x,y)=>({text,x,y,width:text.length*7,height:10});
  const pdf=parsePdfTextPages([{width:800,height:500,items:[
    ...['一','二','三','四','五'].map((day,i)=>item(`星期${day}`,100+i*130,50)),
    ...['高 等 数 学','第1-2节 第1、2、3、4周','任课教师：王老师','上课地点：A201','考核方式：课程论文'].map((line,i)=>item(line,90,100+i*15))
  ]}]);
  assert.equal(web.courses.length,1);assert.equal(web.courses[0].assessment,'未设置');
  assert.equal(pdf.courses.length,1,JSON.stringify(pdf.warnings));assert.equal(pdf.courses[0].assessment,'课程论文');
  const semester=empty(),stored=applyImport(semester,diffImport(semester,web.courses,{kind:'web',source:web.source})),course=stored.courses[0],session=course.sessions[0];
  course.name='自己命名的高数';session.location='手动教室';
  stored.exceptions=[{id:'single-move',sessionId:session.id,sourceDate:'2026-09-07',type:'move',date:'2026-09-08',startPeriod:3,endPeriod:4,location:'调课教室'}];
  const diff=diffImport(stored,pdf.courses,{kind:'pdf',source:pdf.source});
  assert.equal(diff.counts.changed,1);assert.deepEqual(applyImport(stored,diff),stored);
  const next=checked(applyImport(stored,diff,[diff.items[0].key]));
  assert.equal(next.courses[0].assessment,'课程论文');assert.equal(next.courses[0].id,course.id);assert.equal(next.courses[0].sessions[0].id,session.id);
  assert.equal(next.courses[0].name,course.name);assert.equal(next.courses[0].sessions[0].location,session.location);assert.deepEqual(next.exceptions,stored.exceptions);
  const repeat=diffImport(next,pdf.courses,{kind:'pdf',source:pdf.source});
  assert.equal(repeat.counts.same,1);assert.deepEqual(applyImport(next,repeat),next);
});

test('预览保留规范化重复的所有来源ID，补全及冲突后继续合并均不丢来源',()=>{
  for(const assessments of [[undefined,'考查','考查'],['考试','考查',undefined],['考试','考查','考试']]){
    const semester=empty(),rows=assessments.map((assessment,index)=>flat({id:`source-${index}`,name:index?'高 等数学*':'高等数学',assessment}));
    const diff=diffImport(semester,rows,options);
    assert.equal(diff.items.length,1);assert.deepEqual(diff.items[0].sourceIds,['source-0','source-1','source-2']);
    assert.equal(diff.items[0].incoming.id,'source-0');
    const corrected=rows.map(row=>({...row,assessment:'课程论文',assessmentConflict:false}));
    const preview=diffImport(semester,corrected,options);
    assert.deepEqual(preview.items[0].sourceIds,['source-0','source-1','source-2']);assert.equal(preview.items[0].incoming.assessment,'课程论文');
    const stored=checked(applyImport(semester,preview));
    assert.equal(stored.courses[0].assessment,'课程论文');assert.equal(JSON.stringify(stored).includes('sourceIds'),false);
  }
});

test('相同、变化及模糊候选预览均带来源ID，缺失项无导入来源ID',()=>{
  const stored=imported();
  for(const [patch,status] of [[{},'same'],[{assessment:'考试'},'changed'],[{day:3},'ambiguous']]){
    const diff=diffImport(stored,[flat({id:'incoming-row',...patch})],options),item=diff.items.find(row=>row.incoming);
    assert.equal(item.status,status);assert.deepEqual(item.sourceIds,['incoming-row']);
  }
  const missing=diffImport(stored,[],options).items[0];
  assert.equal(missing.status,'missing');assert.equal(Object.hasOwn(missing,'sourceIds'),false);
});
