import { boot, load, figure, autoWidth, token, fmt, Plot, d3 } from "../atlas.js";
import * as C from "../charts.js";

await boot();
const [CL, GEO, WDI] = await load("climate", "geo", "wdi");

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

  const fig = figure({
    el: "clim-series",
    views: C.panelViews({
      el: "clim-series", data: () => C.toRows(CL.adm1[metric]),
      label: () => (metric === "rain" ? "rainfall, mm" : "NDVI"),
      index: () => !!idx?.checked,
      format: (v) => (metric === "rain" ? v.toFixed(0) + " mm" : v.toFixed(3)),
    }),
    defaultView: "Heatmap",
    caption: (v) => C.panelCaption(v) + " Ten-day satellite composites.",
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
    fig?.redraw();
    barcodeFig?.redraw();
  });
  idx?.addEventListener("change", () => fig?.redraw());
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

/* ── water & climate WDI ───────────────────────────────────────────────── */
{
  const water = [
    ["AG.LND.IRIG.AG.ZS", "Irrigated share of agricultural land (%)"],
    ["ER.H2O.FWAG.ZS", "Agriculture's share of freshwater withdrawal (%)"],
  ].filter(([c]) => WDI.series[c]);
  if (water.length) {
    const names = water.map(([, l]) => l);
    const data = water.flatMap(([c, label]) =>
      WDI.series[c].y.map((y, i) => ({ name: label, x: y, y: WDI.series[c].v[i] })));
    figure({
      el: "water-wdi",
      legend: C.legendFor(names, null, "line"),
      caption: "Both are percentages, so they share one axis.",
      render: () => C.multiLine({ data, width: autoWidth("water-wdi")(), height: 300, label: "%", names }),
      table: () => {
        const years = [...new Set(data.map((d) => d.x))].sort();
        return {
          caption: "Irrigation and freshwater withdrawal",
          columns: ["Year", ...names.map((n) => ({ label: n, num: true }))],
          rows: years.map((y) => [y, ...names.map((n) => data.find((d) => d.x === y && d.name === n)?.y ?? null)]),
        };
      },
    });
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
