#!/usr/bin/env bash
# Set up the after-live clipper: a Python virtualenv with Pillow next to after_live.py, and config.json from the example.
# Needs: python3 (3.9+), ffmpeg, rsync. Optional: openai-whisper (pip install openai-whisper) to line the journal up
# with the replay.
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
for t in python3 ffmpeg ffprobe rsync; do command -v "$t" >/dev/null || { echo "missing: $t"; exit 1; }; done
[ -d "$D/.venv" ] || python3 -m venv "$D/.venv"
"$D/.venv/bin/pip" install -q -r "$D/../requirements.txt"
[ -f "$D/config.json" ] || { cp "$D/config.example.json" "$D/config.json"; echo "created $D/config.json: edit it"; }
echo "ok. Try: $D/.venv/bin/python $D/after_live.py pull   then install a timer from scheduler/"
