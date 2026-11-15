"""Build the Jezero Crater mission area: the measured terrain the Martian Map plans on.

Outputs (data/jezero/):
    terrain.bin    little-endian float32 layers, row-major, north-up
    terrain.json   grid geometry, layer order, units, provenance, statistics
    overlays/*.png map overlays (hillshade, slope, thermal) with their corner coordinates
    m2020.json     Perseverance's real traverse and waypoints inside the area
    validation.json  the hazard map checked against where the rover actually drove

The mission service (Go) reads terrain.bin + terrain.json and never touches
imagery: every number a route is planned on is a measurement.

Elevation source is selectable:
    ctx     MRO CTX stereo elevation model, 20 m posts (9 MB file, quick)
    hirise  MRO HiRISE stereo elevation model, 1 m posts, averaged to --cell
            metres (several hundred MB of range reads)

Usage:
    python -m bel.jezero build [--dem ctx|hirise] [--cell 20]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone

import numpy as np
import requests
from scipy.ndimage import uniform_filter

from . import DATA_DIR, terrain
from .bodies import MARS
from .remote import USER_AGENT, LocalGrid, read_geotiff

OUT = DATA_DIR / "jezero"
S3 = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/"
SOURCES = {
    "ctx": {
        "url": S3 + "CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif",
        "title": "Mars 2020 Terrain Relative Navigation CTX DTM mosaic, 20 m",
        "mission": "Mars Reconnaissance Orbiter", "instrument": "Context Camera (CTX)",
        "native_cell_m": 20.0, "doi": "10.5066/P906QQT8", "publisher": "USGS Astrogeology Science Center",
    },
    "hirise": {
        "url": S3 + "HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif",
        "title": "Mars 2020 Terrain Relative Navigation HiRISE DTM mosaic, 1 m",
        "mission": "Mars Reconnaissance Orbiter", "instrument": "HiRISE",
        "native_cell_m": 1.0, "doi": "10.5066/P9REJ9JN", "publisher": "USGS Astrogeology Science Center",
    },
}
THEMIS_MC13 = {
    "url": "https://astrogeo-ard.s3.us-west-2.amazonaws.com/mars/mo/themis/controlled_mosaics/"
           "mc13_syrtis_major_dir/mc13_syrtis_major_dir.tif",
    "title": "THEMIS daytime infrared controlled mosaic, MC-13 Syrtis Major, 100 m",
    "mission": "2001 Mars Odyssey", "instrument": "THEMIS", "doi": "10.5066/P96FA04Z",
}
M2020 = {
    "traverse": "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json",
    "waypoints": "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json",
}

# Mission area: 9.6 km square covering the landing site, the crater-floor units and the delta front.
AREA = {"lat0": 18.465, "lon0": 77.385, "size_m": 9600.0}
LANDING = {"name": "Octavia E. Butler Landing", "lat": 18.4447, "lon": 77.4508}   # NASA/JPL

LAYERS = ("elevation_m", "slope_deg", "roughness_m")


def local_roughness(z: np.ndarray, window: int = 3) -> np.ndarray:
    """RMS height (m) about the local mean in a window x window neighbourhood, after removing slope.

    The window mean of z and of z^2 give the local variance; subtracting the
    variance explained by the local plane (from Horn gradients) leaves the
    part that is roughness rather than tilt.
    """
    z = np.asarray(z, dtype=np.float64)
    m = uniform_filter(z, window, mode="nearest")
    v = np.maximum(uniform_filter(z * z, window, mode="nearest") - m * m, 0.0)
    # Variance of a tilted plane over a w x w window: (gx^2 + gy^2) * (w^2 - 1) / 12 in cell units.
    p = np.pad(z, 1, mode="edge")
    gx = (p[1:-1, 2:] - p[1:-1, :-2]) / 2.0
    gy = (p[2:, 1:-1] - p[:-2, 1:-1]) / 2.0
    plane_var = (gx ** 2 + gy ** 2) * (window ** 2 - 1) / 12.0
    return np.sqrt(np.maximum(v - plane_var, 0.0))


def hillshade(z: np.ndarray, cell_m: float, azimuth_deg: float = 315.0, altitude_deg: float = 45.0,
              exaggeration: float = 2.0) -> np.ndarray:
    """Illustrative shaded relief (0..255) for display only."""
    p = np.pad(z.astype(np.float64) * exaggeration, 1, mode="edge")
    dzdx = (p[1:-1, 2:] - p[1:-1, :-2]) / (2.0 * cell_m)
    dzdy = (p[:-2, 1:-1] - p[2:, 1:-1]) / (2.0 * cell_m)
    az, alt = np.radians(360.0 - azimuth_deg + 90.0), np.radians(altitude_deg)
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(dzdy, dzdx)
    shaded = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(shaded * 255.0, 0, 255).astype(np.uint8)


def _ramp(v: np.ndarray, stops: list[tuple[float, tuple[int, int, int]]]) -> np.ndarray:
    """Piecewise-linear colour ramp -> RGBA uint8; NaN is transparent."""
    xs = np.array([s[0] for s in stops], dtype=np.float64)
    cols = np.array([s[1] for s in stops], dtype=np.float64)
    out = np.zeros(v.shape + (4,), dtype=np.uint8)
    ok = np.isfinite(v)
    for ch in range(3):
        out[..., ch] = np.interp(np.where(ok, v, xs[0]), xs, cols[:, ch]).astype(np.uint8)
    out[..., 3] = np.where(ok, 255, 0)
    return out


SLOPE_STOPS = [(0.0, (26, 44, 66)), (5.0, (44, 123, 182)), (10.0, (171, 217, 233)), (15.0, (255, 255, 191)),
               (20.0, (253, 174, 97)), (30.0, (215, 25, 28))]
THERMAL_STOPS = [(0.0, (12, 7, 40)), (0.25, (84, 15, 109)), (0.5, (187, 55, 84)), (0.75, (249, 142, 8)),
                 (1.0, (252, 255, 164))]


def _corners(grid: LocalGrid) -> list[list[float]]:
    """Corner coordinates [lon, lat] in the order MapLibre image sources expect: TL, TR, BR, BL."""
    h = grid.size_m / 2.0
    p = grid.proj
    out = []
    for x, y in ((-h, h), (h, h), (h, -h), (-h, -h)):
        lon, lat = p(x, y, inverse=True)
        out.append([round(float(lon), 6), round(float(lat), 6)])
    return out


def _fetch_json(url: str) -> dict:
    r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=120)
    r.raise_for_status()
    return r.json()


def _m2020(grid: LocalGrid) -> dict:
    """Perseverance's published traverse and waypoints, clipped to the mission area, in local metres."""
    half = grid.size_m / 2.0
    p = grid.proj
    out = {"source": M2020, "credit": "NASA/JPL-Caltech (Mars 2020 mission location data, MMGIS)",
           "traverse": [], "waypoints": []}
    trav = _fetch_json(M2020["traverse"])
    for f in trav.get("features", []):
        g = f.get("geometry") or {}
        lines = g.get("coordinates") if g.get("type") == "MultiLineString" else [g.get("coordinates", [])]
        for line in lines:
            seg = []
            for c in line:
                x, y = p(c[0], c[1])
                if abs(x) <= half and abs(y) <= half:
                    seg.append([round(float(x), 2), round(float(y), 2), round(c[0], 6), round(c[1], 6)])
            if len(seg) >= 2:
                out["traverse"].append({"sol": (f.get("properties") or {}).get("sol"), "points": seg})
    wps = _fetch_json(M2020["waypoints"])
    for f in wps.get("features", []):
        g = f.get("geometry") or {}
        if g.get("type") != "Point":
            continue
        lon, lat = g["coordinates"][:2]
        x, y = p(lon, lat)
        if abs(x) <= half and abs(y) <= half:
            pr = f.get("properties") or {}
            out["waypoints"].append({"sol": pr.get("sol"), "site": pr.get("site"), "drive": pr.get("drive"),
                                     "x": round(float(x), 2), "y": round(float(y), 2),
                                     "lon": round(lon, 6), "lat": round(lat, 6),
                                     "elev_geoid_m": pr.get("elev_geoid"),
                                     "dist_total_m": pr.get("dist_total_m") or pr.get("dist_mi")})
    return out


def _validate_against_traverse(slope: np.ndarray, z: np.ndarray, grid: LocalGrid, m20: dict) -> dict:
    """Compare terrain where Perseverance actually drove with the mission area as a whole.

    This is an independent check with real data: a hazard map is only useful
    if the ground a real rover chose to cross looks traversable on it.
    """
    n, half = grid.n, grid.size_m / 2.0
    idx = []
    for seg in m20["traverse"]:
        for x, y, *_ in seg["points"]:
            c = int((x + half) / grid.cell_m)
            r = int((half - y) / grid.cell_m)
            if 0 <= r < n and 0 <= c < n:
                idx.append((r, c))
    idx = sorted(set(idx))
    if len(idx) < 20:
        return {"skipped": "fewer than 20 traverse cells inside the mission area"}
    rr, cc = np.array(idx).T
    on, area = slope[rr, cc], slope[np.isfinite(slope)]
    out = {
        "traverse_cells": int(len(idx)),
        "slope_deg_on_traverse": {q: round(float(np.percentile(on, p)), 2) for q, p in
                                  (("median", 50), ("p90", 90), ("p99", 99), ("max", 100))},
        "slope_deg_whole_area": {q: round(float(np.percentile(area, p)), 2) for q, p in
                                 (("median", 50), ("p90", 90), ("p99", 99), ("max", 100))},
        "fraction_of_area_steeper_than": {}, "fraction_of_traverse_steeper_than": {},
    }
    for lim in (10, 15, 20, 25, 30):
        out["fraction_of_area_steeper_than"][str(lim)] = round(float((area > lim).mean()), 4)
        out["fraction_of_traverse_steeper_than"][str(lim)] = round(float((on > lim).mean()), 4)
    # Waypoint elevations recorded by the mission vs this elevation model.
    diffs = []
    for w in m20["waypoints"]:
        if w.get("elev_geoid_m") is None:
            continue
        c = int((w["x"] + half) / grid.cell_m)
        r = int((half - w["y"]) / grid.cell_m)
        if 0 <= r < n and 0 <= c < n and np.isfinite(z[r, c]):
            diffs.append(float(w["elev_geoid_m"]) - float(z[r, c]))
    if diffs:
        d = np.array(diffs)
        out["waypoint_elevation_minus_model_m"] = {
            "n": int(len(d)), "median": round(float(np.median(d)), 2),
            "median_abs_deviation": round(float(np.median(np.abs(d - np.median(d)))), 2)}
    out["note"] = ("Slope is measured at the grid's cell size; a rover-scale hazard (a rock, a ripple) smaller "
                   "than one cell is invisible to it.")
    return out


def _sha256(path) -> str:
    import hashlib

    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build(dem: str = "ctx", cell_m: float = 20.0, dem_file: str | None = None) -> dict:
    """Build the mission area. `dem_file` reads a local copy of the source file instead of the URL."""
    from PIL import Image

    t0 = time.time()
    src = dict(SOURCES[dem])
    if cell_m < src["native_cell_m"]:
        raise SystemExit(f"--cell {cell_m} is finer than the {dem} source ({src['native_cell_m']} m)")
    grid = LocalGrid("mars", AREA["lat0"], AREA["lon0"], AREA["size_m"], cell_m)
    if dem_file:
        z, info = read_geotiff(dem_file, grid)
        info["source"] = src["url"]
        src["local_copy"] = {"file": str(dem_file).replace("\\", "/").split("/")[-1], "sha256": _sha256(dem_file),
                             "note": "read from a local copy of the file at `url`"}
    else:
        z, info = read_geotiff(src["url"], grid)
    coverage = float(np.isfinite(z).mean())
    if coverage < 0.999:
        raise SystemExit(f"elevation coverage is only {coverage:.3f}; refusing to plan on gaps")
    z = np.where(np.isfinite(z), z, np.nanmedian(z)).astype(np.float32)
    slope = terrain.slope_degrees(z, cell_m).astype(np.float32)
    rough = local_roughness(z, 3).astype(np.float32)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "overlays").mkdir(exist_ok=True)
    with open(OUT / "terrain.bin", "wb") as fh:
        for layer in (z, slope, rough):
            fh.write(np.ascontiguousarray(layer, dtype="<f4").tobytes())

    corners = _corners(grid)
    Image.fromarray(hillshade(z, cell_m)).save(OUT / "overlays" / "hillshade.png")
    Image.fromarray(_ramp(slope, SLOPE_STOPS)).save(OUT / "overlays" / "slope.png")

    overlays = {
        "hillshade": {"file": "overlays/hillshade.png", "kind": "illustrative shading of measured elevation"},
        "slope": {"file": "overlays/slope.png", "kind": "calculated", "units": "degrees",
                  "ramp": [{"value": v, "rgb": list(c)} for v, c in SLOPE_STOPS]},
    }
    try:
        tgrid = grid.with_cell(50.0)
        th, _ = read_geotiff(THEMIS_MC13["url"], tgrid, average=False)
        lo, hi = np.nanpercentile(th, [2, 98])
        Image.fromarray(_ramp((th - lo) / max(hi - lo, 1e-6), THERMAL_STOPS)).save(OUT / "overlays" / "thermal.png")
        overlays["thermal"] = {
            "file": "overlays/thermal.png", "kind": "NASA observation (relative brightness, not a temperature)",
            "stretch_dn": [round(float(lo), 1), round(float(hi), 1)], "source": THEMIS_MC13,
            "ramp": [{"value": v, "rgb": list(c)} for v, c in THERMAL_STOPS]}
    except Exception as exc:  # noqa: BLE001 - the map still works without this layer; say so
        overlays["thermal"] = {"unavailable": repr(exc)[:200]}

    m20 = _m2020(grid)
    (OUT / "m2020.json").write_text(json.dumps(m20), encoding="utf-8")
    validation = _validate_against_traverse(slope, z, grid, m20)
    (OUT / "validation.json").write_text(json.dumps(validation, indent=1), encoding="utf-8")

    lx, ly = grid.proj(LANDING["lon"], LANDING["lat"])
    meta = {
        "name": "Jezero Crater mission area", "body": "mars",
        "grid": {"n": grid.n, "cell_m": cell_m, "size_m": grid.size_m, "lat0": grid.lat0, "lon0": grid.lon0,
                 "projection": MARS.laea(grid.lat0, grid.lon0), "row0": "north", "col0": "west",
                 "corners_lonlat_tl_tr_br_bl": corners},
        "layers": [{"name": n, "dtype": "float32-le", "offset_bytes": i * grid.n * grid.n * 4}
                   for i, n in enumerate(LAYERS)],
        "units": {"elevation_m": "metres above the MOLA areoid", "slope_deg": f"degrees over a {cell_m:g} m baseline",
                  "roughness_m": f"RMS height about the local plane in a {3 * cell_m:g} m window"},
        "elevation_source": {**src, "read": info},
        "statistics": {
            "elevation_m": [round(float(z.min()), 1), round(float(z.max()), 1)],
            "slope_deg": {"median": round(float(np.median(slope)), 2), "p90": round(float(np.percentile(slope, 90)), 2),
                          "max": round(float(slope.max()), 2)},
            "roughness_m": {"median": round(float(np.median(rough)), 3), "p90": round(float(np.percentile(rough, 90)), 3)},
        },
        "landing_site": {**LANDING, "x": round(float(lx), 1), "y": round(float(ly), 1),
                         "source": "NASA/JPL-Caltech"},
        "overlays": overlays,
        "m2020": {"traverse_segments": len(m20["traverse"]), "waypoints": len(m20["waypoints"])},
        "validation": validation,
        "built_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seconds": round(time.time() - t0, 1),
    }
    (OUT / "terrain.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return meta


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--dem", choices=sorted(SOURCES), default="ctx")
    b.add_argument("--cell", type=float, default=20.0)
    b.add_argument("--dem-file", help="local copy of the elevation source file")
    args = ap.parse_args(argv)
    meta = build(args.dem, args.cell, args.dem_file)
    print(json.dumps({k: meta[k] for k in ("grid", "statistics", "landing_site", "m2020", "validation", "seconds")},
                     indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
