# Offline self-test on a generated 20 s video with a tone for audio. python3 selftest.py   (needs ffmpeg)
import os, shutil, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
if not shutil.which('ffmpeg'):
    print('distill-prep selftest: skipped (no ffmpeg)'); sys.exit(0)
tmp = tempfile.mkdtemp(prefix='distill-test-')
v = os.path.join(tmp, 'talk.mp4')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=20',
                '-shortest', '-c:v', 'libx264', '-c:a', 'aac', v], check=True)
out = os.path.join(tmp, 'study')
run = lambda *a: subprocess.run([sys.executable, os.path.join(HERE, 'prep.py'), v, *a], check=True, capture_output=True, text=True).stdout
run('--code', 'c1', '--start', '0', '--dur', '10', '--every', '2', '--out', out, '--asr', 'echo "fake transcript of $AUDIO"', '--who', 'Test Streamer')
run('--code', 'c2', '--start', '10', '--dur', '8', '--every', '1', '--out', out)
for f in ['c1/clip.mp4', 'c1/audio.wav', 'c1/grid-1.png', 'c1/frames.txt', 'c1/transcript.txt', 'c2/grid-1.png']:
    assert os.path.getsize(os.path.join(out, f)) > 0, f
assert len(os.listdir(os.path.join(out, 'c1', 'frames'))) == 5
assert 'frame 3: 4s' in open(os.path.join(out, 'c1', 'frames.txt')).read()
assert 'audio.wav' in open(os.path.join(out, 'c1', 'transcript.txt')).read()
notes = open(os.path.join(out, 'notes.md')).read()
assert '# Distill notes: Test Streamer' in notes and '| c1 |' in notes and '| c2 |' in notes and notes.index('| c2 |') < notes.index('## 2.')
shutil.rmtree(tmp)
print('distill-prep selftest: ok')
