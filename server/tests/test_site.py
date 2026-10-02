import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from share_server import Config, ShareApp, SITE_FILES, SITE_ROOT


class SiteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = ShareApp(Config(db_path=str(Path(self.tmp.name) / 'test.sqlite3'),
                                   rate_limits={'request': (1, 60), 'global_request': (1, 60)}), start_cleaner=False)

    def tearDown(self):
        self.app.close()
        self.tmp.cleanup()

    def request(self, path='/', method='GET', query='', origin=None):
        env = {'REQUEST_METHOD': method, 'PATH_INFO': path, 'QUERY_STRING': query,
               'REMOTE_ADDR': '127.0.0.1', 'wsgi.input': io.BytesIO(b''), 'CONTENT_LENGTH': '0'}
        if origin is not None:
            env['HTTP_ORIGIN'] = origin
        response = {}
        def start(status, headers):
            response.update(status=int(status.split()[0]), headers=dict(headers))
        response['body'] = b''.join(self.app(env, start))
        return response

    def test_exact_static_files_have_safe_headers_and_no_inline_script(self):
        for route, (filename, mime) in SITE_FILES.items():
            with self.subTest(route=route):
                response = self.request(route)
                self.assertEqual(response['status'], 200)
                self.assertEqual(response['body'], (SITE_ROOT / filename).read_bytes())
                headers = response['headers']
                self.assertEqual(headers['Content-Type'], mime)
                self.assertEqual(headers['Content-Length'], str(len(response['body'])))
                self.assertEqual(headers['Cache-Control'], 'no-store')
                self.assertEqual(headers['Referrer-Policy'], 'no-referrer')
                self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
                self.assertIn("connect-src 'none'", headers['Content-Security-Policy'])
                self.assertIn("frame-ancestors 'none'", headers['Content-Security-Policy'])
                self.assertNotIn('unsafe-inline', headers['Content-Security-Policy'])
                self.assertNotIn('Access-Control-Allow-Origin', headers)
        self.assertNotIn('<script>', self.request()['body'].decode())

    def test_static_navigation_is_public_and_does_not_spend_api_quota(self):
        for _ in range(5):
            self.assertEqual(self.request('/', origin='https://outside.example')['status'], 200)
            self.assertEqual(self.request('/s')['status'], 200)
        self.assertEqual(self.app.limiter.buckets, {})
        self.assertEqual(self.request('/healthz')['status'], 200)
        self.assertEqual(self.request('/healthz')['status'], 429)
        self.assertEqual(self.request('/s')['status'], 200)

    def test_api_cors_is_unchanged(self):
        response = self.request('/api/shares', origin='https://outside.example')
        self.assertEqual(response['status'], 403)
        self.assertEqual(json.loads(response['body'])['error']['code'], 'forbidden')

    def test_get_and_head_use_identical_metadata_but_no_head_body(self):
        for route in SITE_FILES:
            before, head = self.request(route), self.request(route, 'HEAD')
            self.assertEqual(head['status'], 200)
            self.assertEqual(head['body'], b'')
            self.assertEqual(head['headers'], before['headers'])
        response = self.request('/s', 'POST')
        self.assertEqual(response['status'], 405)
        self.assertEqual(response['headers']['Allow'], 'GET, HEAD')
        self.assertNotIn('Location', response['headers'])

    def test_only_explicit_fallback_query_is_accepted_and_not_reflected(self):
        self.assertEqual(self.request('/s', query='fallback=1')['status'], 200)
        for query in ['code=0123456789ABCDEFGHJKM', 'fallback=https://evil.example', 'fallback=1&redirect=evil', 'fallback=1&fallback=1']:
            response = self.request('/s', query=query)
            self.assertEqual(response['status'], 400)
            self.assertNotIn(query.encode(), response['body'])
            self.assertNotIn('Location', response['headers'])
        self.assertEqual(self.request('/', query='fallback=1')['status'], 400)

    def test_no_directory_or_arbitrary_file_reads(self):
        # Disable quota only for these independent denied routes.
        self.app.limiter.limits = {}
        for route in ['/site/', '/site/index.html', '/../share_server.py', '/%2e%2e/share_server.py',
                      '/.env', '/site-config.js/anything', '/.well-known/', '/s/', '//s', '/share_server.py']:
            response = self.request(route)
            self.assertEqual(response['status'], 404, route)
            self.assertNotIn(b'import sqlite3', response['body'])

    def test_app_links_certificate_and_package_are_fixed(self):
        response = self.request('/.well-known/assetlinks.json')
        data = json.loads(response['body'])
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['relation'], ['delegate_permission/common.handle_all_urls'])
        target = data[0]['target']
        self.assertEqual(target['package_name'], 'cn.qingke.app')
        self.assertEqual(target['namespace'], 'android_app')
        self.assertEqual(target['sha256_cert_fingerprints'], ['3A:7B:3D:E6:2C:96:FB:B3:DD:5F:5E:B2:6C:02:BF:E8:8E:FA:1D:E8:8B:09:17:5C:F8:3A:58:FB:3A:26:41:B9'])


if __name__ == '__main__':
    unittest.main()
