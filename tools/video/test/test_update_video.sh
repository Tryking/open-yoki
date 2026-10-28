#!/usr/bin/env bash
# End-to-end check of update-video/render.py with generated media only (solid-colour clips, sine tones, silence).
# Renders the example storyboard into /tmp and checks the result: duration 30-60 s, 1920x1080 (16:9), an audio track,
# loudness near -14 LUFS. Nothing is written inside the package.
#   bash test/test_update_video.sh            (PYTHON=/path/to/python3 to pick an interpreter that has Pillow)
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PY="${PYTHON:-python3}"
T="${VIDEO_TEST_DIR:-/tmp/open-yoki-video-test}/update"; rm -rf "$T"; mkdir -p "$T"
A="$T/assets"; mkdir -p "$A"/{clips,images,music,sfx,voice}
"$PY" -c 'import PIL' 2>/dev/null || { echo "Pillow missing for $PY (pip install -r requirements.txt)"; exit 1; }
f() { ffmpeg -v error -y -nostdin "$@"; }
mp3() { if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libmp3lame; then f "$@" -c:a libmp3lame -b:a 128k -f mp3 "$OUT"; else f "$@" -f wav "$OUT"; fi; }

echo "fixtures -> $A"
# a landscape clip (grey-blue, 440 Hz) and a portrait clip (dark green, 660 Hz) to exercise the blurred fill
f -f lavfi -i "color=c=0x30506a:s=1280x720:r=30:d=8" -f lavfi -i "sine=f=440:d=8:sample_rate=48000" \
  -vf "drawbox=x=80:y=480:w=1120:h=180:color=white@0.25:t=fill" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$A/clips/before.mp4"
f -f lavfi -i "color=c=0x1e5a3c:s=720x1280:r=30:d=8" -f lavfi -i "sine=f=660:d=8:sample_rate=48000" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$A/clips/after.mp4"
f -f lavfi -i "color=c=0x6a4a20:s=800x900" -frames:v 1 "$A/images/screenshot.png"
f -f lavfi -i "color=c=0xd0a040:s=512x512" -frames:v 1 "$A/images/avatar.png"
# music: quiet tones of different pitch; voice: a 4 s tone; sfx: short blips
for m in intro:330 sad:220 upbeat:523 bright:392; do OUT="$A/music/${m%%:*}.mp3" mp3 -f lavfi -i "sine=f=${m##*:}:d=40:sample_rate=48000"; done
f -f lavfi -i "sine=f=880:d=4:sample_rate=48000" -af "volume=0.5" "$A/voice/line1.wav"
for s in click:1200:0.05 confirm:990:0.2 error:180:0.3 boom:60:0.5 whoosh:2000:0.3; do
  IFS=: read -r n hz d <<<"$s"; f -f lavfi -i "sine=f=$hz:d=$d:sample_rate=48000" "$A/sfx/$n.wav"; done

echo "render"
"$PY" "$HERE/update-video/render.py" "$HERE/update-video/storyboard.example.json" --assets "$A" --out "$T/update.mp4"
"$PY" "$HERE/update-video/render.py" "$HERE/update-video/storyboard.example.json" --assets "$A" --still before@2 --out "$T/still-before.png"

echo "check"
"$PY" - "$T/update.mp4" <<'PY'
import json, re, subprocess, sys
p = sys.argv[1]
j = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height',
                               '-of', 'json', p], capture_output=True, text=True, check=True).stdout)
dur = float(j['format']['duration']); v = [s for s in j['streams'] if s['codec_type'] == 'video'][0]
audio = [s for s in j['streams'] if s['codec_type'] == 'audio']
ln = subprocess.run(['ffmpeg', '-nostdin', '-i', p, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
lufs = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', ln)[-1])
print(f'duration {dur:.2f}s  size {v["width"]}x{v["height"]}  audio tracks {len(audio)}  loudness {lufs} LUFS')
ok = 30 <= dur <= 60 and (v['width'], v['height']) == (1920, 1080) and len(audio) == 1 and abs(lufs + 14) <= 1.0
print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
PY
echo "output kept for a look: $T/update.mp4  $T/still-before.png"
