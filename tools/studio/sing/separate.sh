#!/usr/bin/env bash
# Split a song into vocals + backing track with demucs (htdemucs_ft, best quality we tried). Local, free.
# Usage: sing/separate.sh <song.mp3> <outdir> [from_sec] [to_sec]
# Output: <outdir>/vocals.wav, <outdir>/no_vocals.wav (cut to the range if given)
set -euo pipefail
SONG=$1; OUT=$2; FROM=${3:-}; TO=${4:-}
SEEDVC_DIR=${SEEDVC_DIR:-$HOME/seed-vc}
PY=${DEMUCS_PY:-$SEEDVC_DIR/.venv/bin/python}
mkdir -p "$OUT"
SRC="$OUT/src.wav"
if [ -n "$FROM" ] && [ -n "$TO" ]; then ffmpeg -v error -y -ss "$FROM" -to "$TO" -i "$SONG" -ac 2 -ar 44100 "$SRC"; else ffmpeg -v error -y -i "$SONG" -ac 2 -ar 44100 "$SRC"; fi
"$PY" -m demucs --two-stems=vocals -n htdemucs_ft -o "$OUT/demucs" "$SRC"
cp "$OUT/demucs/htdemucs_ft/src/vocals.wav" "$OUT/vocals.wav"
cp "$OUT/demucs/htdemucs_ft/src/no_vocals.wav" "$OUT/no_vocals.wav"
echo "✓ $OUT/vocals.wav  $OUT/no_vocals.wav"
echo "  Listen to vocals.wav first: backing vocals and ad-libs stay in it and will be converted too. Cut or mute them before svc.sh."
