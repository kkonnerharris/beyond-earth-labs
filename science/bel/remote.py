"""Windowed reads of remote planetary rasters onto local metric grids.

Two kinds of source are supported:

* PDS raw gridded products (MOLA MEGDR, LOLA GDR): fixed-size binary grids
  in simple cylindrical projection, read with HTTP range requests.
* GeoTIFF / COG products (HiRISE, CTX, THEMIS, LROC WAC, NASADEM, HLS):
  read through GDAL's /vsicurl/ so only the needed window is transferred.

Every read is resampled onto a `LocalGrid`: a square, north-up grid in a
Lambert azimuthal equal-area projection centred on the point of interest.
Cells are therefore true metres on every body, which is what makes slopes
and areas comparable between Earth, Mars and the Moon.
"""
from __future__ import annotations

import math
import os
import time
from dataclasses import dataclass

import numpy as np
import requests
from pyproj import Proj
from scipy.ndimage import map_coordinates

from .bodies import Body, get_body

USER_AGENT = "beyond-earth-labs-science/0.1 (NASA Space Apps 2026 research client)"

# GDAL settings for efficient range reads of remote GeoTIFFs.
GDAL_ENV = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "GDAL_HTTP_MULTIRANGE": "YES",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_MAX_RETRY": "4",
    "GDAL_HTTP_RETRY_DELAY": "2",
    "GDAL_HTTP_TIMEOUT": "120",
    "VSI_CACHE": True,
    "VSI_CACHE_SIZE": 67108864,
    "GDAL_CACHEMAX": 256,
}


@dataclass(frozen=True)
class LocalGrid:
    """Square north-up grid in a local equal-area projection."""

    body: str
    lat0: float
    lon0: float
    size_m: float      # side length
    cell_m: float      # cell size

    @property
    def n(self) -> int:
        return int(round(self.size_m / self.cell_m))

    @property
    def proj(self) -> Proj:
        return Proj(get_body(self.body).laea(self.lat0, self.lon0))

    def xy(self) -> tuple[np.ndarray, np.ndarray]:
        """Cell-centre coordinates (metres); row 0 is the northern edge."""
        n = self.n
        half = self.size_m / 2.0
        c = -half + (np.arange(n) + 0.5) * self.cell_m
        x, y = np.meshgrid(c, -c)
        return x, y

    def lonlat(self) -> tuple[np.ndarray, np.ndarray]:
        x, y = self.xy()
        lon, lat = self.proj(x, y, inverse=True)
        return np.asarray(lon), np.asarray(lat)

    def bounds_lonlat(self, margin_deg: float = 0.02) -> tuple[float, float, float, float]:
        lon, lat = self.lonlat()
        # Unwrap longitudes around the centre so boxes never straddle a seam.
        lon = self.lon0 + ((lon - self.lon0 + 180.0) % 360.0 - 180.0)
        return (float(lon.min() - margin_deg), float(lat.min() - margin_deg),
                float(lon.max() + margin_deg), float(lat.max() + margin_deg))

    def with_cell(self, cell_m: float) -> "LocalGrid":
        return LocalGrid(self.body, self.lat0, self.lon0, self.size_m, cell_m)


# ----------------------------------------------------------------------------
# PDS raw grids
# ----------------------------------------------------------------------------

@dataclass(frozen=True)
class RawTile:
    url: str
    lat_max: float
    lon_min: float          # degrees east, 0..360
    lines: int
    samples: int
    ppd: float              # pixels per degree
    dtype: str              # numpy dtype string, e.g. ">i2"
    scale: float = 1.0      # metres per DN
    nodata: float | None = None


MOLA_BASE = "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/"
LOLA_64_URL = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_64.img"


def mola_tiles() -> list[RawTile]:
    """The sixteen 128 pixel/degree MEGDR topography tiles (MGS-M-MOLA-5-MEGDR-L3-V1.0)."""
    out = []
    for lat_max, tag in ((88.0, "88n"), (44.0, "44n"), (0.0, "00n"), (-44.0, "44s")):
        for lon_min in (0, 90, 180, 270):
            out.append(RawTile(f"{MOLA_BASE}megt{tag}{lon_min:03d}hb.img", lat_max, float(lon_min),
                               5632, 11520, 128.0, ">i2", 1.0))
    return out


def lola_tiles() -> list[RawTile]:
    """LOLA 64 pixel/degree global gridded radius (LRO-L-LOLA-4-GDR-V1.0); height = DN * 0.5 m."""
    return [RawTile(LOLA_64_URL, 90.0, 0.0, 11520, 23040, 64.0, "<i2", 0.5)]


_session: requests.Session | None = None


def _http() -> requests.Session:
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers["User-Agent"] = USER_AGENT
    return _session


def _range_get(url: str, start: int, end: int, retries: int = 4) -> bytes:
    """GET bytes [start, end] inclusive, with retries. Raises on failure."""
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = _http().get(url, headers={"Range": f"bytes={start}-{end}"}, timeout=180)
            if r.status_code != 206:
                raise IOError(f"{url}: expected 206, got {r.status_code}")
            if len(r.content) != end - start + 1:
                raise IOError(f"{url}: short read {len(r.content)} of {end - start + 1}")
            return r.content
        except Exception as exc:  # noqa: BLE001 - retried, then re-raised
            last = exc
            time.sleep(2.0 * (attempt + 1))
    raise IOError(f"range read failed after {retries} attempts: {last}")


def _read_raw_box(tile: RawTile, lon_min: float, lat_min: float, lon_max: float, lat_max: float):
    """Read the part of one raw tile that intersects a lon/lat box.

    Returns (array, lat_of_row0_centre, lon_of_col0_centre) or None.
    Longitudes must already be in the tile's 0..360 frame.
    """
    t_lat_min = tile.lat_max - tile.lines / tile.ppd
    t_lon_max = tile.lon_min + tile.samples / tile.ppd
    lo, hi = max(lon_min, tile.lon_min), min(lon_max, t_lon_max)
    la_lo, la_hi = max(lat_min, t_lat_min), min(lat_max, tile.lat_max)
    if lo >= hi or la_lo >= la_hi:
        return None
    r0 = max(0, int(math.floor((tile.lat_max - la_hi) * tile.ppd)))
    r1 = min(tile.lines, int(math.ceil((tile.lat_max - la_lo) * tile.ppd)))
    c0 = max(0, int(math.floor((lo - tile.lon_min) * tile.ppd)))
    c1 = min(tile.samples, int(math.ceil((hi - tile.lon_min) * tile.ppd)))
    if r1 <= r0 or c1 <= c0:
        return None
    itemsize = np.dtype(tile.dtype).itemsize
    row_bytes = tile.samples * itemsize
    # One request per row would be slow; a single request for the row block is
    # larger than needed when the box is narrow, so split into column-exact
    # requests only when that saves most of the transfer.
    width_fraction = (c1 - c0) / tile.samples
    rows = []
    if width_fraction > 0.5:
        buf = _range_get(tile.url, r0 * row_bytes, r1 * row_bytes - 1)
        arr = np.frombuffer(buf, dtype=tile.dtype).reshape(r1 - r0, tile.samples)[:, c0:c1]
    else:
        # Group rows so each request stays small: rows are contiguous in the
        # file, so read blocks of rows and slice columns locally.
        block = max(1, min(r1 - r0, int(64e6 // row_bytes)))
        for rs in range(r0, r1, block):
            re_ = min(r1, rs + block)
            buf = _range_get(tile.url, rs * row_bytes, re_ * row_bytes - 1)
            rows.append(np.frombuffer(buf, dtype=tile.dtype).reshape(re_ - rs, tile.samples)[:, c0:c1])
        arr = np.vstack(rows)
    arr = arr.astype(np.float32) * tile.scale
    lat0 = tile.lat_max - (r0 + 0.5) / tile.ppd
    lon0 = tile.lon_min + (c0 + 0.5) / tile.ppd
    return arr, lat0, lon0


def read_raw_grid(tiles: list[RawTile], grid: LocalGrid) -> tuple[np.ndarray, dict]:
    """Resample a PDS raw cylindrical grid onto a LocalGrid (bilinear).

    Returns (elevation_m, info) where info records what was actually read.
    """
    lon, lat = grid.lonlat()
    lon = np.mod(lon, 360.0)
    lon_min, lon_max = float(lon.min()), float(lon.max())
    if lon_max - lon_min > 180.0:
        raise ValueError("grid straddles the 0/360 longitude seam; choose a centre away from it")
    pad = 4.0 / tiles[0].ppd
    box = (lon_min - pad, float(lat.min()) - pad, lon_max + pad, float(lat.max()) + pad)

    ppd = tiles[0].ppd
    # Assemble a mosaic in the box from every intersecting tile.
    n_rows = int(math.ceil((box[3] - box[1]) * ppd)) + 2
    n_cols = int(math.ceil((box[2] - box[0]) * ppd)) + 2
    top_lat = math.ceil(box[3] * ppd) / ppd
    left_lon = math.floor(box[0] * ppd) / ppd
    mosaic = np.full((n_rows, n_cols), np.nan, dtype=np.float32)
    used = []
    for t in tiles:
        got = _read_raw_box(t, box[0], box[1], box[2], box[3])
        if got is None:
            continue
        arr, lat0, lon0 = got
        r = int(round((top_lat - lat0) * ppd - 0.5))
        c = int(round((lon0 - left_lon) * ppd - 0.5))
        rr0, cc0 = max(r, 0), max(c, 0)
        rr1, cc1 = min(r + arr.shape[0], n_rows), min(c + arr.shape[1], n_cols)
        if rr1 > rr0 and cc1 > cc0:
            mosaic[rr0:rr1, cc0:cc1] = arr[rr0 - r:rr1 - r, cc0 - c:cc1 - c]
            used.append(t.url)
    if not used:
        raise IOError("no source tile intersects the requested grid")
    rows = (top_lat - lat) * ppd - 0.5
    cols = (lon - left_lon) * ppd - 0.5
    out = map_coordinates(mosaic, [rows, cols], order=1, mode="nearest", cval=np.nan)
    info = {"sources": used, "native_pixels_per_degree": ppd, "box_lonlat": box, "resampling": "bilinear"}
    return out.astype(np.float32), info


# ----------------------------------------------------------------------------
# GeoTIFF / COG
# ----------------------------------------------------------------------------

class OutsideRaster(IOError):
    """The requested grid does not intersect the raster (not a network problem)."""


class SourceMissing(IOError):
    """The remote file does not exist (HTTP 404), e.g. an all-ocean DEM tile."""


def _vsi(url: str) -> str:
    if url.startswith("http") and not url.startswith("/vsicurl/"):
        return "/vsicurl/" + url
    return url


def read_geotiff(url: str, grid: LocalGrid, band: int = 1, average: bool = True,
                 nodata_override: float | None = None) -> tuple[np.ndarray, dict]:
    """Resample one band of a (remote) GeoTIFF onto a LocalGrid.

    The window covering the grid is read at a resolution close to the grid's
    cell size (area-averaged by GDAL when the source is finer and
    `average` is true), then sampled bilinearly at the grid's cell centres.
    The source CRS's own projection is applied to the grid's lon/lat, so no
    datum transformation is involved: source and grid share a body.
    """
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.windows import Window

    lon, lat = grid.lonlat()
    with rasterio.Env(**GDAL_ENV):
        try:
            src_cm = rasterio.open(_vsi(url))
        except Exception as exc:  # noqa: BLE001 - classify, then re-raise
            text = str(exc)
            if "404" in text or "does not exist" in text or "not recognized as" in text:
                raise SourceMissing(f"{url.split('?')[0]}: {text[:160]}") from exc
            raise IOError(f"{url.split('?')[0]}: {text[:200]}") from exc
        with src_cm as src:
            crs = src.crs
            if crs is None:
                raise IOError(f"{url}: no CRS")
            if crs.is_geographic:
                sx, sy = lon.copy(), lat
                # Match the source's longitude frame (0..360 or -180..180).
                west = src.bounds.left
                sx = west + np.mod(sx - west, 360.0)
            else:
                p = Proj(crs.to_wkt())
                sx, sy = p(lon, lat)
                sx, sy = np.asarray(sx), np.asarray(sy)
            inv = ~src.transform
            cols, rows = inv * (sx, sy)
            c0, c1 = math.floor(cols.min()) - 2, math.ceil(cols.max()) + 2
            r0, r1 = math.floor(rows.min()) - 2, math.ceil(rows.max()) + 2
            c0c, r0c = max(c0, 0), max(r0, 0)
            c1c, r1c = min(c1, src.width), min(r1, src.height)
            if c1c <= c0c or r1c <= r0c:
                raise OutsideRaster(f"{url.split('?')[0]}: grid is outside the raster")
            win = Window(c0c, r0c, c1c - c0c, r1c - r0c)
            src_cell = abs(src.transform.a)
            if crs.is_geographic:
                src_cell_m = src_cell * get_body(grid.body).metres_per_degree()
            else:
                src_cell_m = src_cell
            factor = max(1.0, grid.cell_m / src_cell_m)
            out_h = max(1, int(round(win.height / factor)))
            out_w = max(1, int(round(win.width / factor)))
            resampling = Resampling.average if (average and factor > 1.5) else Resampling.bilinear
            data = src.read(band, window=win, out_shape=(out_h, out_w), resampling=resampling,
                            masked=True)
            nodata = src.nodata if nodata_override is None else nodata_override
            arr = data.astype(np.float32).filled(np.nan)
            if nodata is not None:
                arr[arr == nodata] = np.nan
            info = {
                "source": url, "crs": crs.to_string()[:120], "native_cell": src_cell,
                "native_cell_m": src_cell_m, "window": [int(c0c), int(r0c), int(win.width), int(win.height)],
                "read_shape": [out_h, out_w], "decimation": factor,
                "resampling": resampling.name, "block_shapes": [list(b) for b in src.block_shapes[:1]],
            }
            src_w, src_h = src.width, src.height
    # Pixel coordinates inside the decimated window.
    rr = (rows - r0c) * (out_h / win.height) - 0.5 + 0.5 * (out_h / win.height)
    cc = (cols - c0c) * (out_w / win.width) - 0.5 + 0.5 * (out_w / win.width)
    valid = np.isfinite(arr)
    filled = np.where(valid, arr, 0.0)
    out = map_coordinates(filled, [rr, cc], order=1, mode="nearest")
    w = map_coordinates(valid.astype(np.float32), [rr, cc], order=1, mode="nearest")
    outside = (cols < 0) | (rows < 0) | (cols > src_w) | (rows > src_h)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where((w > 0.6) & ~outside, out / np.maximum(w, 1e-6), np.nan)
    return out.astype(np.float32), info


def body_of(grid: LocalGrid) -> Body:
    return get_body(grid.body)


def set_gdal_env() -> None:
    """Apply the GDAL settings process-wide (for code paths that open datasets directly)."""
    for k, v in GDAL_ENV.items():
        os.environ.setdefault(k, str(v))


# ----------------------------------------------------------------------------
# NASA Trek WMTS imagery tiles
# ----------------------------------------------------------------------------

@dataclass(frozen=True)
class TrekLayer:
    """A NASA Solar System Treks equirectangular WMTS layer (imagery only)."""

    body: str
    trek_body: str      # path segment: "Mars" or "Moon"
    layer: str
    ext: str            # "png" or "jpg"
    max_zoom: int       # deepest level that exists for the layer (verified by request)

    def url(self, z: int, row: int, col: int) -> str:
        return (f"https://trek.nasa.gov/tiles/{self.trek_body}/EQ/{self.layer}/1.0.0/default/"
                f"default028mm/{z}/{row}/{col}.{self.ext}")

    def metres_per_pixel(self, z: int | None = None) -> float:
        z = self.max_zoom if z is None else z
        return (180.0 / (256 * 2 ** z)) * get_body(self.body).metres_per_degree()


# Level z has 2^(z+1) x 2^z tiles of 256 px: one tile spans 180/2^z degrees.
THEMIS_DAY_IR = TrekLayer("mars", "Mars", "THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018", "png", 9)
LROC_WAC = TrekLayer("moon", "Moon", "LRO_WAC_Mosaic_Global_303ppd_v02", "jpg", 8)


def _fetch_tile(url: str, retries: int = 4):
    import io

    from PIL import Image

    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = _http().get(url, timeout=60)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            im = Image.open(io.BytesIO(r.content))
            if im.mode in ("RGBA", "LA"):
                a = np.asarray(im.getchannel("A"), dtype=np.float32)
                g = np.asarray(im.convert("L"), dtype=np.float32)
                g[a == 0] = np.nan
                return g
            return np.asarray(im.convert("L"), dtype=np.float32)
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise IOError(f"tile fetch failed: {url}: {last}")


def read_trek(layer: TrekLayer, grid: LocalGrid, zoom: int | None = None, workers: int = 8) -> tuple[np.ndarray, dict]:
    """Sample a Trek imagery layer onto a LocalGrid as a grey image (0..255, NaN = no data).

    Imagery tiles are lossy display products. They are used only as image
    inputs, never as numerical measurements.
    """
    from concurrent.futures import ThreadPoolExecutor

    z = layer.max_zoom if zoom is None else zoom
    tile_deg = 180.0 / 2 ** z
    px_deg = tile_deg / 256.0
    lon, lat = grid.lonlat()
    lon = np.mod(lon + 180.0, 360.0) - 180.0
    if lon.max() - lon.min() > 180.0:
        raise ValueError("grid straddles the +/-180 longitude seam; choose a centre away from it")
    c0 = int(math.floor((lon.min() + 180.0) / tile_deg))
    c1 = int(math.floor((lon.max() + 180.0) / tile_deg))
    r0 = int(math.floor((90.0 - lat.max()) / tile_deg))
    r1 = int(math.floor((90.0 - lat.min()) / tile_deg))
    jobs = [(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]
    mosaic = np.full(((r1 - r0 + 1) * 256, (c1 - c0 + 1) * 256), np.nan, dtype=np.float32)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        tiles = list(pool.map(lambda rc: _fetch_tile(layer.url(z, rc[0], rc[1])), jobs))
    missing = 0
    for (r, c), t in zip(jobs, tiles):
        if t is None:
            missing += 1
            continue
        mosaic[(r - r0) * 256:(r - r0 + 1) * 256, (c - c0) * 256:(c - c0 + 1) * 256] = t
    rows = (90.0 - lat) / px_deg - r0 * 256 - 0.5
    cols = (lon + 180.0) / px_deg - c0 * 256 - 0.5
    valid = np.isfinite(mosaic)
    out = map_coordinates(np.where(valid, mosaic, 0.0), [rows, cols], order=1, mode="nearest")
    w = map_coordinates(valid.astype(np.float32), [rows, cols], order=1, mode="nearest")
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(w > 0.6, out / np.maximum(w, 1e-6), np.nan)
    info = {"source": f"NASA Trek WMTS {layer.trek_body}/{layer.layer}", "zoom": z,
            "tile_metres_per_pixel": layer.metres_per_pixel(z), "tiles": len(jobs), "tiles_missing": missing,
            "example_tile": layer.url(z, r0, c0), "resampling": "bilinear", "lossy": layer.ext == "jpg"}
    return out.astype(np.float32), info
