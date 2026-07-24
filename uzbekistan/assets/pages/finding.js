// One chart per finding page. The page declares which via data-finding on
// <body>; each builder returns a figure spec for the shared shell.

import { boot, load, figure, autoWidth, token, fmt, stars, Plot, d3 } from "../atlas.js";
import * as C from "../charts.js";

await boot();

/* helper: pull rows out of a canonical table by outcome */
function tableRows(T, key, outcome) {
  const t = T.tables[key];
  if (!t) return [];
  const ix = Object.fromEntries(t.columns.map((c, i) => [c, i]));
  return t.rows
    .filter((r) => (outcome ? r[ix.outcome] === outcome : true))
    .map((r) => ({
      outcome: r[ix.outcome], term: r[ix.term], beta: r[ix.beta],
      se: r[ix.se], t: r[ix.t], n: r[ix.n], stars: stars(r[ix.t]),
    }));
}

const prettyTerm = (t) =>
  String(t).replace(/p_g_w/g, "post × grid × winter").replace(/p_g/g, "post × grid")
    .replace(/p_w/g, "post × winter").replace(/g_w/g, "grid × winter")
    .replace(/p_a/g, "post × ag-base").replace(/_/g, " ");

function coefFigure(host, { rows, label, caption, title }) {
  return figure({
    el: host,
    caption,
    render: () => C.coefficients({
      data: rows.map((r) => ({ ...r, term: prettyTerm(r.term) })),
      width: autoWidth(host)(), label,
    }),
    table: () => ({
      caption: title,
      columns: ["Term", { label: "β", num: true }, { label: "SE", num: true }, { label: "t", num: true }, "Significance"],
      rows: rows.map((r) => [prettyTerm(r.term), r.beta, r.se, r.t, r.stars || "n.s."]),
    }),
  });
}

/* ──────────────────────────────── builders ────────────────────────────── */
const BUILDERS = {
  /* the reshuffle: two exposures, one dumbbell */
  async reshuffle(host) {
    const F = await load("findings");
    const q = F.notes.reshuffleQuartiles.rows;
    const rows = q.map((d) => ({
      name: `${d.q}${d.label ? " — " + d.label : ""}`,
      from: 24 - d.elecHours, to: d.distress2425, grid: d.gridShare,
    }));
    figure({
      el: host,
      legend: [
        { label: "Hours a day without power, crisis winter 2022/23", color: token("--seq-3"), kind: "rect" },
        { label: "% who couldn't pay a bill, price winter 2024/25", color: token("--seq-5"), kind: "rect" },
      ],
      caption: "The two burdens run in opposite directions across the same households.",
      render: () => C.dumbbell({
        data: rows, width: autoWidth(host)(),
        label: "hours without power  /  % who couldn't pay",
        labels: ["Hours without power (2022/23)", "Couldn't pay % (2024/25)"],
        format: (v) => v.toFixed(1),
      }),
      table: () => ({
        caption: "Households ranked by their 2022/23 rationing burden (n = 1,175)",
        columns: ["Quartile", { label: "Electricity hrs/day", num: true },
                  { label: "Hours without power", num: true },
                  { label: "On the gas grid %", num: true },
                  { label: "Couldn't pay 2024/25 %", num: true }],
        rows: q.map((d) => [`${d.q}${d.label ? " — " + d.label : ""}`, d.elecHours,
                            Number((24 - d.elecHours).toFixed(1)), d.gridShare, d.distress2425]),
      }),
    });
  },

  /* grid access: the barcode of who the tariff could reach */
  async gridAccess(host) {
    const E = await load("energy");
    if (!E.gasAccess) return;
    const years = [...new Set(Object.values(E.gasAccess).flat().map((p) => p[0]))].sort();
    const year = years.at(-1);
    const producers = new Set(["Bukhara", "Kashkadarya", "Surkhandarya"]);
    const values = Object.entries(E.gasAccess)
      .map(([r, pts]) => {
        const hit = pts.find((p) => p[0] === year);
        return hit ? { value: hit[1], label: r.replace(/_/g, " ") } : null;
      })
      .filter(Boolean);
    figure({
      el: host,
      legend: [
        { label: "Gas-producing region", color: token("--series-2"), kind: "line" },
        { label: "Everywhere else", color: token("--series-1"), kind: "line" },
      ],
      caption: `Share of homes on the piped gas grid, by region, ${year}. This — not income — is what decided who the tariff reached.`,
      render: () => C.barcode({
        values, width: autoWidth(host)(), height: 165,
        label: `% of homes with piped natural gas (${year})`,
        highlight: (d) => producers.has(d.label),
        format: (v) => v.toFixed(1) + "%",
      }),
      table: () => ({
        caption: `Homes with piped natural gas, ${year} (stat.uz environment/1243)`,
        columns: ["Region", { label: "% of homes", num: true }],
        rows: values.sort((a, b) => b.value - a.value).map((d) => [d.label, d.value]),
      }),
    });
  },

  /* first stage */
  async frozenBill(host) {
    const F = await load("findings");
    const rows = tableRows(F, "T2").filter((r) => r.beta != null).slice(0, 8);
    coefFigure(host, {
      rows,
      label: "β on log energy payment",
      title: "T2 — first stage: ln(energy payments). Household + calendar-month fixed effects, SE clustered by household.",
      caption: "Estimates with 95% intervals. The winter interaction is where the grid premium lives.",
    });
  },

  /* winter burden */
  async winterBurden(host) {
    const F = await load("findings");
    const b = F.notes.burdenShares;
    const data = b.rows.flatMap((r) => [
      { group: `${r.group} — ${r.basis}`, name: "Before the reform", value: r.pre },
      { group: `${r.group} — ${r.basis}`, name: "After the reform", value: r.post },
    ]);
    figure({
      el: host,
      legend: C.legendFor(["Before the reform", "After the reform"], null, "rect"),
      caption: `Median energy spending as a share of cash income. The triple-difference is +${b.tripleDiff}pp.`,
      render: () => C.groupedBars({
        data, width: autoWidth(host)(), height: 320,
        label: "% of cash income",
        names: ["Before the reform", "After the reform"],
        format: (v) => v.toFixed(1) + "%",
      }),
      table: () => ({
        caption: "Median energy share of cash income, %",
        columns: ["Group", "Months", { label: "Before %", num: true }, { label: "After %", num: true }],
        rows: b.rows.map((r) => [r.group, r.basis, r.pre, r.post]),
      }),
    });
  },

  /* winter triple-difference */
  async heatingBite(host) {
    const F = await load("findings");
    const rows = tableRows(F, "T4").filter((r) => /p_g_w|p_w/.test(String(r.term)));
    coefFigure(host, {
      rows,
      label: "β",
      title: "T4 — winter triple-difference. Winter is December to March.",
      caption: "Each row is one outcome. The triple interaction isolates the heating-season bite on grid households.",
    });
  },

  /* reliability across four winters */
  async reliability(host) {
    const F = await load("findings");
    const rows = F.notes.reliabilityWinters.rows;
    figure({
      el: host,
      caption: "Four winters, four measures. The most reliable winter was also the most financially distressed.",
      render: () => {
        const w = autoWidth(host)();
        const panels = [
          ["elecHours", "Hours of power a day", [14, 24.5], token("--series-1")],
          ["heatDisrupt", "% with heating disrupted", [0, 16], token("--series-3")],
          ["needHeat", "% who needed heating", [60, 92], token("--series-4")],
          ["utilDistress", "% who couldn't pay", [0, 10], token("--series-2")],
        ];
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px";
        for (const [key, label, domain, color] of panels) {
          wrap.append(Plot.plot({
            width: Math.max(220, Math.floor(w / 2) - 12), height: 190,
            marginLeft: 44, marginBottom: 44, marginTop: 22,
            style: { background: "transparent", color: token("--ink-2"), fontSize: "11.5px" },
            x: { domain: rows.map((d) => d.winter), label: null, tickRotate: -35 },
            y: { domain, label, labelAnchor: "top", grid: false },
            marks: [
              Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
              Plot.barY(rows, { x: "winter", y: key, fill: color, insetLeft: 10, insetRight: 10, rx: 2 }),
              Plot.text(rows, { x: "winter", y: key, text: (d) => fmt(d[key]), dy: -7, fontSize: 10.5, fill: token("--ink-2") }),
              Plot.ruleY([domain[0]], { stroke: token("--rule") }),
              Plot.tip(rows, Plot.pointerX({
                x: "winter", y: key,
                title: (d) => `Winter ${d.winter}\n${label}: ${fmt(d[key])}`,
                fill: token("--surface"), stroke: token("--rule"),
              })),
            ],
          }));
        }
        return wrap;
      },
      table: () => ({
        caption: "Winter service quality and payment distress (L2CU)",
        columns: ["Winter", { label: "Electricity hrs/day", num: true }, { label: "Gas disruption %", num: true },
                  { label: "Heat disruption %", num: true }, { label: "Needed heating %", num: true },
                  { label: "Couldn't pay %", num: true }],
        rows: rows.map((d) => [d.winter, d.elecHours, d.gasDisrupt, d.heatDisrupt, d.needHeat, d.utilDistress]),
      }),
    });
  },

  /* event study */
  async eventStudy(host) {
    const F = await load("findings");
    const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
    const key = (w) => {
      const m = String(w).match(/^([A-Z][a-z]{2})(\d{2})/);
      return m ? (2000 + Number(m[2])) * 12 + MON[m[1]] : 0;
    };
    const rows = tableRows(F, "T6")
      .map((r) => ({ ...r, window: String(r.term).replace(/^grid\s*×\s*/, "") }))
      .sort((a, b) => key(a.window) - key(b.window));
    figure({
      el: host,
      caption: "Grid × quarter estimates with 95% intervals, relative to the quarter before the reform. Round fixed effects; SE clustered by household.",
      render: () => {
        const w = autoWidth(host)();
        return Plot.plot({
          width: w, height: 360, marginLeft: 60, marginBottom: 74, marginTop: 16,
          style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
          x: { domain: rows.map((d) => d.window), label: null, tickRotate: -42 },
          y: { label: "β on payment distress", labelAnchor: "top", grid: false, nice: true },
          marks: [
            Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
            Plot.ruleY([0], { stroke: token("--ink-muted") }),
            Plot.ruleX(rows, {
              x: "window", y1: (d) => d.beta - 1.96 * d.se, y2: (d) => d.beta + 1.96 * d.se,
              stroke: token("--series-1"), strokeWidth: 1.4,
            }),
            Plot.dot(rows, {
              x: "window", y: "beta", r: 4.5,
              fill: token("--series-1"), stroke: token("--surface"), strokeWidth: 2,
            }),
            Plot.tip(rows, Plot.pointerX({
              x: "window", y: "beta",
              title: (d) => `${d.window}\nβ ${d.beta.toFixed(4)}${d.stars}\nt = ${d.t?.toFixed(1) ?? "—"}`,
              fill: token("--surface"), stroke: token("--rule"),
            })),
          ],
        });
      },
      table: () => ({
        caption: "T6 — event study, grid × quarter windows",
        columns: ["Window", { label: "β", num: true }, { label: "SE", num: true }, { label: "t", num: true }, "Significance"],
        rows: rows.map((d) => [d.window, d.beta, d.se, d.t, d.stars || "n.s."]),
      }),
    });
  },

  /* two-sided recomposition */
  async recomposition(host) {
    const F = await load("findings");
    const rows = tableRows(F, "T3").filter((r) => r.beta != null);
    const outcomes = [...new Set(rows.map((r) => r.outcome))];
    figure({
      el: host,
      caption: "Both arms in one model: the loss side (post × grid) and the gain side (post × ag-base).",
      render: () => {
        const data = rows.map((r) => ({
          term: `${r.outcome} — ${prettyTerm(r.term)}`,
          beta: r.beta, se: r.se, t: r.t, stars: r.stars,
        }));
        return C.coefficients({ data, width: autoWidth(host)(), label: "β" });
      },
      table: () => ({
        caption: "T3 — two-sided recomposition",
        columns: ["Outcome", "Term", { label: "β", num: true }, { label: "SE", num: true }, { label: "t", num: true }, "Significance"],
        rows: rows.map((r) => [r.outcome, prettyTerm(r.term), r.beta, r.se, r.t, r.stars || "n.s."]),
      }),
    });
  },

  /* the CPI placebo */
  async cpiPeers(host) {
    const F = await load("findings");
    const rows = F.notes.cpiPeers.rows.map((d) => ({ name: d.country, from: d.y2023, to: d.y2024 }));
    figure({
      el: host,
      legend: [
        { label: "Uzbekistan", color: token("--series-2"), kind: "line" },
        { label: "Regional peers", color: token("--series-mute"), kind: "line" },
      ],
      caption: "Headline inflation, %. Every peer disinflated sharply in 2024; Uzbekistan did not.",
      render: () => C.slope({
        data: rows, width: autoWidth(host)(), height: 380,
        labels: ["2023", "2024"], label: "inflation, %",
        highlight: (n) => n === "Uzbekistan",
        format: (v) => v.toFixed(1),
      }),
      table: () => ({
        caption: "Headline inflation, 2023 vs 2024 (World Bank WDI)",
        columns: ["Country", { label: "2023 %", num: true }, { label: "2024 %", num: true }, { label: "Change pp", num: true }],
        rows: rows.map((d) => [d.name, d.from, d.to, Number((d.to - d.from).toFixed(1))]),
      }),
    });
  },

  /* elasticity ≈ 0 */
  async elasticity(host) {
    const F = await load("findings");
    const e = F.notes.elasticity;
    const rows = [
      ...e.rows.map((r) => ({ name: r.series, value: r.change, kind: "actual" })),
      { name: "Government's claimed drop", value: e.claimedDrop, kind: "claim" },
    ];
    figure({
      el: host,
      legend: [
        { label: "Measured change, 2024", color: token("--series-1"), kind: "rect" },
        { label: "The claim", color: token("--series-2"), kind: "rect" },
      ],
      caption: "Physical consumption after price rises of 53–400%. A demand response would show as a large negative bar.",
      render: () => {
        const w = autoWidth(host)();
        return Plot.plot({
          width: w, height: 250, marginLeft: 172, marginBottom: 42,
          style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
          x: { label: "change in physical consumption, 2024 (%)", grid: false, nice: true },
          y: { domain: rows.map((d) => d.name), label: null },
          marks: [
            Plot.gridX({ stroke: token("--grid"), strokeOpacity: 1 }),
            Plot.barX(rows, {
              x: "value", y: "name",
              fill: (d) => (d.kind === "claim" ? token("--series-2") : token("--series-1")),
              insetTop: 5, insetBottom: 5, rx: 2,
            }),
            ...C.signedLabels(rows, {
              x: "value", y: "name",
              text: (d) => (d.value > 0 ? "+" : "") + d.value + "%",
            }),
            Plot.ruleX([0], { stroke: token("--ink-muted") }),
            Plot.tip(rows, Plot.pointerY({
              x: "value", y: "name",
              title: (d) => `${d.name}\n${d.value > 0 ? "+" : ""}${d.value}%`,
              fill: token("--surface"), stroke: token("--rule"),
            })),
          ],
        });
      },
      table: () => ({
        caption: "Physical energy consumption, change in 2024 (stat.uz)",
        columns: ["Series", { label: "Change %", num: true }],
        rows: rows.map((d) => [d.name, d.value]),
      }),
    });
  },

  /* the waffle: 16 households */
  async compensation(host) {
    const F = await load("findings");
    const n = F.notes.headline.compensationHouseholds;
    const total = F.notes.headline.panelHouseholds;
    figure({
      el: host,
      legend: [
        { label: `Reached by the utility-compensation transfer (${n})`, color: token("--series-1"), kind: "rect" },
        { label: `Everyone else (${(total - n).toLocaleString("en-GB")})`, color: token("--series-mute"), kind: "rect" },
      ],
      caption: `One square is one household. ${n} of ${total.toLocaleString("en-GB")} — a share so small that any percentage rounds it away.`,
      render: () => C.waffle({
        total, parts: [{ name: `Reached by compensation (${n} households)`, value: n }],
        width: autoWidth(host)(), unit: 1,
        label: "1 square = 1 household in the L2CU panel",
      }),
      table: () => ({
        caption: "Reach of the targeted utility-compensation transfer (benefit_17)",
        columns: ["Group", { label: "Households", num: true }, { label: "% of panel", num: true }],
        rows: [
          ["Received the transfer", n, Number(((100 * n) / total).toFixed(2))],
          ["Did not", total - n, Number(((100 * (total - n)) / total).toFixed(2))],
        ],
      }),
    });
  },

  /* robustness */
  async robustness(host) {
    const F = await load("findings");
    const rows = tableRows(F, "T7").filter((r) => r.beta != null);
    coefFigure(host, {
      rows: rows.map((r) => ({ ...r, term: `${r.outcome} — ${prettyTerm(r.term)}` })),
      label: "β",
      title: "T7 — robustness. The dose-response and differential-income tests are the ones that came back null.",
      caption: "Estimates that did not survive household fixed effects sit on top of zero, which is the point.",
    });
  },

  /* the railway — hexbin plus the distance gradient */
  async railway(host) {
    const [W, F] = await load("wealth", "findings");
    const points = W.rwi.lat.map((lat, i) => ({ lat, lon: W.rwi.lon[i], rwi: W.rwi.w[i] }));
    const stations = [...F.notes.railway.stations.main, ...F.notes.railway.stations.fergana];
    const bins = F.railBins;

    figure({
      el: host,
      caption: `${W.rwi.w.length.toLocaleString("en-GB")} wealth cells, binned. Black points are the historical stations; the line between them is the 1888–1906 route.`,
      render: () => {
        const w = autoWidth(host)();
        const wrap = document.createElement("div");
        const main = F.notes.railway.stations.main;
        const ferg = F.notes.railway.stations.fergana;
        wrap.append(
          Plot.plot({
            width: w, height: 420, marginLeft: 46, marginBottom: 40, marginTop: 10,
            style: { background: "transparent", color: token("--ink-2"), fontSize: "11.5px" },
            x: { label: "longitude", grid: false },
            y: { label: "latitude", labelAnchor: "top", grid: false },
            color: {
              type: "diverging", pivot: 0,
              range: [token("--div-neg-3"), token("--div-mid"), token("--div-pos-3")],
              domain: [-1, 1], clamp: true, legend: true, label: "mean wealth index",
            },
            marks: [
              Plot.dot(points, Plot.hexbin({ fill: "mean" }, {
                x: "lon", y: "lat", fill: "rwi", binWidth: 8,
                symbol: "hexagon", r: 4.4,
                stroke: token("--surface"), strokeWidth: 0.4,
              })),
              Plot.line(main, { x: "lon", y: "lat", stroke: token("--ink"), strokeWidth: 1.6, strokeOpacity: 0.85 }),
              Plot.line(ferg, { x: "lon", y: "lat", stroke: token("--ink"), strokeWidth: 1.6, strokeOpacity: 0.85 }),
              Plot.dot(stations, {
                x: "lon", y: "lat", r: 3, fill: token("--ink"),
                stroke: token("--surface"), strokeWidth: 1.5,
              }),
              Plot.text(stations, {
                x: "lon", y: "lat", text: "name", dy: -9, fontSize: 10,
                fill: token("--ink"), stroke: token("--surface"), strokeWidth: 3,
              }),
            ],
          }),
          Plot.plot({
            width: w, height: 250, marginLeft: 86, marginRight: 24, marginBottom: 42, marginTop: 22,
            style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
            x: { label: "mean wealth index", grid: false,
                 domain: [d3.min(bins, (b) => b.meanRwi) - 0.09,
                          d3.max(bins, (b) => b.meanRwi) + 0.05] },
            y: { domain: bins.map((b) => b.band), label: "distance from the line", labelAnchor: "top" },
            marks: [
              Plot.gridX({ stroke: token("--grid"), strokeOpacity: 1 }),
              Plot.barX(bins, {
                x: "meanRwi", y: "band",
                fill: (d) => (d.meanRwi >= 0 ? token("--div-pos-2") : token("--div-neg-2")),
                insetTop: 3, insetBottom: 3, rx: 2,
              }),
              ...C.signedLabels(bins, {
                x: "meanRwi", y: "band", text: (d) => d.meanRwi.toFixed(3),
              }),
              Plot.ruleX([0], { stroke: token("--ink-muted") }),
              Plot.tip(bins, Plot.pointerY({
                x: "meanRwi", y: "band",
                title: (d) => `${d.band} from the line\nmean wealth index ${d.meanRwi.toFixed(3)}\n${d.n.toLocaleString("en-GB")} cells`,
                fill: token("--surface"), stroke: token("--rule"),
              })),
            ],
          })
        );
        return wrap;
      },
      table: () => ({
        caption: "Mean Relative Wealth Index by distance from the Trans-Caspian railway",
        columns: ["Distance band", { label: "Mean wealth index", num: true }, { label: "Cells", num: true }],
        rows: bins.map((b) => [b.band, b.meanRwi, b.n]),
      }),
    });
  },

  /* the Soviet gas paradox */
  async gasParadox(host) {
    const F = await load("findings");
    const g = F.notes.gasParadox;
    const pts = g.rows.map((r) => ({
      x: r.kmToField, y: r.access, label: r.region, producer: r.producer,
    }));
    figure({
      el: host,
      legend: [
        { label: "Gas-producing region", color: token("--series-2"), kind: "rect" },
        { label: "Non-producing region", color: token("--series-1"), kind: "rect" },
      ],
      caption: `Distance to the nearest gas field against household gas access. Correlation +${g.corrAccessDistance} (p = ${g.corrP}) — the wrong sign, and not distinguishable from zero.`,
      render: () => {
        const w = autoWidth(host)();
        return Plot.plot({
          width: w, height: 340, marginLeft: 56, marginBottom: 44,
          style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
          x: { label: "kilometres to the nearest gas field", grid: false, nice: true },
          y: { label: "% of homes with piped gas", labelAnchor: "top", grid: false, domain: [0, 100] },
          marks: [
            Plot.gridX({ stroke: token("--grid"), strokeOpacity: 1 }),
            Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
            Plot.dot(pts, {
              x: "x", y: "y", r: 6,
              fill: (d) => (d.producer ? token("--series-2") : token("--series-1")),
              stroke: token("--surface"), strokeWidth: 2,
            }),
            Plot.text(pts, {
              x: "x", y: "y", text: "label", dy: -13, fontSize: 11.5,
              fill: token("--ink-2"),
            }),
            Plot.tip(pts, Plot.pointer({
              x: "x", y: "y", maxRadius: 40,
              title: (d) => `${d.label}\n${d.y}% of homes on piped gas\n${d.x} km to the nearest field${d.producer ? "\nGas-producing region" : ""}`,
              fill: token("--surface"), stroke: token("--rule"),
            })),
          ],
        });
      },
      table: () => ({
        caption: "Gas access against distance to the nearest field, 2024",
        columns: ["Region", { label: "% with piped gas", num: true }, { label: "km to field", num: true }, "Gas producer"],
        rows: g.rows.map((r) => [r.region, r.access, r.kmToField, r.producer ? "yes" : "no"]),
      }),
    });
  },

  /* the end of the gas dividend */
  async gasDividend(host) {
    const E = await load("energy");
    const data = E.gasBalance.flatMap((r) => [
      { name: "Production", x: r.year, y: r.production },
      { name: "Consumption", x: r.year, y: r.consumption },
    ]);
    figure({
      el: host,
      legend: C.legendFor(["Production", "Consumption"], null, "line"),
      caption: "Where the two lines cross, the country stops being a gas exporter.",
      render: () => {
        const w = autoWidth(host)();
        const pal = [token("--series-1"), token("--series-2")];
        const flip = E.gasBalance.find((r) => r.net < 0);
        return Plot.plot({
          width: w, height: 340, marginLeft: 62, marginBottom: 36,
          style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
          x: { label: null, tickFormat: "d" },
          y: { label: "million m³", labelAnchor: "top", grid: false, nice: true },
          marks: [
            Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
            flip ? Plot.ruleX([flip.year], { stroke: token("--accent"), strokeDasharray: "3,3" }) : null,
            flip ? Plot.text([flip], {
              x: "year", y: (d) => d.production, text: () => `net importer from ${flip.year}`,
              dy: -14, dx: -4, textAnchor: "end", fontSize: 11, fill: token("--accent"),
            }) : null,
            Plot.lineY(data, {
              x: "x", y: "y", z: "name",
              stroke: (d) => pal[d.name === "Production" ? 0 : 1],
              strokeWidth: 2.2, curve: "monotone-x",
            }),
            Plot.tip(data, Plot.pointerX({
              x: "x", y: "y", z: "name",
              title: (d) => `${d.name}\n${d.x}: ${fmt(d.y)} mln m³`,
              fill: token("--surface"), stroke: token("--rule"),
            })),
          ].filter(Boolean),
        });
      },
      table: () => ({
        caption: "National gas balance, million m³ (stat.uz)",
        columns: ["Year", { label: "Production", num: true }, { label: "Consumption", num: true }, { label: "Net", num: true }],
        rows: E.gasBalance.map((r) => [r.year, r.production, r.consumption, r.net]),
      }),
    });
  },

  /* cotton */
  async cotton(host) {
    const [A, F] = await load("agriculture", "findings");
    const changes = [];
    for (const [item, pts] of Object.entries(A.producerPrices ?? {})) {
      const a = pts.find((p) => p[0] === 2022);
      const b = pts.find((p) => p[0] === 2024);
      if (a && b && a[1]) changes.push({ label: item, value: (100 * (b[1] - a[1])) / a[1] });
    }
    const c = F.notes.cottonMonopsony;
    if (!changes.length) return;
    const isCotton = (d) => /cotton/i.test(d.label);
    figure({
      el: host,
      legend: [
        { label: "Cotton", color: token("--series-2"), kind: "line" },
        { label: `Every other commodity (${changes.filter((d) => !isCotton(d)).length})`, color: token("--series-1"), kind: "line" },
      ],
      caption: `Each tick is one FAO commodity. ${c.commoditiesUp} of ${c.commoditiesTotal} rose, median +${c.medianRise}%. The two largest falls are both cotton.`,
      render: () => C.barcode({
        values: changes, width: autoWidth(host)(), height: 175,
        label: "change in producer price, 2022 → 2024 (%)",
        highlight: isCotton,
        format: (v) => (v > 0 ? "+" : "") + v.toFixed(0) + "%",
      }),
      table: () => ({
        caption: "Producer price change 2022 → 2024, by commodity (FAO)",
        columns: ["Commodity", { label: "Change %", num: true }],
        rows: changes.sort((a, b) => a.value - b.value).map((d) => [d.label, Number(d.value.toFixed(1))]),
      }),
    });
  },

  /* the cohort cliff */
  async cohortCliff(host) {
    const F = await load("findings");
    const rows = F.notes.cohortCliff.rows;
    figure({
      el: host,
      caption: "Share of each birth cohort holding a secondary-specialised vocational qualification (MICS6).",
      render: () => {
        const w = autoWidth(host)();
        const release = rows.filter((d) => d.phase === "release");
        return Plot.plot({
          width: w, height: 340, marginLeft: 56, marginBottom: 42,
          style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
          x: { label: "birth cohort", tickFormat: "d", grid: false },
          y: { label: "% with vocational qualification", labelAnchor: "top", grid: false, domain: [0, 90] },
          marks: [
            Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
            Plot.ruleX([1999.5], { stroke: token("--accent"), strokeDasharray: "3,3" }),
            Plot.text([{ x: 1999.5, y: 85 }], {
              x: "x", y: "y", text: () => "2017 reversal",
              dx: 6, textAnchor: "start", fontSize: 11, fill: token("--accent"),
            }),
            Plot.lineY(rows, { x: "cohort", y: "ssve", stroke: token("--series-1"), strokeWidth: 2, curve: "monotone-x" }),
            Plot.dot(rows, {
              x: "cohort", y: "ssve", r: 4.5,
              fill: (d) => (d.phase === "release" ? token("--series-2") : token("--series-1")),
              stroke: token("--surface"), strokeWidth: 2,
            }),
            Plot.text(release, {
              x: "cohort", y: "ssve", text: (d) => d.ssve + "%",
              dy: -12, fontSize: 11, fill: token("--ink-2"),
            }),
            Plot.ruleY([0], { stroke: token("--rule") }),
            Plot.tip(rows, Plot.pointerX({
              x: "cohort", y: "ssve",
              title: (d) => `Born ${d.cohort}\n${d.ssve}% with a vocational qualification\n${d.phase}`,
              fill: token("--surface"), stroke: token("--rule"),
            })),
          ],
        });
      },
      table: () => ({
        caption: "Vocational qualification by birth cohort, %",
        columns: ["Birth cohort", { label: "% with SSVE", num: true }, "Phase"],
        rows: rows.map((d) => [d.cohort, d.ssve, d.phase]),
      }),
    });
  },
};

/* ──────────────────────────────── dispatch ────────────────────────────── */
const which = document.body.dataset.finding;
const host = document.getElementById("finding-chart");
if (which && host && BUILDERS[which]) {
  try {
    await BUILDERS[which](host);
  } catch (err) {
    console.error("finding chart failed:", which, err);
    host.textContent = "";
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "This chart could not be drawn.";
    host.append(p);
  }
} else if (host) {
  // no chart declared for this finding — drop the empty card
  host.closest("figure")?.remove();
}
