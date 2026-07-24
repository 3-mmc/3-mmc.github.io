#!/usr/bin/env python3
"""Build the single-file interactive dashboard.

Reads the project datasets + canonical results, aggregates them into a compact
JSON payload, and injects it into template.html -> Uzbekistan_Dashboard.html.
Pure standard library (no pandas available on this machine).

Run from the project root:  python3 dashboard/build_dashboard.py
"""
import csv, json, os, sys, datetime
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DS = os.path.join(ROOT, "datasets")
OUT = os.path.join(ROOT, "exploration", "outputs")
TBL = os.path.join(ROOT, "dissertation", "tables")
HERE = os.path.join(ROOT, "dashboard")

def r5(x):
    try:
        return float(f"{float(x):.5g}")
    except (TypeError, ValueError):
        return None

def read_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))

# ---------------------------------------------------------------- WB indicators
WB_TOPICS = {
    "agriculture-and-rural-development_uzb.csv": "Agriculture & rural",
    "climate-change_uzb.csv": "Climate change",
    "economy-and-growth_uzb.csv": "Economy & growth",
    "education_uzb.csv": "Education",
    "energy-and-mining_uzb.csv": "Energy & mining",
    "environment_uzb.csv": "Environment",
    "external-debt_uzb.csv": "External debt",
    "financial-sector_uzb.csv": "Financial sector",
    "health_uzb.csv": "Health",
    "infrastructure_uzb.csv": "Infrastructure",
    "poverty_uzb.csv": "Poverty",
    "private-sector_uzb.csv": "Private sector",
    "public-sector_uzb.csv": "Public sector",
    "science-and-technology_uzb.csv": "Science & technology",
    "social-development_uzb.csv": "Social development",
    "social-protection-and-labor_uzb.csv": "Social protection & labor",
    "trade_uzb.csv": "Trade",
    "urban-development_uzb.csv": "Urban development",
}

def build_wb():
    topics = sorted(set(WB_TOPICS.values()))
    tidx = {t: i for i, t in enumerate(topics)}
    code_topics = defaultdict(set)
    for fn, topic in WB_TOPICS.items():
        p = os.path.join(DS, fn)
        if not os.path.exists(p):
            continue
        for row in read_csv(p):
            if "Indicator Code" not in row:
                break
            code_topics[row["Indicator Code"]].add(tidx[topic])
    series = {}
    for row in read_csv(os.path.join(DS, "indicators_uzb.csv")):
        code = row["Indicator Code"]
        try:
            yr = int(row["Year"]); val = r5(row["Value"])
        except ValueError:
            continue
        if val is None:
            continue
        s = series.setdefault(code, {"n": row["Indicator Name"],
                                     "t": sorted(code_topics.get(code, [])),
                                     "d": {}})
        s["d"][yr] = val
    out = {}
    for code, s in series.items():
        if len(s["d"]) < 3:
            continue
        years = sorted(s["d"])
        out[code] = {"n": s["n"], "t": s["t"], "y": years,
                     "v": [s["d"][y] for y in years]}
    return {"topics": topics, "series": out}

# ------------------------------------------------------------- canonical tables
TABLE_META = {
    "T1": ("T1 — Median energy payments (UZS) and energy share of cash income",
           "T1_bills_burden.csv"),
    "T2": ("T2 — First stage: ln(energy payments)", "T2_first_stage.csv"),
    "T3": ("T3 — Two-sided recomposition (post + post×grid + post×ag-base)",
           "T3_recomposition.csv"),
    "T4": ("T4 — Winter triple-diff (post×grid×winter)", "T4_winter_triple.csv"),
    "T5": ("T5 — Reliability (electricity hours, outages)", "T5_reliability.csv"),
    "T6": ("T6 — Event study: grid × quarter windows", "T6_event_study.csv"),
    "T7": ("T7 — Robustness", "T7_robustness.csv"),
}

def build_tables():
    tables = {}
    for key, (title, fn) in TABLE_META.items():
        rows = read_csv(os.path.join(TBL, fn))
        if not rows:
            continue
        cols = list(rows[0].keys())
        data = []
        for row in rows:
            rec = []
            for c in cols:
                v = row[c]
                num = r5(v)
                rec.append(num if num is not None and c not in ("grid", "post") else v)
            data.append(rec)
        tables[key] = {"title": title, "columns": cols, "rows": data}
    return tables

# ------------------------------------------------------------- regional panel
def build_regional():
    data = defaultdict(lambda: defaultdict(list))
    for row in read_csv(os.path.join(OUT, "regional_panel_long.csv")):
        ind = row["indicator"]
        v = r5(row["value"])
        if v is None:
            continue
        try:
            yr = int(float(row["year"]))
        except ValueError:
            continue
        data[ind][row["region"]].append([yr, v])
    out = {}
    for ind, regs in data.items():
        out[ind] = {rg: sorted(pts) for rg, pts in regs.items()}
    return out

# ------------------------------------------------------------------- climate
PMAP = {'UZ03': 'Andijan', 'UZ06': 'Bukhara', 'UZ08': 'Jizzakh', 'UZ10': 'Kashkadarya',
        'UZ12': 'Navoi', 'UZ14': 'Namangan', 'UZ18': 'Samarkand', 'UZ22': 'Surkhandarya',
        'UZ24': 'Syrdarya', 'UZ26': 'Tashkent_city', 'UZ27': 'Tashkent_region',
        'UZ30': 'Fergana', 'UZ33': 'Khorezm', 'UZ35': 'Karakalpakstan'}

def stream_climate(fn, val_col, months, how):
    acc = defaultdict(list)  # (region, year) -> values
    with open(os.path.join(DS, fn), newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            if row["adm_level"] != "1":
                continue
            region = PMAP.get(row["PCODE"])
            if not region:
                continue
            d = row["date"]  # YYYY-MM-DD
            mo = int(d[5:7])
            if mo not in months:
                continue
            try:
                v = float(row[val_col])
            except ValueError:
                continue
            acc[(region, int(d[:4]))].append(v)
    out = defaultdict(list)
    last_complete = datetime.date.today().year - 1  # current growing season is incomplete
    for (region, yr), vals in acc.items():
        if yr > last_complete:
            continue
        agg = sum(vals) if how == "sum" else sum(vals) / len(vals)
        out[region].append([yr, r5(agg)])
    return {rg: sorted(pts) for rg, pts in out.items()}

def build_climate():
    # growing-season conventions follow exploration/district_climate.py
    rain = stream_climate("uzb-rainfall-subnat-full.csv", "rfh", set(range(3, 9)), "sum")
    ndvi = stream_climate("uzb-ndvi-subnat-full.csv", "vim", set(range(4, 10)), "mean")
    return {"rain": rain, "ndvi": ndvi}

# ----------------------------------------------------------------- geo layers
def load_geo():
    geo = {}
    for lvl, fn in (("adm1", "uzb_adm1.json"), ("adm2", "uzb_adm2.json")):
        with open(os.path.join(HERE, "geodata", fn), encoding="utf-8") as f:
            gj = json.load(f)
        for feat in gj["features"]:
            p = feat["properties"]
            p["region"] = PMAP.get(p["pcode"][:4], p.get("name"))
        geo[lvl] = gj
    return geo

def _bbox(rings):
    xs = [x for r in rings for x, _ in r]
    ys = [y for r in rings for _, y in r]
    return min(xs), min(ys), max(xs), max(ys)

def _pip(x, y, rings):
    inside = False
    for ring in rings:
        for i in range(len(ring)):
            x1, y1 = ring[i - 1]
            x2, y2 = ring[i]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                inside = not inside
    return inside

def build_rwi_agg(rwi, geo):
    out = {}
    for lvl, key in (("adm1", "region"), ("adm2", "pcode")):
        polys = []
        for f in geo[lvl]["features"]:
            rings = f["geometry"]["coordinates"]
            polys.append((f["properties"][key], _bbox(rings), rings))
        acc = defaultdict(list)
        unmatched = 0
        for lat, lon, w in zip(rwi["lat"], rwi["lon"], rwi["w"]):
            hit = None
            for name, (x0, y0, x1, y1), rings in polys:
                if x0 <= lon <= x1 and y0 <= lat <= y1 and _pip(lon, lat, rings):
                    hit = name
                    break
            if hit is None:
                unmatched += 1
            else:
                acc[hit].append(w)
        print(f"  RWI->{lvl}: {len(acc)} units matched, {unmatched} cells unmatched")
        out[lvl] = {k: {"mean": r5(sum(v) / len(v)), "n": len(v)}
                    for k, v in acc.items()}
    return out

def build_district_climate():
    vim, rfh = defaultdict(list), defaultdict(list)
    names = {}
    for r in read_csv(os.path.join(OUT, "district_climate_year.csv")):
        p = r["PCODE"]
        yr = int(float(r["year"]))
        names[p] = r["region"]
        v = r5(r["vim"]); w = r5(r["rfh"])
        if v is not None:
            vim[p].append([yr, v])
        if w is not None:
            rfh[p].append([yr, w])
    return {"ndvi": {p: sorted(v) for p, v in vim.items()},
            "rain": {p: sorted(v) for p, v in rfh.items()}}

# ----------------------------------------------------------------------- RWI
def build_rwi():
    lat, lon, w = [], [], []
    for row in read_csv(os.path.join(DS, "uzb_relative_wealth_index.csv")):
        try:
            lat.append(round(float(row["latitude"]), 3))
            lon.append(round(float(row["longitude"]), 3))
            w.append(round(float(row["rwi"]), 3))
        except ValueError:
            continue
    return {"lat": lat, "lon": lon, "w": w}

# ---------------------------------------------------------------- macro series
def build_macro():
    m = {}
    rows = read_csv(os.path.join(OUT, "uzb_gas_balance.csv"))
    m["gas"] = {"years": [int(float(r["year"])) for r in rows],
                "production": [r5(r["production_mcm"]) for r in rows],
                "consumption": [r5(r["consumption_mcm"]) for r in rows],
                "net": [r5(r["net_balance_mcm"]) for r in rows]}

    wages = defaultdict(list)
    for r in read_csv(os.path.join(OUT, "wage_real_by_sector.csv")):
        wages[r["name"]].append([int(float(r["year"])), r5(r["real_sum_2017"])])
    m["wages"] = {k: sorted(v) for k, v in wages.items()}

    emp = defaultdict(list)
    for r in read_csv(os.path.join(OUT, "employment_sector_share.csv")):
        emp[r["name"]].append([int(float(r["year"])), r5(r["share_pct"])])
    m["empShare"] = {k: sorted(v) for k, v in emp.items()}

    rows = read_csv(os.path.join(OUT, "gold_share_of_exports.csv"))
    m["gold"] = {"years": [int(float(r["year"])) for r in rows],
                 "gold_usd_bn": [r5(r["gold_usd_bn"]) for r in rows],
                 "share": [r5(r["gold_share_of_tracked_exports_pct"]) for r in rows]}

    rows = read_csv(os.path.join(OUT, "l2cu_migration_ts.csv"))
    m["migration"] = {"dates": [r["date"] for r in rows],
                      "abroad": [r5(r["pct_abroad"]) for r in rows],
                      "considering": [r5(r["pct_considering"]) for r in rows],
                      "returned": [r5(r["pct_returned"]) for r in rows]}

    health = defaultdict(lambda: defaultdict(list))
    hrows = read_csv(os.path.join(OUT, "health_panel.csv"))
    hmetrics = [c for c in hrows[0].keys() if c not in ("region", "year")]
    for r in hrows:
        for c in hmetrics:
            v = r5(r[c])
            if v is not None:
                health[c][r["region"]].append([int(float(r["year"])), v])
    m["health"] = {c: {rg: sorted(pts) for rg, pts in regs.items()}
                   for c, regs in health.items()}

    pub = [r for r in read_csv(os.path.join(OUT, "employment_public_share.csv"))
           if r["name"] == "Republic of Uzbekistan"]
    m["publicShare"] = {"years": [int(float(r["year"])) for r in pub],
                        "share": [r5(r["public_share_pct"]) for r in pub]}

    cpi = defaultdict(list)
    for r in read_csv(os.path.join(DS, "consumer-price-indices_uzb.csv")):
        item = r["Item"]
        if "Indices" not in item:
            continue
        v = r5(r["Value"])
        if v is None:
            continue
        cpi[item].append([r["StartDate"], v])
    m["cpiMonthly"] = {k.replace("Consumer Prices, ", "").replace(" (2015 = 100)", ""):
                       sorted(v) for k, v in cpi.items()}

    pp = defaultdict(list)
    ppath = os.path.join(DS, "producer-prices_uzb.csv")
    if os.path.exists(ppath):
        for r in read_csv(ppath):
            if "USD" not in r.get("Element", ""):
                continue
            v = r5(r["Value"])
            if v is None:
                continue
            try:
                yr = int(r["Year"])
            except ValueError:
                continue
            pp[r["Item"]].append([yr, v])
        m["producerPrices"] = {k: sorted(v) for k, v in pp.items() if len(v) >= 3}
    return m

# ------------------------------------------------- dashboard-only extensions
def build_ext():
    """Longer-coverage series from datasets/dashboard_extension/ (see its
    README). Dashboard-only: not part of the dissertation data."""
    ext_dir = os.path.join(DS, "dashboard_extension")
    if not os.path.isdir(ext_dir):
        return None
    ext = {}

    def pairs(name, col):
        rows = read_csv(os.path.join(ext_dir, name))
        return [[int(r["Year"]), r5(r[col])] for r in rows
                if r5(r[col]) is not None]

    ext["gasProdTWh"] = pairs("owid_gas_production_uzb.csv", "Gas")
    ext["gasConsTWh"] = pairs("owid_gas_consumption_uzb.csv", "Gas")
    ext["maddison"] = pairs("maddison_gdp_per_capita_uzb.csv", "GDP per capita")

    rows = read_csv(os.path.join(ext_dir, "owid_electricity_mix_uzb.csv"))
    srcs = [c for c in rows[0].keys() if c not in ("Entity", "Code", "Year")]
    ext["elecMix"] = {"years": [int(r["Year"]) for r in rows],
                      "sources": {s: [r5(r[s]) for r in rows] for s in srcs}}
    return ext

# --------------------------------------------------------------------- main
def main():
    print("Building WB indicator explorer ...")
    wb = build_wb()
    print(f"  {len(wb['series'])} indicators, {len(wb['topics'])} topics")
    print("Canonical tables ...")
    tables = build_tables()
    print("Regional panel ...")
    regional = build_regional()
    print(f"  {len(regional)} regional indicators")
    print("Climate (streaming 48MB of dekadal data) ...")
    climate = build_climate()
    print("RWI points ...")
    rwi = build_rwi()
    print(f"  {len(rwi['w'])} grid cells")
    print("Boundaries + RWI point-in-polygon ...")
    geo = load_geo()
    rwi_agg = build_rwi_agg(rwi, geo)
    print("District climate ...")
    clim_district = build_district_climate()
    print("Macro series ...")
    macro = build_macro()
    print("Dashboard extension series ...")
    ext = build_ext()

    data = {"meta": {"built": datetime.date.today().isoformat()},
            "wb": wb, "tables": tables, "regional": regional,
            "climate": climate, "rwi": rwi, "macro": macro,
            "geo": geo, "rwiAgg": rwi_agg, "climDistrict": clim_district,
            "ext": ext}
    payload = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    print(f"JSON payload: {len(payload)/1e6:.1f} MB")

    with open(os.path.join(HERE, "template.html"), encoding="utf-8") as f:
        html = f.read()
    marker = "/*__DASHBOARD_DATA__*/null"
    if marker not in html:
        sys.exit("template.html missing data marker")
    html = html.replace(marker, payload, 1)
    out_path = os.path.join(HERE, "Uzbekistan_Dashboard.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Wrote {out_path} ({os.path.getsize(out_path)/1e6:.1f} MB)")

if __name__ == "__main__":
    main()
