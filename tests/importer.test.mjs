import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSchedule } from '../www/importer.js';
import { assessmentFromText, assessmentValuesFromText, isAssessmentMetadata } from '../www/import-metadata.js';

test('考核元数据只识别明确标签或完整字段，考试课/考查课统一名称', () => {
  for (const [input, expected] of [
    ['考核方式：考试', '考试'], ['考核方法: 考查课', '考查'], ['考试课', '考试'],
    ['考 核 方 式：考 查', '考查'], ['考核方式\n考试', '考试'],
    ['考核方法：作品答辩', '作品答辩'], ['考核形式：论文 + 展示', '论文 + 展示'],
    ['考核方式：考试 教师：张老师', '考试'], ['考核方式：\n教师：张老师', ''],
    ['未设置', ''], ['必修', ''], ['英语考试研究', ''], ['考试方法与实践', ''],
    ['考试周安排', ''], ['课程性质：必修', ''],
  ]) assert.equal(assessmentFromText(input), expected, input);
  assert.deepEqual(assessmentValuesFromText('考核方式：考试；考核方法：考查'), ['考试', '考查']);
  assert.equal(assessmentFromText('考核方式：考试；考核方法：考查'), '');
});

test('考核字段行含空标签不会作为课程名，课程名含考试不受影响', () => {
  for (const input of ['考核方式', '考核方式：', '考核方式\n考查', '考 核 方 式：考 查', '考试课']) assert.equal(isAssessmentMetadata(input), true, input);
  for (const input of ['英语考试研究', '考核方式研究', '考核方式：考试 教师：张老师']) assert.equal(isAssessmentMetadata(input), false, input);
  const result = parseSchedule({text:'考核方式：考试\n专业英语\n周一 第1-2节 1-4周\n教师：老师\n地点：A101'});
  assert.equal(result.courses[0].name, '专业英语');
  assert.equal(result.courses[0].assessment, '考试');
});

test('空考核标签不吞入下一行的课程、教师、周次节次或时间', () => {
  for (const following of ['第1-2节 第1-4周', '星期一', '08:00–09:40', '2026-10-12', '高等数学', '课程名称：高等数学', '教师：王老师', '教室：A201', '周次：1-4', '节次：1-2', '作品答辩']) {
    for (const label of ['考核方式：', '考核方式']) {
      const text = `${label}\n${following}`;
      assert.equal(assessmentFromText(text), '', text);
      assert.equal(isAssessmentMetadata(text), false, text);
    }
  }
  const result = parseSchedule({text:'高等数学\n考核方式：\n第1-2节 第1-4周\n星期：周一\n教师：王老师\n教室：A201'});
  assert.equal(result.courses.length, 1, JSON.stringify(result.warnings));
  assert.equal(result.courses[0].assessment, '未设置');
  assert.equal(result.courses[0].teacher, '王老师');
  assert.equal(result.courses[0].location, 'A201');
  assert.equal(assessmentFromText('考核方式：\n考 查 课'), '考查');
  assert.equal(assessmentFromText('考核方式：作品答辩'), '作品答辩');
});

test('同一行标签导入考核方式，名称教师地点不会吞入考核文字', () => {
  const result = parseSchedule({text:'课程名称：考试方法研究 考核方式：考查课 星期：一 节次：1-2 周次：1-4 教师：张老师 地点：A101'});
  assert.equal(result.courses.length, 1, JSON.stringify(result.warnings));
  assert.equal(result.courses[0].name, '考试方法研究');
  assert.equal(result.courses[0].assessment, '考查');
  assert.equal(result.courses[0].teacher, '张老师');
  assert.equal(result.courses[0].location, 'A101');
  const trailing = parseSchedule({text:'课程名称：设计\n星期：二\n节次：1-2\n周次：1-4\n教师：张老师 考核方式：作品答辩 地点：A102'});
  assert.equal(trailing.courses[0].assessment, '作品答辩');
  assert.equal(trailing.courses[0].teacher, '张老师');
  assert.equal(trailing.courses[0].location, 'A102');
});

test('按表头导入任意位置的考核列及自定义考核文字', () => {
  const result = parseSchedule({text:'课程名称 | 考核方式 | 星期 | 节次 | 周次 | 教室 | 教师\n设计工作坊 | 作品答辩 | 三 | 5-6 | 1-8 | 艺术楼201 | 赵老师\n统计学 | 考试课 | 2 | 1-2 | 1-8 | A202 | 孙老师'});
  assert.equal(result.courses.length, 2, JSON.stringify(result.warnings));
  const design = result.courses.find(course => course.name === '设计工作坊');
  assert.equal(design.assessment, '作品答辩');
  assert.equal(design.teacher, '赵老师');
  assert.equal(design.location, '艺术楼201');
  assert.equal(design.day, 3);
  assert.equal(result.courses.find(course => course.name === '统计学').assessment, '考试');
});

test('未提供考核方式不由必修或含考试的课程名推断', () => {
  const result = parseSchedule({text:'课程名称：大学英语考试研究\n星期：一\n节次：1-2\n周次：1-4\n课程性质：必修'});
  assert.equal(result.courses[0].name, '大学英语考试研究');
  assert.equal(result.courses[0].assessment, '未设置');
});

test('相同安排先缺省后明确考核方式能补全，倒序一致', () => {
  const line = '材料基础 | 周一 | 第1-2节 | 1-4周 | 张老师 | A101';
  for (const rows of [[line, `${line} | 考试课`], [`${line} | 考试`, line]]) {
    const result = parseSchedule({text:rows.join('\n')});
    assert.equal(result.courses.length, 1);
    assert.equal(result.courses[0].assessment, '考试');
    assert.deepEqual(result.warnings, []);
  }
});

test('单条和重复安排的明确考核冲突均提示，不猜一个结果', () => {
  const line = '材料基础 | 周一 | 第1-2节 | 1-4周 | 张老师 | A101';
  for (const text of [`${line} | 考核方式：考试 | 考核方法：考查`, `${line} | 考试\n${line} | 考查\n${line} | 考试`]) {
    const result = parseSchedule({text});
    assert.equal(result.courses.length, 1);
    assert.equal(result.courses[0].assessment, '未设置');
    assert.equal(result.courses[0].assessmentConflict, true);
    assert.match(result.warnings.join(''), /考核方式/);
    assert.match(result.warnings.join(''), /冲突/);
  }
});

test('课程 JSON 保留考核方式并合并重复记录的缺失字段', () => {
  const course = {name:'设计',day:2,startPeriod:1,endPeriod:2,weeks:[1,2]};
  const result = parseSchedule({text:JSON.stringify([course,{...course,assessment:'作品答辩'}])});
  assert.equal(result.courses.length, 1);
  assert.equal(result.courses[0].assessment, '作品答辩');
});

test('考核冲突标记跨导入步骤保留，后来的明确值不能掩盖冲突', () => {
  const course = {name:'设计',day:2,startPeriod:1,endPeriod:2,weeks:[1,2]};
  for (const entries of [[{...course,assessmentConflict:true},{...course,assessment:'考试'}],[{...course,assessment:'考试'},{...course,assessmentConflict:true}]]) {
    const result = parseSchedule({text:JSON.stringify(entries)});
    assert.equal(result.courses.length, 1);
    assert.equal(result.courses[0].assessment, '未设置');
    assert.equal(result.courses[0].assessmentConflict, true);
  }
  const literal = parseSchedule({text:JSON.stringify([{...course,assessment:'考试',assessmentConflict:'true'}])});
  assert.equal(literal.courses[0].assessment, '考试');
  assert.equal(literal.courses[0].assessmentConflict, undefined);
});

test('导入结构化课表文本，保持教师教室和单双周', () => {
  const result = parseSchedule({ text: '课程名称 | 星期 | 节次 | 周次 | 教师 | 教室\n高等数学 | 周一 | 第1-2节 | 1-16周(单) | 王老师 | A201\n大学英语 | 周三 | 第3-4节 | 2-16周(双) | 李老师 | B302' });
  assert.equal(result.courses.length, 2);
  assert.deepEqual(result.warnings, []);
  const math = result.courses[0];
  assert.equal(math.name, '高等数学');
  assert.equal(math.teacher, '王老师');
  assert.equal(math.location, 'A201');
  assert.equal(math.day, 1);
  assert.equal(math.startPeriod, 1);
  assert.equal(math.endPeriod, 2);
  assert.deepEqual(math.weeks, [1, 3, 5, 7, 9, 11, 13, 15]);
  assert.deepEqual(result.courses[1].weeks, [2, 4, 6, 8, 10, 12, 14, 16]);
});

test('支持 Excel 复制的 tab 分隔文本', () => {
  const result = parseSchedule({ text: '高等数学\t星期二\t第1-2节\t1-4周\t张老师\tA102' });
  assert.equal(result.courses.length, 1);
  assert.equal(result.courses[0].teacher, '张老师');
});

test('支持逐行字段标签和方括号节次', () => {
  const result = parseSchedule({ text: '课程名称：程序设计\n星期：四\n节次：[3-4]节\n周次：1-8(单)\n教师：陈老师\n地点：实验楼401\n\n课程名称：英语\n星期：二\n节次：5-6\n周次：1-4\n教师：李老师\n教室：A202' });
  assert.equal(result.courses.length, 2, JSON.stringify(result.warnings));
  assert.equal(result.courses[1].day, 4);
  assert.equal(result.courses[1].location, '实验楼401');
  assert.deepEqual(result.courses[1].weeks, [1, 3, 5, 7]);
});

test('无法识别周次、节次或星期时跳过且解释原因', () => {
  for (const [text, field] of [
    ['高等数学 | 周一 | 第1-2节 | 待定 | 王老师 | A201', '周次'],
    ['高等数学 | 周一 | 待定 | 1-16周 | 王老师 | A201', '节次'],
    ['课程名称：高等数学\n节次：1-2\n周次：1-16', '星期'],
    ['高等数学 | 周一 | 第1,3节 | 1-16周 | 王老师 | A201', '节次'],
  ]) {
    const result = parseSchedule({ text });
    assert.equal(result.courses.length, 0);
    assert.match(result.warnings.join('\n'), new RegExp(field));
  }
});

test('周次越界不会被截断后静默导入', () => {
  const result = parseSchedule({ text: '高等数学 | 周一 | 第1-2节 | 1-25周 | 王老师 | A201' }, 20);
  assert.equal(result.courses.length, 0);
  assert.match(result.warnings.join(''), /周次/);
});

test('未知多位节次编码不能被截取后两位导入', () => {
  const result = parseSchedule({ text: '高等数学\n周一 [0102节] 第1-16周' });
  assert.equal(result.courses.length, 0);
  assert.match(result.warnings.join(''), /节次/);
});

test('超长数字及多项节次列表不能被截取尾部导入', () => {
  for (const period of ['第101节', '1,2,3节', '1, 2, 3节', '节次：101']) {
    const result = parseSchedule({ text: `高等数学\n周一 ${period} 第1-16周` });
    assert.equal(result.courses.length, 0, period);
    assert.match(result.warnings.join(''), /节次/);
  }
});

test('标准 JSON 逐条严格验证、去重并保留错误说明', () => {
  const valid = { name: '数学', day: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2] };
  const result = parseSchedule({ text: JSON.stringify({ courses: [valid, valid, { ...valid, name: '错误课程', weeks: [] }] }) });
  assert.equal(result.courses.length, 1);
  assert.equal(result.source, '课程 JSON');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /周次/);
  assert.equal(parseSchedule({ text: '{broken json' }).courses.length, 0);
});

test('空网页或登录页不伪造课程，来源不泄露 URL 查询参数', () => {
  const result = parseSchedule({ text: '用户登录\n用户名\n密码\n验证码', url: 'https://jwgl.example.edu.cn/login?token=secret' });
  assert.equal(result.courses.length, 0);
  assert.equal(result.source, 'jwgl.example.edu.cn');
  assert.ok(result.warnings.length);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('Node 无 DOMParser 时明确提示网页结构未解析', () => {
  const result = parseSchedule({ html: '<table><tr><td>高等数学</td></tr></table>' });
  assert.equal(result.courses.length, 0);
  assert.match(result.warnings[0], /网页表格结构/);
});

test('内容和学期范围的边界检查', () => {
  assert.equal(parseSchedule(null).courses.length, 0);
  assert.match(parseSchedule({ text: 'a'.repeat(2_000_001) }).warnings[0], /2 MB/);
  assert.match(parseSchedule({ text: '课程' }, 0).warnings[0], /学期周数/);
});
