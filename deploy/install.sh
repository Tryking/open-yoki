#!/usr/bin/env bash
# First install on a clean Ubuntu 22.04/24.04 server (x86_64). Run once as root from the package folder; safe to rerun.
#   sudo bash deploy/install.sh                       app + Square poster + services
#   sudo DOMAIN=example.com bash deploy/install.sh    also puts Caddy in front with HTTPS for that domain
# Installs: ffmpeg, Google Chrome (headless, draws the stream picture), Node.js 22, the Claude Code CLI (the host's
# heart), Caddy, a Python venv for ops/. Creates user livehost and these folders:
#   /opt/livehost/app (-> releases/<version>)   the Node server, read-only for the service
#   /opt/livehost/ops                           the Square poster and radio announcements (square_post.py, facts.py)
#   /etc/livehost/livehost.env, square.env      keys and settings (root 600)
#   /var/lib/livehost/{data,heart,heart-state,tap}
# Services are enabled, not started: fill the keys first (see SETUP.md).
set -euo pipefail
PKG="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PKG"
[ "$(id -u)" = 0 ] || { echo "run as root: sudo bash deploy/install.sh"; exit 1; }
[ "$(dpkg --print-architecture 2>/dev/null)" = amd64 ] || { echo "this server is $(dpkg --print-architecture 2>/dev/null || uname -m); Google Chrome needs x86_64 (amd64) Ubuntu"; exit 1; }
export DEBIAN_FRONTEND=noninteractive
echo "== 1/7 system packages"
apt-get update -qq
apt-get install -y -qq ffmpeg python3-venv python3-pip curl iproute2 fonts-noto-cjk ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null
echo "== 2/7 Google Chrome"
if ! command -v google-chrome >/dev/null; then
  curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb
  apt-get install -y -qq /tmp/chrome.deb >/dev/null; rm -f /tmp/chrome.deb
fi
echo "== 3/7 Node.js 22, Claude Code CLI"
if ! /usr/bin/node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
command -v claude >/dev/null || npm i -g @anthropic-ai/claude-code >/dev/null
echo "== 4/7 Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
echo "== 5/7 user, folders, app"
id livehost >/dev/null 2>&1 || useradd --system --home-dir /var/lib/livehost --shell /usr/sbin/nologin livehost
install -d -o root -g livehost -m 750 /opt/livehost /opt/livehost/releases
install -d -o root -g root -m 700 /opt/livehost/ops /opt/livehost/deploy-backups /etc/livehost
install -d -o livehost -g livehost -m 750 /var/lib/livehost /var/lib/livehost/data /var/lib/livehost/heart /var/lib/livehost/heart-state /var/lib/livehost/tap
if [ ! -e /opt/livehost/app ]; then
  v=install-$(date +%Y%m%d%H%M%S); next=/opt/livehost/releases/$v
  mkdir -p "$next"
  tar -C app --exclude=node_modules --exclude=data --exclude='.env*' -cf - . | tar -C "$next" -xf -
  (cd "$next" && npm ci --omit=dev --no-audit --no-fund >/dev/null)
  chown -R root:livehost "$next"; chmod -R g+rX,g-w,o-rwx "$next"
  ln -sfn "$next" /opt/livehost/app; echo "$v" > /opt/livehost/VERSION
else
  echo "   /opt/livehost/app already there: updates go through deploy/ship.sh + release.sh"
fi
install -o root -g root -m 700 deploy/release.sh /opt/livehost/release.sh
# the blank heart pages; the server copies them into an empty HEART_HOME on first start, with her name filled in
if [ -d heart-template ]; then
  rm -rf /opt/livehost/heart-template; cp -a heart-template /opt/livehost/heart-template
  chown -R root:livehost /opt/livehost/heart-template; chmod -R g+rX,g-w,o-rwx /opt/livehost/heart-template
fi
echo "== 6/7 Square poster"
tar -C ops --exclude=venv --exclude=__pycache__ -cf - . | tar -C /opt/livehost/ops -xf -
chown -R root:root /opt/livehost/ops
[ -x /opt/livehost/ops/venv/bin/python ] || python3 -m venv /opt/livehost/ops/venv
echo "== 7/7 settings and services"
if [ ! -f /etc/livehost/livehost.env ]; then
  install -o root -g root -m 600 .env.example /etc/livehost/livehost.env
  # paths of this install, and no going live by schedule until a test show has passed (delete ON_AIR=off then)
  printf '\n# written by install.sh\nPORT=4370\nHOST=127.0.0.1\nDATA_DIR=/var/lib/livehost/data\nHEART_HOME=/var/lib/livehost/heart\nHEART_STATE=/var/lib/livehost/heart-state\nHEART_TEMPLATE=/opt/livehost/heart-template\nON_AIR=off\n' >> /etc/livehost/livehost.env
  echo "   /etc/livehost/livehost.env written from .env.example (ON_AIR=off: no going live by schedule yet); fill the keys"
fi
if [ ! -f /etc/livehost/square.env ]; then
  install -o root -g root -m 600 /dev/null /etc/livehost/square.env
  printf '# Square poster (ops/conf.py lists every setting). Only what differs from the defaults is needed here.\n# SQUARE_OPENAPI_KEY=\n' > /etc/livehost/square.env
fi
chmod 600 /etc/livehost/livehost.env /etc/livehost/square.env
install -o root -g root -m 644 deploy/livehost.service deploy/livehost-tap-prune.service deploy/livehost-tap-prune.timer /etc/systemd/system/
install -o root -g root -m 644 ops/systemd/* /etc/systemd/system/
systemctl daemon-reload
systemctl enable livehost livehost-post.timer livehost-facts.timer livehost-tap-prune.timer >/dev/null
if [ -n "${DOMAIN:-}" ]; then
  install -d -m 755 /etc/caddy/sites
  sed "s#{{DOMAIN}}#$DOMAIN#g" deploy/livehost.caddy.template > /etc/caddy/sites/livehost.caddy
  grep -q '^import sites/\*' /etc/caddy/Caddyfile 2>/dev/null || printf '\nimport sites/*\n' >> /etc/caddy/Caddyfile
  # the stock Caddyfile serves a demo page on :80; that block would take the domain's port 80, so drop it
  sed -i '/^:80 {/,/^}/d' /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile >/dev/null && systemctl reload caddy && echo "   Caddy serves https://$DOMAIN once the domain points here"
fi
echo
echo "installed. next:"
echo "  1. fill the keys in /etc/livehost/livehost.env (see .env.example) and make your host (app/idols/example)"
echo "  2. systemctl start livehost livehost-post.timer livehost-facts.timer"
echo "  3. feed the room's chat in through the ingest API (README: Feeding chat in), go live with deploy/set-square.sh"
