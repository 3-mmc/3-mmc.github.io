# /lab/ — humidity mirror

A public mirror of the ESP32-C3 temperature/humidity logger's own page. The
board serves the live version on the LAN at `humidity.local`; this is a copy of
what it was showing, as of whenever the relay last read it.

```
lab/
  index.html          the page
  fonts/*.woff2       Doto / Space Mono / Space Grotesk, subsetted
  data/humidity.json  committed snapshot — the fallback source
  relay.py            reads the board, publishes a snapshot
  fetch_fonts.py      regenerates fonts/
```

## Why it is a mirror and not the real thing

The board has a private address on a home network. GitHub Pages is static and
public. Nothing served from here can reach the board, so something that *can*
see it has to copy the readings out. That is `relay.py`.

The consequence worth being honest about: this page can never be fresher than
the last copy. It shows the age of that copy rather than pretending to be live,
and the board's own page remains the real-time one.

## Data sources, in order

`index.html` tries two URLs and uses the first that answers:

1. `raw.githubusercontent.com/3-mmc/humidity-data/main/humidity.json` — written
   by the relay on an interval. Labelled **Live**, or **Stale** in red once it
   is more than 25 minutes old.
2. `data/humidity.json` — the snapshot committed alongside the page. Labelled
   **Snapshot**, in neutral grey.

So the page renders correctly whether or not the relay is running, and a relay
that has never been set up looks different from one that has broken.

## Running it live for a few hours

```sh
./lab/demo-relay.sh              # 6 hours, every 10 minutes
HOURS=2 INTERVAL=300 ./lab/demo-relay.sh
```

Pushes `data/humidity.json` straight into this repo, so it needs no second repo
and no token — the credentials for pushing here already exist. Run it from any
machine that can see the board. The page shows **Live** because freshness is
read from the data's own timestamp, not from which URL served it.

It stops at the deadline on its own, and prints the `git rebase -i` line to
squash the run down afterwards. A few dozen commits is nothing; the permanent
setup below exists because *thousands* would be.

## Running it indefinitely

The relay is **not installed anywhere**. For a standing feed:

**1. Create a public repo `3-mmc/humidity-data`.** It exists only to hold one
file. Data churn does not belong in this repo's history — a push every ten
minutes is ~100 commits a day sitting in front of actual work, and each one
would trigger a Pages rebuild for no reason.

**2. Create a fine-grained personal access token** scoped to that repo alone,
with **Contents: read and write**. Scoping matters: the token lives on an
always-on device, and this one cannot touch the site repo.

**3. On the Pi** (it is always on and already on the same network as the
board):

```sh
mkdir -p ~/humidity-relay && cd ~/humidity-relay
curl -O https://3-mmc.github.io/lab/relay.py
echo 'HUMIDITY_RELAY_TOKEN=github_pat_...' > env
chmod 600 env
python3 relay.py --push          # test it once
```

**4. Run it on a timer.** `/etc/systemd/system/humidity-relay.service`:

```ini
[Unit]
Description=Publish humidity readings to GitHub
After=network-online.target

[Service]
Type=oneshot
User=strabo
EnvironmentFile=/home/strabo/humidity-relay/env
ExecStart=/usr/bin/python3 /home/strabo/humidity-relay/relay.py --push
```

and `humidity-relay.timer`:

```ini
[Unit]
Description=Publish humidity readings every 10 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=10min

[Install]
WantedBy=timers.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now humidity-relay.timer
```

Ten minutes is a deliberate floor: `raw.githubusercontent.com` caches for five,
so pushing faster mostly produces commits nobody sees.

`relay.py` uses the GitHub Contents API rather than git, so the Pi needs no
clone, no SSH key and no working tree — just the token in the environment.

## Refreshing the committed snapshot

From any machine that can see the board:

```sh
python3 lab/relay.py --out lab/data/humidity.json
```

Worth doing if the fallback ever starts looking embarrassingly out of date.

## Fonts

Regenerate with `python3 lab/fetch_fonts.py` after adding characters the
current subset does not cover — otherwise they silently render in the fallback
font. These are deliberately separate from `/djs/fonts/` despite the overlap: a
subset only contains the glyphs one page asked for, so sharing the files would
mean editing one page could blank a character on the other.

## Note on what this publishes

Indoor temperature and humidity, continuously, on a site with your name on it.
It is mild, but it is not nothing — heating and cooling cycles, and the
occupancy patterns behind them, are visible in the trace. The snapshot alone is
a single moment; the relay is what makes it an ongoing record.
