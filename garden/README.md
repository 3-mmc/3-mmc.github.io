# /garden/ — olive monitor mirror

A public, read-only mirror of the ESP32-C3 olive monitor's own page. The board
serves the live version on the LAN; this is a copy of what it was showing, as
of whenever the relay last read it.

```
garden/
  index.html             generated — do not edit here
  three.module.min.js    Three.js 0.160.1, MIT, see three-LICENSE.txt
  data/olive.json        committed snapshot — the fallback source
  relay.py               reads the board, publishes a snapshot
  demo-relay.sh          publishes into this repo for a short run
```

## index.html is generated

The device page is ~90 kB of Three.js scene, and a hand-maintained fork of it
would drift within a week. It is built from the board's own `main/index.html`
instead, by a script in the firmware repo:

```sh
cd ../esp32c3-olive
python3 tools/build_mirror.py --out ../3-mmc.github.io/garden
```

**Edits made here are lost on the next build.** Change `main/index.html` in the
firmware repo and rebuild. The generator applies four transformations:

- a shim over `window.fetch` answering `/api/*` from the snapshot,
- `three.js` loaded from the file next door instead of the board's route,
- every control that writes to the board removed,
- a banner giving the age of the copy.

The shim goes in `<head>`, deliberately: the page's own script is a plain one
in the body, so it runs while the document is still parsing and fetches
immediately. A shim at the end of the body installs its override after those
requests have already gone out.

## Why it is a mirror and not the real thing

The board has a private address on a home network. GitHub Pages is static and
public. Nothing served from here can reach the board, so something that *can*
see it has to copy the readings out. That is `relay.py`.

The consequence worth being honest about: this page can never be fresher than
the last copy. It shows the age of that copy rather than pretending to be live,
and the board's own page remains the real-time one.

Weather is the exception — the page fetches Open-Meteo directly from whatever
browser is viewing it, so that part really is live.

## The archive

`olive.json` is overwritten every run, so nothing accumulates in it — it is a
mirror, not a record. `--archive` is the other half: one CSV per UTC day under
`archive/` in the data repo, appended to and kept.

```
ts_ms,iso_utc,temp_c,rh_pct,vpd_kpa,soil_mv,soil_pct
1789235154431,2026-09-12T17:45:54Z,29.24,47.12,2.1478,1197,
```

It exists because the board's ring holds 48 hours, which is shorter than a
single drydown cycle. Anything that wants to model how this pot actually
behaves — how fast it dries, against what vapour pressure deficit — needs weeks,
not days, and has to read it here.

Only rows carrying a *fresh* soil measurement are archived. The board reads the
probe every 15 minutes and holds the value between reads, so archiving every
sample would repeat each reading fifteen times over and say nothing extra.
Runs overlap heavily and are deduplicated on `ts_ms`, so re-running is safe and
a missed run is caught up by the next one.

`vpd_kpa` is computed here rather than read from the board: the history rows do
not carry it, only the live reading does, and it is the column any drydown
model wants. `soil_pct` is empty while the probe is uncalibrated — `soil_mv` is
always present, so percentages can be recomputed offline from a calibration
taken later.

## Data sources, in order

`index.html` tries two URLs and uses the first that answers:

1. `raw.githubusercontent.com/3-mmc/olive-data/main/olive.json` — written by
   the relay every 15 minutes. This is the live source.
2. `data/olive.json` — the snapshot committed alongside the page.

Either way the banner ages the data from `fetched_at`, so the page renders
correctly whether or not the relay is running, and a relay that has never been
set up looks the same as one that has broken: honestly out of date.

## Running it live for a few hours

```sh
./garden/demo-relay.sh              # 6 hours, every 10 minutes
HOURS=2 INTERVAL=300 ./garden/demo-relay.sh
```

Pushes `data/olive.json` straight into this repo, so it needs no second repo
and no token — the credentials for pushing here already exist. Run it from any
machine that can see the board.

It stops at the deadline on its own, and prints the `git rebase -i` line to
squash the run down afterwards. A few dozen commits is nothing; the permanent
setup below exists because *thousands* would be.

## Where it is running

`3-mmc/olive-data` exists and the relay is **installed on the WSL box**, as a
systemd *user* timer, every 15 minutes:

```
~/.config/systemd/user/olive-relay.{service,timer}
```

The unit runs `garden/relay.py` from this repo directly rather than a copy
under `~`. Two copies drift the moment one is edited, and the edited one is
never the one running.

```sh
systemctl --user list-timers olive-relay.timer
systemctl --user status olive-relay.service
journalctl --user -u olive-relay -n 20
```

Fifteen minutes matches the probe's own schedule — the board only takes a soil
reading that often, so publishing faster just copies the same value twice.
`raw.githubusercontent.com` caches for five minutes in any case.

### The catch, and how to fix it

Lingering is off, so the user's systemd manager — and with it the timer — stops
when the last session on that machine ends. It is a relay that runs when
someone is logged in, which is not the same as a standing feed. One command,
needing sudo, makes it survive:

```sh
sudo loginctl enable-linger "$USER"
```

Even then it only runs while that machine is on and WSL is up. The Pi is the
better home for this, being always on and already on the board's network; the
service file below is written for it.

### Tokens

`relay.py` takes `OLIVE_RELAY_TOKEN` from the environment, and falls back to
whatever `gh` is logged in with. The fallback is why no token had to be minted
here: this machine is already authenticated for working on these repos, so
borrowing that adds no exposure that was not already present.

On a box that exists only to run the relay, do not rely on that. Create a
**fine-grained personal access token** scoped to `3-mmc/olive-data` alone with
**Contents: read and write**, and set it explicitly. `gh`'s token can reach
every repo the account can; this needs one.

### Moving it to the Pi

```sh
mkdir -p ~/olive-relay && cd ~/olive-relay
curl -O https://3-mmc.github.io/garden/relay.py
echo 'OLIVE_RELAY_TOKEN=github_pat_...' > env
chmod 600 env
python3 relay.py --device http://192.168.1.205 --push --archive  # test it once
```

`/etc/systemd/system/olive-relay.service`:

```ini
[Unit]
Description=Publish olive readings to GitHub
After=network-online.target

[Service]
Type=oneshot
User=strabo
EnvironmentFile=/home/strabo/olive-relay/env
ExecStart=/usr/bin/python3 /home/strabo/olive-relay/relay.py --push --archive
```

and `olive-relay.timer`:

```ini
[Unit]
Description=Publish olive readings every 15 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Persistent=true

[Install]
WantedBy=timers.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now olive-relay.timer
```

Disable the WSL one afterwards, or both will publish:

```sh
systemctl --user disable --now olive-relay.timer
```

`relay.py` uses the GitHub Contents API rather than git, so the host needs no
clone, no SSH key and no working tree — just the token in the environment.

## Refreshing the committed snapshot

From any machine that can see the board:

```sh
python3 garden/relay.py --out garden/data/olive.json
```

Worth doing if the fallback ever starts looking embarrassingly out of date.

## Note on what this publishes

Indoor temperature and humidity, continuously, on a site with your name on it.
It is mild, but it is not nothing — heating and cooling cycles, and the
occupancy patterns behind them, are visible in the trace, and the watering
journal is a record of when someone was home to water a plant. The snapshot
alone is a single moment; the relay is what makes it an ongoing record.

The board's address, the OTA token and the WiFi credentials stay on the LAN:
the relay publishes readings, never configuration.
