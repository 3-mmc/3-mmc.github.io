#!/usr/bin/env python3
"""Build the Uzbekistan Data Atlas data payloads.

Reads the project datasets + canonical results and writes one JSON per concern
into uzbekistan/data/, so each page fetches only what it draws. Pure standard
library (no pandas on this machine).

    python3 dashboard/build_data.py

Outputs
    core.json         masthead counts, headline figures, three-winter arc
    geo.json          adm1 + adm2 boundaries
    wealth.json       Meta RWI cells, regional means, railway distance
    wdi.json          World Bank WDI series (explore page)
    regional.json     stat.uz region x year panel (explore page)
    climate.json      WFP rainfall / NDVI, admin-1 and district
    energy.json       gas balance, electricity mix, grid access
    gold.json         gold exports, reserve composition, world price
    agriculture.json  producer prices, crop output, ag labour
    prices.json       CPI monthly, peer inflation, exchange rate
    people.json       wages, employment, migration, health, education
    findings.json     canonical tables T1-T7 + transcribed note figures
"""
import csv, json, math, os, sys, datetime
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DS = os.path.join(ROOT, "datasets")
OUT = os.path.join(ROOT, "exploration", "outputs")
HERE = os.path.join(ROOT, "dashboard")
CANON = os.path.join(HERE, "canonical")
SITE = os.path.join(ROOT, "uzbekistan", "data")

REFORM = "2024-05-01"


def r5(x):
    try:
        return float(f"{float(x):.5g}")
    except (TypeError, ValueError):
        return None


def read_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def load_canonical(name):
    """Canonical results recovered from the published build.

    Prefers a live rebuild from dissertation/ when that tree is present; falls
    back to the snapshot in dashboard/canonical/ otherwise.
    """
    with open(os.path.join(CANON, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


def write(name, obj):
    path = os.path.join(SITE, name + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
    kb = os.path.getsize(path) / 1024
    print(f"  {name+'.json':18s} {kb:8.1f} KB")
    return kb


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


def wb_pick(wb, code):
    """One WDI series as [[year, value], ...] — for the topic pages."""
    s = wb["series"].get(code)
    if not s:
        return None
    return {"name": s["n"], "points": [[y, v] for y, v in zip(s["y"], s["v"])]}


# ------------------------------------------------------------- regional panel
PMAP = {'UZ03': 'Andijan', 'UZ06': 'Bukhara', 'UZ08': 'Jizzakh', 'UZ10': 'Kashkadarya',
        'UZ12': 'Navoi', 'UZ14': 'Namangan', 'UZ18': 'Samarkand', 'UZ22': 'Surkhandarya',
        'UZ24': 'Syrdarya', 'UZ26': 'Tashkent_city', 'UZ27': 'Tashkent_region',
        'UZ30': 'Fergana', 'UZ33': 'Khorezm', 'UZ35': 'Karakalpakstan'}


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
    return {ind: {rg: sorted(pts) for rg, pts in regs.items()}
            for ind, regs in data.items()}


# ------------------------------------------------------------------- climate
def stream_climate(fn, val_col, months, how):
    acc = defaultdict(list)
    with open(os.path.join(DS, fn), newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            if row["adm_level"] != "1":
                continue
            region = PMAP.get(row["PCODE"])
            if not region:
                continue
            d = row["date"]
            mo = int(d[5:7])
            if mo not in months:
                continue
            try:
                v = float(row[val_col])
            except ValueError:
                continue
            acc[(region, int(d[:4]))].append(v)
    out = defaultdict(list)
    last_complete = datetime.date.today().year - 1
    for (region, yr), vals in acc.items():
        if yr > last_complete:
            continue
        agg = sum(vals) if how == "sum" else sum(vals) / len(vals)
        out[region].append([yr, r5(agg)])
    return {rg: sorted(pts) for rg, pts in out.items()}


def build_district_climate():
    vim, rfh = defaultdict(list), defaultdict(list)
    for r in read_csv(os.path.join(OUT, "district_climate_year.csv")):
        p = r["PCODE"]
        yr = int(float(r["year"]))
        v = r5(r["vim"]); w = r5(r["rfh"])
        if v is not None:
            vim[p].append([yr, v])
        if w is not None:
            rfh[p].append([yr, w])
    return {"ndvi": {p: sorted(v) for p, v in vim.items()},
            "rain": {p: sorted(v) for p, v in rfh.items()}}


# ----------------------------------------------------------------- geo + RWI
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


# --------------------------------------------------- Tsarist railway distance
def _seg_km(px, py, ax, ay, bx, by, kx, ky):
    """Point-to-segment distance in km, locally planar (deg -> km scaling)."""
    ax, bx, px = ax * kx, bx * kx, px * kx
    ay, by, py = ay * ky, by * ky, py * ky
    dx, dy = bx - ax, by - ay
    den = dx * dx + dy * dy
    t = 0.0 if den == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / den))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def build_railway(rwi, stations):
    """Distance from each RWI cell to the 1888-1906 Trans-Caspian line.

    Mirrors exploration/railway_rwi.py: min distance to the main line or the
    Fergana branch, treating consecutive stations as segments.
    """
    ky = 111.32
    kx = 111.32 * math.cos(math.radians(41.0))
    segs = []
    for key in ("main", "fergana"):
        pts = [(s["lon"], s["lat"]) for s in stations[key]]
        segs += list(zip(pts, pts[1:]))
    dist = []
    for lat, lon in zip(rwi["lat"], rwi["lon"]):
        dist.append(round(min(_seg_km(lon, lat, a[0], a[1], b[0], b[1], kx, ky)
                              for a, b in segs), 1))
    # binned gradient, the shape exploration/railway_rwi.py reports
    edges = [0, 10, 20, 40, 60, 100, 150, 200, 10 ** 9]
    labels = ["0–10", "10–20", "20–40", "40–60", "60–100", "100–150", "150–200", "200+"]
    acc = defaultdict(list)
    for dkm, w in zip(dist, rwi["w"]):
        for i in range(len(edges) - 1):
            if edges[i] <= dkm < edges[i + 1]:
                acc[labels[i]].append(w)
                break
    bins = [{"band": lb + (" km" if lb != "200+" else " km"),
             "n": len(acc[lb]),
             "meanRwi": r5(sum(acc[lb]) / len(acc[lb])) if acc[lb] else None}
            for lb in labels if acc[lb]]
    return dist, bins


# ------------------------------------------------------------- topic payloads
def build_energy(regional, wb, ext):
    e = {}
    rows = read_csv(os.path.join(OUT, "uzb_gas_balance.csv"))
    e["gasBalance"] = [{"year": int(float(r["year"])),
                        "production": r5(r["production_mcm"]),
                        "consumption": r5(r["consumption_mcm"]),
                        "net": r5(r["net_balance_mcm"])} for r in rows]
    if ext:
        e["gasLongRun"] = {
            "production": [[y, r5(v / 10.55 * 1000)] for y, v in ext["gasProdTWh"]],
            "consumption": [[y, r5(v / 10.55 * 1000)] for y, v in ext["gasConsTWh"]],
            "note": "Energy Institute via OWID, converted at 1 bcm ≈ 10.55 TWh",
        }
        em = ext["elecMix"]
        order = ["Coal", "Oil", "Gas", "Nuclear", "Hydropower", "Wind", "Solar",
                 "Bioenergy", "Other renewables"]
        e["elecMix"] = {"years": em["years"],
                        "sources": {s: em["sources"][s] for s in order
                                    if em["sources"].get(s) and any(em["sources"][s])}}
    key = "environment::Provision_of_apartments_houses_with_natural_gas"
    if key in regional:
        e["gasAccess"] = regional[key]
    for label, ind in (("electricityProduction", "energy industry::electricity_production_440"),
                       ("electricityConsumption", "energy industry::electricity_consumption_subscribers_2684"),
                       ("thermalProduction", "energy industry::thermal_energy_production_444")):
        if ind in regional:
            e[label] = regional[ind]
    e["wdi"] = {k: wb_pick(wb, c) for k, c in (
        ("accessElectricity", "EG.ELC.ACCS.ZS"),
        ("accessRural", "EG.ELC.ACCS.RU.ZS"),
        ("accessUrban", "EG.ELC.ACCS.UR.ZS"),
        ("gasRents", "NY.GDP.NGAS.RT.ZS"),
        ("fuelExportShare", "TX.VAL.FUEL.ZS.UN"),
        ("energyImportsNet", "EG.IMP.CONS.ZS"),
        ("elecPerCapita", "EG.USE.ELEC.KH.PC"),
        ("gridLosses", "EG.ELC.LOSS.ZS"),
        ("firmsOutages", "IC.ELC.OUTG.ZS"),
    )}
    return e


def build_gold(wb):
    """Public, descriptive gold data only — exports, reserve composition, price.

    The sterilisation work in _leads/ is deliberately excluded: that paper is
    unwritten, and its results are not published here.
    """
    g = {}
    rows = read_csv(os.path.join(OUT, "gold_share_of_exports.csv"))
    g["exports"] = [{"year": int(float(r["year"])),
                     "usdBn": r5(r["gold_usd_bn"]),
                     "sharePct": r5(r["gold_share_of_tracked_exports_pct"])}
                    for r in rows]
    g["wdi"] = {k: wb_pick(wb, c) for k, c in (
        ("reservesTotal", "FI.RES.TOTL.CD"),
        ("reservesExGold", "FI.RES.XGLD.CD"),
        ("reservesMonths", "FI.RES.TOTL.MO"),
        ("mineralRents", "NY.GDP.MINR.RT.ZS"),
        ("resourceRents", "NY.GDP.TOTL.RT.ZS"),
        ("oresMetalsExportShare", "TX.VAL.MMTL.ZS.UN"),
        ("merchExports", "TX.VAL.MRCH.CD.WT"),
    )}
    tot = g["wdi"].get("reservesTotal")
    exg = g["wdi"].get("reservesExGold")
    if tot and exg:
        m = {y: v for y, v in exg["points"]}
        g["reserveSplit"] = [
            {"year": y, "goldUsdBn": r5((v - m[y]) / 1e9), "otherUsdBn": r5(m[y] / 1e9),
             "goldSharePct": r5(100 * (v - m[y]) / v)}
            for y, v in tot["points"] if y in m and v]
    p = os.path.join(ROOT, "_leads", "gold_data", "gold_price_monthly_usd.csv")
    if os.path.exists(p):
        with open(p, newline="", encoding="utf-8-sig") as f:
            rd = csv.reader(f)
            next(rd, None)
            g["priceUsdOz"] = [[row[0][:7], r5(row[1])] for row in rd
                               if len(row) > 1 and r5(row[1]) is not None]
    return g


def build_agriculture(regional, wb):
    a = {}
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
        a["producerPrices"] = {k: sorted(v) for k, v in pp.items() if len(v) >= 3}
    crops = {}
    for ind, series in regional.items():
        if ind.startswith("agriculture production::"):
            crops[ind.split("::")[1]] = series
    a["production"] = crops
    a["wdi"] = {k: wb_pick(wb, c) for k, c in (
        ("agValueAddedShare", "NV.AGR.TOTL.ZS"),
        ("agValueAddedPerWorker", "NV.AGR.EMPL.KD"),
        ("employmentAg", "SL.AGR.EMPL.ZS"),
        ("cerealYield", "AG.YLD.CREL.KG"),
        ("cerealProduction", "AG.PRD.CREL.MT"),
        ("irrigatedShare", "AG.LND.IRIG.AG.ZS"),
        ("freshwaterAg", "ER.H2O.FWAG.ZS"),
        ("rawMaterialExportShare", "TX.VAL.AGRI.ZS.UN"),
    )}
    return a


def build_prices(wb):
    p = {}
    cpi = defaultdict(list)
    for r in read_csv(os.path.join(DS, "consumer-price-indices_uzb.csv")):
        item = r["Item"]
        if "Indices" not in item:
            continue
        v = r5(r["Value"])
        if v is None:
            continue
        cpi[item].append([r["StartDate"], v])
    p["cpiMonthly"] = {k.replace("Consumer Prices, ", "").replace(" (2015 = 100)", ""):
                       sorted(v) for k, v in cpi.items()}
    p["wdi"] = {k: wb_pick(wb, c) for k, c in (
        ("inflation", "FP.CPI.TOTL.ZG"),
        ("deflator", "NY.GDP.DEFL.KD.ZG"),
        ("exchangeRate", "PA.NUS.FCRF"),
        ("gdpPerCapita", "NY.GDP.PCAP.CD"),
        ("gdpPerCapitaPpp", "NY.GDP.PCAP.PP.KD"),
        ("tradeShare", "NE.TRD.GNFS.ZS"),
        ("creditPrivate", "FS.AST.PRVT.GD.ZS"),
        ("agValueAddedShare", "NV.AGR.TOTL.ZS"),
        ("industryShare", "NV.IND.TOTL.ZS"),
        ("servicesShare", "NV.SRV.TOTL.ZS"),
    )}
    return p


# ─────────────────────────────────── map ──────────────────────────────────
# A tile cartogram of the 14 regions, laid out on an odd-r offset hex grid that
# keeps the real west→east, north→south arrangement. Uzbekistan's regions differ
# in area by two orders of magnitude — Karakalpakstan is ~165,000 km², Tashkent
# city ~335 — so on a true-area map the densest places are invisible. Equal tiles
# fix that; the choropleth beside it keeps the real geography.
HEX_LAYOUT = {
    "Karakalpakstan":   (0, 0),
    "Navoi":            (2, 1),
    "Khorezm":          (1, 2),
    "Tashkent_region":  (5, 1),
    "Tashkent_city":    (6, 1),
    "Namangan":         (6, 2),
    "Andijan":          (7, 2),
    "Jizzakh":          (4, 2),
    "Syrdarya":         (5, 2),
    "Fergana":          (7, 3),
    "Bukhara":          (2, 3),
    "Samarkand":        (3, 3),
    "Kashkadarya":      (3, 4),
    "Surkhandarya":     (4, 5),
}


def _rings(geom):
    """Yield each polygon's ring list, for Polygon or MultiPolygon."""
    if geom["type"] == "Polygon":
        yield geom["coordinates"]
    elif geom["type"] == "MultiPolygon":
        for poly in geom["coordinates"]:
            yield poly
    else:                                    # the boundaries here are flat rings
        yield geom["coordinates"]


def _ring_area_km2(ring):
    """Geodesic area of one ring, in km² (spherical excess)."""
    R = 6371.0088
    total = 0.0
    n = len(ring)
    if n < 3:
        return 0.0
    for i in range(n):
        lon1, lat1 = math.radians(ring[i][0]), math.radians(ring[i][1])
        lon2, lat2 = math.radians(ring[(i + 1) % n][0]), math.radians(ring[(i + 1) % n][1])
        total += (lon2 - lon1) * (2 + math.sin(lat1) + math.sin(lat2))
    return abs(total * R * R / 2.0)


def polygon_area_km2(geom):
    """Area of a feature, resolving holes by containment rather than ring order.

    These boundary files use `Polygon` with several rings to mean *separate
    landmasses* (Fergana has four, largest last), so the GeoJSON convention of
    "first ring outer, rest are holes" would subtract real territory — it gave
    Tashkent region a negative area. Instead nest each ring by how many larger
    rings contain it: even depth adds, odd depth is a hole.
    """
    parts = []
    for poly in _rings(geom):
        if not poly:
            continue
        if isinstance(poly[0][0], (int, float)):      # a flat ring
            parts.append(poly)
        else:
            parts.extend(poly)

    infos = [(_ring_area_km2(r), r) for r in parts if len(r) >= 3]
    total = 0.0
    for i, (a, r) in enumerate(infos):
        depth = sum(1 for j, (a2, r2) in enumerate(infos)
                    if j != i and a2 > a and _pip(r[0][0], r[0][1], [r2]))
        total += -a if depth % 2 else a
    return total


HOUSING = {
    "rooms": [
        ("One_room_apartments_houses_in_the_context_of_rooms", "1 room"),
        ("2_rooms_apartments_houses", "2 rooms"),
        ("3_rooms_apartments_houses", "3 rooms"),
        ("4_rooms_apartments_houses", "4 rooms"),
        ("5_rooms_apartments_houses", "5 rooms"),
        ("6_rooms_and_more_apartments_houses", "6+ rooms"),
    ],
    "walls": [
        ("Distribution_of_housing_stock_by_wall_material_Burnt_brick", "Burnt brick"),
        ("Distribution_of_housing_stock_by_wall_material_Raw_brick", "Raw brick"),
        ("Distribution_of_housing_stock_by_wall_material_Large_panel_a", "Panel / block"),
        ("Distribution_of_housing_stock_by_material_of_pise_wall", "Pisé (rammed earth)"),
        ("Distribution_of_housing_stock_by_material_of_others_wall", "Other"),
    ],
    "utilities": [
        ("Provision_of_apartments_houses_with_natural_gas", "Piped natural gas"),
        ("Providing_drinking_water_to_apartments_houses", "Piped drinking water"),
        ("Provision_of_apartments_houses_with_sewage", "Sewerage"),
    ],
    "type": [
        ("Number_of_apartments_in_apartment_buildings", "Flats in apartment blocks"),
        ("Number_of_individual_houses", "Individual houses"),
    ],
}


def build_map(regional, geo):
    m = {"hexLayout": {k: {"col": c, "row": r} for k, (c, r) in HEX_LAYOUT.items()}}

    areas = {}
    for f in geo["adm1"]["features"]:
        areas[f["properties"]["region"]] = r5(polygon_area_km2(f["geometry"]))
    m["areaKm2"] = areas

    # Population is not published per region in this collection. Dwellings and
    # mean household size are, so the density layer is an ESTIMATE — labelled as
    # one everywhere it appears, never presented as an official count.
    dwellings = regional.get("environment::Number_of_residential_apartments_houses", {})
    hhsize = regional.get("living-standards::Information_about_the_average_household_size", {})
    est = {}
    for region, pts in dwellings.items():
        sizes = dict(hhsize.get(region, []))
        series = []
        for yr, n in pts:
            s = sizes.get(yr)
            if s:
                series.append([yr, r5(n * s)])
        if series:
            est[region] = series
    m["populationEstimate"] = est
    m["density"] = {
        region: [[yr, r5(v / areas[region])] for yr, v in series]
        for region, series in est.items() if areas.get(region)
    }
    m["populationNote"] = ("Estimated as dwellings × mean household size (stat.uz). "
                           "Not an official population count.")

    housing = {}
    for group, items in HOUSING.items():
        block = {}
        for key, label in items:
            series = regional.get("environment::" + key)
            if series:
                block[label] = series
        if block:
            housing[group] = block
    m["housing"] = housing
    return m


# ────────────────────────────────── trade ─────────────────────────────────
def topo_to_geojson(topo, object_name):
    """Minimal TopoJSON decoder — enough for the world-atlas countries file."""
    tr = topo.get("transform")
    sx, sy = (tr["scale"] if tr else (1, 1))
    tx, ty = (tr["translate"] if tr else (0, 0))

    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        out = []
        for dx, dy in arc:
            if tr:
                x += dx; y += dy
                out.append([x * sx + tx, y * sy + ty])
            else:
                out.append([dx, dy])
        arcs.append(out)

    def ring(idxs):
        pts = []
        for i in idxs:
            a = arcs[~i][::-1] if i < 0 else arcs[i]
            pts.extend(a[1:] if pts else a)
        return pts

    feats = []
    for g in topo["objects"][object_name]["geometries"]:
        if g["type"] == "Polygon":
            coords = [ring(r) for r in g["arcs"]]
        elif g["type"] == "MultiPolygon":
            coords = [[ring(r) for r in poly] for poly in g["arcs"]]
        else:
            continue
        props = dict(g.get("properties", {}))
        props["id"] = g.get("id")
        feats.append({"type": "Feature", "id": g.get("id"),
                      "properties": props,
                      "geometry": {"type": g["type"], "coordinates": coords}})
    return {"type": "FeatureCollection", "features": feats}


def _round_coords(obj, nd=2):
    if isinstance(obj, list):
        if obj and isinstance(obj[0], (int, float)):
            return [round(v, nd) for v in obj]
        return [_round_coords(v, nd) for v in obj]
    return obj


def _centroid(geom):
    """Area-weighted centroid of the largest ring — good enough for a flow map."""
    best, best_area = None, -1
    for poly in _rings(geom):
        r = poly[0] if poly and not isinstance(poly[0][0], (int, float)) else poly
        a = _ring_area_km2(r)
        if a > best_area:
            best_area, best = a, r
    if not best:
        return None
    return [r5(sum(p[0] for p in best) / len(best)), r5(sum(p[1] for p in best) / len(best))]


def build_trade():
    """Bilateral merchandise trade by partner (UN Comtrade), plus world shapes."""
    cdir = os.path.join(DS, "comtrade")
    wpath = os.path.join(HERE, "geodata", "world-110m.topo.json")
    if not (os.path.isdir(cdir) and os.path.exists(wpath)):
        return None

    with open(wpath, encoding="utf-8") as f:
        world = topo_to_geojson(json.load(f), "countries")
    for feat in world["features"]:
        feat["geometry"]["coordinates"] = _round_coords(feat["geometry"]["coordinates"], 2)
    centroids = {f["properties"]["id"]: _centroid(f["geometry"]) for f in world["features"]}

    # Comtrade mixes real countries with aggregates ("Areas, nes", "Other Asia",
    # free zones). For Uzbekistan the unallocated bucket is huge — most gold
    # leaves to an unspecified destination — so it must not be silently dropped
    # onto the map as if it were a country.
    groups = set()
    apath = os.path.join(cdir, "partner_areas.csv")
    if os.path.exists(apath):
        for row in read_csv(apath):
            if str(row.get("isGroup", "")).strip().lower() == "true":
                groups.add(str(row.get("PartnerCode", "")).strip())

    flows = defaultdict(lambda: defaultdict(float))
    unallocated = defaultdict(float)
    names, commodities = {}, defaultdict(lambda: defaultdict(float))
    for fn, flow in (("uzb_annual_hs2_export.csv", "export"),
                     ("uzb_annual_hs2_import.csv", "import")):
        p = os.path.join(cdir, fn)
        if not os.path.exists(p):
            continue
        for row in read_csv(p):
            code = (row.get("partnerCode") or "").strip()
            iso = (row.get("partnerISO") or "").strip()
            if not code or iso == "W00":            # W00 = World, the total row
                continue
            try:
                year = int(row["refYear"])
                val = float(row.get("primaryValue") or 0)
            except (ValueError, TypeError):
                continue
            if val <= 0:
                continue
            commodities[(flow, year)][row.get("_hs_label", "other")] += val
            if code in groups or code not in centroids or not centroids.get(code):
                unallocated[(flow, year)] += val
                continue
            flows[(flow, year)][code] += val
            names[code] = row.get("partnerDesc", code)

    years = sorted({y for _, y in flows})
    return {
        "world": world,
        "centroids": {k: v for k, v in centroids.items() if v},
        "years": years,
        "partnerNames": names,
        "flows": {f"{fl}:{yr}": {c: r5(v) for c, v in sorted(d.items(), key=lambda kv: -kv[1])}
                  for (fl, yr), d in flows.items()},
        "unallocated": {f"{fl}:{yr}": r5(v) for (fl, yr), v in unallocated.items()},
        "commodities": {f"{fl}:{yr}": {k: r5(v) for k, v in sorted(d.items(), key=lambda kv: -kv[1])}
                        for (fl, yr), d in commodities.items()},
        "home": "860",
        "note": ("UN Comtrade, the HS-2 commodity groups pulled for this project — "
                 "not total merchandise trade. Trade reported to an unspecified "
                 "destination is counted separately, not placed on the map."),
    }


def build_people(regional, wb):
    m = {}
    wages = defaultdict(list)
    for r in read_csv(os.path.join(OUT, "wage_real_by_sector.csv")):
        wages[r["name"]].append([int(float(r["year"])), r5(r["real_sum_2017"])])
    m["wagesReal"] = {k: sorted(v) for k, v in wages.items()}

    emp = defaultdict(list)
    for r in read_csv(os.path.join(OUT, "employment_sector_share.csv")):
        emp[r["name"]].append([int(float(r["year"])), r5(r["share_pct"])])
    m["employmentShare"] = {k: sorted(v) for k, v in emp.items()}

    pub = [r for r in read_csv(os.path.join(OUT, "employment_public_share.csv"))
           if r["name"] == "Republic of Uzbekistan"]
    m["publicShare"] = [[int(float(r["year"])), r5(r["public_share_pct"])] for r in pub]

    rows = read_csv(os.path.join(OUT, "l2cu_migration_ts.csv"))
    m["migration"] = [{"date": r["date"], "abroad": r5(r["pct_abroad"]),
                       "considering": r5(r["pct_considering"]),
                       "returned": r5(r["pct_returned"])} for r in rows]

    health = defaultdict(lambda: defaultdict(list))
    hrows = read_csv(os.path.join(OUT, "health_panel.csv"))
    for r in hrows:
        for c in hrows[0].keys():
            if c in ("region", "year"):
                continue
            v = r5(r[c])
            if v is not None:
                health[c][r["region"]].append([int(float(r["year"])), v])
    m["health"] = {c: {rg: sorted(pts) for rg, pts in regs.items()}
                   for c, regs in health.items()}

    m["wdi"] = {k: wb_pick(wb, c) for k, c in (
        ("population", "SP.POP.TOTL"),
        ("urbanShare", "SP.URB.TOTL.IN.ZS"),
        ("povertyNational", "SI.POV.NAHC"),
        ("unemployment", "SL.UEM.TOTL.ZS"),
        ("remittancesGdp", "BX.TRF.PWKR.DT.GD.ZS"),
        ("internetUsers", "IT.NET.USER.ZS"),
        ("tertiaryGpi", "SE.ENR.TERT.FM.ZS"),
    )}
    return m


# --------------------------------------------------------------------- main
def main():
    os.makedirs(SITE, exist_ok=True)
    built = datetime.date.today().isoformat()

    print("World Bank WDI ...")
    wb = build_wb()
    print(f"  {len(wb['series'])} indicators, {len(wb['topics'])} topics")
    print("stat.uz regional panel ...")
    regional = build_regional()
    print(f"  {len(regional)} indicators")
    print("Boundaries ...")
    geo = load_geo()
    print("Meta RWI ...")
    rwi = build_rwi()
    print(f"  {len(rwi['w'])} cells")
    rwi_agg = build_rwi_agg(rwi, geo)
    print("Climate (streaming dekadal data) ...")
    climate = {"rain": stream_climate("uzb-rainfall-subnat-full.csv", "rfh", set(range(3, 9)), "sum"),
               "ndvi": stream_climate("uzb-ndvi-subnat-full.csv", "vim", set(range(4, 10)), "mean")}
    clim_district = build_district_climate()

    tables = load_canonical("tables")
    ext = load_canonical("ext")
    notes = load_canonical("findings_numbers")

    print("Railway distance ...")
    rail_dist, rail_bins = build_railway(rwi, notes["railway"]["stations"])

    print("Writing payloads ...")
    total = 0
    total += write("geo", geo)
    total += write("wealth", {"rwi": rwi, "agg": rwi_agg,
                              "railDistKm": rail_dist,
                              "railBins": rail_bins,
                              "stations": notes["railway"]["stations"]})
    total += write("wdi", wb)
    total += write("regional", regional)
    total += write("climate", {"adm1": climate, "district": clim_district})
    total += write("energy", build_energy(regional, wb, ext))
    total += write("gold", build_gold(wb))
    total += write("agriculture", build_agriculture(regional, wb))
    total += write("prices", build_prices(wb))
    total += write("people", build_people(regional, wb))
    total += write("map", build_map(regional, geo))
    trade = build_trade()
    if trade:
        total += write("trade", trade)
    else:
        print("  ! trade skipped — datasets/comtrade or the world atlas is missing")
    total += write("findings", {"tables": tables, "notes": notes,
                                "railBins": rail_bins})
    # The spine: every page draws it, so ship a subsample rather than the full
    # 21,382 cells. Deterministic stride keeps the distance profile intact.
    stride = max(1, len(rail_dist) // 2400)
    spine = [[rail_dist[i], rwi["w"][i]] for i in range(0, len(rail_dist), stride)]

    total += write("core", {
        "built": built,
        "reform": REFORM,
        "spineSample": spine,
        "counts": {
            "wdiSeries": len(wb["series"]),
            "regionalSeries": len(regional),
            "districts": len(geo["adm2"]["features"]),
            "regions": len(geo["adm1"]["features"]),
            "wealthCells": len(rwi["w"]),
        },
        "headline": notes["headline"],
        "threeWinterArc": notes["threeWinterArc"],
        "reshuffleQuartiles": notes["reshuffleQuartiles"],
        "railBins": rail_bins,
    })
    print(f"  {'total':18s} {total/1024:8.1f} MB".replace("MB", "MB" if total > 1024 else "KB"))


if __name__ == "__main__":
    main()
