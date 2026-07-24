import { boot, load, figure, autoWidth, token, fmt, reformRule, Plot, d3 } from "../atlas.js";
import * as C from "../charts.js";

await boot();
const M = await load("people");

const short = (s) => (s.length > 30 ? s.slice(0, 28) + "…" : s);

/* ── employment composition ────────────────────────────────────────────── */
if (M.employmentShare) {
  // 8 categorical slots is the ceiling — everything past the seven largest
  // sectors folds into "Other" rather than inventing a ninth hue.
  const last = Object.fromEntries(
    Object.entries(M.employmentShare).map(([k, v]) => [k, v.at(-1)?.[1] ?? 0]));
  const ranked = Object.keys(M.employmentShare).sort((a, b) => last[b] - last[a]);
  const top = ranked.slice(0, 7);
  const rest = ranked.slice(7);
  const years = [...new Set(Object.values(M.employmentShare).flat().map((p) => p[0]))].sort();

  const data = [];
  for (const k of top) {
    for (const [x, y] of M.employmentShare[k]) data.push({ name: short(k), x, y });
  }
  if (rest.length) {
    for (const x of years) {
      const y = d3.sum(rest, (k) => M.employmentShare[k].find((p) => p[0] === x)?.[1] ?? 0);
      if (y) data.push({ name: "Other sectors", x, y });
    }
  }
  const names = [...top.map(short), ...(rest.length ? ["Other sectors"] : [])];

  figure({
    el: "emp-share",
    legend: C.legendFor(names, null, "rect"),
    caption: rest.length
      ? `Seven largest sectors; the remaining ${rest.length} are grouped as "Other sectors".`
      : "Share of everyone employed.",
    render: () => C.stackedArea({
      data, width: autoWidth("emp-share")(), height: 360, label: "% of employment", names,
    }),
    table: () => ({
      caption: "Employment by sector, % of everyone employed (stat.uz)",
      columns: ["Year", ...names.map((n) => ({ label: n, num: true }))],
      rows: years.map((y) => [y, ...names.map((n) => data.find((d) => d.x === y && d.name === n)?.y ?? null)]),
    }),
  });
}

if (M.publicShare?.length) {
  figure({
    el: "public-share",
    caption: "Public-sector employment as a share of the total.",
    render: () => C.multiLine({
      data: M.publicShare.map(([x, y]) => ({ name: "Public sector", x, y })),
      width: autoWidth("public-share")(), height: 280,
      label: "% of employment", names: ["Public sector"],
    }),
    table: () => ({
      caption: "Public-sector employment share, %",
      columns: ["Year", { label: "% of employment", num: true }],
      rows: M.publicShare,
    }),
  });
}

/* ── real wages ────────────────────────────────────────────────────────── */
if (M.wagesReal) {
  const idx = document.getElementById("wage-index");
  const panel = [];
  for (const [k, pts] of Object.entries(M.wagesReal)) {
    for (const [x, y] of pts) panel.push({ region: short(k), x, y });
  }
  const fig = figure({
    el: "wages",
    // Horizon first: there are more sectors than any colour scheme can name,
    // and the question here is magnitude over time, not identity.
    views: C.panelViews({
      el: "wages", data: () => panel, label: "real wage bill, 2017 soum",
      index: () => !!idx?.checked, rowHeight: 26,
    }),
    defaultView: "Horizon",
    caption: (v) => C.panelCaption(v, "sector") + " Deflated to 2017 soum.",
    table: () => ({
      caption: "Real wage bill by sector, 2017 soum",
      columns: ["Sector", "Year", { label: "2017 soum", num: true }],
      rows: panel.map((d) => [d.region, d.x, d.y]),
    }),
  });
  idx?.addEventListener("change", () => fig?.redraw());
}

/* ── migration ─────────────────────────────────────────────────────────── */
if (M.migration?.length) {
  const names = ["Has a member abroad", "Considering migration", "Has someone returned"];
  const data = M.migration.flatMap((r) => [
    { name: names[0], x: new Date(r.date), y: r.abroad },
    { name: names[1], x: new Date(r.date), y: r.considering },
    { name: names[2], x: new Date(r.date), y: r.returned },
  ]).filter((d) => d.y != null);

  figure({
    el: "migration",
    legend: C.legendFor(names, null, "line"),
    caption: "Share of surveyed households, by round.",
    render: () => {
      const w = autoWidth("migration")();
      const pal = C.legendFor(names).map((d) => d.color);
      const color = new Map(names.map((n, i) => [n, pal[i]]));
      return Plot.plot({
        width: w, height: 340, marginLeft: 54, marginBottom: 36,
        style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
        x: { label: null },
        y: { label: "% of households", labelAnchor: "top", grid: false, nice: true },
        marks: [
          Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
          ...reformRule("1 May 2024 tariff"),
          Plot.lineY(data, { x: "x", y: "y", z: "name", stroke: (d) => color.get(d.name), strokeWidth: 2 }),
          Plot.tip(data, Plot.pointerX({
            x: "x", y: "y", z: "name",
            title: (d) => `${d.name}\n${d.x.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}: ${fmt(d.y)}%`,
            fill: token("--surface"), stroke: token("--rule"),
          })),
        ],
      });
    },
    table: () => ({
      caption: "Migration indicators, % of households (L2CU)",
      columns: ["Round date", { label: "Member abroad %", num: true },
                { label: "Considering %", num: true }, { label: "Returned %", num: true }],
      rows: M.migration.map((r) => [r.date, r.abroad, r.considering, r.returned]),
    }),
  });
}

if (M.wdi?.remittancesGdp) {
  const s = M.wdi.remittancesGdp;
  figure({
    el: "remittances",
    caption: "Personal remittances received, % of GDP.",
    render: () => C.multiLine({
      data: s.points.map(([x, y]) => ({ name: "Remittances", x, y })),
      width: autoWidth("remittances")(), height: 280, label: "% of GDP", names: ["Remittances"],
    }),
    table: () => ({ caption: s.name, columns: ["Year", { label: "% of GDP", num: true }], rows: s.points }),
  });
}

/* ── regional health ───────────────────────────────────────────────────── */
if (M.health && Object.keys(M.health).length) {
  const metrics = Object.keys(M.health);
  const sel = document.getElementById("health-metric");
  const idx = document.getElementById("health-index");
  if (sel) {
    sel.textContent = "";
    for (const k of metrics) {
      const o = document.createElement("option");
      o.value = k; o.textContent = k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
      sel.append(o);
    }
  }
  const fig = figure({
    el: "health",
    views: C.panelViews({
      el: "health", data: () => C.toRows(M.health[sel?.value || metrics[0]]),
      label: () => (sel?.value || metrics[0]).replace(/_/g, " "),
      index: () => !!idx?.checked,
    }),
    defaultView: "Heatmap",
    caption: (v) => C.panelCaption(v),
    table: () => ({
      caption: (sel?.value || metrics[0]).replace(/_/g, " ") + " by region",
      columns: ["Region", "Year", { label: "Value", num: true }],
      rows: C.toRows(M.health[sel?.value || metrics[0]]).map((d) => [d.region, d.x, d.y]),
    }),
  });
  sel?.addEventListener("change", () => fig?.redraw());
  idx?.addEventListener("change", () => fig?.redraw());
}

/* ── national indicators ───────────────────────────────────────────────── */
{
  const picks = [
    ["population", "Population, total"],
    ["urbanShare", "Urban population (% of total)"],
    ["povertyNational", "Poverty headcount at national lines (%)"],
    ["unemployment", "Unemployment (% of labour force)"],
    ["internetUsers", "Individuals using the internet (%)"],
  ].filter(([k]) => M.wdi?.[k]);
  const sel = document.getElementById("people-wdi");
  if (sel) {
    sel.textContent = "";
    for (const [k, l] of picks) {
      const o = document.createElement("option");
      o.value = k; o.textContent = l;
      sel.append(o);
    }
    if (picks.some(([k]) => k === "povertyNational")) sel.value = "povertyNational";
  }
  if (picks.length) {
    const fig = figure({
      el: "people-wdi-chart",
      caption: "World Bank World Development Indicators.",
      render: () => {
        const s = M.wdi[sel?.value || picks[0][0]];
        return C.multiLine({
          data: s.points.map(([x, y]) => ({ name: s.name, x, y })),
          width: autoWidth("people-wdi-chart")(), height: 300,
          label: unitOf(s.name), names: [s.name],
        });
      },
      table: () => {
        const s = M.wdi[sel?.value || picks[0][0]];
        return { caption: s.name, columns: ["Year", { label: "Value", num: true }], rows: s.points };
      },
    });
    sel?.addEventListener("change", () => fig?.redraw());
  }
}

if (M.wdi?.tertiaryGpi) {
  const s = M.wdi.tertiaryGpi;
  figure({
    el: "tertiary-gpi",
    caption: "Gender parity index for tertiary enrolment. 1.0 is parity.",
    render: () => {
      const w = autoWidth("tertiary-gpi")();
      const rows = s.points.map(([x, y]) => ({ x, y }));
      return Plot.plot({
        width: w, height: 290, marginLeft: 52, marginBottom: 36,
        style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
        x: { label: null, tickFormat: "d" },
        y: { label: "women per man enrolled", labelAnchor: "top", grid: false, nice: true },
        marks: [
          Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
          Plot.ruleY([1], { stroke: token("--ink-muted"), strokeDasharray: "3,3" }),
          Plot.text([{ x: rows[0]?.x, y: 1 }], {
            x: "x", y: "y", text: () => "parity", dy: -7, dx: 2,
            textAnchor: "start", fill: token("--ink-muted"), fontSize: 10.5,
          }),
          Plot.lineY(rows, { x: "x", y: "y", stroke: token("--series-1"), strokeWidth: 2, curve: "monotone-x" }),
          Plot.tip(rows, Plot.pointerX({
            x: "x", y: "y", title: (d) => `${d.x}\n${d.y.toFixed(2)} women per man`,
            fill: token("--surface"), stroke: token("--rule"),
          })),
        ],
      });
    },
    table: () => ({ caption: s.name, columns: ["Year", { label: "GPI", num: true }], rows: s.points }),
  });
}

function unitOf(name) {
  const m = name.match(/\(([^)]+)\)\s*$/);
  return m ? m[1] : name;
}
