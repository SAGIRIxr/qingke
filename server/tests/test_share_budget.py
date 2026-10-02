"""Finite synthetic cases for share validation and client expansion limits."""
import copy
import datetime as dt
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from share_schema import InvalidPayload, normalize_payload, validate_share_budget


def payload(count=1, weeks=(1,), start='2026-09-07', total_weeks=20, spread=False):
    sessions = [{'id': f's{i}', 'day': i % 7 + 1 if spread else 1,
                 'startPeriod': 1, 'endPeriod': 1, 'weeks': list(weeks)} for i in range(count)]
    return {'format': 'qingke-semester', 'version': 1, 'semester': {
        'id': 'synthetic', 'name': '虚构测试学期', 'startDate': start,
        'totalWeeks': total_weeks, 'showWeekend': True,
        'profiles': [{'id': 'p', 'name': '默认作息', 'effectiveFrom': '01-01',
                      'periods': [{'start': '08:00', 'end': '08:45', 'group': 'morning'}]}],
        'courses': [{'id': f'c{i}', 'name': f'虚构课程{i}', 'color': 0, 'sessions': sessions[i:i + 100]}
                    for i in range(0, count, 100)],
        'dayRules': [], 'exceptions': [], 'holidayLabels': [], 'exams': []}}


def checked(raw):
    return normalize_payload(raw)[0]['semester']


def exam(index, date='2026-09-07'):
    return {'id': f'e{index}', 'name': '虚构考试', 'date': date, 'startTime': '10:00', 'endTime': '11:00'}


class ShareBudgetTests(unittest.TestCase):
    def test_typical_semester_has_small_finite_budget(self):
        s = checked(payload(35, range(1, 21), spread=True))
        self.assertEqual(validate_share_budget(s), {'occurrences': 700, 'maxPerDay': 5, 'conflictReferences': 2800})

    def test_initial_partial_week_ignores_days_before_start(self):
        raw = payload(2, (1,), start='2026-09-09')
        raw['semester']['courses'][0]['sessions'][1]['day'] = 3
        self.assertEqual(validate_share_budget(checked(raw))['occurrences'], 1)

    def test_daily_limit_includes_exact_boundary(self):
        self.assertEqual(validate_share_budget(checked(payload(128)))['maxPerDay'], 128)
        with self.assertRaisesRegex(InvalidPayload, '128'):
            checked(payload(129))

    def test_2000_sessions_fail_before_date_expansion(self):
        raw = payload(2000, range(1, 21))
        # A deterministic assertion of early rejection, not a flaky timing test:
        # normalization needs one timedelta; instance expansion would need more.
        real_delta = dt.timedelta
        with patch('share_schema.dt.timedelta', wraps=real_delta) as delta:
            with self.assertRaisesRegex(InvalidPayload, '10000'):
                checked(raw)
            self.assertEqual(delta.call_count, 2)

    def test_same_day_pair_budget_is_cumulative_across_weeks(self):
        self.assertEqual(validate_share_budget(checked(payload(100, range(1, 21))))['conflictReferences'], 198000)
        with self.assertRaisesRegex(InvalidPayload, '过于密集'):
            checked(payload(100, range(1, 22), total_weeks=21))

    def test_original_candidate_cap_cannot_be_hidden_by_off_days(self):
        raw = payload(500, range(1, 21), spread=True)
        monday = dt.date(2026, 9, 7)
        raw['semester']['dayRules'] = [{'id': f'off{i}', 'date': (monday + dt.timedelta(days=i)).isoformat(), 'type': 'off'} for i in range(140)]
        self.assertEqual(validate_share_budget(checked(raw))['occurrences'], 0)
        raw['semester']['courses'].append({'id': 'extra', 'name': '额外课程', 'color': 0,
                                           'sessions': [{'id': 'extra', 'day': 1, 'startPeriod': 1, 'endPeriod': 1, 'weeks': [1]}]})
        with self.assertRaisesRegex(InvalidPayload, '10000'):
            checked(raw)

    def test_whole_day_replacement_moves_source_and_replaces_target(self):
        raw = payload(2)
        raw['semester']['courses'][0]['sessions'][1]['day'] = 7
        raw['semester']['dayRules'] = [{'id': 'makeup', 'type': 'replace', 'sourceDate': '2026-09-07', 'date': '2026-09-13'}]
        result = validate_share_budget(checked(raw))
        self.assertEqual(result, {'occurrences': 1, 'maxPerDay': 1, 'conflictReferences': 0})

    def test_off_source_can_still_be_used_by_whole_day_replacement(self):
        raw = payload()
        raw['semester']['dayRules'] = [
            {'id': 'off', 'type': 'off', 'date': '2026-09-07'},
            {'id': 'makeup', 'type': 'replace', 'sourceDate': '2026-09-07', 'date': '2026-09-13'}]
        self.assertEqual(validate_share_budget(checked(raw))['occurrences'], 1)

    def test_single_cancel_and_modify_apply_to_replacement_source(self):
        raw = payload(3)
        raw['semester']['dayRules'] = [{'id': 'makeup', 'type': 'replace', 'sourceDate': '2026-09-07', 'date': '2026-09-13'}]
        raw['semester']['exceptions'] = [
            {'id': 'cancel', 'sessionId': 's0', 'sourceDate': '2026-09-07', 'type': 'cancel'},
            {'id': 'modify', 'sessionId': 's1', 'sourceDate': '2026-09-07', 'type': 'modify', 'location': '另一教室'}]
        self.assertEqual(validate_share_budget(checked(raw)), {'occurrences': 2, 'maxPerDay': 2, 'conflictReferences': 2})

    def test_individual_move_overrides_off_day_without_cloning_source(self):
        raw = payload()
        raw['semester']['dayRules'] = [
            {'id': 'off', 'type': 'off', 'date': '2026-10-01'},
            {'id': 'makeup', 'type': 'replace', 'sourceDate': '2026-09-07', 'date': '2026-09-13'}]
        raw['semester']['exceptions'] = [{'id': 'move', 'sessionId': 's0', 'sourceDate': '2026-09-07', 'type': 'move', 'date': '2026-10-01'}]
        raw['includeExams'] = True
        raw['semester']['exams'] = [exam(0, '2026-10-01')]
        self.assertEqual(validate_share_budget(checked(raw)), {'occurrences': 2, 'maxPerDay': 2, 'conflictReferences': 2})

    def test_moved_lessons_are_limited_at_actual_destination(self):
        for count in [128, 129]:
            raw = payload(count, spread=True)
            raw['semester']['dayRules'] = [{'id': 'off', 'type': 'off', 'date': '2026-10-01'}]
            monday = dt.date(2026, 9, 7)
            raw['semester']['exceptions'] = [
                {'id': f'm{i}', 'sessionId': f's{i}', 'sourceDate': (monday + dt.timedelta(days=i % 7)).isoformat(),
                 'type': 'move', 'date': '2026-10-01'} for i in range(count)]
            if count == 128:
                self.assertEqual(validate_share_budget(checked(raw))['maxPerDay'], 128)
            else:
                with self.assertRaisesRegex(InvalidPayload, '128'):
                    checked(raw)

    def test_exams_and_courses_share_daily_limit(self):
        raw = payload(64)
        raw['includeExams'] = True
        raw['semester']['exams'] = [exam(i) for i in range(64)]
        self.assertEqual(validate_share_budget(checked(raw))['maxPerDay'], 128)
        raw['semester']['exams'].append(exam(64))
        with self.assertRaisesRegex(InvalidPayload, '128'):
            checked(raw)

    def test_unshared_exams_are_not_counted(self):
        raw = payload()
        raw['semester']['exams'] = [exam(i) for i in range(129)]
        self.assertEqual(validate_share_budget(checked(raw))['occurrences'], 1)

    def test_stored_normalized_payload_can_be_checked_without_rewriting(self):
        s = checked(payload())
        before = copy.deepcopy(s)
        validate_share_budget(s)
        self.assertEqual(s, before)
        s['exams'] = [exam(i) for i in range(128)]
        with self.assertRaisesRegex(InvalidPayload, '128'):
            validate_share_budget(s)

    def test_astral_text_uses_javascript_utf16_units(self):
        raw = payload()
        raw['semester']['name'] = '\U0001f600' * 40
        self.assertEqual(checked(raw)['name'], raw['semester']['name'])
        raw['semester']['name'] += 'a'
        with self.assertRaises(InvalidPayload):
            checked(raw)
        raw['semester']['name'] = '课' * 80
        self.assertEqual(checked(raw)['name'], raw['semester']['name'])

    def test_surrogates_are_rejected_before_utf16_encoding(self):
        for name in ['a\ud800', 'a\udfff']:
            raw = payload()
            raw['semester']['name'] = name
            with self.assertRaises(InvalidPayload):
                checked(raw)

    def test_time_and_date_digits_must_be_ascii(self):
        for field, value in [('time', '08:0\u0660'), ('time', '0\uff18:00'),
                             ('date', '\uff12\uff10\uff12\uff16-09-07'), ('date', '2026-09-0\u0667'), ('effective', '0\uff11-01')]:
            raw = payload()
            if field == 'time':
                raw['semester']['profiles'][0]['periods'][0]['start'] = value
            elif field == 'date':
                raw['semester']['startDate'] = value
            else:
                raw['semester']['profiles'][0]['effectiveFrom'] = value
            with self.subTest(field=field, value=value), self.assertRaises(InvalidPayload):
                checked(raw)

    def test_exam_time_digits_must_be_ascii(self):
        raw = payload()
        raw['includeExams'] = True
        raw['semester']['exams'] = [{**exam(0), 'startTime': '10:0\u0660'}]
        with self.assertRaises(InvalidPayload):
            checked(raw)


if __name__ == '__main__':
    unittest.main()
