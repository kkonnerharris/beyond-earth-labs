"""Web-map tiles of NASA Trek imagery.

NASA Trek serves imagery in an equirectangular tile grid. Web maps
(MapLibre) expect Web Mercator tiles. This module resamples Trek tiles into
Web Mercator tiles on request and caches the result on disk, so any Trek
layer can be shown on the mission map without storing the mosaics.

Mercator tiles are computed from longitude and latitude only, so they are
valid for any body; distances on the map are scaled by the body's radius in
the interface, not here.
"""
from __future__ import annotations

import io
import math
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
from scipy.ndimage import map_coordinates

from . import DATA_DIR
from .remote import _http

CACHE = DATA_DIR / "tilecache"
TILE = 256


@dataclass(frozen=True)
class Layer:
    key: str
    body: str
    trek_body: str
    name: str            # Trek product label
    ext: str
    title: str
    mission: str
    kind: str            # optical | thermal | topographic
    max_zoom_hint: int
    colour: bool = False

    def url(self, z: int, row: int, col: int) -> str:
        return (f"https://trek.nasa.gov/tiles/{self.trek_body}/EQ/{self.name}/1.0.0/default/default028mm/"
                f"{z}/{row}/{col}.{self.ext}")


LAYERS = {l.key: l for l in (
    Layer("mars_viking", "mars", "Mars", "Mars_Viking_MDIM21_ClrMosaic_global_232m", "jpg",
          "Viking colour mosaic, 232 m", "Viking Orbiters 1 and 2", "optical", 7, True),
    Layer("mars_mola_shade", "mars", "Mars", "Mars_MGS_MOLA_ClrShade_merge_global_463m", "jpg",
          "MOLA colour shaded relief, 463 m", "Mars Global Surveyor", "topographic", 6, True),
    Layer("mars_themis_day", "mars", "Mars", "THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018", "png",
          "THEMIS daytime infrared, 100 m", "2001 Mars Odyssey", "thermal", 9),
    Layer("mars_themis_night", "mars", "Mars", "THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018", "png",
          "THEMIS night-time infrared, 100 m", "2001 Mars Odyssey", "thermal", 9),
    Layer("jezero_ctx", "mars", "Mars", "JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0", "png",
          "CTX orthomosaic of Jezero, 6 m", "Mars Reconnaissance Orbiter", "optical", 13),
    Layer("jezero_hirise", "mars", "Mars", "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd", "png",
          "HiRISE orthomosaic of Jezero, 25 cm", "Mars Reconnaissance Orbiter", "optical", 18),
    Layer("moon_wac", "moon", "Moon", "LRO_WAC_Mosaic_Global_303ppd_v02", "jpg",
          "LROC Wide Angle Camera mosaic, 100 m", "Lunar Reconnaissance Orbiter", "optical", 8),
)}

_known_max: dict[str, int] = {}
_lock = threading.Lock()


def _fetch(layer: Layer, z: int, row: int, col: int):
    """One Trek tile as float32 (H, W, 4) RGBA, or None when the tile does not exist."""
    from PIL import Image

    for attempt in range(3):
        try:
            r = _http().get(layer.url(z, row, col), timeout=45)
            if r.status_code in (400, 404):
                return None
            r.raise_for_status()
            return np.asarray(Image.open(io.BytesIO(r.content)).convert("RGBA"), dtype=np.float32)
        except Exception:  # noqa: BLE001 - retried; a failed tile is reported as missing
            if attempt == 2:
                return None
    return None


def mercator_lonlat(z: int, x: int, y: int) -> tuple[np.ndarray, np.ndarray]:
    """Longitude and latitude (degrees) of every pixel centre of a Web Mercator tile."""
    n = 2 ** z
    px = (x + (np.arange(TILE) + 0.5) / TILE) / n
    py = (y + (np.arange(TILE) + 0.5) / TILE) / n
    lon = px * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1.0 - 2.0 * py))))
    return np.meshgrid(lon, lat)


def _sample(layer: Layer, ze: int, lon: np.ndarray, lat: np.ndarray):
    """Sample Trek level `ze` at lon/lat. Returns RGBA uint8, or None if no tile exists there."""
    tile_deg = 180.0 / 2 ** ze
    px_deg = tile_deg / TILE
    c0 = int(math.floor((lon.min() + 180.0) / tile_deg))
    c1 = int(math.floor((lon.max() + 180.0) / tile_deg))
    r0 = int(math.floor((90.0 - lat.max()) / tile_deg))
    r1 = int(math.floor((90.0 - lat.min()) / tile_deg))
    c1, r1 = min(c1, 2 ** (ze + 1) - 1), min(r1, 2 ** ze - 1)
    jobs = [(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]
    if not jobs or len(jobs) > 36:
        return None
    with ThreadPoolExecutor(max_workers=6) as pool:
        tiles = list(pool.map(lambda rc: _fetch(layer, ze, rc[0], rc[1]), jobs))
    if all(t is None for t in tiles):
        return None
    mosaic = np.zeros(((r1 - r0 + 1) * TILE, (c1 - c0 + 1) * TILE, 4), dtype=np.float32)
    for (r, c), t in zip(jobs, tiles):
        if t is not None and t.shape[:2] == (TILE, TILE):
            mosaic[(r - r0) * TILE:(r - r0 + 1) * TILE, (c - c0) * TILE:(c - c0 + 1) * TILE] = t
    rows = (90.0 - lat) / px_deg - r0 * TILE - 0.5
    cols = (lon + 180.0) / px_deg - c0 * TILE - 0.5
    out = np.zeros(lon.shape + (4,), dtype=np.float32)
    alpha = map_coordinates(mosaic[..., 3], [rows, cols], order=1, mode="nearest")
    for ch in range(3):
        # Premultiply so pixels next to missing data do not darken.
        v = map_coordinates(mosaic[..., ch] * mosaic[..., 3] / 255.0, [rows, cols], order=1, mode="nearest")
        out[..., ch] = np.where(alpha > 1, v * 255.0 / np.maximum(alpha, 1), 0)
    out[..., 3] = np.where(alpha > 127, 255, 0)
    return np.clip(out, 0, 255).astype(np.uint8)


def render(layer_key: str, z: int, x: int, y: int) -> bytes | None:
    """PNG bytes of one Web Mercator tile, or None when the layer has no data there."""
    from PIL import Image

    layer = LAYERS[layer_key]
    path = CACHE / layer_key / str(z) / str(x) / f"{y}.png"
    if path.exists():
        data = path.read_bytes()
        return data or None
    lon, lat = mercator_lonlat(z, x, y)
    with _lock:
        top = _known_max.get(layer_key, layer.max_zoom_hint)
    ze = min(max(z - 1, 0), top)
    img = None
    while ze >= 0:
        img = _sample(layer, ze, lon, lat)
        if img is not None or ze <= max(z - 4, 0):
            break
        ze -= 1
    path.parent.mkdir(parents=True, exist_ok=True)
    if img is None or img[..., 3].max() == 0:
        path.write_bytes(b"")          # remember that this tile is empty
        return None
    buf = io.BytesIO()
    Image.fromarray(img, "RGBA").save(buf, format="PNG", optimize=False)
    data = buf.getvalue()
    path.write_bytes(data)
    return data
