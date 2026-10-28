#!/bin/bash
# Between-shows radio, one short report: is it up, how many answers, restarts and errors in the last N minutes.
# Run on the main server: bash ops/radio-check.sh [minutes, default 35]
# Settings: PORT (default 4370), DATA_DIR (default /var/lib/livehost/data), UNIT (default livehost)
M=${1:-35}; PORT=${PORT:-4370}; DATA=${DATA_DIR:-/var/lib/livehost/data}; UNIT=${UNIT:-livehost}
echo "== health"
curl -s "localhost:$PORT/api/health" | python3 -c '
import json,sys; j=json.load(sys.stdin)
print("radio", j.get("radio"), "| square online", (j.get("square") or {}).get("online"), "| voice rmb today", (j.get("voice") or {}).get("rmbToday"))'
L=$(journalctl -u "$UNIT" --since "-${M}min" --no-pager -o cat)
echo "== last ${M} min"
echo "answers: $(grep -c '^radio answer' <<<"$L")  idle lines: $(ls -t "$DATA"/audio/radio-*.mp3 2>/dev/null | head -50 | xargs -r stat -c %Y | awk -v t=$(date +%s) -v m=$M '$1>t-m*60' | wc -l) voice files"
echo "restarts: $(grep -c 'radio feed starting' <<<"$L")  feed errors: $(grep -cE 'radio (tick|page error)|no picture for|ffmpeg exited|restart failed' <<<"$L")"
echo "budget: $(grep -c 'daily voice budget used up' <<<"$L")  voice failed: $(grep -c 'radio page: voice failed' <<<"$L")"
grep -E '^radio answer' <<<"$L" | tail -8 | cut -c1-240
grep -E 'radio (tick|page error|page: voice failed)|no picture for|ffmpeg exited' <<<"$L" | tail -5 | cut -c1-200
