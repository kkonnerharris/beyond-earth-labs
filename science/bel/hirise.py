"""Check a route against NASA's 1 m HiRISE elevation model of Jezero.

Routes are planned on 20 m cells (bel.jezero). A 20 m cell cannot see a scarp,
a crater rim or a boulder field a few metres across. This module reads the
1 m elevation posts under a route and measures the ground at the scale of a
vehicle:

    slope      tilt of the least-squares plane through a 5 x 5 post window (4 m across)
    roughness  RMS height of those posts about that plane

and reports every stretch that is steeper than the mover's limit.

The whole elevation file is 1.8 GB (21,400 x 21,488 posts, float32, one row
per strip, uncompressed), which is why the mission area is not planned on it.
Because it is uncompressed, the bytes of any post are at a known offset, so
only the posts near a route are read: 128 x 128 post blocks, one small HTTP
range request per row, kept on disk in data/cache/hirise/.

Usage:
    python -m bel.hirise validate       measure the same thing where Perseverance drove
    python -m bel.hirise check x1,y1 x2,y2 ... [--limit 20]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np
import requests

from . import DATA_DIR
from .bodies import MARS
from .jezero import AREA, SOURCES
from .remote import USER_AGENT, LocalGrid

SOURCE = SOURCES["hirise"]
CACHE = DATA_DIR / "cache" / "hirise"
OUT = DATA_DIR / "jezero" / "finecheck.json"
BLOCK = 128            # posts per block side
HALF = 2               # plane window is (2 * HALF + 1) posts square
WINDOW_M = 2 * HALF    # distance across the window, metres
SPACING_M = 1.0        # distance between samples along the route
MIN_STRETCH_M = 2.0    # a flagged stretch shorter than this is ignored (one noisy post)
JOIN_GAP_M = 3.0       # flagged stretches closer than this are reported as one

_lock = threading.Lock()
_header: dict | None = None
_blocks: dict[tuple[int, int], np.ndarray] = {}
_local = threading.local()


def _session() -> requests.Session:
    s = getattr(_local, "s", None)
    if s is None:
        s = requests.Session()
        s.headers["User-Agent"] = USER_AGENT
        _local.s = s
    return s


def header() -> dict:
    """Geometry and byte layout of the elevation file, read once and kept on disk."""
    global _header
    with _lock:
        if _header is not None:
            return _header
        path = CACHE / "header.json"
        if path.exists():
            _header = json.loads(path.read_text(encoding="utf-8"))
            return _header
        import rasterio

        from .remote import GDAL_ENV

        with rasterio.Env(**GDAL_ENV):
            with rasterio.open("/vsicurl/" + SOURCE["url"]) as src:
                t = src.transform
                first = int(src.get_tag_item("BLOCK_OFFSET_0_0", "TIFF", bidx=1))
                second = int(src.get_tag_item("BLOCK_OFFSET_0_1", "TIFF", bidx=1))
                size = int(src.get_tag_item("BLOCK_SIZE_0_0", "TIFF", bidx=1))
                ok = (src.block_shapes[0] == (1, src.width) and src.profile.get("compress") is None
                      and src.dtypes[0] == "float32" and size == src.width * 4 and second == first + size
                      and t.b == 0 and t.d == 0)
                if not ok:
                    raise IOError("the HiRISE elevation file is not laid out as uncompressed one-row strips")
                # The last row sits where a contiguous layout says it should.
                last = int(src.get_tag_item(f"BLOCK_OFFSET_0_{src.height - 1}", "TIFF", bidx=1))
                if last != first + (src.height - 1) * size:
                    raise IOError("the HiRISE elevation file's rows are not contiguous")
                # Byte order: compare four posts read by GDAL with the same bytes read directly.
                probe_r, probe_c = src.height // 2, src.width // 2
                from rasterio.windows import Window

                want = src.read(1, window=Window(probe_c, probe_r, 4, 1)).ravel()
                start = first + (probe_r * src.width + probe_c) * 4
                raw = _session().get(SOURCE["url"], headers={"Range": f"bytes={start}-{start + 15}"}, timeout=60)
                raw.raise_for_status()
                order = next((o for o in ("<f4", ">f4") if np.array_equal(np.frombuffer(raw.content, o), want)), None)
                if order is None:
                    raise IOError("could not confirm the HiRISE elevation file's byte order")
                _header = {"url": SOURCE["url"], "width": src.width, "height": src.height, "x0": t.c, "y0": t.f,
                           "cell": t.a, "first_byte": first, "dtype": order, "nodata": float(src.nodata),
                           "crs": src.crs.to_string(), "radius_m": MARS.radius_m,
                           "read_utc": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        if abs(_header["cell"] - 1.0) > 1e-6 or "103885" not in _header["crs"]:
            raise IOError(f"unexpected HiRISE grid: {_header['cell']} m, {_header['crs']}")
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(_header, indent=1), encoding="utf-8")
        return _header


def _fetch_row(h: dict, row: int, c0: int, c1: int) -> np.ndarray:
    start = h["first_byte"] + (row * h["width"] + c0) * 4
    end = start + (c1 - c0) * 4 - 1
    last = None
    for attempt in range(4):
        try:
            r = _session().get(h["url"], headers={"Range": f"bytes={start}-{end}"}, timeout=60)
            if r.status_code == 206 and len(r.content) == end - start + 1:
                return np.frombuffer(r.content, h["dtype"]).astype(np.float32)
            last = IOError(f"HTTP {r.status_code}, {len(r.content)} bytes")
        except requests.RequestException as exc:
            last = exc
        time.sleep(0.5 * (attempt + 1))
    raise IOError(f"HiRISE elevation row {row} did not load: {last!r}"[:200])


def _load_block(br: int, bc: int, pool: ThreadPoolExecutor | None = None) -> np.ndarray:
    """One 128 x 128 block of elevation posts (NaN where NASA has no data or outside the file)."""
    key = (br, bc)
    got = _blocks.get(key)
    if got is not None:
        return got
    h = header()
    path = CACHE / f"b_{br}_{bc}.npy"
    if path.exists():
        z = np.load(path)
    else:
        z = np.full((BLOCK, BLOCK), np.nan, dtype=np.float32)
        r0, c0 = br * BLOCK, bc * BLOCK
        c1 = min(c0 + BLOCK, h["width"])
        rows = [r for r in range(r0, r0 + BLOCK) if 0 <= r < h["height"]]
        if rows and c0 >= 0 and c1 > c0:
            run = (lambda r: _fetch_row(h, r, c0, c1))
            data = list(pool.map(run, rows)) if pool else [run(r) for r in rows]
            for r, line in zip(rows, data):
                z[r - r0, : c1 - c0] = line
            z[z < -1e30] = np.nan           # NASA's no-data value
        CACHE.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp.npy")
        np.save(tmp, z)
        tmp.replace(path)
    _blocks[key] = z
    return z


def ensure_blocks(keys: set[tuple[int, int]], workers: int = 24) -> int:
    """Load every block in `keys`; returns how many had to be downloaded."""
    missing = [k for k in sorted(keys) if k not in _blocks and not (CACHE / f"b_{k[0]}_{k[1]}.npy").exists()]
    if missing:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for k in missing:
                _load_block(k[0], k[1], pool)
    for k in keys:
        _load_block(k[0], k[1])
    return len(missing)


def _posts(rows: np.ndarray, cols: np.ndarray) -> np.ndarray:
    """Elevation at integer post indices (blocks must already be loaded)."""
    out = np.full(rows.shape, np.nan, dtype=np.float32)
    br, bc = rows // BLOCK, cols // BLOCK
    code = br.astype(np.int64) * 100000 + bc
    for c in np.unique(code):
        sel = code == c
        z = _blocks[(int(c // 100000), int(c % 100000))]
        out[sel] = z[rows[sel] - (c // 100000) * BLOCK, cols[sel] - (c % 100000) * BLOCK]
    return out


def grid() -> LocalGrid:
    """The mission area's local frame: the x, y a route is given in."""
    return LocalGrid("mars", AREA["lat0"], AREA["lon0"], AREA["size_m"], 20.0)


def to_posts(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Local metres -> fractional (row, col) in the elevation file, and latitude in degrees."""
    h = header()
    lon, lat = grid().proj(np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64), inverse=True)
    lon, lat = np.asarray(lon), np.asarray(lat)
    # The file is in a simple cylindrical projection of the Mars sphere, standard parallel at the equator.
    ex = h["radius_m"] * np.radians(lon)
    ny = h["radius_m"] * np.radians(lat)
    return (h["y0"] - ny) / h["cell"] - 0.5, (ex - h["x0"]) / h["cell"] - 0.5, lat


def densify(points: list[list[float]], spacing: float = SPACING_M) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Points every `spacing` metres along a polyline: x, y and distance from the start."""
    p = np.asarray(points, dtype=np.float64)[:, :2]
    if len(p) < 2:
        raise ValueError("a route needs at least two points")
    seg = np.hypot(*(p[1:] - p[:-1]).T)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    if cum[-1] <= 0:
        raise ValueError("the route has no length")
    d = np.arange(0.0, cum[-1] + 1e-9, spacing)
    return np.interp(d, cum, p[:, 0]), np.interp(d, cum, p[:, 1]), d


def plane_fit(win: np.ndarray, east_m: float | np.ndarray = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Slope (degrees) and roughness (m) of the least-squares plane through square post windows.

    `win` is (n, k, k): row 0 is north, column 0 is west, posts 1 m apart north-south and `east_m`
    metres apart east-west. A window with any missing post gives NaN.
    """
    k = win.shape[-1]
    o = np.arange(k, dtype=np.float64) - (k - 1) / 2.0
    dr, dc = np.meshgrid(o, o, indexing="ij")
    z = win.astype(np.float64)
    mean = z.mean(axis=(1, 2), keepdims=True)
    gc = (z * dc).sum(axis=(1, 2)) / (dc ** 2).sum()          # metres per post, eastward
    gr = (z * dr).sum(axis=(1, 2)) / (dr ** 2).sum()          # metres per post, southward
    resid = z - mean - gc[:, None, None] * dc - gr[:, None, None] * dr
    rough = np.sqrt((resid ** 2).mean(axis=(1, 2)))
    slope = np.degrees(np.arctan(np.hypot(gc / east_m, gr)))
    return slope, rough


def measure(x: np.ndarray, y: np.ndarray) -> dict:
    """Elevation, slope and roughness on the 1 m model at each local point. Downloads what is missing."""
    rows, cols, lat = to_posts(x, y)
    r, c = np.rint(rows).astype(np.int64), np.rint(cols).astype(np.int64)
    off = np.arange(-HALF, HALF + 1)
    rr = r[:, None, None] + off[None, :, None] + np.zeros((1, 1, len(off)), dtype=np.int64)
    cc = c[:, None, None] + off[None, None, :] + np.zeros((1, len(off), 1), dtype=np.int64)
    keys = set(zip((rr // BLOCK).ravel().tolist(), (cc // BLOCK).ravel().tolist()))
    downloaded = ensure_blocks(keys)
    win = _posts(rr.ravel(), cc.ravel()).reshape(rr.shape)
    slope, rough = plane_fit(win, np.cos(np.radians(lat)))
    return {"elevation_m": win[:, HALF, HALF], "slope_deg": slope, "roughness_m": rough,
            "blocks": len(keys), "blocks_downloaded": downloaded}


def stretches(d: np.ndarray, flag: np.ndarray, value: np.ndarray, x: np.ndarray, y: np.ndarray) -> list[dict]:
    """Runs of flagged samples as stretches of the route, joined across short gaps."""
    runs: list[list[int]] = []
    for i in np.flatnonzero(flag):
        if runs and d[i] - d[runs[-1][1]] <= JOIN_GAP_M:
            runs[-1][1] = int(i)
        else:
            runs.append([int(i), int(i)])
    out = []
    lon, lat = grid().proj(x, y, inverse=True)
    for a, b in runs:
        length = float(d[b] - d[a]) + SPACING_M
        if length < MIN_STRETCH_M:
            continue
        peak = a + int(np.nanargmax(value[a:b + 1]))
        mid = (a + b) // 2
        out.append({"start_m": round(float(d[a]), 1), "end_m": round(float(d[b]) + SPACING_M, 1),
                    "length_m": round(length, 1), "max_slope_deg": round(float(value[peak]), 1),
                    "x": round(float(x[mid]), 1), "y": round(float(y[mid]), 1),
                    "lon": round(float(lon[mid]), 6), "lat": round(float(lat[mid]), 6)})
    return out


def _pct(v: np.ndarray) -> dict:
    v = v[np.isfinite(v)]
    if not len(v):
        return {}
    return {k: round(float(np.percentile(v, q)), 2) for k, q in (("median", 50), ("p90", 90), ("p99", 99), ("max", 100))}


METHOD = (f"Elevation posts 1 m apart are read under the route. Every {SPACING_M:g} m along it, a plane is fitted "
          f"to the {2 * HALF + 1} x {2 * HALF + 1} posts around that point ({WINDOW_M} m across, about the footprint "
          "of a rover). Slope is the tilt of that plane; roughness is the RMS height of the posts about it. "
          f"A stretch is reported when the slope stays above the mover's limit for {MIN_STRETCH_M:g} m or more.")
LIMITS = ("A 1 m elevation model made from orbital stereo images resolves shapes a few metres across. "
          "It does not show individual rocks, loose sand or ripples.")


def check(points: list[list[float]], limit_deg: float) -> dict:
    """Check one route (local metres) against the 1 m model."""
    t0 = time.time()
    x, y, d = densify(points)
    m = measure(x, y)
    slope = m["slope_deg"]
    ok = np.isfinite(slope)
    over = ok & (slope > limit_deg)
    found = stretches(d, over, np.where(ok, slope, -1.0), x, y)
    step = max(1, int(round(10.0 / SPACING_M)))
    out = {
        "kind": "calculated", "limit_deg": limit_deg,
        "length_m": round(float(d[-1]), 1), "checked_m": round(float(ok.sum() * SPACING_M), 1),
        "no_data_m": round(float((~ok).sum() * SPACING_M), 1),
        "over_limit_m": round(float(sum(s["length_m"] for s in found)), 1),
        "slope_deg": _pct(slope), "roughness_m": _pct(m["roughness_m"]),
        "stretches": found,
        "profile": {"spacing_m": step * SPACING_M,
                    "elevation_m": [None if not np.isfinite(v) else round(float(v), 2) for v in m["elevation_m"][::step]],
                    "slope_deg": [None if not np.isfinite(v) else round(float(v), 1) for v in slope[::step]]},
        "source": {k: SOURCE[k] for k in ("title", "mission", "instrument", "native_cell_m", "doi", "publisher", "url")},
        "method": METHOD, "limits": LIMITS,
        "blocks": m["blocks"], "blocks_downloaded": m["blocks_downloaded"], "seconds": round(time.time() - t0, 1),
    }
    if OUT.exists():
        ref = json.loads(OUT.read_text(encoding="utf-8"))
        out["perseverance"] = {k: ref[k] for k in ("length_m", "checked_m", "slope_deg", "fraction_steeper_than",
                                                    "roughness_m", "waypoint_elevation_minus_model_m", "note")
                               if k in ref}
    return out


def _waypoints(m20: dict) -> dict:
    """Elevations the mission recorded at rover stops, minus the 1 m model at the same places."""
    w = [p for p in m20["waypoints"] if p.get("elev_geoid_m") is not None]
    if not w:
        return {}
    m = measure(np.array([p["x"] for p in w]), np.array([p["y"] for p in w]))
    d = np.array([float(p["elev_geoid_m"]) for p in w]) - m["elevation_m"]
    d = d[np.isfinite(d)]
    return {"n": int(len(d)), "median": round(float(np.median(d)), 2),
            "median_abs_deviation": round(float(np.median(np.abs(d - np.median(d)))), 2)}


def survey(cells: list[list[float]], cell_m: float, limit_deg: float) -> dict:
    """Measure whole planner cells on the 1 m model, so the planner can keep out of the steep ones.

    `cells` are cell centres in local metres. For each, the slope is measured at every 1 m point inside
    the cell; the answer is how many of those points are steeper than the limit, and the steepest.
    """
    t0 = time.time()
    n = int(round(cell_m / SPACING_M))
    o = (np.arange(n) + 0.5) * SPACING_M - cell_m / 2.0
    ox, oy = np.meshgrid(o, o)
    c = np.asarray(cells, dtype=np.float64)[:, :2]
    out, blocks, downloaded = [], 0, 0
    per = max(1, 40000 // (n * n))                       # cells per piece, to bound memory
    for i in range(0, len(c), per):
        part = c[i:i + per]
        x = (part[:, 0][:, None] + ox.ravel()[None, :]).ravel()
        y = (part[:, 1][:, None] + oy.ravel()[None, :]).ravel()
        m = measure(x, y)
        blocks, downloaded = blocks + m["blocks"], downloaded + m["blocks_downloaded"]
        slope = m["slope_deg"].reshape(len(part), n * n)
        ok = np.isfinite(slope)
        steep = (ok & (slope > limit_deg)).sum(axis=1)
        peak = np.where(ok.any(axis=1), np.nanmax(np.where(ok, slope, -1.0), axis=1), np.nan)
        for (cx, cy), s, p, k in zip(part, steep, peak, ok.sum(axis=1)):
            out.append({"x": float(cx), "y": float(cy), "posts": int(k), "steep_posts": int(s),
                        "max_slope_deg": None if not np.isfinite(p) else round(float(p), 1)})
    return {"kind": "calculated", "limit_deg": limit_deg, "cell_m": cell_m, "cells": out,
            "blocks_downloaded": downloaded, "seconds": round(time.time() - t0, 1)}


def validate() -> dict:
    """Measure the same slope along the path Perseverance actually drove inside the mission area."""
    t0 = time.time()
    m20 = json.loads((DATA_DIR / "jezero" / "m2020.json").read_text(encoding="utf-8"))
    xs, ys, total, downloaded, blocks = [], [], 0.0, 0, set()
    for seg in m20["traverse"]:
        pts = [p[:2] for p in seg["points"]]
        try:
            x, y, d = densify(pts)
        except ValueError:
            continue
        xs.append(x), ys.append(y)
        total += float(d[-1])
    x, y = np.concatenate(xs), np.concatenate(ys)
    # Drop repeat visits to the same square metre so a parked rover is not counted many times.
    _, first = np.unique(np.stack([np.rint(x), np.rint(y)], axis=1), axis=0, return_index=True)
    x, y = x[np.sort(first)], y[np.sort(first)]
    slope_all, rough_all = [], []
    for i in range(0, len(x), 4000):                      # in pieces, so progress is visible
        m = measure(x[i:i + 4000], y[i:i + 4000])
        slope_all.append(m["slope_deg"]), rough_all.append(m["roughness_m"])
        downloaded += m["blocks_downloaded"]
        print(f"  {min(i + 4000, len(x))}/{len(x)} m measured, {downloaded} blocks downloaded, "
              f"{time.time() - t0:.0f} s", flush=True)
    slope, rough = np.concatenate(slope_all), np.concatenate(rough_all)
    ok = np.isfinite(slope)
    out = {
        "what": "The 1 m slope measure applied to the path Perseverance drove inside the mission area",
        "source": {k: SOURCE[k] for k in ("title", "mission", "instrument", "native_cell_m", "doi", "publisher", "url")},
        "path_source": m20.get("source"), "method": METHOD, "limits": LIMITS,
        "length_m": round(total, 1), "unique_metres": int(len(x)), "checked_m": int(ok.sum()),
        "no_data_m": int((~ok).sum()),
        "slope_deg": _pct(slope), "roughness_m": _pct(rough),
        "fraction_steeper_than": {str(lim): round(float((slope[ok] > lim).mean()), 5) for lim in (10, 15, 20, 25, 30)},
        "waypoint_elevation_minus_model_m": _waypoints(m20),
        "note": ("NASA publishes the path as points about 1 m apart. The path and the orbital elevation model can "
                 "be a few metres out of register, so the steepest values on the path are an upper bound on what "
                 "the rover crossed."),
        "built_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seconds": round(time.time() - t0, 1),
    }
    OUT.write_text(json.dumps(out, indent=1), encoding="utf-8")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("validate")
    c = sub.add_parser("check")
    c.add_argument("points", nargs="+", help="x,y in local metres")
    c.add_argument("--limit", type=float, default=20.0)
    args = ap.parse_args(argv)
    if args.cmd == "validate":
        out = validate()
    else:
        out = check([[float(v) for v in p.split(",")] for p in args.points], args.limit)
        out.pop("profile")
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
