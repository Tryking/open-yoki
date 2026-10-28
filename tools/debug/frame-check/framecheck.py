#!/usr/bin/env python3
# Frame check for the picture side of a live host. Needs ffmpeg/ffprobe on PATH; standard library only.
#
#   python3 framecheck.py fps  recording.mp4 [--window 20] [--min-fps 20] [--json out.json]
#       Real motion per window: frames that differ from the one before (a repeated frame is a stall the viewer sees
#       as stutter). Use it on a recording of what you pushed to the platform. It shows the classic faults:
#       capturing a 24 fps avatar at a fixed 25 Hz timer (a repeat every 4-5 frames), a hidden/off-screen video element
#       the browser stops painting, and frame drops that stay after the avatar stream reconnects.
#
#   python3 framecheck.py sheet recording.mp4 --every 2 [--ref face.png] [--crop w:h:x:y] [--cols 6] [--out sheet.png]
#       A contact sheet: one frame every N seconds (optionally cropped to the face), with the reference face image
#       put beside every tile. Look at it side by side by eye: an automatic "face similarity" score can pass while a
#       person still sees the face drift.
import json, os, subprocess, sys, tempfile

def arg(k, d=None):
    a = sys.argv
    return a[a.index(k) + 1] if k in a and a.index(k) + 1 < len(a) else d

def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate,r_frame_rate:format=duration',
                          '-of', 'json', path], capture_output=True, text=True, check=True).stdout
    j = json.loads(out)
    num, den = (j['streams'][0].get('avg_frame_rate') or '0/1').split('/')
    return (float(num) / float(den) if float(den) else 0.0), float(j['format'].get('duration', 0))

def fps(path, window=20.0, min_fps=20.0, w=64, h=36, same=0.6):
    rate, dur = probe(path)
    # decode tiny grey frames with their timestamps; showinfo prints pts_time for each frame on stderr
    p = subprocess.Popen(['ffmpeg', '-v', 'info', '-nostdin', '-i', path, '-an', '-vf', f'scale={w}:{h},format=gray,showinfo', '-f', 'rawvideo', '-'],
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    size, frames, prev = w * h, [], None
    import threading, re
    times = []
    def read_err():
        for line in p.stderr:
            m = re.search(rb'pts_time:([\d.]+)', line)
            if m: times.append(float(m.group(1)))
    t = threading.Thread(target=read_err, daemon=True); t.start()
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size: break
        moved = True if prev is None else (sum(abs(a - b) for a, b in zip(buf[::3], prev[::3])) / (size / 3)) > same
        frames.append(moved); prev = buf
    p.wait(); t.join()
    times = times[:len(frames)] or [i / (rate or 25) for i in range(len(frames))]
    rows, start = [], 0.0
    while start < (times[-1] if times else 0):
        idx = [i for i, x in enumerate(times) if start <= x < start + window]
        span = min(window, (times[-1] - start) if times else window) or window
        if idx:
            real = sum(1 for i in idx if frames[i])
            gaps = [times[i] - times[i - 1] for i in idx if i > 0]
            rows.append({'from_s': round(start, 1), 'frames_per_s': round(len(idx) / span, 1), 'moving_per_s': round(real / span, 1),
                         'repeat_share': round(1 - real / len(idx), 2), 'longest_stall_s': round(max(gaps or [0]), 2)})
        start += window
    low = [r for r in rows if r['moving_per_s'] < min_fps]
    return {'file': os.path.basename(path), 'stream_fps': round(rate, 2), 'duration_s': round(dur, 1), 'windows': len(rows),
            'windows_below_min': len(low), 'min_fps': min_fps, 'rows': rows}

def sheet(path, every=2.0, ref=None, crop=None, cols=6, out='sheet.png', tile_w=320):
    tmp = tempfile.mkdtemp(prefix='sheet-')
    vf = (f'crop={crop},' if crop else '') + f'fps=1/{every},scale={tile_w}:-2'
    subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-i', path, '-vf', vf, os.path.join(tmp, 'f%04d.png')], check=True)
    shots = sorted(f for f in os.listdir(tmp) if f.startswith('f'))
    if not shots: raise SystemExit('no frames extracted')
    if ref:
        # each tile = reference | frame, same height
        for f in shots:
            subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', ref, '-i', os.path.join(tmp, f), '-filter_complex',
                            f'[1:v]scale={tile_w}:-2[b];[0:v][b]scale2ref=oh*mdar:ih[a][b2];[a][b2]hstack', os.path.join(tmp, 'p' + f[1:])], check=True)
        shots = sorted(f for f in os.listdir(tmp) if f.startswith('p'))
    rows = (len(shots) + cols - 1) // cols
    pat = os.path.join(tmp, shots[0][0] + '%04d.png')
    subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-start_number', '1', '-i', pat, '-vf', f'tile={cols}x{rows}:padding=4:margin=4', '-frames:v', '1', out], check=True)
    times = [round(i * every, 1) for i in range(len(shots))]
    with open(os.path.splitext(out)[0] + '.times.txt', 'w') as fh:
        fh.write('\n'.join(f'tile {i + 1}: {t}s' for i, t in enumerate(times)) + '\n')
    return {'sheet': os.path.abspath(out), 'tiles': len(shots), 'times': times}

if __name__ == '__main__':
    if len(sys.argv) < 3 or sys.argv[1] not in ('fps', 'sheet'):
        print(__doc__ or 'usage: framecheck.py fps|sheet video ...'); sys.exit(2)
    cmd, video = sys.argv[1], sys.argv[2]
    if cmd == 'fps':
        r = fps(video, float(arg('--window', 20)), float(arg('--min-fps', 20)))
        print(f"{r['file']}: stream {r['stream_fps']} fps, {r['duration_s']} s, {r['windows_below_min']} of {r['windows']} windows under {r['min_fps']} moving frames/s")
        for x in r['rows']:
            mark = '  <-- low' if x['moving_per_s'] < r['min_fps'] else ''
            print(f"  {x['from_s']:>7}s  frames {x['frames_per_s']:>5}/s  moving {x['moving_per_s']:>5}/s  repeats {x['repeat_share']:.0%}  longest stall {x['longest_stall_s']}s{mark}")
        if arg('--json'): json.dump(r, open(arg('--json'), 'w'), indent=1)
    else:
        r = sheet(video, float(arg('--every', 2)), arg('--ref'), arg('--crop'), int(arg('--cols', 6)), arg('--out', 'sheet.png'))
        print(f"wrote {r['sheet']} ({r['tiles']} tiles, times in {os.path.splitext(r['sheet'])[0]}.times.txt)")
