# Building the club archive

The published site is `../djs/` — one HTML file and four fonts, no JSON fetched,
no CDN, no framework. It opens fine from `file://` too.

```
bash djs-build/publish.sh          # check, rebuild, commit, push
bash djs-build/publish.sh --local  # check, rebuild, serve on :8000
```

Live at <https://3-mmc.github.io/djs/>. It shares the repo with the Uzbekistan
Data Atlas at `/uzbekistan/` and neither knows about the other.

## Adding things

`data.json` is the source of truth. `add.py` edits it, re-derives everything
that follows from it, and rebuilds the page. One command per kind of change:

```bash
# a night you went to
python3 djs-build/add.py night --venue Nowadays --date 2026-08-15 \
        --event "Nonstop" --lineup "Anz, Cinthie b2b Roza Terenzi, Bergsonist"

# a venue that is not in the archive yet — --city adds it
python3 djs-build/add.py night --venue Berghain --city Berlin \
        --date 2026-09-05 --event Klubnacht

# names that were missing from a bill
python3 djs-build/add.py lineup --venue Nowadays --date 2026-08-15 --add "Bergsonist"

# a set that turned up online
python3 djs-build/add.py set --venue Nowadays --date 2026-08-15 --artist Anz \
        --minutes 120 --title "Nonstop, 15 Aug 2026" \
        https://soundcloud.com/anz/nowadays-nonstop-2026

# a whole bill, from an RA event page saved as .mhtml (Ctrl-S in Chrome)
python3 djs-build/add.py ra --dry-run "~/Downloads/Nonstop bei Nowadays.mhtml"
python3 djs-build/add.py ra "~/Downloads/Nonstop bei Nowadays.mhtml"
```

Useful either way:

```bash
python3 djs-build/add.py find nowadays   # what is already on file
python3 djs-build/add.py check           # integrity + privacy scan
python3 djs-build/add.py build           # after editing data.json by hand
```

Venue and artist names are matched loosely — a unique fragment of the venue name
is enough, and `SHYBOI` lands on the same row as `Shyboi`, because punctuation
and case are ignored when matching. Everything is safe to run twice: importing
the same RA page again adds nothing.

`--no-build` stages a change without rebuilding the page, for when several are
going in at once. Run `add.py build` at the end.

### What the tool works out for you

- **b2b.** `Lauren Flax b2b Scotia` stays one slot on the bill and counts as two
  in the index, which is how it was played and how it should be counted.
- **The artist index**, from the bills: how many nights, first and last, which
  clubs, which sets survive. Counts only ever go up, never down — 21 nights have
  no recovered lineup and their artists were still known from elsewhere, so a
  rebuild must not quietly erase them.
- **Nights billed on a Saturday** that run into Sunday. RA imports look for the
  night on the billed date and then the morning after, so a Nonstop page lands on
  the night it is filed under rather than starting a duplicate.
- **Most-visited clubs and the venue counts**, from the nights themselves.

`longest_sessions` is the one hand-written part of `data.json` — the durations
and the flight comparisons were worked out by hand. Edit it there and run
`add.py build`.

## What must not go in

The repo is public. The archive it came from was reconstructed from location
history, bank statements and mail, and none of that belongs here: no arrival or
departure times, no card charges, no addresses, no messages, no first-person
account of an evening. `add.py check` greps the prose fields for all of it and
`publish.sh` refuses to publish if it finds anything.

Two venues in the archive were street-level labels from location history rather
than published venue names. They are generalised here — "Unlisted warehouse
(Brooklyn)", "DIY spot (Berlin)" — which protects the spaces, not just me. If
either resurfaces under its real name, generalise it again.

The extractor that first built `data.json` out of the private archive is not in
this repo and should stay out of it: its rename table names those two addresses.
It lives with the source material in `/mnt/e/ClaudeWIP/DJs/site/`.

## Files

| Path | What it is |
|---|---|
| `data.json` | the archive: venues, nights, bills, sets, artist index |
| `add.py` | everything above — add, search, check, rebuild |
| `build_site.py` | `data.json` → `../djs/index.html` |
| `publish.sh` | check, rebuild, commit, push |
| `../djs/fonts/` | Doto, Space Grotesk, Space Mono (SIL OFL), served with the page |
| `build/artifact.html` | the same page as a claude.ai artifact fragment, fonts inlined; not published, not in git |
