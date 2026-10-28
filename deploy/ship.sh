#!/bin/bash
# On your own computer: test, pack and release a new version to the server.
#   LIVEHOST_SSH=root@your-server bash deploy/ship.sh <version>
# Runs the app tests here first, packs app/ (no node_modules, data or keys) and ops/, uploads it and runs
# /opt/livehost/release.sh on the server, which tests again before switching. First install: deploy/install.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
host=${LIVEHOST_SSH:?set LIVEHOST_SSH=user@host}
version=${1:?usage: LIVEHOST_SSH=user@host bash deploy/ship.sh <version>}
(cd app && npm test >/dev/null 2>&1) || { echo 'local tests failed'; exit 1; }
tarball="/tmp/livehost-$version.tar.gz"
COPYFILE_DISABLE=1 tar --exclude='app/node_modules' --exclude='app/data' --exclude='.env*' --exclude='*.key' --exclude='*.pem' \
  --exclude='ops/venv' --exclude='__pycache__' -czf "$tarball" app ops
# never data or keys
tar -tzf "$tarball" | grep -Eq '(^|/)(data|\.env[^/]*|[^/]*\.key|[^/]*\.pem|\.credentials)(/|$)' && { echo 'unexpected files in tarball'; exit 1; }
du -h "$tarball"
scp -q "$tarball" "$host:/tmp/"
ssh -o BatchMode=yes "$host" "bash /opt/livehost/release.sh '$version'"
