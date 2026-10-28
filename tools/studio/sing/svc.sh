#!/usr/bin/env bash
# Singing voice conversion with Seed-VC (local, free): the source singer's melody, rhythm and diction stay;
# the timbre becomes your character's voice.
# Usage: sing/svc.sh <source_vocals.wav> <target_voice.wav> <out.wav> [steps=50] [cfg=0.7] [semitones=0] [checkpoint] [config]
#   target_voice.wav: 10-30 s of clean speech or singing in the target voice (e.g. a TTS line in your character's voice).
#   semitones: shift if the source key does not suit the target voice (e.g. male song -> female voice: +12 or +5..+7).
set -euo pipefail
SRC=$(cd "$(dirname "$1")" && pwd)/$(basename "$1"); TGT=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
OUT_DIR=$(cd "$(dirname "$3")" && pwd); OUT=$OUT_DIR/$(basename "$3")
STEPS=${4:-50}; CFG=${5:-0.7}; SHIFT=${6:-0}; CKPT=${7:-}; CONF=${8:-}
SEEDVC_DIR=${SEEDVC_DIR:-$HOME/seed-vc}
PY=${SEEDVC_PY:-$SEEDVC_DIR/.venv/bin/python}
[ -f "$SEEDVC_DIR/inference.py" ] || { echo "✗ Seed-VC not found in $SEEDVC_DIR. Run: bash sing/setup.sh (or set SEEDVC_DIR)"; exit 2; }
TMP=$(mktemp -d)
EXTRA=()
[ -n "$CKPT" ] && EXTRA+=(--checkpoint "$CKPT")
[ -n "$CONF" ] && EXTRA+=(--config "$CONF")
cd "$SEEDVC_DIR"
PYTORCH_ENABLE_MPS_FALLBACK=1 "$PY" inference.py --source "$SRC" --target "$TGT" --output "$TMP" \
  --diffusion-steps "$STEPS" --inference-cfg-rate "$CFG" --f0-condition True --auto-f0-adjust False \
  --semi-tone-shift "$SHIFT" --fp16 False ${EXTRA[@]+"${EXTRA[@]}"}
mv "$TMP"/*.wav "$OUT" && rmdir "$TMP"
echo "✓ $OUT"
