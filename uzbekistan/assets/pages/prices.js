import { boot, load, figure, autoWidth, token, fmt, reformRule, Plot, d3 } from "../atlas.js";
import * as C from "../charts.js";

await boot();
const [P, F] = await load("prices", "findings");

/* ── the peer slope chart ──────────────────────────────────────────────── */
{
  const rows = F.notes.cpiPeers.rows.map((d) => ({ name: d.country, from: d.y2023, to: d.y2024 }));
  figure({
    el: "cpi-peers",
    legend: [
      { label: "Uzbekistan", color: token("--series-2"), kind: "line" },
      { label: "Regional peers", color: token("--series-mute"), kind: "line" },
    ],
    caption: "Headline consumer price inflation, %. Every peer fell by roughly 5 points; Uzbekistan fell by 0.4.",
    render: () => C.slope({
      data: rows, width: autoWidth("cpi-peers")(), height: 380,
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
}

/* ── long-run inflation ────────────────────────────────────────────────── */
if (P.wdi?.inflation) {
  const s = P.wdi.inflation;
  figure({
    el: "inflation-long",
    caption: "Annual consumer price inflation, %.",
    render: () => {
      const w = autoWidth("inflation-long")();
      const rows = s.points.map(([x, y]) => ({ x, y }));
      const peak = d3.greatest(rows, (d) => d.y);
      return Plot.plot({
        width: w, height: 300, marginLeft: 52, marginBottom: 36,
        style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
        x: { label: null, tickFormat: "d" },
        y: { label: "% a year", labelAnchor: "top", grid: false, nice: true },
        marks: [
          Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
          Plot.lineY(rows, { x: "x", y: "y", stroke: token("--series-1"), strokeWidth: 2, curve: "monotone-x" }),
          Plot.dot([peak], { x: "x", y: "y", r: 4.5, fill: token("--series-1"), stroke: token("--surface"), strokeWidth: 2 }),
          Plot.text([peak], {
            x: "x", y: "y", text: (d) => `${d.y.toFixed(0)}% — currency unification`,
            dy: -12, fontSize: 11.5, fontWeight: 600, fill: token("--ink"), textAnchor: "middle",
          }),
          Plot.ruleY([0], { stroke: token("--rule") }),
          Plot.tip(rows, Plot.pointerX({
            x: "x", y: "y", title: (d) => `${d.x}\n${d.y.toFixed(1)}%`,
            fill: token("--surface"), stroke: token("--rule"),
          })),
        ],
      });
    },
    table: () => ({ caption: s.name, columns: ["Year", { label: "%", num: true }], rows: s.points }),
  });
}

/* ── monthly CPI by basket ─────────────────────────────────────────────── */
if (P.cpiMonthly) {
  const all = Object.keys(P.cpiMonthly).sort();
  // cap at 8 categorical slots; preselect the ones that carry the story
  const preferred = ["General", "Food", "Food and non-alcoholic beverages"]
    .filter((k) => all.includes(k));
  const active = new Set(preferred.length ? preferred : all.slice(0, 3));

  const picker = document.getElementById("cpi-picker");
  if (picker) {
    picker.textContent = "";
    const lab = document.createElement("label");
    lab.textContent = "Baskets";
    picker.append(lab);
    all.slice(0, 8).forEach((k) => {
      const l = document.createElement("label");
      l.className = "check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = active.has(k);
      cb.addEventListener("change", () => {
        if (cb.checked) {
          if (active.size >= 8) { cb.checked = false; return; }
          active.add(k);
        } else active.delete(k);
        fig?.redraw();
      });
      const sp = document.createElement("span");
      sp.textContent = k;
      l.append(cb, sp);
      picker.append(l);
    });
  }

  const rowsFor = () => {
    const names = all.filter((k) => active.has(k));
    return {
      names,
      data: names.flatMap((k) =>
        P.cpiMonthly[k].map(([d, v]) => ({ name: k, x: new Date(d), y: v }))),
    };
  };

  const fig = figure({
    el: "cpi-monthly",
    legend: () => {
      const { names } = rowsFor();
      return C.legendFor(names, null, "line");
    },
    caption: "FAO monthly consumer price indices, 2015 = 100.",
    render: () => {
      const { names, data } = rowsFor();
      if (!data.length) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "Pick at least one basket.";
        return p;
      }
      const w = autoWidth("cpi-monthly")();
      const pal = C.legendFor(names).map((d) => d.color);
      const color = new Map(names.map((n, i) => [n, pal[i]]));
      return Plot.plot({
        width: w, height: 380, marginLeft: 58, marginRight: 20, marginBottom: 36,
        style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
        x: { label: null },
        y: { label: "index, 2015 = 100", labelAnchor: "top", grid: false, nice: true },
        marks: [
          Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
          ...reformRule("1 May 2024 tariff"),
          Plot.lineY(data, { x: "x", y: "y", z: "name", stroke: (d) => color.get(d.name), strokeWidth: 2 }),
          Plot.tip(data, Plot.pointerX({
            x: "x", y: "y", z: "name",
            title: (d) => `${d.name}\n${d.x.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}: ${fmt(d.y)}`,
            fill: token("--surface"), stroke: token("--rule"),
          })),
        ],
      });
    },
    table: () => {
      const { names } = rowsFor();
      const dates = [...new Set(names.flatMap((n) => P.cpiMonthly[n].map((p) => p[0])))].sort();
      return {
        caption: "Consumer price indices by basket, 2015 = 100",
        columns: ["Month", ...names.map((n) => ({ label: n, num: true }))],
        rows: dates.map((d) => [d, ...names.map((n) => P.cpiMonthly[n].find((p) => p[0] === d)?.[1] ?? null)]),
      };
    },
  });
}

/* ── exchange rate ─────────────────────────────────────────────────────── */
// A line of the level buries the thing worth seeing: almost every year is a
// single-digit crawl, and one year is not. One dot per year shows the
// distribution and the outlier at the same time.
if (P.wdi?.exchangeRate) {
  const s = P.wdi.exchangeRate;
  // Only consecutive years. This WDI series has a gap from 2001 to 2012, and
  // differencing across it would report a thirteen-year change (+785%) as if it
  // were a single year's devaluation.
  const changes = [];
  let skipped = 0;
  for (let i = 1; i < s.points.length; i++) {
    const [y0, v0] = s.points[i - 1];
    const [y1, v1] = s.points[i];
    if (!v0) continue;
    if (y1 - y0 !== 1) { skipped++; continue; }
    changes.push({ value: (100 * (v1 - v0)) / v0, label: String(y1).slice(2), year: y1 });
  }
  // Two readings of the same rate, growing away from a shared centre: soum you
  // get for a dollar (rising), dollars you get for a million soum (falling).
  const LEFT = "US$ per million soum";
  const RIGHT = "soum per US$";
  const rows = [...s.points]
    .sort((a, b) => b[0] - a[0])
    .map(([year, rate]) => ({
      name: String(year),
      right: rate,
      left: rate ? 1e6 / rate : 0,
      change: changes.find((d) => d.year === year)?.value ?? null,
    }));

  figure({
    el: "fx-dots",
    legend: C.butterflyLegend(LEFT, RIGHT),
    caption: "Each row is one year. The two arms are reciprocals of the same rate, so they mirror each other — as the right arm grows, the left shrinks.",
    render: () => C.butterfly({
      rows, width: autoWidth("fx-dots")(), rowHeight: 21,
      leftLabel: LEFT, rightLabel: RIGHT,
      leftFormat: (v) => "$" + (v >= 100 ? Math.round(v).toLocaleString("en-GB") : v.toFixed(0)),
      rightFormat: (v) => Math.round(v).toLocaleString("en-GB"),
    }),
    table: () => ({
      caption: "Official exchange rate, both ways round"
        + (skipped ? " (this series has no values for 2001–2012)" : ""),
      columns: ["Year", { label: "Soum per US$", num: true },
                { label: "US$ per million soum", num: true },
                { label: "Annual change %", num: true }],
      rows: rows.map((d) => [Number(d.name), Number(d.right.toFixed(0)),
                             Number(d.left.toFixed(2)),
                             d.change == null ? null : Number(d.change.toFixed(1))]),
    }),
  });
}

/* ── GDP by sector ─────────────────────────────────────────────────────── */
{
  const parts = [
    ["agValueAddedShare", "Agriculture"],
    ["industryShare", "Industry"],
    ["servicesShare", "Services"],
  ];
  const series = {
    Agriculture: P.wdi?.agValueAddedShare,
    Industry: P.wdi?.industryShare,
    Services: P.wdi?.servicesShare,
  };
  const names = Object.keys(series).filter((k) => series[k]);
  if (names.length === 3) {
    const data = names.flatMap((n) =>
      series[n].points.map(([x, y]) => ({ name: n, x, y })));

    figure({
      el: "gdp-sectors",
      legend: C.legendFor(names, null, "rect"),
      caption: "Value added by sector, % of GDP. The three do not sum to exactly 100 — taxes and imputed bank charges sit outside them.",
      render: () => C.stackedArea({
        data, width: autoWidth("gdp-sectors")(), height: 340,
        label: "% of GDP", names,
      }),
      table: () => {
        const years = [...new Set(data.map((d) => d.x))].sort();
        return {
          caption: "Value added by sector, % of GDP",
          columns: ["Year", ...names.map((n) => ({ label: n, num: true }))],
          rows: years.map((y) => [y, ...names.map((n) =>
            data.find((d) => d.x === y && d.name === n)?.y ?? null)]),
        };
      },
    });

    const latestYear = d3.min(names, (n) => series[n].points.at(-1)[0]);
    const slice = names.map((n) => ({
      name: n,
      value: series[n].points.find((p) => p[0] === latestYear)?.[1] ?? 0,
    }));
    const total = d3.sum(slice, (d) => d.value);
    const titleEl = document.getElementById("gdp-donut-title");
    if (titleEl) titleEl.textContent = `The split in ${latestYear}`;

    figure({
      el: "gdp-donut",
      legend: slice.map((d, i) => ({
        label: `${d.name} — ${d.value.toFixed(1)}%`,
        color: C.legendFor(names)[i].color, kind: "rect",
      })),
      caption: `Sector shares of GDP, ${latestYear}.`,
      render: () => C.donut({
        parts: slice, width: autoWidth("gdp-donut")(), size: 240,
        format: (v) => v.toFixed(1) + "% of GDP",
        centerLabel: `of GDP, ${latestYear}`,
        centerValue: total.toFixed(0) + "%",
      }),
      table: () => ({
        caption: `Value added by sector, ${latestYear}`,
        columns: ["Sector", { label: "% of GDP", num: true }],
        rows: slice.map((d) => [d.name, Number(d.value.toFixed(1))]),
      }),
    });
  }
}

/* ── money & credit ────────────────────────────────────────────────────── */
{
  const picks = [
    ["creditPrivate", "Domestic credit to the private sector (% of GDP)"],
    ["tradeShare", "Trade (% of GDP)"],
    ["deflator", "GDP deflator inflation (annual %)"],
  ].filter(([k]) => P.wdi?.[k]);
  const sel = document.getElementById("money-ind");
  if (sel) {
    sel.textContent = "";
    for (const [k, l] of picks) {
      const o = document.createElement("option");
      o.value = k; o.textContent = l;
      sel.append(o);
    }
  }
  if (picks.length) {
    const fig = figure({
      el: "money-chart",
      caption: "World Bank World Development Indicators.",
      render: () => {
        const s = P.wdi[sel?.value || picks[0][0]];
        return C.multiLine({
          data: s.points.map(([x, y]) => ({ name: s.name, x, y })),
          width: autoWidth("money-chart")(), height: 290,
          label: "%", names: [s.name],
        });
      },
      table: () => {
        const s = P.wdi[sel?.value || picks[0][0]];
        return { caption: s.name, columns: ["Year", { label: "Value", num: true }], rows: s.points };
      },
    });
    sel?.addEventListener("change", () => fig?.redraw());
  }
}

/* ── GDP per capita, indexed so two units share one axis ───────────────── */
{
  const picks = [
    ["gdpPerCapita", "GDP per capita (current US$)"],
    ["gdpPerCapitaPpp", "GDP per capita, PPP (constant 2021 int'l $)"],
  ].filter(([k]) => P.wdi?.[k]);
  if (picks.length === 2) {
    const names = picks.map(([, l]) => l);
    const data = picks.flatMap(([k, label]) =>
      C.indexed(P.wdi[k].points).map(([x, y]) => ({ name: label, x, y })));
    figure({
      el: "gdp-pc",
      legend: C.legendFor(names, null, "line"),
      caption: "Both series indexed to their own first year = 100, so they share one axis.",
      render: () => C.multiLine({
        data, width: autoWidth("gdp-pc")(), height: 320,
        label: "index, first year = 100", names,
      }),
      table: () => {
        const years = [...new Set(data.map((d) => d.x))].sort();
        return {
          caption: "GDP per capita, indexed to first year = 100",
          columns: ["Year", ...names.map((n) => ({ label: n, num: true }))],
          rows: years.map((y) => [y, ...names.map((n) => {
            const hit = data.find((d) => d.x === y && d.name === n);
            return hit ? Number(hit.y.toFixed(1)) : null;
          })]),
        };
      },
    });
  }
}
