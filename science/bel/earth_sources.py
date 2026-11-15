"""Earth imagery and elevation readers.

Imagery: NASA Harmonized Landsat Sentinel-2 (HLS) L30 v2.0, red band (B04),
30 m surface reflectance, read from the public Microsoft Planetary Computer
mirror with an anonymous read token. LP DAAC, the product's home archive,
requires an Earthdata login, so the public mirror of the same NASA product
is used instead. Nothing here bypasses an access control.

Elevation: NASADEM (reprocessed SRTM, 1 arc-second) from the OpenTopography
public bucket. NASADEM stops at 60 degrees north, so higher-latitude sites
use the Copernicus GLO-30 DEM (ESA) and are labelled as such.
"""
from __future__ import annotations

import math
import time

import numpy as np
import requests

from .remote import USER_AGENT, LocalGrid, OutsideRaster, SourceMissing, read_geotiff

PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
PC_TOKEN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/hls2-l30"
HLS_DOI = "10.5067/HLS/HLSL30.002"
NASADEM_DOI = "10.5067/MEaSUREs/NASADEM/NASADEM_HGT.001"

_token_cache: dict = {}


def _pc_token() -> str:
    now = time.time()
    if _token_cache.get("expires", 0) - now < 300:
        r = requests.get(PC_TOKEN, headers={"User-Agent": USER_AGENT}, timeout=60)
        r.raise_for_status()
        _token_cache["token"] = r.json()["token"]
        _token_cache["expires"] = now + 40 * 60
    return _token_cache["token"]


def _date_windows(lat: float) -> list[str]:
    """Snow-free, high-sun seasons for the hemisphere; whole years in the tropics."""
    if lat > 23.0:
        return ["2025-06-01T00:00:00Z/2025-09-30T23:59:59Z", "2024-06-01T00:00:00Z/2024-09-30T23:59:59Z"]
    if lat < -23.0:
        return ["2024-12-01T00:00:00Z/2025-03-15T23:59:59Z", "2023-12-01T00:00:00Z/2024-03-15T23:59:59Z"]
    return ["2024-01-01T00:00:00Z/2025-10-31T23:59:59Z"]


def _search_hls(bbox, lat: float, max_cloud: float) -> list[dict]:
    feats: list[dict] = []
    for window in _date_windows(lat):
        body = {
            "collections": ["hls2-l30"], "bbox": list(bbox), "datetime": window,
            "query": {"eo:cloud_cover": {"lt": max_cloud}},
            "sortby": [{"field": "eo:cloud_cover", "direction": "asc"}], "limit": 250,
        }
        r = requests.post(PC_STAC, json=body, headers={"User-Agent": USER_AGENT}, timeout=120)
        r.raise_for_status()
        feats.extend(r.json().get("features", []))
    return feats


def read_hls_red(grid: LocalGrid, max_reads: int = 14, per_tile: int = 5) -> tuple[np.ndarray, dict]:
    """Red-band surface reflectance (0..1) on a LocalGrid from the clearest HLS L30 scenes.

    One Landsat pass covers only part of an HLS tile, so several clear dates
    per tile are combined (clearest first) until the grid is filled.
    """
    bbox = grid.bounds_lonlat()
    used: list[dict] = []
    out = np.full((grid.n, grid.n), np.nan, dtype=np.float32)
    seen: set[str] = set()
    reads = 0
    for max_cloud in (5.0, 25.0, 60.0):
        feats = [f for f in _search_hls(bbox, grid.lat0, max_cloud) if f["id"] not in seen]
        feats.sort(key=lambda f: f["properties"]["eo:cloud_cover"])
        # Round-robin over tiles: clearest scene of each tile first, then the
        # next clearest on a different date, and so on.
        by_tile: dict[str, list[dict]] = {}
        for f in feats:
            tile = f["id"].split(".")[2]
            dates = {g["properties"]["datetime"][:10] for g in by_tile.get(tile, [])}
            if f["properties"]["datetime"][:10] in dates or len(by_tile.get(tile, [])) >= per_tile:
                continue
            by_tile.setdefault(tile, []).append(f)
        order = [fs[i] for i in range(per_tile) for fs in by_tile.values() if i < len(fs)]
        for f in order:
            if reads >= max_reads or np.isfinite(out).mean() > 0.995:
                break
            seen.add(f["id"])
            reads += 1
            href = f["assets"]["B04"]["href"] + "?" + _pc_token()
            try:
                arr, _ = read_geotiff(href, grid, nodata_override=-9999)
            except OutsideRaster:
                continue  # scene footprint does not reach the grid
            # Any other error (network, DNS) propagates: a region must never
            # be saved as "no imagery" because the connection dropped.
            arr = arr * 1e-4
            hole = ~np.isfinite(out) & np.isfinite(arr)
            if hole.mean() < 0.002:
                continue
            out[hole] = arr[hole]
            used.append({"id": f["id"], "cloud_cover": f["properties"]["eo:cloud_cover"],
                         "datetime": f["properties"]["datetime"], "filled_fraction": round(float(hole.mean()), 4),
                         "href": f["assets"]["B04"]["href"]})
        if np.isfinite(out).mean() > 0.995 or reads >= max_reads:
            break
    info = {"product": "HLS L30 v2.0 band B04 (red)", "doi": HLS_DOI, "mirror": "Microsoft Planetary Computer",
            "scenes": used, "scene_reads": reads, "native_cell_m": 30.0,
            "coverage": float(np.isfinite(out).mean())}
    return out, info


def _dem_tile_url(source: str, lat: int, lon: int) -> str:
    if source == "nasadem":
        ns, ew = ("n" if lat >= 0 else "s"), ("e" if lon >= 0 else "w")
        return (f"https://opentopography.s3.sdsc.edu/raster/NASADEM/NASADEM_be/"
                f"NASADEM_HGT_{ns}{abs(lat):02d}{ew}{abs(lon):03d}.tif")
    ns, ew = ("N" if lat >= 0 else "S"), ("E" if lon >= 0 else "W")
    name = f"Copernicus_DSM_COG_10_{ns}{abs(lat):02d}_00_{ew}{abs(lon):03d}_00_DEM"
    return f"https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif"


def read_earth_dem(grid: LocalGrid, source: str = "default") -> tuple[np.ndarray, dict]:
    """Elevation (m) on a LocalGrid from 1-degree DEM tiles; missing tiles (open ocean) stay NaN."""
    if source == "default":
        source = "nasadem" if abs(grid.lat0) < 59.0 else "cop30"
    lon_min, lat_min, lon_max, lat_max = grid.bounds_lonlat()
    out = np.full((grid.n, grid.n), np.nan, dtype=np.float32)
    used, missing = [], []
    for la in range(math.floor(lat_min), math.floor(lat_max) + 1):
        for lo in range(math.floor(lon_min), math.floor(lon_max) + 1):
            url = _dem_tile_url(source, la, lo)
            try:
                arr, _ = read_geotiff(url, grid)
            except (SourceMissing, OutsideRaster) as exc:   # an all-ocean tile has no file
                missing.append({"url": url, "error": repr(exc)[:120]})
                continue
            hole = ~np.isfinite(out) & np.isfinite(arr)
            out[hole] = arr[hole]
            used.append(url)
    if source == "nasadem":
        meta = {"product": "NASADEM_HGT v001 (1 arc-second)", "doi": NASADEM_DOI,
                "mirror": "OpenTopography public bucket", "agency": "NASA JPL"}
    else:
        meta = {"product": "Copernicus DEM GLO-30", "doi": "10.5270/ESA-c5d3d65",
                "mirror": "AWS Open Data", "agency": "ESA (used above 60N where NASADEM has no coverage)"}
    meta.update({"tiles": used, "missing_tiles": missing, "coverage": float(np.isfinite(out).mean())})
    return out, meta
