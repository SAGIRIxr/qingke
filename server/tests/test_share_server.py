import copy
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from wsgiref.simple_server import make_server, WSGIRequestHandler

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from share_server import ALPHABET, MAX_BODY, ApiError, Config, RateLimiter, ShareApp, digest
from share_schema import InvalidPayload, normalize_payload


def fixture():
    return {'format': 'qingke-semester', 'version': 1, 'semester': {
        'id': 'synthetic-semester', 'name': '虚构测试学期', 'startDate': '2026-09-02', 'totalWeeks': 20, 'showWeekend': True,
        'profiles': [{'id': 'synthetic-profile', 'name': '全年作息', 'effectiveFrom': '01-01', 'periods': [
            {'start': '08:00', 'end': '08:45', 'group': 'morning'}, {'start': '08:55', 'end': '09:40', 'group': 'morning'}]}],
        'courses': [{'id': 'synthetic-course', 'name': '测试数学', 'shortName': '数学', 'color': 0, 'assessment': '考试', 'nature': '必修', 'note': '不应默认分享的备注',
            'sessions': [{'id': 'synthetic-session', 'day': 3, 'startPeriod': 1, 'endPeriod': 2, 'weeks': [1, 2, 3], 'teacher': '虚构王老师', 'location': '测试A201', 'breakMode': 'normal',
                'importSource': {'source': 'secret-school-url', 'cookie': 'private-cookie'}}]}],
        'dayRules': [{'id': 'off', 'type': 'off', 'date': '2026-09-09', 'label': '学校停课'}],
        'exceptions': [{'id': 'move', 'type': 'move', 'sessionId': 'synthetic-session', 'sourceDate': '2026-09-02', 'date': '2026-09-05', 'note': '私人调课备注'}],
        'holidayLabels': [{'id': 'holiday', 'date': '2026-10-01', 'name': '国庆'}],
        'exams': [{'id': 'exam', 'name': '测试数学期末', 'date': '2027-01-05', 'startTime': '09:00', 'endTime': '11:00', 'location': '测试B201', 'note': '考试私人备注', 'courseId': 'synthetic-course'}],
    }}


class ShareTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.config = Config(db_path=str(Path(self.tmp.name) / 'shares.sqlite3'), rate_limits={})
        self.app = ShareApp(self.config, start_cleaner=False)

    def tearDown(self):
        self.app.close()
        self.tmp.cleanup()

    def request(self, method, path='/api/shares', body=None, origin='https://qingke.local', headers=None, raw=None):
        payload = raw if raw is not None else json.dumps(body or {}).encode()
        env = {'REQUEST_METHOD': method, 'PATH_INFO': path, 'REMOTE_ADDR': '127.0.0.1', 'CONTENT_TYPE': 'application/json',
               'CONTENT_LENGTH': str(len(payload)), 'wsgi.input': io.BytesIO(payload), 'QUERY_STRING': ''}
        if origin is not None:
            env['HTTP_ORIGIN'] = origin
        env.update(headers or {})
        captured = {}

        def start(status, response_headers):
            captured.update(status=int(status.split()[0]), headers=dict(response_headers))

        response = b''.join(self.app(env, start))
        return captured['status'], json.loads(response) if response else None, captured['headers']

    def create(self, payload=None):
        status, data, _ = self.request('POST', body=payload or fixture())
        self.assertEqual(status, 201, data)
        return data

    def test_create_read_delete_and_secret_hash_storage(self):
        created = self.create()
        self.assertEqual(len(created['code']), 20)
        self.assertTrue(set(created['code']) <= set(ALPHABET))
        self.assertEqual(len(created['deleteToken']), 43)
        status, shared, headers = self.request('GET', '/api/shares/' + created['code'].lower())
        self.assertEqual(status, 200)
        self.assertEqual(shared['semester']['startDate'], '2026-09-02')
        self.assertEqual(shared['semester']['courses'][0]['note'], '')
        self.assertEqual(shared['semester']['exams'], [])
        self.assertNotIn('note', shared['semester']['exceptions'][0])
        self.assertNotIn('importSource', shared['semester']['courses'][0]['sessions'][0])
        self.assertNotIn('deleteToken', shared)
        self.assertNotIn('secret-school-url', json.dumps(shared))
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        with self.app.store.connect() as db:
            row = db.execute('SELECT code_hash, delete_hash, payload FROM shares').fetchone()
        self.assertEqual(row[0], digest(created['code']))
        self.assertEqual(row[1], digest(created['deleteToken']))
        self.assertNotIn(created['deleteToken'], row[2])
        self.assertEqual(self.request('DELETE', '/api/shares/' + created['code'], headers={'HTTP_AUTHORIZATION': 'Bearer ' + 'a' * 43})[0], 404)
        self.assertEqual(self.request('GET', '/api/shares/' + created['code'])[0], 200)
        self.assertEqual(self.request('DELETE', '/api/shares/' + created['code'], headers={'HTTP_AUTHORIZATION': 'Bearer ' + created['deleteToken']})[0], 204)
        self.assertEqual(self.request('GET', '/api/shares/' + created['code'])[0], 404)

    def test_notes_and_exams_require_separate_explicit_opt_in(self):
        raw = fixture()
        raw['includeExams'] = True
        payload, _ = normalize_payload(raw)
        self.assertEqual(len(payload['semester']['exams']), 1)
        self.assertEqual(payload['semester']['exams'][0]['note'], '')
        raw['includeNotes'] = True
        payload, _ = normalize_payload(raw)
        self.assertEqual(payload['semester']['courses'][0]['note'], '不应默认分享的备注')
        self.assertEqual(payload['semester']['exceptions'][0]['note'], '私人调课备注')
        self.assertEqual(payload['semester']['exams'][0]['note'], '考试私人备注')

    def test_unknown_fields_and_bad_references_are_rejected(self):
        for patch in [lambda p: p.update(preferences={'schoolUrl': 'https://secret'}),
                      lambda p: p['semester'].update(cookie='secret'),
                      lambda p: p['semester']['courses'][0].update(__proto__={'x': 1}),
                      lambda p: p['semester']['exceptions'][0].update(sessionId='missing'),
                      lambda p: p['semester']['courses'][0]['sessions'][0].update(weeks=[21]),
                      lambda p: p['semester']['profiles'][0]['periods'][1].update(start='07:00'),
                      lambda p: p.update(expiresInDays=31), lambda p: p.update(includeNotes='yes')]:
            raw = fixture()
            patch(raw)
            self.assertEqual(self.request('POST', body=raw)[0], 400)

    def test_json_size_type_duplicate_keys_and_protocol_limits(self):
        self.assertEqual(self.request('POST', raw=b'{' + b' ' * MAX_BODY)[0], 413)
        self.assertEqual(self.request('POST', raw=b'{"version":1,"version":2}')[0], 400)
        self.assertEqual(self.request('POST', raw=b'{"a":NaN}')[0], 400)
        self.assertEqual(self.request('POST', raw=b'\xff')[0], 400)
        self.assertEqual(self.request('POST', headers={'CONTENT_TYPE': 'text/plain'})[0], 415)
        self.assertEqual(self.request('POST', headers={'CONTENT_LENGTH': ''})[0], 411)
        self.assertEqual(self.request('POST', headers={'HTTP_TRANSFER_ENCODING': 'chunked'})[0], 400)
        self.assertEqual(self.request('POST', headers={'QUERY_STRING': 'secret=value'})[0], 400)
        self.assertEqual(self.request('GET', '/api/shares')[0], 405)

    def test_cors_exact_allowlist_and_preflight(self):
        for origin in ['null', 'https://evil.example', 'https://qingke.local.evil.example', 'https://qingke.local, https://evil.example']:
            status, _, headers = self.request('POST', body=fixture(), origin=origin)
            self.assertEqual(status, 403)
            self.assertNotIn('Access-Control-Allow-Origin', headers)
        created = self.create()
        status, _, headers = self.request('OPTIONS', headers={'HTTP_ACCESS_CONTROL_REQUEST_METHOD': 'DELETE', 'HTTP_ACCESS_CONTROL_REQUEST_HEADERS': 'Authorization'})
        self.assertEqual(status, 204)
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'https://qingke.local')
        self.assertNotIn('Access-Control-Allow-Credentials', headers)
        self.assertEqual(self.request('GET', '/api/shares/' + created['code'], origin=None)[0], 200)

    def test_proxy_headers_require_loopback_and_explicit_trust(self):
        env = {'REMOTE_ADDR': '127.0.0.1', 'HTTP_X_REAL_IP': '192.0.2.10'}
        self.assertEqual(self.app.client_ip(env), '127.0.0.1')
        self.config.trust_proxy = True
        self.assertEqual(self.app.client_ip(env), '192.0.2.10')
        env['REMOTE_ADDR'] = '198.51.100.2'
        self.assertEqual(self.app.client_ip(env), '198.51.100.2')
        env.update(REMOTE_ADDR='127.0.0.1', HTTP_X_REAL_IP='192.0.2.10, 192.0.2.11')
        with self.assertRaises(ApiError):
            self.app.client_ip(env)

    def test_expiry_cleanup_and_capacity_limits(self):
        payload, _ = normalize_payload(fixture())
        created = self.app.store.create(payload, 1, now=100)
        self.assertEqual(self.app.store.read(created['code'], now=86499)['semester']['name'], '虚构测试学期')
        with self.assertRaises(ApiError):
            self.app.store.read(created['code'], now=86500)
        self.app.store.cleanup(now=86500)
        with self.app.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM shares').fetchone()[0], 0)
        self.config.max_shares = 1
        self.create()
        self.assertEqual(self.request('POST', body=fixture())[0], 503)

    def test_payload_capacity_and_rate_limit_retry_header(self):
        self.config.max_payload_bytes = 1
        self.assertEqual(self.request('POST', body=fixture())[0], 503)
        self.app.limiter = RateLimiter({'request': (1, 60)})
        self.assertEqual(self.request('GET', '/healthz')[0], 200)
        status, data, headers = self.request('GET', '/healthz')
        self.assertEqual(status, 429)
        self.assertEqual(data['error']['code'], 'rate_limited')
        self.assertGreater(int(headers['Retry-After']), 0)

    def test_read_guess_limit_and_window_reset(self):
        limiter = RateLimiter({'read': (2, 60)})
        limiter.check('192.0.2.1', ['read'], now=10)
        limiter.check('192.0.2.1', ['read'], now=11)
        with self.assertRaises(ApiError):
            limiter.check('192.0.2.1', ['read'], now=12)
        limiter.check('192.0.2.1', ['read'], now=70)
        limiter.check('192.0.2.2', ['read'], now=12)

    def test_sql_and_html_strings_remain_json_data(self):
        raw = fixture()
        raw['semester']['courses'][0]['name'] = "<script>alert(1)</script>'; DROP TABLE shares;--"
        created = self.create(raw)
        status, body, headers = self.request('GET', '/api/shares/' + created['code'])
        self.assertEqual(status, 200)
        self.assertEqual(body['semester']['courses'][0]['name'], raw['semester']['courses'][0]['name'])
        self.assertTrue(headers['Content-Type'].startswith('application/json'))
        self.assertEqual(self.request('GET', "/api/shares/' OR 1=1--")[0], 404)

    def test_concurrent_writes_respect_capacity_atomically(self):
        self.config.max_shares = 2
        payload, _ = normalize_payload(fixture())
        successes, errors = [], []

        def publish():
            try:
                successes.append(self.app.store.create(payload, 1))
            except ApiError as error:
                errors.append(error.status)

        threads = [threading.Thread(target=publish) for _ in range(5)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(len(successes), 2)
        self.assertEqual(errors, [503, 503, 503])

    def test_real_http_create_read_delete(self):
        class Quiet(WSGIRequestHandler):
            def log_message(self, *_):
                pass

        server = make_server('127.0.0.1', 0, self.app, handler_class=Quiet)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}/api/shares'
        try:
            req = urllib.request.Request(base, json.dumps(fixture()).encode(), {'Content-Type': 'application/json', 'Origin': 'https://qingke.local'})
            with urllib.request.urlopen(req, timeout=3) as response:
                created = json.load(response)
                self.assertEqual(response.status, 201)
            with urllib.request.urlopen(base + '/' + created['code'], timeout=3) as response:
                self.assertEqual(json.load(response)['format'], 'qingke-semester')
            req = urllib.request.Request(base + '/' + created['code'], headers={'Authorization': 'Bearer ' + created['deleteToken']}, method='DELETE')
            with urllib.request.urlopen(req, timeout=3) as response:
                self.assertEqual(response.status, 204)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_owner_updates_revision_and_follow_permission(self):
        raw = fixture()
        raw['allowFollow'] = True
        created = self.create(raw)
        self.assertEqual(created['revision'], 1)
        self.assertTrue(created['allowFollow'])
        path = '/api/shares/' + created['code']
        raw.update(expectedRevision=1)
        raw['semester']['dayRules'][0]['label'] = '更新后的虚构调休'
        auth = {'HTTP_AUTHORIZATION': 'Bearer ' + created['deleteToken']}
        status, updated, _ = self.request('PUT', path, body=raw, headers=auth)
        self.assertEqual(status, 200, updated)
        self.assertEqual(updated['revision'], 2)
        self.assertEqual(updated['expiresAt'], created['expiresAt'])
        status, shared, _ = self.request('GET', path)
        self.assertEqual(shared['revision'], 2)
        self.assertEqual(shared['semester']['dayRules'][0]['label'], '更新后的虚构调休')
        self.assertTrue(shared['allowFollow'])
        self.assertIn('updatedAt', shared)
        stale, conflict, _ = self.request('PUT', path, body=raw, headers=auth)
        self.assertEqual(stale, 409)
        self.assertEqual(conflict['error']['code'], 'conflict')
        raw.update(expectedRevision=2, allowFollow=False)
        status, closed, _ = self.request('PUT', path, body=raw, headers=auth)
        self.assertEqual(status, 200)
        self.assertFalse(closed['allowFollow'])
        self.assertEqual(closed['revision'], 3)
        self.assertLess(closed['expiresAt'], created['expiresAt'])
        self.assertEqual(self.request('GET', path)[0], 200)

    def test_update_requires_owner_and_expected_revision(self):
        created = self.create()
        path = '/api/shares/' + created['code']
        raw = fixture()
        raw['expectedRevision'] = 1
        for token in ['', created['code'], 'a' * 43]:
            self.assertEqual(self.request('PUT', path, body=raw, headers={'HTTP_AUTHORIZATION': 'Bearer ' + token})[0], 404)
        auth = {'HTTP_AUTHORIZATION': 'Bearer ' + created['deleteToken']}
        del raw['expectedRevision']
        self.assertEqual(self.request('PUT', path, body=raw, headers=auth)[0], 400)
        raw['expectedRevision'] = 0
        self.assertEqual(self.request('PUT', path, body=raw, headers=auth)[0], 400)
        self.assertEqual(self.request('GET', path)[1]['revision'], 1)

    def test_follow_lifetime_and_explicit_renewal(self):
        raw = fixture()
        raw.update(allowFollow=True, expiresInDays=365)
        payload, days = normalize_payload(raw)
        self.assertEqual(days, 365)
        created = self.app.store.create(payload, days, now=100, allow_follow=True)
        renewed = self.app.store.update(created['code'], created['deleteToken'], payload, 1, True, days=10, now=200)
        self.assertEqual(renewed['expiresAt'], '1970-01-11T00:03:20Z')
        raw['expiresInDays'] = 366
        self.assertEqual(self.request('POST', body=raw)[0], 400)
        raw['allowFollow'] = False
        raw['expiresInDays'] = 31
        self.assertEqual(self.request('POST', body=raw)[0], 400)
        with self.assertRaises(ApiError) as expired:
            self.app.store.update(created['code'], created['deleteToken'], payload, 2, True, days=365, now=900000)
        self.assertEqual(expired.exception.status, 404)

    def test_update_capacity_failure_rolls_back_revision_and_content(self):
        created = self.create()
        self.config.max_payload_bytes = 1
        raw = fixture()
        raw['expectedRevision'] = 1
        raw['semester']['name'] = '不应保存的学期名'
        status, _, _ = self.request('PUT', '/api/shares/' + created['code'], body=raw, headers={'HTTP_AUTHORIZATION': 'Bearer ' + created['deleteToken']})
        self.assertEqual(status, 503)
        shared = self.app.store.read(created['code'])
        self.assertEqual(shared['revision'], 1)
        self.assertEqual(shared['semester']['name'], '虚构测试学期')

    def test_concurrent_updates_compare_and_swap(self):
        created = self.create()
        payload, _ = normalize_payload(fixture())
        statuses = []

        def update():
            try:
                statuses.append(self.app.store.update(created['code'], created['deleteToken'], payload, 1, True)['revision'])
            except ApiError as error:
                statuses.append(error.status)

        threads = [threading.Thread(target=update) for _ in range(5)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(statuses), [2, 409, 409, 409, 409])
        self.assertEqual(self.app.store.read(created['code'])['revision'], 2)

    def test_revoked_share_cannot_be_updated_or_read(self):
        created = self.create()
        payload, _ = normalize_payload(fixture())
        self.app.store.delete(created['code'], created['deleteToken'])
        with self.assertRaises(ApiError) as revoked:
            self.app.store.update(created['code'], created['deleteToken'], payload, 1, True)
        self.assertEqual(revoked.exception.status, 404)


if __name__ == '__main__':
    unittest.main()
