"""Qingke sharing WSGI service. Production: Gunicorn behind a TLS proxy."""
import argparse
import atexit
from contextlib import contextmanager
import datetime as dt
import hashlib
import hmac
import ipaddress
import json
import logging
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from http import HTTPStatus
from urllib.parse import urlsplit

from share_schema import InvalidPayload, normalize_payload, validate_share_budget

LOG = logging.getLogger('qingke-share')
ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
MAX_BODY = 1024 * 1024
SITE_ROOT = Path(__file__).resolve().with_name('site')
# Exact route-to-file mapping; request paths are never used as filesystem paths.
SITE_FILES = {
    '/': ('index.html', 'text/html; charset=utf-8'),
    '/s': ('share.html', 'text/html; charset=utf-8'),
    '/site.css': ('site.css', 'text/css; charset=utf-8'),
    '/site.js': ('site.js', 'text/javascript; charset=utf-8'),
    '/site-config.js': ('site-config.js', 'text/javascript; charset=utf-8'),
    '/share-link.js': ('share-link.js', 'text/javascript; charset=utf-8'),
    '/icon.svg': ('icon.svg', 'image/svg+xml'),
    '/.well-known/assetlinks.json': ('assetlinks.json', 'application/json; charset=utf-8'),
}
SITE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'"
# Only this HTTPS host is covered: no preload or includeSubDomains opt-in.
HSTS = 'max-age=31536000'


@dataclass
class Config:
    db_path: str = '/var/lib/qingke-share/shares.sqlite3'
    allowed_origins: tuple = ('https://qingke.local',)
    trust_proxy: bool = False
    max_shares: int = 5000
    max_payload_bytes: int = 100 * 1024 * 1024
    max_db_bytes: int = 200 * 1024 * 1024
    cleanup_seconds: int = 300
    rate_limits: dict = field(default_factory=lambda: {
        'request': (120, 60), 'read': (60, 60), 'read_hour': (300, 3600),
        'create': (12, 3600), 'delete': (30, 60), 'update': (60, 3600),
        'global_request': (600, 60), 'global_create': (200, 3600), 'global_update': (600, 3600),
    })

    @classmethod
    def from_env(cls):
        origins = tuple(filter(None, (part.strip() for part in os.getenv('QINGKE_ALLOWED_ORIGINS', 'https://qingke.local').split(','))))
        for origin in origins:
            parsed = urlsplit(origin)
            if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or any(c.isspace() for c in origin):
                raise ValueError('QINGKE_ALLOWED_ORIGINS must contain exact scheme://host[:port] origins')
            if parsed.scheme == 'http' and parsed.hostname not in ('127.0.0.1', 'localhost', '[::1]', '::1'):
                raise ValueError('Non-local allowed origins must use HTTPS')
        if not origins:
            raise ValueError('At least one exact allowed origin is required')
        config = cls(db_path=os.getenv('QINGKE_DB', cls.db_path), allowed_origins=origins,
                     trust_proxy=os.getenv('QINGKE_TRUST_PROXY', 'false').lower() == 'true')
        return config


class ApiError(Exception):
    def __init__(self, status, code, message, retry_after=None):
        self.status, self.code, self.message, self.retry_after = status, code, message, retry_after


def digest(value):
    return hashlib.sha256(value.encode('ascii')).digest()


def expires_iso(timestamp):
    return dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


class RateLimiter:
    """Single-worker bounded memory; production Gunicorn must use one worker."""
    def __init__(self, limits):
        self.limits, self.buckets, self.lock = limits, {}, threading.Lock()

    def check(self, ip, names, now=None):
        now = time.monotonic() if now is None else now
        with self.lock:
            if len(self.buckets) >= 10000:
                self.buckets = {k: v for k, v in self.buckets.items() if v[1] > now}
            for name in names:
                if name not in self.limits:
                    continue
                limit, duration = self.limits[name]
                key = ('*' if name.startswith('global_') else ip, name)
                count, until = self.buckets.get(key, (0, now + duration))
                if until <= now:
                    count, until = 0, now + duration
                if (key not in self.buckets and len(self.buckets) >= 10000) or count >= limit:
                    raise ApiError(429, 'rate_limited', '请求过于频繁，请稍后再试', max(1, int(until - now) + 1))
                self.buckets[key] = (count + 1, until)


class Store:
    def __init__(self, config):
        self.config = config
        path = Path(config.db_path)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = str(path)
        with self.connect() as db:
            db.execute('PRAGMA auto_vacuum=INCREMENTAL')
            db.execute('CREATE TABLE IF NOT EXISTS shares (code_hash BLOB PRIMARY KEY, delete_hash BLOB NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, payload TEXT NOT NULL, payload_bytes INTEGER NOT NULL)')
            columns = {row[1] for row in db.execute('PRAGMA table_info(shares)')}
            for column, definition in [('revision', 'INTEGER NOT NULL DEFAULT 1'), ('allow_follow', 'INTEGER NOT NULL DEFAULT 0'), ('updated_at', 'INTEGER NOT NULL DEFAULT 0')]:
                if column not in columns:
                    db.execute(f'ALTER TABLE shares ADD COLUMN {column} {definition}')
            db.execute('UPDATE shares SET updated_at = created_at WHERE updated_at = 0')
            db.execute('CREATE INDEX IF NOT EXISTS shares_expiry ON shares(expires_at)')
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=3)
        try:
            db.execute('PRAGMA secure_delete=ON')
            # Rollback journals stay bounded to a transaction and are removed on
            # completion; there is no unbounded WAL when readers hold a snapshot.
            db.execute('PRAGMA journal_mode=DELETE')
            page_size = db.execute('PRAGMA page_size').fetchone()[0]
            db.execute(f'PRAGMA max_page_count={max(32, self.config.max_db_bytes // page_size)}')
            with db:
                yield db
        finally:
            db.close()

    def cleanup(self, now=None):
        with self.connect() as db:
            db.execute('DELETE FROM shares WHERE expires_at <= ?', (int(time.time() if now is None else now),))
        with self.connect() as db:
            db.execute('PRAGMA incremental_vacuum(128)')

    def create(self, payload, days, now=None, allow_follow=False):
        now = int(time.time() if now is None else now)
        serialized = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        size = len(serialized.encode('utf-8'))
        if size > MAX_BODY:
            raise ApiError(413, 'payload_too_large', '分享内容不能超过 1 MB')
        code = ''.join(secrets.choice(ALPHABET) for _ in range(20))
        token = secrets.token_urlsafe(32)
        expires = now + days * 86400
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM shares WHERE expires_at <= ?', (now,))
            count, total = db.execute('SELECT COUNT(*), COALESCE(SUM(payload_bytes), 0) FROM shares').fetchone()
            if count >= self.config.max_shares or total + size > self.config.max_payload_bytes:
                raise ApiError(503, 'storage_full', '分享服务容量已满，请稍后再试')
            db.execute('INSERT INTO shares (code_hash, delete_hash, created_at, expires_at, payload, payload_bytes, revision, allow_follow, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', (digest(code), digest(token), now, expires, serialized, size, 1, int(allow_follow), now))
        return {'code': code, 'deleteToken': token, 'expiresAt': expires_iso(expires), 'revision': 1, 'allowFollow': allow_follow, 'updatedAt': expires_iso(now)}

    def read(self, code, now=None):
        now = int(time.time() if now is None else now)
        with self.connect() as db:
            row = db.execute('SELECT payload, expires_at, revision, allow_follow, updated_at FROM shares WHERE code_hash = ? AND expires_at > ?', (digest(code), now)).fetchone()
        if not row:
            raise ApiError(404, 'not_found', '口令不存在、已过期或已撤销')
        payload = json.loads(row[0])
        try:
            validate_share_budget(payload['semester'])
        except InvalidPayload:
            # Shares created before resource budgets existed must not bypass them.
            # Keep the record so its owner can simplify/update it or revoke it.
            raise ApiError(400, 'share_too_complex', '此课表安排过于密集，请分享者撤销原分享，精简后重新分享') from None
        return {**payload, 'expiresAt': expires_iso(row[1]), 'revision': row[2], 'allowFollow': bool(row[3]), 'updatedAt': expires_iso(row[4])}

    def update(self, code, token, payload, expected_revision, allow_follow, days=None, now=None):
        now = int(time.time() if now is None else now)
        serialized = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        size = len(serialized.encode('utf-8'))
        if size > MAX_BODY:
            raise ApiError(413, 'payload_too_large', '分享内容不能超过 1 MB')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT delete_hash, revision, expires_at, payload_bytes FROM shares WHERE code_hash = ? AND expires_at > ?', (digest(code), now)).fetchone()
            if not hmac.compare_digest(row[0] if row else bytes(32), digest(token)) or not row:
                raise ApiError(404, 'not_found', '分享不存在或管理令牌无效')
            if row[1] != expected_revision:
                raise ApiError(409, 'conflict', '云端版本已变化，请先读取最新版本并核对')
            expires = now + days * 86400 if days is not None else row[2]
            if not allow_follow:
                expires = min(expires, now + 30 * 86400)
            db.execute('DELETE FROM shares WHERE expires_at <= ?', (now,))
            total = db.execute('SELECT COALESCE(SUM(payload_bytes), 0) FROM shares').fetchone()[0]
            if total - row[3] + size > self.config.max_payload_bytes:
                raise ApiError(503, 'storage_full', '分享服务容量已满，请稍后再试')
            revision = row[1] + 1
            # BEGIN IMMEDIATE holds the writer lock; the revision predicate also
            # documents and enforces compare-and-swap in the update itself.
            changed = db.execute('UPDATE shares SET payload = ?, payload_bytes = ?, expires_at = ?, revision = ?, allow_follow = ?, updated_at = ? WHERE code_hash = ? AND revision = ?',
                                 (serialized, size, expires, revision, int(allow_follow), now, digest(code), expected_revision)).rowcount
            if changed != 1:
                raise ApiError(409, 'conflict', '云端版本已变化，请先读取最新版本并核对')
        return {'revision': revision, 'allowFollow': allow_follow, 'expiresAt': expires_iso(expires), 'updatedAt': expires_iso(now)}

    def delete(self, code, token, now=None):
        now = int(time.time() if now is None else now)
        supplied = digest(token)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT delete_hash FROM shares WHERE code_hash = ? AND expires_at > ?', (digest(code), now)).fetchone()
            if not hmac.compare_digest(row[0] if row else bytes(32), supplied) or not row:
                # Do not disclose whether a share exists to an unauthorized caller.
                raise ApiError(404, 'not_found', '分享不存在或撤销令牌无效')
            db.execute('DELETE FROM shares WHERE code_hash = ?', (digest(code),))


class ShareApp:
    def __init__(self, config=None, start_cleaner=True):
        self.config = config or Config.from_env()
        self.store = Store(self.config)
        self.limiter = RateLimiter(self.config.rate_limits)
        self.stop = threading.Event()
        self.cleaner = None
        self.store.cleanup()
        if start_cleaner:
            self.cleaner = threading.Thread(target=self._cleanup_loop, daemon=True, name='share-expiry')
            self.cleaner.start()
            atexit.register(self.close)

    def close(self):
        self.stop.set()
        if self.cleaner and self.cleaner is not threading.current_thread():
            self.cleaner.join(timeout=2)

    def _cleanup_loop(self):
        while not self.stop.wait(self.config.cleanup_seconds):
            try:
                self.store.cleanup()
            except sqlite3.Error:
                LOG.error('expiry_cleanup_failed')

    def client_ip(self, env):
        try:
            peer = ipaddress.ip_address(env.get('REMOTE_ADDR', '127.0.0.1'))
            if self.config.trust_proxy and peer.is_loopback and 'HTTP_X_REAL_IP' in env:
                # Exactly one address, never X-Forwarded-For chains or arbitrary
                # proxy headers supplied by an external network peer.
                return str(ipaddress.ip_address(env['HTTP_X_REAL_IP']))
            return str(peer)
        except ValueError:
            raise ApiError(400, 'invalid_request', '请求来源格式无效') from None

    def __call__(self, env, start_response):
        # Public pages contain no share data and do not consume API rate limits.
        # This also keeps navigation independent of API CORS restrictions.
        if env.get('PATH_INFO', '') in SITE_FILES:
            return self.serve_site(env, start_response)
        request_id = secrets.token_hex(6)
        origin = env.get('HTTP_ORIGIN')
        cors = origin if origin in self.config.allowed_origins else None
        try:
            if origin is not None and cors is None:
                raise ApiError(403, 'forbidden', '此来源未获允许')
            ip = self.client_ip(env)
            self.limiter.check(ip, ['request', 'global_request'])
            method, path = env.get('REQUEST_METHOD', ''), env.get('PATH_INFO', '')
            if env.get('QUERY_STRING'):
                raise ApiError(400, 'invalid_request', '接口不接受查询参数')
            if env.get('HTTP_TRANSFER_ENCODING') or env.get('HTTP_CONTENT_ENCODING', 'identity') != 'identity':
                raise ApiError(400, 'invalid_request', '不支持分块或压缩请求体')
            if method == 'OPTIONS':
                if path != '/api/shares' and not re.fullmatch(r'/api/shares/[A-Za-z0-9-]{20,24}', path):
                    raise ApiError(404, 'not_found', '接口不存在')
                requested = env.get('HTTP_ACCESS_CONTROL_REQUEST_METHOD', '')
                headers = {p.strip().lower() for p in env.get('HTTP_ACCESS_CONTROL_REQUEST_HEADERS', '').split(',') if p.strip()}
                if requested not in ('GET', 'POST', 'PUT', 'DELETE') or headers - {'content-type', 'authorization'}:
                    raise ApiError(403, 'forbidden', '预检请求未获允许')
                return self.respond(start_response, 204, None, cors, request_id, [('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'), ('Access-Control-Allow-Headers', 'Content-Type, Authorization'), ('Access-Control-Max-Age', '600')])
            if path == '/healthz' and method == 'GET':
                return self.respond(start_response, 200, {'ok': True}, cors, request_id)
            if path == '/api/shares':
                if method != 'POST':
                    raise ApiError(405, 'method_not_allowed', '此接口只接受 POST')
                body = self.read_json(env)
                payload, days = normalize_payload(body)
                # Bad bodies spend request limits, not the hourly creation quota.
                self.limiter.check(ip, ['create', 'global_create'])
                return self.respond(start_response, 201, self.store.create(payload, days, allow_follow=body.get('allowFollow', False)), cors, request_id)
            match = re.fullmatch(r'/api/shares/([A-Za-z0-9-]{20,24})', path)
            if not match:
                raise ApiError(404, 'not_found', '接口或口令不存在')
            code = match[1].upper().replace('-', '')
            if len(code) != 20 or any(char not in ALPHABET for char in code):
                raise ApiError(404, 'not_found', '口令不存在、已过期或已撤销')
            if method == 'GET':
                self.limiter.check(ip, ['read', 'read_hour'])
                return self.respond(start_response, 200, self.store.read(code), cors, request_id)
            if method in ('DELETE', 'PUT'):
                self.limiter.check(ip, ['delete'] if method == 'DELETE' else ['update', 'global_update'])
                auth = env.get('HTTP_AUTHORIZATION', '')
                if not re.fullmatch(r'Bearer [A-Za-z0-9_-]{43}', auth):
                    raise ApiError(404, 'not_found', '分享不存在或管理令牌无效')
                if method == 'PUT':
                    body = self.read_json(env)
                    payload, days = normalize_payload(body, updating=True)
                    updated = self.store.update(code, auth[7:], payload, body['expectedRevision'], body.get('allowFollow', False), days)
                    return self.respond(start_response, 200, updated, cors, request_id)
                self.store.delete(code, auth[7:])
                return self.respond(start_response, 204, None, cors, request_id)
            raise ApiError(405, 'method_not_allowed', '此接口只接受 GET、PUT 或 DELETE')
        except InvalidPayload as error:
            return self.error(start_response, ApiError(400, 'invalid_payload', str(error)), cors, request_id)
        except ApiError as error:
            return self.error(start_response, error, cors, request_id)
        except sqlite3.Error as error:
            code = getattr(error, 'sqlite_errorcode', None)
            LOG.error('storage_error request_id=%s', request_id)
            return self.error(start_response, ApiError(503, 'storage_full' if code == sqlite3.SQLITE_FULL else 'temporarily_unavailable', '分享服务暂不可用，请稍后重试'), cors, request_id)
        except Exception:
            # Never log payloads, credentials, URLs, or exception text containing them.
            LOG.error('internal_error request_id=%s', request_id)
            return self.error(start_response, ApiError(500, 'internal_error', '服务暂时出现问题'), cors, request_id)

    @staticmethod
    def serve_site(env, start):
        path, method = env.get('PATH_INFO', ''), env.get('REQUEST_METHOD', '')
        filename, content_type = SITE_FILES[path]
        status, extra = 200, []
        if method not in ('GET', 'HEAD'):
            status, raw, content_type = 405, b'Method not allowed', 'text/plain; charset=utf-8'
            extra = [('Allow', 'GET, HEAD')]
        elif env.get('QUERY_STRING', '') not in (('', 'fallback=1') if path == '/s' else ('',)):
            status, raw, content_type = 400, b'Unexpected query parameters', 'text/plain; charset=utf-8'
        else:
            try:
                raw = (SITE_ROOT / filename).read_bytes()
            except OSError:
                # Do not expose local paths or exception text if deployment is incomplete.
                status, raw, content_type = 503, b'Page temporarily unavailable', 'text/plain; charset=utf-8'
        headers = [('Content-Type', content_type), ('Content-Length', str(len(raw))),
                   ('Cache-Control', 'no-store, no-transform'), ('X-Content-Type-Options', 'nosniff'),
                   ('Strict-Transport-Security', HSTS),
                   ('Referrer-Policy', 'no-referrer'), ('Content-Security-Policy', SITE_CSP),
                   ('X-Frame-Options', 'DENY'), ('Cross-Origin-Resource-Policy', 'same-origin'),
                   ('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')]
        start(f'{status} {HTTPStatus(status).phrase}', headers + extra)
        return [b'' if method == 'HEAD' else raw]

    @staticmethod
    def read_json(env):
        raw_length = env.get('CONTENT_LENGTH', '')
        if not re.fullmatch(r'[0-9]{1,10}', raw_length):
            raise ApiError(411, 'length_required', '必须提供有效的 Content-Length')
        size = int(raw_length)
        if size > MAX_BODY:
            raise ApiError(413, 'payload_too_large', '分享内容不能超过 1 MB')
        if env.get('CONTENT_TYPE', '').split(';', 1)[0].strip().lower() != 'application/json':
            raise ApiError(415, 'unsupported_media_type', '只接受 application/json')
        raw = env['wsgi.input'].read(size)
        if len(raw) != size:
            raise ApiError(400, 'invalid_payload', '请求体不完整')

        def pairs(values):
            result = {}
            for key, value in values:
                if key in result:
                    raise ValueError('duplicate JSON key')
                result[key] = value
            return result

        try:
            return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except (ValueError, UnicodeError, RecursionError):
            raise ApiError(400, 'invalid_payload', 'JSON 内容无效') from None

    def error(self, start, error, cors, request_id):
        extra = [('Retry-After', str(error.retry_after))] if error.retry_after else []
        return self.respond(start, error.status, {'error': {'code': error.code, 'message': error.message}, 'requestId': request_id}, cors, request_id, extra)

    @staticmethod
    def respond(start, status, body, origin, request_id, extra=()):
        raw = b'' if body is None else json.dumps(body, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
        headers = [('Content-Type', 'application/json; charset=utf-8'), ('Content-Length', str(len(raw))),
                   ('Cache-Control', 'no-store'), ('Pragma', 'no-cache'), ('X-Content-Type-Options', 'nosniff'),
                   ('Referrer-Policy', 'no-referrer'), ('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"),
                   ('Strict-Transport-Security', HSTS),
                   ('X-Request-Id', request_id), ('Vary', 'Origin')]
        if origin:
            headers.append(('Access-Control-Allow-Origin', origin))
        start(f'{status} {HTTPStatus(status).phrase}', headers + list(extra))
        return [raw]


_application = None
_application_lock = threading.Lock()


def application(env, start_response):
    global _application
    if _application is None:
        with _application_lock:
            if _application is None:
                _application = ShareApp()
    return _application(env, start_response)


def main():
    parser = argparse.ArgumentParser(description='Local development only; use Gunicorn for deployment')
    parser.add_argument('--dev', action='store_true', required=True)
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--db', default='./share-dev.sqlite3')
    args = parser.parse_args()
    from wsgiref.simple_server import make_server, WSGIRequestHandler

    class QuietHandler(WSGIRequestHandler):
        def log_message(self, *_):
            pass

    config = Config.from_env()
    config.db_path = args.db
    app = ShareApp(config)
    with make_server('127.0.0.1', args.port, app, handler_class=QuietHandler) as httpd:
        print(f'Development only: http://127.0.0.1:{args.port}; no request URL logging', flush=True)
        try:
            httpd.serve_forever()
        finally:
            app.close()


if __name__ == '__main__':
    main()
