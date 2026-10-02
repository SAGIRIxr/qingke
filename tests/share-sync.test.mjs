import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSemester, createState, validateState } from '../www/engine.js';
import { remapSharedSemester, mergeFollowedSemester } from '../www/share-sync.js';

const copy = value => structuredClone(value);
function semester() {
  const s = makeSemester({ name: '共享学期', startDate: '2026-09-07', totalWeeks: 20 }); s.id = 'sem-1';
  s.profiles[0].id = 'profile-1';
  s.courses = [{ id: 'course-1', name: '数学', shortName: '高数', color: 0, assessment: '考试', nature: '必修', note: '课程备注', sessions: [{ id: 'session-1', day: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 3], teacher: '甲', location: 'A201', breakMode: 'normal', importSource: { kind: 'web', source: 'sensitive-school-origin', key: 'source-1', snapshot: { name: '数学', day: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 3], teacher: '甲', location: 'A201' } } }] }];
  s.dayRules = [{ id: 'rule-1', date: '2026-09-08', type: 'off', label: '停课' }];
  s.exceptions = [{ id: 'exception-1', sessionId: 'session-1', sourceDate: '2026-09-07', type: 'modify', location: 'B201' }];
  s.holidayLabels = [{ id: 'holiday-1', date: '2026-09-08', name: '校庆' }];
  s.exams = [{ id: 'exam-1', name: '数学考试', date: '2026-10-12', startTime: '13:10', endTime: '15:00', location: '考场', note: '带证件', courseId: 'course-1' }];
  return s;
}
function validate(s) { const state = createState(); state.activeSemesterId = s.id; state.semesters = [s]; return validateState(state).semesters[0]; }
function baseline() { return remapSharedSemester(semester()).semester; }

test('分享映射按实体类型稳定重用，改写引用且剥离导入来源，备注与考试保留', () => {
  const raw = semester(), before = copy(raw), first = remapSharedSemester(raw);
  assert.notEqual(first.semester.id, raw.id);
  assert.notEqual(first.semester.courses[0].id, raw.courses[0].id);
  assert.equal(first.semester.exceptions[0].sessionId, first.semester.courses[0].sessions[0].id);
  assert.equal(first.semester.exams[0].courseId, first.semester.courses[0].id);
  assert.equal(first.semester.courses[0].note, '课程备注');
  assert.equal(first.semester.exams[0].note, '带证件');
  assert.equal(first.semester.courses[0].sessions[0].importSource, undefined);
  assert.ok(!JSON.stringify(first.semester).includes('sensitive-school-origin'));
  const oldMap = JSON.stringify(first.map), changed = copy(raw); changed.courses[0].name = '数学新名称';
  const second = remapSharedSemester(changed, first.map);
  assert.equal(second.semester.id, first.semester.id);
  assert.equal(second.semester.courses[0].id, first.semester.courses[0].id);
  assert.equal(second.semester.exams[0].id, first.semester.exams[0].id);
  assert.equal(second.semester.courses[0].name, '数学新名称');
  assert.equal(JSON.stringify(first.map), oldMap); assert.deepEqual(raw, before);
  assert.deepEqual(validate(second.semester), second.semester);
});

test('不同实体类型使用同一远端编号仍映射为不同本地身份', () => {
  const raw = semester(); raw.id = 'same'; raw.profiles[0].id = 'same'; raw.courses[0].id = 'same'; raw.courses[0].sessions[0].id = 'same'; raw.exceptions[0].sessionId = 'same'; raw.exams[0].courseId = 'same';
  const { semester: next, map } = remapSharedSemester(raw);
  assert.equal(new Set([map.sem.same, map.profiles.same, map.course.same, map.session.same]).size, 4);
  assert.equal(next.exceptions[0].sessionId, next.courses[0].sessions[0].id);
  assert.throws(() => remapSharedSemester(raw, { course: [] }), /映射/);
});

test('远端单独改动自动应用，本地新增考试与备注保持而不产生冲突', () => {
  const base = baseline(), local = copy(base), incoming = copy(base);
  local.courses[0].note = '我的笔记';
  local.exams.push({ id: 'local-exam', name: '个人报名考试', date: '2027-02-01', startTime: '09:00', endTime: '11:00', location: '', note: '' });
  incoming.courses[0].sessions[0].teacher = '乙';
  incoming.courses[0].sessions[0].location = '新教室';
  const result = mergeFollowedSemester(local, base, incoming);
  assert.equal(result.needsReview, false); assert.deepEqual(result.conflicts, []);
  assert.equal(result.semester.courses[0].note, '我的笔记');
  assert.equal(result.semester.courses[0].sessions[0].teacher, '乙');
  assert.equal(result.semester.exams.length, 2);
  assert.ok(result.changes.some(c => c.path.endsWith('.teacher')));
  assert.equal(local.courses[0].sessions[0].teacher, '甲');
});

test('同字段双方不同修改保留本地并报告冲突，双方改为相同值不冲突', () => {
  const base = baseline(), local = copy(base), incoming = copy(base);
  local.courses[0].sessions[0].location = '本地教室'; incoming.courses[0].sessions[0].location = '远端教室';
  const result = mergeFollowedSemester(local, base, incoming);
  assert.equal(result.needsReview, true); assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].before, 'A201'); assert.equal(result.conflicts[0].local, '本地教室'); assert.equal(result.conflicts[0].incoming, '远端教室');
  assert.equal(result.semester.courses[0].sessions[0].location, '本地教室');
  incoming.courses[0].sessions[0].location = '本地教室';
  assert.equal(mergeFollowedSemester(local, base, incoming).needsReview, false);
});

test('远端新增和删除按身份合并，本地新增实体继续保留', () => {
  const base = baseline(), local = copy(base), incoming = copy(base);
  local.holidayLabels.push({ id: 'local-holiday', date: '2026-10-01', name: '个人日期' });
  incoming.exams = [];
  incoming.holidayLabels.push({ id: 'remote-holiday', date: '2026-10-02', name: '共享日期' });
  const result = mergeFollowedSemester(local, base, incoming);
  assert.equal(result.needsReview, false);
  assert.equal(result.semester.exams.length, 0);
  assert.equal(result.semester.holidayLabels.length, 3);
  assert.ok(result.changes.some(c => c.type === 'delete'));
  assert.ok(result.changes.some(c => c.type === 'add'));
});

test('远端删除本地已修改实体时保留本地并报告冲突', () => {
  const base = baseline(), local = copy(base), incoming = copy(base);
  local.exams[0].location = '我确认的考场'; incoming.exams = [];
  const result = mergeFollowedSemester(local, base, incoming);
  assert.equal(result.needsReview, true); assert.equal(result.semester.exams[0].location, '我确认的考场');
  assert.equal(result.conflicts[0].type, 'remote-delete');
});

test('本地删除远端未改保持删除，远端也修改时报告冲突且不重新新增', () => {
  const base = baseline(), local = copy(base), incoming = copy(base); local.exams = [];
  assert.equal(mergeFollowedSemester(local, base, incoming).semester.exams.length, 0);
  incoming.exams[0].location = '远端新考场';
  const result = mergeFollowedSemester(local, base, incoming);
  assert.equal(result.semester.exams.length, 0); assert.equal(result.conflicts[0].type, 'local-delete');
});

test('周次和整套小节数组按原子字段保守合并，避免错拼课间与周次', () => {
  const base = baseline(), local = copy(base), incoming = copy(base);
  local.courses[0].sessions[0].weeks = [1, 3, 5]; incoming.courses[0].sessions[0].weeks = [1, 3, 7];
  local.profiles[0].periods[0].end = '08:40'; incoming.profiles[0].periods[1].start = '09:00';
  const result = mergeFollowedSemester(local, base, incoming);
  assert.equal(result.needsReview, true); assert.equal(result.conflicts.length, 2);
  assert.deepEqual(result.semester.courses[0].sessions[0].weeks, [1, 3, 5]);
  assert.equal(result.semester.profiles[0].periods[0].end, '08:40'); assert.equal(result.semester.profiles[0].periods[1].start, '08:55');
});

test('三方组合可能产生孤立单次变更时返回有效本地版本并要求复核', () => {
  const base = baseline(), local = copy(base), incoming = copy(base);
  local.exceptions.push({ id: 'local-cancel', type: 'cancel', sessionId: local.courses[0].sessions[0].id, sourceDate: '2026-09-21' });
  incoming.courses = []; incoming.exceptions = [];
  const result = mergeFollowedSemester(local, base, incoming);
  assert.equal(result.needsReview, true); assert.match(result.validationError, /原始上课安排/);
  assert.deepEqual(result.semester, validate(local));
  assert.equal(result.conflicts.at(-1).type, 'validation');
});

test('不匹配学期和原始非法分享被拒绝，不生成可写入数据', () => {
  const base = baseline(), incoming = copy(base); incoming.id = 'another-semester';
  assert.throws(() => mergeFollowedSemester(base, base, incoming), /编号不一致/);
  const invalid = semester(); invalid.exceptions[0].sessionId = 'missing';
  assert.throws(() => remapSharedSemester(invalid), /原始上课安排/);
});
