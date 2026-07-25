# Building the Uzbekistan Data Atlas

The published site is `../uzbekistan/`. It is static: HTML, one CSS file, ES modules,
and a set of JSON payloads. No build tooling, no framework, no bundler — two
standard-library Python scripts and Observable Plot loaded from a CDN.

```
bash publish.sh            # rebuild everything, commit, push
bash publish.sh --local    # rebuild, then serve on :8000
```

The site fetches JSON, so it needs a web server. Opening `index.html` from
`file://` will show the chrome and no charts.

## The two scripts

### `build_data.py` → `../uzbekistan/data/*.json`

Reads `datasets/`, `exploration/outputs/` and `dashboard/canonical/`, and writes one
payload per concern so each page downloads only what it draws:

| File | Size | Used by |
|---|---|---|
| `core.json` | 38 KB | every page (masthead counts, the spine, headline figures) |
| `geo.json` | 230 KB | explore, climate |
| `wealth.json` | 542 KB | explore, the railway finding |
| `wdi.json` | 674 KB | explore, climate |
| `regional.json` | 783 KB | explore |
| `climate.json` | 145 KB | climate, explore |
| `energy.json` `gold.json` `agriculture.json` `prices.json` `people.json` | 5–47 KB | their topic page |
| `map.json` | 54 KB | the map page (areas, hex layout, housing, density) |
| `trade.json` | 204 KB | the map page's world trade section |
| `findings.json` | 13 KB | finding pages |
| `findings-index.json` | 5 KB | the home page's rotating gallery |

Three things it derives rather than reads, each labelled as derived wherever it
surfaces:

- **Region areas** from the boundary polygons, by geodesic area. These files use
  `Polygon` with several rings to mean *separate landmasses* (Fergana has four,
  largest last), so the GeoJSON "first ring outer, rest are holes" convention
  would subtract real territory — it gave Tashkent region a negative area. Rings
  are nested by containment instead. The 14 areas sum to 450,171 km² against an
  official 448,900.
- **Population and density**, as dwellings × mean household size ÷ area.
  Population is not published per region in this collection. It is an estimate and
  the site says so every time it appears.
- **Trade partners**, from the Comtrade pull. Comtrade mixes real countries with
  aggregates ("Areas, nes", free zones); those are separated into an
  `unallocated` bucket rather than dropped or mapped. For Uzbekistan that bucket
  is $9bn — most of the gold leaves without a named counterparty — so hiding it
  would misrepresent the map badly.

It also recomputes the distance from every Meta wealth cell to the 1888–1906
Trans-Caspian railway. That reproduces `exploration/railway_rwi.py`: the recomputed
gradient is +0.110 in the 0–10 km band and −0.293 beyond 200 km, against +0.109 and
−0.294 in the note. If that check ever drifts, the geometry has changed.

### `build_site.py` → `../uzbekistan/**/*.html`

One page shell (masthead, the spine, nav, footer) applied to:

- **Body fragments** in `pages/*.html` — plain HTML, no templating. A leading
  `<!-- description: … -->` comment becomes the meta description.
- **Finding pages**, generated from the notes in `../03 Findings/`. The `FINDINGS`
  table at the top of the script pairs each finding's *short* note (the
  plain-language layer, shown first) with its *long* note (the collapsible "The
  numbers" layer), and names the chart it gets.

The markdown converter is a deliberate subset — the notes only use headings, lists,
tables, blockquotes, code fences and emphasis. The one genuinely hard part is that
the notes mix bold with significance stars (`**43 rose (median +55%)**` next to
`−2.5pp***;`), which no regex can disambiguate, so `_emphasis()` implements
CommonMark's left/right-flanking rules and treats whatever cannot be a delimiter as
a significance marker.

## `canonical/`

Results that are not recomputable from this repository:

- `tables.json`, `ext.json` — the dissertation's canonical tables T1–T7 and the
  long-run OWID series, recovered from the last published build. The original
  inputs (`dissertation/tables/`, `datasets/dashboard_extension/`) are not in this
  tree. If they come back, regenerate rather than editing these.
- `findings_numbers.json` — figures that exist only in the prose of the notes (the
  three-winter arc, the reshuffle quartiles, the peer inflation table, the cohort
  cliff). Each block carries the note it came from. **Edit the note and this file
  together**, or the page and its source will disagree.

## Front end

- `assets/atlas.js` — data loading, the figure shell (legend + hover + table view),
  the theme toggle, the spine canvas.
- `assets/charts.js` — the chart recipes. All of them are smoke-tested by rendering
  under jsdom; if you add one, add it to that test.
- `assets/pages/*.js` — one module per page. `finding.js` dispatches on
  `document.body.dataset.finding`.

Two constraints worth knowing before editing a chart:

1. **The categorical palette stops at eight and is never cycled.** Uzbekistan has
   14 regions, so regional panels are small multiples (one series per facet, one
   hue) or emphasis (one highlighted, the rest recessive). Sector charts fold the
   tail into "Other sectors".
2. **Every chart has a table view, and that is not optional.** Three light-mode
   series sit below 3:1 contrast on this surface; the table is their relief
   channel. Colours were validated with the dataviz skill's
   `validate_palette.js` against `#f7f9fb` (light) and `#141a22` (dark) — re-run it
   before changing any `--series-*` value. `ordinalRamp()` is validated separately
   with `--ordinal`; it starts at seq-3 because the sequential ramp's palest steps
   fail the ordinal 2:1 floor.
3. **A page's identity hue is `--primary` and the sequential ramp, never the
   categorical slots.** `data-topic` on `<html>` swaps those (energy → gold,
   agriculture → green). The 8-slot order is deliberately left alone: gold beside
   the palette's orange measures ΔE 3.7 under protanopia and green beside it 4.2,
   so re-basing the categorical order on a topic hue would make every
   multi-series chart on those pages colourblind-unsafe.
4. **Choropleths bin by quantile, not equal interval.** Regional data here is
   heavily skewed (Tashkent city's density is 25× the next region), and equal
   intervals put thirteen of fourteen regions in the palest bin. Legends say
   "equal-count bins" when that scale is in use.

Traps worth remembering, all of which cost real debugging time:

- `dx` / `textAnchor` / `fontWeight` are *constants*, not channels. A function
  makes them stringify into `translate(NaN,…)` and the mark silently disappears
  (see `signedLabels`).
- `percent: true` applies a ×100 transform to the *data*, so combining it with a
  `[0, 1]` domain throws every mark off the canvas.
- `Plot.stackX` needs `z` explicitly; it only infers it from `fill` on marks that
  carry a fill channel.
- `fy` bands are contiguous, so a facet title placed above its frame lands inside
  the panel above it — hence the band padding in `smallMultiples`.
- `toRows()` prettifies `Tashkent_city` to `Tashkent city`, but geometry and the
  hex layout key on the underscored form. `panelViews` registers both, or those
  two regions render as "no data".

## Superseded

`build_dashboard.py`, `template.html` and `Uzbekistan_Dashboard.html` built the old
single-file Plotly dashboard. They are kept for reference only; `build_dashboard.py`
no longer runs, because it needs the two input directories listed above. Nothing in
the current pipeline reads them.
