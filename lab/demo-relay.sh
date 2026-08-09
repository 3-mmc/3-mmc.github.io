#!/usr/bin/env bash
# Publish readings straight into this repo, for a short run.
#
# The full setup in README.md sends data to its own repo via a token, which is
# right for something left running: it keeps thousands of commits out of a repo
# that holds actual work. For an afternoon that machinery is not worth it —
# pushing here needs no second repo and no token, and thirty commits squash
# down to nothing afterwards.
#
#   ./lab/demo-relay.sh                 # 6 hours, every 10 minutes
#   HOURS=2 INTERVAL=300 ./lab/demo-relay.sh
#
# Stops on its own at the deadline. A run left forgotten is the failure mode
# worth designing against, not a run cut short.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="lab/data/humidity.json"
INTERVAL="${INTERVAL:-600}"
HOURS="${HOURS:-6}"
DEVICE="${HUMIDITY_DEVICE:-http://192.168.1.169}"

cd "$REPO" || exit 1

deadline=$(( $(date +%s) + $(python3 -c "print(int(float('$HOURS')*3600))") ))
n=0; pushed=0; failed=0

echo "relay: publishing $DEVICE -> $DATA"
echo "relay: every ${INTERVAL}s until $(date -d "@$deadline" '+%H:%M:%S') ($HOURS h)"
echo "relay: page at https://3-mmc.github.io/lab/"
echo "relay: stop with  kill $$"
echo

while [ "$(date +%s)" -lt "$deadline" ]; do
  n=$(( n + 1 ))

  if ! python3 lab/relay.py --device "$DEVICE" --out "$DATA" >/dev/null 2>&1; then
    # The board being briefly unreachable is a transient, not a reason to stop:
    # the page keeps showing the last good copy and ages it honestly.
    failed=$(( failed + 1 ))
    echo "$(date '+%H:%M:%S')  [$n] board unreachable, keeping last copy"
  elif git diff --quiet -- "$DATA"; then
    echo "$(date '+%H:%M:%S')  [$n] unchanged"
  else
    # Explicit pathspec throughout. A bare `git commit -a` here would sweep up
    # whatever else happens to be in the working tree at the time.
    git add -- "$DATA"
    git commit -q -m "Update humidity snapshot" -- "$DATA"
    if git push -q origin HEAD 2>/dev/null; then
      pushed=$(( pushed + 1 ))
      echo "$(date '+%H:%M:%S')  [$n] pushed  $(python3 -c "
import json; d=json.load(open('$DATA'))['latest']
print(f\"{d['rh_pct']:.1f}%RH {d['temp_c']:.1f}C\")" 2>/dev/null)"
    else
      # Leave the commit in place; the next cycle pushes it along with the new
      # one. Nothing is lost by a failed push here.
      failed=$(( failed + 1 ))
      echo "$(date '+%H:%M:%S')  [$n] push failed, will retry next cycle"
    fi
  fi

  remaining=$(( deadline - $(date +%s) ))
  [ "$remaining" -le 0 ] && break
  sleep "$(( remaining < INTERVAL ? remaining : INTERVAL ))"
done

echo
echo "relay: done — $n cycles, $pushed pushed, $failed failed"
echo "relay: the page now shows the last copy, ageing as a Snapshot"
echo "relay: squash the run with  git rebase -i HEAD~$pushed"
