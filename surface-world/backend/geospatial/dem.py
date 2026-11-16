"""Real terrain: Jezero Crater from NASA Mars Reconnaissance Orbiter data.

Loads the region prepared by `scripts/import_mars_data.py` (HiRISE 1 m DTM block-averaged to 5 m, CTX
gap fill, HiRISE 25 cm orthoimage) and turns it into the same `Terrain` interface the procedural
source provides, so the planner, models and frontend need no special cases.

What is real and what is not:
  * heights, slope and the fine-scale (1 m) slope used for the roughness cost: NASA data, calculated
  * Perseverance landing site position: NASA JPL coordinates
  * feature sites: positions picked from the HiRISE image by us; descriptions say only what is visible
  * habitat and crew landing pad: SIMULATED, placed on the flattest ground we found
  * rocks: ILLUSTRATIVE scatter (seeded), denser where the 1 m slope says the ground is rough; small enough
    (< 0.8 m) that the planner treats them as cost only, never as obstacles
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from backend.geospatial.terrain import Hazard, Provenance, Rock, Site, Terrain

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "processed" / "jezero"
MANIFEST = ROOT / "data" / "manifests" / "jezero_region.json"
R_MARS = 3396190.0

# Fine slope (third quartile of the 1 m slopes in a 5 m cell) -> roughness penalty. Below 6 deg (about the
# 75th percentile of this region) the ground is smooth at boot scale; above ~20 deg (99th percentile) it is
# rippled, blocky or a scarp face.
ROUGH_LO, ROUGH_HI, ROUGH_PENALTY = 6.0, 20.0, 2.0


def available() -> bool:
    return (DATA / "heights.npy").exists() and MANIFEST.exists()


def manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def surround() -> dict | None:
    """The 80 km real-terrain ring around the region (scripts/import_surroundings.py), if imported."""
    p = DATA / "surround_heights.npy"
    if not p.exists():
        return None
    import base64
    a = np.load(p).astype("<f4")
    info = manifest().get("surround", {})
    return {"n": int(a.shape[0]), "size_m": float(info.get("size_m", 80000.0)),
            "heights_b64": base64.b64encode(a.tobytes()).decode(), "image": "/data/jezero/surround.jpg",
            "image_coverage": info.get("image_coverage")}


def m20_paths() -> dict | None:
    """Perseverance drives/stops and Ingenuity flights in the region (scripts/import_m20_paths.py), if imported."""
    p = DATA / "m20.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def latlon_to_local(lat: float, lon: float, lat0: float, lon0: float) -> tuple[float, float]:
    """Spherical orthographic forward projection (the import script's frame). Returns (x east, z south)."""
    p, l, p0, l0 = map(math.radians, (lat, lon, lat0, lon0))
    x = R_MARS * math.cos(p) * math.sin(l - l0)
    y = R_MARS * (math.cos(p0) * math.sin(p) - math.sin(p0) * math.cos(p) * math.cos(l - l0))
    return x, -y


def local_to_latlon(x: float, z: float, lat0: float, lon0: float) -> tuple[float, float]:
    y = -z
    rho = math.hypot(x, y)
    if rho == 0:
        return lat0, lon0
    c = math.asin(rho / R_MARS)
    p0, l0 = math.radians(lat0), math.radians(lon0)
    lat = math.asin(math.cos(c) * math.sin(p0) + y * math.sin(c) * math.cos(p0) / rho)
    lon = l0 + math.atan2(x * math.sin(c), rho * math.cos(p0) * math.cos(c) - y * math.sin(p0) * math.sin(c))
    return math.degrees(lat), math.degrees(lon)


def load_jezero(seed: int = 7) -> Terrain:
    if not available():
        raise FileNotFoundError("Jezero data not prepared; run: python scripts/import_mars_data.py")
    m = manifest()
    reg = m["region"]
    heights = np.load(DATA / "heights.npy").astype(np.float32)
    slope_fine = np.load(DATA / "slope_fine.npy").astype(np.float32)
    n = heights.shape[0]
    size = float(reg["size_m"])
    lat0, lon0 = reg["centre_lat_deg"], reg["centre_lon_deg"]

    landing_site = latlon_to_local(*reg["landing_site_lat_lon"], lat0, lon0)
    habitat = (-225.0, -200.0)      # flattest ground near the crater (mean 1 m slope 1.5 deg, 0.4 m relief in 40 m)
    pad = (0.0, -485.0)             # flattest ground on the smooth plain to the north (1.4 deg, 0.3 m)

    roughness = np.clip((slope_fine - ROUGH_LO) / (ROUGH_HI - ROUGH_LO), 0, 1).astype(np.float32)

    def feature(id_: str, name: str, kind: str, x: float, z: float, desc: str, simulated: bool = False) -> Site:
        lat, lon = local_to_latlon(x, z, lat0, lon0)
        return Site(id_, name, kind, round(x, 1), round(z, 1), f"{desc} ({lat:.4f} N, {lon:.4f} E)", simulated)

    sites = [
        feature("site-perseverance", "Perseverance landing site", "historic", *landing_site,
                "Where NASA's Mars 2020 rover touched down on 18 Feb 2021 (Octavia E. Butler Landing). Coordinates: NASA JPL"),
        feature("site-crater", "Impact crater floor", "crater", 55.0, -240.0,
                "Floor of a ~300 m impact crater, about 26 m below its rim, covered in wind ripples. Measured from the HiRISE DTM"),
        feature("site-delta-foot", "Foot of the delta front", "outcrop", -700.0, -500.0,
                "Smooth plain below the scarp of Jezero's western delta, the ancient river deposit Perseverance was sent to study"),
        feature("site-light-toned", "Light-toned rocky ground", "outcrop", -200.0, 320.0,
                "Bright, blocky surface between ripple fields, visible in the HiRISE orthoimage"),
        feature("site-ripples", "Ripple field", "aeolian", 300.0, 0.0,
                "Dense wind-blown ripples; the 1 m slope data flags this ground as rough"),
        feature("site-ne-blocks", "Northeast blocky terrain", "outcrop", 700.0, -300.0,
                "Fractured light-toned terrain inside a curved boundary, visible in HiRISE"),
    ]
    m20 = m20_paths()
    if m20:
        deploy = next((l for l in m20["landings"] if l["flight"] == 0), None)
        if deploy:   # NASA's name for the airfield of Ingenuity's first five flights
            sites.insert(1, feature("site-wright-brothers", "Wright Brothers Field", "historic", deploy["x"], deploy["z"],
                                    f"Airfield where NASA's Ingenuity helicopter was deployed (sol {deploy['sol']}) and made the first powered, "
                                    "controlled flight on another planet (flight 1, sol 58, 19 April 2021). Position: NASA/JPL Mars 2020 localization"))
    # Reachability is decided by the planner from the data; nothing here is tuned to make a route exist.

    hazards = [
        Hazard("hz-crater", "steep_slope", "Crater walls", 55.0, -240.0, 165.0, 0.6,
               "Inner walls up to ~48 deg in the 5 m HiRISE-derived slope; above the rover limit they are impassable."),
        Hazard("hz-delta", "steep_slope", "Delta front scarp", -930.0, -880.0, 260.0, 0.6,
               "Scarp of the western delta: ~100 m of relief over a few hundred metres."),
    ]

    # Illustrative rocks: density follows measured roughness, sizes stay below the obstacle threshold.
    rng = np.random.default_rng(seed)
    cell = size / (n - 1)
    rocks: list[Rock] = []
    weights = (roughness ** 1.5).ravel()
    weights = weights / weights.sum()
    for k in rng.choice(n * n, size=420, replace=False, p=weights):
        r, c = divmod(int(k), n)
        x = c * cell - size / 2 + rng.uniform(-cell / 2, cell / 2)
        z = r * cell - size / 2 + rng.uniform(-cell / 2, cell / 2)
        if math.hypot(x - habitat[0], z - habitat[1]) > 30 and math.hypot(x - pad[0], z - pad[1]) > 24:
            rocks.append(Rock(round(float(x), 2), round(float(z), 2), round(float(rng.uniform(0.25, 0.75)), 2)))

    hi = m["sources"]["hirise_dtm"]
    prov = Provenance(
        source="HiRISE DTM mosaic (MRO), USGS Astrogeology / NASA JPL, with CTX DTM gap fill",
        kind="dem", seed=None,
        crs=f"Orthographic on Mars 2000 sphere, centre {lat0:.5f} N {lon0:.5f} E (x east, z south, metres)",
        resolution_m=cell,
        note=(f"Real terrain: Jezero Crater, {size / 1000:.0f} km square including the Perseverance landing site. "
              f"HiRISE 1 m DTM averaged to {cell:.0f} m. Elevation {reg['elevation_min_m']:.0f} to {reg['elevation_max_m']:.0f} m "
              f"(heights shown relative to {reg['datum_offset_m']:.0f} m). HiRISE-CTX median difference "
              f"{reg['hirise_minus_ctx_median_m']:.2f} m."),
        citation=f"{hi['citation']} {hi['doi']}",
    )
    t = Terrain(size_m=size, n=n, heights=heights, rocks=rocks, hazards=hazards, sites=sites,
                habitat=habitat, landing_zone=pad, provenance=prov,
                roughness=roughness, roughness_penalty=ROUGH_PENALTY)
    return t
