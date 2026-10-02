import { DEFAULT_SETTINGS, getWeek, getWeekDates, validateBackup } from './core.js';

const DAY = 86400000;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const object = (value, label) => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式无效`); return value; };
const list = (value, max, label, min = 0) => { if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${label}数量应为 ${min}—${max}`); return value; };
const str = (value, max, label, required = false) => { if (value != null && typeof value !== 'string') throw new Error(`${label}应为文字`); const result = (value ?? '').trim(); if ((required && !result) || result.length > max) throw new Error(`${label}为空或超过 ${max} 字`); return result; };
const num = (value, min, max, label) => { if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(`${label}应为 ${min}—${max} 之间的整数`); return Number(value); };
const bool = (value, label) => { if (typeof value !== 'boolean') throw new Error(`${label}应为开关值`); return value; };
const enumeration = (value, choices, label) => { if (!choices.includes(value)) throw new Error(`${label}无效`); return value; };
function civil(value, label = '日期') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}格式应为 YYYY-MM-DD`);
  const [y, m, d] = value.split('-').map(Number), ms = Date.UTC(y, m - 1, d);
  if (y < 1900 || y > 2200 || new Date(ms).toISOString().slice(0, 10) !== value) throw new Error(`${label}不存在或年份无效`);
  return ms;
}
const date = (value, label) => { civil(value, label); return value; };
const dayOf = value => new Date(civil(value)).getUTCDay() || 7;
const weekOf = (semester, value) => getWeek(value, semester.startDate);
const unique = (items, key, label) => { const seen = new Set(); for (const item of items) { const value = key(item); if (seen.has(value)) throw new Error(`${label}重复`); seen.add(value); } };
export function localDate(value = new Date()) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('日期无效'); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }
export function addDays(value, days) { if (!Number.isInteger(days)) throw new Error('日期增量应为整数'); return new Date(civil(value) + days * DAY).toISOString().slice(0, 10); }
const at = (value, time) => { const [y, m, d] = value.split('-').map(Number), [h, minute] = time.split(':').map(Number); return new Date(y, m - 1, d, h, minute).getTime(); };
const GROUPS = ['morning', 'afternoon', 'evening'];
const defaultGroup = index => index < 4 ? 'morning' : index < 8 ? 'afternoon' : 'evening';
function monthDay(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) { civil(value, '旧作息生效日期'); return value.slice(5); }
  if (typeof value !== 'string' || !/^\d{2}-\d{2}$/.test(value)) throw new Error('作息生效月日格式应为 MM-DD');
  civil(`2000-${value}`, '作息生效月日'); return value;
}
function normalizePeriods(value) {
  let previous = '';
  return list(value, 24, '作息节数', 1).map((p, index) => {
    object(p, '节次时间');
    if (typeof p.start !== 'string' || typeof p.end !== 'string' || !TIME.test(p.start) || !TIME.test(p.end) || p.end <= p.start || p.start < previous) throw new Error('作息时间须使用 HH:MM、递增且不重叠');
    previous = p.end;
    return { start: p.start, end: p.end, group: enumeration(p.group ?? defaultGroup(index), GROUPS, '节次分组') };
  });
}
function minutes(value) { if (typeof value !== 'string' || !TIME.test(value)) throw new Error('时间格式应为 HH:MM'); const [h, m] = value.split(':').map(Number); return h * 60 + m; }
function clockTime(value) { if (!Number.isInteger(value) || value < 0 || value >= 1440) throw new Error('联动后的时间超出当天，请调整起始时间或偏移量'); return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }

/** Resolve a selected teaching weekday to an explicit source date before saving a day rule. */
export function dateForWeekday(semester, targetDate, weekday, sourceWeek) {
  date(targetDate, '补课目标日期'); const day = num(weekday, 1, 7, '补课星期');
  const week = num(sourceWeek ?? weekOf(semester, targetDate), 1, semester.totalWeeks, '来源教学周');
  const result = getWeekDates(semester.startDate, week)[day - 1];
  if (result < semester.startDate) throw new Error('来源日期早于实际开学日，首周开学前没有基础课程');
  return result;
}

/** Return a new complete timetable; other groups and all within-group intervals stay unchanged. */
export function shiftPeriodGroup(periods, group, offsetMinutes) {
  enumeration(group, GROUPS, '节次分组'); const offset = num(offsetMinutes, -1439, 1439, '偏移分钟');
  const normalized = normalizePeriods(periods); if (!normalized.some(p => p.group === group)) throw new Error('所选分组没有节次');
  return normalizePeriods(normalized.map(p => p.group === group ? { ...p, start: clockTime(minutes(p.start) + offset), end: clockTime(minutes(p.end) + offset) } : p));
}
export function setGroupStart(periods, group, startTime) {
  enumeration(group, GROUPS, '节次分组'); const normalized = normalizePeriods(periods), first = normalized.find(p => p.group === group);
  if (!first) throw new Error('所选分组没有节次');
  return shiftPeriodGroup(normalized, group, minutes(startTime) - minutes(first.start));
}
export function copyPeriodGroup(sourcePeriods, targetPeriods, group, offsetMinutes = 0) {
  enumeration(group, GROUPS, '节次分组'); const offset = num(offsetMinutes, -1439, 1439, '偏移分钟');
  const source = normalizePeriods(sourcePeriods).filter(p => p.group === group), target = normalizePeriods(targetPeriods);
  if (!source.length || source.length !== target.filter(p => p.group === group).length) throw new Error('复制分组须有相同的节次数量');
  let index = 0;
  return normalizePeriods(target.map(p => { if (p.group !== group) return p; const original = source[index++]; return { ...p, start: clockTime(minutes(original.start) + offset), end: clockTime(minutes(original.end) + offset) }; }));
}
/** One form can configure a whole group while preserving other periods. */
export function configurePeriodGroup(periods, group, { startTime, durationMinutes = 45, breakMinutes = 10 } = {}) {
  enumeration(group, GROUPS, '节次分组'); const normalized = normalizePeriods(periods), selected = normalized.filter(p => p.group === group);
  if (!selected.length) throw new Error('所选分组没有节次');
  let cursor = minutes(startTime ?? selected[0].start);
  const duration = num(durationMinutes, 1, 360, '每节课分钟'), rest = num(breakMinutes, 0, 240, '课间分钟');
  return normalizePeriods(normalized.map(p => { if (p.group !== group) return p; const next = { ...p, start: clockTime(cursor), end: clockTime(cursor + duration) }; cursor += duration + rest; return next; }));
}
/** Edit one period, optionally shifting only subsequent periods in its own group. */
export function updatePeriodTime(periods, index, field, value, { cascade = true } = {}) {
  const normalized = normalizePeriods(periods), selectedIndex = num(index, 0, normalized.length - 1, '节次位置');
  enumeration(field, ['start', 'end'], '时间字段'); bool(cascade, '同组联动');
  const selected = normalized[selectedIndex], delta = minutes(value) - minutes(selected[field]);
  const result = normalized.map((p, i) => {
    if (i === selectedIndex) return field === 'start' ? { ...p, start: value, end: clockTime(minutes(p.end) + delta) } : { ...p, end: value };
    if (cascade && i > selectedIndex && p.group === selected.group) return { ...p, start: clockTime(minutes(p.start) + delta), end: clockTime(minutes(p.end) + delta) };
    return p;
  });
  return normalizePeriods(result);
}

export function makeSemester({ name, startDate, totalWeeks } = {}) {
  const today = localDate(), monday = addDays(today, 1 - dayOf(today));
  const start = startDate ?? monday;
  return { id: uid(), name: name ?? '我的学期', startDate: start, totalWeeks: totalWeeks ?? 20, showWeekend: true,
    profiles: [{ id: uid(), name: '默认作息', effectiveFrom: '01-01', periods: normalizePeriods(DEFAULT_SETTINGS.periods) }], courses: [], dayRules: [], exceptions: [], holidayLabels: [], exams: [] };
}
export function createState() {
  const semester = makeSemester();
  return { version: 2, activeSemesterId: semester.id, preferences: { schoolUrl: '', shareServerUrl: '', viewMode: 'week', notifications: { enabled: false, ongoing: false, minutes: 10, breakReminder: false, statusMode: 'remaining' } }, semesters: [semester] };
}

function validateSemester(input) {
  object(input, '学期');
  const result = { id: str(input.id, 120, '学期编号', true), name: str(input.name, 80, '学期名称', true), startDate: date(input.startDate, '开学日期'), totalWeeks: num(input.totalWeeks, 1, 30, '学期周数'), showWeekend: bool(input.showWeekend, '显示周末'), profiles: [], courses: [], dayRules: [], exceptions: [], holidayLabels: [], exams: [] };
  result.profiles = list(input.profiles, 30, '作息方案', 1).map(raw => {
    object(raw, '作息方案');
    return { id: str(raw.id, 120, '作息编号', true), name: str(raw.name, 50, '作息名称', true), effectiveFrom: monthDay(raw.effectiveFrom), periods: normalizePeriods(raw.periods) };
  }).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  unique(result.profiles, p => p.id, '作息编号'); unique(result.profiles, p => p.effectiveFrom, '作息生效日期');
  const maxPeriod = Math.min(...result.profiles.map(p => p.periods.length));
  result.courses = list(input.courses, 500, '课程').map(raw => {
    object(raw, '课程');
    const name = str(raw.name, 100, '课程名称', true);
    return { id: str(raw.id, 120, '课程编号', true), name, shortName: str(raw.shortName, 30, '课程简称'), color: num(raw.color, 0, 7, '课程颜色'), assessment: str(raw.assessment ?? '未设置', 30, '考核方式', true), nature: str(raw.nature, 50, '课程性质'), note: str(raw.note, 2000, '课程备注'), sessions: list(raw.sessions, 100, '上课安排', 1).map(s => {
      object(s, '上课安排'); const startPeriod = num(s.startPeriod, 1, maxPeriod, '开始节次'), endPeriod = num(s.endPeriod, startPeriod, maxPeriod, '结束节次');
      const weeks = [...new Set(list(s.weeks, 300, '上课周次', 1).map(w => num(w, 1, result.totalWeeks, '周次')))].sort((a, b) => a - b);
      const session = { id: str(s.id, 120, '安排编号', true), day: num(s.day, 1, 7, '星期'), startPeriod, endPeriod, weeks, teacher: str(s.teacher, 100, '教师'), location: str(s.location, 150, '教室'), breakMode: enumeration(s.breakMode ?? 'normal', ['normal', 'continuous'], '课间模式') };
      if (s.importSource !== undefined) {
        const meta = object(s.importSource, '导入来源'), snap = object(meta.snapshot, '导入快照');
        const snapStart = num(snap.startPeriod, 1, 24, '原始开始节次');
        session.importSource = { kind: enumeration(meta.kind, ['web', 'pdf', 'text'], '导入类型'), source: str(meta.source, 100, '导入来源名称'), key: str(meta.key, 120, '导入来源标识', true), snapshot: { name: str(snap.name, 100, '原始课程名称', true), day: num(snap.day, 1, 7, '原始星期'), startPeriod: snapStart, endPeriod: num(snap.endPeriod, snapStart, 24, '原始结束节次'), weeks: [...new Set(list(snap.weeks, 300, '原始上课周次', 1).map(w => num(w, 1, 30, '原始周次')))].sort((a, b) => a - b), teacher: str(snap.teacher, 100, '原始教师'), location: str(snap.location, 150, '原始教室') } };
      }
      return session;
    }) };
  });
  unique(result.courses, c => c.id, '课程编号');
  const sessions = result.courses.flatMap(c => c.sessions);
  unique(sessions, s => s.id, '上课安排编号');
  result.dayRules = list(input.dayRules ?? [], 500, '整日调课').map(raw => {
    object(raw, '整日调课'); const rule = { id: str(raw.id, 120, '调课编号', true), date: date(raw.date, '调课日期'), type: enumeration(raw.type, ['off', 'replace'], '整日调课类型'), label: str(raw.label, 150, '调课说明') };
    if (rule.type === 'replace') { rule.sourceDate = date(raw.sourceDate, '补课来源日期'); if (rule.sourceDate === rule.date) throw new Error('补课日期不能与原日期相同'); const week = weekOf(result, rule.sourceDate); if (rule.sourceDate < result.startDate || week < 1 || week > result.totalWeeks) throw new Error('补课来源日期须在实际开学日至学期结束之间'); }
    return rule;
  });
  unique(result.dayRules, r => r.id, '调课编号'); unique(result.dayRules, r => r.date, '同一天的整日调课');
  const replacements = result.dayRules.filter(r => r.type === 'replace');
  unique(replacements, r => r.sourceDate, '补课来源日期');
  for (const rule of replacements) if (replacements.some(other => other.date === rule.sourceDate)) throw new Error('不支持连锁补课：来源日期不能是另一个补课目标');
  result.exceptions = list(input.exceptions ?? [], 3000, '单次调课').map(raw => {
    object(raw, '单次调课'); const ex = { id: str(raw.id, 120, '变更编号', true), sessionId: str(raw.sessionId, 120, '原安排编号', true), sourceDate: date(raw.sourceDate, '原上课日期'), type: enumeration(raw.type, ['cancel', 'move', 'modify'], '单次调课类型') };
    const session = sessions.find(s => s.id === ex.sessionId);
    if (!session || ex.sourceDate < result.startDate || session.day !== dayOf(ex.sourceDate) || !session.weeks.includes(weekOf(result, ex.sourceDate))) throw new Error('单次调课没有对应的原始上课安排');
    if (ex.type === 'move') ex.date = date(raw.date, '调课目标日期');
    if (raw.startPeriod !== undefined) ex.startPeriod = num(raw.startPeriod, 1, maxPeriod, '调课开始节次');
    if (raw.endPeriod !== undefined) ex.endPeriod = num(raw.endPeriod, 1, maxPeriod, '调课结束节次');
    if ((ex.endPeriod ?? session.endPeriod) < (ex.startPeriod ?? session.startPeriod)) throw new Error('调课结束节次不能早于开始节次');
    for (const [key, max, label] of [['location', 150, '调课教室'], ['teacher', 100, '调课教师'], ['note', 2000, '调课备注']]) if (raw[key] !== undefined) ex[key] = str(raw[key], max, label);
    return ex;
  });
  unique(result.exceptions, ex => ex.id, '变更编号'); unique(result.exceptions, ex => `${ex.sessionId}\u0000${ex.sourceDate}`, '同一次课程的变更');
  result.holidayLabels = list(input.holidayLabels ?? [], 500, '假日标记').map(raw => { object(raw, '假日标记'); return { id: str(raw.id, 120, '假日编号', true), date: date(raw.date, '假日日期'), name: str(raw.name, 100, '假日名称', true) }; });
  unique(result.holidayLabels, h => h.id, '假日编号');
  result.exams = list(input.exams ?? [], 500, '考试安排').map(raw => {
    object(raw, '考试安排');
    const exam = { id: str(raw.id, 120, '考试编号', true), name: str(raw.name, 100, '考试名称', true), date: date(raw.date, '考试日期'), startTime: str(raw.startTime, 5, '考试开始时间', true), endTime: str(raw.endTime, 5, '考试结束时间', true), location: str(raw.location, 150, '考试地点'), note: str(raw.note, 2000, '考试备注') };
    if (!TIME.test(exam.startTime) || !TIME.test(exam.endTime) || exam.endTime <= exam.startTime) throw new Error('考试起止时间须使用 HH:MM，并在同一天内递增');
    // An exam is independent: deleting a linked course must not silently delete its exam.
    if (raw.courseId !== undefined && raw.courseId !== '') exam.courseId = str(raw.courseId, 120, '关联课程编号', true);
    return exam;
  });
  unique(result.exams, e => e.id, '考试编号');
  return result;
}

/** Normalize into a fresh, bounded object; never trust backup objects directly. */
export function validateState(input) {
  object(input, '备份'); if (input.version !== 2) throw new Error('备份版本不受支持');
  const pref = object(input.preferences, '偏好设置'), notify = object(pref.notifications, '通知设置');
  const schoolUrl = str(pref.schoolUrl, 2000, '教务地址');
  if (schoolUrl) { let parsed; try { parsed = new URL(schoolUrl); } catch { throw new Error('教务地址应为完整 http 或 https 网址'); } if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('教务地址须为无账号密码的 http 或 https 网址'); }
  const shareServerUrl = str(pref.shareServerUrl, 500, '分享服务地址');
  if (shareServerUrl) { let parsed; try { parsed = new URL(shareServerUrl); } catch { throw new Error('分享服务地址应为完整 HTTPS 根地址'); } if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || /[?#]/.test(shareServerUrl)) throw new Error('分享服务须为 HTTPS 根地址，不能包含账号、密码、路径、查询或片段'); }
  const result = { version: 2, activeSemesterId: str(input.activeSemesterId, 120, '当前学期编号', true), preferences: { schoolUrl, shareServerUrl, viewMode: enumeration(pref.viewMode, ['week', 'three'], '课表视图'), notifications: { enabled: bool(notify.enabled, '课前提醒'), ongoing: bool(notify.ongoing, '状态通知'), minutes: num(notify.minutes, 0, 120, '提前提醒分钟'), breakReminder: bool(notify.breakReminder, '课间结束提醒'), statusMode: enumeration(notify.statusMode ?? 'remaining', ['remaining', 'elapsed'], '状态通知显示') } }, semesters: list(input.semesters, 30, '学期', 1).map(validateSemester) };
  unique(result.semesters, s => s.id, '学期编号'); if (!result.semesters.some(s => s.id === result.activeSemesterId)) throw new Error('当前学期不存在');
  return result;
}

export function migrateState(input) {
  if (input?.version === 2) return validateState(input);
  const old = validateBackup(input), state = createState(), semester = makeSemester({ name: old.settings.semesterName, startDate: old.settings.semesterStart, totalWeeks: old.settings.totalWeeks });
  semester.showWeekend = old.settings.showWeekend; semester.profiles[0].periods = old.settings.periods.map(p => ({ ...p }));
  semester.courses = old.courses.map(c => ({ id: c.id, name: c.name, shortName: '', color: c.color, assessment: '未设置', nature: '', note: c.note, sessions: [{ id: uid(), day: c.day, startPeriod: c.startPeriod, endPeriod: c.endPeriod, weeks: [...c.weeks], teacher: c.teacher, location: c.location, breakMode: 'normal' }] }));
  state.activeSemesterId = semester.id; state.semesters = [semester]; return validateState(state);
}

export function getProfile(semester, value) {
  date(value); const annualDate = value.slice(5), sorted = [...semester.profiles].sort((a, b) => monthDay(a.effectiveFrom).localeCompare(monthDay(b.effectiveFrom)));
  // No January base is required: the last autumn/winter profile carries into the next year.
  return sorted.filter(p => monthDay(p.effectiveFrom) <= annualDate).at(-1) ?? sorted.at(-1);
}

function baseOn(semester, sourceDate) {
  const day = dayOf(sourceDate), week = weekOf(semester, sourceDate);
  if (sourceDate < semester.startDate || week < 1 || week > semester.totalWeeks) return [];
  return semester.courses.flatMap(course => course.sessions.filter(session => session.day === day && session.weeks.includes(week)).map(session => ({ course, session, sourceDate })));
}

function toOccurrence(semester, candidate, actualDate, changeLabel = '', exception) {
  const { course, session, sourceDate } = candidate;
  const startPeriod = exception?.startPeriod ?? session.startPeriod, endPeriod = exception?.endPeriod ?? session.endPeriod;
  const profile = getProfile(semester, actualDate);
  const segments = [];
  for (let period = startPeriod; period <= endPeriod; period++) {
    const p = profile.periods[period - 1]; if (!p) throw new Error(`“${course.name}”所需第 ${period} 节在作息“${profile.name}”中不存在`);
    segments.push({ period, start: p.start, end: p.end, startMs: at(actualDate, p.start), endMs: at(actualDate, p.end) });
  }
  return { id: `${session.id}@${sourceDate}`, kind: 'course', courseId: course.id, sessionId: session.id, name: course.name, shortName: course.shortName, color: course.color, assessment: course.assessment, nature: course.nature, note: exception?.note ?? course.note, date: actualDate, sourceDate, day: dayOf(actualDate), startPeriod, endPeriod, teacher: exception?.teacher ?? session.teacher, location: exception?.location ?? session.location, breakMode: session.breakMode, segments, startMs: segments[0].startMs, endMs: segments.at(-1).endMs, changeLabel, conflicts: [] };
}

function examOccurrence(exam) {
  const startMs = at(exam.date, exam.startTime), endMs = at(exam.date, exam.endTime);
  return { id: `exam:${exam.id}`, kind: 'exam', examId: exam.id, courseId: exam.courseId ?? '', sessionId: `exam:${exam.id}`, name: exam.name, shortName: '', color: 6, assessment: '考试', nature: '考试安排', note: exam.note, date: exam.date, sourceDate: exam.date, day: dayOf(exam.date), startPeriod: 0, endPeriod: 0, teacher: '', location: exam.location, breakMode: 'continuous', segments: [{ period: 0, start: exam.startTime, end: exam.endTime, startMs, endMs }], startMs, endMs, changeLabel: '', conflicts: [] };
}

/** Source identity stays stable across replacement days and individual moves. */
export function occurrencesOn(semester, value) {
  date(value); const rules = semester.dayRules ?? [], exceptions = semester.exceptions ?? [];
  const rule = rules.find(r => r.date === value), isConsumed = rules.some(r => r.type === 'replace' && r.sourceDate === value);
  const candidates = rule?.type === 'replace' ? baseOn(semester, rule.sourceDate) : (rule?.type === 'off' || isConsumed ? [] : baseOn(semester, value));
  const occurrences = [];
  for (const candidate of candidates) {
    const ex = exceptions.find(e => e.sessionId === candidate.session.id && e.sourceDate === candidate.sourceDate);
    if (ex?.type === 'cancel' || ex?.type === 'move') continue;
    occurrences.push(toOccurrence(semester, candidate, value, ex ? '单次调整' : rule?.type === 'replace' ? (rule.label || `补 ${rule.sourceDate} 的课`) : '', ex));
  }
  for (const ex of exceptions.filter(e => e.type === 'move' && e.date === value)) {
    const candidate = baseOn(semester, ex.sourceDate).find(c => c.session.id === ex.sessionId);
    if (candidate) occurrences.push(toOccurrence(semester, candidate, value, '单次调课', ex));
  }
  for (const exam of semester.exams ?? []) if (exam.date === value) occurrences.push(examOccurrence(exam));
  occurrences.sort((a, b) => a.startMs - b.startMs || a.name.localeCompare(b.name));
  for (const item of occurrences) {
    item.conflicts = occurrences.filter(other => other.id !== item.id && other.startMs < item.endMs && other.endMs > item.startMs).map(other => other.id);
    item.conflict = item.conflicts.length > 0;
    item.onOffDay = rule?.type === 'off';
  }
  return occurrences;
}

export function occurrenceStatus(occurrence, now = new Date()) {
  const ms = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(ms) || !occurrence.segments?.length) throw new Error('课程状态参数无效');
  const { segments, startMs, endMs } = occurrence, continuous = occurrence.breakMode === 'continuous';
  const elapsedMs = continuous ? Math.max(0, Math.min(ms, endMs) - startMs) : segments.reduce((sum, s) => sum + Math.max(0, Math.min(ms, s.endMs) - s.startMs), 0);
  const status = { phase: 'before', elapsedMs, elapsedTeachingMs: elapsedMs, remainingMs: Math.max(0, startMs - ms), nextBoundaryMs: startMs, period: null, nextPeriod: segments[0].period, startMs, endMs, label: '尚未开始' };
  if (ms < startMs) return status;
  if (ms >= endMs) return { ...status, phase: 'after', remainingMs: 0, nextBoundaryMs: null, nextPeriod: null, label: '已结束' };
  if (continuous) return { ...status, phase: 'class', remainingMs: endMs - ms, nextBoundaryMs: endMs, period: segments.find(s => ms < s.endMs)?.period ?? segments.at(-1).period, nextPeriod: null, label: occurrence.kind === 'exam' ? '考试中' : '连续上课' };
  const current = segments.find(s => ms >= s.startMs && ms < s.endMs);
  if (current) {
    const next = segments.find(s => s.startMs >= current.endMs && s.period > current.period);
    // Adjacent periods without an actual gap are one uninterrupted teaching block.
    let boundary = current.endMs;
    for (const s of segments.filter(s => s.period > current.period)) { if (s.startMs !== boundary) break; boundary = s.endMs; }
    return { ...status, phase: 'class', remainingMs: boundary - ms, nextBoundaryMs: boundary, period: current.period, nextPeriod: next?.period ?? null, label: boundary < endMs ? '上课中 · 随后课间' : '上课中 · 随后下课' };
  }
  const next = segments.find(s => s.startMs > ms);
  return { ...status, phase: 'break', remainingMs: next.startMs - ms, nextBoundaryMs: next.startMs, nextPeriod: next.period, label: '课间休息' };
}

/** All dated instances, including makeup classes outside the semester date range. */
export function notificationEvents(semester) {
  const monday = getWeekDates(semester.startDate, 1)[0];
  const dates = new Set(Array.from({ length: semester.totalWeeks * 7 }, (_, i) => addDays(monday, i)));
  for (const rule of semester.dayRules ?? []) dates.add(rule.date);
  for (const ex of semester.exceptions ?? []) if (ex.type === 'move') dates.add(ex.date);
  for (const exam of semester.exams ?? []) dates.add(exam.date);
  return [...dates].sort().flatMap(value => occurrencesOn(semester, value)).sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

