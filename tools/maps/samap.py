#!/usr/bin/env python3
"""Builds the evangelism map (South Africa + a close-up of Sandton) as inline SVG for the site pages.
Outline: Natural Earth via johan/world.geo.json (public domain). Usage: python3 tools/maps/samap.py <ZAF.geo.json>"""
import json, math, sys, pathlib
OUT = pathlib.Path(__file__).resolve().parents[1] / "site" / "partials" / "samap.html"
geo = json.load(open(sys.argv[1]))["features"][0]["geometry"]["coordinates"]

LON0, LON1, LAT0, LAT1 = 16.3, 33.1, -21.9, -35.0
K = math.cos(math.radians(28.5))
W = 600; H = round(W * (LAT0 - LAT1) / ((LON1 - LON0) * K))
def P(lon, lat): return ((lon - LON0) * K / ((LON1 - LON0) * K) * W, (LAT0 - lat) / (LAT0 - LAT1) * H)
def path(rings): return " ".join("M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in (P(*c) for c in ring)) + "Z" for ring in rings)

# Acts 1:8: Jerusalem (around the church) → Judea (Gauteng) → Samaria and the ends of the earth (the whole country).
NATION = [("Johannesburg & Sandton", 28.05, -26.15, 1), ("Pretoria", 28.19, -25.75, 2), ("Polokwane", 29.45, -23.90, 3), ("Mbombela", 30.97, -25.47, 3),
          ("Rustenburg", 27.24, -25.67, 2), ("Bloemfontein", 26.21, -29.12, 3), ("Kimberley", 24.76, -28.74, 3), ("Durban", 31.02, -29.86, 3),
          ("East London", 27.91, -33.02, 3), ("Gqeberha", 25.60, -33.96, 3), ("Cape Town", 18.42, -33.92, 3), ("Upington", 21.26, -28.45, 3)]
LOCAL = [("Sandton (start here)", 28.056, -26.107, 0), ("Woodmead · our church", 28.092, -26.054, 0), ("Alexandra", 28.105, -26.103, 1), ("Marlboro", 28.110, -26.085, 1),
         ("Rivonia", 28.060, -26.050, 1), ("Bryanston", 28.020, -26.060, 1), ("Fourways", 28.010, -26.020, 1), ("Randburg", 27.995, -26.095, 1),
         ("Midrand", 28.128, -25.990, 1), ("Diepsloot", 28.011, -25.932, 2), ("Tembisa", 28.227, -25.996, 2), ("Rosebank", 28.043, -26.146, 1),
         ("Joburg CBD", 28.047, -26.204, 2), ("Soweto", 27.880, -26.250, 2)]
COL = {0: "#e0567a", 1: "#c8963e", 2: "#6b5aa8", 3: "#2f8f6a"}

svg = [f'<svg class="sa-map" viewBox="-10 -10 {W+20} {H+20}" role="img" aria-labelledby="sa-t"><title id="sa-t">Map of South Africa: evangelism starting in Sandton, then Gauteng, then the whole country</title>',
       '<defs><radialGradient id="sa-g" cx="62%" cy="30%" r="80%"><stop offset="0" stop-color="#efe9fd"/><stop offset="1" stop-color="#e3eefd"/></radialGradient></defs>',
       f'<path d="{path(geo)}" fill="url(#sa-g)" stroke="#8f80d8" stroke-width="1.6" fill-rule="evenodd" stroke-linejoin="round"/>']
sx, sy = P(28.05, -26.15)
for r, o in ((70, .10), (42, .16), (18, .28)):
    svg.append(f'<circle cx="{sx:.1f}" cy="{sy:.1f}" r="{r}" fill="#e0567a" opacity="{o}"/>')
for name, lon, lat, wave in NATION:
    x, y = P(lon, lat)
    if wave > 1: svg.append(f'<path d="M{sx:.1f},{sy:.1f} Q{(sx+x)/2:.1f},{min(sy,y)-30:.1f} {x:.1f},{y:.1f}" fill="none" stroke="{COL[wave]}" stroke-width="1.3" stroke-dasharray="4 5" opacity=".55"/>')
NPOS = {"Pretoria": (-9, -9, "end"), "Rustenburg": (-10, 6, "end"), "Johannesburg & Sandton": (12, 14, "start"), "Mbombela": (8, -8, "start"), "Durban": (-10, 4, "end")}
for name, lon, lat, wave in NATION:
    x, y = P(lon, lat); dx, dy, anc = NPOS.get(name, (10, 4, "start"))
    svg.append(f'<g class="pin w{wave}"><circle cx="{x:.1f}" cy="{y:.1f}" r="{8 if wave == 1 else 5.5}" fill="{COL[wave] if wave > 1 else "#e0567a"}" stroke="#fff" stroke-width="2"/>'
               f'<text x="{x + dx:.1f}" y="{y + dy:.1f}" text-anchor="{anc}">{name}</text></g>')
svg.append("</svg>")

# Close-up around Sandton (lon 27.85–28.25, lat −25.90 … −26.28)
L0, L1, A0, A1 = 27.84, 28.26, -25.905, -26.275
w = 520; h = round(w * (A0 - A1) / ((L1 - L0) * math.cos(math.radians(26.1))))
def Q(lon, lat): return ((lon - L0) / (L1 - L0) * w, (A0 - lat) / (A0 - A1) * h)
cx, cy = Q(28.056, -26.107)
loc = [f'<svg class="sa-local" viewBox="0 0 {w} {h}" role="img" aria-labelledby="sl-t"><title id="sl-t">Close-up: areas around Sandton to reach first</title>',
       f'<rect width="{w}" height="{h}" rx="22" fill="#f7f5fd"/>']
for r, o in ((150, .07), (95, .10), (45, .16)):
    loc.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" fill="#e0567a" opacity="{o}"/>')
loc.append(f'<path d="M{Q(28.02,-25.90)[0]:.1f},0 C{Q(28.05,-26.0)[0]:.1f},{h*.3:.1f} {Q(28.03,-26.1)[0]:.1f},{h*.55:.1f} {Q(28.05,-26.275)[0]:.1f},{h:.1f}" stroke="#d9d2f0" stroke-width="7" fill="none" opacity=".8"/>')   # N1/M1 hint
LPOS = {"Sandton (start here)": (0, 26, "middle"), "Woodmead · our church": (12, -6, "start"), "Rivonia": (-11, -8, "end"), "Bryanston": (-11, 5, "end"),
        "Fourways": (-11, 5, "end"), "Randburg": (-11, 5, "end"), "Alexandra": (12, 14, "start"), "Marlboro": (12, 5, "start"), "Rosebank": (-11, 5, "end"),
        "Midrand": (-11, 5, "end"), "Tembisa": (-11, -12, "end"), "Diepsloot": (11, 5, "start"), "Joburg CBD": (11, 5, "start"), "Soweto": (11, 5, "start")}
for name, lon, lat, wave in LOCAL:
    x, y = Q(lon, lat); dx, dy, anc = LPOS.get(name, (11, 5, "start"))
    loc.append(f'<g class="pin w{wave}"><circle cx="{x:.1f}" cy="{y:.1f}" r="{9 if wave == 0 else 6}" fill="{COL[wave]}" stroke="#fff" stroke-width="2.4"/>'
               f'<text x="{x + dx:.1f}" y="{y + dy:.1f}" text-anchor="{anc}">{name}</text></g>')
loc.append("</svg>")

legend = ('<ul class="sa-legend"><li><i style="background:#e0567a"></i><b>Start here:</b> Sandton & Woodmead (our "Jerusalem")</li>'
          '<li><i style="background:#c8963e"></i><b>Next door:</b> Alexandra, Marlboro, Rivonia, Bryanston, Fourways, Randburg, Midrand, Rosebank</li>'
          '<li><i style="background:#6b5aa8"></i><b>Gauteng:</b> Soweto, Joburg CBD, Diepsloot, Tembisa, Pretoria (our "Judea")</li>'
          '<li><i style="background:#2f8f6a"></i><b>All of South Africa:</b> every province, "to the ends of the earth"</li></ul>')
OUT.write_text(f'<div class="sa-maps"><figure class="sa-fig">{"".join(svg)}<figcaption>South Africa</figcaption></figure>'
               f'<figure class="sa-fig">{"".join(loc)}<figcaption>Around Sandton</figcaption></figure></div>{legend}\n')
print("wrote", OUT, W, H)
