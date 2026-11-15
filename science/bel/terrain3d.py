"""Elevation tiles for the 3D view of Jezero.

The web map can raise its surface from a "terrain" tile source: images in
which each pixel's colour encodes a height. This module makes those tiles
from the same measured elevation model the routes are planned on (the MRO
CTX stereo model, 20 m posts), over its whole 30 km extent.

This is a display product:

* Heights are relative to a base level (the median of the mission area), so
  ground outside the elevation model, which is drawn flat, sits level with
  the crater floor instead of kilometres above it.
* Heights are faded to the base level over the outer 1.5 km of the model so
  its edge does not appear as a wall. Inside the mission area nothing is faded.
* The interface applies a vertical exaggeration and says so.

Route planning never reads these tiles.
"""
from __future__ import annotations

import io
import json
import threading

import numpy as np
from scipy.ndimage import distance_transform_edt, map_coordinates

from . import DATA_DIR
from .jezero import SOURCES
from .tiles import TILE, mercator_lonlat

CACHE = DATA_DIR / "tilecache" / "jezero_dem"
FADE_M = 1500.0
_state: dict = {}
_lock = threading.Lock()


def _source_path():
    """The CTX elevation file: a local copy if present, else downloaded once (9 MB)."""
    name = SOURCES["ctx"]["url"].rsplit("/", 1)[-1]
    path = DATA_DIR / "cache" / name
    if not path.exists():
        import requests

        path.parent.mkdir(parents=True, exist_ok=True)
        r = requests.get(SOURCES["ctx"]["url"], timeout=300)
        r.raise_for_status()
        path.write_bytes(r.content)
    return path


def _load() -> dict:
    """Read the elevation model once and prepare the faded, base-relative height field."""
    with _lock:
        if _state:
            return _state
        import rasterio
        from pyproj import Proj

        with rasterio.open(_source_path()) as src:
            z = src.read(1, masked=True).astype(np.float32).filled(np.nan)
            if src.nodata is not None:
                z[z == src.nodata] = np.nan
            z[z < -1e6] = np.nan
            proj = Proj(src.crs.to_wkt())
            inv = ~src.transform
            cell = abs(src.transform.a)
            west, north = proj(src.bounds.left, src.bounds.top, inverse=True)
            east, south = proj(src.bounds.right, src.bounds.bottom, inverse=True)
        meta_path, bin_path = DATA_DIR / "jezero" / "terrain.json", DATA_DIR / "jezero" / "terrain.bin"
        base = float(np.nanmedian(z))
        if meta_path.exists() and bin_path.exists():
            n = json.loads(meta_path.read_text(encoding="utf-8"))["grid"]["n"]
            base = float(np.median(np.fromfile(bin_path, dtype="<f4", count=n * n)))
        valid = np.isfinite(z)
        fade = np.clip(distance_transform_edt(valid) * cell / FADE_M, 0.0, 1.0).astype(np.float32)
        rel = np.where(valid, (z - base) * fade, 0.0).astype(np.float32)
        _state.update({"rel": rel, "proj": proj, "inv": inv, "base_m": base, "cell_m": cell,
                       "bounds": [float(west), float(south), float(east), float(north)],
                       "relief_m": [float(np.nanmin(z) - base), float(np.nanmax(z) - base)]})
        return _state


def info() -> dict:
    s = _load()
    return {
        "tiles": "/jezero/dem/{z}/{x}/{y}.png", "encoding": "terrarium", "tile_size": TILE, "max_zoom": 12,
        "bounds_lonlat": [round(v, 5) for v in s["bounds"]], "base_elevation_m": round(s["base_m"], 1),
        "relative_height_range_m": [round(v, 1) for v in s["relief_m"]], "native_cell_m": s["cell_m"],
        "fade_m": FADE_M, "kind": "calculated",
        "source": {k: SOURCES["ctx"][k] for k in ("title", "mission", "instrument", "doi")},
        "note": ("Heights are measured elevation relative to the base level, faded to that level over the outer "
                 f"{FADE_M / 1000:g} km of the elevation model. Ground outside the model is drawn flat. For display only."),
    }


def render(z: int, x: int, y: int) -> bytes:
    """One terrarium-encoded PNG tile (height = R*256 + G + B/256 - 32768 metres)."""
    from PIL import Image

    s = _load()
    path = CACHE / f"base{round(s['base_m'])}" / str(z) / str(x) / f"{y}.png"
    if path.exists():
        return path.read_bytes()
    lon, lat = mercator_lonlat(z, x, y)
    sx, sy = s["proj"](lon, lat)
    cols, rows = s["inv"] * (np.asarray(sx), np.asarray(sy))
    h = map_coordinates(s["rel"], [rows - 0.5, cols - 0.5], order=1, mode="constant", cval=0.0)
    v = np.clip(h.astype(np.float64) + 32768.0, 0.0, 65535.996)
    whole = np.floor(v)
    rgb = np.stack([whole // 256, whole % 256, np.floor((v - whole) * 256.0)], axis=-1).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(buf, format="PNG")
    data = buf.getvalue()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data
