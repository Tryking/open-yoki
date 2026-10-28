# Settings for square_post.py and facts.py. Read from /etc/livehost/square.env (or $SQUARE_ENV), then the process environment
# (the environment wins). Every value has a default that fits the single-server install in deploy/.
#   SERVER_URL          the host's Node server                       (default http://127.0.0.1:4370)
#   INGEST_KEY_FILE     the server's square key, sent as x-square-key (default /var/lib/livehost/data/square-ingest.key)
#   SQUARE_OPENAPI_KEY  Square creator-center OpenAPI key; without it nothing is posted on Square
#   SQUARE_LANG         language of the Binance announcement list facts.py reads (default zh-CN)
import json, os, urllib.request

def _read(path):
    out = {}
    try:
        for line in open(path, encoding='utf-8'):
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line: continue
            k, _, v = line.partition('=')
            out[k.strip()] = v.strip().strip('"\'')
    except (FileNotFoundError, PermissionError): pass
    return out

E = {**_read(os.environ.get('SQUARE_ENV') or '/etc/livehost/square.env'), **{k: v for k, v in os.environ.items() if v}}
SERVER = (E.get('SERVER_URL') or 'http://127.0.0.1:4370').rstrip('/')
LANG = E.get('SQUARE_LANG') or 'zh-CN'

def ingest_key():
    return open(E.get('INGEST_KEY_FILE') or '/var/lib/livehost/data/square-ingest.key').read().strip()

def server(method, path, body=None, timeout=20):
    """One call to the host's Node server with the square key. Returns the parsed JSON answer."""
    req = urllib.request.Request(SERVER + path, data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
                                 method=method, headers={'Content-Type': 'application/json', 'X-Square-Key': ingest_key()})
    with urllib.request.urlopen(req, timeout=timeout) as r: return json.loads(r.read() or b'null')

def health():
    try: return json.loads(urllib.request.urlopen(SERVER + '/api/health', timeout=10).read())
    except Exception: return None
