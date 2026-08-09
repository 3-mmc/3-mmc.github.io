#!/usr/bin/env python3
"""Regenerate lab/fonts/*.woff2.

The lab page follows the Nothing design system, which calls for Doto, Space
Grotesk and Space Mono. Google's CSS API does the subsetting via its `text=`
parameter, so no local font tooling is needed.

These are deliberately NOT shared with /djs/fonts/, even though the families
overlap. A subset contains only the glyphs one page asked for, so sharing files
across pages means editing the copy on one page can silently blank a character
on the other. Each page owns its own subset; the duplication is ~60 kB.

Run again if the page starts using characters outside the sets below —
otherwise they render in the fallback font.

    python3 lab/fetch_fonts.py
"""

import re
import urllib.parse
import urllib.request
from pathlib import Path

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
LOWER = "abcdefghijklmnopqrstuvwxyz"
DIGITS = "0123456789"
PUNCT = " .,:;%/+-()[]<>'\"_=*#·°³→—●"

# Weight budget is deliberately tight: the design system allows two weights per
# screen, and every extra weight is another woff2 to download.
JOBS = [
    ("Doto", "wght@600", DIGITS + ".-", "doto"),
    ("Space+Mono", "wght@400", UPPER + DIGITS + PUNCT, "mono"),
    ("Space+Grotesk", "wght@300;500", UPPER + LOWER + DIGITS + PUNCT, "grotesk"),
]

OUT = Path(__file__).resolve().parent / "fonts"


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=30).read()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    faces, total = [], 0

    for family, axis, text, stem in JOBS:
        css = fetch(f"https://fonts.googleapis.com/css2?family={family}:{axis}"
                    f"&text={urllib.parse.quote(text)}").decode()
        for block in re.findall(r"@font-face\s*\{.*?\}", css, re.S):
            name = re.search(r"font-family:\s*'([^']+)'", block).group(1)
            weight = re.search(r"font-weight:\s*(\d+)", block).group(1)
            data = fetch(re.search(r"url\(([^)]+)\)", block).group(1))
            path = OUT / f"{stem}{weight}.woff2"
            path.write_bytes(data)
            total += len(data)
            faces.append((name, weight, path.name))
            print(f"  {name:15s} w{weight}  {len(data):6d} B -> {path.name}")

    print(f"\n{total} B of woff2 in {OUT}")
    print("\nPaste into the page's @font-face block if the set changed:\n")
    for name, weight, fname in faces:
        print(f"@font-face{{font-family:'{name}';font-style:normal;"
              f"font-weight:{weight};font-display:swap;"
              f"src:url(fonts/{fname}) format('woff2')}}")


if __name__ == "__main__":
    main()
