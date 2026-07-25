import { boot, load, figure, autoWidth, token, fmt, titleCase, Plot, d3 } from "../atlas.js";
import * as C from "../charts.js";

await boot();
const [E, GEO, MAP] = await load("energy", "geo", "map");

const nice = (s) => s.replace(/_/g, " ").replace(/\b\d{3,4}$/, "").trim();

/* ── gas balance ───────────────────────────────────────────────────────── */
{
  const rows = [];
  for (const r of E.gasBalance) {
    rows.push({ name: "Production", x: r.year, y: r.production, src: "statuz" });
    rows.push({ name: "Consumption", x: r.year, y: r.consumption, src: "statuz" });
  }
  const long = [];
  if (E.gasLongRun) {
    for (const [y, v] of E.gasLongRun.production) long.push({ name: "Production", x: y, y: v });
    for (const [y, v] of E.gasLongRun.consumption) long.push({ name: "Consumption", x: y, y: v });
  }
  const names = ["Production", "Consumption"];
  const pal = [token("--series-1"), token("--series-2")];
  figure({
    el: "gas-balance",
    legend: names.map((n, i) => ({ label: n, color: pal[i], kind: "line" })),
    caption: "Solid: stat.uz national balance. Faint: Energy Institute long-run series.",
    render: () => {
      const w = autoWidth("gas-balance")();
      return Plot.plot({
        width: w, height: 340, marginLeft: 62, marginBottom: 36,
        style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
        x: { label: null, tickFormat: "d" },
        y: { label: "million m³", labelAnchor: "top", grid: false, nice: true },
        marks: [
          Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
          long.length ? Plot.lineY(long, {
            x: "x", y: "y", z: "name",
            stroke: (d) => pal[names.indexOf(d.name)],
            strokeWidth: 1.1, strokeOpacity: 0.45, curve: "monotone-x",
          }) : null,
          Plot.lineY(rows, {
            x: "x", y: "y", z: "name",
            stroke: (d) => pal[names.indexOf(d.name)], strokeWidth: 2, curve: "monotone-x",
          }),
          Plot.tip(rows, Plot.pointerX({
            x: "x", y: "y", z: "name",
            title: (d) => `${d.name}\n${d.x}: ${fmt(d.y)} mln m³`,
            fill: token("--surface"), stroke: token("--rule"),
          })),
        ].filter(Boolean),
      });
    },
    table: () => ({
      caption: "National natural gas balance, million m³ (stat.uz)",
      columns: ["Year", { label: "Production", num: true }, { label: "Consumption", num: true }, { label: "Net", num: true }],
      rows: E.gasBalance.map((r) => [r.year, r.production, r.consumption, r.net]),
    }),
  });

  figure({
    el: "gas-net",
    caption: "Positive is an export surplus; negative is a net import bill.",
    render: () => {
      const w = autoWidth("gas-net")();
      return Plot.plot({
        width: w, height: 300, marginLeft: 62, marginBottom: 36,
        style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
        x: { label: null, tickFormat: "d", interval: 2 },
        y: { label: "million m³", labelAnchor: "top", grid: false, nice: true },
        marks: [
          Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
          Plot.barY(E.gasBalance, {
            x: "year", y: "net",
            fill: (d) => (d.net >= 0 ? token("--div-pos-2") : token("--div-neg-2")),
            insetLeft: 2, insetRight: 2, rx: 2,
          }),
          Plot.ruleY([0], { stroke: token("--ink-muted") }),
          Plot.tip(E.gasBalance, Plot.pointerX({
            x: "year", y: "net",
            title: (d) => `${d.year}\n${d.net >= 0 ? "surplus" : "deficit"} ${fmt(Math.abs(d.net))} mln m³`,
            fill: token("--surface"), stroke: token("--rule"),
          })),
        ],
      });
    },
    table: () => ({
      caption: "Net gas balance, million m³",
      columns: ["Year", { label: "Net balance", num: true }],
      rows: E.gasBalance.map((r) => [r.year, r.net]),
    }),
  });
}

/* ── flow diagrams ─────────────────────────────────────────────────────── */
{
  const pretty = (s) => s.replace(/_/g, " ");
  const prod = E.electricityProduction ?? {};
  const cons = E.electricityConsumption ?? {};
  let which = "elec";

  const yearsFor = (kind) => {
    if (kind === "gas") return E.gasBalance.map((r) => r.year);
    const a = new Set(Object.values(prod).flat().map((p) => p[0]));
    return [...new Set(Object.values(cons).flat().map((p) => p[0]))]
      .filter((y) => a.has(y)).sort((x, y) => x - y);
  };

  const sel = document.getElementById("sankey-year");
  const note = document.getElementById("sankey-note");

  function fillYears() {
    const prev = sel.value;
    const years = yearsFor(which);
    sel.textContent = "";
    for (const y of years) {
      const o = document.createElement("option");
      o.value = String(y); o.textContent = String(y);
      sel.append(o);
    }
    sel.value = years.map(String).includes(prev) ? prev : String(years.at(-1) ?? "");
  }
  fillYears();

  const at = (series, region, year) =>
    series[region]?.find((p) => p[0] === year)?.[1] ?? null;

  /* Electricity: regions feed the grid, the grid feeds regions, and the gap
     between the two published series is shown as its own node rather than
     quietly dropped. */
  function elecGraph(year) {
    const GRID = "National grid";
    const RESID = "Losses & own use";
    const nodes = [{ name: GRID, color: token("--ink-2") }];
    const links = [];
    let totalIn = 0, totalOut = 0;

    for (const region of Object.keys(prod).sort()) {
      const v = at(prod, region, year);
      if (!v || v <= 0) continue;
      nodes.push({ name: "p:" + region, color: token("--series-1") });
      links.push({ source: "p:" + region, target: GRID, value: v });
      totalIn += v;
    }
    for (const region of Object.keys(cons).sort()) {
      const v = at(cons, region, year);
      if (!v || v <= 0) continue;
      nodes.push({ name: "c:" + region, color: token("--series-3") });
      links.push({ source: GRID, target: "c:" + region, value: v });
      totalOut += v;
    }
    const residual = totalIn - totalOut;
    if (residual > 0) {
      nodes.push({ name: RESID, color: token("--series-mute") });
      links.push({ source: GRID, target: RESID, value: residual });
    }
    return { nodes, links, totalIn, totalOut, residual };
  }

  /* Gas: production and imports in, domestic use and exports out. The net
     balance in the source data makes this an exact identity. */
  function gasGraph(year) {
    const row = E.gasBalance.find((r) => r.year === year);
    if (!row) return null;
    const DOM = "Domestic consumption";
    const nodes = [
      { name: "Production", color: token("--series-1") },
      { name: DOM, color: token("--series-3") },
    ];
    const links = [];
    const domesticFromProd = Math.min(row.production, row.consumption);
    links.push({ source: "Production", target: DOM, value: domesticFromProd });
    if (row.production > row.consumption) {
      nodes.push({ name: "Exports", color: token("--series-4") });
      links.push({ source: "Production", target: "Exports",
                   value: row.production - row.consumption });
    }
    if (row.consumption > row.production) {
      nodes.push({ name: "Imports", color: token("--series-2") });
      links.push({ source: "Imports", target: DOM,
                   value: row.consumption - row.production });
    }
    return { nodes, links, row };
  }

  const fig = figure({
    el: "sankey",
    render: () => {
      const year = Number(sel.value);
      const w = autoWidth("sankey")();
      if (which === "gas") {
        const g = gasGraph(year);
        if (!g) throw new Error("no gas data for " + year);
        return C.sankeyChart({
          nodes: g.nodes, links: g.links, width: w, height: 300,
          format: (v) => fmt(v) + " mln m³",
          nodeLabel: (d) => d.name,
        });
      }
      const g = elecGraph(year);
      return C.sankeyChart({
        nodes: g.nodes, links: g.links, width: w,
        height: Math.max(420, Object.keys(cons).length * 34 + 80),
        format: (v) => fmt(v) + " GWh",
        nodeLabel: (d) => pretty(d.name.replace(/^[pc]:/, "")),
      });
    },
    table: () => {
      const year = Number(sel.value);
      if (which === "gas") {
        const g = gasGraph(year);
        return {
          caption: `Natural gas balance, ${year} (million m³)`,
          columns: ["From", "To", { label: "Million m³", num: true }],
          rows: g.links.map((l) => [l.source, l.target, l.value]),
        };
      }
      const g = elecGraph(year);
      return {
        caption: `Electricity, ${year} (GWh). Generation ${fmt(g.totalIn)}, metered use ${fmt(g.totalOut)}.`,
        columns: ["From", "To", { label: "GWh", num: true }],
        rows: g.links.map((l) => [
          pretty(String(l.source).replace(/^[pc]:/, "")),
          pretty(String(l.target).replace(/^[pc]:/, "")),
          l.value,
        ]),
      };
    },
  });

  function refreshNote() {
    const year = Number(sel.value);
    if (which === "gas") {
      const row = E.gasBalance.find((r) => r.year === year);
      note.textContent = row
        ? `stat.uz national gas balance. In ${year} the country ${row.net >= 0 ? "exported" : "imported"} ${fmt(Math.abs(row.net))} million m³ ${row.net >= 0 ? "beyond" : "on top of"} domestic use.`
        : "";
    } else {
      const g = elecGraph(year);
      note.textContent =
        `Left: what each region generated. Right: what each region's metered subscribers used. ` +
        `The ${fmt(g.residual)} GWh third branch is the difference between the two published ` +
        `stat.uz series — transmission losses, station own-use and unmetered supply. It is a ` +
        `residual, not a measured quantity.`;
    }
  }
  refreshNote();

  document.getElementById("sankey-pick").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    which = b.dataset.s;
    e.currentTarget.querySelectorAll("button").forEach((x) =>
      x.setAttribute("aria-pressed", String(x === b)));
    fillYears();
    fig?.redraw();
    refreshNote();
  });
  sel.addEventListener("change", () => { fig?.redraw(); refreshNote(); });
}

/* ── electricity mix ───────────────────────────────────────────────────── */
if (E.elecMix) {
  const names = Object.keys(E.elecMix.sources);
  const data = [];
  names.forEach((n) => {
    E.elecMix.years.forEach((y, i) => {
      const v = E.elecMix.sources[n][i];
      if (v != null) data.push({ name: n, x: y, y: v });
    });
  });
  figure({
    el: "elec-mix",
    legend: C.legendFor(names, null, "rect"),
    caption: "Terawatt-hours generated, by source.",
    render: () => C.stackedArea({ data, width: autoWidth("elec-mix")(), height: 360, label: "TWh", names }),
    table: () => ({
      caption: "Electricity generation by source, TWh",
      columns: ["Year", ...names.map((n) => ({ label: n, num: true }))],
      rows: E.elecMix.years.map((y, i) => [y, ...names.map((n) => E.elecMix.sources[n][i])]),
    }),
  });
}

/* ── gas access by region ──────────────────────────────────────────────── */
if (E.gasAccess) {
  const regions = Object.keys(E.gasAccess);
  const years = [...new Set(Object.values(E.gasAccess).flat().map((p) => p[0]))].sort();
  const sel = document.getElementById("access-year");
  if (sel) {
    sel.textContent = "";
    for (const y of years) {
      const o = document.createElement("option");
      o.value = String(y); o.textContent = String(y);
      sel.append(o);
    }
    sel.value = String(years.at(-1));
  }

  const valuesFor = (year) =>
    regions
      .map((r) => {
        const hit = E.gasAccess[r].find((p) => p[0] === year);
        return hit ? { name: r.replace(/_/g, " "), value: hit[1] } : null;
      })
      .filter(Boolean);

  const producers = new Set(["Bukhara", "Kashkadarya", "Surkhandarya"]);
  const accessFig = figure({
    el: "gas-access",
    legend: [
      { label: "Gas-producing region", color: token("--series-2"), kind: "rect" },
      { label: "Everywhere else", color: token("--seq-4"), kind: "rect" },
    ],
    caption: "Share of homes connected to piped natural gas.",
    render: () => {
      const year = Number(sel?.value || years.at(-1));
      return C.rankBar({
        data: valuesFor(year),
        width: autoWidth("gas-access")(),
        label: `% of homes with piped gas, ${year}`,
        highlight: (d) => producers.has(d.name),
        format: (v) => v.toFixed(1) + "%",
      });
    },
    table: () => {
      const year = Number(sel?.value || years.at(-1));
      return {
        caption: `Homes with piped natural gas, ${year} (stat.uz environment/1243)`,
        columns: ["Region", { label: "% of homes", num: true }, "Gas producer"],
        rows: valuesFor(year)
          .sort((a, b) => b.value - a.value)
          .map((d) => [d.name, d.value, producers.has(d.name) ? "yes" : "—"]),
      };
    },
  });
  sel?.addEventListener("change", () => accessFig?.redraw());

  const panel = C.toRows(E.gasAccess);
  figure({
    el: "gas-access-time",
    views: C.panelViews({
      el: "gas-access-time", data: () => panel,
      label: "% of homes", columns: 3,
      format: (v) => v.toFixed(1) + "%",
      features: GEO.adm1.features, hexLayout: MAP.hexLayout,
    }),
    defaultView: "Map",
    caption: (v) => C.panelCaption(v),
    table: () => ({
      caption: "Homes with piped natural gas by region, %",
      columns: ["Region", "Year", { label: "% of homes", num: true }],
      rows: panel.map((d) => [d.region, d.x, d.y]),
    }),
  });
}

/* ── regional electricity series ───────────────────────────────────────── */
{
  const opts = [
    ["electricityProduction", "Electricity production"],
    ["electricityConsumption", "Electricity consumption by subscribers"],
    ["thermalProduction", "Thermal energy production"],
  ].filter(([k]) => E[k]);
  const sel = document.getElementById("elec-series");
  const idx = document.getElementById("elec-index");
  if (sel) {
    sel.textContent = "";
    for (const [k, label] of opts) {
      const o = document.createElement("option");
      o.value = k; o.textContent = label;
      sel.append(o);
    }
  }
  if (opts.length) {
    const rows = () => C.toRows(E[sel?.value || opts[0][0]]);
    const fig = figure({
      el: "elec-regional",
      views: C.panelViews({
        el: "elec-regional", data: rows,
        label: () => opts.find(([k]) => k === (sel?.value || opts[0][0]))?.[1] ?? "value",
        index: () => !!idx?.checked, columns: 3,
        features: GEO.adm1.features, hexLayout: MAP.hexLayout,
      }),
      defaultView: "Map",
      caption: (v) => C.panelCaption(v),
      table: () => ({
        caption: opts.find(([k]) => k === (sel?.value || opts[0][0]))?.[1] ?? "",
        columns: ["Region", "Year", { label: "Value", num: true }],
        rows: C.toRows(E[sel?.value || opts[0][0]]).map((d) => [d.region, d.x, d.y]),
      }),
    });
    sel?.addEventListener("change", () => fig?.redraw());
    idx?.addEventListener("change", () => fig?.redraw());
  }
}

/* ── national WDI indicators ───────────────────────────────────────────── */
{
  const picks = [
    ["accessElectricity", "Access to electricity, % of population"],
    ["accessRural", "Access to electricity, rural %"],
    ["gridLosses", "Transmission and distribution losses, % of output"],
    ["firmsOutages", "Firms reporting electrical outages, %"],
    ["elecPerCapita", "Electric power consumption, kWh per capita"],
    ["gasRents", "Natural gas rents, % of GDP"],
    ["fuelExportShare", "Fuel exports, % of merchandise exports"],
    ["energyImportsNet", "Net energy imports, % of energy use"],
  ].filter(([k]) => E.wdi?.[k]);
  const sel = document.getElementById("elec-wdi");
  if (sel) {
    sel.textContent = "";
    for (const [k, label] of picks) {
      const o = document.createElement("option");
      o.value = k; o.textContent = label;
      sel.append(o);
    }
    sel.value = "gasRents" in (E.wdi ?? {}) ? "gasRents" : picks[0]?.[0];
  }
  if (picks.length) {
    const fig = figure({
      el: "elec-wdi-chart",
      caption: "World Bank World Development Indicators.",
      render: () => {
        const k = sel?.value || picks[0][0];
        const s = E.wdi[k];
        const data = s.points.map(([x, y]) => ({ name: s.name, x, y }));
        return C.multiLine({ data, width: autoWidth("elec-wdi-chart")(), height: 300, label: shortUnit(s.name), names: [s.name] });
      },
      table: () => {
        const k = sel?.value || picks[0][0];
        const s = E.wdi[k];
        return { caption: s.name, columns: ["Year", { label: "Value", num: true }], rows: s.points };
      },
    });
    sel?.addEventListener("change", () => fig?.redraw());
  }
}

function shortUnit(name) {
  const m = name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : name.length > 34 ? name.slice(0, 32) + "…" : name;
}
