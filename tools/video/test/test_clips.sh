#!/usr/bin/env bash
# End-to-end check of clips/after_live.py with generated media only: a 150 s vertical "replay" (solid colour + sine),
# a made-up show journal and notes. Uses the heuristic picker (no API), a local folder as the replay source and a
# local folder as the upload destination. Everything goes to /tmp; nothing is written inside the package.
#   bash test/test_clips.sh            (PYTHON=/path/to/python3 to pick an interpreter that has Pillow)
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PY="${PYTHON:-python3}"
T="${VIDEO_TEST_DIR:-/tmp/open-yoki-video-test}/clips"; rm -rf "$T"; mkdir -p "$T"/{lives/9001,journal,out,state,upload}
"$PY" -c 'import PIL' 2>/dev/null || { echo "Pillow missing for $PY (pip install -r requirements.txt)"; exit 1; }
START=1767258000000   # 2026-01-01 09:00 UTC

echo "fixtures -> $T"
ffmpeg -v error -y -nostdin -f lavfi -i "color=c=0x3a2a5a:s=720x1280:r=25:d=150" -f lavfi -i "sine=f=300:d=150:sample_rate=48000" \
  -vf "drawbox=x=40:y=900:w=640:h=300:color=white@0.2:t=fill" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$T/lives/9001/replay.mp4"
"$PY" - "$T" "$START" <<'PY'
import json, sys
T, S = sys.argv[1], int(sys.argv[2])
ev = []
def at(s): return S + int(s * 1000)
# three moments where viewers talk and the host answers them by name, plus filler
for base, who, msg, reply, inner in [(20, 'Viewer A', '晚上好', 'Viewer A 晚上好呀，今天也来看盘啦', '他昨天也来过'),
                                     (70, 'Viewer B', '你是真人吗', 'Viewer B 你猜呀，我只是记性特别好', '被问好多次了，换个说法'),
                                     (115, 'Viewer C', '今天跌麻了', 'Viewer C 抱抱，先别看了，喝口水', '想安慰他又不想说教')]:
    ev.append({'at': at(base - 3), 'k': 'join', 'who': who})
    ev.append({'at': at(base), 'k': 'chat', 'who': who, 'text': msg})
    ev.append({'at': at(base + 3), 'k': 'say', 'text': reply, 'to': who, 'inner': inner})
    ev.append({'at': at(base + 9), 'k': 'say', 'text': '我们接着看这根K线'})
ev.append({'at': at(45), 'k': 'chat', 'who': 'Viewer D', 'text': '路过'})
ev.sort(key=lambda e: e['at'])
open(f'{T}/journal/2026-01-01.jsonl', 'w').write(''.join(json.dumps(e, ensure_ascii=False) + '\n' for e in ev))
open(f'{T}/notes.jsonl', 'w').write(''.join(json.dumps({'at': at(s), 'note': n}, ensure_ascii=False) + '\n'
                                             for s, n in [(26, '他是老面孔了，记得他'), (77, '这个问题我想答得有趣一点'), (121, '希望他好受一点')]))
json.dump({'liveStartTime': S, 'liveDuration': 150000, 'title': 'Test show'}, open(f'{T}/lives/9001/detail.json', 'w'))
json.dump({'cid': '9001'}, open(f'{T}/lives/9001/done.json', 'w'))
json.dump({'host': {'name': 'Test Host'}, 'source': {'lives': f'{T}/lives', 'journal': f'{T}/journal', 'notes': [f'{T}/notes.jsonl']},
           'output_dir': f'{T}/out', 'state_dir': f'{T}/state', 'timezone_offset_hours': 0,
           'picker': {'mode': 'heuristic', 'max_clips': 3}, 'whisper': None, 'journal_offset_s': 0,
           'upload': {'enabled': True, 'dest': f'{T}/upload', 'max_age_hours': 1e9, 'rsync_args': []}},
          open(f'{T}/config.json', 'w'), indent=1)
PY

echo "pull (source folder -> cut -> offer)"
"$PY" "$HERE/clips/after_live.py" --config "$T/config.json" pull
echo "local (one replay from disk)"
"$PY" "$HERE/clips/after_live.py" --config "$T/config.json" local --replay "$T/lives/9001/replay.mp4" \
  --journal "$T/journal/2026-01-01.jsonl" --notes "$T/notes.jsonl" --start-ms "$START" --id local1 --title "Local test"

echo "check"
"$PY" - "$T" <<'PY'
import glob, json, os, subprocess, sys
T = sys.argv[1]; bad = []
clips = sorted(f for f in glob.glob(f'{T}/out/*/[0-9][0-9]_*.mp4') if not f.endswith('_vertical.mp4'))
if len(clips) < 2: bad.append(f'expected clips, got {len(clips)}')
for f in clips:
    j = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height',
                                   '-of', 'json', f], capture_output=True, text=True, check=True).stdout)
    v = [s for s in j['streams'] if s['codec_type'] == 'video'][0]; a = [s for s in j['streams'] if s['codec_type'] == 'audio']
    d = float(j['format']['duration'])
    print(f'{os.path.relpath(f, T)}  {d:.1f}s  {v["width"]}x{v["height"]}  audio {len(a)}')
    if (v['width'], v['height']) != (1920, 1080) or not a or not 8 <= d <= 46: bad.append(f)
    if not os.path.exists(f[:-4] + '_vertical.mp4'): bad.append('no vertical copy for ' + f)
for f in ('chat.md', 'README.md', 'raw/picks.json'):
    if not glob.glob(f'{T}/out/*_9001/{f}'): bad.append('missing ' + f)
off = glob.glob(f'{T}/upload/*/offer.json')
if not off: bad.append('no offer.json uploaded')
else:
    o = json.load(open(off[0])); print('offer', o['show'], [i['id'] for i in o['items']])
    if not all(os.path.exists(os.path.join(os.path.dirname(off[0]), i['id'] + '.mp4')) for i in o['items']): bad.append('offer clip missing')
print('FAIL ' + '; '.join(bad) if bad else 'PASS'); sys.exit(1 if bad else 0)
PY
echo "output kept for a look: $T/out"
