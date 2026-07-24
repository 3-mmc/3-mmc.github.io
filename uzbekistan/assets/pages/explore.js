import { boot, load, figure, autoWidth, token, fmt, Plot, d3 } from "../atlas.js";
import * as C from "../charts.js";

await boot();
const [GEO, WEALTH, REG, CLIM, WDI] = await load("geo", "wealth", "regional", "climate", "wdi");

/* ── one catalogue over every regional source ──────────────────────────── */
const DNAME = new Map(GEO.adm2.features.map((f) => [
  f.properties.pcode, `${f.properties.name} (${String(f.properties.region).replace(/_/g, " ")})`]));

const prettyReg = (ind) => {
  const part = ind.split("::")[1] ?? ind;
  return part.replace(/_\d+$/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
};

const staticFromAgg = (agg) =>
  Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, [[0, v.mean]]]));

const CAT = [
  {
    id: "rwi", label: "Relative Wealth Index (2021 snapshot)", group: "Wealth — Meta",
    adm1: staticFromAgg(WEALTH.agg.adm1), adm2: staticFromAgg(WEALTH.agg.adm2),
    static: true, diverging: true,
  },
  {
    id: "rain", label: "Growing-season rainfall (Mar–Aug, mm)", group: "Climate — WFP",
    adm1: CLIM.adm1.rain, adm2: CLIM.district.rain,
  },
  {
    id: "ndvi", label: "Growing-season greenness (NDVI, Apr–Sep)", group: "Climate — WFP",
    adm1: CLIM.adm1.ndvi, adm2: CLIM.district.ndvi,
  },
  ...Object.keys(REG).sort().map((ind) => ({
    id: "sz:" + ind, label: prettyReg(ind),
    group: "stat.uz — " + ind.split("::")[0],
    adm1: REG[ind], adm2: null,
  })),
];
const BY_ID = new Map(CAT.map((c) => [c.id, c]));

function fillCatalogue(sel) {
  sel.textContent = "";
  const groups = d3.group(CAT, (c) => c.group);
  for (const [g, items] of groups) {
    const og = document.createElement("optgroup");
    og.label = g;
    for (const c of items) {
      const o = document.createElement("option");
      o.value = c.id; o.textContent = c.label;
      og.append(o);
    }
    sel.append(og);
  }
}
const yearsOf = (s, lvl) => {
  if (s.static || !s[lvl]) return [];
  const set = new Set();
  for (const pts of Object.values(s[lvl])) for (const p of pts) set.add(p[0]);
  return [...set].sort((a, b) => a - b);
};
const valueAt = (s, lvl, key, year) => {
  const pts = s[lvl]?.[key];
  if (!pts) return null;
  if (s.static) return pts[0][1];
  return pts.find((p) => p[0] === year)?.[1] ?? null;
};

/* ── tool switcher ─────────────────────────────────────────────────────── */
document.getElementById("tool-picker")?.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  document.querySelectorAll("#tool-picker button").forEach((x) =>
    x.setAttribute("aria-pressed", String(x === b)));
  document.querySelectorAll(".pane").forEach((p) =>
    p.classList.toggle("active", p.id === "pane-" + b.dataset.pane));
  ({ map: mapFig, correlate: corrFig, regions: regFig, wdi: wdiFig })[b.dataset.pane]?.redraw();
  if (b.dataset.pane === "map") rankFig?.redraw();
});

/* ─────────────────────────────────── MAP ──────────────────────────────── */
let mapLvl = "adm1";
let mapFig = null, rankFig = null;
{
  const layerSel = document.getElementById("map-layer");
  const yearSel = document.getElementById("map-year");
  const resSeg = document.getElementById("map-res");
  fillCatalogue(layerSel);
  layerSel.value = "rwi";

  const current = () => BY_ID.get(layerSel.value) ?? CAT[0];

  function syncRes() {
    const s = current();
    const b2 = resSeg.querySelector('[data-lvl="adm2"]');
    b2.disabled = !s.adm2;
    if (!s.adm2 && mapLvl === "adm2") {
      mapLvl = "adm1";
      resSeg.querySelectorAll("button").forEach((x) =>
        x.setAttribute("aria-pressed", String(x.dataset.lvl === "adm1")));
    }
  }
  function syncYears() {
    const s = current();
    const prev = yearSel.value;
    yearSel.textContent = "";
    if (s.static) {
      const o = document.createElement("option");
      o.value = ""; o.textContent = "2021 snapshot";
      yearSel.append(o);
      yearSel.disabled = true;
      return;
    }
    yearSel.disabled = false;
    const years = yearsOf(s, mapLvl);
    for (const y of years) {
      const o = document.createElement("option");
      o.value = String(y); o.textContent = String(y);
      yearSel.append(o);
    }
    yearSel.value = years.map(String).includes(prev) ? prev : String(years.at(-1) ?? "");
  }
  syncRes(); syncYears();

  const values = () => {
    const s = current();
    const year = Number(yearSel.value) || null;
    const keyOf = (f) => (mapLvl === "adm1" ? f.properties.region : f.properties.pcode);
    const m = new Map();
    for (const f of GEO[mapLvl].features) {
      const v = valueAt(s, mapLvl, keyOf(f), year);
      if (v != null) m.set(keyOf(f), v);
    }
    return { s, year, m, keyOf };
  };

  mapFig = figure({
    el: "map",
    caption: "Hover a unit for its value. Grey means no data at this resolution.",
    render: () => {
      const { s, year, m, keyOf } = values();
      const label = s.label + (year ? ` · ${year}` : "");
      if (s.diverging) {
        const vals = [...m.values()];
        const ext = d3.extent(vals);
        const lim = Math.max(Math.abs(ext[0]), Math.abs(ext[1]));
        return Plot.plot({
          width: autoWidth("map")(), height: 460,
          marginLeft: 0, marginRight: 0, marginTop: 4, marginBottom: 4,
          style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
          projection: { type: "mercator", domain: GEO[mapLvl], inset: 6 },
          color: {
            type: "diverging", range: [token("--div-neg-3"), token("--div-mid"), token("--div-pos-3")],
            domain: [-lim, lim], pivot: 0, legend: true, label,
          },
          marks: [
            Plot.geo(GEO[mapLvl].features, {
              fill: (f) => m.get(keyOf(f)) ?? null,
              stroke: token("--surface"), strokeWidth: 0.7,
              title: (f) => `${String(keyOf(f)).replace(/_/g, " ")}\n${m.has(keyOf(f)) ? fmt(m.get(keyOf(f))) : "no data"}`,
              tip: true,
            }),
          ],
        });
      }
      return C.choropleth({
        features: GEO[mapLvl].features, values: m,
        width: autoWidth("map")(), height: 460, label,
        nameOf: keyOf,
      });
    },
    table: () => {
      const { s, year, m } = values();
      return {
        caption: s.label + (year ? ` · ${year}` : ""),
        columns: [mapLvl === "adm1" ? "Region" : "District", { label: "Value", num: true }],
        rows: [...m.entries()]
          .map(([k, v]) => [mapLvl === "adm1" ? k.replace(/_/g, " ") : (DNAME.get(k) ?? k), v])
          .sort((a, b) => b[1] - a[1]),
      };
    },
  });

  // No table of its own: this is the map's data ranked, and the map already
  // carries the table view.
  rankFig = figure({
    el: "map-rank",
    caption: "The same values, ranked. Use the map's table view to read them all.",
    render: () => {
      const { s, year, m } = values();
      const rows = [...m.entries()].map(([k, v]) => ({
        name: mapLvl === "adm1" ? k.replace(/_/g, " ") : (DNAME.get(k) ?? k), value: v,
      }));
      return C.rankBar({
        data: rows, width: autoWidth("map-rank")(),
        label: s.label.length > 44 ? s.label.slice(0, 42) + "…" : s.label,
        maxBars: 25,
      });
    },
  });

  const refresh = () => { mapFig?.redraw(); rankFig?.redraw(); };
  layerSel.addEventListener("change", () => { syncRes(); syncYears(); refresh(); });
  yearSel.addEventListener("change", refresh);
  resSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    mapLvl = b.dataset.lvl;
    resSeg.querySelectorAll("button").forEach((x) =>
      x.setAttribute("aria-pressed", String(x === b)));
    syncYears(); refresh();
  });
}

/* ──────────────────────────────── CORRELATE ───────────────────────────── */
let corrFig = null;
{
  const cx = document.getElementById("cx");
  const cy = document.getElementById("cy");
  const cyear = document.getElementById("cyear");
  fillCatalogue(cx); fillCatalogue(cy);
  cx.value = "rwi"; cy.value = "ndvi";

  function syncYears() {
    const sx = BY_ID.get(cx.value), sy = BY_ID.get(cy.value);
    const prev = cyear.value;
    let years;
    if (sx.static && sy.static) years = [];
    else if (sx.static) years = yearsOf(sy, "adm1");
    else if (sy.static) years = yearsOf(sx, "adm1");
    else {
      const a = new Set(yearsOf(sx, "adm1"));
      years = yearsOf(sy, "adm1").filter((y) => a.has(y));
    }
    cyear.textContent = "";
    const all = document.createElement("option");
    all.value = "all"; all.textContent = "All overlapping years";
    cyear.append(all);
    for (const y of years) {
      const o = document.createElement("option");
      o.value = String(y); o.textContent = String(y);
      cyear.append(o);
    }
    cyear.value = [...cyear.options].some((o) => o.value === prev)
      ? prev : (years.length ? String(years.at(-1)) : "all");
  }
  syncYears();

  const points = () => {
    const sx = BY_ID.get(cx.value), sy = BY_ID.get(cy.value);
    const yv = cyear.value;
    const keys = Object.keys(sx.adm1).filter((k) => k in sy.adm1);
    const out = [];
    for (const k of keys) {
      let years;
      if (sx.static && sy.static) years = [null];
      else if (yv !== "all") years = [Number(yv)];
      else if (sx.static) years = sy.adm1[k].map((p) => p[0]);
      else if (sy.static) years = sx.adm1[k].map((p) => p[0]);
      else {
        const a = new Set(sx.adm1[k].map((p) => p[0]));
        years = sy.adm1[k].map((p) => p[0]).filter((y) => a.has(y));
      }
      for (const y of years) {
        const vx = valueAt(sx, "adm1", k, y), vy = valueAt(sy, "adm1", k, y);
        if (vx == null || vy == null) continue;
        out.push({ x: vx, y: vy, label: k.replace(/_/g, " ") + (y && yv === "all" ? ` ${y}` : "") });
      }
    }
    return { sx, sy, out };
  };

  corrFig = figure({
    el: "correlate",
    caption: "Descriptive only — no controls, no fixed effects.",
    render: () => {
      const { sx, sy, out } = points();
      return C.scatterFit({
        data: out, width: autoWidth("correlate")(), height: 420,
        xLabel: sx.label.length > 52 ? sx.label.slice(0, 50) + "…" : sx.label,
        yLabel: sy.label.length > 52 ? sy.label.slice(0, 50) + "…" : sy.label,
        labelPoints: out.length <= 24,
      });
    },
    table: () => {
      const { sx, sy, out } = points();
      return {
        caption: `${sx.label} against ${sy.label}`,
        columns: ["Region", { label: "Horizontal", num: true }, { label: "Vertical", num: true }],
        rows: out.map((p) => [p.label, p.x, p.y]),
      };
    },
  });

  const refresh = () => corrFig?.redraw();
  cx.addEventListener("change", () => { syncYears(); refresh(); });
  cy.addEventListener("change", () => { syncYears(); refresh(); });
  cyear.addEventListener("change", refresh);
}

/* ───────────────────────────────── REGIONS ────────────────────────────── */
let regFig = null;
{
  const sel = document.getElementById("reg-ind");
  const idx = document.getElementById("reg-index");
  sel.textContent = "";
  const groups = d3.group(Object.keys(REG).sort(), (k) => k.split("::")[0]);
  for (const [g, inds] of groups) {
    const og = document.createElement("optgroup");
    og.label = g;
    for (const ind of inds) {
      const o = document.createElement("option");
      o.value = ind; o.textContent = prettyReg(ind);
      og.append(o);
    }
    sel.append(og);
  }

  regFig = figure({
    el: "regions",
    caption: "One panel per region, so no series has to be told apart by colour.",
    render: () => C.smallMultiples({
      data: C.toRows(REG[sel.value]), width: autoWidth("regions")(),
      label: prettyReg(sel.value), columns: 4, height: 56, index: !!idx.checked,
    }),
    table: () => ({
      caption: prettyReg(sel.value),
      columns: ["Region", "Year", { label: "Value", num: true }],
      rows: C.toRows(REG[sel.value]).map((d) => [d.region, d.x, d.y]),
    }),
  });
  sel.addEventListener("change", () => regFig?.redraw());
  idx.addEventListener("change", () => regFig?.redraw());
}

/* ─────────────────────────────────── WDI ──────────────────────────────── */
let wdiFig = null;
{
  const search = document.getElementById("wdi-search");
  const topicSel = document.getElementById("wdi-topic");
  const listEl = document.getElementById("wdi-list");
  const chipsEl = document.getElementById("wdi-chips");
  const idx = document.getElementById("wdi-index");
  const logCb = document.getElementById("wdi-log");

  WDI.topics.forEach((t, i) => {
    const o = document.createElement("option");
    o.value = String(i); o.textContent = t;
    topicSel.append(o);
  });

  // colour follows the entity: a code keeps its slot while it stays selected
  const picked = [];
  const slotOf = new Map();
  const freeSlot = () => {
    const used = new Set(picked.map((c) => slotOf.get(c)));
    for (let i = 0; i < 8; i++) if (!used.has(i)) return i;
    return 0;
  };
  ["NY.GDP.PCAP.CD", "FP.CPI.TOTL.ZG"].forEach((c) => {
    if (WDI.series[c]) { slotOf.set(c, freeSlot()); picked.push(c); }
  });

  const palette = () => C.legendFor(["a", "b", "c", "d", "e", "f", "g", "h"]).map((d) => d.color);
  const colorOf = (code) => palette()[slotOf.get(code) ?? 0];

  function renderList() {
    const q = search.value.trim().toLowerCase();
    const topic = topicSel.value;
    listEl.textContent = "";
    let n = 0;
    for (const [code, s] of Object.entries(WDI.series)) {
      if (topic !== "" && !s.t.includes(Number(topic))) continue;
      if (q && !(s.n.toLowerCase().includes(q) || code.toLowerCase().includes(q))) continue;
      if (++n > 220) {
        const more = document.createElement("div");
        more.style.cssText = "padding:8px 11px;font-size:12px;color:var(--ink-muted)";
        more.textContent = "More matches — refine the search.";
        listEl.append(more);
        break;
      }
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-pressed", String(picked.includes(code)));
      b.append(document.createTextNode(s.n));
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `${code} · ${s.y[0]}–${s.y.at(-1)} · ${s.y.length} obs`;
      b.append(meta);
      b.addEventListener("click", () => toggle(code));
      listEl.append(b);
    }
    if (!n) {
      const e = document.createElement("p");
      e.className = "empty";
      e.textContent = "Nothing matches that search.";
      listEl.append(e);
    }
  }

  function toggle(code) {
    const i = picked.indexOf(code);
    if (i >= 0) { picked.splice(i, 1); slotOf.delete(code); }
    else {
      if (picked.length >= 6) return;
      slotOf.set(code, freeSlot());
      picked.push(code);
    }
    renderList(); renderChips(); wdiFig?.redraw();
  }

  function renderChips() {
    chipsEl.textContent = "";
    for (const code of picked) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = colorOf(code);
      const label = document.createElement("span");
      label.textContent = WDI.series[code].n;
      const x = document.createElement("span");
      x.className = "x";
      x.textContent = "×";
      chip.append(dot, label, x);
      chip.title = "Remove";
      chip.addEventListener("click", () => toggle(code));
      chipsEl.append(chip);
    }
  }

  wdiFig = figure({
    el: "wdi-chart",
    legend: () => picked.map((c) => ({
      label: WDI.series[c].n, color: colorOf(c), kind: "line",
    })),
    caption: "Pick up to six. Index them when the units differ — never two axes.",
    render: () => {
      if (!picked.length) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "Pick an indicator from the list to plot it.";
        return p;
      }
      const doIndex = idx.checked;
      const data = picked.flatMap((c) => {
        const s = WDI.series[c];
        let pts = s.y.map((y, i) => [y, s.v[i]]);
        if (doIndex) pts = C.indexed(pts);
        return pts.map(([x, y]) => ({ name: s.n, code: c, x, y }));
      });
      return Plot.plot({
        width: autoWidth("wdi-chart")(), height: 420,
        marginLeft: 66, marginBottom: 36, marginRight: 20,
        style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
        x: { label: null, tickFormat: "d" },
        y: {
          label: doIndex ? "index, first observation = 100" : "value",
          labelAnchor: "top", grid: false, nice: true,
          type: logCb.checked ? "log" : "linear",
        },
        marks: [
          Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
          Plot.lineY(data, {
            x: "x", y: "y", z: "code",
            stroke: (d) => colorOf(d.code), strokeWidth: 2, curve: "monotone-x",
          }),
          Plot.tip(data, Plot.pointerX({
            x: "x", y: "y", z: "code",
            title: (d) => `${d.name}\n${d.x}: ${fmt(d.y)}`,
            fill: token("--surface"), stroke: token("--rule"),
          })),
        ],
      });
    },
    table: () => {
      const years = [...new Set(picked.flatMap((c) => WDI.series[c].y))].sort();
      return {
        caption: "Selected World Bank indicators",
        columns: ["Year", ...picked.map((c) => ({ label: WDI.series[c].n, num: true }))],
        rows: years.map((y) => [y, ...picked.map((c) => {
          const s = WDI.series[c];
          const i = s.y.indexOf(y);
          return i >= 0 ? s.v[i] : null;
        })]),
      };
    },
  });

  search.addEventListener("input", renderList);
  topicSel.addEventListener("change", renderList);
  idx.addEventListener("change", () => wdiFig?.redraw());
  logCb.addEventListener("change", () => wdiFig?.redraw());
  renderList(); renderChips();
}
