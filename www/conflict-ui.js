import { occurrencesOn } from './engine.js';
import { courseLive } from './course-live.js';
import { esc, icon, sheet } from './ui.js';

/** Connected components of actual occupied time. Touching endpoints do not overlap. */
export function conflictGroups(occurrences) {
  const byDate = new Map(), result = [];
  for (const item of occurrences) {
    if (!Number.isFinite(item.startMs) || !Number.isFinite(item.endMs) || item.endMs <= item.startMs) throw Error('课程起止时间无效，无法核对冲突');
    if (!byDate.has(item.date)) byDate.set(item.date, []);
    byDate.get(item.date).push(item);
  }
  for (const [date, items] of byDate) {
    let current = [], end = -Infinity;
    const finish = () => {
      if (current.length > 1) {
        const courses = current.filter(o => o.kind !== 'exam'), exams = current.filter(o => o.kind === 'exam');
        result.push({ date, id: (courses[0] || current[0]).id, items: [...current], courses, exams, startMs: current[0].startMs, endMs: end,
          startPeriod: courses.length ? Math.min(...courses.map(o => o.startPeriod)) : 0,
          endPeriod: courses.length ? Math.max(...courses.map(o => o.endPeriod)) : 0 });
      }
      current = []; end = -Infinity;
    };
    for (const item of [...items].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.id.localeCompare(b.id))) {
      if (current.length && item.startMs >= end) finish();
      current.push(item); end = Math.max(end, item.endMs);
    }
    finish();
  }
  return result;
}

export function arrangementOrigin(semester, occurrence) {
  if (occurrence.kind === 'exam') return { label: '独立考试', description: '按独立考试时间安排，另见课表上方考试区', kind: 'exam' };
  const exception = semester.exceptions?.find(e => e.sessionId === occurrence.sessionId && e.sourceDate === occurrence.sourceDate);
  const replacement = semester.dayRules?.find(r => r.type === 'replace' && r.date === occurrence.date && r.sourceDate === occurrence.sourceDate);
  if (exception?.type === 'move') {
    const sameDay = occurrence.date === occurrence.sourceDate;
    return { label: sameDay ? '单次调整' : '调入', description: `${sameDay ? '调整当天这一次课程的时间或地点' : `从 ${occurrence.sourceDate} 的原安排调入`}${exception.note ? ` · ${exception.note}` : ''}`, kind: sameDay ? 'modified' : 'moved' };
  }
  if (exception?.type === 'modify') return { label: replacement ? '补课 · 已调整' : '单次调整', description: `${replacement ? `补 ${occurrence.sourceDate} 的课，` : ''}仅修改这一次的时间或地点`, kind: 'modified' };
  if (replacement) return { label: '整日补课', description: `补 ${occurrence.sourceDate} 的课${replacement.label ? ` · ${replacement.label}` : ''}`, kind: 'makeup' };
  return { label: '原安排', description: '按这门课的重复上课安排', kind: 'original' };
}

export function conflictSummary(group) {
  if (!group.exams.length) return `${group.courses.length} 门课程时间重叠`;
  if (!group.courses.length) return `${group.exams.length} 场考试时间重叠`;
  return `${group.courses.length} 门课程与 ${group.exams.length} 场考试时间重叠`;
}

export function conflictListMarkup(semester, group, now = Date.now()) {
  const direct = item => group.items.filter(other => other.id !== item.id && other.startMs < item.endMs && other.endMs > item.startMs);
  return `<p class="sheet-subtitle">${esc(group.date)} · ${esc(conflictSummary(group))}<br>以下安排均保留。请按学校通知核对，再选择需要调整的那一次。</p><div class="conflict-detail-list">${group.items.map(item => {
    const origin = arrangementOrigin(semester, item), live = courseLive(item, now);
    return `<button type="button" class="conflict-detail-item ${live.active ? 'is-current' : ''} ${live.phase === 'break' ? 'is-break' : ''}" data-action="detail" data-id="${esc(item.id)}" data-live-id="${esc(item.id)}"><div class="conflict-detail-heading"><span class="conflict-origin origin-${origin.kind}">${esc(origin.label)}</span><span class="conflict-now" ${live.active ? '' : 'hidden'}>进行中</span>${icon('right', 15)}</div><strong>${esc(item.name)}</strong><span class="conflict-detail-time">${item.kind === 'exam' ? '独立考试' : `第 ${item.startPeriod}–${item.endPeriod} 节`} · ${esc(item.segments[0].start)}–${esc(item.segments.at(-1).end)}</span><span>${esc(item.location || '地点待定')}${item.teacher ? ` · ${esc(item.teacher)}` : ''}</span><small>${esc(origin.description)}</small><small class="conflict-direct">与 ${direct(item).map(o => esc(o.name)).join('、')} 重叠</small><span class="course-live-label" data-live-label ${live.active ? '' : 'hidden'}>${esc(live.detail)}</span><span class="course-progress" role="progressbar" aria-label="${esc(live.aria)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(live.progress)}" style="--lesson-progress:${live.progress.toFixed(3)}%" ${live.active ? '' : 'hidden'}><i></i></span></button>`;
  }).join('')}</div><p class="source-note">点击一项可查看完整安排。重叠组中不一定每两项都同时上课，以上逐项标明了实际冲突对象。</p>`;
}

export function showConflictDetails({ semester, date, id }) {
  const group = conflictGroups(occurrencesOn(semester, date)).find(g => g.items.some(o => o.id === id));
  if (!group) throw Error('这组安排已不再重叠，请返回刷新课表');
  sheet('核对重叠安排', conflictListMarkup(semester, group));
}
