"""Exercise deployed loopback API using fictional data, then revoke it."""
import json
import argparse
from pathlib import Path
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent / 'tests'))
from test_share_server import fixture

BASE = 'http://127.0.0.1:8787'


def call(method, path, body=None, token=None):
    headers = {'Origin': 'https://qingke.local'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    data = None
    if body is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(body).encode('utf-8')
    request = urllib.request.Request(BASE + path, data, headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            assert response.headers.get('Content-Type', '').startswith('application/json'), 'json_content_type_missing'
            assert response.headers.get('X-Content-Type-Options') == 'nosniff', 'nosniff_missing'
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


def main():
    global BASE
    parser = argparse.ArgumentParser(description='Fictional sharing smoke; creates and removes one share')
    parser.add_argument('--base', default=BASE)
    args = parser.parse_args()
    parsed = urlsplit(args.base)
    assert not (parsed.username or parsed.password or parsed.query or parsed.fragment) and parsed.path in ('', '/'), 'base_must_be_origin'
    assert parsed.scheme == 'https' or (parsed.scheme == 'http' and parsed.hostname == '127.0.0.1'), 'https_or_loopback_required'
    BASE = args.base.rstrip('/')
    path = token = None
    try:
        assert call('GET', '/healthz')[0] == 200
        body = fixture()
        course_name = "测试<script>alert(1)</script>'; DROP TABLE shares;--"
        body['semester']['courses'][0]['name'] = course_name
        body.update(allowFollow=True, expiresInDays=1)
        status, created = call('POST', '/api/shares', body)
        assert status == 201, 'create_failed'
        path, token = '/api/shares/' + created['code'], created['deleteToken']
        status, shared = call('GET', path)
        assert status == 200 and shared['revision'] == 1 and shared['allowFollow'], 'read_failed'
        assert shared['semester']['courses'][0]['note'] == '' and shared['semester']['exams'] == [], 'privacy_filter_failed'
        assert shared['semester']['courses'][0]['name'] == course_name, 'plain_text_roundtrip_failed'
        invalid = fixture()
        invalid['preferences'] = {'schoolUrl': 'synthetic-not-a-real-school'}
        assert call('POST', '/api/shares', invalid)[0] == 400, 'unknown_schema_accepted'
        body['expectedRevision'] = 1
        body['semester']['dayRules'][0]['label'] = 'VPS合成调休测试'
        status, updated = call('PUT', path, body, token)
        assert status == 200 and updated['revision'] == 2, 'update_failed'
        assert call('PUT', path, body, token)[0] == 409, 'cas_failed'
        body.update(expectedRevision=2, allowFollow=False)
        status, updated = call('PUT', path, body, token)
        assert status == 200 and updated['revision'] == 3 and not updated['allowFollow'], 'follow_disable_failed'
        status, shared = call('GET', path)
        assert status == 200 and shared['semester']['dayRules'][0]['label'] == 'VPS合成调休测试', 'static_read_failed'
        assert call('DELETE', path, token=token)[0] == 204, 'delete_failed'
        assert call('GET', path)[0] == 404, 'revoke_failed'
        print(json.dumps({'ok': True, 'checks': ['health', 'create', 'read', 'privacy_filter', 'html_sql_plain_text', 'unknown_schema_rejected', 'update', 'CAS_conflict', 'disable_follow', 'revoke'], 'test_share_removed': True}))
    finally:
        if path and token:
            call('DELETE', path, token=token)


if __name__ == '__main__':
    main()
