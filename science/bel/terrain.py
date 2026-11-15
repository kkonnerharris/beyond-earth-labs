"""Numerical terrain measurements from elevation grids.

All functions take elevations in metres on a square metric grid and a cell
size in metres. Nothing here uses imagery: these are the physical
measurements that the deep-learning model is trained against and that the
route planner uses directly.
"""
from __future__ import annotations

import numpy as np

# Order of the physical attribute vector used everywhere (dataset, model, API).
ATTRIBUTE_NAMES = (
    "slope_median_deg",   # median slope at the DEM baseline
    "slope_p90_deg",      # 90th percentile slope
    "relief_m",           # max - min elevation in the cell
    "roughness_m",        # RMS height about a best-fit plane
    "tri_m",              # terrain ruggedness index (Riley et al. 1999)
)


def slope_degrees(z: np.ndarray, cell_m: float) -> np.ndarray:
    """Slope in degrees using Horn's (1981) 3x3 finite-difference kernel.

    Edge cells use replicated borders. NaN cells propagate to their
    neighbours' slope, which is then NaN.
    """
    z = np.asarray(z, dtype=np.float64)
    p = np.pad(z, 1, mode="edge")
    a, b, c = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    d, f = p[1:-1, :-2], p[1:-1, 2:]
    g, h, i = p[2:, :-2], p[2:, 1:-1], p[2:, 2:]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8.0 * cell_m)
    dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8.0 * cell_m)
    return np.degrees(np.arctan(np.hypot(dzdx, dzdy)))


def terrain_ruggedness_index(z: np.ndarray) -> np.ndarray:
    """Riley et al. (1999) TRI: root of summed squared differences to the 8 neighbours."""
    z = np.asarray(z, dtype=np.float64)
    p = np.pad(z, 1, mode="edge")
    acc = np.zeros_like(z)
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            if dy == 1 and dx == 1:
                continue
            acc += (p[dy:dy + z.shape[0], dx:dx + z.shape[1]] - z) ** 2
    return np.sqrt(acc)


def plane_detrended_rms(z: np.ndarray) -> float:
    """RMS height (m) after removing the best-fit plane: roughness without regional tilt."""
    z = np.asarray(z, dtype=np.float64)
    ok = np.isfinite(z)
    if ok.sum() < 6:
        return float("nan")
    yy, xx = np.mgrid[0:z.shape[0], 0:z.shape[1]]
    A = np.column_stack([xx[ok], yy[ok], np.ones(ok.sum())])
    coef, *_ = np.linalg.lstsq(A, z[ok], rcond=None)
    resid = z[ok] - A @ coef
    return float(np.sqrt(np.mean(resid ** 2)))


def attributes(z: np.ndarray, cell_m: float) -> np.ndarray:
    """Physical attribute vector (see ATTRIBUTE_NAMES) for one elevation patch."""
    s = slope_degrees(z, cell_m)
    tri = terrain_ruggedness_index(z)
    finite = np.isfinite(z)
    if finite.sum() < 0.9 * z.size:
        return np.full(len(ATTRIBUTE_NAMES), np.nan)
    return np.array(
        [
            np.nanmedian(s),
            np.nanpercentile(s, 90),
            float(np.nanmax(z) - np.nanmin(z)),
            plane_detrended_rms(z),
            float(np.nanmean(tri)),
        ],
        dtype=np.float64,
    )


def log_attributes(a: np.ndarray) -> np.ndarray:
    """Variance-stabilising transform used as the regression target.

    Terrain attributes are positive and roughly log-normal across planets,
    so the model predicts log1p(value). The transform is the same for every
    body: targets stay in physical units and are never normalised per planet.
    """
    return np.log1p(np.asarray(a, dtype=np.float64))


def block_mean(z: np.ndarray, factor: int) -> np.ndarray:
    """Area-average a grid by an integer factor (NaN-aware), trimming ragged edges."""
    h, w = (z.shape[0] // factor) * factor, (z.shape[1] // factor) * factor
    v = z[:h, :w].reshape(h // factor, factor, w // factor, factor)
    with np.errstate(invalid="ignore"):
        return np.nanmean(v, axis=(1, 3))
