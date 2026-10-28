#!/usr/bin/env bash
# One-time local setup for singing voice conversion (free, runs on your own machine).
# Installs Seed-VC (https://github.com/Plachta/seed-vc) into $SEEDVC_DIR with its own Python venv, plus demucs for
# splitting vocals from the backing track. Model weights download from Hugging Face on first use (~2 GB).
# Usage: SEEDVC_DIR=~/seed-vc bash sing/setup.sh
set -euo pipefail
SEEDVC_DIR=${SEEDVC_DIR:-$HOME/seed-vc}
PY=${PYTHON_BIN:-python3.10}
command -v "$PY" >/dev/null || { echo "✗ need $PY (Seed-VC is tested on Python 3.10). Set PYTHON_BIN to another 3.10/3.11 interpreter."; exit 1; }
command -v ffmpeg >/dev/null || { echo "✗ need ffmpeg"; exit 1; }
[ -d "$SEEDVC_DIR/.git" ] || git clone --depth 1 https://github.com/Plachta/seed-vc "$SEEDVC_DIR"
cd "$SEEDVC_DIR"
[ -d .venv ] || "$PY" -m venv .venv
REQ=requirements.txt; [ "$(uname)" = "Darwin" ] && [ -f requirements-mac.txt ] && REQ=requirements-mac.txt
.venv/bin/pip install -U pip >/dev/null
.venv/bin/pip install -r "$REQ"
.venv/bin/pip install demucs soundfile librosa
echo "✓ Seed-VC ready in $SEEDVC_DIR"
echo "  Optional: RVC via Applio (https://github.com/IAHispano/Applio) if you want to train your own voice model; set APPLIO_DIR."
