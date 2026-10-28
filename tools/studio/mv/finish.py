#!/usr/bin/env python3
"""Finish a short film or music video from a plan file: cut + join clips, captions, title cards,
music cues, sound effects, music ducked under dialogue, loudness to -14 LUFS, H.264/AAC MP4.

Usage: python3 mv/finish.py <plan.json> [--out film.mp4] [--no-text]

Plan (all times in seconds on the FINISHED film's timeline, paths relative to the plan file):
{
  "size": [1920, 1080], "fps": 30, "speed": 1.0,
  "clips": [{"file": "shots/01/video.mp4", "from": 0.5, "to": 4.5, "audio": true}],
  "voice": [{"file": "vo/line1.wav", "at": 5.2, "vol": 1.0}],
  "subs":  [{"from": 0.8, "to": 3.0, "text": "Hi, I'm Mika"}],
  "cards": [{"from": 0.0, "to": 2.0, "text": "Day 1", "sub": "first stream"}],
  "label": "AI-generated",
  "music": [{"file": "bgm.mp3", "at": 0, "from": 12.0, "dur": 10, "vol": 0.4, "fade_in": 0.3, "fade_out": 0.8}],
  "sfx":   [{"file": "pop.wav", "at": 3.2, "vol": 0.5}],
  "duck": true, "lufs": -14, "true_peak": -1.5, "fade_out": 0.4,
  "font": null, "sub_size": 56
}
Text is drawn with Pillow (pip install pillow); video models garble text, so all on-screen text is added here.
"""
import argparse, json, os, re, subprocess, sys, tempfile

def die(msg):
    sys.exit('✗ ' + msg)

def probe(f):
    j = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]))
    return float(j['format']['duration']), any(s['codec_type'] == 'audio' for s in j['streams'])

FONTS = ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/Hiragino Sans GB.ttc', '/System/Library/Fonts/STHeiti Medium.ttc',
         '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', '/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc',
         '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc', 'C:/Windows/Fonts/msyhbd.ttc', 'C:/Windows/Fonts/msyh.ttc',
         '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']

def make_text_layers(plan, W, H, tmp):
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    path = plan.get('font') or os.environ.get('STUDIO_FONT') or next((f for f in FONTS if os.path.exists(f)), None)
    def font(size):
        if path:
            try: return ImageFont.truetype(path, size)
            except OSError: pass
        return ImageFont.load_default(size)
    def wrap(d, text, f, maxw):
        toks = re.findall(r'[A-Za-z0-9\'’.,!?;:%$#@&*()\-]+\s*|\s+|.', text)
        lines, cur = [], ''
        for t in toks:
            if d.textlength(cur + t, font=f) <= maxw or not cur: cur += t
            else: lines.append(cur.rstrip()); cur = t.lstrip()
        if cur.strip(): lines.append(cur.rstrip())
        return lines
    layers = []
    s = W / 1920
    size = int(plan.get('sub_size', 56) * s)
    for i, sub in enumerate(plan.get('subs', [])):
        im = Image.new('RGBA', (W, H)); d = ImageDraw.Draw(im); f = font(size)
        lines = wrap(d, sub['text'], f, W * 0.8)
        lh = int(size * 1.3); y0 = H - int((plan.get('sub_bottom', 110)) * s) - lh * len(lines)
        shadow = Image.new('RGBA', (W, H)); sd = ImageDraw.Draw(shadow)
        for k, line in enumerate(lines):
            x = (W - d.textlength(line, font=f)) / 2
            sd.text((x, y0 + k * lh + 3), line, font=f, fill=(0, 0, 0, 190))
        im = Image.alpha_composite(im, shadow.filter(ImageFilter.GaussianBlur(5))); d = ImageDraw.Draw(im)
        for k, line in enumerate(lines):
            x = (W - d.textlength(line, font=f)) / 2
            d.text((x, y0 + k * lh), line, font=f, fill=(255, 255, 255), stroke_width=max(2, int(4 * s)), stroke_fill=(20, 20, 20))
        p = os.path.join(tmp, f'sub{i:03d}.png'); im.save(p); layers.append((p, sub['from'], sub['to']))
    for i, c in enumerate(plan.get('cards', [])):
        im = Image.new('RGBA', (W, H)); d = ImageDraw.Draw(im)
        f, fs = font(int(64 * s)), font(int(34 * s))
        tw = max(d.textlength(c['text'], font=f), d.textlength(c.get('sub', ''), font=fs)) + 90 * s
        h = (150 if c.get('sub') else 104) * s; x = (W - tw) / 2; y = 110 * s if c.get('pos', 'top') == 'top' else (H - h) / 2
        col = tuple(c.get('color', [240, 185, 11]))
        d.rounded_rectangle((x, y, x + tw, y + h), radius=int(26 * s), fill=(12, 14, 18, 225), outline=col + (255,), width=max(2, int(4 * s)))
        d.text(((W - d.textlength(c['text'], font=f)) / 2, y + 16 * s), c['text'], font=f, fill=col)
        if c.get('sub'): d.text(((W - d.textlength(c['sub'], font=fs)) / 2, y + 96 * s), c['sub'], font=fs, fill=(205, 205, 210))
        p = os.path.join(tmp, f'card{i:03d}.png'); im.save(p); layers.append((p, c['from'], c['to']))
    if plan.get('label'):
        im = Image.new('RGBA', (W, H)); d = ImageDraw.Draw(im); f = font(int(28 * s)); t = plan['label']
        tw = d.textlength(t, font=f); x, y = W - 56 * s - tw - 40 * s, 50 * s
        d.rounded_rectangle((x, y, x + tw + 40 * s, y + 50 * s), radius=int(25 * s), fill=(0, 0, 0, 120))
        d.text((x + 20 * s, y + 9 * s), t, font=f, fill=(255, 255, 255, 215))
        p = os.path.join(tmp, 'label.png'); im.save(p); layers.append((p, 0, 1e6))
    return layers

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('plan'); ap.add_argument('--out'); ap.add_argument('--no-text', action='store_true')
    a = ap.parse_args()
    plan = json.load(open(a.plan, encoding='utf-8'))
    base = os.path.dirname(os.path.abspath(a.plan))
    rel = lambda p: p if os.path.isabs(p) else os.path.join(base, p)
    W, H = plan.get('size', [1920, 1080]); fps = plan.get('fps', 30); speed = float(plan.get('speed', 1.0))
    clips = plan.get('clips') or die('plan has no clips')
    for c in clips:
        if not os.path.exists(rel(c['file'])): die('clip not found: ' + c['file'])
    out = a.out or rel(plan.get('out', 'film.mp4'))
    tmp = tempfile.mkdtemp(prefix='finish-')

    has_text = plan.get('subs') or plan.get('cards') or plan.get('label')
    layers = []
    if has_text and not a.no_text:
        try: layers = make_text_layers(plan, W, H, tmp)
        except ImportError: die('Pillow is needed for captions/cards (pip install pillow), or run with --no-text')

    args = ['ffmpeg', '-v', 'error', '-y', '-nostdin']
    fc, n = [], 0
    def inp(*x):
        nonlocal n; args.extend(x); n += 1; return n - 1
    pieces = []
    for k, c in enumerate(clips):
        f = rel(c['file']); d, has_a = probe(f)
        t0 = float(c.get('from', 0)); t1 = float(c.get('to', d)); t1 = min(t1, d)
        if t1 - t0 <= 0.05: die(f'clip {k} has no length ({t0}-{t1})')
        i = inp('-i', f)
        fc.append(f'[{i}:v]trim=start={t0:.3f}:end={t1:.3f},setpts=PTS-STARTPTS,scale={W}:{H}:force_original_aspect_ratio=decrease,'
                  f'pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},format=yuv420p[v{k}]')
        if has_a and c.get('audio', True):
            fc.append(f'[{i}:a]atrim=start={t0:.3f}:end={t1:.3f},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a{k}]')
        else:
            fc.append(f'anullsrc=r=48000:cl=stereo,atrim=0:{t1 - t0:.3f}[a{k}]')
        pieces.append(t1 - t0)
    film = sum(pieces) / speed
    fc.append(''.join(f'[v{k}][a{k}]' for k in range(len(clips))) + f'concat=n={len(clips)}:v=1:a=1[cv][ca]')
    fc.append(f'[cv]setpts=PTS/{speed}[vv0];[ca]atempo={speed}[dlg0]' if speed != 1 else '[cv]null[vv0];[ca]anull[dlg0]')
    for k, (p, t0, t1) in enumerate(layers):
        i = inp('-loop', '1', '-t', f'{film:.3f}', '-i', p)
        fc.append(f"[vv{k}][{i}:v]overlay=0:0:enable='between(t,{t0:.3f},{min(t1, film):.3f})'[vv{k + 1}]")
    vout = f'vv{len(layers)}'

    # dialogue = clip audio + placed voice lines
    dl = ['[dlg0]']
    for k, v in enumerate(plan.get('voice', [])):
        i = inp('-i', rel(v['file'])); ms = int(float(v['at']) * 1000)
        fc.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,volume={v.get('vol', 1.0)},adelay={ms}|{ms}[vo{k}]"); dl.append(f'[vo{k}]')
    fc.append(''.join(dl) + f'amix=inputs={len(dl)}:normalize=0:duration=first[dlg]' if len(dl) > 1 else '[dlg0]anull[dlg]')
    mus = []
    for k, m in enumerate(plan.get('music', [])):
        f = rel(m['file']); md, _ = probe(f)
        at = float(m.get('at', 0)); src0 = float(m.get('from', 0)); dd = float(m.get('dur', min(md - src0, film - at)))
        i = inp('-ss', f'{src0:.3f}', '-t', f'{dd:.3f}', '-i', f); ms = int(at * 1000)
        fi, fo = float(m.get('fade_in', 0.2)), float(m.get('fade_out', 0.5))
        fc.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,volume={m.get('vol', 0.4)},afade=t=in:d={fi},afade=t=out:st={max(0, dd - fo):.3f}:d={fo},adelay={ms}|{ms}[m{k}]")
        mus.append(f'[m{k}]')
    fx = []
    for k, s in enumerate(plan.get('sfx', [])):
        i = inp('-i', rel(s['file'])); ms = int(float(s['at']) * 1000)
        fc.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,volume={s.get('vol', 0.5)},adelay={ms}|{ms}[s{k}]"); fx.append(f'[s{k}]')
    mixin = ['[dlgm]']
    fc.append('[dlg]asplit=2[dlgm][key]' if mus and plan.get('duck', True) else '[dlg]anull[dlgm]')
    if mus:
        fc.append(''.join(mus) + f'amix=inputs={len(mus)}:normalize=0:duration=longest[mb]' if len(mus) > 1 else f'{mus[0]}anull[mb]')
        if plan.get('duck', True):
            fc.append('[mb][key]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350[mud]'); mixin.append('[mud]')
        else: mixin.append('[mb]')
    mixin += fx
    fo = float(plan.get('fade_out', 0.4))
    fc.append(''.join(mixin) + f"amix=inputs={len(mixin)}:normalize=0:duration=first,apad,atrim=0:{film:.3f},"
              f"afade=t=out:st={max(0, film - fo):.3f}:d={fo},loudnorm=I={plan.get('lufs', -14)}:TP={plan.get('true_peak', -1.5)}:LRA=11,aresample=48000[aout]")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    args += ['-filter_complex', ';'.join(fc), '-map', f'[{vout}]', '-map', '[aout]', '-t', f'{film:.3f}',
             '-c:v', 'libx264', '-preset', plan.get('preset', 'medium'), '-crf', str(plan.get('crf', 18)), '-pix_fmt', 'yuv420p',
             '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode: die('ffmpeg failed: ' + r.stderr[-800:])
    print(f'✓ {out}  {film:.2f} s  {len(clips)} clip(s)  {len(layers)} text layer(s)  {len(mus)} music cue(s)  {len(fx)} sfx')
    print('  next: node check/clip.mjs cut ' + os.path.relpath(out) + ' --goal "<one line: what a viewer should get>"')

if __name__ == '__main__':
    main()
