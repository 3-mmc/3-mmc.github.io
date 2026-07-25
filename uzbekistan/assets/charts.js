// Reusable chart recipes over Observable Plot.
//
// Two rules drive most of what follows:
//  * Categorical hues stop at 8 and are never cycled. Uzbekistan has 14 regions,
//    so regional panels are small multiples (one series per facet, one hue) or
//    emphasis (one highlighted, the rest recessive) — never 14 colours.
//  * Every recipe returns data for a table view, because three light-mode series
//    sit below 3:1 on this surface and the table is their relief channel.

import { Plot, d3, token, SERIES, SEQ, SEQ_GREEN, PRIMARY, DIVERGING, base, gridX, gridY, fmt } from "./atlas.js";
import { sankey as d3sankey, sankeyLinkHorizontal, sankeyJustify }
  from "https://cdn.jsdelivr.net/npm/d3-sankey@0.12.3/+esm";

export const MUTE = () => token("--series-mute");
// single-series marks follow the page's identity hue, not categorical slot 1
export const S1 = () => PRIMARY();
export { SEQ_GREEN, PRIMARY };

/** Index a [[x, y], ...] series so its first non-zero value is 100. */
export function indexed(points) {
  const b = points.find((p) => p[1] !== 0 && p[1] != null);
  if (!b) return points;
  return points.map(([x, y]) => [x, y == null ? null : (100 * y) / b[1]]);
}

/**
 * Value labels on a chart that crosses zero, sitting outside the bar end on
 * whichever side the bar points.
 *
 * Plot treats `dx` and `textAnchor` as constants, not channels — handing them a
 * function stringifies into `translate(NaN,…)` and the labels vanish. So the
 * split has to happen in the data, as two marks.
 */
export function signedLabels(rows, { x, y, text, gap = 6, fontSize = 11, fill }) {
  const value = (d) => d[x];
  const common = { x, y, text, fontSize, fill: fill ?? token("--ink-2") };
  return [
    Plot.text(rows.filter((d) => value(d) >= 0), { ...common, dx: gap, textAnchor: "start" }),
    Plot.text(rows.filter((d) => value(d) < 0), { ...common, dx: -gap, textAnchor: "end" }),
  ];
}

export function toRows(obj, keyName = "region") {
  const out = [];
  for (const [k, pts] of Object.entries(obj)) {
    for (const [x, y] of pts) {
      if (y == null) continue;
      out.push({ [keyName]: k.replace(/_/g, " "), x, y });
    }
  }
  return out;
}

const niceName = (s) => String(s).replace(/_/g, " ");

/* ──────────────────────── views for a region × year panel ──────────────── */
// Fourteen regions is past the categorical ceiling, so none of these encodes a
// region by hue. The heatmap and horizon forms both spend colour on magnitude,
// which is the job it should be doing here.

/**
 * Heatmap: one row per region, one cell per year, colour = magnitude.
 *
 * The most compact way to read a regional panel — every region and every year
 * on screen at once, and "who was high, and when" is a single glance.
 */
export function heatmap({ data, width, label, index = false, format = fmt, sortBy = "mean", ramp }) {
  let rows = data;
  if (index) {
    const out = [];
    for (const [, pts] of d3.group(rows, (d) => d.region)) {
      const sorted = [...pts].sort((a, b) => a.x - b.x);
      const b = sorted.find((p) => p.y !== 0 && p.y != null);
      if (!b) continue;
      for (const p of sorted) out.push({ ...p, y: (100 * p.y) / b.y });
    }
    rows = out;
  }
  const stat = sortBy === "last"
    ? (v) => d3.greatest(v, (d) => d.x)?.y
    : (v) => d3.mean(v, (d) => d.y);
  const order = [...d3.group(rows, (d) => d.region)]
    .sort((a, b) => d3.descending(stat(a[1]), stat(b[1])))
    .map(([k]) => k);
  const years = [...new Set(rows.map((d) => d.x))].sort((a, b) => a - b);
  const longest = d3.max(order, (r) => r.length) ?? 10;

  return Plot.plot(
    base({
      width,
      height: order.length * 22 + 78,
      marginLeft: Math.min(160, longest * 6.6 + 14),
      marginRight: 10,
      marginTop: 30,
      marginBottom: 34,
      x: { type: "band", domain: years, label: null, tickFormat: "d",
           ticks: years.length > 18 ? years.filter((_, i) => i % 3 === 0) : undefined },
      y: { type: "band", domain: order, label: null },
      color: {
        // 5 bins, not 7: quantize thresholds land on raw floats, and seven of
        // them collide into an unreadable smear under the legend swatches.
        type: "quantize", n: 5,
        range: (ramp ?? SEQ()).filter((_, i) => i % 2 === 0 || i === 6).slice(0, 5),
        label: index ? "index, first year = 100" : label,
        tickFormat: (v) => fmt(v),
        legend: true, unknown: token("--plane-deep"),
      },
      marks: [
        Plot.cell(rows, {
          x: "x", y: "region", fill: "y",
          inset: 0.75,                     // the surface gap, not a stroke
          rx: 1,
        }),
        Plot.tip(rows, Plot.pointer({
          x: "x", y: "region", maxRadius: 30,
          title: (d) => `${d.region}\n${d.x}: ${format(d.y)}`,
          fill: token("--surface"), stroke: token("--rule"),
        })),
      ],
    })
  );
}

/**
 * Horizon chart: each region's line folded into stacked colour bands, so a
 * tall series fits in one thin row without losing resolution.
 *
 * Technique from Observable's horizon examples: draw the same area `bands`
 * times, each offset down by one step and filled a step darker, clipped to the
 * row. Darker therefore means "higher up the scale", on one hue.
 */
export function horizon({ data, width, label, bands = 5, rowHeight = 30, index = false, format = fmt }) {
  let rows = data;
  if (index) {
    const out = [];
    for (const [, pts] of d3.group(rows, (d) => d.region)) {
      const sorted = [...pts].sort((a, b) => a.x - b.x);
      const b = sorted.find((p) => p.y !== 0 && p.y != null);
      if (!b) continue;
      for (const p of sorted) out.push({ ...p, y: (100 * p.y) / b.y });
    }
    rows = out;
  }
  // Horizon bands measure from a baseline, so shift a negative series up to it
  // rather than pretending the folding still reads correctly.
  const min = d3.min(rows, (d) => d.y) ?? 0;
  const offset = min < 0 ? -min : 0;
  if (offset) rows = rows.map((d) => ({ ...d, y: d.y + offset }));

  const max = d3.max(rows, (d) => d.y) ?? 1;
  const step = max / bands;
  const order = [...d3.group(rows, (d) => d.region)]
    .sort((a, b) => d3.descending(d3.mean(a[1], (d) => d.y), d3.mean(b[1], (d) => d.y)))
    .map(([k]) => k);
  const ramp = SEQ().slice(0, bands);

  return Plot.plot(
    base({
      width,
      height: order.length * rowHeight + 56,
      // room for the first and last year labels, which sit under the edges
      marginLeft: 24, marginRight: 24, marginTop: 12, marginBottom: 34,
      // whole years only — the default tick generator lands on halves and
      // formats them all as "2018 2018 2019 2019"
      x: { label: null, tickFormat: "d", axis: "bottom", interval: yearStep(rows) },
      y: { domain: [0, step], axis: null },
      fy: { domain: order, axis: null, padding: 0.08 },
      color: {
        type: "ordinal", range: ramp, label: label,
        tickFormat: (i) => format((i + 1) * step - offset),
        legend: true,
      },
      marks: [
        ...d3.range(bands).map((band) =>
          Plot.areaY(rows, {
            x: "x", y: (d) => d.y - band * step, fy: "region",
            fill: band, sort: "x", clip: true, curve: "monotone-x",
          })
        ),
        Plot.text(rows, Plot.selectFirst({
          text: "region", fy: "region", frameAnchor: "left", dx: 5,
          fill: token("--ink"), stroke: token("--surface"), strokeWidth: 3,
          fontSize: 11, fontWeight: 600,
        })),
        Plot.tip(rows, Plot.pointerX({
          x: "x", fy: "region",
          title: (d) => `${d.region}\n${d.x}: ${format(d.y - offset)}`,
          fill: token("--surface"), stroke: token("--rule"),
        })),
      ],
    })
  );
}

/**
 * The three ways to look at a region × year panel, wired for `figure({views})`.
 *
 * `data` and `index` are thunks so the switcher always redraws against the
 * current selection rather than a snapshot taken at wiring time.
 */
export function panelViews({ el, data, label, index = () => false, format = fmt, columns = 4, rowHeight = 30, ramp, features, hexLayout, year }) {
  const width = () => {
    const host = typeof el === "string" ? document.getElementById(el) : el;
    return Math.max(300, Math.floor(host?.getBoundingClientRect().width) || 720);
  };
  const lbl = () => (typeof label === "function" ? label() : label);
  const views = {};

  // Map first when geometry is available: it answers "where is this?", which no
  // amount of sorting a heatmap will.
  if (features && hexLayout) {
    views.Map = () => {
      const rows = data();
      const pickYear = typeof year === "function" ? year() : year;
      const chosen = pickYear ?? d3.max(rows, (d) => d.x);
      // toRows() prettifies "Tashkent_city" to "Tashkent city", but the geometry
      // and the hex layout both key on the underscored form. Register both, or
      // those two regions silently render as "no data".
      const m = new Map();
      for (const d of rows) {
        if (d.x !== chosen) continue;
        m.set(d.region, d.y);
        m.set(String(d.region).replace(/ /g, "_"), d.y);
      }
      const w = width();
      // The grid falls to one column below ~694px (two 340px minimums plus the
      // gap). When it stacks, each map gets the full width — halving it there
      // was shrinking the tiles until their labels had to be dropped.
      const each = w >= 694 ? Math.floor(w / 2 - 10) : w;
      const wrap = document.createElement("div");
      // 340px minimum: below that the two maps squeeze and the cartogram's
      // labels collide, so they stack instead
      wrap.style.cssText =
        "display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px";
      const heading = `${lbl()} · ${chosen}`;
      wrap.append(
        choropleth({ features, values: m, width: each, height: 330, label: heading,
                     format, nameOf: (f) => f.properties.region, ramp }),
        hexCartogram({ values: m, layout: hexLayout, width: each, label: heading,
                       format, labelOf: niceName, ramp })
      );
      return wrap;
    };
  }
  views.Heatmap = () => heatmap({ data: data(), width: width(), label: lbl(), index: index(), format, ramp });
  views.Horizon = () => horizon({ data: data(), width: width(), label: lbl(), index: index(), format, rowHeight });
  views.Panels = () => smallMultiples({ data: data(), width: width(), label: lbl(), index: index(), columns });
  return views;
}

/** Whole-year tick spacing, so a long panel does not repeat its labels. */
function yearStep(rows) {
  const years = d3.extent(rows, (d) => d.x);
  const span = (years[1] ?? 0) - (years[0] ?? 0);
  return span > 24 ? 5 : span > 12 ? 2 : 1;
}

export function panelCaption(view, noun = "region") {
  return {
    Map: `Real geography on the left, one equal tile per ${noun} on the right — Tashkent city is 351 km² and all but invisible on the first.`,
    Heatmap: `One row per ${noun}, one cell per year. Darker means higher.`,
    Horizon: `Each ${noun}'s series folded into colour bands — darker means higher up the scale.`,
    Panels: `One small chart per ${noun}, all sharing the same vertical scale.`,
  }[view] ?? "";
}

/* ───────────────────── small multiples for regional panels ──────────────── */

/**
 * One small line chart per region, laid out in a grid. Removes the colour
 * problem entirely: every facet is a single series in slot 1, and the reader
 * compares shapes rather than trying to track 14 hues through a tangle.
 */
export function smallMultiples({ data, width, label, columns = 4, height = 74, index = false }) {
  let rows = data;
  if (index) {
    const byKey = d3.group(rows, (d) => d.region);
    rows = [];
    for (const [region, pts] of byKey) {
      const sorted = [...pts].sort((a, b) => a.x - b.x);
      const b = sorted.find((p) => p.y !== 0 && p.y != null);
      if (!b) continue;
      for (const p of sorted) rows.push({ ...p, y: (100 * p.y) / b.y });
    }
  }
  const regions = [...new Set(rows.map((d) => d.region))].sort();
  const cols = Math.max(1, Math.min(columns, Math.floor(width / 190) || 1));
  const pos = new Map(regions.map((r, i) => [r, [Math.floor(i / cols), i % cols]]));
  const laid = rows.map((d) => ({ ...d, _r: pos.get(d.region)[0], _c: pos.get(d.region)[1] }));

  return Plot.plot(
    base({
      width,
      height: Math.ceil(regions.length / cols) * (height + 34) + 44,
      marginLeft: 52,
      marginBottom: 26,
      marginTop: 22,
      // fy bands are contiguous by default, so a title placed above its frame
      // lands inside the panel above it. The padding is what makes room.
      fx: { axis: null, padding: 0.1 },
      fy: { axis: null, padding: 0.34 },
      x: { tickFormat: "d", ticks: 4, label: null },
      // No y-axis label: it renders at the top-left of the whole plot and
      // collides with the first facet's title. The unit lives in the caption.
      y: { label: null, ticks: 3, grid: false, insetTop: 6 },
      marks: [
        gridY(),   // grid marks carry no data; Plot repeats them per facet
        Plot.lineY(laid, {
          fx: "_c", fy: "_r", x: "x", y: "y",
          stroke: S1(), strokeWidth: 1.6, curve: "monotone-x",
        }),
        Plot.text(
          regions.map((r) => ({ region: r, _r: pos.get(r)[0], _c: pos.get(r)[1] })),
          { fx: "_c", fy: "_r", text: "region", frameAnchor: "top-left", dx: 0, dy: -13,
            fill: token("--ink-2"), fontSize: 11, fontWeight: 600 }
        ),
        Plot.tip(laid, Plot.pointerX({
          fx: "_c", fy: "_r", x: "x", y: "y",
          title: (d) => `${d.region}\n${d.x}: ${fmt(d.y)}`,
          fill: token("--surface"), stroke: token("--rule"),
        })),
      ],
    })
  );
}

/**
 * All series in the recessive gray, the chosen one in slot 1. The honest form
 * when one line is the point and the rest are context.
 */
export function emphasisLines({ data, width, height = 340, label, highlight, index = false, xIsDate = false }) {
  let rows = data;
  if (index) {
    const byKey = d3.group(rows, (d) => d.region);
    rows = [];
    for (const [, pts] of byKey) {
      const sorted = [...pts].sort((a, b) => a.x - b.x);
      const b = sorted.find((p) => p.y !== 0 && p.y != null);
      if (!b) continue;
      for (const p of sorted) rows.push({ ...p, y: (100 * p.y) / b.y });
    }
  }
  const others = rows.filter((d) => d.region !== highlight);
  const chosen = rows.filter((d) => d.region === highlight);
  const last = d3.greatest(chosen, (d) => d.x);

  return Plot.plot(
    base({
      width, height,
      marginRight: 96,
      x: { label: null, tickFormat: xIsDate ? undefined : "d" },
      y: { label: index ? "index, first year = 100" : label, labelAnchor: "top", grid: false },
      marks: [
        gridY(),
        Plot.lineY(others, { x: "x", y: "y", z: "region", stroke: MUTE(), strokeWidth: 1.1, strokeOpacity: 0.75 }),
        chosen.length ? Plot.lineY(chosen, { x: "x", y: "y", stroke: S1(), strokeWidth: 2 }) : null,
        last ? Plot.text([last], {
          x: "x", y: "y", text: (d) => d.region, dx: 7, textAnchor: "start",
          fill: token("--ink"), fontSize: 12, fontWeight: 600,
        }) : null,
        Plot.tip(rows, Plot.pointer({
          x: "x", y: "y",
          title: (d) => `${d.region}\n${d.x}: ${fmt(d.y)}`,
          fill: token("--surface"), stroke: token("--rule"), maxRadius: 40,
        })),
      ].filter(Boolean),
    })
  );
}

/* ─────────────────────────── named multi-series line ─────────────────────── */

/**
 * Up to 8 named series, fixed slot order.
 *
 * The hover layer is a crosshair that snaps to the nearest x and reports EVERY
 * series there in one tooltip — the reader aims at a date, never at a 2px line.
 */
export function multiLine({ data, width, height = 320, label, names, colors, xIsDate = false, x = "x", y = "y", z = "name", dash }) {
  const keys = names ?? [...new Set(data.map((d) => d[z]))];
  const pal = colors ?? (keys.length === 1 ? [PRIMARY()] : SERIES());
  const color = new Map(keys.map((k, i) => [k, pal[i % pal.length]]));
  const lastPoints = keys
    .map((k) => d3.greatest(data.filter((d) => d[z] === k), (d) => d[x]))
    .filter(Boolean);

  const fmtX = (v) => (xIsDate && v instanceof Date
    ? v.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
    : String(v));

  // one row per x carrying every series' value at that x
  const byX = d3.group(data, (d) => +d[x]);
  const crosshair = [...byX].map(([, rows]) => {
    const lines = keys
      .map((k) => rows.find((r) => r[z] === k))
      .filter(Boolean)
      .map((r) => `${r[z]}: ${fmt(r[y])}`);
    return {
      [x]: rows[0][x],
      [y]: d3.max(rows, (r) => r[y]),
      title: `${fmtX(rows[0][x])}\n${lines.join("\n")}`,
    };
  });

  return Plot.plot(
    base({
      width, height,
      // a single series needs no end-label — the card's title already names it
      marginRight: keys.length > 1 && keys.length <= 4 ? 108 : 24,
      x: { label: null, tickFormat: xIsDate ? undefined : "d" },
      // compact tick labels: raw currency values run to nine digits and get
      // clipped by the left margin
      y: { label, labelAnchor: "top", grid: false, tickFormat: (v) => fmt(v) },
      marks: [
        gridY(),
        Plot.lineY(data, {
          x, y, z, stroke: (d) => color.get(d[z]), strokeWidth: 2,
          strokeDasharray: dash ? (d) => (dash(d) ? "3,3" : null) : null,
          curve: "monotone-x",
        }),
        // direct-label the endpoints only when they will not collide, and only
        // as far as the right margin actually reaches
        keys.length > 1 && keys.length <= 4
          ? Plot.text(lastPoints, {
              x, y,
              text: (d) => (String(d[z]).length > 17 ? String(d[z]).slice(0, 16) + "…" : String(d[z])),
              dx: 7, textAnchor: "start",
              fill: token("--ink-2"), fontSize: 11.5, fontWeight: 600,
            })
          : null,
        Plot.ruleX(crosshair, Plot.pointerX({ x, stroke: token("--ink-muted"), strokeWidth: 1 })),
        Plot.tip(crosshair, Plot.pointerX({
          x, y, title: "title",
          fill: token("--surface"), stroke: token("--rule"),
        })),
      ].filter(Boolean),
    })
  );
}

export function legendFor(names, colors, kind = "line") {
  const pal = colors ?? SERIES();
  return names.map((n, i) => ({ label: niceName(n), color: pal[i % pal.length], kind }));
}

/* ──────────────────────────────── barcode ───────────────────────────────── */

/**
 * A barcode: one tick per observation on a single axis. The right form when the
 * question is "where does each unit sit, and how are they bunched" — and the
 * form the spine of this site is built from.
 */
export function barcode({ values, width, height = 150, label, groupBy, highlight, format = fmt, sortGroups = true }) {
  const groups = groupBy ? [...new Set(values.map((d) => d.group))] : [null];
  if (groupBy && sortGroups) {
    const med = new Map(groups.map((g) => [g, d3.median(values.filter((d) => d.group === g), (d) => d.value)]));
    groups.sort((a, b) => med.get(b) - med.get(a));
  }
  const isHi = (d) => (highlight ? highlight(d) : false);

  return Plot.plot(
    base({
      width,
      height: groupBy ? Math.max(height, groups.length * 22 + 46) : height,
      marginLeft: groupBy ? 128 : 46,
      marginBottom: 40,
      x: { label, labelAnchor: "center", grid: false, nice: true },
      y: groupBy ? { domain: groups, label: null } : { axis: null },
      marks: [
        gridX(),
        Plot.tickX(values, {
          x: "value",
          y: groupBy ? "group" : null,
          stroke: (d) => (isHi(d) ? token("--series-2") : S1()),
          strokeOpacity: (d) => (isHi(d) ? 1 : 0.45),
          strokeWidth: (d) => (isHi(d) ? 2 : 1.2),
          insetTop: groupBy ? 3 : 26,
          insetBottom: groupBy ? 3 : 26,
        }),
        Plot.tip(values, Plot.pointerX({
          x: "value",
          y: groupBy ? "group" : null,
          maxRadius: 30,
          title: (d) => `${d.label ?? d.group ?? ""}\n${format(d.value)}`,
          fill: token("--surface"), stroke: token("--rule"),
        })),
      ],
    })
  );
}

/* ──────────────────────────────── waffle ────────────────────────────────── */

/**
 * A waffle: one cell per unit, so a very small number stays visibly small.
 * Used where a share would round the story away — 16 households out of 1,862
 * is not "0.9%", it is sixteen squares.
 */
export function waffle({ total, parts, width, unit = 1, columns, label }) {
  const cells = Math.ceil(total / unit);
  const cols = columns ?? Math.min(60, Math.ceil(Math.sqrt(cells * 2.4)));
  const pal = SERIES();
  const data = [];
  let i = 0;
  parts.forEach((p, pi) => {
    const n = Math.round(p.value / unit);
    for (let k = 0; k < n && i < cells; k++, i++) {
      data.push({ i, x: i % cols, y: Math.floor(i / cols), name: p.name, color: pal[pi % pal.length] });
    }
  });
  for (; i < cells; i++) {
    data.push({ i, x: i % cols, y: Math.floor(i / cols), name: "Everyone else", color: token("--series-mute") });
  }
  const rows = Math.ceil(cells / cols);
  const cell = Math.max(3, Math.min(11, Math.floor((width - 20) / cols) - 2));

  return Plot.plot(
    base({
      width,
      height: rows * (cell + 2) + 44,
      marginLeft: 4, marginRight: 4, marginTop: 6, marginBottom: 30,
      x: { axis: null, domain: d3.range(cols) },
      y: { axis: null, domain: d3.range(rows) },
      marks: [
        Plot.cell(data, {
          x: "x", y: "y", fill: "color",
          inset: 1,                    // the 2px surface gap, not a stroke
          rx: 1,
        }),
        Plot.tip(data, Plot.pointer({
          x: "x", y: "y", maxRadius: 20,
          title: (d) => d.name,
          fill: token("--surface"), stroke: token("--rule"),
        })),
        label ? Plot.text([{}], {
          frameAnchor: "bottom-left", dy: 18, text: () => label,
          fill: token("--ink-muted"), fontSize: 11.5,
        }) : null,
      ].filter(Boolean),
    })
  );
}

/* ───────────────────────────── ranked bar ──────────────────────────────── */

/**
 * Ranked bars.
 *
 * Every bar is the same hue: regions and commodities are nominal, and colouring
 * them darker-where-bigger would re-encode what bar length already shows while
 * burning the identity channel. `highlight` is the only thing that recolours.
 */
export function rankBar({ data, width, height, label, highlight, format = fmt, maxBars = 40 }) {
  let rows = [...data].sort((a, b) => d3.descending(a.value, b.value));
  if (rows.length > maxBars) rows = rows.slice(0, maxBars);
  const barH = 17;
  const hasNegative = rows.some((d) => d.value < 0);
  const longest = d3.max(rows, (d) => String(d.name).length) ?? 10;

  return Plot.plot(
    base({
      width,
      height: height ?? rows.length * barH + 54,
      marginLeft: Math.min(190, longest * 6.6 + 14),
      marginRight: hasNegative ? 46 : 52,
      marginBottom: 34,
      x: { label, grid: false, nice: true },
      y: { domain: rows.map((d) => d.name), label: null },
      marks: [
        gridX(),
        Plot.barX(rows, {
          x: "value", y: "name",
          fill: (d) => (highlight && highlight(d) ? token("--series-2") : S1()),
          insetTop: 3, insetBottom: 3,   // keeps the band's leftover as air
          rx: 2,
        }),
        ...signedLabels(rows, { x: "value", y: "name", text: (d) => format(d.value), gap: 5 }),
        Plot.ruleX([0], { stroke: token("--rule") }),
        Plot.tip(rows, Plot.pointerY({
          x: "value", y: "name",
          title: (d) => `${d.name}\n${format(d.value)}`,
          fill: token("--surface"), stroke: token("--rule"),
        })),
      ],
    })
  );
}

/* ───────────────────────────── slope chart ─────────────────────────────── */

/** Before → after per item. One hue, two shades; the exception is highlighted. */
export function slope({ data, width, height = 360, labels, label, highlight, format = (v) => fmt(v) }) {
  const long = data.flatMap((d) => [
    { name: d.name, side: labels[0], value: d.from },
    { name: d.name, side: labels[1], value: d.to },
  ]);
  const hi = (n) => (highlight ? highlight(n) : false);
  return Plot.plot(
    base({
      width, height,
      marginLeft: 110, marginRight: 110, marginTop: 26,
      x: { domain: labels, label: null, axis: "top", padding: 0.5 },
      y: { label, grid: false, labelAnchor: "top" },
      marks: [
        gridY(),
        Plot.line(long, {
          x: "side", y: "value", z: "name",
          stroke: (d) => (hi(d.name) ? token("--series-2") : MUTE()),
          strokeWidth: (d) => (hi(d.name) ? 2.4 : 1.5),
          strokeOpacity: (d) => (hi(d.name) ? 1 : 0.8),
        }),
        Plot.dot(long, {
          x: "side", y: "value",
          fill: (d) => (hi(d.name) ? token("--series-2") : MUTE()),
          r: 4, stroke: token("--surface"), strokeWidth: 2,   // the surface ring
        }),
        // fontWeight is a constant in Plot, so the emphasised rows are their
        // own mark rather than a callback
        ...[false, true].flatMap((on) => {
          const rows = long.filter((d) => hi(d.name) === on);
          if (!rows.length) return [];
          const style = {
            fontSize: 11.5,
            fill: on ? token("--ink") : token("--ink-2"),
            fontWeight: on ? 700 : 400,
          };
          return [
            Plot.text(rows.filter((d) => d.side === labels[0]), {
              x: "side", y: "value", text: (d) => `${d.name}  ${format(d.value)}`,
              textAnchor: "end", dx: -9, ...style,
            }),
            Plot.text(rows.filter((d) => d.side === labels[1]), {
              x: "side", y: "value", text: (d) => `${format(d.value)}  ${d.name}`,
              textAnchor: "start", dx: 9, ...style,
            }),
          ];
        }),
      ],
    })
  );
}

/* ──────────────────────── coefficient / dot-and-whisker ─────────────────── */

/** Estimates with 95% intervals. Zero is the reference the reader checks first. */
export function coefficients({ data, width, height, label, format = (v) => v.toFixed(3) }) {
  const rows = data;
  return Plot.plot(
    base({
      width,
      height: height ?? rows.length * 30 + 56,
      marginLeft: Math.min(240, d3.max(rows, (d) => String(d.term).length) * 6.4 + 16),
      marginBottom: 38,
      x: { label, grid: false, nice: true },
      y: { domain: rows.map((d) => d.term), label: null },
      marks: [
        gridX(),
        Plot.ruleX([0], { stroke: token("--ink-muted"), strokeWidth: 1 }),
        Plot.ruleY(rows.filter((d) => d.se != null), {
          y: "term",
          x1: (d) => d.beta - 1.96 * d.se,
          x2: (d) => d.beta + 1.96 * d.se,
          stroke: S1(), strokeWidth: 1.4,
        }),
        Plot.dot(rows, {
          x: "beta", y: "term", r: 4.5,
          fill: (d) => (d.significant === false ? MUTE() : S1()),
          stroke: token("--surface"), strokeWidth: 2,
        }),
        Plot.text(rows, {
          x: "beta", y: "term",
          text: (d) => format(d.beta) + (d.stars ?? ""),
          dy: -12, fontSize: 11, fill: token("--ink-2"),
        }),
        Plot.tip(rows, Plot.pointerY({
          x: "beta", y: "term",
          title: (d) => `${d.term}\nβ ${format(d.beta)}${d.stars ?? ""}${d.t != null ? `\nt = ${d.t.toFixed(1)}` : ""}`,
          fill: token("--surface"), stroke: token("--rule"),
        })),
      ],
    })
  );
}

/* ─────────────────────────── grouped / stacked bars ─────────────────────── */

export function groupedBars({ data, width, height = 300, label, names, x = "group", y = "value", z = "name", format = fmt }) {
  const keys = names ?? [...new Set(data.map((d) => d[z]))];
  const pal = SERIES();
  const color = new Map(keys.map((k, i) => [k, pal[i % pal.length]]));
  return Plot.plot(
    base({
      width, height,
      x: { label: null, axis: null },
      fx: { label: null },
      y: { label, labelAnchor: "top", grid: false, nice: true },
      marks: [
        gridY(),
        Plot.barY(data, {
          fx: x, x: z, y, fill: (d) => color.get(d[z]),
          insetLeft: 1, insetRight: 1, rx: 2,   // 2px surface gap between neighbours
        }),
        Plot.text(data, {
          fx: x, x: z, y, text: (d) => format(d[y]),
          dy: -7, fontSize: 10.5, fill: token("--ink-2"),
        }),
        Plot.ruleY([0], { stroke: token("--rule") }),
        Plot.tip(data, Plot.pointer({
          fx: x, x: z, y,
          title: (d) => `${d[x]} · ${d[z]}\n${format(d[y])}`,
          fill: token("--surface"), stroke: token("--rule"), maxRadius: 40,
        })),
      ],
    })
  );
}

export function stackedArea({ data, width, height = 330, label, names, x = "x", y = "y", z = "name" }) {
  const keys = names ?? [...new Set(data.map((d) => d[z]))];
  const pal = SERIES();
  const color = new Map(keys.map((k, i) => [k, pal[i % pal.length]]));
  return Plot.plot(
    base({
      width, height,
      x: { label: null, tickFormat: "d" },
      y: { label, labelAnchor: "top", grid: false },
      marks: [
        gridY(),
        Plot.areaY(data, {
          x, y, z, fill: (d) => color.get(d[z]), order: keys,
          stroke: token("--surface"), strokeWidth: 1,   // the surface gap between fills
          fillOpacity: 0.92, curve: "monotone-x",
        }),
        Plot.ruleY([0], { stroke: token("--rule") }),
        Plot.tip(data, Plot.pointerX({
          x, y, z,
          title: (d) => `${d[z]}\n${d[x]}: ${fmt(d[y])}`,
          fill: token("--surface"), stroke: token("--rule"),
        })),
      ],
    })
  );
}

/* ────────────────────────────── scatter + fit ───────────────────────────── */

export function scatterFit({ data, width, height = 380, xLabel, yLabel, colorBy, showFit = true, labelPoints = false }) {
  const pts = data.filter((d) => d.x != null && d.y != null);
  const n = pts.length;
  let r = null;
  if (n > 2) {
    const mx = d3.mean(pts, (d) => d.x), my = d3.mean(pts, (d) => d.y);
    let sxy = 0, sxx = 0, syy = 0;
    for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; }
    if (sxx > 0 && syy > 0) r = sxy / Math.sqrt(sxx * syy);
  }
  return Plot.plot(
    base({
      width, height,
      marginBottom: 44,
      x: { label: xLabel, nice: true, grid: false },
      y: { label: yLabel, labelAnchor: "top", nice: true, grid: false },
      color: colorBy ? { scheme: "blues", legend: false } : undefined,
      marks: [
        gridX(), gridY(),
        showFit && n > 2
          ? Plot.linearRegressionY(pts, { x: "x", y: "y", stroke: token("--series-2"), strokeWidth: 1.6, strokeDasharray: "4,3", ci: 0 })
          : null,
        Plot.dot(pts, {
          x: "x", y: "y", r: 4.5,
          fill: colorBy ? colorBy : S1(),
          fillOpacity: 0.82,
          stroke: token("--surface"), strokeWidth: 1.5,   // surface ring on overlap
        }),
        labelPoints && n <= 24
          ? Plot.text(pts, { x: "x", y: "y", text: "label", dy: -10, fontSize: 10.5, fill: token("--ink-muted") })
          : null,
        Plot.text([{}], {
          frameAnchor: "top-left", dx: 6, dy: 6,
          text: () => (r == null ? `n = ${n}` : `r = ${r.toFixed(2)}   n = ${n}`),
          fill: token("--ink-2"), fontSize: 12, fontWeight: 600,
        }),
        Plot.tip(pts, Plot.pointer({
          x: "x", y: "y", maxRadius: 32,
          title: (d) => `${d.label ?? ""}\n${xLabel}: ${fmt(d.x)}\n${yLabel}: ${fmt(d.y)}`,
          fill: token("--surface"), stroke: token("--rule"),
        })),
      ].filter(Boolean),
    })
  );
}

/* ──────────────────────────────── hexbin ───────────────────────────────── */

/**
 * Hexbin: 21,382 wealth cells would be an unreadable smear as dots. Binning
 * them keeps the geography and shows density honestly.
 */
export function hexbinMap({ points, width, height = 460, binSize = 9, colorLabel = "mean RWI" }) {
  const ramp = DIVERGING();
  return Plot.plot(
    base({
      width, height,
      marginLeft: 40, marginBottom: 36,
      x: { label: "longitude", grid: false },
      y: { label: "latitude", labelAnchor: "top", grid: false },
      aspectRatio: null,
      color: {
        type: "linear", range: ramp, domain: [-0.9, 1.1], clamp: true,
        legend: true, label: colorLabel,
      },
      marks: [
        Plot.hexgrid({ stroke: token("--grid"), strokeOpacity: 0.55 }),
        Plot.dot(points, Plot.hexbin(
          { fill: "mean", r: "count" },
          { x: "lon", y: "lat", fill: "rwi", binWidth: binSize, stroke: token("--surface"), strokeWidth: 0.5 }
        )),
        Plot.tip(points, Plot.pointer(Plot.hexbin(
          { fill: "mean" },
          { x: "lon", y: "lat", fill: "rwi", binWidth: binSize, maxRadius: 24,
            title: (d) => `mean wealth index ${fmt(d)}` }
        ))),
      ],
    })
  );
}

/* ──────────────────────────────── choropleth ────────────────────────────── */

export function choropleth({ features, values, width, height = 470, label, format = fmt, nameOf, scale = "quantile", ramp }) {
  const vals = [...values.values()].filter((v) => v != null);
  // Quantile by default. Regional data here is heavily skewed — Tashkent city's
  // density is 25× the next region — and an equal-interval (quantize) scale
  // dumps thirteen of fourteen regions into the palest bin, producing a map
  // that shows one outlier and nothing else.
  const steps = (ramp ?? SEQ()).filter((_, i) => i % 2 === 0 || i === 6).slice(0, 5);
  const colorScale = scale === "quantile"
    ? { type: "quantile", n: 5, range: steps, domain: vals }
    : { type: "quantize", n: 5, range: steps, domain: d3.extent(vals) };
  return Plot.plot(
    base({
      width, height,
      marginLeft: 0, marginRight: 0, marginTop: 4, marginBottom: 4,
      projection: { type: "mercator", domain: { type: "FeatureCollection", features }, inset: 6 },
      color: { ...colorScale, legend: true, unknown: token("--plane-deep"),
               label: label + (scale === "quantile" ? " (equal-count bins)" : ""),
               tickFormat: (v) => format(v) },
      marks: [
        Plot.geo(features, {
          fill: (f) => values.get(nameOf(f)) ?? null,
          stroke: token("--surface"), strokeWidth: 0.7,
          title: (f) => `${niceName(nameOf(f))}\n${values.get(nameOf(f)) == null ? "no data" : format(values.get(nameOf(f)))}`,
          tip: true,
        }),
      ],
    })
  );
}

/* ───────────────────────── ordinal ramp & share bars ───────────────────── */

/**
 * n steps of one hue for ORDERED categories (1→6 rooms, size tiers, age bands),
 * where swapping the order would change the meaning. Starts above the lightest
 * sequential step so the pale end still reads against the surface.
 */
export function ordinalRamp(n, ramp) {
  const s = ramp ?? SEQ();
  if (n <= 1) return [s[3]];
  // Anchored at seq-3, not seq-2: the sequential ramp's palest steps are legal
  // for a continuous scale (where near-zero may recede into the surface) but
  // fail the ordinal 2:1 floor, where every step is a category someone must see.
  return d3.quantize(d3.interpolateRgb(s[2], s[6]), n);
}

/** Normalised stacked bars — each row sums to 100%, one row per region. */
export function shareBars({ data, width, categories, ordinal = false, label, x = "value", y = "region", z = "category", format = (v) => v.toFixed(1) + "%" }) {
  const pal = ordinal ? ordinalRamp(categories.length) : SERIES();
  const color = new Map(categories.map((c, i) => [c, pal[i % pal.length]]));

  // order rows by how much of the first category they carry
  const totals = d3.rollup(data, (v) => d3.sum(v, (d) => d[x]), (d) => d[y]);
  const firstShare = d3.rollup(
    data.filter((d) => d[z] === categories[0]),
    (v) => d3.sum(v, (d) => d[x]) / (totals.get(v[0][y]) || 1),
    (d) => d[y]
  );
  const order = [...totals.keys()].sort((a, b) =>
    d3.descending(firstShare.get(a) ?? 0, firstShare.get(b) ?? 0));
  const longest = d3.max(order, (r) => String(r).length) ?? 10;

  return Plot.plot(
    base({
      width,
      height: order.length * 25 + 56,
      marginLeft: Math.min(160, longest * 6.6 + 14),
      marginRight: 14,
      marginBottom: 36,
      // tickFormat, not `percent: true`: percent applies a ×100 transform to the
      // data, which fights the [0,1] domain the normalised stack produces and
      // throws every segment off the canvas.
      x: { label, grid: false, domain: [0, 1], tickFormat: "%" },
      y: { domain: order, label: null },
      color: { domain: categories, range: categories.map((c) => color.get(c)) },
      marks: [
        gridX(),
        // the stack transform needs z explicitly; inferring it from `fill` only
        // works on marks that actually carry a fill channel
        Plot.barX(data, Plot.stackX({
          offset: "normalize", order: categories, z,
          x, y, fill: z,
          insetTop: 3, insetBottom: 3, insetLeft: 0.5, insetRight: 0.5,
          title: (d) => `${d[y]} · ${d[z]}\n${format((100 * d[x]) / (totals.get(d[y]) || 1))}`,
          tip: true,
        })),
      ],
    })
  );
}

/* ────────────────────────────── hex cartogram ──────────────────────────── */

/**
 * A tile cartogram: every region gets an identical hexagon, arranged to keep
 * the real west→east, north→south geography.
 *
 * Uzbekistan's regions differ in area by nearly 500× — Karakalpakstan is
 * 166,000 km², Tashkent city 351 — so on a true map the densest, most populated
 * places are specks. Equal tiles make every region equally readable; the
 * choropleth beside it keeps the real shape.
 */
export function hexCartogram({ values, layout, width, height, label, format = fmt, diverging = false, labelOf = (k) => k, ramp }) {
  const entries = Object.entries(layout);
  const cols = d3.max(entries, ([, p]) => p.col) + 1;
  const rows = d3.max(entries, ([, p]) => p.row) + 1;
  const w = Math.min(96, (width - 24) / (cols + 0.5));
  const r = w / Math.sqrt(3);                       // pointy-top hexagon radius
  const vStep = r * 1.5;
  const H = height ?? rows * vStep + r * 2 + 34;

  const cells = entries.map(([key, p]) => {
    const cx = 14 + (p.col + (p.row % 2 ? 0.5 : 0)) * w + w / 2;
    const cy = 14 + p.row * vStep + r;
    const pts = d3.range(6).map((i) => {
      const a = (Math.PI / 180) * (60 * i - 90);
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    });
    return { key, cx, cy, value: values.get(key) ?? null, ring: [...pts, pts[0]] };
  });

  const vals = cells.map((c) => c.value).filter((v) => v != null);
  const lim = d3.max(vals, Math.abs) ?? 1;

  const shapes = {
    type: "FeatureCollection",
    features: cells.map((c) => ({
      type: "Feature",
      properties: { key: c.key, value: c.value },
      geometry: { type: "Polygon", coordinates: [c.ring] },
    })),
  };

  // A label sitting inside a filled tile has to pick its own colour: on the
  // darkest steps, ink-on-fill is unreadable however big the halo. So mirror
  // Plot's scale locally and choose white or ink by the fill's luminance.
  const fillScale = diverging
    ? d3.scaleLinear().domain([-lim, 0, lim])
        .range([token("--div-neg-3"), token("--div-mid"), token("--div-pos-3")]).clamp(true)
    : d3.scaleQuantize().domain(d3.extent(vals)).range(ramp ?? SEQ());
  const inkFor = (v) => {
    if (v == null) return token("--ink");
    const c = d3.color(fillScale(v));
    if (!c) return token("--ink");
    const lin = (u) => (u /= 255) <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
    const L = 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    return L < 0.42 ? "#ffffff" : token("--ink");
  };
  const haloFor = (v) => (inkFor(v) === "#ffffff" ? "rgba(0,0,0,.45)" : token("--surface"));

  const ABBREV = {
    Karakalpakstan: "Karakalpak.",
    "Tashkent region": "Tashkent reg.",
    "Tashkent city": "Tashkent city",
    Surkhandarya: "Surkhand.",
    Kashkadarya: "Kashkad.",
  };
  const short = (s) => {
    const t = labelOf(s);
    if (ABBREV[t]) return ABBREV[t];
    return t.length > 12 ? t.slice(0, 11) + "…" : t;
  };
  // In a half-width card the tiles shrink to ~32px and names run into each
  // other. Below these widths the label is dropped rather than overlapped —
  // the hover tooltip and the table still carry it.
  const showName = w >= 56;
  const showValue = w >= 40;

  return Plot.plot(
    base({
      width, height: H,
      marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0,
      projection: { type: "identity", domain: shapes, reflectY: true, inset: 2 },
      color: {
        legend: true, label,
        tickFormat: (v) => format(v),
        ...(diverging
          ? { type: "diverging", pivot: 0, domain: [-lim, lim],
              range: [token("--div-neg-3"), token("--div-mid"), token("--div-pos-3")] }
          : { type: "quantize", n: 7, range: ramp ?? SEQ(), domain: d3.extent(vals) }),
        unknown: token("--plane-deep"),
      },
      marks: [
        Plot.geo(shapes.features, {
          fill: (f) => f.properties.value,
          stroke: token("--surface"), strokeWidth: 2,
          title: (f) => `${labelOf(f.properties.key)}\n${f.properties.value == null ? "no data" : format(f.properties.value)}`,
          tip: true,
        }),
        showName ? Plot.text(cells, {
          x: "cx", y: "cy", text: (d) => short(d.key),
          fill: (d) => inkFor(d.value), stroke: (d) => haloFor(d.value),
          strokeWidth: 2.5, fontSize: 10, fontWeight: 600,
          dy: showValue ? -5 : 0, pointerEvents: "none",
        }) : null,
        showValue ? Plot.text(cells.filter((c) => c.value != null), {
          x: "cx", y: "cy", text: (d) => format(d.value),
          fill: (d) => inkFor(d.value), stroke: (d) => haloFor(d.value),
          strokeWidth: 2.5, fontSize: 11, dy: showName ? 8 : 0, pointerEvents: "none",
        }) : null,
      ].filter(Boolean),
    })
  );
}

/* ──────────────────────────────── Sankey ───────────────────────────────── */

/**
 * Sankey of flows that genuinely balance. Built with d3-sankey because Plot has
 * no Sankey mark; the result is still styled from the same tokens.
 */
export function sankeyChart({ nodes, links, width, height = 460, format = fmt, nodeLabel = (d) => d.name, padLeft = 118, padRight = 132 }) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";
  svg.style.fontFamily = token("--sans");

  // The extent is inset to leave gutters for the labels. Without them the
  // right-hand names get drawn back over their own ribbons.
  const layout = d3sankey()
    .nodeId((d) => d.name)
    .nodeAlign(sankeyJustify)
    .nodeWidth(13)
    .nodePadding(13)
    .extent([[padLeft, 12], [Math.max(padLeft + 60, width - padRight), height - 12]]);

  const graph = layout({
    nodes: nodes.map((d) => ({ ...d })),
    links: links.map((d) => ({ ...d })),
  });

  const pal = SERIES();
  const colorOf = (d) => d.color ?? pal[(d.index ?? 0) % pal.length];

  const gl = document.createElementNS(NS, "g");
  gl.setAttribute("fill", "none");
  for (const l of graph.links) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", sankeyLinkHorizontal()(l));
    // colour by whichever end is the outer one: flows into a hub take the
    // source's colour, flows out of it take the target's
    const hubSource = (l.source.targetLinks?.length ?? 0) > 0;
    path.setAttribute("stroke", colorOf(hubSource ? l.target : l.source));
    path.setAttribute("stroke-opacity", "0.34");
    path.setAttribute("stroke-width", String(Math.max(1, l.width)));
    const t = document.createElementNS(NS, "title");
    t.textContent = `${l.source.name} → ${l.target.name}\n${format(l.value)}`;
    path.append(t);
    path.addEventListener("pointerenter", () => path.setAttribute("stroke-opacity", "0.62"));
    path.addEventListener("pointerleave", () => path.setAttribute("stroke-opacity", "0.34"));
    gl.append(path);
  }
  svg.append(gl);

  const gn = document.createElementNS(NS, "g");
  for (const n of graph.nodes) {
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", n.x0);
    rect.setAttribute("y", n.y0);
    rect.setAttribute("width", n.x1 - n.x0);
    rect.setAttribute("height", Math.max(1, n.y1 - n.y0));
    rect.setAttribute("fill", colorOf(n));
    rect.setAttribute("rx", "2");
    const t = document.createElementNS(NS, "title");
    t.textContent = `${n.name}\n${format(n.value)}`;
    rect.append(t);
    gn.append(rect);

    // sources get their label on the outside left, sinks on the outside right,
    // and anything in the middle sits just to its right
    const isSource = (n.targetLinks?.length ?? 0) === 0;
    const isSink = (n.sourceLinks?.length ?? 0) === 0;
    const text = document.createElementNS(NS, "text");
    text.setAttribute("x", isSource ? n.x0 - 7 : n.x1 + 7);
    text.setAttribute("y", (n.y0 + n.y1) / 2);
    text.setAttribute("dy", "0.35em");
    text.setAttribute("text-anchor", isSource ? "end" : "start");
    if (!isSource && !isSink) text.setAttribute("font-weight", "600");
    text.setAttribute("font-size", "11.5");
    text.setAttribute("fill", token("--ink-2"));
    text.textContent = nodeLabel(n);
    gn.append(text);
  }
  svg.append(gn);
  return svg;
}

/* ───────────────────────────── stacked dots ────────────────────────────── */

/**
 * One dot per observation, dodged so none overlap — the distribution and every
 * individual value at once. Good where a line hides that each year is a
 * discrete step (annual devaluation, one dot a year).
 */
export function stackedDots({ values, width, height = 260, label, format = fmt, diverging = true, r = 8, xType }) {
  const ext = d3.extent(values, (d) => d.value);
  const color = diverging
    ? (d) => (d.value >= 0 ? token("--div-pos-2") : token("--div-neg-2"))
    : () => token("--series-1");
  // Only pad the side that has data — a symmetric domain wastes half the chart
  // when every value is one sign.
  const span = (ext[1] - ext[0]) || 1;
  const domain = [Math.min(0, ext[0] - span * 0.04), ext[1] + span * 0.04];
  return Plot.plot(
    base({
      width, height,
      marginLeft: 46, marginBottom: 42, marginTop: 14,
      x: { label, grid: false, type: xType, domain, ...(xType ? { ticks: 6 } : { nice: true }) },
      y: { axis: null },
      marks: [
        gridX(),
        diverging ? Plot.ruleX([0], { stroke: token("--ink-muted") }) : null,
        Plot.dot(values, Plot.dodgeY({
          x: "value", r, fill: color,
          stroke: token("--surface"), strokeWidth: 1.5,   // the surface ring
          anchor: "middle",
        })),
        Plot.text(values, Plot.dodgeY({
          x: "value", text: "label", anchor: "middle",
          fontSize: 9.5, fontWeight: 600, fill: token("--surface"), pointerEvents: "none",
        })),
        Plot.tip(values, Plot.pointer(Plot.dodgeY({
          x: "value", anchor: "middle", maxRadius: 22,
          title: (d) => `${d.label}\n${format(d.value)}`,
          fill: token("--surface"), stroke: token("--rule"),
        }))),
      ].filter(Boolean),
    })
  );
}

/* ─────────────────────────────── butterfly ─────────────────────────────── */

/**
 * Two bars per row growing away from a shared centre — a butterfly (tornado)
 * chart. Used where one quantity has two reciprocal readings: soum per dollar
 * grows to the right, dollars per million soum grows to the left, and the same
 * devaluation is legible from both sides at once.
 *
 * Each arm gets its OWN scale, because the two are in different units. That is
 * only honest because they are reciprocals of one number rather than two
 * measures being silently equated — the axis labels say which is which.
 */
export function butterfly({ rows, width, rowHeight = 22, leftLabel, rightLabel, leftFormat = fmt, rightFormat = fmt, gutter = 74 }) {
  const height = rows.length * rowHeight + 74;
  const pal = SEQ();
  const leftColor = pal[2], rightColor = pal[5];
  const outerPad = 56;   // room for the value label beyond each bar end
  const half = Math.max(90, (width - gutter - outerPad * 2) / 2);

  const maxL = d3.max(rows, (d) => d.left) ?? 1;
  const maxR = d3.max(rows, (d) => d.right) ?? 1;
  // both arms are measured out from the centre, in their own units
  const xL = d3.scaleLinear().domain([0, maxL]).range([0, half]).nice();
  const xR = d3.scaleLinear().domain([0, maxR]).range([0, half]).nice();
  const centre = half + gutter / 2 + outerPad;

  const laid = rows.map((d) => ({
    ...d,
    lx: centre - gutter / 2 - xL(d.left),
    rx: centre + gutter / 2 + xR(d.right),
  }));

  const ticks = (scale, dir) =>
    scale.ticks(4).filter((t) => t > 0).map((t) => ({
      x: centre + dir * (gutter / 2 + scale(t)),
      t,
    }));

  return Plot.plot(
    base({
      width, height,
      marginLeft: 0, marginRight: 0, marginTop: 34, marginBottom: 40,
      x: { axis: null, domain: [0, width] },
      y: { type: "band", domain: rows.map((d) => d.name), label: null, padding: 0.22 },
      marks: [
        // per-arm gridlines, drawn from the tick positions of each scale
        Plot.ruleX(ticks(xL, -1), { x: "x", stroke: token("--grid"), strokeWidth: 1 }),
        Plot.ruleX(ticks(xR, 1), { x: "x", stroke: token("--grid"), strokeWidth: 1 }),
        Plot.text(ticks(xL, -1), {
          x: "x", text: (d) => leftFormat(d.t), frameAnchor: "bottom", dy: 18,
          fill: token("--ink-muted"), fontSize: 10,
        }),
        Plot.text(ticks(xR, 1), {
          x: "x", text: (d) => rightFormat(d.t), frameAnchor: "bottom", dy: 18,
          fill: token("--ink-muted"), fontSize: 10,
        }),
        Plot.barX(laid, {
          x1: "lx", x2: () => centre - gutter / 2, y: "name",
          fill: leftColor, insetTop: 1.5, insetBottom: 1.5, rx: 2,
          title: (d) => `${d.name}\n${leftLabel}: ${leftFormat(d.left)}\n${rightLabel}: ${rightFormat(d.right)}`,
          tip: true,
        }),
        Plot.barX(laid, {
          x1: () => centre + gutter / 2, x2: "rx", y: "name",
          fill: rightColor, insetTop: 1.5, insetBottom: 1.5, rx: 2,
          title: (d) => `${d.name}\n${leftLabel}: ${leftFormat(d.left)}\n${rightLabel}: ${rightFormat(d.right)}`,
          tip: true,
        }),
        // Value labels on both arms. The left arm is the reciprocal, so recent
        // bars are legitimately near-zero and invisible — the label is how those
        // rows stay readable without distorting the scale.
        Plot.text(laid, {
          x: "lx", y: "name", text: (d) => leftFormat(d.left),
          dx: -5, textAnchor: "end", fontSize: 10, fill: token("--ink-muted"),
        }),
        Plot.text(laid, {
          x: "rx", y: "name", text: (d) => rightFormat(d.right),
          dx: 5, textAnchor: "start", fontSize: 10, fill: token("--ink-muted"),
        }),
        // the row label lives in the central gutter
        Plot.text(laid, {
          x: () => centre, y: "name", text: "name",
          fill: token("--ink-2"), fontSize: 11, fontWeight: 600,
        }),
        Plot.text([{}], {
          x: () => centre - gutter / 2 - half / 2, frameAnchor: "top", dy: -20,
          text: () => "◄ " + leftLabel, fill: token("--ink-2"), fontSize: 11.5, fontWeight: 600,
        }),
        Plot.text([{}], {
          x: () => centre + gutter / 2 + half / 2, frameAnchor: "top", dy: -20,
          text: () => rightLabel + " ►", fill: token("--ink-2"), fontSize: 11.5, fontWeight: 600,
        }),
      ],
    })
  );
}

export function butterflyLegend(leftLabel, rightLabel) {
  const pal = SEQ();
  return [
    { label: leftLabel, color: pal[2], kind: "rect" },
    { label: rightLabel, color: pal[5], kind: "rect" },
  ];
}

/* ──────────────────────────────── donut ────────────────────────────────── */

/**
 * Part-to-whole at a glance. Plot has no arc mark, so this is d3 directly —
 * capped at six slices, because past that a bar chart reads better.
 */
export function donut({ parts, width, size = 250, format = fmt, centerLabel, centerValue }) {
  const NS = "http://www.w3.org/2000/svg";
  const pal = SERIES();
  const total = d3.sum(parts, (d) => d.value);
  const arcs = d3.pie().sort(null).value((d) => d.value)(parts);
  const R = size / 2;
  const arc = d3.arc().innerRadius(R * 0.56).outerRadius(R).cornerRadius(2).padAngle(0.012);

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `${-R - 4} ${-R - 4} ${size + 8} ${size + 8}`);
  svg.setAttribute("width", Math.min(width, size + 8));
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";
  svg.style.fontFamily = token("--sans");

  arcs.forEach((a, i) => {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", arc(a));
    path.setAttribute("fill", parts[i].color ?? pal[i % pal.length]);
    const t = document.createElementNS(NS, "title");
    t.textContent = `${parts[i].name}\n${format(parts[i].value)} (${((100 * parts[i].value) / total).toFixed(1)}%)`;
    path.append(t);
    svg.append(path);
  });

  if (centerLabel) {
    const v = document.createElementNS(NS, "text");
    v.setAttribute("text-anchor", "middle");
    v.setAttribute("y", "-1");
    v.setAttribute("font-size", "21");
    v.setAttribute("font-weight", "700");
    v.setAttribute("fill", token("--ink"));
    v.textContent = centerValue ?? "";
    const l = document.createElementNS(NS, "text");
    l.setAttribute("text-anchor", "middle");
    l.setAttribute("y", "16");
    l.setAttribute("font-size", "11");
    l.setAttribute("fill", token("--ink-muted"));
    l.textContent = centerLabel;
    svg.append(v, l);
  }
  return svg;
}

/* ─────────────────────────────── world map ─────────────────────────────── */

/**
 * Trade partners on a world map: countries shaded by value, with great-circle
 * links from Uzbekistan to the largest of them.
 */
export function worldFlowMap({ world, centroids, values, home, width, height = 460, label, format = fmt, nameOf, topLinks = 12 }) {
  const vals = [...values.values()].filter((v) => v > 0);
  const scale = d3.scaleQuantize().domain(d3.extent(vals)).range(SEQ());
  const origin = centroids[home];
  const ranked = [...values.entries()].sort((a, b) => b[1] - a[1]).slice(0, topLinks);
  const maxV = ranked.length ? ranked[0][1] : 1;
  const wScale = d3.scaleSqrt().domain([0, maxV]).range([0.6, 7]);

  const links = origin
    ? ranked.map(([code, v]) => {
        const c = centroids[code];
        if (!c) return null;
        return { type: "LineString", coordinates: [origin, c], value: v, code };
      }).filter(Boolean)
    : [];

  return Plot.plot(
    base({
      width, height,
      marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0,
      projection: { type: "equal-earth", rotate: [-69, 0] },
      color: {
        // 5 bins: seven quantize thresholds formatted as currency collide into
        // an unreadable run under the legend swatches
        type: "quantize", n: 5,
        range: SEQ().filter((_, i) => i % 2 === 0 || i === 6).slice(0, 5),
        domain: d3.extent(vals),
        label, legend: true, unknown: token("--plane-deep"),
        tickFormat: (v) => format(v),
      },
      marks: [
        Plot.sphere({ stroke: token("--rule"), fill: token("--surface"), strokeWidth: 0.6 }),
        Plot.graticule({ stroke: token("--grid"), strokeOpacity: 0.7, strokeWidth: 0.4 }),
        Plot.geo(world.features, {
          fill: (f) => values.get(String(f.properties.id)) ?? null,
          stroke: token("--surface"), strokeWidth: 0.35,
          title: (f) => {
            const v = values.get(String(f.properties.id));
            return `${nameOf(f)}\n${v ? format(v) : "no recorded trade"}`;
          },
          tip: true,
        }),
        Plot.geo(links, {
          stroke: token("--series-2"), strokeOpacity: 0.75,
          strokeWidth: (d) => wScale(d.value), strokeLinecap: "round",
        }),
        origin ? Plot.dot([origin], {
          x: (d) => d[0], y: (d) => d[1], r: 4,
          fill: token("--series-2"), stroke: token("--surface"), strokeWidth: 1.5,
        }) : null,
      ].filter(Boolean),
    })
  );
}

/* ─────────────────────────────── dumbbell ──────────────────────────────── */

export function dumbbell({ data, width, height, label, labels, format = fmt }) {
  const pal = SEQ();
  const cFrom = pal[2], cTo = pal[5];
  return Plot.plot(
    base({
      width,
      height: height ?? data.length * 34 + 56,
      marginLeft: Math.min(210, d3.max(data, (d) => String(d.name).length) * 6.6 + 20),
      marginBottom: 38,
      x: { label, grid: false, nice: true },
      y: { domain: data.map((d) => d.name), label: null },
      marks: [
        gridX(),
        Plot.link(data, { y: "name", x1: "from", x2: "to", stroke: token("--rule"), strokeWidth: 2.5 }),
        Plot.dot(data, { x: "from", y: "name", fill: cFrom, r: 5, stroke: token("--surface"), strokeWidth: 2 }),
        Plot.dot(data, { x: "to", y: "name", fill: cTo, r: 5, stroke: token("--surface"), strokeWidth: 2 }),
        Plot.text(data, {
          x: "to", y: "name", text: (d) => format(d.to), dx: 10,
          textAnchor: "start", fontSize: 11, fill: token("--ink-2"),
        }),
        Plot.tip(data, Plot.pointerY({
          x: "to", y: "name",
          title: (d) => `${d.name}\n${labels[0]}: ${format(d.from)}\n${labels[1]}: ${format(d.to)}`,
          fill: token("--surface"), stroke: token("--rule"),
        })),
      ],
    })
  );
}

export function dumbbellLegend(labels) {
  const pal = SEQ();
  return [
    { label: labels[0], color: pal[2], kind: "rect" },
    { label: labels[1], color: pal[5], kind: "rect" },
  ];
}
