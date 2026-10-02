import { uid, createState, validateState } from './engine.js';

const ENTITY_TYPES = ['sem', 'profiles', 'course', 'session', 'dayRule', 'exception', 'holiday', 'exam'];
const ENTITY_ARRAYS = new Set(['profiles', 'courses', 'sessions', 'dayRules', 'exceptions', 'holidayLabels', 'exams']);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]));
  if (!object(a) || !object(b)) return false;
  const aKeys = Object.keys(a), bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every(key => own(b, key) && equal(a[key], b[key]));
}

function checkedSemester(raw) {
  if (!object(raw)) throw Error('分享的学期格式无效');
  const state = createState(); state.activeSemesterId = raw.id; state.semesters = [raw];
  return validateState(state).semesters[0];
}

function cleanRemote(raw) {
  const cleaned = clone(raw);
  for (const course of cleaned?.courses ?? []) for (const session of course.sessions ?? []) delete session.importSource;
  return checkedSemester(cleaned);
}

/** Map identity once per entity type. The map is private local state, not part of the shared document. */
export function remapSharedSemester(rawSemester, map = {}) {
  if (!object(map)) throw Error('分享标识映射格式无效');
  const resultMap = Object.create(null);
  for (const type of ENTITY_TYPES) {
    const old = map[type] ?? {};
    if (!object(old)) throw Error(`分享标识映射 ${type} 格式无效`);
    const next = Object.create(null);
    for (const [key, value] of Object.entries(old)) {
      if (typeof value !== 'string' || !value.trim() || value.length > 120 || key.length > 120) throw Error('分享标识映射包含无效编号');
      next[key] = value;
    }
    resultMap[type] = next;
  }
  const mapped = (type, remoteId) => {
    if (!own(resultMap[type], remoteId)) resultMap[type][remoteId] = uid();
    return resultMap[type][remoteId];
  };
  const semester = cleanRemote(rawSemester);
  semester.id = mapped('sem', semester.id);
  semester.profiles = semester.profiles.map(profile => ({ ...profile, id: mapped('profiles', profile.id) }));
  semester.courses = semester.courses.map(course => ({ ...course, id: mapped('course', course.id), sessions: course.sessions.map(session => ({ ...session, id: mapped('session', session.id) })) }));
  semester.dayRules = semester.dayRules.map(rule => ({ ...rule, id: mapped('dayRule', rule.id) }));
  semester.exceptions = semester.exceptions.map(exception => ({ ...exception, id: mapped('exception', exception.id), sessionId: mapped('session', exception.sessionId) }));
  semester.holidayLabels = semester.holidayLabels.map(holiday => ({ ...holiday, id: mapped('holiday', holiday.id) }));
  semester.exams = semester.exams.map(exam => ({ ...exam, id: mapped('exam', exam.id), ...(exam.courseId ? { courseId: mapped('course', exam.courseId) } : {}) }));
  return { semester: checkedSemester(semester), map: resultMap };
}

/** Conservative three-way merge. Week selections and whole period arrays are atomic. */
export function mergeFollowedSemester(local, baseline, incoming) {
  const checkedLocal = checkedSemester(local), checkedBase = checkedSemester(baseline), checkedIncoming = checkedSemester(incoming);
  if (checkedLocal.id !== checkedBase.id || checkedLocal.id !== checkedIncoming.id) throw Error('合并学期编号不一致，请先用同一份映射转换分享内容');
  const conflicts = [], changes = [];
  const conflict = (path, type, before, current, remote) => conflicts.push({ path, type, before: clone(before), local: clone(current), incoming: clone(remote) });
  const change = (path, type, before, after) => changes.push({ path, type, before: clone(before), after: clone(after) });

  function mergeArray(localItems, baseItems, incomingItems, path) {
    const localById = new Map(localItems.map(item => [item.id, item]));
    const baseById = new Map(baseItems.map(item => [item.id, item]));
    const incomingById = new Map(incomingItems.map(item => [item.id, item]));
    // Preserve the user's entity order; append remotely added entities in remote order.
    const ids = [...new Set([...localItems, ...incomingItems, ...baseItems].map(item => item.id))], result = [];
    for (const id of ids) {
      const hasLocal = localById.has(id), hasBase = baseById.has(id), hasIncoming = incomingById.has(id);
      const current = localById.get(id), before = baseById.get(id), remote = incomingById.get(id), itemPath = `${path}[${id}]`;
      if (!hasBase) {
        if (hasLocal && hasIncoming) {
          if (!equal(current, remote)) conflict(itemPath, 'concurrent-add', undefined, current, remote);
          result.push(clone(current));
        } else if (hasLocal) result.push(clone(current));
        else if (hasIncoming) { result.push(clone(remote)); change(itemPath, 'add', undefined, remote); }
        continue;
      }
      if (!hasLocal && !hasIncoming) continue;
      if (!hasIncoming) {
        if (!equal(current, before)) { result.push(clone(current)); conflict(itemPath, 'remote-delete', before, current, undefined); }
        else change(itemPath, 'delete', before, undefined);
        continue;
      }
      if (!hasLocal) {
        if (!equal(remote, before)) conflict(itemPath, 'local-delete', before, undefined, remote);
        continue;
      }
      result.push(mergeValue(current, before, remote, itemPath));
    }
    return result;
  }

  function mergeValue(current, before, remote, path, fieldName = '') {
    if (equal(current, remote)) return clone(current);
    if (ENTITY_ARRAYS.has(fieldName) && Array.isArray(current) && Array.isArray(before) && Array.isArray(remote)) return mergeArray(current, before, remote, path);
    if (object(current) && object(before) && object(remote)) {
      const result = {};
      for (const key of new Set([...Object.keys(current), ...Object.keys(remote), ...Object.keys(before)])) {
        const next = mergeValue(current[key], before[key], remote[key], path ? `${path}.${key}` : key, key);
        if (next !== undefined) Object.defineProperty(result, key, { value: next, enumerable: true, configurable: true, writable: true });
      }
      return result;
    }
    if (equal(current, before)) { change(path, remote === undefined ? 'delete' : before === undefined ? 'add' : 'update', before, remote); return clone(remote); }
    if (equal(remote, before)) return clone(current);
    conflict(path, 'field', before, current, remote); return clone(current);
  }

  const candidate = mergeValue(checkedLocal, checkedBase, checkedIncoming, '');
  try {
    const semester = checkedSemester(candidate);
    return { semester, conflicts, changes, needsReview: conflicts.length > 0 };
  } catch (error) {
    // For example, a remote deletion plus a locally added exception can orphan a session.
    // Return the last valid local semester, never a candidate that could corrupt saved data.
    conflicts.push({ path: '$structure', type: 'validation', before: null, local: '保留当前有效课表', incoming: error.message });
    return { semester: checkedLocal, conflicts, changes, needsReview: true, validationError: error.message };
  }
}
