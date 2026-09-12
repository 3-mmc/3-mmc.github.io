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

## Data sources, in order

`index.html` tries two URLs and uses the first that answers:

1. `raw.githubusercontent.com/3-mmc/olive-data/main/olive.json` — written by
   the relay on an interval.
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

## Running it indefinitely

The relay is **not installed anywhere**. For a standing feed:

**1. Create a public repo `3-mmc/olive-data`.** It exists only to hold one
file. Data churn does not belong in this repo's history — a push every ten
minutes is ~100 commits a day sitting in front of actual work, and each one
would trigger a Pages rebuild for no reason.

**2. Create a fine-grained personal access token** scoped to that repo alone,
with **Contents: read and write**. Scoping matters: the token lives on an
always-on device, and this one cannot touch the site repo.

**3. On a machine that is always on and on the same network as the board:**

```sh
mkdir -p ~/olive-relay && cd ~/olive-relay
curl -O https://3-mmc.github.io/garden/relay.py
echo 'OLIVE_RELAY_TOKEN=github_pat_...' > env
chmod 600 env
python3 relay.py --push          # test it once
```

**4. Run it on a timer.** `/etc/systemd/system/olive-relay.service`:

```ini
[Unit]
Description=Publish olive readings to GitHub
After=network-online.target

[Service]
Type=oneshot
User=strabo
EnvironmentFile=/home/strabo/olive-relay/env
ExecStart=/usr/bin/python3 /home/strabo/olive-relay/relay.py --push
```

and `olive-relay.timer`:

```ini
[Unit]
Description=Publish olive readings every 15 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min

[Install]
WantedBy=timers.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now olive-relay.timer
```

Fifteen minutes matches the probe's own schedule, and there is nothing to be
gained by publishing faster than the board measures. `raw.githubusercontent.com`
caches for five minutes in any case.

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
