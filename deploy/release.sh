#!/bin/bash
# On the server, as root: release.sh <version> (needs /tmp/livehost-<version>.tar.gz from ship.sh). Unpacks the app to
# releases/<version>, installs its packages, runs its tests with the server's node, backs up the settings, switches
# /opt/livehost/app atomically, restarts and checks health; any failure after the switch goes back to the previous
# version. Square scripts in the tarball (ops/) are copied over /opt/livehost/ops (venv kept). Keeps the last 10 releases.
set -euo pipefail
version="$1"; root=/opt/livehost; next="$root/releases/$version"; tarball="/tmp/livehost-$version.tar.gz"
[ -f "$tarball" ] || { echo "missing $tarball"; exit 1; }
[ ! -e "$next" ] || { echo 'that release already exists'; exit 1; }
previous=""; [ -L "$root/app" ] && previous="$(readlink -f "$root/app")"
stage=$(mktemp -d); trap 'rm -rf "$stage"' EXIT
tar -xzf "$tarball" -C "$stage"
mkdir -p "$next"; cp -a "$stage/app/." "$next/"
(cd "$next" && npm ci --no-audit --no-fund >/dev/null)
node --check "$next/server/index.mjs"
(cd "$next" && node --test test/*.test.mjs) > "/tmp/livehost-$version-tests.log" 2>&1 || { tail -30 "/tmp/livehost-$version-tests.log"; rm -rf "$next"; echo 'tests failed; nothing changed'; exit 1; }
grep -E '^ℹ (tests|pass|fail) ' "/tmp/livehost-$version-tests.log" || true
(cd "$next" && npm prune --omit=dev --no-audit --no-fund >/dev/null)
chown -R root:livehost "$next"; chmod -R g+rX,g-w,o-rwx "$next"
backup="$root/deploy-backups/$version"; mkdir -p "$backup"; chmod 700 "$backup"
cp -a /etc/livehost/livehost.env "$backup/"
[ -f /var/lib/livehost/data/square.json ] && cp -a /var/lib/livehost/data/square.json "$backup/" || true
if [ -d "$stage/ops" ]; then
  tar -C "$stage/ops" --exclude=venv --exclude=__pycache__ -cf - . | tar -C "$root/ops" -xf -
  chown -R root:root "$root/ops"
  install -o root -g root -m 644 "$stage"/ops/systemd/* /etc/systemd/system/ 2>/dev/null && systemctl daemon-reload || true
  echo "ops updated"
fi
rollback() {
  if [ -n "$previous" ] && [ -d "$previous" ]; then ln -sfn "$previous" "$root/rollback-link"; mv -Tf "$root/rollback-link" "$root/app"; systemctl restart livehost; echo 'activation failed; previous release restored'
  else systemctl stop livehost || true; echo 'activation failed; no previous release, service stopped'; fi
}
trap rollback ERR
ln -sfn "$next" "$root/next-link"; mv -Tf "$root/next-link" "$root/app"
systemctl restart livehost
port=$(sed -n 's/^PORT=\(.\)/\1/p' /etc/livehost/livehost.env | tail -1); port=${port:-4370}
for attempt in $(seq 40); do curl -fsS "http://127.0.0.1:$port/api/health" > /tmp/livehost-health.json 2>/dev/null && break; sleep 1; done
python3 -c "import json;x=json.load(open('/tmp/livehost-health.json'));assert x.get('mode'),x;print(json.dumps({k:x.get(k) for k in ('mode','avatar','onAir','routes')})[:600])"
for path in / /api/state; do curl -fsS -o /dev/null "http://127.0.0.1:$port$path"; done
trap - ERR
echo "$version" > "$root/VERSION"
cur=$(basename "$(readlink -f "$root/app")")
ls "$root/releases" | sort -V | head -n -10 | grep -vx "$cur" | while read -r old; do rm -rf -- "$root/releases/$old"; done
systemctl is-active livehost; readlink -f "$root/app"
