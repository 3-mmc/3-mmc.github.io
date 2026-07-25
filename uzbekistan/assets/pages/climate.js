import { boot, load, figure, autoWidth, token, fmt, Plot, d3 } from "../atlas.js";
import * as C from "../charts.js";

await boot();
const [CL, GEO, WDI, MAP] = await load("climate", "geo", "wdi", "map");

const LABEL = {
  rain: "growing-season rainfall, mm (Mar–Aug total)",
  ndvi: "growing-season greenness, NDVI (Apr–Sep mean)",
};
let metric = "rain";

/* district pcode -> readable name */
const DNAME = new Map(
  GEO.adm2.features.map((f) => [
    f.properties.pcode,
    `${f.properties.name} (${String(f.properties.region).replace(/_/g, " ")})`,
  ])
);

/* ── regional series ───────────────────────────────────────────────────── */
{
  const idx = document.getElementById("clim-index");
  const seg = document.getElementById("clim-metric");

  const yearsOfAdm1 = () =>
    [...new Set(Object.values(CL.adm1[metric]).flat().map((p) => p[0]))].sort();
  const mapYear = document.getElementById("clim-map-year");
  const fillMapYears = () => {
    if (!mapYear) return;
    const prev = mapYear.value;
    const years = yearsOfAdm1();
    mapYear.textContent = "";
    for (const y of years) {
      const o = document.createElement("option");
      o.value = String(y); o.textContent = String(y);
      mapYear.append(o);
    }
    mapYear.value = years.map(String).includes(prev) ? prev : String(years.at(-1));
  };
  fillMapYears();

  const fmtMetric = (v) => (metric === "rain" ? v.toFixed(0) + " mm" : v.toFixed(3));
  const mapValues = () => {
    const year = Number(mapYear?.value || yearsOfAdm1().at(-1));
    const m = new Map();
    for (const [region, pts] of Object.entries(CL.adm1[metric])) {
      const hit = pts.find((p) => p[0] === year);
      if (hit) m.set(region, hit[1]);
    }
    return { year, m };
  };

  // Heatmap and map only: the panel and horizon views said the same thing less
  // clearly, and the map is what tells a reader where these regions actually are.
  const fig = figure({
    el: "clim-series",
    views: {
      Heatmap: () => C.heatmap({
        data: C.toRows(CL.adm1[metric]), width: autoWidth("clim-series")(),
        label: metric === "rain" ? "rainfall, mm" : "NDVI",
        index: !!idx?.checked, format: fmtMetric,
      }),
      Map: () => {
        const { year, m } = mapValues();
        const w = autoWidth("clim-series")();
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px";
        wrap.append(
          C.choropleth({
            features: GEO.adm1.features, values: m, width: Math.max(280, w / 2 - 10),
            height: 330, label: `${metric === "rain" ? "rainfall, mm" : "NDVI"} · ${year}`,
            format: fmtMetric, nameOf: (f) => f.properties.region,
          }),
          C.hexCartogram({
            values: m, layout: MAP.hexLayout, width: Math.max(280, w / 2 - 10),
            label: `${metric === "rain" ? "rainfall, mm" : "NDVI"} · ${year}`,
            labelOf: (s) => s.replace(/_/g, " "), format: fmtMetric,
          })
        );
        return wrap;
      },
    },
    defaultView: "Heatmap",
    caption: (v) => (v === "Map"
      ? "Real geography on the left, one equal tile per region on the right — Tashkent city is 351 km² and invisible on the first."
      : C.panelCaption(v) + " Ten-day satellite composites."),
    table: () => ({
      caption: LABEL[metric],
      columns: ["Region", "Year", { label: metric === "rain" ? "mm" : "NDVI", num: true }],
      rows: C.toRows(CL.adm1[metric]).map((d) => [d.region, d.x, d.y]),
    }),
  });

  seg?.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    metric = b.dataset.metric;
    seg.querySelectorAll("button").forEach((x) =>
      x.setAttribute("aria-pressed", String(x === b)));
    fillMapYears();
    fig?.redraw();
    barcodeFig?.redraw();
  });
  idx?.addEventListener("change", () => fig?.redraw());
  mapYear?.addEventListener("change", () => fig?.redraw());
}

/* ── rain against greenness ────────────────────────────────────────────── */
{
  const rain = CL.adm1.rain, ndvi = CL.adm1.ndvi;
  const pts = [];
  for (const [region, rpts] of Object.entries(rain)) {
    const nd = new Map((ndvi[region] ?? []).map((p) => p));
    for (const [y, v] of rpts) {
      if (nd.has(y)) pts.push({ x: v, y: nd.get(y), label: `${region.replace(/_/g, " ")} ${y}` });
    }
  }
  figure({
    el: "clim-scatter",
    caption: "Each point is one region in one growing season.",
    render: () => C.scatterFit({
      data: pts, width: autoWidth("clim-scatter")(), height: 380,
      xLabel: "rainfall, mm", yLabel: "NDVI",
    }),
    table: () => ({
      caption: "Growing-season rainfall against greenness, region-years",
      columns: ["Region and year", { label: "Rainfall mm", num: true }, { label: "NDVI", num: true }],
      rows: pts.map((p) => [p.label, Number(p.x.toFixed(1)), Number(p.y.toFixed(3))]),
    }),
  });
}

/* ── district barcode ──────────────────────────────────────────────────── */
let barcodeFig = null;
{
  const yearsOf = (m) =>
    [...new Set(Object.values(CL.district[m]).flat().map((p) => p[0]))].sort();
  const sel = document.getElementById("clim-year");
  const fillYears = () => {
    if (!sel) return;
    const prev = sel.value;
    const years = yearsOf(metric);
    sel.textContent = "";
    for (const y of years) {
      const o = document.createElement("option");
      o.value = String(y); o.textContent = String(y);
      sel.append(o);
    }
    sel.value = years.map(String).includes(prev) ? prev : String(years.at(-1));
  };
  fillYears();

  barcodeFig = figure({
    el: "clim-barcode",
    legend: [
      { label: "District", color: token("--series-1"), kind: "line" },
      { label: "Regional average", color: token("--series-2"), kind: "line" },
    ],
    caption: "Every district in the country as one strip.",
    render: () => {
      fillYears();
      const year = Number(sel?.value || yearsOf(metric).at(-1));
      const values = [];
      for (const [pcode, pts] of Object.entries(CL.district[metric])) {
        const hit = pts.find((p) => p[0] === year);
        if (hit) values.push({ value: hit[1], label: DNAME.get(pcode) ?? pcode, kind: "district" });
      }
      for (const [region, pts] of Object.entries(CL.adm1[metric])) {
        const hit = pts.find((p) => p[0] === year);
        if (hit) values.push({ value: hit[1], label: region.replace(/_/g, " ") + " (regional average)", kind: "region" });
      }
      return C.barcode({
        values, width: autoWidth("clim-barcode")(), height: 190,
        label: `${metric === "rain" ? "rainfall, mm" : "NDVI"} — ${year}`,
        highlight: (d) => d.kind === "region",
        format: (v) => (metric === "rain" ? v.toFixed(0) + " mm" : v.toFixed(3)),
      });
    },
    table: () => {
      const year = Number(sel?.value || yearsOf(metric).at(-1));
      const rows = [];
      for (const [pcode, pts] of Object.entries(CL.district[metric])) {
        const hit = pts.find((p) => p[0] === year);
        if (hit) rows.push([DNAME.get(pcode) ?? pcode, hit[1]]);
      }
      rows.sort((a, b) => b[1] - a[1]);
      return {
        caption: `${LABEL[metric]} by district, ${year}`,
        columns: ["District", { label: metric === "rain" ? "mm" : "NDVI", num: true }],
        rows,
      };
    },
  });
  sel?.addEventListener("change", () => barcodeFig?.redraw());
}

/* ── water ─────────────────────────────────────────────────────────────── */
{
  const S = (c) => WDI.series[c];
  const lastOf = (c) => {
    const s = S(c);
    return s ? { year: s.y.at(-1), value: s.v.at(-1) } : null;
  };

  const tiles = [
    [lastOf("ER.H2O.FWTL.ZS"), (d) => Math.round(d.value) + "%",
     (d) => `of the water Uzbekistan's own territory renews is withdrawn each year (${d.year})`],
    [lastOf("ER.H2O.FWAG.ZS"), (d) => Math.round(d.value) + "%",
     (d) => `of all withdrawal goes to agriculture (${d.year})`],
    [lastOf("ER.H2O.FWTL.K3"), (d) => d.value.toFixed(0) + " bn m³",
     (d) => `withdrawn in total (${d.year})`],
    [lastOf("AG.LND.IRIG.AG.ZS"), (d) => d.value.toFixed(0) + "%",
     (d) => `of agricultural land is irrigated (${d.year})`],
  ].filter(([d]) => d);
  const host = document.getElementById("water-stats");
  if (host) {
    host.textContent = "";
    for (const [d, v, k] of tiles) {
      const el = document.createElement("div");
      el.className = "stat";
      const a = document.createElement("span"); a.className = "v"; a.textContent = v(d);
      const b = document.createElement("span"); b.className = "k"; b.textContent = k(d);
      el.append(a, b);
      host.append(el);
    }
  }

  const split = [
    ["ER.H2O.FWAG.ZS", "Agriculture"],
    ["ER.H2O.FWIN.ZS", "Industry"],
    ["ER.H2O.FWDM.ZS", "Households"],
  ].filter(([c]) => S(c));
  if (split.length) {
    const names = split.map(([, l]) => l);
    const data = split.flatMap(([c, label]) =>
      S(c).y.map((y, i) => ({ name: label, x: y, y: S(c).v[i] })));
    figure({
      el: "water-split",
      legend: C.legendFor(names, null, "rect"),
      caption: "Shares of total annual freshwater withdrawal.",
      render: () => C.stackedArea({
        data, width: autoWidth("water-split")(), height: 300,
        label: "% of withdrawal", names,
      }),
      table: () => {
        const years = [...new Set(data.map((d) => d.x))].sort();
        return {
          caption: "Freshwater withdrawal by user, %",
          columns: ["Year", ...names.map((n) => ({ label: n, num: true }))],
          rows: years.map((y) => [y, ...names.map((n) =>
            data.find((d) => d.x === y && d.name === n)?.y ?? null)]),
        };
      },
    });
  }

  if (S("ER.H2O.FWTL.ZS")) {
    const s = S("ER.H2O.FWTL.ZS");
    figure({
      el: "water-stress",
      caption: "Withdrawal as a percentage of internally renewable resources.",
      render: () => {
        const rows = s.y.map((y, i) => ({ x: y, y: s.v[i] }));
        return Plot.plot({
          width: autoWidth("water-stress")(), height: 300,
          marginLeft: 54, marginBottom: 36,
          style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
          x: { label: null, tickFormat: "d" },
          y: { label: "% of renewable supply", labelAnchor: "top", grid: false, nice: true },
          marks: [
            Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
            Plot.areaY(rows, { x: "x", y: "y", fill: token("--series-1"),
                               fillOpacity: 0.1, curve: "monotone-x" }),
            Plot.lineY(rows, { x: "x", y: "y", stroke: token("--series-1"),
                               strokeWidth: 2, curve: "monotone-x" }),
            Plot.ruleY([100], { stroke: token("--critical"), strokeDasharray: "3,3" }),
            Plot.text([{ x: rows[0]?.x, y: 100 }], {
              x: "x", y: "y", text: () => "everything the country renews",
              dy: -7, dx: 3, textAnchor: "start",
              fill: token("--critical"), fontSize: 10.5,
            }),
            Plot.tip(rows, Plot.pointerX({
              x: "x", y: "y", title: (d) => `${d.x}\n${fmt(d.y)}% of renewable supply`,
              fill: token("--surface"), stroke: token("--rule"),
            })),
          ],
        });
      },
      table: () => ({ caption: s.n, columns: ["Year", { label: "%", num: true }],
                      rows: s.y.map((y, i) => [y, s.v[i]]) }),
    });
  }

  // regional networks come from the housing block on the map payload
  const nets = MAP.housing?.utilities ?? {};
  const netKeys = Object.keys(nets).filter((k) => /water|sewer/i.test(k));
  const netSel = document.getElementById("water-metric");
  if (netSel && netKeys.length) {
    for (const k of netKeys) {
      const o = document.createElement("option");
      o.value = k; o.textContent = k;
      netSel.append(o);
    }
    const fig = figure({
      el: "water-regional",
      views: {
        Map: () => {
          const series = nets[netSel.value] ?? {};
          const m = new Map(Object.entries(series).map(([r, pts]) => [r, pts.at(-1)?.[1]]));
          const w = autoWidth("water-regional")();
          const wrap = document.createElement("div");
          wrap.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px";
          wrap.append(
            C.choropleth({
              features: GEO.adm1.features, values: m, width: Math.max(280, w / 2 - 10),
              height: 320, label: netSel.value + ", % of dwellings",
              format: (v) => v.toFixed(1) + "%", nameOf: (f) => f.properties.region,
            }),
            C.hexCartogram({
              values: m, layout: MAP.hexLayout, width: Math.max(280, w / 2 - 10),
              label: netSel.value + ", % of dwellings",
              labelOf: (s) => s.replace(/_/g, " "), format: (v) => v.toFixed(1) + "%",
            })
          );
          return wrap;
        },
        Heatmap: () => C.heatmap({
          data: C.toRows(nets[netSel.value] ?? {}), width: autoWidth("water-regional")(),
          label: "% of dwellings", format: (v) => v.toFixed(1) + "%",
        }),
      },
      defaultView: "Map",
      caption: "stat.uz housing stock series. Latest year shown on the map.",
      table: () => ({
        caption: netSel.value + " by region, % of dwellings",
        columns: ["Region", "Year", { label: "%", num: true }],
        rows: C.toRows(nets[netSel.value] ?? {}).map((d) => [d.region, d.x, d.y]),
      }),
    });
    netSel.addEventListener("change", () => fig?.redraw());
  }

  const climateTopic = WDI.topics.indexOf("Climate change");
  const candidates = Object.entries(WDI.series)
    .filter(([, s]) => s.t.includes(climateTopic) && s.y.length >= 10)
    .sort((a, b) => a[1].n.localeCompare(b[1].n))
    .slice(0, 60);
  const sel = document.getElementById("climate-wdi");
  if (sel && candidates.length) {
    sel.textContent = "";
    for (const [code, s] of candidates) {
      const o = document.createElement("option");
      o.value = code; o.textContent = s.n;
      sel.append(o);
    }
    const pref = candidates.find(([, s]) => /CO2 emissions.*Power|Total greenhouse/i.test(s.n));
    if (pref) sel.value = pref[0];
    const fig = figure({
      el: "climate-wdi-chart",
      caption: "World Bank climate-change indicators for Uzbekistan.",
      render: () => {
        const s = WDI.series[sel.value];
        return C.multiLine({
          data: s.y.map((y, i) => ({ name: s.n, x: y, y: s.v[i] })),
          width: autoWidth("climate-wdi-chart")(), height: 320,
          label: unitOf(s.n), names: [s.n],
        });
      },
      table: () => {
        const s = WDI.series[sel.value];
        return { caption: s.n, columns: ["Year", { label: "Value", num: true }], rows: s.y.map((y, i) => [y, s.v[i]]) };
      },
    });
    sel.addEventListener("change", () => fig?.redraw());
  }
}

function unitOf(name) {
  const m = name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : name;
}
