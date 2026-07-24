import { boot, load, figure, autoWidth, token, fmt, Plot, d3 } from "../atlas.js";
import * as C from "../charts.js";

await boot();
const G = await load("gold");

/* ── stat tiles ────────────────────────────────────────────────────────── */
{
  const last = G.reserveSplit?.at(-1);
  const firstShare = G.reserveSplit?.find((d) => d.year === 2015) ?? G.reserveSplit?.[0];
  const px = G.priceUsdOz?.at(-1);
  const px2019 = G.priceUsdOz?.find(([m]) => m.startsWith("2020")) ?? G.priceUsdOz?.[0];
  const exp = G.exports?.at(-1);
  const tiles = [
    last && [`${last.goldSharePct.toFixed(0)}%`, `of reserves held as gold in ${last.year} — from ${firstShare.goldSharePct.toFixed(0)}% in ${firstShare.year}`],
    last && [`$${last.goldUsdBn.toFixed(1)}bn`, "gold reserves"],
    last && [`$${last.otherUsdBn.toFixed(1)}bn`, "everything else, drawn down while gold rose"],
    px && [`$${Math.round(px[1]).toLocaleString("en-GB")}`, `per troy ounce, ${px[0]} — ${(px[1] / px2019[1]).toFixed(1)}× its ${px2019[0]} level`],
    exp && [`$${exp.usdBn.toFixed(1)}bn`, `gold exported in ${exp.year}`],
  ].filter(Boolean);
  const host = document.getElementById("gold-stats");
  if (host) {
    host.textContent = "";
    for (const [v, k] of tiles) {
      const d = document.createElement("div");
      d.className = "stat";
      const a = document.createElement("span"); a.className = "v"; a.textContent = v;
      const b = document.createElement("span"); b.className = "k"; b.textContent = k;
      d.append(a, b);
      host.append(d);
    }
  }
}

/* ── reserve composition ───────────────────────────────────────────────── */
if (G.reserveSplit?.length) {
  const names = ["Gold", "All other reserves"];
  const data = G.reserveSplit.flatMap((d) => [
    { name: "Gold", x: d.year, y: d.goldUsdBn },
    { name: "All other reserves", x: d.year, y: d.otherUsdBn },
  ]);
  figure({
    el: "reserve-split",
    legend: C.legendFor(names, null, "rect"),
    caption: "Total reserves, split into gold and everything else. US$ billions.",
    render: () => C.stackedArea({ data, width: autoWidth("reserve-split")(), height: 340, label: "US$ bn", names }),
    table: () => ({
      caption: "Reserve composition, US$ billions (World Bank WDI)",
      columns: ["Year", { label: "Gold", num: true }, { label: "Other", num: true }, { label: "Gold share %", num: true }],
      rows: G.reserveSplit.map((d) => [d.year, d.goldUsdBn, d.otherUsdBn, d.goldSharePct]),
    }),
  });

  figure({
    el: "reserve-share",
    caption: "Gold as a percentage of total reserves.",
    render: () => {
      const w = autoWidth("reserve-share")();
      const rows = G.reserveSplit;
      const peak = d3.greatest(rows, (d) => d.goldSharePct);
      return Plot.plot({
        width: w, height: 280, marginLeft: 52, marginBottom: 36,
        style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
        x: { label: null, tickFormat: "d" },
        y: { label: "% of reserves", labelAnchor: "top", grid: false, domain: [0, 100] },
        marks: [
          Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
          Plot.areaY(rows, { x: "year", y: "goldSharePct", fill: token("--series-1"), fillOpacity: 0.1, curve: "monotone-x" }),
          Plot.lineY(rows, { x: "year", y: "goldSharePct", stroke: token("--series-1"), strokeWidth: 2, curve: "monotone-x" }),
          Plot.dot([peak], { x: "year", y: "goldSharePct", r: 4.5, fill: token("--series-1"), stroke: token("--surface"), strokeWidth: 2 }),
          Plot.text([peak], {
            x: "year", y: "goldSharePct", text: (d) => `${d.goldSharePct.toFixed(0)}% (${d.year})`,
            dy: -12, textAnchor: "end", dx: -4, fontSize: 11.5, fontWeight: 600, fill: token("--ink"),
          }),
          Plot.ruleY([0], { stroke: token("--rule") }),
          Plot.tip(rows, Plot.pointerX({
            x: "year", y: "goldSharePct",
            title: (d) => `${d.year}\ngold ${d.goldSharePct.toFixed(1)}% of reserves\n$${d.goldUsdBn.toFixed(1)}bn gold · $${d.otherUsdBn.toFixed(1)}bn other`,
            fill: token("--surface"), stroke: token("--rule"),
          })),
        ],
      });
    },
    table: () => ({
      caption: "Gold as a share of total reserves, %",
      columns: ["Year", { label: "Gold share %", num: true }],
      rows: G.reserveSplit.map((d) => [d.year, d.goldSharePct]),
    }),
  });
}

/* ── world price ───────────────────────────────────────────────────────── */
if (G.priceUsdOz?.length) {
  const data = G.priceUsdOz.map(([m, v]) => ({ name: "Gold", x: new Date(m + "-01"), y: v }));
  figure({
    el: "gold-price",
    caption: "London benchmark, US dollars per troy ounce.",
    render: () => C.multiLine({
      data, width: autoWidth("gold-price")(), height: 320,
      label: "US$ / troy oz", names: ["Gold"], xIsDate: true,
    }),
    table: () => ({
      caption: "Gold price, US$ per troy ounce, monthly",
      columns: ["Month", { label: "US$/oz", num: true }],
      rows: G.priceUsdOz,
    }),
  });
}

/* ── exports ───────────────────────────────────────────────────────────── */
if (G.exports?.length) {
  figure({
    el: "gold-exports",
    caption: "Gold exports in US dollars.",
    render: () => {
      const w = autoWidth("gold-exports")();
      return Plot.plot({
        width: w, height: 300, marginLeft: 54, marginBottom: 36,
        style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
        x: { label: null, tickFormat: "d" },
        y: { label: "US$ bn", labelAnchor: "top", grid: false, nice: true },
        marks: [
          Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
          Plot.barY(G.exports, { x: "year", y: "usdBn", fill: token("--series-1"), insetLeft: 3, insetRight: 3, rx: 2 }),
          Plot.ruleY([0], { stroke: token("--rule") }),
          Plot.tip(G.exports, Plot.pointerX({
            x: "year", y: "usdBn",
            title: (d) => `${d.year}\n$${d.usdBn.toFixed(2)}bn — ${d.sharePct.toFixed(0)}% of tracked exports`,
            fill: token("--surface"), stroke: token("--rule"),
          })),
        ],
      });
    },
    table: () => ({
      caption: "Gold exports (UN Comtrade)",
      columns: ["Year", { label: "US$ bn", num: true }, { label: "% of tracked exports", num: true }],
      rows: G.exports.map((d) => [d.year, d.usdBn, d.sharePct]),
    }),
  });

  figure({
    el: "gold-share",
    caption: "Gold as a share of the commodity export lines tracked in the Comtrade pull.",
    render: () => {
      const w = autoWidth("gold-share")();
      return Plot.plot({
        width: w, height: 300, marginLeft: 54, marginBottom: 36,
        style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
        x: { label: null, tickFormat: "d" },
        y: { label: "% of tracked exports", labelAnchor: "top", grid: false, nice: true },
        marks: [
          Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
          Plot.areaY(G.exports, { x: "year", y: "sharePct", fill: token("--series-2"), fillOpacity: 0.1, curve: "monotone-x" }),
          Plot.lineY(G.exports, { x: "year", y: "sharePct", stroke: token("--series-2"), strokeWidth: 2, curve: "monotone-x" }),
          Plot.ruleY([0], { stroke: token("--rule") }),
          Plot.tip(G.exports, Plot.pointerX({
            x: "year", y: "sharePct",
            title: (d) => `${d.year}\n${d.sharePct.toFixed(1)}% of tracked exports`,
            fill: token("--surface"), stroke: token("--rule"),
          })),
        ],
      });
    },
    table: () => ({
      caption: "Gold share of tracked exports, %",
      columns: ["Year", { label: "% of tracked exports", num: true }],
      rows: G.exports.map((d) => [d.year, d.sharePct]),
    }),
  });
}

/* ── resource rents ────────────────────────────────────────────────────── */
{
  const picks = [
    ["gasRents", "Natural gas rents"],
    ["mineralRents", "Mineral rents"],
    ["resourceRents", "Total natural resource rents"],
  ].filter(([k]) => G.wdi?.[k]);
  if (picks.length) {
    const names = picks.map(([, l]) => l);
    const data = picks.flatMap(([k, label]) =>
      G.wdi[k].points.map(([x, y]) => ({ name: label, x, y })));
    figure({
      el: "rents",
      legend: C.legendFor(names, null, "line"),
      caption: "Resource rents as a percentage of GDP.",
      render: () => C.multiLine({
        data, width: autoWidth("rents")(), height: 320, label: "% of GDP", names,
      }),
      table: () => {
        const years = [...new Set(data.map((d) => d.x))].sort();
        return {
          caption: "Natural resource rents, % of GDP (World Bank WDI)",
          columns: ["Year", ...names.map((n) => ({ label: n, num: true }))],
          rows: years.map((y) => [y, ...names.map((n) => data.find((d) => d.x === y && d.name === n)?.y ?? null)]),
        };
      },
    });
  }
}
