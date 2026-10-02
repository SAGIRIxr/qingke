import { createCourse, parseWeeks } from './core.js';

const DAY_NAMES = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const CHINESE_NUMBERS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
const FIELD_END = '(?=\\s+(?:星期|周次|节次|教师|老师|教室|地点|任课教师|上课地点)\\s*[:：]|[\\n|｜;；]|$)';

function cleanText(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ').trim();
}

function dayFromText(value) {
  const match = String(value).match(/(?:星期|礼拜|周)\s*[:：]?\s*([一二三四五六日天1-7])/);
  if (match) return DAY_NAMES[match[1]] ?? Number(match[1]);
  const english = String(value).trim().match(/^(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)$/i);
  return english ? ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(english[1].slice(0, 3).toLowerCase()) + 1 : null;
}

function periodsFromText(value, allowBare = false) {
  const text = cleanText(value).replace(/[０-９]/g, character => String(character.charCodeAt(0) - 0xff10))
    .replace(/[－—–~～至到]/g, '-').replace(/[\[\]【】]/g, '');
  // Capture the complete numeric expression before validating it. Matching only
  // one or two digits here would silently accept the suffix of 0102 or 101.
  let match = text.match(/(?:节次|上课节次)\s*[:：]\s*第?\s*(\d+(?:\s*[-,，]\s*\d+)*)\s*(?:节)?/)
    ?? text.match(/第?\s*(\d+(?:\s*[-,，]\s*\d+)*)\s*(?:\(节\)|（节）|节)/);
  if (!match && allowBare) match = text.match(/^第?\s*(\d+(?:\s*[-,，]\s*\d+)*)\s*$/);
  if (!match) {
    const chinese = text.match(/^第?([一二三四五六七八九十]+)节$/);
    if (chinese && CHINESE_NUMBERS[chinese[1]]) return [CHINESE_NUMBERS[chinese[1]], CHINESE_NUMBERS[chinese[1]]];
    return null;
  }
  const range = match[1].match(/^(\d{1,2})(?:\s*([-,，])\s*(\d{1,2}))?$/);
  if (!range) return null;
  const start = Number(range[1]);
  const end = Number(range[3] ?? range[1]);
  const noncontiguous = /[,，]/.test(range[2] ?? '') && end !== start + 1;
  return !noncontiguous && start >= 1 && end >= start && end <= 12 ? [start, end] : null;
}

function labeledValue(text, labels) {
  const match = text.match(new RegExp(`(?:^|[\\s|｜;；])(?:${labels})\\s*[:：]\\s*(.*?)${FIELD_END}`, 'm'));
  return match?.[1]?.trim() ?? '';
}

function weeksFromText(text, totalWeeks) {
  const labeled = labeledValue(text, '上课周次|周次');
  if (labeled) return parseWeeks(labeled, totalWeeks);
  // Require a 周 marker, so room numbers and periods cannot become semester weeks.
  const candidates = text.match(/(?:第\s*)?\d{1,2}(?:\s*[-－—–~～至到]\s*\d{1,2})?(?:\s*[,，、]\s*\d{1,2}(?:\s*[-－—–~～至到]\s*\d{1,2})?)*\s*(?:[（(]\s*周\s*[）)]|周)(?:\s*[（(]?\s*[单双]\s*周?\s*[）)]?)?/g) ?? [];
  const weeks = new Set();
  for (const candidate of candidates) {
    const parsed = parseWeeks(candidate, totalWeeks);
    if (!parsed.length) return [];
    parsed.forEach(week => weeks.add(week));
  }
  return [...weeks].sort((a, b) => a - b);
}

function elementText(element) {
  if (!element) return '';
  if (!element.childNodes) return cleanText(element.textContent);
  const pieces = [];
  const visit = node => {
    if (node.nodeType === 3) { pieces.push(node.nodeValue ?? node.textContent ?? ''); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName?.toLowerCase();
    if (['script', 'style', 'noscript', 'svg', 'iframe'].includes(tag)) return;
    if (['br', 'div', 'p', 'li', 'section', 'h1', 'h2', 'h3'].includes(tag)) pieces.push('\n');
    for (const child of node.childNodes ?? []) visit(child);
    if (['div', 'p', 'li', 'section'].includes(tag)) pieces.push('\n');
  };
  visit(element);
  return cleanText(pieces.join('')).replace(/\n(?:[ \t]*\n){2,}/g, '\n\n');
}

function fieldFromElement(element, selectors, titlePattern) {
  for (const selector of selectors) {
    const found = element.querySelector(selector);
    const value = cleanText(found?.textContent);
    if (value) return value;
  }
  if (titlePattern) {
    for (const node of element.querySelectorAll('[title], [data-original-title]')) {
      const title = node.getAttribute('data-original-title') || node.getAttribute('title') || '';
      if (titlePattern.test(title)) {
        const value = title.replace(/^.*?[:：]\s*/, '');
        if (value !== title && cleanText(value)) return cleanText(value);
        const ownText = cleanText(node.textContent);
        const container = node.closest('p') ?? node.parentElement;
        const content = ownText && !titlePattern.test(ownText) ? ownText : cleanText(container?.textContent);
        if (content) return content.replace(/^(?:任课教师|教师|老师|上课地点|教室|场地|周次|节次)\s*[:：]\s*/, '');
      }
    }
  }
  return '';
}

function nameFromText(text) {
  const labeled = labeledValue(text, '课程名称|课程名|课程');
  if (labeled) return labeled;
  const lines = text.split(/[\n|｜]/).map(cleanText).filter(Boolean);
  return lines.find(line => !dayFromText(line) && !periodsFromText(line) && !/^(?:周次|节次|教师|老师|任课教师|教室|地点|上课地点|教学班|学分|考核|备注)\s*[:：]/.test(line) &&
    !/^\d[\d\s,，、—~-]*(?:周|\(周\)|（周）)/.test(line) && !/^(?:上午|下午|晚上|星期|时间|节次|课程表|学生课表)$/.test(line)) ?? '';
}

function fieldsFromBlock(block) {
  const fields = {
    name: fieldFromElement(block, ['.title', '.course-name', '.kcmc'], /课程名称|课程名/),
    teacher: fieldFromElement(block, ['.tch-name', '.teacher', '.jsmc'], /任课教师|教师/),
    location: fieldFromElement(block, ['.room', '.classroom', '.cdmc'], /上课地点|教室|场地/),
    weeks: fieldFromElement(block, ['.week', '.weeks', '.zcd'], /周次/),
    periods: fieldFromElement(block, ['.period', '.periods', '.jcs'], /节次|节\/周/),
  };
  if (fields.weeks && periodsFromText(fields.weeks)) {
    fields.periods ||= fields.weeks;
    fields.weeks = '';
  }
  if (fields.periods && !/节/.test(fields.periods)) fields.periods = `${fields.periods}节`;
  if (fields.weeks) fields.weeks = fields.weeks.replace(/^周次\s*[:：]\s*/, '');
  return fields;
}

function parseBlock(text, context, totalWeeks, fields = {}) {
  const source = cleanText(text);
  const name = cleanText(fields.name || nameFromText(source)).replace(/^课程名称\s*[:：]\s*/, '');
  const day = fields.day ?? dayFromText(source) ?? context.day;
  const periods = periodsFromText(fields.periods || '') ?? periodsFromText(source) ?? context.periods;
  const weeks = fields.weeks ? parseWeeks(fields.weeks, totalWeeks) : weeksFromText(source, totalWeeks);
  const missing = [];
  if (!name) missing.push('课程名称');
  if (!day) missing.push('星期');
  if (!periods) missing.push('节次');
  if (!weeks.length) missing.push('周次');
  if (missing.length) return { warning: `${name ? `“${name.slice(0, 35)}”` : '一条课程'}缺少可识别的${missing.join('、')}，已跳过，请手动补充。` };
  const positional = source.split(/[|｜\t]/).map(cleanText);
  const teacher = fields.teacher || labeledValue(source, '任课教师|教师|老师') || (positional.length >= 6 ? positional[4] : '');
  const location = fields.location || labeledValue(source, '上课地点|教室|地点') || (positional.length >= 6 ? positional[5] : '');
  try {
    return { course: createCourse({ name, teacher, location, day, startPeriod: periods[0], endPeriod: periods[1], weeks, note: '' }) };
  } catch (error) {
    return { warning: `“${name.slice(0, 35)}”格式无效：${error.message}` };
  }
}

function parseHtml(html, totalWeeks, add, warnings) {
  if (typeof globalThis.DOMParser !== 'function') {
    warnings.push('当前环境无法读取网页表格结构，请在应用中导入网页，或粘贴包含星期、节次和周次的课程文本。');
    return;
  }
  const document = new DOMParser().parseFromString(html, 'text/html');
  const handledCells = new Set();
  // New Zhengfang: the cell ID is an explicit weekday/period coordinate.
  for (const cell of document.querySelectorAll('td[id]')) {
    const coordinate = cell.id.match(/^xq_([1-7])_(?:jc_)?(\d{1,2})(?:_|$)/) ?? cell.id.match(/^([1-7])-(\d{1,2})$/);
    if (!coordinate) continue;
    const blocks = cell.querySelectorAll('.timetable_con, .course-item');
    if (!blocks.length) continue;
    handledCells.add(cell);
    for (const block of blocks) {
      const fields = fieldsFromBlock(block);
      const period = Number(coordinate[2]);
      // Coordinate alone determines only the start, not the course duration.
      const fullText = elementText(block);
      const explicitPeriods = periodsFromText(fields.periods) ?? periodsFromText(fullText);
      const declaredSpan = Number(cell.getAttribute('rowspan') ?? 0);
      const periods = explicitPeriods ?? (declaredSpan > 0 && period + declaredSpan - 1 <= 12 ? [period, period + declaredSpan - 1] : null);
      add(parseBlock(fullText, { day: Number(coordinate[1]), periods }, totalWeeks, fields));
    }
  }

  for (const table of document.querySelectorAll('table')) {
    const rows = [...table.querySelectorAll('tr')].filter(row => row.closest('table') === table);
    if (rows.length > 150) { warnings.push('一个表格超过 150 行，已跳过；请只导入课程表区域。'); continue; }
    const grid = [];
    const origins = [];
    for (let r = 0; r < rows.length; r++) {
      grid[r] ??= [];
      let column = 0;
      for (const cell of rows[r].children) {
        if (!['TD', 'TH'].includes(cell.tagName)) continue;
        while (grid[r][column]) column++;
        const rowSpan = Math.min(Math.max(Number(cell.getAttribute('rowspan')) || 1, 1), 30);
        const colSpan = Math.min(Math.max(Number(cell.getAttribute('colspan')) || 1, 1), 20);
        const entry = { cell, row: r, column, rowSpan, colSpan, text: elementText(cell) };
        origins.push(entry);
        for (let y = r; y < Math.min(r + rowSpan, rows.length); y++) {
          grid[y] ??= [];
          for (let x = column; x < column + colSpan; x++) grid[y][x] = entry;
        }
        column += colSpan;
      }
    }
    const dayColumns = new Map();
    let headerRow = -1;
    for (let r = 0; r < Math.min(grid.length, 8); r++) {
      const candidates = new Map();
      for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
        const entry = grid[r][c];
        if (!entry || entry.text.length > 25) continue;
        const day = dayFromText(entry.text);
        if (day) candidates.set(c, day);
      }
      if (new Set(candidates.values()).size >= 3) {
        candidates.forEach((day, column) => dayColumns.set(column, day));
        headerRow = r;
        break;
      }
    }
    if (headerRow < 0) continue;
    const periodRows = new Map();
    for (let r = headerRow + 1; r < grid.length; r++) {
      for (let c = 0; c < Math.min(...dayColumns.keys()); c++) {
        const value = grid[r]?.[c]?.text;
        const periods = value ? periodsFromText(value, true) : null;
        if (periods) { periodRows.set(r, periods); break; }
      }
    }
    for (const entry of origins) {
      const day = dayColumns.get(entry.column);
      if (!day || entry.row <= headerRow || !entry.text || handledCells.has(entry.cell)) continue;
      if (entry.colSpan > 1) { warnings.push('发现跨多个星期的合并单元格，已跳过，避免把课程安排到错误日期。'); continue; }
      const start = periodRows.get(entry.row);
      const end = periodRows.get(entry.row + entry.rowSpan - 1);
      const periods = start && end ? [start[0], end[1]] : null;
      const blocks = entry.cell.querySelectorAll('.timetable_con, .course-item');
      if (blocks.length) {
        for (const block of blocks) add(parseBlock(elementText(block), { day, periods }, totalWeeks, fieldsFromBlock(block)));
      } else {
        const texts = entry.text.split(/\n\s*[-=]{3,}\s*\n|\n\s*\n/);
        for (const text of texts) if (cleanText(text)) add(parseBlock(text, { day, periods }, totalWeeks));
      }
    }
  }
}

function parseText(text, totalWeeks, add) {
  const normalized = cleanText(text);
  const lines = normalized.split('\n').map(cleanText).filter(Boolean);
  const lineCourses = lines.filter(line => /[|｜]/.test(line) && dayFromText(line));
  if (lineCourses.length) {
    for (const line of lineCourses) add(parseBlock(line, {}, totalWeeks));
    return;
  }
  const blocks = normalized.split(/\n\s*\n|\n(?=\s*(?:课程名称|课程名|课程)\s*[:：])/).filter(cleanText);
  for (const block of blocks) add(parseBlock(block, {}, totalWeeks));
}

/** Offline, conservative import: only explicit course facts are accepted. No network access. */
export function parseSchedule(input, totalWeeks = 20) {
  const courses = [];
  const warnings = [];
  const fingerprints = new Set();
  const data = typeof input === 'string' ? { text: input } : input;
  if (!data || typeof data !== 'object') return { courses, warnings: ['没有可导入的课程内容。'], source: '未知来源' };
  let source = cleanText(data.title).slice(0, 100);
  if (!source && data.url) {
    try { source = new URL(data.url).hostname; } catch { /* Do not expose URL query parameters. */ }
  }
  source ||= data.html ? '教务网页' : '粘贴文本';
  if (!Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > 30) return { courses, warnings: ['学期周数应为 1—30。'], source };
  const add = result => {
    if (result.warning) { if (warnings.length < 80) warnings.push(result.warning); return; }
    if (!result.course) return;
    const course = result.course;
    const fingerprint = JSON.stringify([course.name, course.teacher, course.location, course.day, course.startPeriod, course.endPeriod, course.weeks]);
    if (!fingerprints.has(fingerprint) && courses.length < 500) { fingerprints.add(fingerprint); courses.push(course); }
  };
  const text = cleanText(typeof data.text === 'string' ? data.text.replace(/\t/g, ' | ') : data.text);
  if (text.length > 2_000_000 || String(data.html ?? '').length > 2_000_000) return { courses, warnings: ['导入内容超过 2 MB，请只导入课程表页面。'], source };
  if (text && /^[\[{]/.test(text)) {
    try {
      const json = JSON.parse(text);
      const entries = Array.isArray(json) ? json : json.courses;
      if (!Array.isArray(entries)) throw new Error('JSON 中未找到 courses 数组');
      for (const entry of entries.slice(0, 500)) {
        try {
          const course = createCourse(entry);
          if (course.weeks.some(week => week > totalWeeks)) throw new Error('课程周次超出当前学期范围');
          add({ course });
        } catch (error) { add({ warning: `一条 JSON 课程已跳过：${error.message}` }); }
      }
      if (entries.length > 500) warnings.push('单次最多导入 500 条课程，其余课程已跳过。');
      return { courses, warnings: [...new Set(warnings)], source: source === '粘贴文本' ? '课程 JSON' : source };
    } catch (error) {
      return { courses, warnings: [`课程 JSON 无法解析：${error.message}`], source };
    }
  }
  if (data.html) {
    try { parseHtml(String(data.html), totalWeeks, add, warnings); }
    catch { warnings.push('网页结构解析失败，请改为粘贴含星期、节次、周次的课程文本。'); }
  }
  if (!courses.length && text) parseText(text, totalWeeks, add);
  if (!courses.length && !warnings.length) warnings.push('未识别到课程。请登录教务系统，打开完整学生课表后再导入。');
  if (courses.length) courses.sort((a, b) => a.day - b.day || a.startPeriod - b.startPeriod || a.name.localeCompare(b.name, 'zh-CN'));
  return { courses, warnings: [...new Set(warnings)], source };
}
