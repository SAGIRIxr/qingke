// Only explicit assessment metadata is accepted; course names and course nature
// (for example 必修 / 选修) cannot establish an assessment method.
const LABEL = '考核方式|考核方法|考核形式|考核类别|考核类型|考核';
const OTHER_LABEL = `${LABEL}|课程名称|课程名|课程|课程性质|课程类别|任课教师|教师|老师|上课地点|地点|教室|场地|上课周次|周次|上课节次|节次|星期|教学班|学分|备注`;
const SEPARATOR = '(?:[ \\t]*[:：][ \\t]*(?:\\n[ \\t]*)?|[ \\t]*\\n[ \\t]*|[ \\t]+)';
const KNOWN_VALUE = /^考\s*(?:试|查)(?:\s*课)?$/;

function text(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n')
    .replace(/考\s*核\s*(?:方\s*式|方\s*法|形\s*式|类\s*别|类\s*型)/g, label => label.replace(/\s/g, '')).trim();
}

function value(raw) {
  const result = raw.trim().replace(/[ \t]+/g, ' ');
  if (/^考\s*试(?:\s*课)?$/.test(result)) return '考试';
  if (/^考\s*查(?:\s*课)?$/.test(result)) return '考查';
  return /^(?:未设置|未提供|未注明|未知|暂无|无|待定|[-—/]+)$/.test(result) ? '' : result;
}

/** Unique explicit values. More than one value is a conflict, not a guess. */
export function assessmentValuesFromText(input) {
  const source = text(input);
  const values = new Set();
  const fields = new RegExp(`(?:${LABEL})(${SEPARATOR})(.*?)(?=(?:${OTHER_LABEL})[ \\t]*[:：]|[\\n|｜;；]|$)`, 'g');
  for (const match of source.matchAll(fields)) {
    // An empty field may precede the next course/teacher/time line. Across a
    // newline accept only an unambiguous known token; custom values must stay
    // on the explicitly labelled line or come from a dedicated DOM/table field.
    if (match[1].includes('\n') && !KNOWN_VALUE.test(match[2].trim())) continue;
    const found = value(match[2]);
    if (found) values.add(found);
  }
  for (const part of source.split(/[\n|｜;；]/)) {
    if (KNOWN_VALUE.test(part.trim())) values.add(value(part));
  }
  return [...values];
}

export function assessmentFromText(input) {
  const values = assessmentValuesFromText(input);
  return values.length === 1 ? values[0] : '';
}

/** A whole metadata line, including an empty label, must not become a name. */
export function isAssessmentMetadata(input) {
  const source = text(input);
  if (KNOWN_VALUE.test(source)) return true;
  if (new RegExp(`^(?:${LABEL})[ \\t:：]*$`).test(source)) return true;
  const prefix = source.match(new RegExp(`^(?:${LABEL})(${SEPARATOR})`));
  if (!prefix) return false;
  const remaining = source.slice(prefix[0].length);
  if (prefix[1].includes('\n') && !KNOWN_VALUE.test(remaining.trim())) return false;
  return !new RegExp(`(?:${OTHER_LABEL})[ \\t]*[:：]|[\\n|｜;；]`).test(remaining);
}
