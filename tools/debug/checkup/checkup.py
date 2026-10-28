#!/usr/bin/env python3
# Daily checkup for a live AI host. Run it once a day after the show (cron / systemd timer). It reads logs, state
# files and URLs listed in a JSON config, writes a short report, and only messages you when something is wrong or
# was fixed. Python 3.8+, standard library only.
#
#   python3 checkup.py --config checkup.json            check, fix what it may fix, write the report, alert
#   python3 checkup.py --config checkup.json --dry      check and print only: no fix, no alert, no report file
#   python3 checkup.py --config checkup.json --replay 2026-01-24   re-run the "show" checks for one earlier day
#   add --json to print the result as JSON (used by the self-test)
#
# Every check is one entry in "checks". Types:
#   command   run a shell command; ok when exit code == expect_exit (0) and stdout matches expect_regex (optional).
#             This is how you plug in anything private: a browser login check, a panel, a queue, a remote box.
#   http      GET url; ok when the status == expect_status (200)
#   fresh     a file must have changed in the last max_age_min minutes. read: "mtime" (default) | "ms" | "s" | "iso"
#             (the file holds a timestamp). May carry a fix command (see below).
#   disk      used share of the disk holding `path` must stay under max_used (0.85)
#   count     count lines matching `pattern` in a log within the last since_hours; flag when below min or above max
#   pair      in a log: how many `incoming` lines got a `replied` line. Flags when incoming >= min_incoming and
#             replied / incoming < min_ratio (e.g. "group chat had 12 messages, she answered none")
#   show      the show window: picture lines (frame_pattern) must start by start_by and run until end_after;
#             an `ended_pattern` before end_after means the platform cut the show; the longest stretch without a
#             `chat_pattern` line must stay under max_chat_gap_min (the comment reader may be stuck)
# Shared fields: name, severity ("bad" = needs a human, default; "note" = worth knowing), after ("21:00": skip
# before this local time), fix (shell command), quiet_hours (["18:50-21:10"]: never fix inside these),
# recheck_after_s (wait, then check again after a fix).
# Logs (count / pair / show): "log": {"file": "...", "format": "jsonl" | "text", "time_field": "at",
#   "text_field": "text"}. Text logs: each line starts with an ISO time or epoch seconds.
# Alerts: "alert": {"telegram": {"token_env": "CHECKUP_TG_TOKEN", "chat_env": "CHECKUP_TG_CHAT"}} or
#   {"webhook_env": "CHECKUP_WEBHOOK"} (POST JSON {"text": ...}) or {"command": "..."} (report on stdin).
#   Secrets are read from the environment only and never printed.
import json, os, re, shutil, subprocess, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

ARGS = sys.argv[1:]
def arg(k, d=None):
    return ARGS[ARGS.index(k) + 1] if k in ARGS and ARGS.index(k) + 1 < len(ARGS) else d

DRY = '--dry' in ARGS
AS_JSON = '--json' in ARGS
REPLAY = arg('--replay')
CFG = json.load(open(arg('--config', 'checkup.json'), encoding='utf-8'))
TZ = timezone(timedelta(hours=float(CFG.get('tz_offset_hours', 0))))
NOW = float(os.environ.get('CHECKUP_NOW', time.time()))   # the self-test pins the clock
bad, fixed, note, summary = [], [], [], []

def local(t=None): return datetime.fromtimestamp(NOW if t is None else t, TZ)
def hm(t): return local(t).strftime('%H:%M')
def mins(s): h, m = s.split(':'); return int(h) * 60 + int(m)

def in_hours(ranges, t=None):
    cur = local(t).hour * 60 + local(t).minute
    for r in ranges or []:
        a, b = (mins(x) for x in r.split('-'))
        if (a <= cur < b) if a <= b else (cur >= a or cur < b): return True
    return False

def flag(c, msg):
    (note if c.get('severity') == 'note' else bad).append(msg)

# ---------- logs ----------
def parse_time(v):
    if v is None: return None
    if isinstance(v, (int, float)): return v / 1000 if v > 1e11 else float(v)
    s = str(v).strip()
    if re.fullmatch(r'\d+(\.\d+)?', s): x = float(s); return x / 1000 if x > 1e11 else x
    try: return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
    except ValueError: return None

def read_log(spec, since, until):
    rows, f = [], spec['file']
    try:
        with open(f, 'rb') as fh:
            fh.seek(0, 2); fh.seek(max(0, fh.tell() - int(spec.get('tail_bytes', 20_000_000))))
            data = fh.read().decode('utf-8', 'replace').splitlines()
    except OSError:
        return None
    for line in data:
        if spec.get('format', 'jsonl') == 'jsonl':
            try: j = json.loads(line)
            except ValueError: continue
            t = parse_time(j.get(spec.get('time_field', 'at')))
            texts = j.get(spec.get('text_field', 'text'))
            texts = texts if isinstance(texts, list) else [texts]
            rows += [(t, str(x)) for x in texts if x is not None]
        else:
            first, _, rest = line.partition(' ')
            rows.append((parse_time(first), rest))
    return [(t, x) for t, x in rows if t is not None and since <= t <= until]

def log_rows(c):
    rows = read_log(c['log'], NOW - float(c.get('since_hours', 24)) * 3600, NOW)
    if rows is None: flag(c, f"{c['name']}: cannot read {c['log']['file']}")
    return rows

# ---------- checks ----------
def check_command(c):
    try: p = subprocess.run(c['cmd'], shell=True, capture_output=True, text=True, timeout=c.get('timeout', 60))
    except subprocess.TimeoutExpired: return flag(c, f"{c['name']}: timed out")
    out = p.stdout.strip()
    ok = p.returncode == c.get('expect_exit', 0) and (not c.get('expect_regex') or re.search(c['expect_regex'], out))
    if not ok: return flag(c, f"{c['name']}: failed (exit {p.returncode}{', ' + out[:80] if out else ''})")
    if c.get('summary'): return f"{c['name']}: {out[:120]}"

def check_http(c):
    req = urllib.request.Request(c['url'], headers={'user-agent': c.get('user_agent', 'Mozilla/5.0 (checkup)')})
    try: code = urllib.request.urlopen(req, timeout=c.get('timeout', 20)).status
    except urllib.error.HTTPError as e: code = e.code
    except Exception as e: code = type(e).__name__
    if code != c.get('expect_status', 200): flag(c, f"{c['name']}: {c['url']} answered {code}")

def age_min(c):
    f, how = c['path'], c.get('read', 'mtime')
    try:
        if how == 'mtime': t = os.path.getmtime(f)
        else:
            raw = open(f).read().strip()
            t = parse_time(raw) if how == 'iso' else float(raw) / (1000 if how == 'ms' else 1)
    except Exception:
        return None
    return (time.time() if c.get('_after_fix') else NOW) / 60 - t / 60

def check_fresh(c):
    a = age_min(c)
    if a is not None and a <= c['max_age_min']: return
    what = f"{c['name']}: no change for {a:.0f} min" if a is not None else f"{c['name']}: {c['path']} unreadable"
    if not c.get('fix') or DRY or REPLAY or in_hours(c.get('quiet_hours')):
        return flag(c, what + (' (not fixed: quiet hours)' if c.get('fix') and in_hours(c.get('quiet_hours')) and not DRY else ''))
    subprocess.run(c['fix'], shell=True, timeout=c.get('fix_timeout', 120))
    time.sleep(float(c.get('recheck_after_s', 60)))
    c['_after_fix'] = True
    a2 = age_min(c)
    if a2 is not None and a2 <= c.get('recovered_within_min', 5): fixed.append(what + ', ran the fix, recovered')
    else: bad.append(what + ', ran the fix, still stuck')

def check_disk(c):
    du = shutil.disk_usage(c.get('path', '/'))
    used = du.used / du.total
    if used > c.get('max_used', 0.85): flag(c, f"{c['name']}: disk {used:.0%} used")

def check_count(c):
    rows = log_rows(c)
    if rows is None: return
    n = sum(1 for _, x in rows if re.search(c['pattern'], x))
    if 'min' in c and n < c['min']: flag(c, f"{c['name']}: {n} in {c.get('since_hours', 24)} h (expected at least {c['min']})")
    if 'max' in c and n > c['max']: flag(c, f"{c['name']}: {n} in {c.get('since_hours', 24)} h (expected at most {c['max']})")
    return f"{c['name']}: {n}"

def check_pair(c):
    rows = log_rows(c)
    if rows is None: return
    inc = sum(1 for _, x in rows if re.search(c['incoming'], x))
    rep = sum(1 for _, x in rows if re.search(c['replied'], x))
    if inc >= c.get('min_incoming', 3) and rep / max(inc, 1) < c.get('min_ratio', 0.3):
        flag(c, f"{c['name']}: {inc} came in, {rep} answered")
    return f"{c['name']}: {inc} in, {rep} answered"

def check_show(c):
    day = datetime.strptime(REPLAY, '%Y-%m-%d').date() if REPLAY else local().date()
    if not REPLAY and c.get('after') and local().hour * 60 + local().minute < mins(c['after']): return f"{c['name']}: not checked yet (before {c['after']})"
    a, b = c['window'].split('-')
    at = lambda s: datetime(day.year, day.month, day.day, *map(int, s.split(':')), tzinfo=TZ).timestamp()
    rows = read_log(c['log'], at(a), at(b))
    if rows is None: return flag(c, f"{c['name']}: cannot read {c['log']['file']}")
    frames = sorted(t for t, x in rows if re.search(c['frame_pattern'], x))
    if not frames: return flag(c, f"{c['name']}: no picture at all between {a} and {b}") or f"{c['name']}: off"
    start, stop = frames[0], frames[-1]
    if c.get('start_by') and hm(start) > c['start_by']: flag(c, f"{c['name']}: started late, {hm(start)}")
    ended = [t for t, x in rows if c.get('ended_pattern') and re.search(c['ended_pattern'], x) and hm(t) < c.get('end_after', '99:99')]
    if ended: flag(c, f"{c['name']}: the platform ended the show at {hm(ended[0])}")
    elif c.get('end_after') and hm(stop) < c['end_after']: flag(c, f"{c['name']}: picture stopped at {hm(stop)}")
    if c.get('chat_pattern'):
        marks = [start] + sorted(t for t, x in rows if re.search(c['chat_pattern'], x)) + [stop]
        gap = max(((y - x), x, y) for x, y in zip(marks, marks[1:])) if len(marks) > 1 else (0, start, start)
        if gap[0] / 60 >= c.get('max_chat_gap_min', 15): flag(c, f"{c['name']}: {hm(gap[1])}-{hm(gap[2])} {gap[0] / 60:.0f} min without one comment read")
    return f"{c['name']}: {hm(start)} to {hm(stop)}"

KINDS = {'command': check_command, 'http': check_http, 'fresh': check_fresh, 'disk': check_disk, 'count': check_count, 'pair': check_pair, 'show': check_show}

# ---------- alert ----------
def alert(text):
    a = CFG.get('alert') or {}
    try:
        if a.get('telegram'):
            tok, chat = os.environ.get(a['telegram']['token_env'], ''), os.environ.get(a['telegram']['chat_env'], '')
            if not tok or not chat: print('alert: telegram env not set', file=sys.stderr); return
            body = urllib.parse.urlencode({'chat_id': chat, 'text': text}).encode()
            urllib.request.urlopen(f'https://api.telegram.org/bot{tok}/sendMessage', body, timeout=20).read()
        elif a.get('webhook_env'):
            url = os.environ.get(a['webhook_env'], '')
            if not url: print('alert: webhook env not set', file=sys.stderr); return
            req = urllib.request.Request(url, json.dumps({'text': text}).encode(), {'content-type': 'application/json'})
            urllib.request.urlopen(req, timeout=20).read()
        elif a.get('command'):
            subprocess.run(a['command'], shell=True, input=text, text=True, timeout=60)
    except Exception as e:
        print('alert failed:', type(e).__name__, file=sys.stderr)   # never print the URL: it may hold the token

def main():
    for c in CFG['checks']:
        if REPLAY and c['type'] != 'show': continue
        if c.get('after') and c['type'] != 'show' and local().hour * 60 + local().minute < mins(c['after']): continue
        try:
            s = KINDS[c['type']](c)
            if s: summary.append(s)
        except Exception as e:
            bad.append(f"{c.get('name', c['type'])}: the check itself broke ({type(e).__name__}: {str(e)[:80]})")
    name, day = CFG.get('name', 'host'), local().strftime('%Y-%m-%d')
    block = lambda title, xs: [title] + [f'- {x}' for x in xs] if xs else []
    rep = [f'# {name} checkup {REPLAY or day} {local().strftime("%H:%M")}', '', *(block('Needs a look:', bad) or ['Needs a look: nothing']), '',
           *block('Fixed by itself:', fixed), *block('Worth knowing:', note), '', *block('Today:', summary)]
    text = '\n'.join(rep) + '\n'
    if AS_JSON: print(json.dumps({'bad': bad, 'fixed': fixed, 'note': note, 'summary': summary}, ensure_ascii=False))
    else: print(text)
    if DRY or REPLAY: return
    out = CFG.get('report_dir')
    if out:
        os.makedirs(out, exist_ok=True)
        open(os.path.join(out, day + '.md'), 'w', encoding='utf-8').write(text)
    if bad or fixed: alert(text)   # all fine: stay quiet

main()
