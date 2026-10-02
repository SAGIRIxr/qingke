"""Strict single-semester wire format. Never serialize arbitrary client objects."""
import datetime as dt
import re

MAX_SHARE_OCCURRENCES = 10000
MAX_SHARE_DAILY_OCCURRENCES = 128
MAX_SHARE_CONFLICT_REFERENCES = 200000


class InvalidPayload(ValueError):
    pass


def obj(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed.split()):
        raise InvalidPayload(f'{label}格式无效或包含未允许字段')
    return value


def text(value, limit, label, required=False):
    if not isinstance(value, str):
        raise InvalidPayload(f'{label}必须是文字')
    value = value.strip()
    # Reject lone UTF-16 surrogates before encoding. JS validates string.length,
    # so astral characters must count as two code units on the server as well.
    if (required and not value) or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]', value):
        raise InvalidPayload(f'{label}为空、超长或含无效字符')
    if len(value) > limit or len(value.encode('utf-16-le')) // 2 > limit:
        raise InvalidPayload(f'{label}为空、超长或含无效字符')
    return value


def number(value, low, high, label):
    if type(value) is not int or not low <= value <= high:
        raise InvalidPayload(f'{label}必须是 {low}—{high} 的整数')
    return value


def boolean(value, label):
    if type(value) is not bool:
        raise InvalidPayload(f'{label}必须是开关值')
    return value


def choice(value, options, label):
    if value not in options or not isinstance(value, str):
        raise InvalidPayload(f'{label}无效')
    return value


def array(value, maximum, label, minimum=0):
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise InvalidPayload(f'{label}数量必须是 {minimum}—{maximum}')
    return value


def date(value, label='日期'):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        raise InvalidPayload(f'{label}格式必须是 YYYY-MM-DD')
    try:
        parsed = dt.date.fromisoformat(value)
        if not 1900 <= parsed.year <= 2200:
            raise ValueError()
    except ValueError:
        raise InvalidPayload(f'{label}不存在或年份无效') from None
    return value


def clock(value):
    if not isinstance(value, str) or not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]', value):
        raise InvalidPayload('时间必须是 HH:MM')
    return value


def unique(rows, key, label):
    keys = [key(row) for row in rows]
    if len(set(keys)) != len(keys):
        raise InvalidPayload(f'{label}重复')


def identifier(raw):
    return text(raw.get('id'), 120, '编号', True)


def validate_share_budget(semester):
    """Bound client expansion of an already normalized semester, without a graph.

    A same-day pair is conservatively counted as a possible conflict even when
    its times differ. This bounds the client's quadratic conflict arrays. The
    raw candidate cap is intentional: cancellations cannot hide huge input.
    Call this when accepting a share and before returning older stored shares.
    """
    start = dt.date.fromisoformat(semester['startDate'])
    monday = start - dt.timedelta(days=start.weekday())
    sessions = [s for course in semester['courses'] for s in course['sessions']]
    exams = semester.get('exams', [])
    candidates = len(exams)
    for session in sessions:
        candidates += len(session['weeks']) - int(1 in session['weeks'] and session['day'] < start.isoweekday())
        if candidates > MAX_SHARE_OCCURRENCES:
            raise InvalidPayload('分享课表展开后的候选安排超过 10000 次，请减少分享内容')
    if candidates > MAX_SHARE_OCCURRENCES:
        raise InvalidPayload('分享课表展开后的候选安排超过 10000 次，请减少分享内容')

    rules = {r['date']: r for r in semester.get('dayRules', [])}
    destinations = {r['sourceDate']: r['date'] for r in rules.values() if r['type'] == 'replace'}
    exceptions = {(e['sessionId'], e['sourceDate']): e for e in semester.get('exceptions', [])}
    counts = {}
    total = references = 0

    def add(value):
        nonlocal total, references
        previous = counts.get(value, 0)
        if previous >= MAX_SHARE_DAILY_OCCURRENCES:
            raise InvalidPayload('分享课表同一天的实际安排超过 128 次，请减少分享内容')
        total += 1
        references += 2 * previous  # n*(n-1) - (n-1)*(n-2)
        if total > MAX_SHARE_OCCURRENCES or references > MAX_SHARE_CONFLICT_REFERENCES:
            raise InvalidPayload('分享课表展开或同日安排过于密集，请减少分享内容')
        counts[value] = previous + 1

    for session in sessions:
        for week in session['weeks']:
            source = monday + dt.timedelta(days=(week - 1) * 7 + session['day'] - 1)
            if source < start:
                continue
            source = source.isoformat()
            exception = exceptions.get((session['id'], source))
            if exception and exception['type'] == 'cancel':
                continue
            # Individual moves remain effective on an off/replacement day,
            # matching occurrencesOn; they are not cloned with their source.
            if exception and exception['type'] == 'move':
                add(exception['date'])
            elif source in destinations:
                add(destinations[source])
            elif source not in rules:
                add(source)
    # Exams are independent of teaching-day rules and seasonal periods.
    for exam in exams:
        add(exam['date'])
    return {'occurrences': total, 'maxPerDay': max(counts.values(), default=0), 'conflictReferences': references}


def normalize_payload(raw, updating=False):
    obj(raw, 'format version semester includeNotes includeExams expiresInDays allowFollow' + (' expectedRevision' if updating else ''), '分享请求')
    if raw.get('format') != 'qingke-semester' or type(raw.get('version')) is not int or raw['version'] != 1:
        raise InvalidPayload('分享格式或版本不受支持')
    notes = boolean(raw.get('includeNotes', False), '分享备注')
    exams = boolean(raw.get('includeExams', False), '分享考试')
    following = boolean(raw.get('allowFollow', False), '允许跟随更新')
    if updating:
        number(raw.get('expectedRevision'), 1, 2147483646, '预期版本')
    days = None if updating and 'expiresInDays' not in raw else number(raw.get('expiresInDays', 180 if following else 7), 1, 365 if following else 30, '有效天数')
    source = obj(raw.get('semester'), 'id name startDate totalWeeks showWeekend profiles courses dayRules exceptions holidayLabels exams', '学期')
    result = dict(id=identifier(source), name=text(source.get('name'), 80, '学期名称', True),
                  startDate=date(source.get('startDate'), '开学日期'), totalWeeks=number(source.get('totalWeeks'), 1, 30, '学期周数'),
                  showWeekend=boolean(source.get('showWeekend'), '显示周末'), profiles=[], courses=[], dayRules=[], exceptions=[], holidayLabels=[], exams=[])
    start = dt.date.fromisoformat(result['startDate'])
    monday = start - dt.timedelta(days=start.weekday())

    def week(value):
        return (dt.date.fromisoformat(value) - monday).days // 7 + 1

    for p in array(source.get('profiles'), 30, '作息方案', 1):
        obj(p, 'id name effectiveFrom periods', '作息方案')
        effective = p.get('effectiveFrom')
        if not isinstance(effective, str) or not re.fullmatch(r'[0-9]{2}-[0-9]{2}', effective):
            raise InvalidPayload('作息生效日期必须是 MM-DD')
        date('2000-' + effective, '作息生效日期')
        profile = dict(id=identifier(p), name=text(p.get('name'), 50, '作息名称', True), effectiveFrom=effective, periods=[])
        previous = ''
        for i, period in enumerate(array(p.get('periods'), 24, '节次', 1)):
            obj(period, 'start end group', '节次')
            begin, end = clock(period.get('start')), clock(period.get('end'))
            if begin >= end or begin < previous:
                raise InvalidPayload('作息须递增且不重叠')
            previous = end
            profile['periods'].append(dict(start=begin, end=end, group=choice(period.get('group', 'morning' if i < 4 else 'afternoon' if i < 8 else 'evening'), ['morning', 'afternoon', 'evening'], '节次分组')))
        result['profiles'].append(profile)
    unique(result['profiles'], lambda p: p['id'], '作息编号')
    unique(result['profiles'], lambda p: p['effectiveFrom'], '作息生效日期')
    result['profiles'].sort(key=lambda p: p['effectiveFrom'])
    max_period = min(len(p['periods']) for p in result['profiles'])
    sessions = {}
    for c in array(source.get('courses'), 500, '课程'):
        obj(c, 'id name shortName color assessment nature note sessions', '课程')
        course = dict(id=identifier(c), name=text(c.get('name'), 100, '课程名称', True), shortName=text(c.get('shortName', ''), 30, '简称'),
                      color=number(c.get('color'), 0, 7, '颜色'), assessment=text(c.get('assessment', '未设置'), 30, '考核方式', True),
                      nature=text(c.get('nature', ''), 50, '课程性质'), note=text(c.get('note', ''), 2000, '备注') if notes else '', sessions=[])
        for s in array(c.get('sessions'), 100, '上课安排', 1):
            obj(s, 'id day startPeriod endPeriod weeks teacher location breakMode importSource', '上课安排')
            begin = number(s.get('startPeriod'), 1, max_period, '开始节次')
            session = dict(id=identifier(s), day=number(s.get('day'), 1, 7, '星期'), startPeriod=begin,
                           endPeriod=number(s.get('endPeriod'), begin, max_period, '结束节次'),
                           weeks=sorted(set(number(w, 1, result['totalWeeks'], '周次') for w in array(s.get('weeks'), 300, '周次', 1))),
                           teacher=text(s.get('teacher', ''), 100, '教师'), location=text(s.get('location', ''), 150, '教室'),
                           breakMode=choice(s.get('breakMode', 'normal'), ['normal', 'continuous'], '课间模式'))
            if session['id'] in sessions:
                raise InvalidPayload('上课安排编号重复')
            sessions[session['id']] = session
            course['sessions'].append(session)
        result['courses'].append(course)
    unique(result['courses'], lambda c: c['id'], '课程编号')
    if len(sessions) > 5000:
        raise InvalidPayload('上课安排总数超过 5000')
    for r in array(source.get('dayRules', []), 500, '整日调整'):
        obj(r, 'id date type label sourceDate', '整日调整')
        rule = dict(id=identifier(r), date=date(r.get('date')), type=choice(r.get('type'), ['off', 'replace'], '整日调整类型'), label=text(r.get('label', ''), 150, '调整说明'))
        if rule['type'] == 'replace':
            origin = date(r.get('sourceDate'))
            if origin == rule['date'] or origin < result['startDate'] or not 1 <= week(origin) <= result['totalWeeks']:
                raise InvalidPayload('补课来源日期无效')
            rule['sourceDate'] = origin
        result['dayRules'].append(rule)
    unique(result['dayRules'], lambda r: r['id'], '整日调整编号')
    unique(result['dayRules'], lambda r: r['date'], '整日调整日期')
    replacements = [r for r in result['dayRules'] if r['type'] == 'replace']
    unique(replacements, lambda r: r['sourceDate'], '补课来源日期')
    if any(r['sourceDate'] in {p['date'] for p in replacements} for r in replacements):
        raise InvalidPayload('不支持连锁补课')
    for e in array(source.get('exceptions', []), 3000, '单次调整'):
        obj(e, 'id sessionId sourceDate type date startPeriod endPeriod location teacher note', '单次调整')
        ex = dict(id=identifier(e), sessionId=text(e.get('sessionId'), 120, '安排编号', True), sourceDate=date(e.get('sourceDate')), type=choice(e.get('type'), ['cancel', 'move', 'modify'], '单次调整类型'))
        session = sessions.get(ex['sessionId'])
        if not session or ex['sourceDate'] < result['startDate'] or dt.date.fromisoformat(ex['sourceDate']).isoweekday() != session['day'] or week(ex['sourceDate']) not in session['weeks']:
            raise InvalidPayload('单次调整没有对应的原始课程')
        if ex['type'] == 'move':
            ex['date'] = date(e.get('date'))
        for key in ['startPeriod', 'endPeriod']:
            if key in e:
                ex[key] = number(e[key], 1, max_period, '调整节次')
        if ex.get('endPeriod', session['endPeriod']) < ex.get('startPeriod', session['startPeriod']):
            raise InvalidPayload('调整结束节次早于开始节次')
        for key, limit in [('location', 150), ('teacher', 100), ('note', 2000)]:
            if key in e and (key != 'note' or notes):
                ex[key] = text(e[key], limit, key)
        result['exceptions'].append(ex)
    unique(result['exceptions'], lambda e: e['id'], '单次调整编号')
    unique(result['exceptions'], lambda e: (e['sessionId'], e['sourceDate']), '单次调整')
    for h in array(source.get('holidayLabels', []), 500, '假日标记'):
        obj(h, 'id date name', '假日标记')
        result['holidayLabels'].append(dict(id=identifier(h), date=date(h.get('date')), name=text(h.get('name'), 100, '假日名称', True)))
    unique(result['holidayLabels'], lambda h: h['id'], '假日编号')
    if exams:
        for e in array(source.get('exams', []), 500, '考试'):
            obj(e, 'id name date startTime endTime location note courseId', '考试')
            exam = dict(id=identifier(e), name=text(e.get('name'), 100, '考试名称', True), date=date(e.get('date')),
                        startTime=clock(e.get('startTime')), endTime=clock(e.get('endTime')), location=text(e.get('location', ''), 150, '考试地点'),
                        note=text(e.get('note', ''), 2000, '考试备注') if notes else '')
            if exam['startTime'] >= exam['endTime']:
                raise InvalidPayload('考试结束时间必须晚于开始时间')
            if e.get('courseId'):
                exam['courseId'] = text(e['courseId'], 120, '关联课程', True)
            result['exams'].append(exam)
        unique(result['exams'], lambda e: e['id'], '考试编号')
    validate_share_budget(result)
    return {'format': 'qingke-semester', 'version': 1, 'semester': result}, days
