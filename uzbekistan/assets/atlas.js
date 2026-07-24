// Uzbekistan Data Atlas — shared shell.
// Charts are Observable Plot; colors are read from the CSS custom properties in
// atlas.css so light/dark stay in one place. Every figure registers its render
// function, so a theme change re-draws rather than recolors.

import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.17/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

export { Plot, d3 };

/* ───────────────────────────────── tokens ─────────────────────────────── */

const varCache = new Map();
export function token(name) {
  if (!varCache.has(name)) {
    varCache.set(name, getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim());
  }
  return varCache.get(name);
}
function clearTokens() { varCache.clear(); }

/** Categorical slots, in fixed order. Never cycle past 8 — fold to "Other". */
export const SERIES = () =>
  [1, 2, 3, 4, 5, 6, 7, 8].map((i) => token(`--series-${i}`));
export const SEQ = () => [1, 2, 3, 4, 5, 6, 7].map((i) => token(`--seq-${i}`));
export const DIVERGING = () => [
  token("--div-neg-3"), token("--div-neg-2"), token("--div-neg-1"),
  token("--div-mid"),
  token("--div-pos-1"), token("--div-pos-2"), token("--div-pos-3"),
];

/** Stable color for a named entity — color follows the entity, not its rank. */
export function colorFor(names) {
  const pal = SERIES();
  const map = new Map();
  names.forEach((n, i) => map.set(n, pal[i % pal.length]));
  return (n) => map.get(n) ?? token("--series-mute");
}

export function chartStyle() {
  return {
    background: "transparent",
    color: token("--ink-2"),
    fontFamily: token("--sans") || "system-ui, sans-serif",
    fontSize: "12px",
    overflow: "visible",
  };
}

/** Options every plot shares: recessive solid hairline grid, no chart junk. */
export function base(opts = {}) {
  return Object.assign(
    {
      style: chartStyle(),
      marginTop: 16,
      marginRight: 18,
      marginBottom: 34,
      marginLeft: 54,
      width: 720,
      height: 340,
    },
    opts
  );
}

export function gridX(o = {}) {
  return Plot.gridX({ stroke: token("--grid"), strokeOpacity: 1, strokeWidth: 1, ...o });
}
export function gridY(o = {}) {
  return Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1, strokeWidth: 1, ...o });
}
export function ruleZero(axis = "y") {
  const o = { stroke: token("--rule"), strokeWidth: 1 };
  return axis === "y" ? Plot.ruleY([0], o) : Plot.ruleX([0], o);
}

/** The 1 May 2024 tariff reform, as a dated annotation. */
export function reformRule(label = "Tariff reform") {
  const x = new Date("2024-05-01");
  return [
    Plot.ruleX([x], { stroke: token("--accent"), strokeWidth: 1, strokeDasharray: "3,3" }),
    Plot.text([{ x, t: label }], {
      x: "x", text: "t", frameAnchor: "top", dy: -6, dx: 3,
      textAnchor: "start", fill: token("--accent"), fontSize: 10.5,
    }),
  ];
}

/* ─────────────────────────────── formatting ───────────────────────────── */

const nf = new Intl.NumberFormat("en-GB");
export function fmt(v, digits) {
  if (v == null || v === "" || Number.isNaN(v)) return "—";
  if (typeof v !== "number") return String(v);
  if (digits != null) return v.toFixed(digits);
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "bn";
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "m";
  if (a >= 1000) return nf.format(Math.round(v));
  if (Number.isInteger(v)) return String(v);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(2);
}
export function signed(v, digits = 2) {
  if (v == null) return "—";
  return (v > 0 ? "+" : "") + v.toFixed(digits);
}
export function stars(t) {
  const a = Math.abs(t ?? 0);
  return a >= 2.576 ? "***" : a >= 1.96 ? "**" : a >= 1.645 ? "*" : "";
}
export function titleCase(s) {
  return String(s).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/* ───────────────────────────────── data ───────────────────────────────── */

const BASE = document.documentElement.dataset.base || ".";
const cache = new Map();

/** Fetch one data payload (cached). `load("energy", "core")` -> [energy, core] */
export async function load(...names) {
  const out = await Promise.all(
    names.map((n) => {
      if (!cache.has(n)) {
        cache.set(
          n,
          fetch(`${BASE}/data/${n}.json`).then((r) => {
            if (!r.ok) throw new Error(`${n}.json — ${r.status}`);
            return r.json();
          })
        );
      }
      return cache.get(n);
    })
  );
  return out.length === 1 ? out[0] : out;
}

/* ────────────────────────────── figure shell ──────────────────────────── */

const registry = [];

/**
 * Render a chart into `el` with a legend, a hover layer (Plot's `tip`), and a
 * table view. The table view is not optional decoration: three light-mode
 * series sit below 3:1 on this surface, and the table is their relief channel.
 *
 * @param {Object} spec
 * @param {string|Element} spec.el      target (id or element)
 * @param {Function} spec.render        () => SVG/HTML element (an Observable Plot)
 * @param {Function} [spec.table]       () => ({columns, rows, caption})
 * @param {Array}    [spec.legend]      [{label, color, kind:"line"|"rect"}]
 * @param {string}   [spec.caption]     figcaption text (HTML-free)
 */
export function figure(spec) {
  const host = typeof spec.el === "string" ? document.getElementById(spec.el) : spec.el;
  if (!host) return null;

  host.textContent = "";
  host.classList.add("figure");

  const legendBox = document.createElement("div");
  legendBox.className = "legend";

  const plotBox = document.createElement("div");
  plotBox.className = "plot";

  const foot = document.createElement("div");
  foot.className = "chart-foot";

  const cap = document.createElement("div");
  cap.style.cssText = "font-size:12.5px;color:var(--ink-muted);flex:1 1 240px;min-width:0";
  if (spec.caption) cap.textContent = spec.caption;

  const tableWrap = document.createElement("div");
  tableWrap.hidden = true;

  let toggle = null;
  if (spec.table) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "table-toggle";
    toggle.textContent = "Show table";
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
      const open = tableWrap.hidden;
      tableWrap.hidden = !open;
      toggle.textContent = open ? "Hide table" : "Show table";
      toggle.setAttribute("aria-expanded", String(open));
      if (open && !tableWrap.firstChild) tableWrap.appendChild(buildTable(spec.table()));
    });
  }

  foot.append(cap);
  if (toggle) foot.append(toggle);
  host.append(legendBox, plotBox, foot, tableWrap);

  const draw = () => {
    // hold the frame — no skeleton flash, no layout jump
    plotBox.style.opacity = ".55";
    let node;
    try {
      node = spec.render();
    } catch (err) {
      console.error("figure render failed", spec.el, err);
      plotBox.innerHTML = `<p class="empty">This chart could not be drawn.</p>`;
      plotBox.style.opacity = "1";
      return;
    }
    plotBox.textContent = "";
    if (node) plotBox.append(node);
    plotBox.style.opacity = "1";

    legendBox.textContent = "";
    const items = typeof spec.legend === "function" ? spec.legend() : spec.legend;
    if (items && items.length > 1) {
      for (const it of items) {
        const row = document.createElement("span");
        row.className = "item";
        const sw = document.createElement("span");
        sw.className = "swatch" + (it.kind === "line" ? " line" : "");
        sw.style.background = it.color;
        const tx = document.createElement("span");
        tx.textContent = it.label; // untrusted labels — never innerHTML
        row.append(sw, tx);
        legendBox.append(row);
      }
    }
    if (tableWrap.firstChild) {
      tableWrap.textContent = "";
      tableWrap.appendChild(buildTable(spec.table()));
    }
  };

  draw();
  registry.push(draw);
  return { redraw: draw, host };
}

export function buildTable({ columns, rows, caption }) {
  const wrap = document.createElement("div");
  wrap.className = "tableview";
  const t = document.createElement("table");
  t.className = "data";
  if (caption) {
    const c = document.createElement("caption");
    c.textContent = caption;
    t.append(c);
  }
  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  columns.forEach((c) => {
    const th = document.createElement("th");
    th.textContent = typeof c === "string" ? c : c.label;
    if (typeof c !== "string" && c.num) th.className = "num";
    htr.append(th);
  });
  thead.append(htr);
  const tbody = document.createElement("tbody");
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    r.forEach((v, i) => {
      const td = document.createElement("td");
      td.textContent = typeof v === "number" ? fmt(v) : v == null ? "—" : String(v);
      const c = columns[i];
      if (typeof v === "number" || (typeof c !== "string" && c && c.num)) td.className = "num";
      tr.append(td);
    });
    tbody.append(tr);
  });
  t.append(thead, tbody);
  wrap.append(t);
  return wrap;
}

/** Responsive: re-render on container resize so Plot picks a new width. */
export function autoWidth(el, fn) {
  const host = typeof el === "string" ? document.getElementById(el) : el;
  if (!host) return () => 720;
  return () => Math.max(300, Math.floor(host.getBoundingClientRect().width) || 720);
}

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => registry.forEach((f) => f()), 180);
});

/* ────────────────────────────── theme toggle ──────────────────────────── */

const THEME_KEY = "uz-atlas-theme";

export function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") {
    document.documentElement.dataset.theme = saved;
  }
  const btn = document.querySelector(".theme-toggle");
  if (!btn) return;
  const sync = () => {
    const dark =
      document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    btn.textContent = dark ? "Light" : "Dark";
    btn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  };
  sync();
  btn.addEventListener("click", () => {
    const dark =
      document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    localStorage.setItem(THEME_KEY, dark ? "light" : "dark");
    clearTokens();
    sync();
    drawSpine();
    registry.forEach((f) => f());
  });
}

/* ──────────────────────────────── the spine ───────────────────────────── */
// 21,382 Meta wealth cells, ordered by distance from the 1888–1906
// Trans-Caspian railway and colored by wealth. It is the site's rule because
// it is the site's argument: the near end is rich, the far end is poor.

let spineData = null;

export function drawSpine() {
  const canvas = document.querySelector(".spine canvas");
  if (!canvas || !spineData) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 1200;
  const h = 22;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const ramp = DIVERGING();
  const maxD = d3.max(spineData, (p) => p[0]) || 1;
  const x = d3.scaleSqrt().domain([0, maxD]).range([0, w]);
  const color = d3.scaleLinear()
    .domain([-1.2, -0.6, -0.2, 0, 0.25, 0.7, 1.4])
    .range(ramp)
    .clamp(true)
    .interpolate(d3.interpolateRgb);

  ctx.globalAlpha = 0.5;
  for (const [dist, rwi] of spineData) {
    ctx.strokeStyle = color(rwi);
    ctx.beginPath();
    ctx.moveTo(x(dist), 0);
    ctx.lineTo(x(dist), h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function initSpine(core) {
  const host = document.querySelector(".spine");
  if (!host || !core?.spineSample) return;
  spineData = core.spineSample;
  drawSpine();
  let t;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(drawSpine, 150);
  });
}

/* ───────────────────────────────── masthead ───────────────────────────── */

export function initMasthead(core) {
  const el = document.querySelector(".masthead .counts");
  if (!el || !core) return;
  const c = core.counts;
  const bits = [
    [c.wdiSeries.toLocaleString("en-GB"), "World Bank series"],
    [c.regionalSeries, "regional series"],
    [c.districts, "districts"],
    [c.wealthCells.toLocaleString("en-GB"), "wealth cells"],
  ];
  el.textContent = "";
  for (const [n, label] of bits) {
    const s = document.createElement("span");
    const b = document.createElement("b");
    b.textContent = n;
    s.append(b, " " + label);
    el.append(s);
  }
  const built = document.createElement("span");
  built.textContent = "built " + core.built;
  el.append(built);
}

/** One call per page: chrome + shared data. */
export async function boot() {
  initTheme();
  let core = null;
  try {
    core = await load("core");
    initMasthead(core);
    initSpine(core);
  } catch (err) {
    console.error("core.json failed to load", err);
  }
  return core;
}
