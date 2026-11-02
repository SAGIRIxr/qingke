import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePdfTextPages,parsePdf} from '../www/pdf-import.js';

const text=(value,x,y)=>({text:value,x,y,width:value.length*9,height:10});
const page=(courses=[])=>({width:840,height:590,items:[...['一','二','三','四','五','六','日'].map((day,i)=>text(`星期${day}`,120+i*95,65)),...courses.flatMap(c=>c.lines.map((line,i)=>text(line,112+(c.day-1)*95,c.y+i*14)))]});
test('根据星期列和文本坐标读取中文课程、多页和单双周',()=>{
  const first=page([{day:1,y:105,lines:['高等数学','第1-2节 1-16周(单)','教师：王老师','教室：A201']},{day:3,y:105,lines:['大学英语','第3-4节 2-16周(双)','教师：李老师','教室：B302']}]);
  const second=page([{day:5,y:260,lines:['体育','第7-8节 1-18周','教师：赵老师','教室：操场']}]);
  const result=parsePdfTextPages([first,second]);
  assert.equal(result.courses.length,3);assert.deepEqual(result.warnings,[]);
  assert.deepEqual(result.courses[0].weeks,[1,3,5,7,9,11,13,15]);assert.equal(result.courses[1].day,3);assert.equal(result.courses[1].location,'B302');assert.equal(result.courses[2].startPeriod,7);
});
test('PDF页间重复课程去重，不把每页表头当课程',()=>{
  const p=page([{day:1,y:105,lines:['高等数学','第1-2节 1-16周']}]);
  assert.equal(parsePdfTextPages([p,p]).courses.length,1);
});
test('同一星期有多门课程且同一格中连续安排时拆分，不吞掉后一门',()=>{
  const p=page([{day:1,y:105,lines:['高等数学','第1-2节 1-16周(单)','教师：王老师','教室：A201','大学英语','第1-2节 2-16周(双)','教师：李老师','教室：B302']},{day:1,y:300,lines:['大学体育','第7-8节 1-18周','教室：操场']}]);
  const result=parsePdfTextPages([p]);
  assert.equal(result.courses.length,3);assert.deepEqual(result.warnings,[]);
  assert.equal(result.courses.find(course=>course.name==='大学英语').teacher,'李老师');
});
test('只有明确的左侧节次范围才可补充课块节次，不从单节行猜测连堂跨度',()=>{
  const p=page([{day:1,y:100,lines:['高等数学','1-16周','教师：王老师','教室：A201']}]);
  p.items.push(text('1-2节',40,122),text('3-4节',40,250));
  const result=parsePdfTextPages([p]);assert.equal(result.courses.length,1);assert.equal(result.courses[0].endPeriod,2);
  p.items=p.items.filter(item=>item.x!==40);p.items.push(text('1节',40,122),text('2节',40,250));
  assert.equal(parsePdfTextPages([p]).courses.length,0);
});
test('缺少周次/节次时不填默认值，扫描页明确提示OCR限制',()=>{
  const p=page([{day:1,y:105,lines:['高等数学','周次：1-16周','教师：王老师']}]);
  const result=parsePdfTextPages([p,{width:800,height:600,items:[]}]);
  assert.equal(result.courses.length,0);assert.ok(result.warnings.some(w=>w.includes('节次')));assert.ok(result.warnings.some(w=>w.includes('OCR')));
});
test('不把横跨多个星期的大段文字猜成课表，无星期表头需明确星期',()=>{
  const result=parsePdfTextPages([{width:800,height:600,items:[text('高等数学',50,100),text('第1-2节 第1-16周',50,115)]}]);
  assert.equal(result.courses.length,0);assert.ok(result.warnings.some(w=>w.includes('星期')));
});
test('文件与页数上限、无效类型在加载PDF库前拒绝',async()=>{
  assert.match((await parsePdf(new Uint8Array(20*1024*1024+1))).warnings[0],/20 MB/);
  assert.match((await parsePdf(new TextEncoder().encode('not a PDF'))).warnings[0],/有效/);
  assert.match(parsePdfTextPages(Array.from({length:31},()=>({items:[]}))).warnings[0],/30/);
});

test('PDF考核方式和裸考试课属于元数据，同一格多课仍分别关联',()=>{
  const p=page([{day:1,y:105,lines:[
    '高等数学','考核方式：考试','第1-2节 1-16周(单)','教师：王老师','教室：A201',
    '大学英语','考查课','第1-2节 2-16周(双)','教师：李老师','教室：B302',
  ]}]);
  const result=parsePdfTextPages([p]);
  assert.equal(result.courses.length,2);assert.deepEqual(result.warnings,[]);
  assert.equal(result.courses.find(course=>course.name==='高等数学').assessment,'考试');
  assert.equal(result.courses.find(course=>course.name==='大学英语').assessment,'考查');
});

test('PDF逐字空格和跨行考核标签、跨行考核值不会成为课程名称',()=>{
  const p=page([{day:1,y:105,lines:[
    '英语口语','考 核 方','式 ： 考','查','第1-2节 1-16周(单)','教师：王老师',
    '工程制图','考核方式','考试课','第1-2节 2-16周(双)','教师：李老师',
  ]}]);
  const result=parsePdfTextPages([p]);
  assert.equal(result.courses.length,2);assert.deepEqual(result.warnings,[]);
  assert.equal(result.courses.find(course=>course.name==='英语口语').assessment,'考查');
  assert.equal(result.courses.find(course=>course.name==='工程制图').assessment,'考试');
});

test('PDF跨页重复可以补充明确考核方式，冲突提示且后续重复不能静默覆盖',()=>{
  const course=assessment=>page([{day:1,y:105,lines:['高等数学','第1-2节 1-16周',...(assessment?[`考核方式：${assessment}`]:[])]}]);
  for(const pages of [[course(''),course('考试')],[course('考试'),course('')]]){
    const result=parsePdfTextPages(pages);assert.equal(result.courses.length,1);
    assert.equal(result.courses[0].assessment,'考试');assert.deepEqual(result.warnings,[]);
  }
  const result=parsePdfTextPages([course('考试'),course('考查'),course('考试')]);
  assert.equal(result.courses.length,1);assert.equal(result.courses[0].assessment,'未设置');
  assert.equal(result.courses[0].assessmentConflict,true);
  assert.ok(result.warnings.some(w=>w.includes('考核方式不一致')));
});

test('PDF单个区块的考核冲突传递到跨页去重，后续明确值不能抹去冲突',()=>{
  const conflict=page([{day:1,y:105,lines:['高等数学','第1-2节 1-16周','考核方式：考试','考核方式：考查']}]);
  const explicit=page([{day:1,y:105,lines:['高等数学','第1-2节 1-16周','考核方式：考试']}]);
  for(const pages of [[conflict,explicit],[explicit,conflict]]){
    const result=parsePdfTextPages(pages);assert.equal(result.courses.length,1);
    assert.equal(result.courses[0].assessment,'未设置');assert.equal(result.courses[0].assessmentConflict,true);
    assert.ok(result.warnings.some(w=>w.includes('考核')));
  }
});

test('PDF仅保留明确自定义考核值，不从课程名或必修推断考核',()=>{
  const p=page([{day:1,y:105,lines:['软件实训','第1-2节 1-16周','考核方式：课程论文']},{day:3,y:105,lines:['考试心理学','第3-4节 1-16周','课程性质：必修']}]);
  const result=parsePdfTextPages([p]);assert.equal(result.courses.length,2);
  assert.equal(result.courses.find(course=>course.name==='软件实训').assessment,'课程论文');
  assert.equal(result.courses.find(course=>course.name==='考试心理学').assessment,'未设置');
});
