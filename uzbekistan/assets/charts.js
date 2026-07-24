// Reusable chart recipes over Observable Plot.
//
// Two rules drive most of what follows:
//  * Categorical hues stop at 8 and are never cycled. Uzbekistan has 14 regions,
//    so regional panels are small multiples (one series per facet, one hue) or
//    emphasis (one highlighted, the rest recessive) — never 14 colours.
//  * Every recipe returns data for a table view, because three light-mode series
//    sit below 3:1 on this surface and the table is their relief channel.

import { Plot, d3, token, SERIES, SEQ, DIVERGING, base, gridX, gridY, fmt } from "./atlas.js";

export const MUTE = () => token("--series-mute");
export const S1 = () => token("--series-1");

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
export function heatmap({ data, width, label, index = false, format = fmt, sortBy = "mean" }) {
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
        type: "quantize", n: 5, range: SEQ().filter((_, i) => i % 2 === 0 || i === 6).slice(0, 5),
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
export function panelViews({ el, data, label, index = () => false, format = fmt, columns = 4, rowHeight = 30 }) {
  const width = () => {
    const host = typeof el === "string" ? document.getElementById(el) : el;
    return Math.max(300, Math.floor(host?.getBoundingClientRect().width) || 720);
  };
  const lbl = () => (typeof label === "function" ? label() : label);
  return {
    Heatmap: () => heatmap({ data: data(), width: width(), label: lbl(), index: index(), format }),
    Horizon: () => horizon({ data: data(), width: width(), label: lbl(), index: index(), format, rowHeight }),
    Panels: () => smallMultiples({ data: data(), width: width(), label: lbl(), index: index(), columns }),
  };
}

/** Whole-year tick spacing, so a long panel does not repeat its labels. */
function yearStep(rows) {
  const years = d3.extent(rows, (d) => d.x);
  const span = (years[1] ?? 0) - (years[0] ?? 0);
  return span > 24 ? 5 : span > 12 ? 2 : 1;
}

export function panelCaption(view, noun = "region") {
  return {
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
  const pal = colors ?? SERIES();
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
      y: { label, labelAnchor: "top", grid: false },
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

export function choropleth({ features, values, width, height = 470, label, format = fmt, nameOf }) {
  const vals = [...values.values()].filter((v) => v != null);
  const domain = d3.extent(vals);
  return Plot.plot(
    base({
      width, height,
      marginLeft: 0, marginRight: 0, marginTop: 4, marginBottom: 4,
      projection: { type: "mercator", domain: { type: "FeatureCollection", features }, inset: 6 },
      color: { type: "quantize", n: 7, range: SEQ(), domain, legend: true, label, unknown: token("--plane-deep") },
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
