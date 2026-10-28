#!/bin/sh
# Run every offline self-test. No network, no keys, no cost.
cd "$(dirname "$0")" || exit 1
fail=0
for t in capture/selftest.mjs line-lint/selftest.mjs model-blind/selftest.mjs mouth-compare/selftest.mjs heart-compare/selftest.mjs facts-align/selftest.mjs voice-audition/selftest.mjs; do
  node "$t" || { echo "FAILED: $t"; fail=1; }
done
for t in checkup/selftest.py frame-check/selftest.py distill-prep/selftest.py; do
  python3 "$t" || { echo "FAILED: $t"; fail=1; }
done
[ $fail = 0 ] && echo "all self-tests passed"
exit $fail
