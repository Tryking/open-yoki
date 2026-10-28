# Offline self-test with fake files, a fake website and a fake show log. python3 selftest.py
import json, os, subprocess, sys, tempfile, threading, time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
tmp = tempfile.mkdtemp(prefix='checkup-test-')
P = lambda *x: os.path.join(tmp, *x)

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == '/' else 503); self.end_headers(); self.wfile.write(b'ok')
    def log_message(self, *a): pass
srv = HTTPServer(('127.0.0.1', 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_port}'

TZ = timezone(timedelta(hours=8))
day = datetime(2026, 1, 24, tzinfo=TZ)
now = day.replace(hour=21, minute=30).timestamp()
iso = lambda h, m: day.replace(hour=h, minute=m).astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

# the heart stopped 3 h ago; its fix writes a fresh beat (as a restart would)
open(P('last-beat'), 'w').write(str(int((now - 3 * 3600) * 1000)))
# a show that starts late (19:20), runs to 21:00, with no comment read between 19:30 and 20:10
show = [f'{iso(19, m)} push page: frames 24' for m in range(20, 60, 5)] + [f'{iso(20, m)} push page: frames 24' for m in range(0, 60, 5)] + [f'{iso(21, 0)} push page: frames 24']
show += [f'{iso(19, 25)} [room] Sam: hi', f'{iso(19, 30)} [room] Lee: hello', f'{iso(20, 10)} [room] Sam: back', f'{iso(20, 40)} [room] Kim: gn']
open(P('show.log'), 'w').write('\n'.join(sorted(show)) + '\n')
# group chat: 5 messages in, 0 answered
heart = [{'at': iso(h, 0), 'lines': [f'[group 12:00 #{h}] Ann: anyone here?']} for h in range(10, 15)]
open(P('heart.jsonl'), 'w').write('\n'.join(json.dumps(x) for x in heart) + '\n')

cfg = {'name': 'test-host', 'tz_offset_hours': 8, 'checks': [
    {'name': 'service', 'type': 'command', 'cmd': 'echo active', 'expect_regex': '^active$'},
    {'name': 'broken private check', 'type': 'command', 'cmd': 'exit 3'},
    {'name': 'heart', 'type': 'fresh', 'path': P('last-beat'), 'read': 'ms', 'max_age_min': 120,
     'fix': f'{sys.executable} -c "import time;open(\'{P("last-beat")}\',\'w\').write(str(int(time.time()*1000)))"', 'recheck_after_s': 0},
    {'name': 'show', 'type': 'show', 'after': '21:00', 'window': '18:50-21:10', 'start_by': '19:10', 'end_after': '20:55',
     'log': {'file': P('show.log'), 'format': 'text'}, 'frame_pattern': 'push page: frames', 'chat_pattern': r'\[room\] ', 'max_chat_gap_min': 15},
    {'name': 'group', 'type': 'pair', 'since_hours': 24, 'log': {'file': P('heart.jsonl'), 'text_field': 'lines'},
     'incoming': r'^\[group ', 'replied': r'^\[group reply\]'},
    {'name': 'site', 'type': 'http', 'url': url + '/'},
    {'name': 'status page', 'type': 'http', 'url': url + '/status', 'severity': 'note'},
    {'name': 'disk', 'type': 'disk', 'path': tmp, 'max_used': 0.9999},
]}
json.dump(cfg, open(P('c.json'), 'w'))

def run(*extra, at=now):
    env = {**os.environ, 'CHECKUP_NOW': str(at)}
    out = subprocess.run([sys.executable, os.path.join(HERE, 'checkup.py'), '--config', P('c.json'), '--json', *extra], capture_output=True, text=True, env=env)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])

# dry run: nothing fixed, the stuck heart is reported
r = run('--dry')
txt = ' | '.join(r['bad'])
assert 'broken private check' in txt, txt
assert 'heart: no change for 180 min' in txt, txt
assert 'show: started late, 19:20' in txt, txt
assert 'without one comment read' in txt and '19:30-20:10' in txt, txt
assert 'group: 5 came in, 0 answered' in txt, txt
assert not any('site' in b for b in r['bad']), txt
assert any('status page' in n for n in r['note']), r['note']
assert r['fixed'] == []
# real run: the fix is applied and the heart recovers (CHECKUP_NOW only pins the clock for the checks)
open(P('last-beat'), 'w').write(str(int((time.time() - 3 * 3600) * 1000)))
r2 = run(at=time.time())
assert any('recovered' in f for f in r2['fixed']), r2
# replay only runs the show check
r3 = run('--replay', '2026-01-24')
assert all(b.startswith('show') for b in r3['bad']), r3
srv.shutdown()
print('checkup selftest: ok')
