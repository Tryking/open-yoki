# Offline self-test: a made-up 12 s clip, first 6 s real 24 fps motion, last 6 s only 12 new pictures a second
# (every frame shown twice, the stutter a viewer sees). python3 selftest.py   (needs ffmpeg)
import os, shutil, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import framecheck

if not shutil.which('ffmpeg'):
    print('frame-check selftest: skipped (no ffmpeg)'); sys.exit(0)
tmp = tempfile.mkdtemp(prefix='framecheck-test-')
v = os.path.join(tmp, 'clip.mp4')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=6',
                '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12:duration=6',
                '-filter_complex', '[1:v]fps=24[b];[0:v][b]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', v], check=True)
r = framecheck.fps(v, window=6, min_fps=20)
assert r['windows'] == 2, r
a, b = r['rows']
assert a['moving_per_s'] > 22, a
assert 10 <= b['moving_per_s'] <= 14 and b['repeat_share'] > 0.4, b
assert r['windows_below_min'] == 1
ref = os.path.join(tmp, 'ref.png')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:size=200x200', '-frames:v', '1', ref], check=True)
s = framecheck.sheet(v, every=3, ref=ref, crop='160:160:80:10', cols=2, out=os.path.join(tmp, 'sheet.png'))
assert s['tiles'] == 4 and os.path.getsize(s['sheet']) > 1000, s
t = open(os.path.join(tmp, 'sheet.times.txt')).read(); assert t.startswith('tile 1: 0'), t
shutil.rmtree(tmp)
print('frame-check selftest: ok')
