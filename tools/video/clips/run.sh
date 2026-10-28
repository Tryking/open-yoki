#!/usr/bin/env bash
# One run of the after-live clipper, for a timer (launchd / systemd) or by hand. Skips if a run is still going
# (stale lock after 3 h). Log: $STATE/run.log. Settings come from config.json next to after_live.py, or
# OPEN_YOKI_CLIPS_CONFIG / OPEN_YOKI_CLIPS_DIR in the environment (the timer files set them).
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
D="${OPEN_YOKI_CLIPS_DIR:-$(cd "$(dirname "$0")" && pwd)}"
STATE="${OPEN_YOKI_CLIPS_STATE:-$HOME/.open-yoki-clips}"; mkdir -p "$STATE"
PY="$D/.venv/bin/python"; [ -x "$PY" ] || PY="$(command -v python3)"
LOCK="$STATE/lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  # stale lock: older than 3 hours
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +180 2>/dev/null)" ]; then rm -rf "$LOCK"; mkdir "$LOCK"; else exit 0; fi
fi
trap 'rm -rf "$LOCK"' EXIT
"$PY" "$D/after_live.py" ${OPEN_YOKI_CLIPS_CONFIG:+--config "$OPEN_YOKI_CLIPS_CONFIG"} pull >>"$STATE/run.log" 2>&1
