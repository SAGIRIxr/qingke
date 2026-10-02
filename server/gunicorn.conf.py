"""One process keeps per-IP rate limits consistent; threads handle I/O."""
bind = '127.0.0.1:8787'
workers = 1
worker_class = 'gthread'
threads = 8
timeout = 30
graceful_timeout = 15
keepalive = 2
max_requests = 10000
max_requests_jitter = 500
limit_request_line = 2048
limit_request_fields = 20
limit_request_field_size = 4096
forwarded_allow_ips = ''
# URLs contain capability secrets. Never enable an access log here or in nginx.
accesslog = None
errorlog = '-'
loglevel = 'error'
capture_output = False
preload_app = False
umask = 0o077


def post_worker_init(worker):
    # Initialize SQLite and start automatic expiry cleanup even before first use.
    import share_server
    share_server._application = share_server.ShareApp()

