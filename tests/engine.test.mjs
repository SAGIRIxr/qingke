import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, createCourse, validateBackup, getWeek, getWeekDates } from '../www/core.js';
import { createState, makeSemester, migrateState, validateState, getProfile, occurrencesOn, occurrenceStatus, notificationEvents, addDays, localDate, dateForWeekday, shiftPeriodGroup, setGroupStart, copyPeriodGroup, configurePeriodGroup, updatePeriodTime } from '../www/engine.js';

function course(overrides = {}) {
  return { id: 'c1', name: '高等数学', shortName: '高数', color: 1, assessment: '考试', nature: '必修', note: '带教材', sessions: [{ id: 's1', day: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 3], teacher: '王老师', location: 'A201', breakMode: 'normal' }], ...overrides };
}
function state() {
  const s = createState(), semester = makeSemester({ name: '秋季', startDate: '2026-09-07', totalWeeks: 20 });
  semester.courses = [course()]; s.semesters = [semester]; s.activeSemesterId = semester.id; return s;
}
const at = (h, minute, day = 7) => new Date(2026, 8, day, h, minute);

test('初始偏好不内置学校网址，默认状态可直接保存', () => {
  const value = createState();
  assert.equal(value.preferences.schoolUrl, '');
  assert.equal(value.preferences.notifications.enabled, false);
  assert.equal(value.preferences.notifications.statusMode, 'remaining');
  assert.deepEqual(validateState(value), value);
});

test('v1 升级逐条保留课程，不因同名而合并，不共享源对象', () => {
  const old = { version: 1, settings: structuredClone(DEFAULT_SETTINGS), courses: [
    createCourse({ id: 'a', name: '高数', teacher: '甲', location: 'A201', day: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 3], note: '原备注' }),
    createCourse({ id: 'b', name: '高数', teacher: '乙', location: 'B201', day: 3, startPeriod: 3, endPeriod: 4, weeks: [2, 4] }),
  ] };
  const result = migrateState(old), semester = result.semesters[0];
  assert.equal(semester.courses.length, 2);
  assert.equal(semester.courses[0].id, 'a');
  assert.equal(semester.courses[0].note, '原备注');
  assert.deepEqual(semester.courses[1].sessions[0].weeks, [2, 4]);
  assert.equal(semester.courses[0].assessment, '未设置');
  assert.equal(semester.startDate, old.settings.semesterStart);
  semester.courses[0].sessions[0].weeks.push(5);
  assert.deepEqual(old.courses[0].weeks, [1, 3]);
});

test('新课程最多 24 节，旧版本备份仍严格要求 12 节', () => {
  const input = { id: 'p13', name: '晚自习', day: 1, startPeriod: 13, endPeriod: 13, weeks: [1] };
  assert.equal(createCourse(input).startPeriod, 13);
  assert.throws(() => validateBackup({ version: 1, settings: DEFAULT_SETTINGS, courses: [input] }), /12/);
  assert.throws(() => createCourse({ ...input, endPeriod: 25 }), /24/);
});

test('校验拒绝坏备份、重叠作息、未知学期、重复安排编号和危险网址', () => {
  const mutations = [
    x => { x.version = 3; },
    x => { x.activeSemesterId = 'missing'; },
    x => { x.semesters[0].startDate = '2026-02-30'; },
    x => { x.semesters[0].profiles[0].periods[1].start = '08:10'; },
    x => { x.semesters[0].profiles[0].effectiveFrom = '02-30'; },
    x => { x.semesters[0].courses[0].sessions[0].weeks = [21]; },
    x => { x.semesters[0].courses[0].sessions.push(structuredClone(x.semesters[0].courses[0].sessions[0])); },
    x => { x.preferences.notifications.enabled = 'true'; },
    x => { x.preferences.schoolUrl = 'javascript:alert(1)'; },
    x => { x.preferences.schoolUrl = 'https://user:pass@example.com/'; },
  ];
  for (const mutate of mutations) { const value = state(); mutate(value); assert.throws(() => validateState(value)); }
  assert.throws(() => migrateState({ version: 99 }));
});

test('状态规范化保留导入历史快照且深拷贝，不丢考核方式与多次安排', () => {
  const value = state(), c = value.semesters[0].courses[0];
  c.assessment = '作品答辩';
  c.sessions[0].importSource = { kind: 'pdf', source: '正方 PDF', key: 'orig-1', snapshot: { name: '高等数学', day: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 3], teacher: '王老师', location: 'A201' } };
  c.sessions.push({ ...structuredClone(c.sessions[0]), id: 's2', day: 3, location: 'B301' });
  const result = validateState(value);
  assert.equal(result.semesters[0].courses[0].assessment, '作品答辩');
  assert.equal(occurrencesOn(result.semesters[0], '2026-09-09')[0].location, 'B301');
  result.semesters[0].courses[0].sessions[0].importSource.snapshot.weeks.push(5);
  assert.deepEqual(c.sessions[0].importSource.snapshot.weeks, [1, 3]);
});

test('跨周整日补课保留来源周次，原日自动去重，采用目标日的冬季作息', () => {
  const value = state(), s = value.semesters[0];
  s.profiles.push({ id: 'winter', name: '冬季', effectiveFrom: '2026-09-14', periods: s.profiles[0].periods.map((p, i) => i === 0 ? { start: '07:50', end: '08:35' } : p) });
  s.dayRules.push({ id: 'r1', type: 'replace', date: '2026-09-19', sourceDate: '2026-09-07', label: '补第一周周一' });
  validateState(value);
  assert.equal(occurrencesOn(s, '2026-09-07').length, 0);
  assert.equal(occurrencesOn(s, '2026-09-14').length, 0);
  const moved = occurrencesOn(s, '2026-09-19')[0];
  assert.equal(moved.sourceDate, '2026-09-07');
  assert.equal(moved.date, '2026-09-19');
  assert.equal(moved.segments[0].start, '07:50');
  assert.equal(moved.day, 6);
  assert.equal(getProfile(s, '2026-09-13').name, '默认作息');
  assert.equal(getProfile(s, '2026-09-14').name, '冬季');
  assert.equal(occurrencesOn(s, '2026-09-21')[0].segments[0].start, '07:50');
});

test('整日补课覆盖目标日原课；源日停课标记仍允许补课', () => {
  const value = state(), s = value.semesters[0];
  s.courses.push(course({ id: 'c2', name: '周六实验', sessions: [{ ...s.courses[0].sessions[0], id: 's2', day: 6, weeks: [1] }] }));
  s.dayRules = [{ id: 'off', date: '2026-09-07', type: 'off', label: '停课' }, { id: 'rep', date: '2026-09-12', type: 'replace', sourceDate: '2026-09-07', label: '' }];
  validateState(value);
  assert.deepEqual(occurrencesOn(s, '2026-09-12').map(o => o.name), ['高等数学']);
  assert.equal(occurrencesOn(s, '2026-09-07').length, 0);
});

test('重复日期、重复补课来源与循环/连锁整日补课均拒绝', () => {
  const cases = [
    [{ id: '1', date: '2026-09-12', type: 'off' }, { id: '2', date: '2026-09-12', type: 'replace', sourceDate: '2026-09-07' }],
    [{ id: '1', date: '2026-09-12', type: 'replace', sourceDate: '2026-09-07' }, { id: '2', date: '2026-09-19', type: 'replace', sourceDate: '2026-09-07' }],
    [{ id: '1', date: '2026-09-12', type: 'replace', sourceDate: '2026-09-07' }, { id: '2', date: '2026-09-07', type: 'replace', sourceDate: '2026-09-12' }],
  ];
  for (const rules of cases) { const value = state(); value.semesters[0].dayRules = rules; assert.throws(() => validateState(value)); }
});

test('单次取消、跨周移动、地点修改均定位原始实例而不改其他周', () => {
  const value = state(), s = value.semesters[0];
  s.exceptions = [{ id: 'ex1', sessionId: 's1', sourceDate: '2026-09-07', type: 'move', date: '2026-09-15', startPeriod: 3, endPeriod: 4, location: '新教室' }, { id: 'ex2', sessionId: 's1', sourceDate: '2026-09-21', type: 'modify', location: '实验楼', note: '实践课' }];
  validateState(value);
  assert.equal(occurrencesOn(s, '2026-09-07').length, 0);
  const moved = occurrencesOn(s, '2026-09-15')[0];
  assert.equal(moved.startPeriod, 3); assert.equal(moved.location, '新教室'); assert.equal(moved.id, 's1@2026-09-07');
  const modified = occurrencesOn(s, '2026-09-21')[0];
  assert.equal(modified.location, '实验楼'); assert.equal(modified.note, '实践课');
  s.exceptions[0] = { id: 'ex1', sessionId: 's1', sourceDate: '2026-09-07', type: 'cancel' };
  assert.equal(occurrencesOn(s, '2026-09-15').length, 0);
  assert.equal(occurrencesOn(s, '2026-09-07').length, 0);
});

test('整日补课之后仍可取消或移动原始来源的一次课程，不重复生成', () => {
  const value = state(), s = value.semesters[0];
  s.dayRules = [{ id: 'r1', type: 'replace', date: '2026-09-12', sourceDate: '2026-09-07', label: '' }];
  s.exceptions = [{ id: 'ex', type: 'move', sessionId: 's1', sourceDate: '2026-09-07', date: '2026-09-15' }];
  validateState(value);
  assert.equal(occurrencesOn(s, '2026-09-07').length, 0);
  assert.equal(occurrencesOn(s, '2026-09-12').length, 0);
  assert.equal(occurrencesOn(s, '2026-09-15').length, 1);
  assert.equal(notificationEvents(s).filter(o => o.sourceDate === '2026-09-07').length, 1);
});

test('重复单次变更和无原始课程的变更拒绝恢复', () => {
  const value = state(), s = value.semesters[0];
  s.exceptions = [{ id: 'a', sessionId: 's1', sourceDate: '2026-09-14', type: 'cancel' }];
  assert.throws(() => validateState(value), /原始/);
  s.exceptions[0].sourceDate = '2026-09-07';
  s.exceptions.push({ ...s.exceptions[0], id: 'b' });
  assert.throws(() => validateState(value), /重复/);
});

test('两小节的课间状态精确分界，累计授课不计课间，可切换连续上课', () => {
  const occurrence = occurrencesOn(state().semesters[0], '2026-09-07')[0];
  assert.equal(occurrenceStatus(occurrence, at(7, 59)).phase, 'before');
  let status = occurrenceStatus(occurrence, at(8, 28));
  assert.equal(status.phase, 'class'); assert.equal(status.elapsedMs, 28 * 60000); assert.equal(status.remainingMs, 17 * 60000);
  status = occurrenceStatus(occurrence, at(8, 45));
  assert.equal(status.phase, 'break'); assert.equal(status.remainingMs, 10 * 60000);
  status = occurrenceStatus(occurrence, at(8, 50));
  assert.equal(status.elapsedMs, 45 * 60000); assert.equal(status.remainingMs, 5 * 60000); assert.equal(status.nextPeriod, 2);
  status = occurrenceStatus(occurrence, at(8, 55));
  assert.equal(status.phase, 'class'); assert.equal(status.period, 2);
  status = occurrenceStatus(occurrence, at(9, 40));
  assert.equal(status.phase, 'after'); assert.equal(status.elapsedMs, 90 * 60000);
  occurrence.breakMode = 'continuous';
  status = occurrenceStatus(occurrence, at(8, 50));
  assert.equal(status.phase, 'class'); assert.equal(status.elapsedMs, 50 * 60000); assert.equal(status.remainingMs, 50 * 60000);
});

test('没有间隙的相邻小节不会生成假课间', () => {
  const s = state().semesters[0]; s.profiles[0].periods[1] = { start: '08:45', end: '09:30' };
  const occurrence = occurrencesOn(s, '2026-09-07')[0];
  assert.equal(occurrenceStatus(occurrence, at(8, 44)).remainingMs, 46 * 60000);
  assert.equal(occurrenceStatus(occurrence, at(8, 45)).phase, 'class');
});

test('时间冲突显式标记，停课日单次安排也显示警告', () => {
  const s = state().semesters[0];
  s.courses.push(course({ id: 'c2', name: '英语', sessions: [{ ...s.courses[0].sessions[0], id: 's2', startPeriod: 2, endPeriod: 3 }] }));
  const rows = occurrencesOn(s, '2026-09-07');
  assert.equal(rows.length, 2); assert.equal(rows[0].conflict, true); assert.deepEqual(rows[0].conflicts, [rows[1].id]);
  s.dayRules = [{ id: 'off', date: '2026-09-08', type: 'off', label: '' }];
  s.exceptions = [{ id: 'ex', type: 'move', sessionId: 's1', sourceDate: '2026-09-07', date: '2026-09-08' }];
  assert.equal(occurrencesOn(s, '2026-09-08')[0].onOffDay, true);
});

test('通知实例遵从停课和调课，包含学期之外补课，并提供小节时间戳', () => {
  const value = state(), s = value.semesters[0];
  s.exceptions = [{ id: 'ex', type: 'move', sessionId: 's1', sourceDate: '2026-09-07', date: '2027-03-01' }];
  s.dayRules = [{ id: 'off', date: '2026-09-21', type: 'off', label: '放假' }];
  validateState(value);
  const events = notificationEvents(s);
  assert.equal(events.length, 1); assert.equal(events[0].date, '2027-03-01');
  assert.equal(events[0].segments.length, 2);
  assert.equal(events[0].segments[0].startMs, events[0].startMs);
  assert.equal(events[0].segments[1].endMs, events[0].endMs);
  assert.ok(events[0].segments[1].startMs > events[0].segments[0].endMs);
});

test('民用日期运算跨年准确，返回本地日期而非 UTC 日期', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(localDate(new Date(2026, 8, 7, 0, 1)), '2026-09-07');
  assert.throws(() => addDays('2026-02-30', 1));
});

test('作息按月日每年循环，兼容旧完整日期，跨年沿用上一方案', () => {
  const value = state(), s = value.semesters[0], periods = structuredClone(s.profiles[0].periods);
  s.profiles = [
    { id: 'summer', name: '夏季', effectiveFrom: '2026-05-01', periods },
    { id: 'winter', name: '冬季', effectiveFrom: '2026-10-01', periods: structuredClone(periods) },
  ];
  // Legacy objects can be queried before normalization, including in previews.
  assert.equal(getProfile(s, '2027-01-10').name, '冬季');
  assert.equal(getProfile(s, '2027-04-30').name, '冬季');
  assert.equal(getProfile(s, '2027-05-01').name, '夏季');
  assert.equal(getProfile(s, '2028-10-01').name, '冬季');
  const normalized = validateState(value);
  assert.deepEqual(normalized.semesters[0].profiles.map(p => p.effectiveFrom), ['05-01', '10-01']);
  assert.deepEqual(normalized.semesters[0].profiles[0].periods.map(p => p.group), ['morning', 'morning', 'morning', 'morning', 'afternoon', 'afternoon', 'afternoon', 'afternoon', 'evening', 'evening', 'evening', 'evening']);
  assert.equal(s.profiles[0].effectiveFrom, '2026-05-01');
  assert.deepEqual(migrateState(normalized), normalized);
  s.profiles.push({ ...s.profiles[0], id: 'duplicate', effectiveFrom: '2027-05-01' });
  assert.throws(() => validateState(value), /生效日期重复/);
});

test('默认基准作息从 01-01 生效，闰日规则在非闰年三月接续', () => {
  const value = state(), s = value.semesters[0];
  assert.equal(s.profiles[0].effectiveFrom, '01-01');
  s.profiles.push({ ...structuredClone(s.profiles[0]), id: 'leap', name: '闰日后', effectiveFrom: '02-29' });
  validateState(value);
  assert.equal(getProfile(s, '2028-02-29').name, '闰日后');
  assert.equal(getProfile(s, '2027-02-28').name, '默认作息');
  assert.equal(getProfile(s, '2027-03-01').name, '闰日后');
});

test('周三开学仍按周一至周日计周，首周开学前无课，末周不过界', () => {
  const value = state(), s = value.semesters[0]; s.startDate = '2026-09-09'; s.totalWeeks = 2;
  s.courses[0].sessions = [1, 3, 7].map(day => ({ ...s.courses[0].sessions[0], id: `session-${day}`, day, weeks: [1, 2] }));
  validateState(value);
  assert.deepEqual(getWeekDates(s.startDate, 1), ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']);
  assert.equal(getWeek('2026-09-13', s.startDate), 1);
  assert.equal(getWeek('2026-09-14', s.startDate), 2);
  assert.equal(occurrencesOn(s, '2026-09-07').length, 0);
  assert.equal(occurrencesOn(s, '2026-09-09').length, 1);
  assert.equal(occurrencesOn(s, '2026-09-20').length, 1);
  assert.equal(occurrencesOn(s, '2026-09-21').length, 0);
  assert.deepEqual(notificationEvents(s).map(o => o.date), ['2026-09-09', '2026-09-13', '2026-09-14', '2026-09-16', '2026-09-20']);
  s.dayRules.push({ id: 'before-start', type: 'replace', sourceDate: '2026-09-07', date: '2026-09-12', label: '' });
  assert.throws(() => validateState(value), /实际开学/);
});

test('补星期几展开为明确来源日期，保留来源教学周的单双周且排除开学前', () => {
  const s = state().semesters[0];
  assert.equal(dateForWeekday(s, '2026-09-19', 1, 1), '2026-09-07');
  assert.equal(dateForWeekday(s, '2026-09-19', 1), '2026-09-14');
  assert.equal(dateForWeekday(s, '2027-08-01', 1, 3), '2026-09-21');
  assert.throws(() => dateForWeekday(s, '2027-08-01', 1), /来源教学周/);
  s.dayRules.push({ id: 'makeup', type: 'replace', date: '2026-09-19', sourceDate: dateForWeekday(s, '2026-09-19', 1, 1), label: '补第一周周一' });
  assert.equal(occurrencesOn(s, '2026-09-19').length, 1);
  assert.equal(occurrencesOn(s, '2026-09-07').length, 0);
  s.startDate = '2026-09-09';
  assert.throws(() => dateForWeekday(s, '2026-09-12', 1, 1), /早于实际开学/);
  assert.equal(dateForWeekday(s, '2026-09-12', 3, 1), '2026-09-09');
});

test('独立考试使用实际起止时间，参与冲突与提醒，不被整日调休搬移', () => {
  const value = state(), s = value.semesters[0];
  s.exams.push({ id: 'exam1', name: '数学期中考试', date: '2026-09-07', startTime: '08:30', endTime: '10:15', location: '考场 B301', note: '带证件', courseId: 'c1' });
  validateState(value);
  const rows = occurrencesOn(s, '2026-09-07'), exam = rows.find(o => o.kind === 'exam');
  assert.equal(rows.length, 2); assert.ok(rows.every(o => o.conflict));
  assert.equal(exam.examId, 'exam1'); assert.equal(exam.startPeriod, 0); assert.equal(exam.endPeriod, 0);
  assert.equal(exam.segments.length, 1); assert.equal(exam.segments[0].start, '08:30'); assert.equal(exam.segments[0].end, '10:15');
  assert.equal(occurrenceStatus(exam, at(9, 0)).label, '考试中');
  assert.equal(occurrenceStatus(exam, at(9, 0)).remainingMs, 75 * 60000);
  s.dayRules.push({ id: 'off', date: '2026-09-07', type: 'off', label: '教学停课' });
  assert.deepEqual(occurrencesOn(s, '2026-09-07').map(o => o.kind), ['exam']);
  assert.equal(occurrencesOn(s, '2026-09-07')[0].onOffDay, true);
  s.dayRules = [{ id: 'replace', date: '2026-09-12', sourceDate: '2026-09-07', type: 'replace', label: '' }];
  assert.deepEqual(occurrencesOn(s, '2026-09-07').map(o => o.kind), ['exam']);
  assert.deepEqual(occurrencesOn(s, '2026-09-12').map(o => o.kind), ['course']);
  assert.equal(notificationEvents(s).filter(o => o.kind === 'exam').length, 1);
});

test('考试可在学期外独立安排，删除关联课程不丢考试，非法考试拒绝', () => {
  const value = state(), s = value.semesters[0];
  s.exams = [{ id: 'outside', name: '补考', date: '2027-08-20', startTime: '12:10', endTime: '13:20', location: '', note: '', courseId: 'previous-course' }];
  s.courses = [];
  const normalized = validateState(value), events = notificationEvents(normalized.semesters[0]);
  assert.equal(events.length, 1); assert.equal(events[0].date, '2027-08-20');
  assert.equal(events[0].startMs, new Date(2027, 7, 20, 12, 10).getTime());
  for (const patch of [{ date: '2027-02-30' }, { endTime: '12:00' }, { startTime: '25:10' }, { id: '' }, { name: '' }]) {
    const invalid = structuredClone(value); Object.assign(invalid.semesters[0].exams[0], patch); assert.throws(() => validateState(invalid));
  }
  s.exams.push(structuredClone(s.exams[0])); assert.throws(() => validateState(value), /考试编号重复/);
});

test('分组起始时间联动保留内部间隔，不修改其他组或输入', () => {
  const original = structuredClone(DEFAULT_SETTINGS.periods), before = structuredClone(original);
  const shifted = setGroupStart(original, 'afternoon', '14:30');
  assert.equal(shifted[4].start, '14:30'); assert.equal(shifted[5].start, '15:25'); assert.equal(shifted[7].end, '18:10');
  assert.equal(shifted[3].end, original[3].end); assert.equal(shifted[8].start, original[8].start);
  assert.deepEqual(original, before);
  assert.throws(() => shiftPeriodGroup(original, 'afternoon', 120), /不重叠/);
  assert.throws(() => shiftPeriodGroup(original, 'evening', 180), /超出当天/);
  const copied = copyPeriodGroup(shifted, original, 'afternoon', -10);
  assert.equal(copied[4].start, '14:20'); assert.equal(copied[8].start, original[8].start);
  assert.throws(() => copyPeriodGroup(original.slice(0, 7), original, 'afternoon'), /节次数量/);
});

test('分组均匀配置支持课时与课间时长，并验证跨组重叠', () => {
  const periods = structuredClone(DEFAULT_SETTINGS.periods);
  const configured = configurePeriodGroup(periods, 'morning', { startTime: '08:10', durationMinutes: 40, breakMinutes: 5 });
  assert.deepEqual(configured.slice(0, 4).map(p => [p.start, p.end]), [['08:10', '08:50'], ['08:55', '09:35'], ['09:40', '10:20'], ['10:25', '11:05']]);
  assert.equal(configured[4].start, '14:00');
  assert.throws(() => configurePeriodGroup(periods, 'morning', { startTime: '12:00' }), /不重叠/);
  assert.throws(() => configurePeriodGroup(periods, 'morning', { durationMinutes: 0 }), /每节课/);
});

test('改单节开始保持时长，改结束保持开始，只顺延同组后续且可关闭联动', () => {
  const original = structuredClone(DEFAULT_SETTINGS.periods), before = structuredClone(original);
  const later = updatePeriodTime(original, 2, 'start', '10:05');
  assert.deepEqual(later.slice(2, 4).map(p => [p.start, p.end]), [['10:05', '10:50'], ['11:00', '11:45']]);
  assert.equal(later[1].end, '09:40'); assert.equal(later[4].start, '14:00');
  const shorter = updatePeriodTime(original, 2, 'end', '10:40');
  assert.equal(shorter[2].start, '10:00'); assert.equal(shorter[3].start, '10:50');
  const independent = updatePeriodTime(original, 2, 'end', '10:40', { cascade: false });
  assert.equal(independent[3].start, '10:55');
  assert.throws(() => updatePeriodTime(original, 3, 'end', '14:05'), /不重叠/);
  assert.throws(() => updatePeriodTime(original, 2, 'end', '09:55'), /递增/);
  assert.throws(() => updatePeriodTime(original, 2, 'start', '09:30'), /不重叠/);
  assert.deepEqual(original, before);
});

test('自定义节次分组会被保存，并决定联动范围', () => {
  const value = state(), periods = value.semesters[0].profiles[0].periods;
  periods[3].group = 'afternoon';
  const result = validateState(value);
  assert.equal(result.semesters[0].profiles[0].periods[3].group, 'afternoon');
  const changed = updatePeriodTime(periods, 2, 'end', '10:40');
  assert.equal(changed[3].start, periods[3].start);
  assert.throws(() => validateState({ ...value, semesters: [{ ...value.semesters[0], profiles: [{ ...value.semesters[0].profiles[0], periods: [{ ...periods[0], group: 'night' }] }] }] }), /分组/);
});

test('分享服务地址可选，持久化仅接受 HTTPS 根地址', () => {
  const value = state(); delete value.preferences.shareServerUrl;
  assert.equal(validateState(value).preferences.shareServerUrl, '');
  for (const url of ['https://share.example.com', 'https://share.example.com/', 'https://share.example.com:8443/']) {
    value.preferences.shareServerUrl = url; assert.equal(validateState(value).preferences.shareServerUrl, url);
  }
  for (const url of ['http://share.example.com', 'https://user:pass@share.example.com', 'https://share.example.com/api', 'https://share.example.com/?a=1', 'https://share.example.com/#code', 'https://share.example.com/?', 'https://share.example.com/#']) {
    value.preferences.shareServerUrl = url; assert.throws(() => validateState(value), /分享服务/);
  }
});
