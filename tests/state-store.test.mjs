import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, createCourse } from '../www/core.js';
import { createState, makeSemester } from '../www/engine.js';
import { loadState, commitState, recoveries, STATE_KEY } from '../www/state-store.js';

function storage(entries = {}) {
  const values = new Map(Object.entries(entries));
  const instance = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: key => values.delete(key),
  };
  globalThis.localStorage = instance;
  return instance;
}
const legacy = () => ({ version: 1, settings: structuredClone(DEFAULT_SETTINGS), courses: Array.from({ length: 15 }, (_, i) => createCourse({ id: `legacy-${i}`, name: `课程 ${i}`, day: i % 7 + 1, startPeriod: 1, endPeriod: 2, weeks: [1, 3], location: `教室 ${i}`, teacher: `教师 ${i}`, note: `备注 ${i}` })) });

test('首次升级在写 v2 之前保留原文，并完整保留 15 条安排', () => {
  const old = legacy(), raw = JSON.stringify(old), store = storage({ 'qingke.data.v1': raw });
  const migrated = loadState();
  assert.equal(migrated.version, 2);
  assert.equal(migrated.semesters[0].courses.length, 15);
  assert.equal(store.getItem('qingke.data.v1'), raw);
  assert.equal(recoveries()[0].kind, 'upgrade');
  assert.equal(recoveries()[0].raw, raw);
  const persisted = JSON.parse(store.getItem(STATE_KEY));
  assert.deepEqual(persisted, migrated);
  assert.deepEqual(loadState(), migrated);
  assert.equal(recoveries().length, 1);
});

test('多次编辑持续保留升级前版本，普通恢复版本最多四份', () => {
  storage({ 'qingke.data.v1': JSON.stringify(legacy()) });
  let current = loadState();
  for (let i = 0; i < 7; i++) {
    const next = structuredClone(current); next.semesters[0].name = `变更 ${i}`;
    current = commitState(next, `编辑前 ${i}`);
  }
  const history = recoveries();
  assert.equal(history.filter(x => x.kind === 'upgrade').length, 1);
  assert.equal(history.filter(x => x.kind === 'change').length, 4);
  assert.equal(history.length, 5);
  assert.equal(loadState().semesters[0].name, '变更 6');
  assert.ok(history.some(x => JSON.parse(x.raw).semesters?.[0].name === '变更 5'));
});

test('校验失败及磁盘写入失败均保留旧课表', () => {
  const initial = createState(), raw = JSON.stringify(initial), store = storage({ [STATE_KEY]: raw });
  const bad = structuredClone(initial); bad.semesters[0].courses = null;
  assert.throws(() => commitState(bad, '非法恢复前'));
  assert.equal(store.getItem(STATE_KEY), raw);
  assert.equal(recoveries().length, 0);
  const next = structuredClone(initial); next.semesters[0].name = '新名称';
  const setItem = store.setItem;
  store.setItem = (key, value) => { if (key === STATE_KEY) throw new Error('quota exceeded'); setItem(key, value); };
  assert.throws(() => commitState(next, '编辑前'), /quota/);
  assert.equal(store.getItem(STATE_KEY), raw);
  assert.equal(recoveries()[0].raw, raw);
});

test('恢复历史版本之前保留当前全部学期，导入元数据往返不丢失', () => {
  storage({ 'qingke.data.v1': JSON.stringify(legacy()) });
  const initial = loadState(), next = structuredClone(initial);
  const course = next.semesters[0].courses[0], session = course.sessions[0];
  session.importSource = { kind: 'pdf', source: '教务课表', key: 'imported', snapshot: { name: course.name, day: session.day, startPeriod: session.startPeriod, endPeriod: session.endPeriod, weeks: [...session.weeks], teacher: session.teacher, location: session.location } };
  next.semesters.push(makeSemester({ name: '另一学期', startDate: '2027-03-01' }));
  next.activeSemesterId = next.semesters[1].id;
  const saved = commitState(next, '新增学期前');
  assert.deepEqual(loadState(), saved);
  const restored = commitState(initial, '恢复备份前');
  assert.equal(restored.semesters.length, 1);
  const beforeRestore = recoveries().find(x => x.label === '恢复备份前');
  const backedUp = JSON.parse(beforeRestore.raw);
  assert.equal(backedUp.semesters.length, 2);
  assert.deepEqual(backedUp.semesters[0].courses[0].sessions[0].importSource, session.importSource);
});

test('旧 v2 年度格式升级先保存原文，保留 v1 重要快照且不会每次加载重复升级', () => {
  const originalV1 = JSON.stringify(legacy());
  const store = storage({ 'qingke.data.v1': originalV1 });
  const oldV2 = loadState();
  oldV2.semesters[0].profiles[0].effectiveFrom = '2026-09-07';
  oldV2.semesters[0].profiles[0].periods = oldV2.semesters[0].profiles[0].periods.map(({ start, end }) => ({ start, end }));
  delete oldV2.semesters[0].exams; delete oldV2.preferences.shareServerUrl;
  const originalV2 = JSON.stringify(oldV2); store.setItem(STATE_KEY, originalV2);
  const migrated = loadState();
  assert.equal(migrated.semesters[0].profiles[0].effectiveFrom, '09-07');
  assert.deepEqual(migrated.semesters[0].exams, []);
  assert.equal(migrated.semesters[0].courses.length, 15);
  assert.equal(recoveries().find(x => x.kind === 'upgrade').raw, originalV1);
  assert.equal(recoveries().find(x => x.kind === 'schema-upgrade').raw, originalV2);
  assert.deepEqual(loadState(), migrated);
  assert.equal(recoveries().length, 2);
  for (let i = 0; i < 6; i++) { const next = loadState(); next.semesters[0].name = `新版编辑 ${i}`; commitState(next, '编辑前'); }
  assert.equal(recoveries().filter(x => x.kind === 'change').length, 4);
  assert.equal(recoveries().filter(x => x.kind === 'upgrade').length, 1);
  assert.equal(recoveries().filter(x => x.kind === 'schema-upgrade').length, 1);
});
