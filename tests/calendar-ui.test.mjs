import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSemester, occurrencesOn } from '../www/engine.js';
import { adjustmentDates, planDayAdjustment, sourceTeachingWeeks, courseOccurrences, planSingleChange } from '../www/calendar-ui.js';

function fixture() {
  const s = makeSemester({ name: '日历交互验证', startDate: '2026-09-07', totalWeeks: 16 });
  s.courses = [{ id: 'math', name: '高等数学', shortName: '', color: 1, assessment: '考试', nature: '必修', note: '', sessions: [{ id: 'math-mon', day: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 3, 5], teacher: '林老师', location: 'A201', breakMode: 'normal' }] }];
  return s;
}
const move = (date, extra = {}) => ({ action: 'adjust', date, startPeriod: 3, endPeriod: 4, location: 'B302', teacher: '周老师', note: '临时安排', ...extra });

test('日期入口可跨月多选和连续范围，拒绝空选与倒序范围', () => {
  assert.deepEqual(adjustmentDates({ dateMode: 'multiple' }, ['2026-11-02', '2026-10-31', '2026-10-31']), ['2026-10-31', '2026-11-02']);
  assert.deepEqual(adjustmentDates({ dateMode: 'range', rangeStart: '2026-10-30', rangeEnd: '2026-11-02' }), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.throws(() => adjustmentDates({ dateMode: 'multiple' }, []), /至少一个日期/);
  assert.throws(() => adjustmentDates({ dateMode: 'range', rangeStart: '2026-11-01', rangeEnd: '2026-10-31' }), /结束日期/);
});

test('批量停课预览不修改原课表，独立考试仍保留', () => {
  const s = fixture();
  s.exams = [{ id: 'exam', name: '数学考试', date: '2026-09-07', startTime: '09:00', endTime: '10:00', location: '考场', note: '' }];
  const before = structuredClone(s), plan = planDayAdjustment(s, { dateMode: 'range', rangeStart: '2026-09-07', rangeEnd: '2026-09-09', type: 'off' });
  assert.equal(plan.rules.length, 3); assert.deepEqual(s, before);
  assert.deepEqual(occurrencesOn(plan.semester, '2026-09-07').map(o => o.kind), ['exam']);
});

test('星期补课保留明确来源周的单双周语义，源日不再重复', () => {
  const plan = planDayAdjustment(fixture(), { dateMode: 'single', date: '2026-09-20', type: 'replace', sourceMode: 'weekday', sourceWeekday: 1, sourceWeekMode: 'fixed', sourceWeek: 1 });
  assert.equal(plan.rules[0].sourceDate, '2026-09-07');
  assert.equal(occurrencesOn(plan.semester, '2026-09-07').length, 0);
  assert.equal(occurrencesOn(plan.semester, '2026-09-20')[0].sourceDate, '2026-09-07');
  const even = planDayAdjustment(fixture(), { dateMode: 'single', date: '2026-09-20', type: 'replace', sourceMode: 'weekday', sourceWeekday: 1, sourceWeekMode: 'target' });
  assert.equal(even.rules[0].sourceDate, '2026-09-14'); assert.equal(occurrencesOn(even.semester, '2026-09-20').length, 0);
});

const weekdaySource = (mode, week, extra = {}) => ({ dateMode: 'single', date: '2026-09-20', type: 'replace', sourceMode: 'weekday', sourceWeekday: 1, sourceWeekMode: mode, sourceWeek: week, ...extra });

test('来源教学周单周和双周分别读取指定周的课程，保存精确日期且不改原课表', () => {
  const s = fixture();
  s.courses.push({ ...structuredClone(s.courses[0]), id: 'even', name: '双周课程', sessions: [{ ...structuredClone(s.courses[0].sessions[0]), id: 'even-mon', weeks: [2, 4, 6] }] });
  const before = structuredClone(s);
  const odd = planDayAdjustment(s, weekdaySource('odd', 3));
  assert.equal(odd.rules[0].sourceDate, '2026-09-21');
  assert.deepEqual(occurrencesOn(odd.semester, '2026-09-20').map(o => o.name), ['高等数学']);
  assert.equal(occurrencesOn(odd.semester, '2026-09-21').length, 0);
  assert.equal(occurrencesOn(odd.semester, '2026-09-07').length, 1);
  const even = planDayAdjustment(s, weekdaySource('even', 2));
  assert.equal(even.rules[0].sourceDate, '2026-09-14');
  assert.deepEqual(occurrencesOn(even.semester, '2026-09-20').map(o => o.name), ['双周课程']);
  assert.equal(occurrencesOn(even.semester, '2026-09-14').length, 0);
  assert.deepEqual(s, before);
});

test('单双周必须明确指定来源周，拒绝不匹配和未知模式，不自动挪到邻周', () => {
  const s = fixture();
  for (const mode of ['odd', 'even']) for (const week of ['', undefined, null]) assert.throws(() => planDayAdjustment(s, weekdaySource(mode, week)), /具体的来源教学周/);
  assert.throws(() => planDayAdjustment(s, weekdaySource('odd', 2)), /请选择单周/);
  assert.throws(() => planDayAdjustment(s, weekdaySource('even', 3)), /请选择双周/);
  assert.throws(() => planDayAdjustment(s, weekdaySource('nearest', 3)), /来源教学周方式/);
  for (const week of [0, 17, 1.5, 'invalid']) assert.throws(() => planDayAdjustment(s, weekdaySource('odd', week)), /来源教学周/);
});

test('来源单双周候选按学期周次跨年计算，包含末周并处理没有双周的学期', () => {
  const s = makeSemester({ name: '跨年', startDate: '2026-12-28', totalWeeks: 5 });
  assert.deepEqual(sourceTeachingWeeks(s, 1, 'odd').map(({ week, date }) => [week, date]), [[1, '2026-12-28'], [3, '2027-01-11'], [5, '2027-01-25']]);
  assert.deepEqual(sourceTeachingWeeks(s, 1, 'even').map(({ week, date }) => [week, date]), [[2, '2027-01-04'], [4, '2027-01-18']]);
  assert.equal(sourceTeachingWeeks(s, 7, 'odd').at(-1).date, '2027-01-31');
  s.totalWeeks = 1;
  assert.deepEqual(sourceTeachingWeeks(s, 1, 'even'), []);
  assert.throws(() => sourceTeachingWeeks(s, 1, 'unknown'), /方式无效/);
  assert.throws(() => sourceTeachingWeeks(s, 8, 'odd'), /补课星期/);
});

test('非周一开学的来源候选排除开学前日期，提交也不能绕过', () => {
  const s = makeSemester({ name: '周三开学', startDate: '2026-09-09', totalWeeks: 5 });
  assert.deepEqual(sourceTeachingWeeks(s, 1, 'odd').map(x => x.week), [3, 5]);
  assert.deepEqual(sourceTeachingWeeks(s, 3, 'odd').map(x => x.week), [1, 3, 5]);
  assert.throws(() => planDayAdjustment(s, weekdaySource('odd', 1)), /早于实际开学日/);
  assert.equal(planDayAdjustment(s, weekdaySource('odd', 1, { sourceWeekday: 3 })).rules[0].sourceDate, '2026-09-09');
});

test('单双周来源继续拒绝多目标复用、已用来源、同日及连锁补课', () => {
  const s = fixture(), before = structuredClone(s);
  assert.throws(() => planDayAdjustment(s, weekdaySource('odd', 1, { dateMode: 'multiple' }), ['2026-09-19', '2026-09-20']), /补课来源日期/);
  assert.throws(() => planDayAdjustment(s, weekdaySource('odd', 1, { date: '2026-09-07' })), /不能与原日期相同/);
  const first = planDayAdjustment(s, weekdaySource('odd', 1)).semester;
  assert.throws(() => planDayAdjustment(first, weekdaySource('odd', 1, { date: '2026-09-27' })), /补课来源日期/);
  assert.throws(() => planDayAdjustment(first, weekdaySource('even', 2, { sourceWeekday: 7, date: '2026-09-27' })), /连锁|整日/);
  assert.deepEqual(s, before);
});

test('多个补课目标按排序映射来源日，不静默覆盖或复用同一来源', () => {
  const s = fixture(), plan = planDayAdjustment(s, { dateMode: 'multiple', type: 'replace', sourceMode: 'date', sourceDate: '2026-09-07' }, ['2026-09-20', '2026-09-19']);
  assert.deepEqual(plan.rules.map(r => [r.date, r.sourceDate]), [['2026-09-19', '2026-09-07'], ['2026-09-20', '2026-09-08']]);
  assert.throws(() => planDayAdjustment(plan.semester, { dateMode: 'single', date: '2026-09-19', type: 'off' }), /已有整日规则/);
  assert.throws(() => planDayAdjustment(s, { dateMode: 'multiple', type: 'replace', sourceMode: 'weekday', sourceWeekday: 1, sourceWeekMode: 'fixed', sourceWeek: 1 }, ['2026-09-19', '2026-09-20']), /补课来源日期/);
});

test('单次入口只列真实上课实例，排除停课、取消及独立考试', () => {
  const s = fixture();
  s.dayRules = [{ id: 'off', date: '2026-09-07', type: 'off', label: '' }];
  s.exceptions = [{ id: 'cancel', sessionId: 'math-mon', sourceDate: '2026-09-21', type: 'cancel' }];
  s.exams = [{ id: 'exam', name: '数学考试', date: '2026-09-07', startTime: '09:00', endTime: '10:00', location: '', note: '', courseId: 'math' }];
  assert.deepEqual(courseOccurrences(s, 'math').map(o => o.date), ['2026-10-05']);
  assert.throws(() => planSingleChange(s, 'math-mon@2026-09-07', move('2026-09-08')), /原上课安排已变化/);
  assert.throws(() => planSingleChange(s, 'exam:exam', move('2026-09-08')), /原上课安排已变化/);
});

test('对整日补课产生的实例单次调课仍使用原始源身份', () => {
  const s = fixture(); s.dayRules = [{ id: 'replace', date: '2026-09-12', sourceDate: '2026-09-07', type: 'replace', label: '调休' }];
  const o = courseOccurrences(s)[0], plan = planSingleChange(s, o.id, move('2026-09-13', { occurrenceDate: '2026-09-12' }));
  assert.equal(o.date, '2026-09-12'); assert.equal(plan.exception.sourceDate, '2026-09-07'); assert.equal(plan.exception.sessionId, 'math-mon');
  assert.equal(occurrencesOn(plan.semester, '2026-09-07').length, 0); assert.equal(occurrencesOn(plan.semester, '2026-09-12').length, 0);
  assert.equal(plan.target.date, '2026-09-13'); assert.equal(plan.target.location, 'B302'); assert.equal(plan.target.teacher, '周老师');
  assert.equal(occurrencesOn(plan.semester, '2026-09-21').length, 1);
});

test('补课实例移回已被消费的来源日应使用 move，留在补课日改教室可用 modify', () => {
  const s = fixture(); s.dayRules = [{ id: 'replace', date: '2026-09-12', sourceDate: '2026-09-07', type: 'replace', label: '' }];
  const back = planSingleChange(s, 'math-mon@2026-09-07', move('2026-09-07'));
  assert.equal(back.exception.type, 'move'); assert.equal(back.target.date, '2026-09-07'); assert.equal(occurrencesOn(back.semester, '2026-09-12').length, 0);
  const same = planSingleChange(s, 'math-mon@2026-09-07', move('2026-09-12'));
  assert.equal(same.exception.type, 'modify'); assert.equal(same.target.date, '2026-09-12');
});

test('再次编辑同一实例替换原例外，拒绝失效日期草稿，取消不影响其他周', () => {
  const first = planSingleChange(fixture(), 'math-mon@2026-09-07', move('2026-09-09'));
  assert.throws(() => planSingleChange(first.semester, first.target.id, move('2026-09-10', { occurrenceDate: '2026-09-07' })), /原上课安排已变化/);
  const second = planSingleChange(first.semester, first.target.id, move('2026-09-10'));
  assert.equal(second.semester.exceptions.length, 1); assert.equal(second.exception.id, first.exception.id); assert.equal(occurrencesOn(second.semester, '2026-09-09').length, 0);
  const cancel = planSingleChange(second.semester, second.target.id, { action: 'cancel' });
  assert.equal(occurrencesOn(cancel.semester, '2026-09-10').length, 0); assert.equal(occurrencesOn(cancel.semester, '2026-09-21').length, 1);
});

test('调课预览按目标日期的季节作息提示与考试重叠和停课日安排', () => {
  const s = fixture();
  s.profiles.push({ id: 'winter', name: '冬季', effectiveFrom: '10-01', periods: s.profiles[0].periods.map(p => ({ ...p, start: `${String(Number(p.start.slice(0, 2)) + 1).padStart(2, '0')}${p.start.slice(2)}`, end: `${String(Number(p.end.slice(0, 2)) + 1).padStart(2, '0')}${p.end.slice(2)}` })) });
  s.exams = [{ id: 'exam', name: '独立考试', date: '2026-10-11', startTime: '09:00', endTime: '11:00', location: '考场', note: '' }];
  s.dayRules = [{ id: 'off', date: '2026-10-11', type: 'off', label: '' }];
  const plan = planSingleChange(s, 'math-mon@2026-09-07', move('2026-10-11', { startPeriod: 1, endPeriod: 2 }));
  assert.equal(plan.target.segments[0].start, s.profiles[1].periods[0].start);
  assert.equal(plan.target.conflict, true); assert.equal(plan.target.onOffDay, true); assert.deepEqual(plan.target.conflicts, ['exam:exam']);
});
