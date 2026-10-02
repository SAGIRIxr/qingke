const DAY_MS = 86400000;

export const DEFAULT_SETTINGS = {
  semesterName: '2026—2027 学年第一学期',
  semesterStart: '2026-09-07',
  totalWeeks: 20,
  showWeekend: true,
  periods: [
    { start: '08:00', end: '08:45' }, { start: '08:55', end: '09:40' },
    { start: '10:00', end: '10:45' }, { start: '10:55', end: '11:40' },
    { start: '14:00', end: '14:45' }, { start: '14:55', end: '15:40' },
    { start: '16:00', end: '16:45' }, { start: '16:55', end: '17:40' },
    { start: '19:00', end: '19:45' }, { start: '19:55', end: '20:40' },
    { start: '20:50', end: '21:35' }, { start: '21:45', end: '22:30' },
  ],
};

function integer(value, min, max, label) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    throw new Error(`${label}应为 ${min}—${max} 之间的整数`);
  }
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new Error(`${label}应为 ${min}—${max} 之间的整数`);
  }
  return result;
}

function shortText(value, max, label, required = false) {
  if (value !== undefined && value !== null && typeof value !== 'string') throw new Error(`${label}应为文字`);
  const result = String(value ?? '').trim();
  if (required && !result) throw new Error(`请填写${label}`);
  if (result.length > max) throw new Error(`${label}不能超过 ${max} 个字符`);
  return result;
}

function civilDate(value, label = '日期') {
  let parts;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    parts = [value.getFullYear(), value.getMonth() + 1, value.getDate()];
  } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    parts = value.split('-').map(Number);
  } else {
    throw new Error(`${label}格式应为 YYYY-MM-DD`);
  }
  const [year, month, day] = parts;
  if (year < 1900 || year > 2200) throw new Error(`${label}年份无效`);
  const result = Date.UTC(year, month - 1, day);
  const check = new Date(result);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
    throw new Error(`${label}不存在`);
  }
  return result;
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `course-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Validate one course; never silently expand missing weeks to the whole semester. */
export function createCourse(input, { maxPeriods = 24 } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('课程格式无效');
  const name = shortText(input.name, 100, '课程名称', true);
  const day = integer(input.day, 1, 7, '星期');
  const startPeriod = integer(input.startPeriod, 1, maxPeriods, '开始节次');
  const endPeriod = integer(input.endPeriod, 1, maxPeriods, '结束节次');
  if (endPeriod < startPeriod) throw new Error('结束节次不能早于开始节次');
  if (!Array.isArray(input.weeks) || !input.weeks.length || input.weeks.length > 300) throw new Error('请选择有效的上课周次');
  const weeks = [...new Set(input.weeks.map(week => integer(week, 1, 30, '周次')))].sort((a, b) => a - b);
  const fallbackColor = [...name].reduce((sum, character) => sum + character.codePointAt(0), 0) % 8;
  return {
    id: input.id == null ? newId() : shortText(input.id, 120, '课程编号', true),
    name,
    teacher: shortText(input.teacher, 100, '教师'),
    location: shortText(input.location, 150, '教室'),
    day, startPeriod, endPeriod, weeks,
    color: input.color == null ? fallbackColor : integer(input.color, 0, 7, '颜色'),
    note: shortText(input.note, 2000, '备注'),
  };
}

/** Date objects use their local calendar date; all date arithmetic then uses UTC civil days. */
export function getWeek(date, semesterStart) {
  const first = civilDate(semesterStart, '学期开始日期');
  const monday = first - ((new Date(first).getUTCDay() + 6) % 7) * DAY_MS;
  return Math.floor((civilDate(date) - monday) / (7 * DAY_MS)) + 1;
}

export function getWeekDates(semesterStart, week) {
  const start = civilDate(semesterStart, '学期开始日期');
  const first = start - ((new Date(start).getUTCDay() + 6) % 7) * DAY_MS + (integer(week, 1, 30, '周次') - 1) * 7 * DAY_MS;
  return Array.from({ length: 7 }, (_, day) => new Date(first + day * DAY_MS).toISOString().slice(0, 10));
}

export function occursInWeek(course, week) {
  return Array.isArray(course?.weeks) && course.weeks.includes(Number(week));
}

export function findConflicts(courses, course) {
  if (!Array.isArray(courses)) return [];
  const weeks = new Set(course.weeks);
  return courses.filter(other => other.id !== course.id && other.day === course.day &&
    other.startPeriod <= course.endPeriod && other.endPeriod >= course.startPeriod &&
    other.weeks.some(week => weeks.has(week)));
}

/** Recognizes explicit ranges, lists and 单/双周. Ambiguous/unrecognized input returns []. */
export function parseWeeks(text, totalWeeks = 20) {
  const limit = integer(totalWeeks, 1, 30, '学期周数');
  if (typeof text !== 'string' && typeof text !== 'number') return [];
  let value = String(text).trim();
  if (!value || value.length > 300) return [];
  if (/^(?:全学期|全部周次|每周|全周)$/.test(value)) return Array.from({ length: limit }, (_, i) => i + 1);
  value = value.replace(/^\s*(?:上课)?周次\s*[:：]?\s*/, '')
    .replace(/[０-９]/g, character => String(character.charCodeAt(0) - 0xff10))
    .replace(/[－—–~～至到]/g, '-').replace(/[，、；;]/g, ',')
    .replace(/[（【［]/g, '(').replace(/[）】］]/g, ')')
    .replace(/\s*([-(),])\s*/g, '$1').replace(/\s+/g, ',')
    .replace(/第|周|[()[\]{}]/g, '').replace(/,([单双])$/g, '$1');
  const tokens = value.split(',').filter(Boolean);
  if (!tokens.length) return [];
  const result = new Set();
  for (const token of tokens) {
    const match = token.match(/^(\d{1,2})(?:-(\d{1,2}))?([单双])?$/);
    if (!match) return [];
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > limit) return [];
    for (let week = start; week <= end; week++) {
      if (!match[3] || (week % 2 === 1 ? '单' : '双') === match[3]) result.add(week);
    }
  }
  return [...result].sort((a, b) => a - b);
}

export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.version !== 1) throw new Error('备份版本或文件格式不受支持');
  if (!obj.settings || typeof obj.settings !== 'object' || Array.isArray(obj.settings)) throw new Error('备份缺少学期设置');
  if (!Array.isArray(obj.courses) || obj.courses.length > 500) throw new Error('备份课程列表无效或超过 500 条');
  const settings = {
    semesterName: shortText(obj.settings.semesterName, 80, '学期名称', true),
    semesterStart: obj.settings.semesterStart,
    totalWeeks: integer(obj.settings.totalWeeks, 1, 30, '学期周数'),
    showWeekend: obj.settings.showWeekend,
    periods: [],
  };
  const firstDay = civilDate(settings.semesterStart, '学期开始日期');
  if (new Date(firstDay).getUTCDay() !== 1) throw new Error('学期开始日期应为第一周的周一');
  if (typeof settings.showWeekend !== 'boolean') throw new Error('周末显示设置无效');
  if (!Array.isArray(obj.settings.periods) || obj.settings.periods.length !== 12) throw new Error('请提供完整的 12 节作息时间');
  let previousEnd = '';
  for (const period of obj.settings.periods) {
    if (!period || !/^([01]\d|2[0-3]):[0-5]\d$/.test(period.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(period.end)) {
      throw new Error('作息时间格式应为 HH:MM');
    }
    if (period.end <= period.start || (previousEnd && period.start < previousEnd)) throw new Error('作息时间应按顺序排列且不能重叠');
    settings.periods.push({ start: period.start, end: period.end });
    previousEnd = period.end;
  }
  const ids = new Set();
  const courses = obj.courses.map(input => {
    const course = createCourse(input, { maxPeriods: 12 });
    if (ids.has(course.id)) throw new Error('备份包含重复的课程编号');
    if (course.weeks.some(week => week > settings.totalWeeks)) throw new Error(`“${course.name}”的周次超出学期范围`);
    ids.add(course.id);
    return course;
  });
  return { version: 1, settings, courses };
}

// Example data is opt-in: the UI must never mistake it for an imported school timetable.
export const demoCourses = [
  { id: 'demo-math', name: '高等数学 · 示例', teacher: '示例教师', location: '一教 A201', day: 1, startPeriod: 1, endPeriod: 2, weeks: Array.from({ length: 18 }, (_, i) => i + 1), color: 0, note: '示例课程，仅用于体验；请导入自己的课表。' },
  { id: 'demo-english', name: '大学英语 · 示例', teacher: '示例教师', location: '二教 B305', day: 2, startPeriod: 3, endPeriod: 4, weeks: Array.from({ length: 18 }, (_, i) => i + 1), color: 1, note: '示例课程，仅用于体验；请导入自己的课表。' },
  { id: 'demo-code', name: '程序设计 · 示例', teacher: '示例教师', location: '实验楼 402', day: 3, startPeriod: 5, endPeriod: 6, weeks: Array.from({ length: 9 }, (_, i) => i * 2 + 1), color: 2, note: '示例课程，仅用于体验；请导入自己的课表。' },
  { id: 'demo-sport', name: '体育 · 示例', teacher: '示例教师', location: '体育馆', day: 5, startPeriod: 7, endPeriod: 8, weeks: Array.from({ length: 18 }, (_, i) => i + 1), color: 3, note: '示例课程，仅用于体验；请导入自己的课表。' },
].map(input => createCourse(input));
