import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, createCourse, getWeek, getWeekDates, occursInWeek, findConflicts, parseWeeks, validateBackup, demoCourses } from '../www/core.js';

const input = overrides => ({ name: '高等数学', teacher: '王老师', location: 'A201', day: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3, 4], ...overrides });
const backup = overrides => ({ version: 1, settings: structuredClone(DEFAULT_SETTINGS), courses: [createCourse(input())], ...overrides });

test('周次范围、离散周次、单双周和全角符号', () => {
  assert.deepEqual(parseWeeks('第1-4周、7周'), [1, 2, 3, 4, 7]);
  assert.deepEqual(parseWeeks('1-8周(单周)'), [1, 3, 5, 7]);
  assert.deepEqual(parseWeeks('周次：２～８周（双）'), [2, 4, 6, 8]);
  assert.deepEqual(parseWeeks('1-7周(单),10-16周(双)'), [1, 3, 5, 7, 10, 12, 14, 16]);
  assert.deepEqual(parseWeeks('1,3,5,3周'), [1, 3, 5]);
  assert.deepEqual(parseWeeks('全学期', 3), [1, 2, 3]);
});

test('无法识别、倒序或超出学期的周次不会变成全学期', () => {
  for (const value of ['', '周次待定', '单周', '0-5周', '8-2周', '1-21周', 'A201', '第1节', '1-16周，待定']) {
    assert.deepEqual(parseWeeks(value), [], value);
  }
});

test('周次按民用日期计算，跨月跨年及开学前均准确', () => {
  assert.equal(getWeek('2026-09-07', '2026-09-07'), 1);
  assert.equal(getWeek('2026-09-13', '2026-09-07'), 1);
  assert.equal(getWeek('2026-09-14', '2026-09-07'), 2);
  assert.equal(getWeek('2026-09-06', '2026-09-07'), 0);
  assert.equal(getWeek('2026-08-30', '2026-09-07'), -1);
  assert.deepEqual(getWeekDates('2025-12-29', 1), ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  assert.equal(getWeek(new Date(2026, 8, 14, 0, 1), '2026-09-07'), 2);
  assert.throws(() => getWeek('2026-02-30', '2026-09-07'), /不存在/);
});

test('课程规范化、去重周次与严格输入校验', () => {
  const course = createCourse(input({ name: ' 数学 ', day: '2', weeks: [3, 1, 1] }));
  assert.equal(course.name, '数学');
  assert.equal(course.day, 2);
  assert.deepEqual(course.weeks, [1, 3]);
  assert.ok(course.id);
  assert.equal(occursInWeek(course, 1), true);
  assert.equal(occursInWeek(course, 2), false);
  for (const invalid of [{ name: '' }, { day: 8 }, { day: true }, { weeks: [] }, { weeks: [0] }, { weeks: [31] }, { startPeriod: 3, endPeriod: 2 }, { endPeriod: 25 }, { color: 8 }, { teacher: {} }]) {
    assert.throws(() => createCourse(input(invalid)));
  }
});

test('冲突需要星期、节次和周次同时重叠，编辑自身不会冲突', () => {
  const original = createCourse(input({ id: 'original' }));
  const overlapping = createCourse(input({ id: 'overlap', startPeriod: 2, endPeriod: 3, weeks: [4, 5] }));
  const oddOnly = createCourse(input({ id: 'odd', weeks: [1, 3] }));
  const evenOnly = createCourse(input({ id: 'even', weeks: [2, 4] }));
  const adjacent = createCourse(input({ id: 'adjacent', startPeriod: 3, endPeriod: 4 }));
  const otherDay = createCourse(input({ id: 'other-day', day: 2 }));
  assert.deepEqual(findConflicts([original, overlapping, adjacent, otherDay], original).map(c => c.id), ['overlap']);
  assert.deepEqual(findConflicts([oddOnly], evenOnly), []);
});

test('备份验证保留完整课程，输出不共享设置对象', () => {
  const original = backup();
  const validated = validateBackup(original);
  assert.deepEqual(validated, original);
  assert.notEqual(validated.settings.periods, original.settings.periods);
  assert.notEqual(validated.courses[0], original.courses[0]);
});

test('损坏、重复编号和越界备份被完整拒绝', () => {
  assert.throws(() => validateBackup({ version: 2 }), /版本/);
  assert.throws(() => validateBackup(backup({ settings: null })), /学期设置/);
  assert.throws(() => validateBackup(backup({ courses: {} })), /课程列表/);
  const duplicate = backup();
  duplicate.courses.push({ ...duplicate.courses[0] });
  assert.throws(() => validateBackup(duplicate), /重复/);
  const badDate = backup(); badDate.settings.semesterStart = '2026-09-08';
  assert.throws(() => validateBackup(badDate), /周一/);
  const badTime = backup(); badTime.settings.periods[1].start = '08:20';
  assert.throws(() => validateBackup(badTime), /重叠/);
  const badWeeks = backup(); badWeeks.courses[0].weeks = [21];
  assert.throws(() => validateBackup(badWeeks), /范围/);
});

test('所有体验数据明确标记为示例', () => {
  assert.ok(demoCourses.length > 0);
  for (const course of demoCourses) assert.match(course.name, /示例/);
});
