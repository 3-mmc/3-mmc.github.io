#!/usr/bin/env python3
"""Copy the olive monitor's current readings out to a public JSON file.

The board sits on the LAN with no public address, and GitHub Pages is static,
so /garden/ cannot talk to it directly. This bridges the two: it runs somewhere
that can see the board and publishes a snapshot the public page fetches.

Two modes, same output either way:

    python3 relay.py --out garden/data/olive.json     # write a local file
    python3 relay.py --push                           # publish to GitHub

--push uses the GitHub Contents API rather than git, so the host needs no
clone, no SSH key and no working tree - just a token in the environment:

    export OLIVE_RELAY_TOKEN=github_pat_...

Use a fine-grained token scoped to the data repo alone with Contents: write.
It can commit to that one repo and nothing else, which is why the data lives in
its own repo instead of in the site repo.

Stdlib only, so a Pi needs nothing installed.
"""

import argparse
import base64
import json
import math
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

DEFAULT_DEVICE = "http://192.168.1.205"

# The history chart is a few hundred pixels wide, so more points than this buy
# nothing visible while making the file the public page downloads bigger. The
# board's ring is 2880 samples.
MAX_POINTS = 720

# Deliberately not the site repo: this file changes every few minutes, and that
# churn does not belong in the history of a repo that holds actual work.
REPO = "3-mmc/olive-data"
PATH = "olive.json"
BRANCH = "main"

# The live snapshot is overwritten every run, so nothing accumulates in it. The
# archive is the other half: one CSV per UTC day, appended to, kept forever.
# The board's ring holds 48 hours, which is shorter than a single drydown
# cycle, so anything that wants to model how this pot actually behaves - how
# fast it dries, against what vapour pressure deficit - has to read it here.
#
# Only rows carrying a fresh soil measurement are archived. The board reads the
# probe every 15 minutes and holds the value between reads, so archiving every
# sample would repeat each reading fifteen times and say nothing extra.
ARCHIVE_DIR = "archive"
ARCHIVE_COLUMNS = "ts_ms,iso_utc,temp_c,rh_pct,vpd_kpa,soil_mv,soil_pct"

API = "https://api.github.com"


def get_json(url: str, timeout: int = 15, headers: dict | None = None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def thin(samples: list, cap: int) -> list:
    """Reduce to at most `cap` points by even stride, always keeping the last.

    The newest sample is what the page shows as the current reading, so it must
    survive thinning even when the stride would step over it.
    """
    if len(samples) <= cap:
        return samples
    stride = len(samples) / cap
    out = [samples[int(i * stride)] for i in range(cap)]
    if out[-1] is not samples[-1]:
        out[-1] = samples[-1]
    return out


def build(device: str) -> dict:
    latest = get_json(f"{device}/api/latest")
    history = get_json(f"{device}/api/history")

    if not latest.get("ok"):
        raise RuntimeError("device reports no valid reading yet")

    history["samples"] = thin(history.get("samples", []), MAX_POINTS)

    return {
        "schema": 1,
        # When the relay read the board, in epoch ms. The page shows staleness
        # against this rather than against the sample timestamp: a mirror is
        # only ever as fresh as its last copy.
        "fetched_at": int(time.time() * 1000),
        "device": "esp32c3-olive",
        # Passed through whole, so the mirror gains whatever the board gains
        # without this script having to learn the fields. The page reads
        # history rows positionally and the board only ever appends columns.
        "latest": latest,
        "history": history,
    }


def vpd_kpa(temp_c, rh_pct):
    """Vapour pressure deficit, the honest driver of evaporation indoors.

    Computed here rather than read from the board because the history rows do
    not carry it - only the live reading does - and it is the column any
    drydown model wants. Magnus over water.
    """
    if temp_c is None or rh_pct is None:
        return None
    es = 0.6108 * math.exp(17.27 * temp_c / (temp_c + 237.3))
    return round(es * (1.0 - rh_pct / 100.0), 4)


def gh(path: str, token: str, method: str = "GET", body: dict | None = None):
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "olive-relay",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{API}/repos/{REPO}/{path}", data=data,
                                 headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
    return json.loads(raw) if raw else None


def get_file(path: str, token: str):
    """Returns (text, sha), or (None, None) when the file does not exist yet."""
    try:
        meta = gh(f"contents/{path}?ref={BRANCH}", token)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None, None
        raise
    return base64.b64decode(meta["content"]).decode(), meta["sha"]


def put_file(path: str, text: str, sha: str | None, token: str,
             message: str) -> None:
    body = {
        "message": message,
        "content": base64.b64encode(text.encode()).decode(),
        "branch": BRANCH,
    }
    if sha:
        body["sha"] = sha
    gh(f"contents/{path}", token, method="PUT", body=body)


def archive(payload: dict, token: str) -> str:
    """Append this run's fresh soil readings to the per-day CSVs."""
    hist = payload["history"]
    if not hist.get("synced"):
        # Timestamps are uptime until SNTP lands, so they would file under
        # 1970 and never line up with the rows around them.
        return "clock not synced, nothing archived"

    cols = {name: i for i, name in enumerate(hist.get("columns", []))}
    need = ("ts", "temp_c", "rh_pct", "soil_mv", "soil_pct", "soil_age_s")
    if any(c not in cols for c in need):
        return "history is missing columns this expects, nothing archived"

    by_day: dict[str, list[tuple]] = {}
    for s in hist.get("samples", []):
        if s[cols["soil_age_s"]] != 0:
            continue  # a held value, not a measurement
        ts = s[cols["ts"]]
        t, rh = s[cols["temp_c"]], s[cols["rh_pct"]]
        stamp = time.gmtime(ts / 1000)
        by_day.setdefault(time.strftime("%Y-%m-%d", stamp), []).append((
            ts,
            time.strftime("%Y-%m-%dT%H:%M:%SZ", stamp),
            t, rh, vpd_kpa(t, rh),
            s[cols["soil_mv"]], s[cols["soil_pct"]],
        ))

    written = 0
    for day, rows in sorted(by_day.items()):
        path = f"{ARCHIVE_DIR}/{day}.csv"
        text, sha = get_file(path, token)

        # Every run overlaps the last, because the board keeps 48 hours and
        # this runs every 15 minutes. Timestamps are the join key.
        last_ts = -1
        if text:
            for line in reversed(text.strip().splitlines()):
                head = line.split(",", 1)[0]
                if head.isdigit():
                    last_ts = int(head)
                    break
        else:
            text = ARCHIVE_COLUMNS + "\n"

        fresh = [r for r in sorted(rows) if r[0] > last_ts]
        if not fresh:
            continue
        text += "".join(
            ",".join("" if v is None else str(v) for v in r) + "\n"
            for r in fresh)
        put_file(path, text, sha, token, f"olive archive {day}")
        written += len(fresh)

    return f"archived {written} readings" if written else "archive already current"


def push(payload: dict, token: str) -> None:
    body = json.dumps(payload, separators=(",", ":"))
    _, sha = get_file(PATH, token)
    put_file(PATH, body, sha, token,
             f"olive {time.strftime('%Y-%m-%d %H:%M:%SZ', time.gmtime())}")


def resolve_token() -> str | None:
    """OLIVE_RELAY_TOKEN, or fall back to whatever `gh` is logged in with.

    The fallback is for a machine where someone already works on this repo: gh
    is authenticated there anyway, so borrowing its token adds no exposure that
    was not already present, and it means the relay runs without minting
    anything. On a box that only exists to run the relay, prefer the env var
    with a fine-grained token scoped to the data repo alone - gh's token can
    reach every repo the account can, which is far more than this needs.
    """
    token = os.environ.get("OLIVE_RELAY_TOKEN")
    if token:
        return token
    try:
        out = subprocess.run(["gh", "auth", "token"], capture_output=True,
                             text=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() or None if out.returncode == 0 else None


def describe(payload: dict) -> str:
    lt = payload["latest"]
    pct = lt.get("soil_pct")
    soil = f"{pct:.0f}% soil" if isinstance(pct, (int, float)) else "soil n/a"
    return f"{soil}, {len(payload['history'].get('samples', []))} pts"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--device", default=os.environ.get("OLIVE_DEVICE", DEFAULT_DEVICE),
                    help=f"base URL of the board (default {DEFAULT_DEVICE})")
    ap.add_argument("--out", help="write the snapshot to this path")
    ap.add_argument("--push", action="store_true", help=f"publish to {REPO}/{PATH}")
    ap.add_argument("--archive", action="store_true",
                    help=f"append fresh readings to {REPO}/{ARCHIVE_DIR}/")
    args = ap.parse_args()

    if not (args.out or args.push or args.archive):
        ap.error("nothing to do: pass --out, --push or --archive")

    try:
        payload = build(args.device)
    except Exception as e:
        # Exit non-zero but quietly: under a systemd timer this is a transient
        # the next run fixes, not something to page anyone about.
        print(f"relay: cannot read {args.device}: {e}", file=sys.stderr)
        return 1

    if args.out:
        with open(args.out, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        print(f"relay: wrote {args.out} ({describe(payload)})")

    if args.push:
        token = resolve_token()
        if not token:
            print("relay: no token: set OLIVE_RELAY_TOKEN, or log in with "
                  "`gh auth login`", file=sys.stderr)
            return 2
        try:
            push(payload, token)
        except Exception as e:
            print(f"relay: push failed: {e}", file=sys.stderr)
            return 1
        print(f"relay: pushed {describe(payload)} to {REPO}")

    if args.archive:
        token = resolve_token()
        if not token:
            print("relay: no token for --archive", file=sys.stderr)
            return 2
        try:
            print("relay: " + archive(payload, token))
        except Exception as e:
            # The snapshot is the part the page needs; a failed archive is
            # caught up by the next run, since the board keeps 48 hours.
            print(f"relay: archive failed: {e}", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
