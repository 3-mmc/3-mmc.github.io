#!/usr/bin/env python3
"""Fetch dashboard-only extension datasets (longer time coverage than the
dissertation datasets) into datasets/dashboard_extension/. Pure stdlib.

Sources (all keyless, Our World in Data grapher CSV endpoints):
  - Gas production / consumption (Energy Institute Statistical Review), TWh, 1985+
  - Electricity generation by source (Ember / Energy Institute), TWh, 2000+
  - GDP per capita (Maddison Project Database 2023), 2011 int$, 1973+

Run:  python3 dashboard/fetch_extension.py
"""
import csv, io, os, urllib.request

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "datasets", "dashboard_extension")

SOURCES = [
    ("owid_gas_production_uzb.csv",
     "https://ourworldindata.org/grapher/gas-production-by-country.csv?csvType=full"),
    ("owid_gas_consumption_uzb.csv",
     "https://ourworldindata.org/grapher/gas-consumption-by-country.csv?csvType=full"),
    ("owid_electricity_mix_uzb.csv",
     "https://ourworldindata.org/grapher/electricity-prod-source-stacked.csv?csvType=full"),
    ("maddison_gdp_per_capita_uzb.csv",
     "https://ourworldindata.org/grapher/gdp-per-capita-maddison-project-database.csv?csvType=full"),
]

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read().decode("utf-8")

def main():
    os.makedirs(OUT, exist_ok=True)
    for name, url in SOURCES:
        rows = list(csv.reader(io.StringIO(fetch(url))))
        code_i = rows[0].index("Code")
        keep = [rows[0]] + [r for r in rows[1:] if r[code_i] == "UZB"]
        path = os.path.join(OUT, name)
        with open(path, "w", newline="", encoding="utf-8") as f:
            csv.writer(f).writerows(keep)
        print(f"{name}: {len(keep) - 1} rows")

if __name__ == "__main__":
    main()
