#!/usr/bin/env python3
"""Copy the ESP32-C3 logger's current readings out to a public JSON file.

The board sits on the LAN with no public address, and GitHub Pages is static,
so the /lab/ page cannot talk to the sensor directly. This bridges the two: it
runs somewhere that can see the board (the Pi), and publishes a snapshot the
public page can fetch.

Two modes, same output either way:

    python3 relay.py --out lab/data/humidity.json     # write a local file
    python3 relay.py --push                           # publish to GitHub

--push uses the GitHub Contents API rather than git, so the host needs no
clone, no SSH key and no working tree — just a token in the environment:

    export HUMIDITY_RELAY_TOKEN=github_pat_...

Use a fine-grained token scoped to the data repo alone with Contents: write.
It can commit to that one repo and nothing else, which is why the data lives in
its own repo instead of in the site repo.

Stdlib only, so the Pi needs nothing installed.
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_DEVICE = "http://192.168.1.169"

# The chart is ~640 px wide, so more points than this buy nothing visible while
# making the file the public page downloads bigger. The board's full ring is
# 2880 samples; this keeps the shape and drops roughly three quarters of it.
MAX_POINTS = 720

# Where --push writes. Deliberately not the site repo: this file changes every
# few minutes, and that churn does not belong in the history of a repo that
# holds actual work.
REPO = "3-mmc/humidity-data"
PATH = "humidity.json"
BRANCH = "main"

API = "https://api.github.com"


def get_json(url: str, timeout: int = 15, headers: dict | None = None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def thin(samples: list, cap: int) -> list:
    """Reduce to at most `cap` points by even stride, always keeping the last.

    The newest sample is what the page displays as the current reading, so it
    must survive thinning even when the stride would step over it.
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

    samples = thin(history.get("samples", []), MAX_POINTS)

    return {
        "schema": 1,
        # When the relay read the board, in epoch ms. The page shows staleness
        # against this, not against the sample timestamp: a mirror is only ever
        # as fresh as its last copy, and saying otherwise would be a lie.
        "fetched_at": int(time.time() * 1000),
        "device": "esp32c3-humidity",
        "synced": bool(latest.get("synced")),
        "latest": {
            "ts": latest["ts"],
            "temp_c": latest["temp_c"],
            "rh_pct": latest["rh_pct"],
            "dew_point_c": latest["dew_point_c"],
            "abs_hum_g_m3": latest["abs_hum_g_m3"],
            "count": latest.get("count", 0),
        },
        "samples": samples,
    }


def push(payload: dict, token: str) -> None:
    body = json.dumps(payload, separators=(",", ":")).encode()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "humidity-relay",
    }

    # The API needs the blob being replaced, or it refuses the write. A missing
    # file is the first run, not an error.
    try:
        sha = get_json(f"{API}/repos/{REPO}/contents/{PATH}?ref={BRANCH}",
                       headers=headers).get("sha")
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        sha = None

    payload_req = {
        "message": f"humidity {time.strftime('%Y-%m-%d %H:%M:%SZ', time.gmtime())}",
        "content": base64.b64encode(body).decode(),
        "branch": BRANCH,
    }
    if sha:
        payload_req["sha"] = sha

    req = urllib.request.Request(
        f"{API}/repos/{REPO}/contents/{PATH}",
        data=json.dumps(payload_req).encode(),
        headers={**headers, "Content-Type": "application/json"},
        method="PUT")
    with urllib.request.urlopen(req, timeout=30) as r:
        r.read()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--device", default=os.environ.get("HUMIDITY_DEVICE", DEFAULT_DEVICE),
                    help=f"base URL of the board (default {DEFAULT_DEVICE})")
    ap.add_argument("--out", help="write the snapshot to this path")
    ap.add_argument("--push", action="store_true",
                    help=f"publish to {REPO}/{PATH}")
    args = ap.parse_args()

    if not args.out and not args.push:
        ap.error("nothing to do: pass --out, --push, or both")

    try:
        payload = build(args.device)
    except Exception as e:
        # Exit non-zero but quietly-ish: under a systemd timer this is a
        # transient the next run will fix, not something to page anyone about.
        print(f"relay: cannot read {args.device}: {e}", file=sys.stderr)
        return 1

    if args.out:
        with open(args.out, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        print(f"relay: wrote {args.out} "
              f"({payload['latest']['rh_pct']:.1f}%RH, {len(payload['samples'])} pts)")

    if args.push:
        token = os.environ.get("HUMIDITY_RELAY_TOKEN")
        if not token:
            print("relay: HUMIDITY_RELAY_TOKEN is not set", file=sys.stderr)
            return 2
        try:
            push(payload, token)
        except Exception as e:
            print(f"relay: push failed: {e}", file=sys.stderr)
            return 1
        print(f"relay: pushed {payload['latest']['rh_pct']:.1f}%RH to {REPO}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
