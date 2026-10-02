import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSemester, occurrencesOn } from '../www/engine.js';
import { conflictGroups, arrangementOrigin, conflictSummary, conflictListMarkup } from '../www/conflict-ui.js';
import { renderCourseGrid } from '../www/planner-ui.js';

function fixture() {
  const s = makeSemester({ name: '冲突合成课表', startDate: '2026-09-07', totalWeeks: 16 });
  const c = (id, name, day, start, end) => ({ id, name, shortName: '', color: 1, assessment: '考试', nature: '', note: '', sessions: [{ id: `${id}-session`, day, startPeriod: start, endPeriod: end, weeks: [1, 2, 3, 4], teacher: '老师', location: 'A201', breakMode: 'normal' }] });
  s.courses = [c('original', '原安排高等数学', 1, 1, 2), c('moved', '调入大学英语', 2, 1, 2)];
  s.exceptions = [{ id: 'move', type: 'move', sessionId: 'moved-session', sourceDate: '2026-09-08', date: '2026-09-07', startPeriod: 1, endPeriod: 2, location: 'B202' }];
  return s;
}
const mock = (id, start, end, extra = {}) => ({ id, date: '2026-09-07', kind: 'course', startMs: start, endMs: end, startPeriod: 1, endPeriod: 2, ...extra });

test('按实际时间分组而非节次，相邻端点不冲突；输入不被排序修改', () => {
  const input = [mock('later', 20, 30), mock('first', 0, 10), mock('touch', 10, 20)], before = structuredClone(input);
  assert.deepEqual(conflictGroups(input), []); assert.deepEqual(input, before);
  const groups = conflictGroups([mock('first', 0, 20, { startPeriod: 1, endPeriod: 1 }), mock('second', 10, 30, { startPeriod: 3, endPeriod: 4 })]);
  assert.equal(groups.length, 1); assert.equal(groups[0].startPeriod, 1); assert.equal(groups[0].endPeriod, 4);
});

test('链式重叠作为一组，后续独立冲突分开，不把不同日期合并', () => {
  const groups = conflictGroups([mock('a', 0, 20), mock('b', 10, 30), mock('c', 25, 40), mock('d', 50, 60), mock('e', 55, 65), mock('other-day', 0, 20, { date: '2026-09-08' })]);
  assert.deepEqual(groups.map(g => g.items.map(o => o.id)), [['a', 'b', 'c'], ['d', 'e']]);
  assert.equal(groups[0].endMs, 40);
});

test('单次调入与原安排各有来源标签，整日补课保留源身份', () => {
  const s = fixture(), items = occurrencesOn(s, '2026-09-07');
  assert.equal(arrangementOrigin(s, items.find(o => o.courseId === 'original')).label, '原安排');
  assert.equal(arrangementOrigin(s, items.find(o => o.courseId === 'moved')).label, '调入');
  assert.match(arrangementOrigin(s, items.find(o => o.courseId === 'moved')).description, /2026-09-08/);
  const sameDay = { ...items.find(o => o.courseId === 'moved'), date: '2026-09-08' };
  assert.equal(arrangementOrigin(s, sameDay).label, '单次调整');
  s.dayRules = [{ id: 'rule', type: 'replace', date: '2026-09-12', sourceDate: '2026-09-14', label: '调休' }];
  const makeup = occurrencesOn(s, '2026-09-12')[0];
  assert.equal(arrangementOrigin(s, makeup).label, '整日补课'); assert.match(arrangementOrigin(s, makeup).description, /2026-09-14/);
});

test('考试可连接两个课程冲突组，考试不占课程节次跨度且单独标记', () => {
  const groups = conflictGroups([mock('a', 0, 10, { startPeriod: 1, endPeriod: 2 }), mock('exam', 5, 25, { kind: 'exam', startPeriod: 0, endPeriod: 0 }), mock('b', 20, 30, { startPeriod: 3, endPeriod: 4 })]);
  const group = groups[0]; assert.equal(group.items.length, 3); assert.equal(group.startPeriod, 1); assert.equal(group.endPeriod, 4);
  assert.equal(conflictSummary(group), '2 门课程与 1 场考试时间重叠'); assert.equal(arrangementOrigin(fixture(), group.exams[0]).label, '独立考试');
});

test('两门重叠生成整列卡且各自保留详情和进度节点，普通课程保持普通卡', () => {
  const s = fixture(), date = '2026-09-07', items = occurrencesOn(s, date);
  let html = renderCourseGrid({ semester: s, dates: [date], groups: [items], maxPeriods: 12 });
  assert.match(html, /class="conflict-stack has-members/); assert.match(html, /grid-row:1\/span 2/);
  assert.match(html, /data-action="conflict-detail"/); assert.match(html, /原安排/); assert.match(html, /调入/);
  for (const o of items) { assert.ok(html.includes(`data-live-id="${o.id}"`)); assert.ok(html.includes(`data-id="${o.id}"`)); }
  assert.doesNotMatch(html, /width:50%|margin-left:50%/);
  s.exceptions = []; html = renderCourseGrid({ semester: s, dates: [date], groups: [occurrencesOn(s, date)], maxPeriods: 12 });
  assert.match(html, /class="course-block c1"/); assert.doesNotMatch(html, /class="conflict-stack/);
});

test('课程网格含与考试跨区冲突，清单保留全名、日期、节次、地点和考试入口', () => {
  const s = fixture();
  s.exams = [{ id: 'exam', name: '独立期末考试', date: '2026-09-07', startTime: '08:30', endTime: '09:30', location: '专用考场', note: '' }];
  const items = occurrencesOn(s, '2026-09-07'), group = conflictGroups(items)[0];
  const grid = renderCourseGrid({ semester: s, dates: ['2026-09-07'], groups: [items.filter(o => o.kind === 'course')], maxPeriods: 12 });
  assert.match(grid, /含独立考试/); assert.match(grid, /3项重叠/);
  const details = conflictListMarkup(s, group, new Date(2026, 8, 7, 8, 35).getTime());
  for (const o of items) { assert.ok(details.includes(o.name)); assert.ok(details.includes(o.location)); assert.ok(details.includes(`data-id="${o.id}"`)); }
  assert.match(details, /第 1–2 节 · 08:00–09:40/); assert.match(details, /独立考试 · 08:30–09:30/); assert.match(details, /进行中/);
  assert.match(details, /data-live-id="exam:exam"/);
});

test('连通组清单逐项只写直接重叠对象，不声称首尾课程彼此重叠', () => {
  const s = fixture(), items = occurrencesOn(s, '2026-09-07'), base = items[0];
  const connected = [mock('a', 0, 20, { ...base, id: 'a', name: 'A课', startMs: 0, endMs: 20 }), mock('b', 10, 30, { ...base, id: 'b', name: 'B课', startMs: 10, endMs: 30 }), mock('c', 25, 40, { ...base, id: 'c', name: 'C课', startMs: 25, endMs: 40 })];
  const html = conflictListMarkup(s, conflictGroups(connected)[0], -1000);
  const first = html.split('data-id="a"')[1].split('</button>')[0]; assert.match(first, /与 B课 重叠/); assert.doesNotMatch(first, /与 .*C课/);
});

test('拥挤组明确展示总数与全部入口，当前课程槽位保留；恶意课名转义', () => {
  const s = fixture(), date = '2026-09-07';
  s.courses.push({ ...structuredClone(s.courses[0]), id: 'third', name: '<img src=x onerror=alert(1)>', sessions: [{ ...structuredClone(s.courses[0].sessions[0]), id: 'third-session' }] });
  const items = occurrencesOn(s, date), html = renderCourseGrid({ semester: s, dates: [date], groups: [items], maxPeriods: 12 });
  assert.match(html, /is-folded/); assert.match(html, /3门重叠/); assert.match(html, /3 项安排/); assert.match(html, /data-conflict-current/);
  for (const o of items) assert.ok(html.includes(o.id));
  const details = conflictListMarkup(s, conflictGroups(items)[0]); assert.match(details, /&lt;img src=x onerror=alert\(1\)&gt;/); assert.doesNotMatch(details, /<img src=x/);
});
