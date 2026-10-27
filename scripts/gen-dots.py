# Usage: curl -sL https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ind.geojson -o /tmp/ne_ind.geojson
#        python3 scripts/gen-dots.py /tmp/ne_ind.geojson public/rates/dots.js
"""Dot grid and exact outlines for the rates map.

Source: Natural Earth 10m admin-0 countries, India point of view (all of Jammu & Kashmir and
Ladakh in India), which is the boundary India requires on maps shown there.

Dots: one per grid cell (288 columns, 1.25 deg), sampled 4x4. A cell gets a dot only when its centre is on land; it
belongs to the country under its centre when that country covers 3+ of 16 samples (else the largest share), and keeps its land coverage (1-9) so the map can size the dot.
Every market country, every euro member, every market island over 1,000 km2 and every other
country over 20,000 km2 gets at least one dot.

Outlines: every market's polygons, simplified to 0.05 deg, for exact market borders and the hover shape.
Borders: every other country (name, ISO code, rings), simplified to 0.1 deg, for the thin grey country lines
and for naming an unsupported country a visitor clicks."""
import json, sys, math
import numpy as np

src = json.load(open(sys.argv[1]))
EURO = "AUT BEL HRV CYP EST FIN FRA DEU GRC IRL ITA LVA LTU LUX MLT NLD PRT SVK SVN ESP".split()
# Supported markets: keep in step with src/data/markets.json and the market list in public/rates/core.js
COVER = {"USA": "US", "IND": "IN", "CHN": "CN", "HKG": "HK", "SGP": "SG", "VNM": "VN", "PHL": "PH", "GBR": "GB", "MEX": "MX", "BRA": "BR",
         "COL": "CO", "ARE": "AE", "NGA": "NG", "PAK": "PK", "BGD": "BD", "IDN": "ID", "THA": "TH", "MYS": "MY",
         "JPN": "JP", "KEN": "KE", "UGA": "UG", "TZA": "TZ", **{k: "EU" for k in EURO}}
KEYS = sorted(set(COVER.values()))
CH = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
code = {k: CH[i] for i, k in enumerate(KEYS)}

W, LAT0, LAT1, LON0, S = 288, 83.0, -56.0, -170.0, 4
step = 360 / W
H = int(round((LAT0 - LAT1) / step))

# countries -> polygons (list of rings) and scanline edges
a3s, names, iso2s, polys, edges = [], [], [], [], []
for f in src["features"]:
    g = f["geometry"]
    if not g: continue
    props = f["properties"]; iso2 = props.get("ISO_A2_EH") or props.get("ISO_A2") or ""
    cid = len(a3s); a3s.append(props["ADM0_A3"]); names.append(props["NAME"]); iso2s.append(iso2 if len(iso2) == 2 else "")
    # Caribbean Netherlands (Bonaire, Sint Eustatius, Saba) uses USD and is outside SEPA: not euro area
    if a3s[cid] == "NLD": bes = len(a3s); a3s.append("BES"); names.append("Caribbean Netherlands"); iso2s.append("BQ")
    for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]):
        if a3s[cid] == "NLD" and sum(p[0] for p in poly[0]) / len(poly[0]) < -30:
            own = bes
        else:
            own = cid
        polys.append((own, poly))
        for ring in poly:
            for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
                if abs(x2 - x1) < 180 and y1 != y2: edges.append((x1, y1, x2, y2, own))
E = np.array(edges)

def sample(n_rows, n_cols):
    # country index at each sample point (row and column centres), -1 for sea
    lat_ = LAT0 - (np.arange(n_rows) + .5) * (H * step) / n_rows
    lon_ = LON0 + (np.arange(n_cols) + .5) * 360 / n_cols
    lon_ = np.where(lon_ > 180, lon_ - 360, lon_)
    out = np.full((n_rows, n_cols), -1, dtype=np.int32)
    for r, lat in enumerate(lat_):
        e = E[(E[:, 1] <= lat) != (E[:, 3] <= lat)]
        xs = e[:, 0] + (lat - e[:, 1]) * (e[:, 2] - e[:, 0]) / (e[:, 3] - e[:, 1])
        for cid in np.unique(e[:, 4]).astype(int):
            v = np.sort(xs[e[:, 4] == cid])
            for a, b in zip(v[::2], v[1::2]):
                out[r, (lon_ >= a) & (lon_ <= b)] = cid
    return out
owner = sample(H * S, W * S)
centre = sample(H, W)

blocks = owner.reshape(H, S, W, S).transpose(0, 2, 1, 3).reshape(H, W, S * S)
cell = np.full((H, W), -1, dtype=np.int32)
cov = np.zeros((H, W))
for y in range(H):
    for x in range(W):
        b = blocks[y, x]; b = b[b >= 0]
        c = centre[y, x]
        # A dot is drawn only when its centre is on land, so dots never spill past the coastline. It belongs to the
        # country under its centre when that country covers 3+ of the 16 samples; on a sliver, the largest share wins.
        if c < 0: continue
        if (b == c).sum() >= 3 or (b != c).sum() < 3:
            cell[y, x] = c
        else:
            vals, cnt = np.unique(b, return_counts=True); cell[y, x] = vals[cnt.argmax()]
        cov[y, x] = len(b) / (S * S)

def area_centroid(ring):
    a = cx = cy = 0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        f = x1 * y2 - x2 * y1; a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f
    if abs(a) < 1e-12: return ring[0][0], ring[0][1], 0
    lon, lat = cx / (3 * a), cy / (3 * a)
    return lon, lat, abs(a) / 2 * 111.32 ** 2 * math.cos(math.radians(lat))
to_cell = lambda lon, lat: (int(((lon - LON0) % 360) / step), int((LAT0 - lat) / step))
counts = lambda cid: int((cell == cid).sum())
forced = []
def force(cid, x, y, why):
    if not (0 <= y < H): return False
    v = cell[y, x]
    if v >= 0 and v != cid and a3s[v] in COVER and counts(v) <= 1: return False
    cell[y, x] = cid; cov[y, x] = max(cov[y, x], .35); forced.append((names[cid], why)); return True

# every market and euro member, and every other country over 20,000 km2, gets a dot
for cid in range(len(a3s)):
    if counts(cid): continue
    rings = [p[0] for c, p in polys if c == cid]
    if not rings: continue
    lon, lat, km2 = max((area_centroid(r) for r in rings), key=lambda t: t[2])
    if a3s[cid] not in COVER and km2 < 20000: continue
    hits = (blocks == cid).sum(axis=2); y, x = np.unravel_index(hits.argmax(), hits.shape)
    if not (hits[y, x] and force(cid, x, y, "no dot")):
        force(cid, *to_cell(lon, lat), "no dot (centroid)")

# every market island over 1,000 km2 gets a dot
for cid, poly in polys:
    if a3s[cid] not in COVER: continue
    lon, lat, km2 = area_centroid(poly[0])
    if km2 < 1000 or not (LAT1 < lat < LAT0): continue
    xs_ = [p[0] for p in poly[0]]; ys_ = [p[1] for p in poly[0]]
    x0, y0 = to_cell(min(xs_), max(ys_)); x1, y1 = to_cell(max(xs_), min(ys_))
    if x1 >= x0 and (cell[max(0, y0):y1 + 1, x0:x1 + 1] == cid).any(): continue
    x, y = to_cell(lon, lat)
    if cell[y, x] < 0 or cell[y, x] == cid: force(cid, x, y, f"island {int(km2):,} km2")

# outlines: Douglas-Peucker per ring, drop slivers, keep tiny countries' main ring
def dp(pts, tol):
    if len(pts) < 4: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True; stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop(); (ax, ay), (bx, by) = pts[i], pts[j]; dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy) or 1e-12
        best, bk = -1, -1
        for k in range(i + 1, j):
            d = abs(dy * (pts[k][0] - ax) - dx * (pts[k][1] - ay)) / L
            if d > best: best, bk = d, k
        if best > tol: keep[bk] = True; stack += [(i, bk), (bk, j)]
    return [p for p, k in zip(pts, keep) if k]
outlines = {k: [] for k in KEYS}
for cid, poly in polys:
    key = COVER.get(a3s[cid])
    if not key: continue
    main = max((area_centroid(p[0])[2] for c, p in polys if c == cid), default=0)
    for ring in poly:
        km2 = area_centroid(ring)[2]
        if km2 < 150 and km2 < main * .5: continue
        m = len(ring) // 2
        r = dp(ring[:m + 1], .05) + dp(ring[m:], .05)[1:]  # closed ring: simplify two open halves
        if len(r) < 4: continue
        shift = 360 if max(p[0] for p in r) < LON0 else 0
        outlines[key].append([round(v, 2) for p in r for v in (p[0] + shift, p[1])])

# borders: every other country, simplified harder (0.1 deg), with its name and ISO code: drawn as thin lines, and
# used to name the country a visitor clicks to request access
borders = {}
for cid, poly in polys:
    if a3s[cid] in COVER: continue
    main = max((area_centroid(p[0])[2] for c, p in polys if c == cid), default=0)
    for ring in poly:
        km2 = area_centroid(ring)[2]
        if km2 < 800 and (km2 < main * .5 or main < 300): continue
        if max(p[1] for p in ring) < LAT1: continue
        m = len(ring) // 2
        r = dp(ring[:m + 1], .1) + dp(ring[m:], .1)[1:]
        if len(r) < 4: continue
        shift = 360 if max(p[0] for p in r) < LON0 else 0
        borders.setdefault(cid, {"n": names[cid], "c": iso2s[cid].lower(), "r": []})["r"].append([round(v, 1) for p in r for v in (p[0] + shift, p[1])])
borders = sorted(borders.values(), key=lambda b: b["n"])
print("borders:", len(borders), "countries,", sum(len(r) for b in borders for r in b["r"]) // 2, "points")

print("forced:", *forced, sep="\n  ")
for k in KEYS:
    ids = [i for i, a in enumerate(a3s) if COVER.get(a) == k]
    print(f"{k}: dots={sum(counts(i) for i in ids):>4}  outline rings={len(outlines[k]):>3} points={sum(len(r) for r in outlines[k]) // 2}")

rows = ["".join(" " if cell[y, x] < 0 else code.get(COVER.get(a3s[cell[y, x]]), "#") for x in range(W)) for y in range(H)]
covs = ["".join(" " if cell[y, x] < 0 else str(max(1, min(9, round(cov[y, x] * 9)))) for x in range(W)) for y in range(H)]
out = {"w": W, "h": H, "lat0": LAT0, "lon0": LON0, "step": step, "keys": "".join(code[k] for k in KEYS), "ids": KEYS, "rows": rows, "cov": covs, "outlines": outlines, "borders": borders}
open(sys.argv[2], "w").write("// Generated by scripts/gen-dots.py from Natural Earth 10m admin-0, India point of view. Do not edit.\nwindow.DOTS = " + json.dumps(out, separators=(",", ":")) + "\n")
