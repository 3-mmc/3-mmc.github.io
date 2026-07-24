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
if (P.wdi?.exchangeRate) {
  const s = P.wdi.exchangeRate;
  figure({
    el: "fx",
    caption: "Official exchange rate, soum per US dollar, period average.",
    render: () => C.multiLine({
      data: s.points.map(([x, y]) => ({ name: "Soum per US$", x, y })),
      width: autoWidth("fx")(), height: 300, label: "soum per US$", names: ["Soum per US$"],
    }),
    table: () => ({ caption: s.name, columns: ["Year", { label: "Soum per US$", num: true }], rows: s.points }),
  });
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
