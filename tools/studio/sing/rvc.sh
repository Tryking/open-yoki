#!/usr/bin/env bash
# Alternative: RVC conversion through Applio (local). Needs a trained voice model (.pth + .index) of the target voice.
# Usage: sing/rvc.sh <source_vocals.wav> <model.pth> <model.index> <out.wav> [pitch=0] [index_rate=0.5] [protect=0.33]
set -euo pipefail
IN=$(cd "$(dirname "$1")" && pwd)/$(basename "$1"); PTH=$2; IDX=$3
OUT=$(cd "$(dirname "$4")" && pwd)/$(basename "$4"); P=${5:-0}; IR=${6:-0.5}; PR=${7:-0.33}
APPLIO_DIR=${APPLIO_DIR:-$HOME/Applio}
[ -f "$APPLIO_DIR/core.py" ] || { echo "✗ Applio not found in $APPLIO_DIR (https://github.com/IAHispano/Applio); set APPLIO_DIR"; exit 2; }
cd "$APPLIO_DIR"
PYTORCH_ENABLE_MPS_FALLBACK=1 .venv/bin/python core.py infer --input-path "$IN" --output-path "$OUT" --pth-path "$PTH" --index-path "$IDX" \
  --pitch "$P" --index-rate "$IR" --protect "$PR" --f0-method rmvpe --volume-envelope 1 --export-format WAV --embedder-model contentvec
echo "✓ $OUT"
