#!/usr/bin/env bash
# Linux: install the after-live clipper as a systemd *user* timer (no root needed).
#   bash install-systemd.sh            install / update
#   bash install-systemd.sh --remove   uninstall
# To keep it running while you are logged out: sudo loginctl enable-linger "$USER"
set -euo pipefail
CLIPS="$(cd "$(dirname "$0")/.." && pwd)"; U="$HOME/.config/systemd/user"
if [ "${1:-}" = "--remove" ]; then
  systemctl --user disable --now open-yoki-clips.timer 2>/dev/null || true
  rm -f "$U/open-yoki-clips.service" "$U/open-yoki-clips.timer"; systemctl --user daemon-reload; echo removed; exit 0
fi
mkdir -p "$U"
sed "s|@CLIPS_DIR@|$CLIPS|g" "$CLIPS/scheduler/systemd/open-yoki-clips.service" > "$U/open-yoki-clips.service"
cp "$CLIPS/scheduler/systemd/open-yoki-clips.timer" "$U/open-yoki-clips.timer"
systemctl --user daemon-reload
systemctl --user enable --now open-yoki-clips.timer
echo "installed. Status: systemctl --user list-timers open-yoki-clips.timer   Run now: systemctl --user start open-yoki-clips.service"
