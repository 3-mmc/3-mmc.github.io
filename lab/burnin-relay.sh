#!/usr/bin/env bash
# Publish readings to the data repo for a long run — sized for a sensor burn-in.
#
# Unlike demo-relay.sh, which commits into this repo for an afternoon, this
# pushes to 3-mmc/humidity-data via the Contents API. Over 48 hours at ten
# minute intervals that is ~290 writes: far too many to put in front of real
# work in the site repo, and each one there would also trigger a Pages rebuild
# for a file Pages does not even serve.
#
#   ./lab/burnin-relay.sh                    # 48 hours, every 10 minutes
#   HOURS=6 INTERVAL=300 ./lab/burnin-relay.sh
#
# The token is taken from the gh CLI rather than a stored PAT, so nothing
# secret is written to disk. It is only ever in this process's environment.
#
# Stops on its own at the deadline. A run left forgotten is the failure mode
# worth designing against, not a run cut short.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERVAL="${INTERVAL:-600}"
HOURS="${HOURS:-48}"
DEVICE="${HUMIDITY_DEVICE:-http://192.168.1.16}"

cd "$REPO" || exit 1

if ! HUMIDITY_RELAY_TOKEN="$(gh auth token 2>/dev/null)" || [ -z "$HUMIDITY_RELAY_TOKEN" ]; then
  echo "relay: no gh token available; run 'gh auth login'" >&2
  exit 2
fi
export HUMIDITY_RELAY_TOKEN

deadline=$(( $(date +%s) + $(python3 -c "print(int(float('$HOURS')*3600))") ))
n=0; pushed=0; failed=0

echo "relay: $DEVICE -> 3-mmc/humidity-data"
echo "relay: every ${INTERVAL}s until $(date -d "@$deadline" '+%a %d %b %H:%M') ($HOURS h)"
echo "relay: page at https://3-mmc.github.io/lab/"
echo "relay: pid $$ — stop with  kill $$"
echo

while [ "$(date +%s)" -lt "$deadline" ]; do
  n=$(( n + 1 ))
  out="$(python3 lab/relay.py --device "$DEVICE" --push 2>&1)"
  if [ $? -eq 0 ]; then
    pushed=$(( pushed + 1 ))
    echo "$(date '+%m-%d %H:%M:%S')  [$n] ${out#relay: }"
  else
    # The board being briefly unreachable is a transient, not a reason to
    # stop: the page keeps showing the last copy and ages it honestly.
    failed=$(( failed + 1 ))
    echo "$(date '+%m-%d %H:%M:%S')  [$n] failed: ${out#relay: }"
  fi

  remaining=$(( deadline - $(date +%s) ))
  [ "$remaining" -le 0 ] && break
  sleep "$(( remaining < INTERVAL ? remaining : INTERVAL ))"
done

echo
echo "relay: done — $n cycles, $pushed pushed, $failed failed"
echo "relay: the page now ages its last copy as Stale, then Snapshot"
