#!/usr/bin/env python3
"""Convert the HDX COD-AB shapefiles (dashboard/geodata/*.zip) to simplified
GeoJSON with OCHA pcodes. Pure stdlib: minimal SHP + DBF readers and
Douglas-Peucker simplification.

Run once (or after replacing the zips):  python3 dashboard/geo_prep.py
Source: https://data.humdata.org/dataset/cod-ab-uzb (uzb_admbnda_*_2018b.zip)
"""
import json, os, struct, zipfile

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "geodata")

def read_dbf(data):
    n_rec = struct.unpack("<I", data[4:8])[0]
    hdr_len = struct.unpack("<H", data[8:10])[0]
    rec_len = struct.unpack("<H", data[10:12])[0]
    fields, off = [], 32
    while data[off] != 0x0D:
        name = data[off:off + 11].split(b"\0")[0].decode()
        flen = data[off + 16]
        fields.append((name, flen))
        off += 32
    recs = []
    for i in range(n_rec):
        base = hdr_len + i * rec_len + 1  # +1 skips deletion flag
        rec, p = {}, base
        for name, flen in fields:
            rec[name] = data[p:p + flen].decode("utf-8", "replace").strip()
            p += flen
        recs.append(rec)
    return recs

def read_shp(data):
    """Return list of shapes; each shape is a list of rings (lists of [x,y])."""
    shapes, off = [], 100
    n = len(data)
    while off < n:
        length = struct.unpack(">i", data[off + 4:off + 8])[0] * 2
        rec = data[off + 8:off + 8 + length]
        off += 8 + length
        stype = struct.unpack("<i", rec[:4])[0]
        if stype != 5:  # only Polygon expected
            shapes.append([])
            continue
        n_parts, n_pts = struct.unpack("<ii", rec[36:44])
        parts = struct.unpack(f"<{n_parts}i", rec[44:44 + 4 * n_parts])
        pts_off = 44 + 4 * n_parts
        pts = struct.unpack(f"<{2*n_pts}d", rec[pts_off:pts_off + 16 * n_pts])
        rings = []
        for j in range(n_parts):
            a = parts[j]
            b = parts[j + 1] if j + 1 < n_parts else n_pts
            rings.append([[pts[2 * k], pts[2 * k + 1]] for k in range(a, b)])
        shapes.append(rings)
    return shapes

def dp(points, tol):
    """Douglas-Peucker on a ring."""
    if len(points) < 5:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        ax, ay = points[a]; bx, by = points[b]
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        dmax, imax = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            if seg2 == 0:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / seg2
                t = max(0.0, min(1.0, t))
                d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d2 > dmax:
                dmax, imax = d2, i
        if dmax > tol * tol:
            keep[imax] = True
            stack.append((a, imax)); stack.append((imax, b))
    return [p for p, k in zip(points, keep) if k]

def convert(zip_name, shp_base, props_map, tol):
    zp = os.path.join(HERE, zip_name)
    with zipfile.ZipFile(zp) as z:
        shp = read_shp(z.read(shp_base + ".shp"))
        dbf = read_dbf(z.read(shp_base + ".dbf"))
    feats = []
    for shape, rec in zip(shp, dbf):
        rings = []
        for ring in shape:
            r = dp(ring, tol)
            r = [[round(x, 4), round(y, 4)] for x, y in r]
            if len(r) >= 4:
                rings.append(r)
        if not rings:
            continue
        props = {k: rec[v] for k, v in props_map.items()}
        feats.append({"type": "Feature", "properties": props,
                      "geometry": {"type": "Polygon", "coordinates": rings}})
    return {"type": "FeatureCollection", "features": feats}

def main():
    adm1 = convert("uzb_adm1_shp.zip", "uzb_admbnda_adm1_2018b",
                   {"pcode": "ADM1_PCODE", "name": "ADM1_EN"}, tol=0.01)
    adm2 = convert("uzb_adm2_shp.zip", "uzb_admbnda_adm2_2018b",
                   {"pcode": "ADM2_PCODE", "name": "ADM2_EN",
                    "adm1": "ADM1_PCODE"}, tol=0.005)
    for name, gj in [("uzb_adm1.json", adm1), ("uzb_adm2.json", adm2)]:
        out = os.path.join(HERE, name)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(gj, f, separators=(",", ":"), ensure_ascii=False)
        print(f"{name}: {len(gj['features'])} features, "
              f"{os.path.getsize(out)/1e3:.0f} KB")

if __name__ == "__main__":
    main()
