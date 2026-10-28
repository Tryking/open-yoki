#!/usr/bin/env bash
# macOS: run the after-live clipper every 6 hours as a LaunchAgent of the current user.
#   bash install-launchd.sh            install (or update; running it again just replaces the job)
#   bash install-launchd.sh --remove   uninstall
# INTERVAL (seconds, default 21600) and LABEL can be set in the environment.
# Note: launchd jobs cannot run scripts or read files under ~/Desktop, ~/Documents or ~/Downloads unless the binary has
# been given access in System Settings > Privacy & Security. Simplest: keep this repo and output_dir somewhere else
# (e.g. ~/open-yoki). The start script itself is copied to ~/Library/Application Support for the same reason.
set -euo pipefail
LABEL="${LABEL:-com.open-yoki.clips}"; INTERVAL="${INTERVAL:-21600}"
CLIPS="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"; SUPPORT="$HOME/Library/Application Support/open-yoki-clips"
STATE="$HOME/.open-yoki-clips"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "--remove" ]; then rm -f "$PLIST"; echo "removed $LABEL"; exit 0; fi
mkdir -p "$SUPPORT" "$STATE" "$(dirname "$PLIST")"
cp "$CLIPS/run.sh" "$SUPPORT/run.sh"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>Label</key><string>$LABEL</string>
 <key>ProgramArguments</key><array><string>/bin/bash</string><string>$SUPPORT/run.sh</string></array>
 <key>EnvironmentVariables</key><dict>
  <key>OPEN_YOKI_CLIPS_DIR</key><string>$CLIPS</string>
  <key>OPEN_YOKI_CLIPS_STATE</key><string>$STATE</string>
 </dict>
 <key>StartInterval</key><integer>$INTERVAL</integer>
 <key>LowPriorityIO</key><true/>
 <key>Nice</key><integer>10</integer>
 <key>StandardOutPath</key><string>$STATE/launchd.out</string>
 <key>StandardErrorPath</key><string>$STATE/launchd.err</string>
</dict></plist>
PL
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL (every $INTERVAL s). Log: $STATE/run.log   Run now: launchctl kickstart gui/$(id -u)/$LABEL"
