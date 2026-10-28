#!/usr/bin/env bash
# Run both end-to-end tests. Output goes to /tmp/open-yoki-video-test/ (VIDEO_TEST_DIR to change), never into the package.
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
bash "$D/test_update_video.sh"
bash "$D/test_clips.sh"
echo "all video tests passed"
