import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSchedule } from '../www/importer.js';

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
