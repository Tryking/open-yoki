"""Shared text helpers for the video tools: font discovery and mixed Chinese/Latin drawing with Pillow.

Fonts are looked up in this order (first file that exists wins):
  1. an explicit path given in the config / storyboard ("fonts": {"zh": "...", "en": "..."})
  2. any .ttf/.otf/.ttc dropped into tools/video/fonts/
  3. system fonts: Noto Sans CJK SC (Linux, SIL Open Font License), then macOS STHeiti / Hiragino Sans GB.
Latin text uses the "en" font (Noto Sans / DejaVu Sans on Linux, Avenir Next on macOS); if none is found the
Chinese font is used for Latin too, which always works because CJK fonts carry Latin glyphs.
"""
import os, re
from PIL import ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL_FONTS = os.path.join(os.path.dirname(HERE), 'fonts')

# (path, ttc index). Noto Sans CJK .ttc files hold JP, KR, SC, TC, HK in that order, so SC is index 2.
ZH_CANDIDATES = [
    ('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 2),
    ('/usr/share/fonts/opentype/noto/NotoSansCJK-Medium.ttc', 2),
    ('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 2),
    ('/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc', 2),
    ('/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc', 2),
    ('/usr/share/fonts/google-noto-cjk/NotoSansCJK-Bold.ttc', 2),
    ('/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc', 2),
    ('/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', 0),
    ('/System/Library/Fonts/STHeiti Medium.ttc', 0),
    ('/System/Library/Fonts/Hiragino Sans GB.ttc', 0),
    ('C:/Windows/Fonts/msyh.ttc', 0),
]
EN_CANDIDATES = [
    ('/usr/share/fonts/truetype/noto/NotoSans-SemiBold.ttf', 0),
    ('/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf', 0),
    ('/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf', 0),
    ('/usr/share/fonts/noto/NotoSans-Regular.ttf', 0),
    ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 0),
    ('/System/Library/Fonts/Avenir Next.ttc', 2),
    ('/System/Library/Fonts/Helvetica.ttc', 1),
    ('C:/Windows/Fonts/segoeui.ttf', 0),
]

def _local(kind):
    """fonts dropped into tools/video/fonts/: names containing CJK/SC/zh count as Chinese, others as Latin"""
    if not os.path.isdir(LOCAL_FONTS): return []
    out = []
    for f in sorted(os.listdir(LOCAL_FONTS)):
        if not f.lower().endswith(('.ttf', '.otf', '.ttc')): continue
        cjk = bool(re.search(r'cjk|sc|zh|hans|hei|song', f, re.I))
        if cjk == (kind == 'zh'): out.append((os.path.join(LOCAL_FONTS, f), 2 if 'cjk' in f.lower() and f.lower().endswith('.ttc') else 0))
    return out

def find_font(kind, explicit=None):
    """kind 'zh' or 'en'. explicit: a path, or {"path": ..., "index": n}. Returns (path, index) or raises."""
    cands = []
    if explicit:
        cands.append((explicit['path'], int(explicit.get('index', 0))) if isinstance(explicit, dict) else (explicit, 0))
    cands += _local(kind) + (ZH_CANDIDATES if kind == 'zh' else EN_CANDIDATES)
    for p, i in cands:
        if p and os.path.exists(os.path.expanduser(p)): return os.path.expanduser(p), i
    if kind == 'en': return find_font('zh', None)
    raise SystemExit('No Chinese-capable font found. Install Noto Sans CJK (e.g. `apt install fonts-noto-cjk`) '
                     'or put a .ttf/.otf into tools/video/fonts/, or set "fonts": {"zh": "/path/to/font"}.')

class Fonts:
    def __init__(self, cfg=None):
        cfg = cfg or {}
        self.zh = find_font('zh', cfg.get('zh'))
        self.en = find_font('en', cfg.get('en'))
        self._c = {}

    def get(self, size, latin=False):
        k = (int(size), latin)
        if k not in self._c:
            p, i = self.en if latin else self.zh
            try: self._c[k] = ImageFont.truetype(p, int(size), index=i)
            except OSError: self._c[k] = ImageFont.truetype(p, int(size))
        return self._c[k]

def cjk(ch): return ord(ch) > 0x2E7F

def runs(text, latin):
    """Split text into (piece, is_latin) runs. Chinese lines (latin=False) are drawn in the Chinese font only;
    English lines (latin=True) use the Latin font, with any CJK characters inside them in the Chinese font."""
    if not latin: return [(text, False)]
    out = []
    for ch in text:
        e = not cjk(ch)
        if out and out[-1][1] == e: out[-1] = (out[-1][0] + ch, e)
        else: out.append((ch, e))
    return out

class Text:
    """Drawing helpers bound to a Fonts object."""
    def __init__(self, fonts): self.f = fonts

    def width(self, d, text, size, latin=False):
        return sum(d.textlength(s, font=self.f.get(size, e)) for s, e in runs(text, latin))

    def draw(self, d, x, y, text, size, fill, latin=False):
        for s, e in runs(text, latin):
            f = self.f.get(size, e)
            d.text((x, y + (size * 0.02 if e else 0)), s, font=f, fill=fill); x += d.textlength(s, font=f)
        return x

    def center(self, d, y, text, size, fill, latin=False, cx=960):
        self.draw(d, cx - self.width(d, text, size, latin) / 2, y, text, size, fill, latin)

    def wrap(self, d, text, size, maxw, latin=False):
        """Latin words and numbers stay whole, CJK breaks anywhere."""
        toks = re.findall(r"[A-Za-z0-9'\u2019.,!?$%:;\-\"~+]+|\s|.", text or '')
        lines, cur = [], ''
        for w in toks:
            nxt = cur + w
            if cur.strip() and self.width(d, nxt, size, latin) > maxw: lines.append(cur.rstrip()); cur = w.lstrip()
            else: cur = nxt
        lines.append(cur.rstrip())
        return [l for l in lines if l] or ['']

def ease(x):
    x = max(0.0, min(1.0, x)); return 1 - (1 - x) ** 3
