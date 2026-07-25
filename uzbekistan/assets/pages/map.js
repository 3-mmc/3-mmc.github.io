import { boot, load, figure, autoWidth, token, fmt, Plot, d3 } from "../atlas.js";
import * as C from "../charts.js";

await boot();
const [MAP, GEO, REG, CLIM, WEALTH, WDI] = await load(
  "map", "geo", "regional", "climate", "wealth", "wdi");
let TRADE = null;
try { TRADE = await load("trade"); } catch { /* optional payload */ }

const pretty = (s) => String(s).replace(/_/g, " ");
const DNAME = new Map(GEO.adm2.features.map((f) => [
  f.properties.pcode, `${f.properties.name} (${pretty(f.properties.region)})`]));

/* ── catalogue of everything mappable ──────────────────────────────────── */
const staticFromAgg = (agg) =>
  Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, [[0, v.mean]]]));

const prettyReg = (ind) =>
  (ind.split("::")[1] ?? ind).replace(/_\d+$/, "").replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

const CAT = [
  { id: "density", label: "Estimated population density (people / km²)",
    group: "Population — estimated", adm1: MAP.density, adm2: null },
  { id: "pop", label: "Estimated population", group: "Population — estimated",
    adm1: MAP.populationEstimate, adm2: null },
  { id: "area", label: "Area (km²)", group: "Population — estimated",
    adm1: Object.fromEntries(Object.entries(MAP.areaKm2).map(([k, v]) => [k, [[0, v]]])),
    adm2: null, static: true },
  { id: "rwi", label: "Relative Wealth Index (2021)", group: "Wealth — Meta",
    adm1: staticFromAgg(WEALTH.agg.adm1), adm2: staticFromAgg(WEALTH.agg.adm2),
    static: true, diverging: true },
  { id: "rain", label: "Growing-season rainfall (mm)", group: "Climate — WFP",
    adm1: CLIM.adm1.rain, adm2: CLIM.district.rain },
  { id: "ndvi", label: "Growing-season greenness (NDVI)", group: "Climate — WFP",
    adm1: CLIM.adm1.ndvi, adm2: CLIM.district.ndvi },
  ...Object.keys(REG).sort().map((ind) => ({
    id: "sz:" + ind, label: prettyReg(ind),
    group: "stat.uz — " + ind.split("::")[0], adm1: REG[ind], adm2: null,
  })),
];
const BY_ID = new Map(CAT.map((c) => [c.id, c]));

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

/* ── the paired map ────────────────────────────────────────────────────── */
let lvl = "adm1";
{
  const layerSel = document.getElementById("map-layer");
  const yearSel = document.getElementById("map-year");
  const resSeg = document.getElementById("map-res");

  const groups = d3.group(CAT, (c) => c.group);
  for (const [g, items] of groups) {
    const og = document.createElement("optgroup");
    og.label = g;
    for (const c of items) {
      const o = document.createElement("option");
      o.value = c.id; o.textContent = c.label;
      og.append(o);
    }
    layerSel.append(og);
  }
  layerSel.value = "density";

  const current = () => BY_ID.get(layerSel.value) ?? CAT[0];

  function syncRes() {
    const b2 = resSeg.querySelector('[data-lvl="adm2"]');
    b2.disabled = !current().adm2;
    if (b2.disabled && lvl === "adm2") {
      lvl = "adm1";
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
      o.value = ""; o.textContent = "snapshot";
      yearSel.append(o);
      yearSel.disabled = true;
      return;
    }
    yearSel.disabled = false;
    const years = yearsOf(s, lvl);
    for (const y of years) {
      const o = document.createElement("option");
      o.value = String(y); o.textContent = String(y);
      yearSel.append(o);
    }
    yearSel.value = years.map(String).includes(prev) ? prev : String(years.at(-1) ?? "");
  }
  syncRes(); syncYears();

  const state = () => {
    const s = current();
    const year = Number(yearSel.value) || null;
    const keyOf = (f) => (lvl === "adm1" ? f.properties.region : f.properties.pcode);
    const m = new Map();
    for (const f of GEO[lvl].features) {
      const v = valueAt(s, lvl, keyOf(f), year);
      if (v != null) m.set(keyOf(f), v);
    }
    return { s, year, m, keyOf };
  };

  const geoFig = figure({
    el: "map-geo",
    caption: "Hover a region for its value.",
    render: () => {
      const { s, year, m, keyOf } = state();
      const label = s.label + (year ? ` · ${year}` : "");
      const w = autoWidth("map-geo")();
      if (s.diverging) {
        const lim = d3.max([...m.values()], Math.abs) ?? 1;
        return Plot.plot({
          width: w, height: 400, marginLeft: 0, marginRight: 0, marginTop: 4, marginBottom: 4,
          style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
          projection: { type: "mercator", domain: GEO[lvl], inset: 6 },
          color: { type: "diverging", pivot: 0, domain: [-lim, lim],
                   range: [token("--div-neg-3"), token("--div-mid"), token("--div-pos-3")],
                   legend: true, label },
          marks: [Plot.geo(GEO[lvl].features, {
            fill: (f) => m.get(keyOf(f)) ?? null,
            stroke: token("--surface"), strokeWidth: 0.7,
            title: (f) => `${lvl === "adm1" ? pretty(keyOf(f)) : DNAME.get(keyOf(f))}\n${m.has(keyOf(f)) ? fmt(m.get(keyOf(f))) : "no data"}`,
            tip: true,
          })],
        });
      }
      return C.choropleth({
        features: GEO[lvl].features, values: m, width: w, height: 400,
        label, nameOf: keyOf,
      });
    },
    table: () => {
      const { s, year, m } = state();
      return {
        caption: s.label + (year ? ` · ${year}` : ""),
        columns: [lvl === "adm1" ? "Region" : "District", { label: "Value", num: true }],
        rows: [...m.entries()]
          .map(([k, v]) => [lvl === "adm1" ? pretty(k) : (DNAME.get(k) ?? k), v])
          .sort((a, b) => b[1] - a[1]),
      };
    },
  });

  const hexFig = figure({
    el: "map-hex",
    render: () => {
      const { s, year, m } = state();
      if (lvl !== "adm1") {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "The tile view covers the 14 regions. Switch resolution to see it.";
        return p;
      }
      return C.hexCartogram({
        values: m, layout: MAP.hexLayout, width: autoWidth("map-hex")(),
        label: s.label + (year ? ` · ${year}` : ""),
        diverging: !!s.diverging, labelOf: pretty,
      });
    },
  });

  const refresh = () => { geoFig?.redraw(); hexFig?.redraw(); };
  layerSel.addEventListener("change", () => { syncRes(); syncYears(); refresh(); });
  yearSel.addEventListener("change", refresh);
  resSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    lvl = b.dataset.lvl;
    resSeg.querySelectorAll("button").forEach((x) =>
      x.setAttribute("aria-pressed", String(x === b)));
    syncYears(); refresh();
  });
}

/* ── density and the area/population gap ───────────────────────────────── */
{
  const last = (o) => Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k, v.at(-1)?.[1]]).filter(([, v]) => v != null));
  const dens = last(MAP.density);
  const pop = last(MAP.populationEstimate);

  figure({
    el: "density",
    caption: MAP.populationNote,
    render: () => C.rankBar({
      data: Object.entries(dens).map(([k, v]) => ({ name: pretty(k), value: v })),
      width: autoWidth("density")(), label: "estimated people per km²",
      format: (v) => fmt(Math.round(v)),
    }),
    table: () => ({
      caption: "Estimated population density by region",
      columns: ["Region", { label: "People per km²", num: true },
                { label: "Area km²", num: true }, { label: "Est. population", num: true }],
      rows: Object.keys(dens).sort((a, b) => dens[b] - dens[a]).map((k) =>
        [pretty(k), Math.round(dens[k]), Math.round(MAP.areaKm2[k]), Math.round(pop[k] ?? 0)]),
    }),
  });

  figure({
    el: "area-pop",
    caption: "Each point is a region. Note the log scales — the spread is that wide.",
    render: () => {
      const pts = Object.keys(pop)
        .filter((k) => MAP.areaKm2[k])
        .map((k) => ({ x: MAP.areaKm2[k], y: pop[k], label: pretty(k) }));
      return Plot.plot({
        width: autoWidth("area-pop")(), height: 360,
        marginLeft: 62, marginBottom: 44,
        style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
        x: { type: "log", label: "area, km² (log)", grid: false },
        y: { type: "log", label: "estimated population (log)", labelAnchor: "top", grid: false },
        marks: [
          Plot.gridX({ stroke: token("--grid"), strokeOpacity: 1 }),
          Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
          Plot.dot(pts, { x: "x", y: "y", r: 5.5, fill: token("--series-1"),
                          stroke: token("--surface"), strokeWidth: 1.5 }),
          Plot.text(pts, { x: "x", y: "y", text: "label", dy: -11, fontSize: 10.5,
                           fill: token("--ink-muted") }),
          Plot.tip(pts, Plot.pointer({
            x: "x", y: "y", maxRadius: 40,
            title: (d) => `${d.label}\n${fmt(Math.round(d.x))} km²\n≈ ${fmt(Math.round(d.y))} people`,
            fill: token("--surface"), stroke: token("--rule"),
          })),
        ],
      });
    },
    table: () => ({
      caption: "Area against estimated population",
      columns: ["Region", { label: "Area km²", num: true }, { label: "Est. population", num: true }],
      rows: Object.keys(pop).map((k) => [pretty(k), Math.round(MAP.areaKm2[k] ?? 0), Math.round(pop[k])])
        .sort((a, b) => b[1] - a[1]),
    }),
  });
}

/* ── housing ───────────────────────────────────────────────────────────── */
{
  const NOTES = {
    rooms: "Dwellings by number of rooms (stat.uz). Ordered categories, so the shading runs light to dark rather than using separate hues.",
    walls: "Housing stock by wall material, thousand m². Pisé is rammed earth — traditional construction, and a marker of older rural stock.",
    type: "Dwellings split between flats in apartment blocks and individual houses.",
    utilities: "Share of dwellings connected to each utility. These are the three networks the 2024 tariff ran along.",
  };
  const ORDINAL = new Set(["rooms"]);
  let which = "rooms";

  const catSel = document.getElementById("housing-cat");
  const note = document.getElementById("housing-note");

  const block = () => MAP.housing[which] ?? {};
  const cats = () => Object.keys(block());

  function fillCats() {
    const prev = catSel.value;
    catSel.textContent = "";
    for (const c of cats()) {
      const o = document.createElement("option");
      o.value = c; o.textContent = c;
      catSel.append(o);
    }
    catSel.value = cats().includes(prev) ? prev : cats()[0];
  }
  fillCats();

  const rowsFor = () => {
    const b = block();
    const regions = Object.keys(b[cats()[0]] ?? {});
    const out = [];
    for (const region of regions) {
      for (const c of cats()) {
        const v = b[c]?.[region]?.at(-1)?.[1];
        if (v != null) out.push({ region: pretty(region), category: c, value: v });
      }
    }
    return out;
  };

  const barsFig = figure({
    el: "housing-bars",
    legend: () => {
      const list = cats();
      if (ORDINAL.has(which)) {
        const ramp = C.ordinalRamp(list.length);
        return list.map((c, i) => ({ label: c, color: ramp[i], kind: "rect" }));
      }
      return C.legendFor(list, null, "rect");
    },
    caption: () => (which === "utilities"
      ? "Share of dwellings connected, by region."
      : "Share of each region's housing stock."),
    render: () => {
      const rows = rowsFor();
      const w = autoWidth("housing-bars")();
      if (which === "utilities") {
        return C.groupedBars({
          data: rows.map((d) => ({ group: d.region, name: d.category, value: d.value })),
          width: w, height: 340, label: "% of dwellings",
          names: cats(), format: (v) => v.toFixed(0) + "%",
        });
      }
      return C.shareBars({
        data: rows, width: w, categories: cats(),
        ordinal: ORDINAL.has(which),
        label: "share of regional housing stock",
      });
    },
    table: () => ({
      caption: NOTES[which],
      columns: ["Region", "Category", { label: "Value", num: true }],
      rows: rowsFor().map((d) => [d.region, d.category, d.value]),
    }),
  });

  const hexFig = figure({
    el: "housing-hex",
    render: () => {
      const b = block();
      const cat = catSel.value || cats()[0];
      const series = b[cat] ?? {};
      const isPct = which === "utilities";
      const totals = {};
      if (!isPct) {
        for (const region of Object.keys(series)) {
          totals[region] = d3.sum(cats(), (c) => b[c]?.[region]?.at(-1)?.[1] ?? 0);
        }
      }
      const values = new Map(Object.entries(series).map(([region, pts]) => {
        const v = pts.at(-1)?.[1];
        if (v == null) return [region, null];
        return [region, isPct ? v : (100 * v) / (totals[region] || 1)];
      }));
      return C.hexCartogram({
        values, layout: MAP.hexLayout, width: autoWidth("housing-hex")(),
        label: `${cat} — % of stock`, labelOf: pretty,
        format: (v) => v.toFixed(1) + "%",
      });
    },
  });

  const refresh = () => {
    note.textContent = NOTES[which];
    barsFig?.redraw();
    hexFig?.redraw();
  };
  note.textContent = NOTES[which];

  document.getElementById("housing-pick").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    which = b.dataset.h;
    e.currentTarget.querySelectorAll("button").forEach((x) =>
      x.setAttribute("aria-pressed", String(x === b)));
    fillCats();
    refresh();
  });
  catSel.addEventListener("change", () => hexFig?.redraw());
}

/* ── trade ─────────────────────────────────────────────────────────────── */
if (TRADE) {
  let flow = "export";
  const yearSel = document.getElementById("trade-year");
  for (const y of TRADE.years) {
    const o = document.createElement("option");
    o.value = String(y); o.textContent = String(y);
    yearSel.append(o);
  }
  yearSel.value = String(TRADE.years.at(-1));

  const key = () => `${flow}:${yearSel.value}`;
  const valueMap = () => new Map(Object.entries(TRADE.flows[key()] ?? {}));
  const usd = (v) => "$" + fmt(v);

  const mapFig = figure({
    el: "trade-map",
    caption: TRADE.note,
    render: () => C.worldFlowMap({
      world: TRADE.world, centroids: TRADE.centroids, values: valueMap(),
      home: TRADE.home, width: autoWidth("trade-map")(), height: 440,
      label: `${flow === "export" ? "Exports to" : "Imports from"}, US$`,
      format: usd,
      nameOf: (f) => f.properties.name ?? f.properties.id,
    }),
    table: () => ({
      caption: `${flow === "export" ? "Exports to" : "Imports from"} each partner, ${yearSel.value} (US$)`,
      columns: ["Partner", { label: "US$", num: true }],
      rows: [...valueMap().entries()]
        .map(([c, v]) => [TRADE.partnerNames[c] ?? c, v])
        .sort((a, b) => b[1] - a[1]),
    }),
  });

  const partnersFig = figure({
    el: "trade-partners",
    render: () => C.rankBar({
      data: [...valueMap().entries()]
        .map(([c, v]) => ({ name: TRADE.partnerNames[c] ?? c, value: v })),
      width: autoWidth("trade-partners")(), maxBars: 14,
      label: `US$, ${yearSel.value}`, format: usd,
    }),
  });

  const commFig = figure({
    el: "trade-commodities",
    render: () => C.rankBar({
      data: Object.entries(TRADE.commodities[key()] ?? {})
        .map(([k, v]) => ({ name: k.replace(/_/g, " "), value: v })),
      width: autoWidth("trade-commodities")(), maxBars: 15,
      label: `US$, ${yearSel.value}`, format: usd,
    }),
    table: () => ({
      caption: `Commodity groups, ${yearSel.value} (US$)`,
      columns: ["Commodity group", { label: "US$", num: true }],
      rows: Object.entries(TRADE.commodities[key()] ?? {})
        .map(([k, v]) => [k.replace(/_/g, " "), v]),
    }),
  });

  const noteEl = document.getElementById("trade-note");
  const refresh = () => {
    mapFig?.redraw(); partnersFig?.redraw(); commFig?.redraw();
    const un = TRADE.unallocated?.[key()];
    noteEl.textContent = un
      ? `${usd(un)} of ${yearSel.value} ${flow}s went to an unspecified destination and is not on the map — most of it gold, which Uzbekistan reports without a named counterparty.`
      : TRADE.note;
  };
  refresh();

  document.getElementById("trade-flow").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    flow = b.dataset.flow;
    e.currentTarget.querySelectorAll("button").forEach((x) =>
      x.setAttribute("aria-pressed", String(x === b)));
    refresh();
  });
  yearSel.addEventListener("change", refresh);
} else {
  document.getElementById("trade-map")?.closest("section")?.remove();
}

/* ── aid and openness ──────────────────────────────────────────────────── */
{
  const picks = [
    ["DT.ODA.ODAT.CD", "Net official development assistance received (US$)"],
    ["DT.ODA.ODAT.GN.ZS", "Net ODA received (% of GNI)"],
    ["BX.KLT.DINV.CD.WD", "Foreign direct investment, net inflows (US$)"],
    ["BX.KLT.DINV.WD.GD.ZS", "Foreign direct investment (% of GDP)"],
  ].filter(([c]) => WDI.series[c]);
  const sel = document.getElementById("aid-ind");
  for (const [c, label] of picks) {
    const o = document.createElement("option");
    o.value = c; o.textContent = label;
    sel.append(o);
  }
  if (picks.length) {
    const fig = figure({
      el: "aid",
      caption: "World Bank WDI. Donor-by-donor detail is not in this collection.",
      render: () => {
        const s = WDI.series[sel.value];
        return C.multiLine({
          data: s.y.map((y, i) => ({ name: s.n, x: y, y: s.v[i] })),
          width: autoWidth("aid")(), height: 300, label: unitOf(s.n), names: [s.n],
        });
      },
      table: () => {
        const s = WDI.series[sel.value];
        return { caption: s.n, columns: ["Year", { label: "Value", num: true }],
                 rows: s.y.map((y, i) => [y, s.v[i]]) };
      },
    });
    sel.addEventListener("change", () => fig?.redraw());
  }

  const open = [["NE.EXP.GNFS.ZS", "Exports"], ["NE.IMP.GNFS.ZS", "Imports"]]
    .filter(([c]) => WDI.series[c]);
  if (open.length === 2) {
    const names = open.map(([, l]) => l);
    const data = open.flatMap(([c, label]) =>
      WDI.series[c].y.map((y, i) => ({ name: label, x: y, y: WDI.series[c].v[i] })));
    figure({
      el: "openness",
      legend: C.legendFor(names, null, "line"),
      caption: "Both are shares of GDP, so they share one axis.",
      render: () => C.multiLine({
        data, width: autoWidth("openness")(), height: 300, label: "% of GDP", names,
      }),
      table: () => {
        const years = [...new Set(data.map((d) => d.x))].sort();
        return {
          caption: "Trade openness, % of GDP",
          columns: ["Year", ...names.map((n) => ({ label: n, num: true }))],
          rows: years.map((y) => [y, ...names.map((n) =>
            data.find((d) => d.x === y && d.name === n)?.y ?? null)]),
        };
      },
    });
  }
}

function unitOf(name) {
  const m = name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : name;
}
