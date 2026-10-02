import { createCalendarUI } from './calendar-ui.js';
import { getWeekDates } from './core.js';
import { uid, localDate, makeSemester, validateState, getProfile, updatePeriodTime, copyPeriodGroup } from './engine.js';
import { esc, clone, icon, DAYS, button, select, field, input, toast, sheet, submit as submitButton } from './ui.js';

const GROUPS = [['morning', '上午'], ['afternoon', '下午'], ['evening', '晚上']];
const defaultGroup = index => index < 4 ? 'morning' : index < 8 ? 'afternoon' : 'evening';
const weekday = date => new Date(`${date}T12:00:00`).getDay() || 7;
const valuesOf = form => Object.fromEntries(new FormData(form));
const toMinutes = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
const toTime = value => { if (value < 0 || value > 1439) throw Error('增加节次后超出当天，请先调整前一节时间'); return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; };
const monthDay = value => value.length === 10 ? value.slice(5) : value;

/** Management sheets keep unsaved form controls in place while updating only rows/calendar. */
export function createManagementUI(ctx) {
  let profileDraft = null, semesterDraft = null;
  const calendar = createCalendarUI(ctx);
  const state = () => ctx.getState();
  const semester = () => ctx.getSemester();
  const withSemester = next => ({ ...state(), semesters: state().semesters.map(s => s.id === next.id ? next : s) });

  function profilesSheet() {
    const s = semester();
    sheet('每年循环的作息', `<p class="sheet-subtitle">按月日每年自动切换；年初沿用上一套已生效的方案。</p>${[...s.profiles].sort((a, b) => monthDay(a.effectiveFrom).localeCompare(monthDay(b.effectiveFrom))).map(p => `<button class="profile-card" data-action="profile-edit" data-id="${esc(p.id)}"><div><strong>${esc(p.name)}</strong><small>每年 ${esc(monthDay(p.effectiveFrom).replace('-', ' 月 '))} 日起 · ${p.periods.length} 节</small></div>${icon('right', 15)}</button>`).join('')}${button('profile-add', `${icon('plus', 16)} 添加作息方案`, 'primary full-width', 'style="margin-top:18px"')}`);
  }

  function periodRow(period, index) {
    return `<div class="period-edit managed-period-row" data-period-index="${index}"><label>${String(index + 1).padStart(2, '0')}</label>${select(`group-${index}`, GROUPS, period.group ?? defaultGroup(index))}<input type="time" name="start-${index}" value="${esc(period.start)}" required data-period-index="${index}" data-time-field="start" aria-label="第 ${index + 1} 节开始"><span>–</span><input type="time" name="end-${index}" value="${esc(period.end)}" required data-period-index="${index}" data-time-field="end" aria-label="第 ${index + 1} 节结束"></div>`;
  }

  function redrawPeriods() {
    document.querySelector('#period-rows').innerHTML = profileDraft.periods.map(periodRow).join('');
    const count = document.querySelector('#managed-period-count');
    if (count) count.textContent = `${profileDraft.periods.length} 节`;
  }

  function readProfileControls(form = document.querySelector('#profile-form')) {
    const values = valuesOf(form);
    profileDraft.name = values.name;
    profileDraft.effectiveFrom = `${String(values.effectiveMonth).padStart(2, '0')}-${String(values.effectiveDay).padStart(2, '0')}`;
    profileDraft.periods = [...form.querySelectorAll('[data-period-index].managed-period-row')].map((row, i) => ({ start: values[`start-${i}`], end: values[`end-${i}`], group: values[`group-${i}`] }));
    return values;
  }

  function profileForm(id) {
    const existing = semester().profiles.find(p => p.id === id);
    profileDraft = existing ? clone(existing) : { id: uid(), name: '新作息', effectiveFrom: localDate().slice(5), periods: clone(getProfile(semester(), localDate()).periods) };
    profileDraft.periods = profileDraft.periods.map((p, i) => ({ ...p, group: p.group ?? defaultGroup(i) }));
    const [month, day] = monthDay(profileDraft.effectiveFrom).split('-').map(Number);
    const sources = semester().profiles.map(p => [p.id, p.name]);
    const sourceId = semester().profiles.find(p => p.id !== id)?.id ?? sources[0][0];
    sheet(existing ? '编辑作息方案' : '添加作息方案', `<form id="profile-form" data-id="${esc(profileDraft.id)}">${field('方案名称', input('name', profileDraft.name, 'text', 'required maxlength="50" placeholder="例如 夏季作息"'))}<div class="form-row">${field('每年生效月份', select('effectiveMonth', Array.from({ length: 12 }, (_, i) => [i + 1, `${i + 1} 月`]), month))}${field('日期', select('effectiveDay', Array.from({ length: 31 }, (_, i) => [i + 1, `${i + 1} 日`]), day))}</div><p class="sheet-subtitle">不限定年份。该月日之后使用本方案，直到下一套方案生效；不存在的月日会在保存时提示。</p><label class="check-row"><input name="cascade" type="checkbox" checked><span><strong>同组时间联动</strong><small>修改一节后顺延本组后续小节，保留课间；不影响其他组。</small></span></label><div class="section-label">小节时间 <span id="managed-period-count">${profileDraft.periods.length} 节</span></div><div id="period-rows">${profileDraft.periods.map(periodRow).join('')}</div><div class="sheet-actions">${button('period-add', '增加一节')}${button('period-remove', '减少最后一节')}</div><details class="group-copy-box"><summary>从另一方案复制一个时段</summary>${field('来源方案', select('copySource', sources, sourceId))}<div class="form-row">${field('复制时段', select('copyGroup', GROUPS, 'afternoon'))}${field('整体偏移（分钟）', input('copyOffset', 0, 'number', 'min="-1439" max="1439" step="1"'))}</div><p class="sheet-subtitle">例如下午填 −30，整体提前半小时。保留每节时长及课间；来源与目标分组节数须一致。</p>${button('profile-copy-group', '复制到当前草稿', 'secondary full-width')}</details>${submitButton('预览并保存作息')}${existing ? button('profile-delete', '删除此作息方案', 'text-button', `data-id="${esc(existing.id)}" style="color:#a45b43;margin-top:12px"`) : ''}</form>`);
  }

  function deleteProfile(id) {
    const s = clone(semester()), profile = s.profiles.find(p => p.id === id);
    if (!profile) throw Error('作息方案已不存在');
    if (s.profiles.length === 1) throw Error('至少保留一套作息方案；可以编辑当前方案');
    s.profiles = s.profiles.filter(p => p.id !== id);
    ctx.reviewSemester(s, '删除作息方案前', `删除「${esc(profile.name)}」后，每年的对应日期将使用上一套已生效作息。`);
  }

  function academicPreset(date = localDate()) {
    const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
    return { year: month >= 8 ? year : year - 1, term: month >= 2 && month <= 7 ? 2 : 1 };
  }
  function academicName(year, term) { return `${year}—${Number(year) + 1} 学年${Number(term) === 2 ? '第二' : '第一'}学期`; }

  function semestersSheet() {
    sheet('我的学期', `<p class="sheet-subtitle">每个学期单独保存课程、考试、作息与教学调整；提醒跟随当前学期。</p>${state().semesters.map(s => `<div class="semester-card managed-semester-card"><button class="managed-semester-main" data-action="switch-semester" data-id="${esc(s.id)}"><strong>${esc(s.name)}</strong><small>${s.startDate} 开始 · ${s.totalWeeks} 周 · ${s.courses.length} 门课程 · ${(s.exams ?? []).length} 场考试</small></button>${s.id === state().activeSemesterId ? '<span class="pill">当前</span>' : ''}<div class="managed-card-actions">${button('semester-edit', '编辑', 'text-button', `data-id="${esc(s.id)}"`)}${button('semester-delete', '删除', 'text-button danger-text', `data-id="${esc(s.id)}"`)}</div></div>`).join('')}${button('new-semester', `${icon('plus', 16)} 新建学期`, 'primary full-width', 'style="margin-top:16px"')}`);
  }

  function semesterForm(isNew = false, id) {
    const s = isNew ? makeSemester() : state().semesters.find(item => item.id === (id ?? state().activeSemesterId));
    if (!s) throw Error('学期已不存在');
    const preset = academicPreset(s.startDate), match = s.name.match(/^(\d{4})[—–-](\d{4}) 学年(第一|第二)学期$/);
    if (match) { preset.year = Number(match[1]); preset.term = match[3] === '第二' ? 2 : 1; }
    const namingMode = isNew || match ? 'auto' : 'custom';
    semesterDraft = { isNew, semester: clone(s) };
    sheet(isNew ? '新建学期' : '编辑学期', `<form id="semester-form" data-id="${esc(s.id)}" data-new="${isNew}"><div class="form-row">${field('学年起始年', input('academicYear', preset.year, 'number', 'min="1900" max="2199" step="1" required'))}${field('学期', select('academicTerm', [[1, '第一学期'], [2, '第二学期']], preset.term))}</div>${field('名称方式', select('namingMode', [['auto', '按学年与学期自动命名'], ['custom', '使用自定义名称']], namingMode))}${field('学期名称', input('name', namingMode === 'auto' ? academicName(preset.year, preset.term) : s.name, 'text', `required maxlength="80" ${namingMode === 'auto' ? 'readonly' : ''}`))}${field('实际开学日期', input('startDate', s.startDate, 'date', 'required'), '可以是任意星期。教学周始终周一至周日，首周开学前几天不排基础课程。')}${field('学期总周数', input('totalWeeks', s.totalWeeks, 'number', 'min="1" max="30" step="1" required'))}${submitButton(isNew ? '创建学期' : '预览学期变更')}</form>`);
  }

  function updateSemesterName(form) {
    const values = valuesOf(form), name = form.elements.namedItem('name');
    const automatic = values.namingMode === 'auto'; name.readOnly = automatic;
    if (automatic && /^\d{4}$/.test(values.academicYear)) name.value = academicName(values.academicYear, values.academicTerm);
  }

  function deleteSemester(id) {
    const current = state(), targetId = id ?? current.activeSemesterId, target = current.semesters.find(s => s.id === targetId);
    if (!target) throw Error('学期已不存在');
    let remaining = current.semesters.filter(s => s.id !== targetId);
    const last = remaining.length === 0;
    if (last) remaining = [makeSemester({ name: '新学期' })];
    const next = { ...current, semesters: remaining, activeSemesterId: current.activeSemesterId === targetId ? remaining[0].id : current.activeSemesterId };
    ctx.confirmChange(next, '删除学期前', `删除「${esc(target.name)}」及其 ${target.courses.length} 门课程、${(target.exams ?? []).length} 场考试、作息与教学调整。${last ? '<br>这是最后一个学期，删除后会自动建立一个空白学期。' : ''}<br>删除前会保存恢复版本。`);
  }

  function click(action, el) {
    if (calendar.click(action, el)) return true;
    const id = el?.dataset?.id;
    switch (action) {
      case 'profiles': profilesSheet(); return true;
      case 'profile-add': profileForm(); return true;
      case 'profile-edit': profileForm(id); return true;
      case 'profile-delete': deleteProfile(id); return true;
      case 'period-add': {
        readProfileControls(); if (profileDraft.periods.length >= 24) throw Error('最多支持 24 节');
        const index = profileDraft.periods.length, end = toMinutes(profileDraft.periods.at(-1).end);
        profileDraft.periods.push({ start: toTime(end + 10), end: toTime(end + 55), group: defaultGroup(index) });
        redrawPeriods(); return true;
      }
      case 'period-remove': readProfileControls(); if (profileDraft.periods.length <= 1) throw Error('至少保留一节'); profileDraft.periods.pop(); redrawPeriods(); return true;
      case 'profile-copy-group': {
        const values = readProfileControls(), source = semester().profiles.find(p => p.id === values.copySource);
        if (!source) throw Error('来源作息不存在');
        profileDraft.periods = copyPeriodGroup(source.periods, profileDraft.periods, values.copyGroup, Number(values.copyOffset));
        redrawPeriods(); toast('已复制到草稿，其他时段和未保存内容保留'); return true;
      }
      case 'semesters': semestersSheet(); return true;
      case 'new-semester': semesterForm(true); return true;
      case 'semester-edit': semesterForm(false, id); return true;
      case 'semester-delete': deleteSemester(id); return true;
      default: return false;
    }
  }

  function submit(form, values) {
    if (calendar.submit(form, values)) return true;
    switch (form.id) {
      case 'profile-form': {
        readProfileControls(form); const s = clone(semester());
        s.profiles = [...s.profiles.filter(p => p.id !== profileDraft.id), clone(profileDraft)];
        ctx.reviewSemester(s, '修改作息前', `每年 ${esc(profileDraft.effectiveFrom.replace('-', ' 月 '))} 日起使用「${esc(profileDraft.name)}」，共 ${profileDraft.periods.length} 节。课程与提醒按实际上课日期切换。`); return true;
      }
      case 'semester-form': {
        if (!semesterDraft) throw Error('学期草稿已过期，请重新打开');
        const original = semesterDraft.semester, s = semesterDraft.isNew ? makeSemester({ name: values.name, startDate: values.startDate, totalWeeks: Number(values.totalWeeks) }) : { ...clone(original), name: values.name, startDate: values.startDate, totalWeeks: Number(values.totalWeeks) };
        const next = semesterDraft.isNew ? { ...state(), semesters: [...state().semesters, s], activeSemesterId: s.id } : withSemester(s);
        const checked = validateState(next), firstWeek = getWeekDates(s.startDate, 1), nonMonday = weekday(s.startDate) !== 1;
        const message = `${semesterDraft.isNew ? '创建' : '更新'}「${esc(s.name)}」，从 ${s.startDate} 起，共 ${s.totalWeeks} 个教学周。${nonMonday ? `<br><strong>开学日是星期${DAYS[weekday(s.startDate) - 1]}。</strong>第 1 周仍为 ${firstWeek[0]} 至 ${firstWeek[6]}，仅从 ${s.startDate} 开始排基础课程；此前几天不排课。请确认学校使用这种周次划分。` : ''}${!semesterDraft.isNew ? '<br>课程日期会重新计算，作息按每年月日切换；已有单次变更必须仍对应有效原安排。' : ''}`;
        if (nonMonday || !semesterDraft.isNew) ctx.confirmChange(checked, semesterDraft.isNew ? '新建学期前' : '修改学期设置前', message);
        else if (ctx.save(checked, '新建学期前')) { ctx.refresh(); toast('新学期已创建'); }
        return true;
      }
      default: return false;
    }
  }

  function change(target) {
    if (calendar.change(target)) return true;
    const profileForm = target.closest('#profile-form');
    if (profileForm) {
      if (target.dataset.timeField) {
        const index = Number(target.dataset.periodIndex), original = profileDraft.periods[index][target.dataset.timeField];
        try {
          profileDraft.periods = updatePeriodTime(profileDraft.periods, index, target.dataset.timeField, target.value, { cascade: profileForm.elements.namedItem('cascade').checked });
          redrawPeriods();
        } catch (error) { target.value = original; toast(error.message); }
      } else if (target.name.startsWith('group-')) {
        profileDraft.periods[Number(target.name.slice(6))].group = target.value;
      }
      return true;
    }
    const semesterForm = target.closest('#semester-form');
    if (semesterForm) { if (['academicYear', 'academicTerm', 'namingMode'].includes(target.name)) updateSemesterName(semesterForm); return true; }
    return false;
  }

  return { click, submit, change };
}
