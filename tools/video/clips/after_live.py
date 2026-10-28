#!/usr/bin/env python3
"""After-live highlights: turn a finished live's replay into short 16:9 clips the host (or you) can post.

For every finished show it finds, it
  1. copies the show folder (replay, room details) from the replay source, plus the show journal and the host's notes,
  2. lines the journal up with the replay (optional: Whisper on the first 10 minutes),
  3. picks the best moments: an LLM reads the timeline (chat + what she said + what she thought), or a simple
     heuristic picks the stretches where she answered viewers by name,
  4. cuts each moment into a 16:9 clip with ffmpeg: her picture in the middle, the chat on the left, what she was
     thinking on the right (plus, optionally, the untouched vertical cut),
  5. optionally offers the clips to the host's server (rsync), where she can pick which ones to post.

    python after_live.py pull                 every finished show not done yet (what the timer runs)
    python after_live.py make <id>            (re)build one show, keeping the earlier pick (--repick asks again)
    python after_live.py offer <id>           upload one show's clips + offer.json
    python after_live.py local --replay r.mp4 [--journal show.jsonl] [--notes notes.jsonl] [--start-ms MS] [--title T] [--id ID]
                                              one replay from this computer, no source server needed
Config: --config FILE, else $OPEN_YOKI_CLIPS_CONFIG, else config.json next to this script (see config.example.json).

Output per show:  <output_dir>/<YYYY-MM-DD_HHMM>_<id>/
    01_<title>.mp4            16:9 clip            01_<title>_vertical.mp4   the same moment, untouched (optional)
    chat.md                   every chat line with whether / how fast she answered
    data-panel.png            the platform's stats page for the show, if the source saved one
    README.md                 what each clip is and why it was picked          raw/   inputs and the pick (kept)
"""
import argparse, difflib, json, os, re, shutil, statistics, subprocess, sys, tempfile, time, urllib.request
from datetime import datetime, timedelta, timezone
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'common'))
from textdraw import Fonts, Text           # noqa: E402
from media import need                      # noqa: E402

W, H = 1920, 1080
ACC, WHITE, GREY, DIM = (240, 185, 11), (245, 245, 245), (170, 170, 170), (120, 120, 120)

DEFAULTS = {
    'host': {'name': 'Your Host', 'tagline_zh': 'AI 主播 · 直播回放原片', 'tagline_en': 'AI streamer · real replay',
             'chat_label': '直播间', 'heart_label': '她心里', 'heart_hint': '观众看不到',
             'bottom_line': '她记得来过的人，自己决定说什么。'},
    'source': {'lives': None, 'journal': None, 'journal_pattern': '{day}.jsonl', 'notes': []},
    'output_dir': '~/open-yoki-clips',
    'state_dir': '~/.open-yoki-clips',
    'timezone_offset_hours': 8,
    'picker': {'mode': 'llm', 'base_url': 'https://api.anthropic.com', 'model': 'claude-sonnet-4-5',
               'api_key_env': 'ANTHROPIC_API_KEY', 'max_clips': 6, 'extra_instructions': ''},
    'whisper': {'cmd': 'whisper', 'model': 'small', 'language': 'zh'},
    'journal_offset_s': 2.0,
    'replay_download': True,
    'vertical_copy': True,
    'draw_subtitles': False,
    'side_panel_min_width': 520,
    'panel_crop': None,
    'fonts': {'zh': None, 'en': None},
    'upload': {'enabled': False, 'dest': None, 'max_age_hours': 36, 'rsync_args': ['--chmod=D755,F644']},
}

def merged(a, b):
    out = dict(a)
    for k, v in (b or {}).items():
        out[k] = merged(a[k], v) if isinstance(a.get(k), dict) and isinstance(v, dict) else v
    return out

def load_config(path):
    path = path or os.environ.get('OPEN_YOKI_CLIPS_CONFIG') or os.path.join(HERE, 'config.json')
    if not os.path.exists(path): raise SystemExit(f'config not found: {path}  (copy config.example.json to config.json and edit it)')
    c = merged(DEFAULTS, {k: v for k, v in json.load(open(path, encoding='utf-8')).items() if not k.startswith('_')})
    for k in ('output_dir', 'state_dir'): c[k] = os.path.abspath(os.path.expanduser(c[k]))
    return c

C = None          # the loaded config
TZ = timezone.utc

def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)
def sh(*a, **k): return subprocess.run([str(x) for x in a], check=True, capture_output=True, text=True, **k).stdout
def mmss(s): return f'{int(s // 60):02d}:{int(s % 60):02d}'
def is_remote(p): return bool(re.match(r'^[^/]*:', p or '')) and not re.match(r'^[A-Za-z]:\\', p or '')
def src_path(p): return p if is_remote(p) else os.path.expanduser(p)

def rsync(src, dst, *extra, timeout=None):
    sh('rsync', '-a', '--partial', *extra, src, dst, timeout=timeout)

# ---------- gather ----------
def finished():
    """ids of shows in the source that have a done.json (works for a local folder or user@host:/path)"""
    lives = C['source']['lives']
    if not lives: return []
    try:
        out = sh('rsync', '-r', '--list-only', '--include=*/', '--include=done.json', '--exclude=*', src_path(lives).rstrip('/') + '/')
    except subprocess.CalledProcessError as e:
        log('listing the source failed', e.stderr.strip()[:200]); return []
    return sorted({m.group(1) for m in re.finditer(r'\s([^\s/]+)/done\.json$', out, re.M)})

def folder(cid):
    base = C['output_dir']
    for d in os.listdir(base) if os.path.isdir(base) else []:
        if d.endswith('_' + cid): return os.path.join(base, d)
    return None

def show_dir_name(cid, start_ms):
    when = datetime.fromtimestamp(start_ms / 1000, TZ).strftime('%Y-%m-%d_%H%M') if start_ms else time.strftime('%Y-%m-%d_%H%M')
    return when + '_' + cid

def iso_ms(t):
    return t if isinstance(t, (int, float)) else datetime.fromisoformat(str(t).replace('Z', '+00:00')).timestamp() * 1000

def window(lines, a, b):
    out = []
    for l in lines:
        try: o = json.loads(l); t = iso_ms(o.get('at'))
        except Exception: continue
        if a <= t <= b: out.append(l if l.endswith('\n') else l + '\n')
    return ''.join(out)

def fetch_text(paths):
    """read files that may live on another machine; missing ones are skipped"""
    text = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, p in enumerate(paths):
            dst = os.path.join(tmp, str(i))
            try: rsync(src_path(p), dst) if is_remote(p) else shutil.copy(os.path.expanduser(p), dst)
            except Exception: continue
            text.append(open(dst, encoding='utf-8', errors='replace').read())
    return '\n'.join(text).splitlines()

def gather(cid):
    src = C['source']
    tmp = os.path.join(C['output_dir'], '.incoming', cid); os.makedirs(tmp, exist_ok=True)
    rsync(src_path(src['lives']).rstrip('/') + '/' + cid + '/', tmp + '/', timeout=12 * 3600)
    d = json.load(open(os.path.join(tmp, 'detail.json'))) if os.path.exists(os.path.join(tmp, 'detail.json')) else {}
    start, dur = int(d.get('liveStartTime') or 0), int(d.get('liveDuration') or 0)
    out = os.path.join(C['output_dir'], show_dir_name(cid, start)); raw = os.path.join(out, 'raw')
    os.makedirs(out, exist_ok=True)
    if os.path.exists(raw): shutil.rmtree(raw)
    shutil.move(tmp, raw)
    if start and dur:
        a, b = start - 60_000, start + dur + 180_000
        if src.get('journal') and not os.path.exists(os.path.join(raw, 'show.jsonl')):
            days = sorted({datetime.fromtimestamp(t / 1000, timezone.utc).strftime('%Y-%m-%d') for t in (a, b)})
            files = [src['journal'].rstrip('/') + '/' + src.get('journal_pattern', '{day}.jsonl').format(day=x) for x in days]
            open(os.path.join(raw, 'show.jsonl'), 'w').write(window(fetch_text(files), a, b))
        notes = src.get('notes') or []
        if notes and not os.path.exists(os.path.join(raw, 'heart.jsonl')):
            open(os.path.join(raw, 'heart.jsonl'), 'w').write(window(fetch_text(notes if isinstance(notes, list) else [notes]), a, b))
    log('gathered', os.path.basename(out))
    return out

# ---------- timeline ----------
def jl(p):
    out = []
    for l in open(p, encoding='utf-8') if os.path.exists(p) else []:
        try: out.append(json.loads(l))
        except Exception: pass
    return out

def whisper(wav):
    w = C['whisper'] or {}
    if not w.get('cmd') or not shutil.which(w['cmd']): return None
    od = os.path.dirname(wav); js = os.path.splitext(wav)[0] + '.json'
    if not os.path.exists(js):
        sh(w['cmd'], wav, '--model', w.get('model', 'small'), '--language', w.get('language', 'zh'), '--output_format', 'json',
           '--output_dir', od, '--fp16', 'False', '--verbose', 'False')
    return [{'start': s['start'], 'end': s['end'], 'text': s['text'].strip()} for s in json.load(open(js)).get('segments', [])]

norm = lambda s: re.sub(r'[^\w]', '', s or '')

def note_of(h):
    """a note from the host's inner log: {"at", "note"}; also understands {"at", "said": "...心里话：<note>"}"""
    if h.get('note'): return str(h['note']).strip()
    m = re.search(r'心里话[:：]\s*(.+?)(?:\n|$)', h.get('said') or '')
    return m.group(1).strip() if m else None

def replay_len(src):
    try: return float(sh('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src).strip())
    except Exception: return 0.0

def timeline(out):
    raw = os.path.join(out, 'raw'); src = os.path.join(raw, 'replay.mp4')
    d = json.load(open(os.path.join(raw, 'detail.json'))) if os.path.exists(os.path.join(raw, 'detail.json')) else {}
    start = int(d.get('liveStartTime') or 0)
    dur = int(d.get('liveDuration') or 0) / 1000 or replay_len(src)
    show, heart = jl(os.path.join(raw, 'show.jsonl')), jl(os.path.join(raw, 'heart.jsonl'))
    rel = lambda at: (iso_ms(at) - start) / 1000
    says = [{'t': rel(x['at']), 'text': x['text'], 'inner': x.get('inner'), 'to': x.get('to')} for x in show if x.get('k') in ('say', 'blurt') and x.get('text')]
    room = [{'t': rel(x['at']), 'who': x.get('who'), 'text': x.get('text'), 'k': x['k'], 'act': x.get('act')} for x in show if x.get('k') in ('chat', 'join', 'thanks')]
    notes = [{'t': rel(h['at']), 'text': note_of(h)} for h in heart if note_of(h)]
    off = float(C.get('journal_offset_s') or 0)
    if says:
        # line the journal up with the replay: transcribe the first 10 minutes, match her lines, take the median gap
        wav = os.path.join(raw, 'head.wav')
        if C['whisper'] and C['whisper'].get('cmd') and shutil.which(C['whisper']['cmd']):
            if not os.path.exists(wav): sh('ffmpeg', '-v', 'error', '-y', '-i', src, '-t', '600', '-ar', '16000', '-ac', '1', wav)
            gaps = []
            for s in whisper(wav) or []:
                near = [x for x in says if abs(s['start'] - x['t']) < 40]
                if not near: continue
                sim = lambda x: difflib.SequenceMatcher(None, norm(s['text']), norm(x['text'])[:len(norm(s['text'])) + 6]).ratio()
                best = max(near, key=sim)
                if sim(best) > 0.55 and norm(s['text'])[:4] in norm(best['text']): gaps.append(s['start'] - best['t'])
            if gaps: off = statistics.median(gaps)
            log('offset', round(off, 2), 's from', len(gaps), 'matched lines')
    else:
        # no journal: her lines come from Whisper over the whole replay (if installed); no chat then
        full = os.path.join(raw, 'full.wav')
        if C['whisper'] and C['whisper'].get('cmd') and shutil.which(C['whisper']['cmd']):
            if not os.path.exists(full): sh('ffmpeg', '-v', 'error', '-y', '-i', src, '-ar', '16000', '-ac', '1', full)
            says = [{'t': s['start'], 'text': s['text'], 'inner': None, 'to': None} for s in whisper(full) or []]
        off = 0.0
        log('no journal: lines from whisper', len(says))
    for x in says + room + notes: x['t'] = round(x['t'] + off, 2)
    for i, s in enumerate(says):                                         # how long each line plays
        nxt = says[i + 1]['t'] if i + 1 < len(says) else s['t'] + 30
        s['end'] = round(min(nxt - 0.2, s['t'] + 1.2 + len(norm(s['text'])) * 0.21), 2)
    keep = lambda xs: [x for x in xs if -5 <= x['t'] <= dur + 5]
    return {'start': start, 'dur': dur, 'offset': off, 'says': keep(says), 'room': sorted(keep(room), key=lambda x: x['t']),
            'notes': keep(notes), 'detail': d}

# ---------- pick ----------
PICK = '''你在给一个 AI 主播「{name}」剪社交媒体宣传素材。下面是一场直播的时间线（相对直播开始的 分:秒）。
挑出最有她特点、最能让人觉得“这个 AI 主播像真人、有意思”的 3 到 {most} 个片段：接弹幕接得妙、被杠了回得好、记得某个人、
安慰人、被逗笑、自己嘀咕得好笑、心里想的和嘴上说的反差，这类。没意思的寒暄、重复、念错、说串的不要。宁缺毋滥：真没几个好的就少挑。
{extra}
每段 12 到 45 秒，从引发她反应的那条弹幕前 1 到 2 秒开始，到她这句说完后 1 秒结束；段与段不重叠。
只回 JSON，不要别的字：
{{"clips":[{{"start":"分:秒","end":"分:秒","title_zh":"8 字内小标题","why":"为什么挑它，一句中文","teach":false,
"hook":"一句宣传文案（中文），不喊单",
"subs":[{{"t":"分:秒","zh":"她说的原话"}}],
"chat":[{{"t":"分:秒","who":"名字","zh":"弹幕原文"}}],
"heart":[{{"t":"分:秒","zh":"她心里想的"}}]}}]}}
subs 只放这段时间里她说的话（原样照抄时间线），chat 只放这段里的弹幕/进场，heart 放她对这段的心里话：时间在这段里或结束后 20 秒内的（没有就空）。'''

def ask(prompt, text):
    p = C['picker']; key = os.environ.get(p.get('api_key_env') or 'ANTHROPIC_API_KEY')
    if not key: raise RuntimeError(f'no API key in ${p.get("api_key_env")}')
    body = json.dumps({'model': p['model'], 'max_tokens': 8000, 'messages': [{'role': 'user', 'content': prompt + '\n\n' + text}]}).encode()
    req = urllib.request.Request(p['base_url'].rstrip('/') + '/v1/messages', data=body, method='POST',
                                 headers={'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'})
    with urllib.request.urlopen(req, timeout=300) as r: j = json.loads(r.read())
    return ''.join(c.get('text', '') for c in j.get('content', []))

def secs(s):
    if isinstance(s, (int, float)): return float(s)
    m = re.match(r'(\d+):(\d+(?:\.\d+)?)', str(s)); return int(m.group(1)) * 60 + float(m.group(2)) if m else float(s)

def timeline_text(tl):
    ev = [(x['t'], f"[{mmss(x['t'])}] 弹幕 {x['who']}：{x['text']}" if x['k'] == 'chat' else
           f"[{mmss(x['t'])}] {x['who'] or '有人'} {'进来了' if x['k'] == 'join' else x.get('act') or ''}") for x in tl['room']]
    ev += [(x['t'], f"[{mmss(x['t'])}] 她说{('（对 ' + x['to'] + '）') if x.get('to') else ''}：{x['text']}" +
            (f"   〔心里：{x['inner']}〕" if x.get('inner') else '')) for x in tl['says']]
    ev += [(x['t'], f"[{mmss(x['t'])}] 她心里：{x['text']}") for x in tl['notes']]
    return '\n'.join(e for _, e in sorted(ev, key=lambda e: e[0]))[:90000]

def answered(tl, c):
    """her first line within 90 s addressed to this viewer (journal "to") or naming them"""
    return next((s for s in tl['says'] if 0 <= s['t'] - c['t'] <= 90 and
                 (s.get('to') == c['who'] or (c['who'] and c['who'] in s['text']))), None)

def pick_heuristic(tl):
    """no LLM: the stretches where she answered viewers by name, most answers first"""
    most = int(C['picker'].get('max_clips', 6)); spans = []
    for c in [x for x in tl['room'] if x['k'] == 'chat' and x.get('text')]:
        r = answered(tl, c)
        if r: spans.append([c['t'] - 1.5, r['end'] + 1.0, 1 + len(norm(r['text'])) / 40 + (0.5 if r.get('inner') else 0)])
    spans.sort(); merged_ = []
    for s in spans:
        if merged_ and s[0] <= merged_[-1][1] + 4 and s[1] - merged_[-1][0] <= 45: merged_[-1][1] = max(merged_[-1][1], s[1]); merged_[-1][2] += s[2]
        else: merged_.append(s)
    out = []
    for a, b, score in sorted(merged_, key=lambda s: -s[2]):
        a = max(0.0, a); b = min(tl['dur'], max(b, a + 12), a + 45)
        if b - a < 8 or any(a < y and b > x for x, y, _ in out): continue
        out.append((a, b, score))
        if len(out) >= most: break
    clips = []
    for a, b, score in sorted(out):
        subs = [x for x in tl['says'] if a <= x['t'] < b]
        said = [x['text'] for x in tl['room'] if a <= x['t'] < b and x['k'] == 'chat' and x.get('text')]
        title = (said or [x['text'] for x in subs] or ['片段'])[0]          # the viewer line that started it
        clips.append({'start': mmss(a) + f'{a % 1:.2f}'[1:], 'end': mmss(b) + f'{b % 1:.2f}'[1:], 'title_zh': title[:8],
                      'why': f'heuristic: she answered viewers by name here (score {score:.1f})', 'teach': False, 'hook': '',
                      'subs': [{'t': x['t'], 'zh': x['text']} for x in subs],
                      'chat': [{'t': x['t'], 'who': x.get('who'), 'zh': x.get('text') or ('进来了' if x['k'] == 'join' else x.get('act') or '')}
                               for x in tl['room'] if a <= x['t'] < b],
                      'heart': [{'t': x['t'], 'zh': x['text']} for x in tl['notes'] if a <= x['t'] < b + 20]})
    return clips

def pick(tl, out):
    text = timeline_text(tl)
    open(os.path.join(out, 'raw', 'timeline.txt'), 'w', encoding='utf-8').write(text)
    clips = None
    if C['picker'].get('mode') == 'llm':
        p = C['picker']; prompt = PICK.format(name=C['host']['name'], most=p.get('max_clips', 6), extra=p.get('extra_instructions') or '')
        for i in range(3):
            try:
                r = ask(prompt, text); j = json.loads(r[r.index('{'):r.rindex('}') + 1])
                clips = [c for c in j.get('clips', []) if 8 <= secs(c['end']) - secs(c['start']) <= 60]; break
            except Exception as e: log('LLM pick failed', i, type(e).__name__, str(e)[:120]); time.sleep(5 if i < 2 else 0)
        if clips is None: log('falling back to the heuristic pick')
    if clips is None: clips = pick_heuristic(tl)
    json.dump(clips, open(os.path.join(out, 'raw', 'picks.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return clips

# ---------- compose ----------
class Layout:
    """the replay is fitted between two side panels; vertical replays fill the full height"""
    def __init__(self, sw, sh):
        free = W - 2 * int(C.get('side_panel_min_width', 520))
        k = min(free / sw, H / sh)
        self.vw, self.vh = int(sw * k) // 2 * 2, int(sh * k) // 2 * 2
        self.vx, self.vy = (W - self.vw) // 2, (H - self.vh) // 2

def frame(t, c, L, chat, heart, subs, tx):
    host = C['host']
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, L.vx, H], fill=(0, 0, 0, 150)); d.rectangle([L.vx + L.vw, 0, W, H], fill=(0, 0, 0, 150))
    d.line([L.vx, 0, L.vx, H], fill=(*ACC, 90), width=2); d.line([L.vx + L.vw, 0, L.vx + L.vw, H], fill=(*ACC, 90), width=2)
    x0, pw = 60, L.vx - 110
    tx.draw(d, x0, 52, host['name'], 54, WHITE)
    tx.draw(d, x0, 126, host.get('tagline_zh', ''), 24, GREY)
    tx.draw(d, x0, 200, '“' + c.get('title_zh', '') + '”', 34, ACC)
    tx.draw(d, x0, 290, host.get('chat_label', ''), 24, ACC)
    y = 340
    for x in [x for x in chat if x['t'] <= t][-5:]:
        if not x.get('who') or x.get('join'):
            tx.draw(d, x0, y, '· ' + ((x.get('who') or '') + ' ' + x['zh']).strip(), 22, DIM); y += 46; continue
        tx.draw(d, x0, y, x['who'][:24], 24, ACC); y += 36
        for ln in tx.wrap(d, x['zh'], 30, pw)[:3]: tx.draw(d, x0, y, ln, 30, WHITE); y += 42
        y += 18
    rx, rw = L.vx + L.vw + 54, W - (L.vx + L.vw) - 110
    if heart:
        tx.draw(d, rx, 290, host.get('heart_label', ''), 24, ACC)
        tx.draw(d, rx, 326, host.get('heart_hint', ''), 20, DIM)
        cur = [h for h in heart if h['t'] <= t]
        if cur:
            y = 380
            for ln in tx.wrap(d, cur[-1]['zh'], 34, rw)[:9]: tx.draw(d, rx, y, ln, 34, WHITE); y += 52
    if host.get('bottom_line'):
        for i, ln in enumerate(tx.wrap(d, host['bottom_line'], 22, rw)[:2]): tx.draw(d, rx, H - 110 + 32 * i, ln, 22, GREY)
    s = [x for x in subs if x['t'] <= t < x['end']]
    if s and C.get('draw_subtitles'):
        ls = tx.wrap(d, s[-1]['zh'], 34, L.vw - 70)[:3]; bh = 30 + 50 * len(ls); cx = L.vx + L.vw / 2; yb = L.vy + L.vh - 60
        bw = max(tx.width(d, l, 34) for l in ls) + 56
        d.rounded_rectangle([cx - bw / 2, yb - bh, cx + bw / 2, yb], radius=14, fill=(0, 0, 0, 170))
        for i, l in enumerate(ls): tx.center(d, yb - bh + 14 + 50 * i, l, 34, WHITE, cx=cx)
    return im

def compose(c, src, a, b, dst, work, tx):
    from media import video_size
    L = Layout(*video_size(src))
    chat = [{'t': secs(x['t']) - a, 'who': x.get('who'), 'zh': x.get('zh', ''),
             'join': x.get('zh', '') in ('进来了', '') or ('进' in x.get('zh', '')[:8] and len(x.get('zh', '')) < 12)} for x in c.get('chat', [])]
    # the host's notes are written a few seconds after she speaks: one from right after the clip still belongs to it,
    # so it shows by the middle of the clip at the latest
    heart = [{'t': max(0, min(secs(x['t']) - a, (b - a) * 0.45)), 'zh': x['zh']} for x in c.get('heart', []) if secs(x['t']) - a < (b - a) + 25]
    subs = []
    for i, x in enumerate(c.get('subs', [])):
        t = secs(x['t']) - a
        nxt = secs(c['subs'][i + 1]['t']) - a if i + 1 < len(c['subs']) else b - a
        subs.append({'t': t, 'end': min(nxt, t + 1.2 + len(norm(x['zh'])) * 0.21), 'zh': x['zh']})
    total = b - a
    # A landscape replay is already the full stage (the host, her notes, prices, captions): squeezing it into the
    # 9:16 column below, which was made for portrait replays, would squash her. Show it whole instead.
    vw, vh = map(int, sh('ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src).strip().split(',')[:2])
    if vw > vh:
        sh('ffmpeg', '-v', 'error', '-y', '-ss', f'{a:.2f}', '-t', f'{total:.2f}', '-i', src,
           '-filter_complex', f'[0:v]scale={W}:{H}:flags=lanczos,setsar=1,format=yuv420p[vo];[0:a]afade=t=in:d=0.15,afade=t=out:st={total - 0.4:.2f}:d=0.4[ao]',
           '-map', '[vo]', '-map', '[ao]', '-r', '25', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-c:a', 'aac', '-b:a', '160k',
           '-t', f'{total:.2f}', '-movflags', '+faststart', dst)
        return
    marks = sorted({0.0, total, *[x['t'] for x in chat + heart], *[x['t'] for x in subs], *[x['end'] for x in subs]})
    marks = [m for m in marks if 0 <= m <= total]
    lst, p = [], None
    for i, m in enumerate(marks[:-1]):
        du = marks[i + 1] - m
        if du < 0.01: continue
        p = os.path.join(work, f'ov_{i:03d}.png'); frame(m + 0.001, c, L, chat, heart, subs, tx).save(p)
        lst.append(f"file '{p}'\nduration {du:.3f}")
    lst.append(f"file '{p}'")
    open(os.path.join(work, 'ov.txt'), 'w').write('\n'.join(lst) + '\n')
    fc = (f'[0:v]split[c1][c2];[c1]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=40:2,'
          f'eq=brightness=-0.18:saturation=0.7[bg];[c2]scale={L.vw}:{L.vh}[her];[bg][her]overlay={L.vx}:{L.vy}[base];'
          f'[1:v]format=rgba,fps=25[ov];[base][ov]overlay=0:0:shortest=1,format=yuv420p[vo];'
          f'[0:a]afade=t=in:d=0.15,afade=t=out:st={max(0, total - 0.4):.2f}:d=0.4[ao]')
    sh('ffmpeg', '-v', 'error', '-y', '-ss', f'{a:.2f}', '-t', f'{total:.2f}', '-i', src, '-f', 'concat', '-safe', '0', '-i', os.path.join(work, 'ov.txt'),
       '-filter_complex', fc, '-map', '[vo]', '-map', '[ao]', '-r', '25', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-c:a', 'aac', '-b:a', '160k',
       '-t', f'{total:.2f}', '-movflags', '+faststart', dst)

def panel(out):
    """the platform's stats page for this show, if the source saved a screenshot as data-<lang>.png (cropped by panel_crop)"""
    raw = os.path.join(out, 'raw'); got = []
    for f in sorted(os.listdir(raw)):
        m = re.match(r'data-(.+)\.png$', f)
        if not m: continue
        im = Image.open(os.path.join(raw, f)); crop = C.get('panel_crop')
        if crop:                                   # [x0, y0, x1, y1] measured on a screenshot crop[4] pixels wide
            k = im.width / crop[4]; im = im.crop(tuple(int(v * k) for v in crop[:4]))
        name = f'data-panel-{m.group(1)}.png'; im.save(os.path.join(out, name)); got.append(name)
    return got

def chat_report(tl, out):
    """every chat line with what she answered and how fast, plus the counts"""
    says, room = tl['says'], tl['room']
    chats = [x for x in room if x['k'] == 'chat' and x.get('text')]
    rows, delays = [], []
    for c in chats:
        r = answered(tl, c)
        if r: delays.append(r['t'] - c['t'])
        rows.append(f"- [{mmss(c['t'])}] **{c['who']}**: {c['text']}" + (f"\n  - she ({r['t'] - c['t']:.0f} s later): {r['text']}" if r else '\n  - she: no answer by name'))
    who = {c['who'] for c in chats}; joins = [x for x in room if x['k'] == 'join']
    md = [f"# Chat ({mmss(tl['dur'])})", '',
          f"{len(chats)} chat lines from {len(who)} people; {len(joins)} joins; she answered {len(delays)} by name" +
          (f" ({len(delays) * 100 // max(1, len(chats))}%), median {statistics.median(delays):.0f} s, slowest {max(delays):.0f} s" if delays else '') + '.',
          f"She said {len(says)} lines. Times are minutes:seconds from the start of the show.", '',
          '"No answer by name" is not always a miss: answering several at once without names counts as no answer here.', ''] + rows
    open(os.path.join(out, 'chat.md'), 'w', encoding='utf-8').write('\n'.join(md) + '\n')
    log('chat report', len(chats), 'chats', len(delays), 'answered')

def is_video(f):
    try: return open(f, 'rb').read(7) != b'#EXTM3U' and os.path.getsize(f) > 1 << 16
    except OSError: return False

def replay(raw):
    """make sure raw/replay.mp4 exists: the source may have sent only detail.json with a replayUrl (e.g. an HLS playlist)"""
    dst = os.path.join(raw, 'replay.mp4')
    if is_video(dst): return
    try: url = json.load(open(os.path.join(raw, 'detail.json'))).get('replayUrl')
    except Exception: url = None
    if not url or not C.get('replay_download'): return
    part = dst + '.part.mp4'
    sh('ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', url, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', part, timeout=3 * 3600)
    os.replace(part, dst); log('replay downloaded', os.path.getsize(dst), 'bytes')

def make(cid, repick=False, out=None):
    out = out or folder(cid) or gather(cid)
    raw = os.path.join(out, 'raw'); src = os.path.join(raw, 'replay.mp4')
    replay(raw)
    if not is_video(src): log('no replay', cid); return out
    tl = timeline(out)
    json.dump({k: v for k, v in tl.items() if k != 'detail'}, open(os.path.join(raw, 'timeline.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    chat_report(tl, out)
    pk = os.path.join(raw, 'picks.json')
    clips = json.load(open(pk, encoding='utf-8')) if os.path.exists(pk) and not repick else pick(tl, out)
    tx = Text(Fonts(C.get('fonts')))
    for f in os.listdir(out):
        if re.match(r'\d{2}_.+\.mp4$', f): os.remove(os.path.join(out, f))
    made = []
    for i, c in enumerate(clips, 1):
        a, b = max(0, secs(c['start'])), min(tl['dur'], secs(c['end']))
        if b - a < 6: continue
        work = os.path.join(raw, 'frames'); shutil.rmtree(work, ignore_errors=True); os.makedirs(work)
        slug = re.sub(r'[\\/:*?"<>|\s.]+', '', c.get('title_zh') or '')[:12] or f'clip{i}'
        base = os.path.join(out, f'{i:02d}_{slug}')
        compose(c, src, a, b, f'{base}.mp4', work, tx)
        if C.get('vertical_copy'):
            sh('ffmpeg', '-v', 'error', '-y', '-ss', f'{a:.2f}', '-t', f'{b - a:.2f}', '-i', src, '-c:v', 'libx264', '-crf', '19', '-preset', 'medium',
               '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', f'{base}_vertical.mp4')
        made.append((os.path.basename(base), c, a, b)); log('clip', os.path.basename(base), mmss(a), '-', mmss(b))
        shutil.rmtree(work, ignore_errors=True)
    shots = panel(out)
    d = tl['detail']; when = datetime.fromtimestamp(tl['start'] / 1000, TZ).strftime('%Y-%m-%d %H:%M') if tl['start'] else '?'
    md = [f"# {d.get('title') or 'Live'} ({when}, UTC{C['timezone_offset_hours']:+g}, {mmss(tl['dur'])})", '', f'Show id {cid}.', '',
          'Each clip: `.mp4` is 16:9 (her in the middle, chat on the left, what she was thinking on the right)' +
          ('; `_vertical.mp4` is the same moment straight from the replay.' if C.get('vertical_copy') else '.'), '']
    for name, c, a, b in made:
        md += [f"## {name} ({mmss(a)}-{mmss(b)})", f"- why: {c.get('why', '')}", f"- hook: {c.get('hook', '')}"] + \
              (['- teaches / shows a feature: yes'] if c.get('teach') else []) + ['']
    if shots: md += ['Stats page: ' + ', '.join(shots), '']
    if not made: md += ['No clip good enough in this show (or the replay / journal is incomplete). The replay is in raw/replay.mp4.', '']
    md += ['The replay shows real viewers\' names and messages: check before posting whether any should be hidden.']
    open(os.path.join(out, 'README.md'), 'w', encoding='utf-8').write('\n'.join(md) + '\n')
    log('done', out, len(made), 'clips')
    return out

# ---------- offer to the host's server ----------
def offer(out):
    """Upload a show's 16:9 clips (not the vertical copies) and offer.json to upload.dest/<MMDD>/. offer.json goes last,
    so the server only sees a show once all its clips are there. Returns how many clips went."""
    up = C['upload']
    if not up.get('dest'): log('offer: upload.dest is not set'); return 0
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})_\d{4}_(.+)$', os.path.basename(out.rstrip('/')))
    if not m: log('offer: odd folder', out); return 0
    day, cid = m.group(2) + m.group(3), m.group(4)
    pk = os.path.join(out, 'raw', 'picks.json')
    picks = json.load(open(pk, encoding='utf-8')) if os.path.exists(pk) else []
    stage = os.path.join(out, 'raw', 'offer'); shutil.rmtree(stage, ignore_errors=True); os.makedirs(stage)
    items = []
    for f in sorted(os.listdir(out)):
        fm = re.match(r'(\d{2})_(.+)\.mp4$', f)
        if not fm or f.endswith('_vertical.mp4'): continue
        n = int(fm.group(1)); c = picks[n - 1] if 0 < n <= len(picks) else {}
        iid = f'{day}-{n:02d}'; dst = os.path.join(stage, iid + '.mp4')
        try: os.link(os.path.join(out, f), dst)
        except OSError: shutil.copy2(os.path.join(out, f), dst)
        items.append({'id': iid, 'title': c.get('title_zh') or fm.group(2), 'secs': round(replay_len(dst)), 'why': c.get('why', ''),
                      'chat': [f"{x.get('who', '')}：{x.get('zh', '')}" for x in c.get('chat', [])][:8],
                      'said': [x.get('zh', '') for x in c.get('subs', [])][:8], 'teach': bool(c.get('teach'))})
    if not items: log('offer: no clips in', out); return 0
    try: d = json.load(open(os.path.join(out, 'raw', 'detail.json')))
    except Exception: d = {}
    json.dump({'show': cid, 'day': f'{m.group(1)}-{m.group(2)}-{m.group(3)}', 'title': d.get('title') or '',
               'mins': round(int(d.get('liveDuration') or 0) / 60000), 'at': int(time.time() * 1000), 'items': items},
              open(os.path.join(stage, 'offer.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    dest = src_path(up['dest']).rstrip('/') + '/' + day
    # a second show on the same day (a restart) would overwrite the first one's list: leave that to a person
    with tempfile.TemporaryDirectory() as tmp:
        try:
            rsync(dest + '/offer.json', tmp + '/prev.json')
            prev = json.load(open(tmp + '/prev.json')).get('show')
        except Exception: prev = None
    if prev and prev != cid: log('offer: skipped', cid, '- clips of show', prev, 'already in', dest); return 0
    args = list(up.get('rsync_args') or [])
    if is_remote(dest): args += ['--rsync-path', f'mkdir -p {dest.split(":", 1)[1]} && rsync']
    else: os.makedirs(dest, exist_ok=True)
    rsync(stage + '/', dest + '/', '--exclude', 'offer.json', *args)
    rsync(os.path.join(stage, 'offer.json'), dest + '/', *args)
    shutil.rmtree(stage, ignore_errors=True)
    log('offered', day, len(items), 'clips')
    return len(items)

def offer_new(seen):
    """offer every show cut within upload.max_age_hours that has not been offered yet (a failed upload is retried next run)"""
    up = C['upload']
    if not up.get('enabled'): return
    f = os.path.join(C['state_dir'], 'offered.json')
    done = set(json.load(open(f))) if os.path.exists(f) else set()
    for cid in sorted(seen - done):
        out = folder(cid)
        try: start = datetime.strptime(os.path.basename(out)[:15], '%Y-%m-%d_%H%M').replace(tzinfo=TZ) if out else None
        except ValueError: start = None
        if not start or datetime.now(TZ) - start > timedelta(hours=up.get('max_age_hours', 36)): continue
        try: offer(out)
        except Exception as e: log('offer failed', cid, type(e).__name__, str(e)[:300]); continue
        done.add(cid); json.dump(sorted(done), open(f, 'w'))

def pull():
    os.makedirs(C['output_dir'], exist_ok=True)
    f = os.path.join(C['state_dir'], 'done.json')
    seen = set(json.load(open(f))) if os.path.exists(f) else set()
    new = [c for c in finished() if c not in seen]
    open(os.path.join(C['state_dir'], 'last-check'), 'w').write(time.strftime('%F %T') + f' new {len(new)}\n')
    for cid in new:
        try: make(cid)
        except Exception as e: log('failed', cid, type(e).__name__, str(e)[:300]); continue
        seen.add(cid); json.dump(sorted(seen), open(f, 'w'))
    offer_new(seen)

def local(a):
    """one replay from this computer: copy it (and the journal / notes) into a show folder and cut it"""
    cid = a.id or re.sub(r'\W+', '', os.path.splitext(os.path.basename(a.replay))[0]) or 'local'
    start = a.start_ms or 0
    out = os.path.join(C['output_dir'], show_dir_name(cid, start)); raw = os.path.join(out, 'raw'); os.makedirs(raw, exist_ok=True)
    shutil.copy(a.replay, os.path.join(raw, 'replay.mp4'))
    for f, name in ((a.journal, 'show.jsonl'), (a.notes, 'heart.jsonl')):
        if f: shutil.copy(f, os.path.join(raw, name))
    json.dump({'liveStartTime': start, 'liveDuration': int(replay_len(a.replay) * 1000), 'title': a.title or ''},
              open(os.path.join(raw, 'detail.json'), 'w'), ensure_ascii=False)
    return make(cid, repick=True, out=out)

def main():
    global C, TZ
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--config')
    sp = ap.add_subparsers(dest='cmd')
    sp.add_parser('pull')
    m = sp.add_parser('make'); m.add_argument('id'); m.add_argument('--repick', action='store_true')
    o = sp.add_parser('offer'); o.add_argument('id')
    lo = sp.add_parser('local'); lo.add_argument('--replay', required=True); lo.add_argument('--journal'); lo.add_argument('--notes')
    lo.add_argument('--start-ms', type=int, dest='start_ms'); lo.add_argument('--title'); lo.add_argument('--id')
    a = ap.parse_args()
    C = load_config(a.config); TZ = timezone(timedelta(hours=float(C.get('timezone_offset_hours') or 0)))
    os.makedirs(C['state_dir'], exist_ok=True); os.makedirs(C['output_dir'], exist_ok=True)
    need('ffmpeg', 'ffprobe')
    if a.cmd == 'make': make(a.id, a.repick)
    elif a.cmd == 'offer': offer(folder(a.id) or sys.exit('no such show ' + a.id))
    elif a.cmd == 'local': local(a)
    else: need('rsync'); pull()

if __name__ == '__main__':
    main()
