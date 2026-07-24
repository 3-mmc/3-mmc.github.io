import { boot, load, figure, autoWidth, token, fmt, Plot, d3 } from "../atlas.js";
import * as C from "../charts.js";

const core = await boot();
if (core) {
  build(core);
  buildSpineFull();
}
buildGallery();

/* ── rotating findings gallery ─────────────────────────────────────────────
   A scroll-snap track rather than a transform carousel: it stays usable with
   a trackpad, a keyboard and a screen reader, and the auto-advance is just a
   scroll. It pauses on hover, on focus, when the tab is hidden, and entirely
   under prefers-reduced-motion. */
async function buildGallery() {
  const track = document.getElementById("gallery-track");
  const dotsBox = document.getElementById("gallery-dots");
  const playBtn = document.getElementById("gallery-play");
  if (!track) return;

  let items;
  try {
    items = await load("findings-index");
  } catch (err) {
    console.error("findings-index.json failed to load", err);
    document.getElementById("findings-gallery")?.remove();
    return;
  }

  const STATUS_TEXT = {
    proven: "identified",
    descriptive: "descriptive",
    revised: "revised",
    banked: "waiting on data",
    null: "abandoned",
  };

  for (const f of items) {
    const a = document.createElement("a");
    a.className = "gallery-card";
    a.href = `findings/${f.slug}.html`;

    const group = document.createElement("span");
    group.className = "g-group";
    group.textContent = f.group;

    const h = document.createElement("h3");
    h.textContent = f.title;

    const p = document.createElement("p");
    p.textContent = f.oneline || "";

    const foot = document.createElement("div");
    foot.className = "g-foot";
    const st = document.createElement("span");
    st.className = "status";
    st.dataset.status = f.status;
    st.textContent = STATUS_TEXT[f.status] ?? f.status;
    const read = document.createElement("span");
    read.className = "g-read";
    read.textContent = "Read →";
    foot.append(st, read);

    a.append(group, h, p, foot);
    track.append(a);
  }

  const perView = () => {
    const card = track.firstElementChild;
    if (!card) return 1;
    return Math.max(1, Math.round(track.clientWidth / (card.getBoundingClientRect().width + 14)));
  };
  const pages = () => Math.max(1, Math.ceil(items.length / perView()));
  const current = () => {
    const card = track.firstElementChild;
    if (!card) return 0;
    const step = (card.getBoundingClientRect().width + 14) * perView();
    return Math.round(track.scrollLeft / step);
  };

  function renderDots() {
    dotsBox.textContent = "";
    const n = pages();
    const cur = Math.min(current(), n - 1);
    for (let i = 0; i < n; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(i === cur));
      b.setAttribute("aria-label", `Findings ${i * perView() + 1}–${Math.min(items.length, (i + 1) * perView())}`);
      b.addEventListener("click", () => goTo(i));
      dotsBox.append(b);
    }
  }

  function goTo(page) {
    const card = track.firstElementChild;
    if (!card) return;
    const step = (card.getBoundingClientRect().width + 14) * perView();
    track.scrollTo({ left: page * step, behavior: reduced.matches ? "auto" : "smooth" });
  }

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let timer = null;
  let playing = !reduced.matches;

  function advance(dir = 1) {
    const n = pages();
    let next = current() + dir;
    if (next >= n) next = 0;
    if (next < 0) next = n - 1;
    goTo(next);
  }

  function start() {
    stop();
    if (!playing || reduced.matches) return;
    timer = setInterval(() => advance(1), 6000);
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  playBtn.addEventListener("click", () => {
    playing = !playing;
    playBtn.textContent = playing ? "Pause" : "Play";
    playBtn.setAttribute("aria-pressed", String(playing));
    playing ? start() : stop();
  });
  if (reduced.matches) {
    playing = false;
    playBtn.textContent = "Play";
    playBtn.setAttribute("aria-pressed", "false");
  }

  for (const b of document.querySelectorAll(".gallery-btn")) {
    b.addEventListener("click", () => {
      advance(Number(b.dataset.dir));
      start();               // restart the clock after a manual move
    });
  }

  const gallery = document.getElementById("findings-gallery");
  gallery.addEventListener("pointerenter", stop);
  gallery.addEventListener("pointerleave", () => playing && start());
  gallery.addEventListener("focusin", stop);
  gallery.addEventListener("focusout", (e) => {
    if (!gallery.contains(e.relatedTarget) && playing) start();
  });
  document.addEventListener("visibilitychange", () => {
    document.hidden ? stop() : playing && start();
  });

  let scrollTimer;
  track.addEventListener("scroll", () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(renderDots, 120);
  });
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderDots, 180);
  });

  renderDots();
  start();
}

function build(core) {
  /* ── the three-winter arc ───────────────────────────────────────────────
     Two measures on very different scales (hours/day and % of households),
     so this is two stacked panels sharing an x — never a second y-axis. */
  const arc = core.threeWinterArc.rows;
  figure({
    el: "arc",
    legend: [
      { label: "Hours of electricity a day", color: token("--series-1"), kind: "rect" },
      { label: "Households who couldn't pay a utility bill", color: token("--series-2"), kind: "rect" },
    ],
    caption: "Winter is December to March, labelled by the January year.",
    render: () => {
      const w = autoWidth("arc")();
      // Two measures on incompatible scales, so two stacked panels sharing an
      // x — never a second y-axis. Axis labels are dropped: the legend above
      // already names both series, and at this width they collided.
      const tick = (d) => `${d.winter}\n${d.label}`;
      const wrap = document.createElement("div");
      wrap.append(
        Plot.plot({
          width: w, height: 156, marginLeft: 44, marginRight: 12, marginBottom: 6, marginTop: 18,
          style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
          x: { domain: arc.map((d) => d.winter), label: null, axis: null },
          y: { domain: [14, 25], label: null, grid: false, ticks: 4 },
          marks: [
            Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
            Plot.barY(arc, { x: "winter", y: "elecHours", fill: token("--series-1"), insetLeft: 16, insetRight: 16, rx: 3 }),
            Plot.text(arc, { x: "winter", y: "elecHours", text: (d) => d.elecHours.toFixed(1), dy: -8, fontSize: 11, fill: token("--ink-2") }),
            Plot.ruleY([14], { stroke: token("--rule") }),
          ],
        }),
        Plot.plot({
          width: w, height: 190, marginLeft: 44, marginRight: 12, marginTop: 18, marginBottom: 46,
          style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
          x: { domain: arc.map((d) => d.winter), label: null, tickFormat: (w) => w, tickSize: 0 },
          y: { domain: [0, 10.5], label: null, grid: false, ticks: 4 },
          marks: [
            Plot.gridY({ stroke: token("--grid"), strokeOpacity: 1 }),
            Plot.barY(arc, { x: "winter", y: "utilDistress", fill: token("--series-2"), insetLeft: 16, insetRight: 16, rx: 3 }),
            Plot.text(arc, { x: "winter", y: "utilDistress", text: (d) => d.utilDistress.toFixed(1) + "%", dy: -8, fontSize: 11, fill: token("--ink-2") }),
            Plot.text(arc, {
              x: "winter", text: (d) => d.label, frameAnchor: "bottom", dy: 30,
              fontSize: 10.5, fontWeight: 600, fill: token("--accent"),
            }),
            Plot.ruleY([0], { stroke: token("--rule") }),
            Plot.tip(arc, Plot.pointerX({
              x: "winter", y: "utilDistress",
              title: (d) => `Winter ${d.winter} — ${d.label}\n${d.elecHours} hours of power a day\n${d.utilDistress}% couldn't pay a bill\n${d.heatDisrupt}% had heating disrupted`,
              fill: token("--surface"), stroke: token("--rule"),
            })),
          ],
        })
      );
      return wrap;
    },
    table: () => ({
      caption: "The three-winter arc — L2CU household panel",
      columns: ["Winter", "Regime", { label: "Electricity hrs/day", num: true },
                { label: "Heat disruption %", num: true }, { label: "Couldn't pay %", num: true }],
      rows: arc.map((d) => [d.winter, d.label || "—", d.elecHours, d.heatDisrupt, d.utilDistress]),
    }),
  });

  /* ── the reshuffle ─────────────────────────────────────────────────────── */
  const q = core.reshuffleQuartiles.rows;
  figure({
    el: "reshuffle",
    legend: [
      { label: "Hours of power a day, crisis winter 2022/23", color: token("--seq-3"), kind: "rect" },
      { label: "Couldn't pay, price winter 2024/25", color: token("--series-2"), kind: "rect" },
    ],
    caption: "1,175 households present in both winters.",
    render: () => {
      const w = autoWidth("reshuffle")();
      const rows = q.map((d) => ({
        band: `${d.q}${d.label ? " — " + d.label : ""}`,
        hours: d.elecHours, distress: d.distress2425, grid: d.gridShare,
      }));
      const wrap = document.createElement("div");
      wrap.append(
        Plot.plot({
          width: w, height: 138, marginLeft: 150, marginBottom: 30, marginTop: 12,
          style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
          x: { domain: [0, 24], label: "hours of power a day in the crisis winter", grid: false },
          y: { domain: rows.map((d) => d.band), label: null },
          marks: [
            Plot.gridX({ stroke: token("--grid"), strokeOpacity: 1 }),
            Plot.barX(rows, { x: "hours", y: "band", fill: token("--seq-3"), insetTop: 4, insetBottom: 4, rx: 2 }),
            Plot.text(rows, { x: "hours", y: "band", text: (d) => d.hours.toFixed(1), dx: 5, textAnchor: "start", fontSize: 11, fill: token("--ink-2") }),
            Plot.ruleX([0], { stroke: token("--rule") }),
          ],
        }),
        Plot.plot({
          width: w, height: 148, marginLeft: 150, marginBottom: 40, marginTop: 12,
          style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
          x: { domain: [0, 13], label: "% who couldn't pay a bill two winters later", grid: false },
          y: { domain: rows.map((d) => d.band), label: null },
          marks: [
            Plot.gridX({ stroke: token("--grid"), strokeOpacity: 1 }),
            Plot.barX(rows, { x: "distress", y: "band", fill: token("--series-2"), insetTop: 4, insetBottom: 4, rx: 2 }),
            Plot.text(rows, { x: "distress", y: "band", text: (d) => d.distress.toFixed(1) + "%", dx: 5, textAnchor: "start", fontSize: 11, fill: token("--ink-2") }),
            Plot.ruleX([0], { stroke: token("--rule") }),
            Plot.tip(rows, Plot.pointerY({
              x: "distress", y: "band",
              title: (d) => `${d.band}\n${d.hours} hrs of power a day in 2022/23\n${d.grid}% on the piped gas grid\n${d.distress}% couldn't pay in 2024/25`,
              fill: token("--surface"), stroke: token("--rule"),
            })),
          ],
        })
      );
      return wrap;
    },
    table: () => ({
      caption: "Households ranked by their 2022/23 rationing burden",
      columns: ["Quartile", { label: "Electricity hrs/day", num: true },
                { label: "On the gas grid %", num: true }, { label: "Couldn't pay 2024/25 %", num: true }],
      rows: q.map((d) => [`${d.q}${d.label ? " — " + d.label : ""}`, d.elecHours, d.gridShare, d.distress2425]),
    }),
  });

  /* ── headline stat tiles ───────────────────────────────────────────────── */
  const h = core.headline;
  const tiles = [
    [`+${h.billRise}%`, "energy bills after the reform, for every household"],
    [`${h.winterShareFrom}→${h.winterShareTo}%`, "of cash income spent on winter energy, grid households"],
    [`+${h.winterDistressPp}pp`, "extra winter payment distress on the grid"],
    ["≈ 0", "demand response — the reform raised revenue, not conservation"],
    [`${h.compensationHouseholds}`, "households the compensation transfer actually reached"],
    [`${h.panelHouseholds.toLocaleString("en-GB")}`, `households, ${h.panelRounds} monthly rounds, 2018–2025`],
  ];
  const host = document.getElementById("headline-stats");
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

/* ── the spine, full size ──────────────────────────────────────────────── */
async function buildSpineFull() {
  const bins = core.railBins;
  figure({
    el: "spine-full",
    caption: "Mean wealth index by distance from the historical line. Zero is the national average.",
    render: () => {
      const w = autoWidth("spine-full")();
      const rows = bins.map((b) => ({ band: b.band, value: b.meanRwi, n: b.n }));
      // widen the domain so the value labels sit clear of the tick labels
      const ext = d3.extent(rows, (d) => d.value);
      return Plot.plot({
        width: w, height: 250, marginLeft: 86, marginRight: 24, marginBottom: 42, marginTop: 12,
        style: { background: "transparent", color: token("--ink-2"), fontSize: "12px" },
        x: { label: "mean Relative Wealth Index", grid: false,
             domain: [ext[0] - 0.09, ext[1] + 0.05] },
        y: { domain: rows.map((d) => d.band), label: "distance from the railway", labelAnchor: "top" },
        marks: [
          Plot.gridX({ stroke: token("--grid"), strokeOpacity: 1 }),
          Plot.barX(rows, {
            x: "value", y: "band",
            fill: (d) => (d.value >= 0 ? token("--div-pos-2") : token("--div-neg-2")),
            insetTop: 3, insetBottom: 3, rx: 2,
          }),
          ...C.signedLabels(rows, { x: "value", y: "band", text: (d) => d.value.toFixed(3) }),
          Plot.ruleX([0], { stroke: token("--ink-muted") }),
          Plot.tip(rows, Plot.pointerY({
            x: "value", y: "band",
            title: (d) => `${d.band} from the line\nmean wealth index ${d.value.toFixed(3)}\n${d.n.toLocaleString("en-GB")} cells`,
            fill: token("--surface"), stroke: token("--rule"),
          })),
        ],
      });
    },
    table: () => ({
      caption: "Meta Relative Wealth Index by distance band from the Trans-Caspian railway",
      columns: ["Distance band", { label: "Mean wealth index", num: true }, { label: "Cells", num: true }],
      rows: bins.map((b) => [b.band, b.meanRwi, b.n]),
    }),
  });
}
