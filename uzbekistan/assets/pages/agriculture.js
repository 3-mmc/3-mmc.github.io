import { boot, load, figure, autoWidth, token, fmt, Plot, d3 } from "../atlas.js";
import * as C from "../charts.js";

await boot();
const [A, GEO, MAP] = await load("agriculture", "geo", "map");

const nice = (s) => s.replace(/_/g, " ").replace(/_?\d{3,4}$/, "").trim()
  .replace(/^./, (c) => c.toUpperCase());

/* ── producer prices ───────────────────────────────────────────────────── */
if (A.producerPrices) {
  const items = Object.keys(A.producerPrices).sort();
  const sel = document.getElementById("pp-item");
  const idx = document.getElementById("pp-index");
  if (sel) {
    sel.textContent = "";
    for (const it of items) {
      const o = document.createElement("option");
      o.value = it; o.textContent = it;
      sel.append(o);
    }
    const cotton = items.find((k) => /cotton/i.test(k));
    if (cotton) sel.value = cotton;
  }

  const fig = figure({
    el: "pp-chart",
    caption: "FAO annual producer prices, US dollars per tonne.",
    render: () => {
      const item = sel?.value || items[0];
      let pts = A.producerPrices[item];
      if (idx?.checked) pts = C.indexed(pts);
      const data = pts.map(([x, y]) => ({ name: item, x, y }));
      return C.multiLine({
        data, width: autoWidth("pp-chart")(), height: 320,
        label: idx?.checked ? "index, first year = 100" : "US$ / tonne",
        names: [item],
      });
    },
    table: () => {
      const item = sel?.value || items[0];
      return {
        caption: `${item} — producer price, US$ per tonne`,
        columns: ["Year", { label: "US$/tonne", num: true }],
        rows: A.producerPrices[item],
      };
    },
  });
  sel?.addEventListener("change", () => fig?.redraw());
  idx?.addEventListener("change", () => fig?.redraw());

  /* the barcode: every commodity's 2022→2024 change on one axis */
  const changes = [];
  for (const [item, pts] of Object.entries(A.producerPrices)) {
    const a = pts.find((p) => p[0] === 2022);
    const b = pts.find((p) => p[0] === 2024);
    if (a && b && a[1]) changes.push({ label: item, value: (100 * (b[1] - a[1])) / a[1] });
  }
  changes.sort((a, b) => a.value - b.value);
  if (changes.length) {
    const isCotton = (d) => /cotton/i.test(d.label);
    figure({
      el: "pp-barcode",
      legend: [
        { label: "Cotton", color: token("--series-2"), kind: "line" },
        { label: `Other commodities (${changes.filter((d) => !isCotton(d)).length})`, color: token("--series-1"), kind: "line" },
      ],
      caption: `Each tick is one commodity. Median change ${fmt(d3.median(changes, (d) => d.value))}%.`,
      render: () => C.barcode({
        values: changes,
        width: autoWidth("pp-barcode")(),
        height: 170,
        label: "change in producer price, 2022 → 2024 (%)",
        highlight: isCotton,
        format: (v) => (v > 0 ? "+" : "") + v.toFixed(0) + "%",
      }),
      table: () => ({
        caption: "Producer price change 2022 → 2024, every FAO commodity",
        columns: ["Commodity", { label: "Change %", num: true }],
        rows: changes.map((d) => [d.label, Number(d.value.toFixed(1))]),
      }),
    });
  }
}

/* ── regional production ───────────────────────────────────────────────── */
if (A.production && Object.keys(A.production).length) {
  const keys = Object.keys(A.production).sort();
  const sel = document.getElementById("crop-series");
  const idx = document.getElementById("crop-index");
  if (sel) {
    sel.textContent = "";
    for (const k of keys) {
      const o = document.createElement("option");
      o.value = k; o.textContent = nice(k);
      sel.append(o);
    }
    const wheat = keys.find((k) => /wheat/i.test(k));
    if (wheat) sel.value = wheat;
  }

  const current = () => A.production[sel?.value || keys[0]];

  const fig = figure({
    el: "crop-chart",
    views: C.panelViews({
      el: "crop-chart", data: () => C.toRows(current()),
      label: () => nice(sel?.value || keys[0]),
      index: () => !!idx?.checked,
      features: GEO.adm1.features, hexLayout: MAP.hexLayout,
    }),
    defaultView: "Map",
    caption: (v) => C.panelCaption(v),
    table: () => ({
      caption: nice(sel?.value || keys[0]) + " by region",
      columns: ["Region", "Year", { label: "Value", num: true }],
      rows: C.toRows(current()).map((d) => [d.region, d.x, d.y]),
    }),
  });

  const rankFig = figure({
    el: "crop-rank",
    caption: "Most recent year available for the selected series.",
    render: () => {
      const series = current();
      const rows = Object.entries(series)
        .map(([r, pts]) => {
          const last = pts.at(-1);
          return last ? { name: r.replace(/_/g, " "), value: last[1], year: last[0] } : null;
        })
        .filter(Boolean);
      return C.rankBar({
        data: rows, width: autoWidth("crop-rank")(),
        label: nice(sel?.value || keys[0]),
      });
    },
    table: () => {
      const series = current();
      return {
        caption: nice(sel?.value || keys[0]) + ", latest year by region",
        columns: ["Region", "Year", { label: "Value", num: true }],
        rows: Object.entries(series)
          .map(([r, pts]) => [r.replace(/_/g, " "), pts.at(-1)?.[0], pts.at(-1)?.[1]])
          .sort((a, b) => (b[2] ?? 0) - (a[2] ?? 0)),
      };
    },
  });

  sel?.addEventListener("change", () => { fig?.redraw(); rankFig?.redraw(); });
  idx?.addEventListener("change", () => fig?.redraw());
}

/* ── WDI ───────────────────────────────────────────────────────────────── */
{
  const picks = [
    ["agValueAddedShare", "Agriculture, value added (% of GDP)"],
    ["employmentAg", "Employment in agriculture (% of employment)"],
    ["agValueAddedPerWorker", "Value added per worker (constant 2015 US$)"],
    ["cerealYield", "Cereal yield (kg per hectare)"],
    ["cerealProduction", "Cereal production (tonnes)"],
    ["rawMaterialExportShare", "Agricultural raw material exports (% of merchandise exports)"],
  ].filter(([k]) => A.wdi?.[k]);
  const sel = document.getElementById("ag-wdi");
  if (sel) {
    sel.textContent = "";
    for (const [k, label] of picks) {
      const o = document.createElement("option");
      o.value = k; o.textContent = label;
      sel.append(o);
    }
  }
  if (picks.length) {
    const fig = figure({
      el: "ag-wdi-chart",
      caption: "World Bank World Development Indicators.",
      render: () => {
        const k = sel?.value || picks[0][0];
        const s = A.wdi[k];
        return C.multiLine({
          data: s.points.map(([x, y]) => ({ name: s.name, x, y })),
          width: autoWidth("ag-wdi-chart")(), height: 300,
          label: unitOf(s.name), names: [s.name],
        });
      },
      table: () => {
        const s = A.wdi[sel?.value || picks[0][0]];
        return { caption: s.name, columns: ["Year", { label: "Value", num: true }], rows: s.points };
      },
    });
    sel?.addEventListener("change", () => fig?.redraw());
  }

  const waterKeys = [["irrigatedShare", "Irrigated share of agricultural land"],
                     ["freshwaterAg", "Agriculture's share of freshwater withdrawal"]]
    .filter(([k]) => A.wdi?.[k]);
  if (waterKeys.length) {
    const names = waterKeys.map(([, l]) => l);
    const data = waterKeys.flatMap(([k, label]) =>
      A.wdi[k].points.map(([x, y]) => ({ name: label, x, y })));
    figure({
      el: "ag-water",
      legend: C.legendFor(names, null, "line"),
      caption: "Both series are percentages, so they share one axis honestly.",
      render: () => C.multiLine({ data, width: autoWidth("ag-water")(), height: 280, label: "%", names }),
      table: () => {
        const years = [...new Set(data.map((d) => d.x))].sort();
        return {
          caption: "Irrigation and freshwater withdrawal, %",
          columns: ["Year", ...names.map((n) => ({ label: n, num: true }))],
          rows: years.map((y) => [y, ...names.map((n) => data.find((d) => d.x === y && d.name === n)?.y ?? null)]),
        };
      },
    });
  }
}

function unitOf(name) {
  const m = name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : name;
}
