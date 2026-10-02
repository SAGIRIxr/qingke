import { getWeek } from './core.js';
import { uid, localDate, addDays, createState, validateState, getProfile, occurrencesOn, notificationEvents, dateForWeekday } from './engine.js';
import { esc, clone, icon, DAYS, button, select, field, input, sheet, submit as submitButton } from './ui.js';

const weekday = date => new Date(`${date}T12:00:00`).getDay() || 7;
const valuesOf = form => Object.fromEntries(new FormData(form));
const checkedSemester = semester => validateState({ ...createState(), activeSemesterId: semester.id, semesters: [semester] }).semesters[0];

export function adjustmentDates(values, selected = []) {
  if (values.dateMode === 'single') return [addDays(values.date, 0)];
  if (values.dateMode === 'multiple') {
    const dates = [...new Set(selected.map(date => addDays(date, 0)))].sort();
    if (!dates.length) throw Error('请先在月历点选至少一个日期');
    if (dates.length > 366) throw Error('一次最多选择 366 天');
    return dates;
  }
  if (values.dateMode !== 'range') throw Error('日期选择方式无效');
  const start = addDays(values.rangeStart, 0), end = addDays(values.rangeEnd, 0), dates = [];
  if (end < start) throw Error('结束日期不能早于开始日期');
  for (let date = start; date <= end; date = addDays(date, 1)) {
    dates.push(date); if (dates.length > 366) throw Error('一次最多调整 366 天，请缩小日期范围');
  }
  return dates;
}

/** Parity follows the semester's teaching weeks; every choice names a real date. */
export function sourceTeachingWeeks(semester, sourceWeekday, mode = 'fixed') {
  if (!['fixed', 'odd', 'even'].includes(mode)) throw Error('来源教学周方式无效');
  const day = Number(sourceWeekday);
  if (!Number.isInteger(day) || day < 1 || day > 7) throw Error('请选择有效的补课星期');
  const weeks = [];
  for (let week = 1; week <= semester.totalWeeks; week++) {
    if (mode === 'odd' && week % 2 !== 1 || mode === 'even' && week % 2 !== 0) continue;
    // The first teaching week may begin before the actual semester start.
    if (week === 1 && day < weekday(semester.startDate)) continue;
    const date = dateForWeekday(semester, semester.startDate, day, week);
    weeks.push({ week, date, label: `第 ${week} 周（${week % 2 ? '单周' : '双周'}）· ${date} 星期${DAYS[day - 1]}` });
  }
  return weeks;
}

function sourceDateForAdjustment(semester, targetDate, values) {
  const mode = values.sourceWeekMode;
  if (!['target', 'fixed', 'odd', 'even'].includes(mode)) throw Error('请选择有效的来源教学周方式');
  if (mode === 'target') return dateForWeekday(semester, targetDate, Number(values.sourceWeekday));
  const week = Number(values.sourceWeek);
  if (!String(values.sourceWeek ?? '').trim()) throw Error('请先选择具体的来源教学周');
  const sourceDate = dateForWeekday(semester, targetDate, Number(values.sourceWeekday), week);
  if (mode === 'odd' && week % 2 !== 1 || mode === 'even' && week % 2 !== 0) throw Error(`请选择${mode === 'odd' ? '单周' : '双周'}的来源教学周`);
  return sourceDate;
}

/** Build a preview with the same source-week and duplicate rules as the engine. */
export function planDayAdjustment(original, values, selected = []) {
  const dates = adjustmentDates(values, selected), next = clone(original);
  if (!['off', 'replace'].includes(values.type)) throw Error('请选择停课或补课方式');
  const rules = dates.map((date, index) => {
    const rule = { id: uid(), date, type: values.type, label: values.label || '' };
    if (rule.type === 'replace') {
      if (!['weekday', 'date'].includes(values.sourceMode)) throw Error('请选择补课来源');
      rule.sourceDate = values.sourceMode === 'weekday'
        ? sourceDateForAdjustment(original, date, values)
        : addDays(values.sourceDate, index);
    }
    return rule;
  });
  const existing = rules.filter(r => original.dayRules.some(old => old.date === r.date));
  if (existing.length) throw Error(`${existing.map(r => r.date).join('、')} 已有整日规则，请先在下方变更列表撤销后再调整`);
  next.dayRules.push(...rules);
  return { semester: checkedSemester(next), rules, dates: [...new Set(rules.flatMap(r => [r.date, r.sourceDate].filter(Boolean)))] };
}

export function courseOccurrences(semester, courseId) {
  return notificationEvents(semester).filter(o => o.kind === 'course' && (!courseId || o.courseId === courseId));
}

/** Resolve an actual dated lesson, not a guessed weekday/session combination. */
export function planSingleChange(original, occurrenceId, values) {
  const occurrence = courseOccurrences(original).find(o => o.id === occurrenceId);
  if (!occurrence || values.occurrenceDate && occurrence.date !== values.occurrenceDate) throw Error('原上课安排已变化，请重新选择一次实际课程');
  if (!['adjust', 'cancel'].includes(values.action)) throw Error('请选择本次调整方式');
  const next = clone(original), old = next.exceptions.find(e => e.sessionId === occurrence.sessionId && e.sourceDate === occurrence.sourceDate);
  next.exceptions = next.exceptions.filter(e => !(e.sessionId === occurrence.sessionId && e.sourceDate === occurrence.sourceDate));
  const exception = { id: old?.id || uid(), sessionId: occurrence.sessionId, sourceDate: occurrence.sourceDate, type: 'cancel', note: values.note || '' };
  if (values.action === 'adjust') {
    const targetDate = addDays(values.date, 0);
    // A source can already be consumed by a whole-day replacement. Compare
    // against the effective base date so moving back to the source still works.
    const base = occurrencesOn(next, targetDate).find(o => o.id === occurrence.id);
    exception.type = base ? 'modify' : 'move';
    if (exception.type === 'move') exception.date = targetDate;
    Object.assign(exception, { startPeriod: Number(values.startPeriod), endPeriod: Number(values.endPeriod), location: values.location || '', teacher: values.teacher || '' });
  }
  next.exceptions.push(exception);
  const semester = checkedSemester(next), dates = [...new Set([occurrence.date, values.action === 'adjust' ? values.date : null].filter(Boolean))];
  // A syntactically valid period can be unavailable in this date's seasonal profile.
  const target = values.action === 'adjust' ? occurrencesOn(semester, values.date).find(o => o.id === occurrence.id) : null;
  if (values.action === 'adjust' && !target) throw Error('目标日期没有生成这次课程，请核对日期和节次');
  return { semester, occurrence, exception, target, dates };
}

export function createCalendarUI(ctx) {
  const semester = () => ctx.getSemester();
  const dayForm = () => document.querySelector('#day-rule-form');
  const selected = form => JSON.parse(form.elements.namedItem('selectedDates').value);
  const formDates = form => adjustmentDates(valuesOf(form), selected(form));
  const setValue = (form, name, value) => { form.elements.namedItem(name).value = value; };

  function monthMarkup(form) {
    const values = valuesOf(form), month = values.calendarMonth, first = `${month}-01`, offset = weekday(first) - 1;
    const [year, number] = month.split('-').map(Number), days = new Date(year, number, 0).getDate();
    let chosen = []; try { chosen = formDates(form); } catch {}
    const s = semester();
    return `<div class="month-nav">${button('calendar-month-prev', icon('left', 18), 'calendar-arrow', 'aria-label="上个月"')}<strong>${year} 年 ${number} 月</strong>${button('calendar-month-next', icon('right', 18), 'calendar-arrow', 'aria-label="下个月"')}</div><div class="month-calendar calendar-v4-grid">${DAYS.map(d => `<span class="month-weekday">${d}</span>`).join('')}${Array.from({ length: offset }, () => '<span aria-hidden="true"></span>').join('')}${Array.from({ length: days }, (_, i) => {
      const date = `${month}-${String(i + 1).padStart(2, '0')}`, rule = s.dayRules.find(r => r.date === date), holiday = s.holidayLabels.find(h => h.date === date), count = occurrencesOn(s, date).length;
      const tag = rule ? rule.type === 'off' ? '停课' : '补课' : holiday?.name || (count ? `${count} 次` : '');
      return button('calendar-pick', `<span>${i + 1}</span><small>${esc(tag)}</small>`, `month-day calendar-v4-day ${chosen.includes(date) ? 'selected' : ''} ${date === localDate() ? 'is-today' : ''}`, `data-date="${date}" aria-pressed="${chosen.includes(date)}" aria-label="${date}${tag ? ` ${esc(tag)}` : ''}"`);
    }).join('')}</div>`;
  }

  function redrawCalendar(form = dayForm()) {
    form.querySelector('[data-calendar-grid]').innerHTML = monthMarkup(form);
    let dates = []; try { dates = formDates(form); } catch {}
    form.querySelector('[data-calendar-selection]').innerHTML = `<strong>${dates.length ? `已选 ${dates.length} 天` : '点选日期，可跨月多选'}</strong>${dates.length ? `<span>${dates.length <= 4 ? dates.join('、') : `${dates[0]} 等 ${dates.length} 天`} ${button('calendar-clear', '清空', 'text-button')}</span>` : ''}`;
    for (const el of form.querySelectorAll('[data-action="calendar-operation"]')) el.disabled = !dates.length;
    for (const action of ['day-detail', 'holiday']) {
      const el = form.querySelector(`[data-action="${action}"]`);
      if (el) { el.disabled = dates.length !== 1; el.dataset.date = dates.length === 1 ? dates[0] : ''; }
    }
  }

  function changesMarkup() {
    const s = semester();
    const changes = [...s.dayRules.map(r => ({ id: r.id, kind: 'rule', date: r.date, title: r.type === 'off' ? '整日停课' : `补 ${r.sourceDate} 的课`, note: r.label })), ...s.exceptions.map(e => ({ id: e.id, kind: 'exception', date: e.date || s.dayRules.find(r => r.type === 'replace' && r.sourceDate === e.sourceDate)?.date || e.sourceDate, title: `${s.courses.find(c => c.sessions.some(t => t.id === e.sessionId))?.name || '课程'} · ${{ cancel: '取消本次', move: '移动本次', modify: '调整本次' }[e.type]}`, note: e.note || `原日期 ${e.sourceDate}` })), ...s.holidayLabels.map(h => ({ id: h.id, kind: 'holiday', date: h.date, title: h.name, note: '日期标记，不改变排课' }))].sort((a, b) => a.date.localeCompare(b.date));
    return `<details class="calendar-changes"><summary>已设置的变更 <span>${changes.length}</span></summary>${changes.map(c => `<div class="change-row"><div><small>${c.date}</small><strong>${esc(c.title)}</strong><p>${esc(c.note || '')}</p></div>${button('remove-change', '撤销', 'text-button', `data-id="${esc(c.id)}" data-kind="${c.kind}"`)}</div>`).join('') || '<p class="sheet-subtitle">还没有教学调整。</p>'}</details>`;
  }

  function openCalendar(date, fromCalendar = true) {
    const initial = addDays(date || localDate(), 0), s = semester();
    sheet('日历与教学调整', `<form id="day-rule-form" class="calendar-v4" data-semester="${esc(s.id)}">${input('selectedDates', JSON.stringify(date ? [initial] : []), 'hidden')}${input('calendarMonth', initial.slice(0, 7), 'hidden')}${input('type', '', 'hidden')}${input('sourceMode', 'weekday', 'hidden')}${input('rangeAnchor', '', 'hidden')}<div class="calendar-intro"><span>01</span><p><strong>先选日期</strong><small>点选或跨月多选，接着选择停课 / 补课。</small></p>${button('single-change', `${icon('swap', 14)} 单次调课`, 'calendar-single-quick')}</div><div data-calendar-grid></div><div class="calendar-selection" data-calendar-selection aria-live="polite"></div><details class="calendar-date-options"><summary>按单日或连续范围选择</summary>${field('选择方式', select('dateMode', [['multiple', '月历多选'], ['single', '单个日期'], ['range', '连续日期范围']], 'multiple'))}<div data-date-mode="single" hidden>${field('日期', input('date', initial, 'date'))}</div><div data-date-mode="range" hidden><div class="form-row">${field('开始日期', input('rangeStart', initial, 'date'))}${field('结束日期', input('rangeEnd', initial, 'date'))}</div><p class="source-note">也可在月历依次点选范围起点、终点。</p></div></details><div class="calendar-intro"><span>02</span><p><strong>选择调整方式</strong><small>整日调整会影响所选日期的所有课程。</small></p></div><div class="calendar-operation-grid">${button('calendar-operation', `${icon('close', 18)}<strong>停课</strong><small>这些天不上课</small>`, 'calendar-operation', 'data-operation="off" aria-pressed="false"')}${button('calendar-operation', `${icon('swap', 18)}<strong>补星期几</strong><small>指定来源教学周</small>`, 'calendar-operation', 'data-operation="weekday" aria-pressed="false"')}${button('calendar-operation', `${icon('calendar', 18)}<strong>补某天的课</strong><small>指定来源日期</small>`, 'calendar-operation', 'data-operation="date" aria-pressed="false"')}</div><div data-adjust-fields hidden><div data-source-mode="weekday" hidden>${field('补星期几的课', select('sourceWeekday', DAYS.map((d, i) => [i + 1, `星期${d}`]), 1))}${field('来源教学周', select('sourceWeekMode', [['target', '分别采用各目标所在教学周'], ['odd', '单周'], ['even', '双周'], ['fixed', '指定教学周（全部）']], 'target'))}<div data-fixed-week hidden>${field('具体来源教学周', select('sourceWeek', [['', '请选择具体的来源教学周'], ...sourceTeachingWeeks(s, 1).map(choice => [choice.week, choice.label])], ''), '单双周按本学期的第几周计算；选择确切周次后再预览。')}</div><p class="source-note">课程按所选来源周次读取，原日期不再重复上课；同一个来源日期只能补一次。</p></div><div data-source-mode="date" hidden>${field('来源日期', input('sourceDate', initial, 'date'))}<p class="source-note">多个目标按日期排序，来源从此日期起逐天顺延。下一步会逐日列出对应关系。</p></div>${field('说明（选填）', input('label', '', 'text', 'maxlength="100" placeholder="例如 学校调休通知"'))}<p class="source-note">补课沿用来源周次和目标当天作息，原日期不重复上课；独立考试按其自身日期保留。</p>${submitButton('逐日预览调整')}</div><div class="calendar-shortcuts">${button('single-change', `${icon('swap', 18)}<span><strong>单次调课</strong><small>只调整某门课的一次安排</small></span>${icon('right', 15)}`, 'calendar-shortcut')}${button('day-detail', `${icon('clock', 17)} 查看所选当天`, 'text-button')}${button('holiday', '添加日期标记', 'text-button')}</div></form>${fromCalendar ? changesMarkup() : ''}<p class="source-note">节假日标记不会自动停课，教学安排以学校通知为准。</p>`);
    redrawCalendar();
  }

  function syncVisibility(form) {
    const values = valuesOf(form);
    for (const el of form.querySelectorAll('[data-date-mode]')) el.hidden = el.dataset.dateMode !== values.dateMode;
    form.querySelector('[data-adjust-fields]').hidden = !values.type;
    for (const el of form.querySelectorAll('[data-source-mode]')) el.hidden = values.type !== 'replace' || el.dataset.sourceMode !== values.sourceMode;
    form.querySelector('[data-fixed-week]').hidden = values.sourceWeekMode === 'target';
    const choices = sourceTeachingWeeks(semester(), values.sourceWeekday, values.sourceWeekMode === 'target' ? 'fixed' : values.sourceWeekMode);
    const current = choices.some(choice => String(choice.week) === values.sourceWeek) ? values.sourceWeek : '';
    form.elements.namedItem('sourceWeek').innerHTML = `<option value="">${choices.length ? '请选择具体的来源教学周' : '这个学期没有符合条件的来源教学周'}</option>${choices.map(choice => `<option value="${choice.week}" ${String(choice.week) === current ? 'selected' : ''}>${esc(choice.label)}</option>`).join('')}`;
    for (const el of form.querySelectorAll('[data-action="calendar-operation"]')) el.setAttribute('aria-pressed', String(el.dataset.operation === (values.type === 'off' ? 'off' : values.type ? values.sourceMode : '')));
  }

  function occurrenceLabel(o) {
    return `${o.date} 周${DAYS[o.day - 1]} · 第 ${o.startPeriod}–${o.endPeriod} 节 · ${o.location || '地点待定'}${o.sourceDate !== o.date ? `（原 ${o.sourceDate}）` : ''}`;
  }
  function occurrenceChoices(courseId, value = '', preferredDate = '') {
    const rows = courseOccurrences(semester(), courseId);
    const chosen = rows.find(o => o.id === value) || rows.find(o => o.date >= (preferredDate || localDate())) || rows.at(-1);
    return { rows, chosen, html: select('occurrenceId', rows.length ? rows.map(o => [o.id, occurrenceLabel(o)]) : [['', '这门课没有可调整的实际安排']], chosen?.id || '') };
  }
  function periodOptions(date, value, end = false) {
    const periods = getProfile(semester(), date).periods;
    const options = periods.map((p, i) => [i + 1, `第 ${i + 1} 节 · ${end ? p.end : p.start}`]);
    if (value > periods.length) options.unshift([value, `第 ${value} 节（当天作息无此节）`]);
    return options;
  }
  function singleFields(o) {
    if (!o) return '<p class="helper-box">没有可调整的课程。停课或取消的课程不会出现在这里；可先在变更列表撤销原规则。</p>';
    const existing = semester().exceptions.find(e => e.sessionId === o.sessionId && e.sourceDate === o.sourceDate);
    return `${input('occurrenceDate', o.date, 'hidden')}<div class="single-origin"><small>当前实际安排</small><strong>${esc(o.name)}</strong><span>${esc(occurrenceLabel(o))}</span>${o.changeLabel ? `<span>${esc(o.changeLabel)}</span>` : ''}</div>${field('这一次如何调整', select('action', [['adjust', '移动 / 修改时间地点'], ['cancel', '仅取消这一次']], 'adjust'))}<div data-single-target>${field('目标上课日期', input('date', o.date, 'date', 'required'))}<div class="form-row">${field('开始节次', select('startPeriod', periodOptions(o.date, o.startPeriod), o.startPeriod))}${field('结束节次', select('endPeriod', periodOptions(o.date, o.endPeriod, true), o.endPeriod))}</div><div class="form-row">${field('教室', input('location', o.location, 'text', 'maxlength="150"'))}${field('教师', input('teacher', o.teacher, 'text', 'maxlength="100"'))}</div></div>${field('说明（选填）', input('note', existing?.note || '', 'text', 'maxlength="2000" placeholder="例如 临时更换教室"'))}<p class="source-note">只调整选中的这一次，其他周次照常。确认前会检查目标日期的时间重叠。</p>${submitButton('预览本次调课')}`;
  }

  function singleChangeForm(preferredDate) {
    const s = semester(), rows = courseOccurrences(s), id = rows.find(o => o.date === preferredDate)?.courseId || rows.find(o => o.date >= (preferredDate || localDate()))?.courseId || rows.at(-1)?.courseId || s.courses[0]?.id;
    if (!id) { sheet('单次调课', `<p class="helper-box">这个学期还没有课程。添加课程后，可在这里选择任意一次实际安排进行调课。</p>${button('add', '添加课程', 'primary full-width')}`); return; }
    const choices = occurrenceChoices(id, '', preferredDate);
    sheet('单次调课', `<form id="single-change-form" data-semester="${esc(s.id)}"><p class="sheet-subtitle">先选一门课，再选具体哪一次。列表包含整日补课、已调课后的实际安排。</p>${field('选择课程', select('courseId', s.courses.map(c => [c.id, `${c.name}${c.sessions[0]?.teacher ? ` · ${c.sessions[0].teacher}` : ''}`]), id))}<label class="field"><span>选择原上课日期与节次</span><div data-occurrence-choices>${choices.html}</div></label><div data-single-fields>${singleFields(choices.chosen)}</div></form>`);
  }

  function click(action, el) {
    if (action === 'calendar') { openCalendar(); return true; }
    if (action === 'day-rule') { openCalendar(el?.dataset?.date || localDate(), false); return true; }
    if (action === 'single-change') { let date; try { date = formDates(dayForm())[0]; } catch {} singleChangeForm(el?.dataset?.date || date); return true; }
    if (!['calendar-month-prev', 'calendar-month-next', 'calendar-pick', 'calendar-clear', 'calendar-operation'].includes(action)) return false;
    const form = dayForm(), values = valuesOf(form);
    if (form.dataset.semester !== semester().id) throw Error('学期已变化，请重新打开日历');
    if (action.startsWith('calendar-month-')) {
      const [year, month] = values.calendarMonth.split('-').map(Number), date = localDate(new Date(year, month - 1 + (action.endsWith('next') ? 1 : -1), 1));
      addDays(date, 0); setValue(form, 'calendarMonth', date.slice(0, 7));
    }
    if (action === 'calendar-pick') {
      const date = addDays(el.dataset.date, 0);
      if (values.dateMode === 'single') setValue(form, 'date', date);
      else if (values.dateMode === 'range') {
        const anchor = values.rangeAnchor;
        setValue(form, 'rangeStart', anchor && anchor < date ? anchor : date); setValue(form, 'rangeEnd', anchor && anchor > date ? anchor : date); setValue(form, 'rangeAnchor', anchor ? '' : date);
      } else { const dates = selected(form), index = dates.indexOf(date); if (index >= 0) dates.splice(index, 1); else { if (dates.length >= 366) throw Error('一次最多选择 366 天'); dates.push(date); } setValue(form, 'selectedDates', JSON.stringify(dates)); }
    }
    if (action === 'calendar-clear') { setValue(form, 'selectedDates', '[]'); setValue(form, 'dateMode', 'multiple'); setValue(form, 'rangeAnchor', ''); syncVisibility(form); }
    if (action === 'calendar-operation') {
      formDates(form); setValue(form, 'type', el.dataset.operation === 'off' ? 'off' : 'replace'); setValue(form, 'sourceMode', el.dataset.operation === 'date' ? 'date' : 'weekday'); syncVisibility(form);
      form.querySelector('[data-adjust-fields]').scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
    redrawCalendar(form); return true;
  }

  function submit(form, values) {
    if (!['day-rule-form', 'single-change-form'].includes(form.id)) return false;
    if (form.dataset.semester !== semester().id) throw Error('学期已变化，请重新打开调整表单');
    if (form.id === 'day-rule-form') {
      const original = semester(), plan = planDayAdjustment(original, values, selected(form));
      const rows = plan.rules.map(rule => {
        const before = occurrencesOn(original, rule.date).filter(o => o.kind === 'course').length, after = occurrencesOn(plan.semester, rule.date), courses = after.filter(o => o.kind === 'course'), exams = after.filter(o => o.kind === 'exam');
        const source = rule.type === 'replace' ? `${rule.sourceDate}（第 ${getWeek(rule.sourceDate, original.startDate)} 周·${getWeek(rule.sourceDate, original.startDate) % 2 ? '单周' : '双周'}·周${DAYS[weekday(rule.sourceDate) - 1]}） → ` : '';
        return `<div class="adjust-preview-row"><strong>${esc(source)}${rule.date}</strong><span>原 ${before} 次课程 → ${courses.length} 次${exams.length ? `；${exams.length} 场独立考试保留` : ''}</span>${courses.length ? `<small>${courses.map(o => esc(o.name)).join('、')}</small>` : ''}</div>`;
      }).join('');
      ctx.reviewSemester(plan.semester, '批量教学调整前', `<strong>确认${values.type === 'off' ? '停课' : '补课'} ${plan.rules.length} 天</strong><div class="adjust-preview-list">${rows}</div>保存后可在教学调整列表撤销。`, plan.dates);
    } else {
      const plan = planSingleChange(semester(), values.occurrenceId, values), { occurrence: o, target } = plan;
      const conflicts = target ? occurrencesOn(plan.semester, target.date).filter(other => target.conflicts.includes(other.id)) : [];
      const message = target ? `<strong>${esc(o.name)}</strong><br>${o.date} 第 ${o.startPeriod}–${o.endPeriod} 节<br>→ ${target.date} 第 ${target.startPeriod}–${target.endPeriod} 节（${target.segments[0].start}–${target.segments.at(-1).end}）<br>${esc(target.location || '地点待定')} · ${esc(target.teacher || '教师待定')}${conflicts.length ? `<br><strong>与 ${conflicts.map(c => esc(c.name)).join('、')} 时间重叠，请核对。</strong>` : ''}` : `取消「${esc(o.name)}」在 ${o.date} 第 ${o.startPeriod}–${o.endPeriod} 节的这一次安排。`;
      ctx.reviewSemester(plan.semester, '单次调课前', `${message}<br>其他周次保持原安排。`, plan.dates);
    }
    return true;
  }

  function change(target) {
    const form = target.closest('#day-rule-form');
    if (form) {
      if (['sourceWeek', 'sourceWeekMode', 'sourceWeekday'].includes(target.name)) {
        const error = form.querySelector('#form-error'); if (error) error.textContent = '';
      }
      if (target.name === 'dateMode') setValue(form, 'rangeAnchor', '');
      if (target.name === 'sourceWeekMode') setValue(form, 'sourceWeek', '');
      if (['date', 'rangeStart'].includes(target.name) && target.value) setValue(form, 'calendarMonth', addDays(target.value, 0).slice(0, 7));
      syncVisibility(form); redrawCalendar(form); return true;
    }
    const single = target.closest('#single-change-form'); if (!single) return false;
    if (target.name === 'courseId') {
      const choices = occurrenceChoices(target.value); single.querySelector('[data-occurrence-choices]').innerHTML = choices.html; single.querySelector('[data-single-fields]').innerHTML = singleFields(choices.chosen);
    }
    if (target.name === 'occurrenceId') single.querySelector('[data-single-fields]').innerHTML = singleFields(courseOccurrences(semester(), single.elements.namedItem('courseId').value).find(o => o.id === target.value));
    if (target.name === 'action') single.querySelector('[data-single-target]').hidden = target.value === 'cancel';
    if (target.name === 'date' && target.value) for (const name of ['startPeriod', 'endPeriod']) {
      const el = single.elements.namedItem(name), value = Number(el.value); el.innerHTML = periodOptions(addDays(target.value, 0), value, name === 'endPeriod').map(([v, text]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${esc(text)}</option>`).join('');
    }
    return true;
  }
  return { click, submit, change };
}
