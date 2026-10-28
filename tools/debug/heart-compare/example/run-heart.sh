#!/bin/sh
# Example adapter: run ONE beat of your heart against the scratch home in $HEART_HOME.
# Replace the line below with however your heart runs a single beat; it must read the beat lines from stdin
# and print what the heart said / wrote as its note. Keys come from your own environment.
echo "replace run-heart.sh with your own one-beat command" >&2; exit 1
# e.g.: exec node /path/to/your/app/heart-once.mjs --home "$HEART_HOME" --state "$HEART_STATE"
