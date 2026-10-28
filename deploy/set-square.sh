#!/usr/bin/env bash
# Point the host's Binance Square feed at the RTMP address and stream key from Square's live console. Run on the server
# as root. No restart: while the host is on air the feed starts within 15 s of the file appearing. The key comes in on
# stdin so it stays out of the shell history. Any RTMP address works, not only Square's.
#   printf '%s' '<stream key>' | sudo bash deploy/set-square.sh rtmp://<address>/<app> [720x1280|1280x720]
#   sudo bash deploy/set-square.sh --clear      # stop pushing to Square
#   sudo bash deploy/set-square.sh --status
set -euo pipefail
DATA=${DATA_DIR:-/var/lib/livehost/data}; PORT=${PORT:-4370}
FILE=$DATA/square.json
case "${1:-}" in
  --clear) rm -f "$FILE" && echo cleared; exit 0 ;;
  --status) curl -s "http://127.0.0.1:$PORT/api/health" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("square"))'; exit 0 ;;
  rtmp://*|rtmps://*) ;;
  *) echo "usage: printf '%s' KEY | $0 rtmp://ADDRESS [WxH] | --clear | --status" >&2; exit 1 ;;
esac
URL=$1 SIZE=${2:-720x1280}
KEY=$(cat)
[ -n "$KEY" ] || { echo 'no key on stdin' >&2; exit 1; }
URL="$URL" SIZE="$SIZE" KEY="$KEY" python3 -c 'import json,os;print(json.dumps({"url":os.environ["URL"],"key":os.environ["KEY"],"size":os.environ["SIZE"]}))' \
  | install -m 600 -o livehost -g livehost /dev/stdin "$FILE" && echo saved
