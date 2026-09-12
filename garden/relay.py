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


def push(payload: dict, token: str) -> None:
    body = json.dumps(payload, separators=(",", ":")).encode()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "olive-relay",
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

    req_body = {
        "message": f"olive {time.strftime('%Y-%m-%d %H:%M:%SZ', time.gmtime())}",
        "content": base64.b64encode(body).decode(),
        "branch": BRANCH,
    }
    if sha:
        req_body["sha"] = sha

    req = urllib.request.Request(
        f"{API}/repos/{REPO}/contents/{PATH}",
        data=json.dumps(req_body).encode(),
        headers={**headers, "Content-Type": "application/json"},
        method="PUT")
    with urllib.request.urlopen(req, timeout=30) as r:
        r.read()


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
    args = ap.parse_args()

    if not args.out and not args.push:
        ap.error("nothing to do: pass --out, --push, or both")

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

    return 0


if __name__ == "__main__":
    sys.exit(main())
