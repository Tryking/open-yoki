#!/usr/bin/env python3
"""Render a bilingual "what changed today" video (16:9, 1920x1080) from a storyboard JSON.

    python render.py storyboard.json                 # writes the "output" path from the storyboard
    python render.py storyboard.json --out x.mp4     # somewhere else
    python render.py storyboard.json --assets DIR    # take music / sfx / clips / images / voice from DIR
    python render.py storyboard.json --still before@1.5 --out frame.png   # one frame, for quick layout checks

Each segment is drawn frame by frame with Pillow and piped into ffmpeg together with its own sound (the clip's own audio,
voice-overs). The segments are joined, then music and sound effects go under the voices: the music is ducked whenever
someone speaks (sidechain compression) and the whole mix is normalised to -14 LUFS. See README.md for the storyboard format.
"""
import argparse, json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFilter, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'common'))
from textdraw import Fonts, Text, ease          # noqa: E402
from media import ff, need, duration, video_size, has_audio   # noqa: E402

W, H = 1920, 1080
DEFAULT_THEME = {'bg': '#0C0C0C', 'accent': '#F0B90B', 'before': '#E84040', 'after': '#3CC878', 'text': '#FFFFFF',
                 'muted': '#A5A5A5', 'en': '#E1CD96', 'card': '#1C1C1C'}

def rgb(c):
    if isinstance(c, (list, tuple)): return tuple(int(x) for x in c[:3])
    c = c.lstrip('#'); return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))

def alpha(c, k): return (*c[:3], int(255 * max(0.0, min(1.0, k))))

def warn(*a): print('warning:', *a, file=sys.stderr, flush=True)


class Renderer:
    def __init__(self, sb, sb_path, assets=None, fps=None):
        self.sb = sb
        base = os.path.dirname(os.path.abspath(sb_path))
        self.assets = os.path.abspath(assets or os.path.join(base, sb.get('assets_dir', 'assets')))
        self.fps = int(fps or sb.get('fps', 30))
        th = dict(DEFAULT_THEME); th.update(sb.get('theme') or {})
        self.c = {k: rgb(v) for k, v in th.items()}
        self.tx = Text(Fonts(sb.get('fonts')))

    # ---------- helpers ----------
    def path(self, p):
        return p if os.path.isabs(p) else os.path.join(self.assets, p)

    def tone(self, name):
        return self.c.get(name or 'accent', self.c['accent'])

    def draw_pair(self, d, x, y, pair, zs, es, k=1.0, zc=None, ec=None):
        """Chinese line over English line, left-aligned at x. Returns the y below them."""
        if pair.get('zh'): self.tx.draw(d, x, y, pair['zh'], zs, alpha(zc or self.c['text'], k)); y += int(zs * 1.3)
        if pair.get('en'): self.tx.draw(d, x, y, pair['en'], es, alpha(ec or (200, 200, 200), k), True); y += int(es * 1.3)
        return y

    def title(self, d, t, pair, y=90):
        a = ease(t / 0.35)
        if pair.get('zh'): self.tx.center(d, y - (1 - a) * 30, pair['zh'], 64, alpha(self.c['text'], a))
        if pair.get('en'): self.tx.center(d, y + 80 - (1 - a) * 30, pair['en'], 42, alpha(self.c['en'], a), True)

    def banner(self, d, t, b, col):
        """top banner: coloured tag pill, Chinese title, English title under it"""
        a = ease(t / 0.35); y0 = 18 - (1 - a) * 30
        tag, zh, en = b.get('tag', ''), b.get('zh', ''), b.get('en', '')
        wt = self.tx.width(d, tag, 36, True) + 34 if tag else -24
        bw = max(wt + 24 + self.tx.width(d, zh, 56), self.tx.width(d, en, 38, True)) + 64; x0 = 960 - bw / 2
        d.rounded_rectangle((x0, y0, x0 + bw, y0 + 146), 24, fill=(0, 0, 0, 235), outline=(60, 60, 60), width=2)
        if tag:
            d.rounded_rectangle((x0 + 32, y0 + 20, x0 + 32 + wt, y0 + 76), 12, fill=col)
            self.tx.draw(d, x0 + 49, y0 + 26, tag, 36, (20, 20, 20), True)
        self.tx.draw(d, x0 + 32 + wt + 24, y0 + 14, zh, 56, self.c['text'])
        self.tx.draw(d, x0 + 32, y0 + 88, en, 38, self.c['en'], True)

    def subs(self, d, t, subs):
        """bottom subtitle box: the last line whose time has come (and not passed its "until")"""
        cur = [s for s in subs or [] if s.get('at', 0) <= t < s.get('until', 1e9)]
        if not cur: return
        s = cur[-1]; k = ease((t - s.get('at', 0)) / 0.3); zh, en = s.get('zh', ''), s.get('en', '')
        w = max(self.tx.width(d, zh, 34) if zh else 0, self.tx.width(d, en, 30, True) if en else 0) + 50
        h = (42 if zh else 0) + (44 if en else 0) + 8; y = 1076 - h - 4
        d.rounded_rectangle((960 - w / 2, y, 960 + w / 2, y + h), 14, fill=(30, 30, 30, int(230 * k)))
        yy = y + 4
        if zh: self.tx.center(d, yy, zh, 34, alpha(self.c['text'], k)); yy += 42
        if en: self.tx.center(d, yy + 2, en, 30, alpha((215, 215, 215), k), True)

    def callouts(self, d, t, items):
        """boxes that slide in at their time: {"at", "x", "y", "w", "tone", "lines": [{"zh","en"}], "highlight"}"""
        for c in items or []:
            at = c.get('at', 0.5)
            if t < at: continue
            k = ease((t - at) / 0.3); w = c.get('w', 440); col = self.tone(c.get('tone'))
            side = -1 if c.get('x', 60) < 960 else 1
            x = c.get('x', 60) + side * (1 - k) * 60; y = c.get('y', 300)
            rows = []
            for p in c.get('lines', []):
                for txt, size, latin in ((p.get('zh'), 34, False), (p.get('en'), 28, True)):
                    if txt: rows += [(ln, size, latin) for ln in self.tx.wrap(d, txt, size, w - 60, latin)]
            h = 32 + sum(int(s * 1.32) for _, s, _ in rows) + (56 if c.get('highlight') else 0)
            d.rounded_rectangle((x, y, x + w, y + h), 24, fill=(0, 0, 0, 225), outline=col, width=4)
            yy = y + 16
            for ln, size, latin in rows:
                self.tx.draw(d, x + 30, yy, ln, size, self.c['text'] if not latin else (210, 210, 210), latin); yy += int(size * 1.32)
            if c.get('highlight'): self.tx.draw(d, x + 30, yy + 6, c['highlight'], 36, col, True)

    def footer(self, d, f):
        if not f: return
        if f.get('zh'): self.tx.draw(d, 40, 1000, f['zh'], 24, (160, 160, 160))
        if f.get('en'): self.tx.draw(d, 40, 1036, f['en'], 22, (150, 150, 150), True)

    def overlays(self, s, d, t, im):
        tone = s.get('tone')
        if s.get('banner'): self.banner(d, t, s['banner'], self.tone(s['banner'].get('tone') or tone))
        self.callouts(d, t, s.get('callouts'))
        self.subs(d, t, s.get('subs'))
        self.footer(d, s.get('footer'))

    # ---------- segment types ----------
    def f_title_list(self, s, d, t, im):
        self.title(d, t, s.get('title', {}))
        items = s.get('items', []); step = min(172, 760 // max(1, len(items)))
        for j, it in enumerate(items):
            at = 0.3 + j * s.get('every', 0.25)
            if t < at: continue
            k = ease((t - at) / 0.3); y = 290 + j * step; x = 330 + (1 - k) * 80; h = step - 26
            d.rounded_rectangle((x, y, x + 1260, y + h), 22, fill=self.c['card'], outline=self.c['accent'], width=3)
            self.tx.draw(d, x + 40, y + h / 2 - 50, str(j + 1), 74, self.c['accent'], True)
            if it.get('zh'): self.tx.draw(d, x + 124, y + 18, it['zh'], 52, self.c['text'])
            if it.get('en'): self.tx.draw(d, x + 124, y + (86 if it.get('zh') else 40), it['en'], 34, (190, 190, 190), True)

    def f_number_cards(self, s, d, t, im):
        self.title(d, t, s.get('title', {}), y=110)
        cards = s.get('cards', []); n = max(1, len(cards)); gap = 1620 / n
        for j, c in enumerate(cards):
            at = 0.25 + j * 0.15
            if t < at: continue
            k = ease((t - at) / 1.0); cx = 150 + gap * (j + 0.5)
            v = float(c.get('value', 0)) * k; dec = int(c.get('decimals', 0))
            num = c.get('prefix', '') + (f'{v:,.{dec}f}' if c.get('commas') else f'{v:.{dec}f}') + c.get('unit', '')
            self.tx.center(d, 330, num, 150, self.c['accent'], True, cx=cx)
            lab = c.get('label', {})
            if lab.get('zh'): self.tx.center(d, 520, lab['zh'], 48, self.c['text'], cx=cx)
            if lab.get('en'): self.tx.center(d, 584, lab['en'], 34, (200, 200, 200), True, cx=cx)
            if c.get('delta') and t > 1.2:
                k2 = ease((t - 1.2 - j * 0.1) / 0.3); w = self.tx.width(d, c['delta'], 44, True) + 40
                col = self.c['after'] if not str(c['delta']).startswith('-') else self.c['before']
                d.rounded_rectangle((cx - w / 2, 650, cx + w / 2, 716), 16, fill=alpha(col, 0.86 * k2))
                self.tx.center(d, 656, c['delta'], 44, alpha(self.c['text'], k2), True, cx=cx)
        note = s.get('note')
        if note and t > 1.8:
            k = ease((t - 1.8) / 0.4)
            if note.get('zh'): self.tx.center(d, 820, note['zh'], 44, alpha(self.c['text'], k))
            if note.get('en'): self.tx.center(d, 882, note['en'], 34, alpha((210, 210, 210), k), True)

    def f_stinger(self, s, d, t, im):
        sc = 1 + 0.25 * (1 - ease(t / 0.25)); sz = int(230 * sc)
        col = self.tone(s.get('tone'))
        if s.get('zh'): self.tx.center(d, 440 - sz * 0.6, s['zh'], sz, col)
        if s.get('en') and t > 0.12:
            k = ease((t - 0.12) / 0.25); self.tx.center(d, 600 + (1 - k) * 30, s['en'], 110, alpha(self.c['text'], k), True)

    def box(self, s):
        return s.get('box') or [240, 182, 1440, 810]

    def marks(self, s, d, t, rect):
        """red/green frames on the picture: "box": [x0, y0, x1, y1] as fractions (0-1) of the clip or image"""
        x, y, w, h = rect
        for m in s.get('marks', []):
            if not (m.get('at', 0) <= t < m.get('until', 1e9)): continue
            k = ease((t - m.get('at', 0)) / 0.25); b = m['box']; col = self.tone(m.get('tone') or s.get('tone') or 'before')
            r = (x + b[0] * w, y + b[1] * h, x + b[2] * w, y + b[3] * h); grow = (1 - k) * 30
            d.rounded_rectangle((r[0] - grow, r[1] - grow, r[2] + grow, r[3] + grow), 12, outline=alpha(col, k), width=6)
            if m.get('label'):
                lab = m['label']; lw = self.tx.width(d, lab, 28, True) + 28
                d.rounded_rectangle((r[0], r[1] - 46, r[0] + lw, r[1] - 6), 10, fill=alpha(col, k))
                self.tx.draw(d, r[0] + 14, r[1] - 44, lab, 28, alpha((20, 20, 20), k), True)

    def paste_fit(self, im, pic, rect, blur_fill=True):
        """fit pic into rect keeping its aspect; the rest of rect gets a blurred, darker copy of it"""
        x, y, w, h = rect
        if blur_fill and abs(pic.width / pic.height - w / h) > 0.02:
            bg = ImageOps.fit(pic.resize((max(1, pic.width // 8), max(1, pic.height // 8))), (w // 8, h // 8))
            bg = bg.filter(ImageFilter.GaussianBlur(4)).resize((w, h)).point(lambda v: int(v * 0.55))
            im.paste(bg, (x, y))
        fit = ImageOps.contain(pic, (w, h))
        im.paste(fit, (x + (w - fit.width) // 2, y + (h - fit.height) // 2))

    def f_clip(self, s, d, t, im, frame=None):
        rect = self.box(s); x, y, w, h = rect
        if frame is not None: self.paste_fit(im, frame, rect)
        tone = s.get('tone')
        if tone in ('before', 'after'):
            d.rectangle((x - 5, y - 5, x + w + 5, y + h + 5), outline=self.tone(tone), width=5)
        self.marks(s, d, t, rect)

    def f_image(self, s, d, t, im, pic=None):
        at = s.get('image_at', 0.1)
        if pic is not None and t >= at:
            k = ease((t - at) / 0.35)
            if s.get('position', 'left') == 'center':
                x0 = (W - pic.width) // 2; y0 = s.get('y', 190)
            else:
                x0 = int(110 - (1 - k) * 80); y0 = s.get('y', 220)
            d.rounded_rectangle((x0 - 10, y0 - 10, x0 + pic.width + 10, y0 + pic.height + 10), 22, fill=(0, 0, 0),
                                outline=self.tone(s.get('tone')), width=5)
            im.paste(pic, (x0, y0))
            lab = s.get('label') or {}
            self.draw_pair(d, x0, y0 + pic.height + 18, lab, 26, 22, zc=(200, 200, 200), ec=(180, 180, 180))
            self.marks(s, d, t, (x0, y0, pic.width, pic.height))
        items = s.get('list', []); col = self.tone(s.get('tone'))
        for j, it in enumerate(items):
            at = s.get('list_at', 0.6) + j * s.get('every', 1.0)
            if t < at: continue
            k = ease((t - at) / 0.3); x = s.get('list_x', 900) + (1 - k) * 60; y = 230 + j * 178
            d.rounded_rectangle((x, y, x + 960, y + 150), 22, fill=self.c['card'], outline=col, width=3)
            d.ellipse((x + 24, y + 42, x + 88, y + 106), fill=col)
            self.tx.center(d, y + 44, str(j + 1), 44, (20, 20, 20), True, cx=x + 56)
            if it.get('zh'): self.tx.draw(d, x + 112, y + 22, it['zh'], 42, self.c['text'])
            if it.get('en'): self.tx.draw(d, x + 112, y + (86 if it.get('zh') else 50), it['en'], 30, (200, 200, 200), True)

    def f_end(self, s, d, t, im, avatar=None):
        a = ease(t / 0.4); y = 90
        if avatar is not None:
            av, m = avatar; im.paste(av, ((W - av.width) // 2, int(y - (1 - a) * 30)), m); y += av.height + 40
        else:
            y = 300
        for j, ln in enumerate(s.get('lines', [])):
            k = ease((t - j * 0.25) / 0.4)
            if k <= 0: continue
            style = ln.get('style', 'accent' if j == 0 else 'normal')
            zs, es, col = {'accent': (66, 50, self.c['accent']), 'normal': (50, 40, self.c['text']), 'small': (40, 34, (200, 200, 200))}[style]
            if ln.get('zh'): self.tx.center(d, y + (1 - k) * 30, ln['zh'], zs, alpha(col, k)); y += int(zs * 1.35)
            if ln.get('en'): self.tx.center(d, y + (1 - k) * 30, ln['en'], es, alpha(col if style == 'accent' else (225, 225, 225), k), True); y += int(es * 1.35)
            y += 26

    # ---------- per segment: sources, frames, sound ----------
    def prepare(self, s, work):
        """returns (duration, draw(t, i) -> Image, audio inputs [(file, at, vol, tempo)], close())"""
        typ = s['type']; ex = {}; audio = []; closers = []
        for v in s.get('voice', []):
            f = self.path(v['file'])
            if os.path.exists(f): audio.append((f, v.get('at', 0.3), v.get('vol', 1.0), v.get('tempo', 1.0)))
            else: warn(f'voice file missing, skipped: {f}')
        dur = s.get('dur', 'auto')
        if dur == 'auto':
            ends = [at + duration(f) / tempo for f, at, _, tempo in audio]
            dur = (max(ends) if ends else 3.0) + s.get('pad', 0.6)
        dur = float(dur)
        if typ == 'clip':
            src = self.path(s['src'])
            if not os.path.exists(src): raise SystemExit(f'clip not found: {src}')
            rect = self.box(s); sw, sh = video_size(src)
            k = min(rect[2] / sw, rect[3] / sh); fw, fh = int(sw * k) // 2 * 2, int(sh * k) // 2 * 2
            grey = s.get('grey', s.get('tone') == 'before')
            vf = f'fps={self.fps},scale={fw}:{fh}' + (',hue=s=0.15,eq=brightness=-0.06' if grey else '')
            proc = subprocess.Popen(['ffmpeg', '-v', 'error', '-nostdin', '-ss', str(s.get('start', 0)), '-t', str(dur), '-i', src,
                                     '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
            closers.append(lambda: (proc.poll() is None and proc.kill(), proc.stdout.close(), proc.wait()))
            last = [Image.new('RGB', (fw, fh))]
            def frame(i, n=fw * fh * 3):
                b = proc.stdout.read(n)
                if len(b) == n: last[0] = Image.frombytes('RGB', (fw, fh), b)
                return last[0]
            ex['frame'] = frame
            if s.get('keep_audio', True) and has_audio(src):
                wav = os.path.join(work, s['id'] + '_clip.wav')
                ff('-ss', s.get('start', 0), '-t', dur, '-i', src, '-vn', '-ar', 48000, '-ac', 2, wav)
                audio.insert(0, (wav, 0.0, s.get('volume', 1.0), 1.0))
        elif typ == 'image':
            src = self.path(s['src'])
            if not os.path.exists(src): raise SystemExit(f'image not found: {src}')
            pic = Image.open(src).convert('RGB')
            if s.get('crop'): pic = pic.crop(tuple(s['crop']))
            mw, mh = s.get('max_size', [760 if s.get('list') else 1440, 700])
            pic = ImageOps.contain(pic, (mw, mh), Image.LANCZOS) if s.get('scale') is None else \
                pic.resize((int(pic.width * s['scale']), int(pic.height * s['scale'])), Image.LANCZOS)
            ex['pic'] = pic
        elif typ == 'end' and s.get('avatar'):
            f = self.path(s['avatar'])
            if os.path.exists(f):
                sz = s.get('avatar_size', 220)
                av = ImageOps.fit(Image.open(f).convert('RGB'), (sz, sz), centering=(0.5, 0.25))
                m = Image.new('L', (sz, sz), 0); ImageDraw.Draw(m).ellipse((0, 0, sz - 1, sz - 1), fill=255)
                ex['avatar'] = (av, m)
            else: warn(f'avatar missing, skipped: {f}')
        fn = getattr(self, 'f_' + typ, None)
        if not fn: raise SystemExit(f'unknown segment type "{typ}" in segment {s.get("id")}')

        def draw(t, i):
            im = Image.new('RGB', (W, H), self.c['bg']); d = ImageDraw.Draw(im, 'RGBA')
            if typ == 'clip': fn(s, d, t, im, ex['frame'](i))
            elif typ == 'image': fn(s, d, t, im, ex.get('pic'))
            elif typ == 'end': fn(s, d, t, im, ex.get('avatar'))
            else: fn(s, d, t, im)
            d = ImageDraw.Draw(im, 'RGBA')            # pastes above may have replaced pixels under the old draw
            self.overlays(s, d, t, im)
            return im
        return dur, draw, audio, lambda: [c() for c in closers]

    def render_segment(self, s, work):
        dur, draw, audio, close = self.prepare(s, work)
        n = round(dur * self.fps); out = os.path.join(work, s['id'] + '.mkv')
        cmd = ['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(self.fps), '-i', '-',
               '-f', 'lavfi', '-t', str(dur), '-i', 'anullsrc=r=48000:cl=stereo']
        g = [f'[1:a]atrim=0:{dur}[a0]']
        for j, (f, at, vol, tempo) in enumerate(audio):
            cmd += ['-i', f]; ms = int(at * 1000)
            g.append(f'[{j + 2}:a]aresample=48000,aformat=channel_layouts=stereo' + (f',atempo={tempo}' if tempo != 1 else '') +
                     f',volume={vol},adelay={ms}|{ms}[v{j}]')
        g.append(''.join(['[a0]'] + [f'[v{j}]' for j in range(len(audio))]) +
                 f'amix=inputs={len(audio) + 1}:normalize=0:duration=first,apad,atrim=0:{dur}[a]')
        cmd += ['-filter_complex', ';'.join(g), '-map', '0:v', '-map', '[a]', '-t', str(dur), '-c:v', 'libx264', '-preset', 'medium',
                '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', out]
        p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        try:
            for i in range(n): p.stdin.write(draw(i / self.fps, i).tobytes())
        finally:
            p.stdin.close(); close()
        if p.wait(): raise SystemExit(f'ffmpeg failed on segment {s["id"]}')
        return out, n / self.fps

    def still(self, seg_id, t, out):
        s = next((x for x in self.sb['segments'] if x['id'] == seg_id), None)
        if not s: raise SystemExit(f'no segment with id {seg_id}')
        s = dict(s)
        if s['type'] == 'clip': s['start'] = s.get('start', 0) + t
        with tempfile.TemporaryDirectory() as work:
            dur, draw, _, close = self.prepare(dict(s, keep_audio=False), work)
            im = draw(t, 0); close()
        im.save(out); print('still', out)

    # ---------- whole video ----------
    def render(self, out):
        segs = self.sb['segments']
        ids = [s.get('id') for s in segs]
        for i, s in enumerate(segs): s.setdefault('id', f'seg{i + 1}')
        if len(set(s['id'] for s in segs)) != len(segs): raise SystemExit(f'segment ids must be unique: {ids}')
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='update-video-') as work:
            parts, start, t = [], {}, 0.0
            for s in segs:
                f, dur = self.render_segment(s, work); parts.append(f); start[s['id']] = t; t += dur
                print(f'segment {s["id"]:<12} {s["type"]:<13} {dur:5.2f}s', flush=True)
            total = t; cat = os.path.join(work, 'cat.mkv'); n = len(parts)
            ff(*sum([['-i', p] for p in parts], []), '-filter_complex', ''.join(f'[{i}:v][{i}:a]' for i in range(n)) +
               f'concat=n={n}:v=1:a=1[v][a]', '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', 18, '-preset', 'medium',
               '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', cat)
            self.mix(cat, segs, start, total, out)
        print(f'done {out}  {total:.2f}s')
        return total

    def cues(self, segs, start, total):
        """music: a segment with "music" starts a new track at its start; it plays until the next segment that has a
        "music" key (null = silence from there). sfx: per segment, times relative to the segment start."""
        mus, fx = [], []
        keyed = [s for s in segs if 'music' in s]
        for j, s in enumerate(keyed):
            m = s['music']
            if not m: continue
            t0 = start[s['id']] + m.get('delay', 0)
            t1 = start[keyed[j + 1]['id']] if j + 1 < len(keyed) else total
            f = self.path(m['file'])
            if not os.path.exists(f): warn(f'music file missing, skipped: {f}'); continue
            mus.append((f, t0, t1 - t0, m.get('ss', 0), m.get('vol', 0.3), m.get('fade_in', 0.2), m.get('fade_out', 0.5)))
        for s in segs:
            for x in s.get('sfx', []):
                f = self.path(x['file'])
                if not os.path.exists(f): warn(f'sfx file missing, skipped: {f}'); continue
                for r in range(int(x.get('repeat', 1))):
                    fx.append((f, start[s['id']] + x.get('at', 0) + r * x.get('every', 0.25), x.get('vol', 0.7)))
        return mus, fx

    def mix(self, cat, segs, start, total, out):
        mix = self.sb.get('mix') or {}
        mus, fx = self.cues(segs, start, total)
        ins, fl = ['-i', cat], []
        for j, (f, t0, dur, ss, vol, fin, fout) in enumerate(mus):
            ins += ['-ss', str(ss), '-t', str(dur), '-i', f]; ms = int(t0 * 1000)
            fl.append(f'[{j + 1}:a]aresample=48000,aformat=channel_layouts=stereo,volume={vol},afade=t=in:d={fin},'
                      f'afade=t=out:st={max(0, dur - fout):.3f}:d={fout},adelay={ms}|{ms}[m{j}]')
        b = len(mus) + 1
        for j, (f, t0, vol) in enumerate(fx):
            ins += ['-i', f]; ms = int(t0 * 1000)
            fl.append(f'[{b + j}:a]aresample=48000,aformat=channel_layouts=stereo,volume={vol},adelay={ms}|{ms}[s{j}]')
        # voices (and the clips' own sound) are cleaned up a little, then used as the key that pushes the music down
        fl.append('[0:a]highpass=f=80,acompressor=threshold=0.1:ratio=3:attack=5:release=120,'
                  f'volume={mix.get("voice_gain", 1.6)},asplit=2[vo][key]')
        layers = ['[vo]']
        if mus:
            fl.append(''.join(f'[m{j}]' for j in range(len(mus))) + f'amix=inputs={len(mus)}:normalize=0:duration=longest[mu]')
            if mix.get('duck', True):
                fl.append(f'[mu][key]sidechaincompress=threshold={mix.get("duck_threshold", 0.02)}:ratio={mix.get("duck_ratio", 8)}'
                          ':attack=15:release=350[mud]')
            else:
                fl.append('[mu]anull[mud]'); fl.append('[key]anullsink')
            layers.append('[mud]')
        else:
            fl.append('[key]anullsink')
        if fx:
            fl.append(''.join(f'[s{j}]' for j in range(len(fx))) + f'amix=inputs={len(fx)}:normalize=0:duration=longest[fx]')
            layers.append('[fx]')
        fl.append(''.join(layers) + f'amix=inputs={len(layers)}:normalize=0:duration=first,atrim=0:{total}[mix]')
        wav = os.path.join(os.path.dirname(cat), 'mix.wav')
        ff(*ins, '-filter_complex', ';'.join(fl), '-map', '[mix]', '-c:a', 'pcm_s24le', '-ar', 48000, wav)
        # two-pass loudness normalisation: measure, then apply linearly so the result lands on the target
        lufs, tp = mix.get('lufs', -14), mix.get('true_peak', -1.5)
        err = subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-i', wav, '-af', f'loudnorm=I={lufs}:TP={tp}:LRA=11:print_format=json',
                              '-f', 'null', '-'], capture_output=True, text=True).stderr
        m = json.loads(err[err.rindex('{'):err.rindex('}') + 1])
        ln = (f'loudnorm=I={lufs}:TP={tp}:LRA=11:measured_I={m["input_i"]}:measured_TP={m["input_tp"]}:measured_LRA={m["input_lra"]}'
              f':measured_thresh={m["input_thresh"]}:offset={m["target_offset"]}:linear=true,aresample=48000')
        ff('-i', cat, '-i', wav, '-map', '0:v', '-map', '1:a', '-af', ln, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
           '-movflags', '+faststart', out)
        print(f'music cues {len(mus)}, sound effects {len(fx)}, loudness {m["input_i"]} -> {lufs} LUFS')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('storyboard')
    ap.add_argument('--out', help='output .mp4 (or .png with --still); default: "output" in the storyboard')
    ap.add_argument('--assets', help='assets folder; default: "assets_dir" in the storyboard, relative to it')
    ap.add_argument('--fps', type=int)
    ap.add_argument('--still', metavar='SEGMENT@SECONDS', help='render one frame to a PNG instead of the video')
    a = ap.parse_args()
    need('ffmpeg', 'ffprobe')
    sb = json.load(open(a.storyboard, encoding='utf-8'))
    r = Renderer(sb, a.storyboard, a.assets, a.fps)
    base = os.path.dirname(os.path.abspath(a.storyboard))
    if a.still:
        seg, _, t = a.still.partition('@')
        r.still(seg, float(t or 0), a.out or os.path.join(base, f'{seg}.png')); return
    out = a.out or sb.get('output') or 'out/update.mp4'
    r.render(out if os.path.isabs(out) else os.path.join(base, out) if not a.out else out)

if __name__ == '__main__':
    main()
