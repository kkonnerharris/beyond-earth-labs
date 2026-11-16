"""Earth analog: Garden of the Gods, Shawnee National Forest, Southern Illinois.

Loads the region prepared by scripts/import_earth.py into the same Terrain interface as Mars, so the
identical planner routes foot traverses here: Mars EVA training on an Earth analog, and search-and-rescue
route planning for a real local forest.

Real: terrain (USGS 3DEP), the orbit-vs-airborne terrain check (NASADEM), imagery (Sentinel-2), slope.
Simulated: the field camp, the helicopter landing zone, and the suit/rover models (Mars-tuned, as in
NASA analog field tests that simulate EVA consumables). Feature sites are computed from the data.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from backend.geospatial.terrain import Provenance, Site, Terrain

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "processed" / "shawnee"
MANIFEST = ROOT / "data" / "manifests" / "shawnee_region.json"
ROUGH_LO, ROUGH_HI, ROUGH_PENALTY = 12.0, 30.0, 2.0   # 5 m slope; bluffs and ravines


def available() -> bool:
    return (DATA / "heights.npy").exists() and MANIFEST.exists()


def manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def _flattest(h: np.ndarray, slope: np.ndarray, cell: float, size: float, near: tuple[float, float], radius: float, avoid=()):
    n = h.shape[0]
    xs = np.linspace(-size / 2, size / 2, n)
    X, Z = np.meshgrid(xs, xs)
    k = 5
    from numpy.lib.stride_tricks import sliding_window_view as sw
    mean = np.pad(sw(slope, (k, k)).mean(axis=(2, 3)), k // 2, mode="edge")
    score = mean + 1e3 * (np.hypot(X - near[0], Z - near[1]) > radius) + 1e3 * ((np.abs(X) > size / 2 - 60) | (np.abs(Z) > size / 2 - 60))
    for ax, az, r in avoid:
        score += 1e3 * (np.hypot(X - ax, Z - az) < r)
    r, c = np.unravel_index(np.argmin(score), score.shape)
    return float(X[r, c]), float(Z[r, c]), float(mean[r, c])


def load_shawnee() -> Terrain:
    if not available():
        raise FileNotFoundError("Earth region not prepared; run: python scripts/import_earth.py")
    m = manifest()
    reg = m["region"]
    h = np.load(DATA / "heights.npy").astype(np.float32)
    slope_fine = np.load(DATA / "slope_fine.npy").astype(np.float32)
    n = h.shape[0]
    size = float(reg["size_m"])
    cell = size / (n - 1)
    datum = reg["datum_offset_m"]
    xs = np.linspace(-size / 2, size / 2, n)

    camp = _flattest(h, slope_fine, cell, size, (0.0, 0.0), 450)
    lz = _flattest(h, slope_fine, cell, size, (0.0, 0.0), 800, avoid=[(camp[0], camp[1], 300)])

    def at(idx) -> tuple[float, float]:
        r, c = idx
        return float(xs[c]), float(xs[r])
    inner = (slice(20, n - 20), slice(20, n - 20))
    hi = np.unravel_index(np.argmax(h[inner]), h[inner].shape)
    lo = np.unravel_index(np.argmin(h[inner]), h[inner].shape)
    st = np.unravel_index(np.argmax(slope_fine[inner]), slope_fine[inner].shape)
    hi, lo, st = (hi[0] + 20, hi[1] + 20), (lo[0] + 20, lo[1] + 20), (st[0] + 20, st[1] + 20)

    def site(id_: str, name: str, kind: str, xz, desc: str, simulated: bool = False) -> Site:
        return Site(id_, name, kind, round(xz[0], 1), round(xz[1], 1), desc, simulated)

    sites = [
        site("site-high", "Highest bluff top", "viewpoint", at(hi), f"Highest ground on the map, {h[hi] + datum:.0f} m above sea level (USGS 3DEP)"),
        site("site-steep", "Steepest bluff face", "hazard", at(st), f"Steepest 5 m slope on the map, {slope_fine[st]:.0f} deg: sandstone cliffs like these are where hikers get hurt (USGS 3DEP)"),
        site("site-valley", "Lowest valley floor", "valley", at(lo), f"Lowest ground on the map, {h[lo] + datum:.0f} m above sea level, a typical search area below the bluffs (USGS 3DEP)"),
        site("site-lz", "Helicopter landing zone", "lz", lz[:2], f"Flattest open ground away from the camp (mean slope {lz[2]:.1f} deg). Placement is simulated", True),
    ]
    roughness = np.clip((slope_fine - ROUGH_LO) / (ROUGH_HI - ROUGH_LO), 0, 1).astype(np.float32)
    s3 = m["sources"]["usgs_3dep"]
    prov = Provenance(
        source="USGS 3DEP 1/3 arc-second DEM, checked against NASA NASADEM (Space Shuttle radar)", kind="dem", seed=None,
        crs=f"Transverse Mercator (WGS84), centre {reg['centre_lat_deg']:.4f} N {reg['centre_lon_deg']:.4f} E (x east, z south, metres)",
        resolution_m=cell,
        note=(f"Earth analog: Garden of the Gods, Shawnee National Forest, Illinois. Elevation {reg['elevation_min_m']:.0f} to "
              f"{reg['elevation_max_m']:.0f} m. NASADEM (from orbit) minus 3DEP: median {reg['nasadem_minus_3dep_median_m']:+.2f} m."),
        citation=f"{s3['citation']} {s3['doi']}",
    )
    return Terrain(size_m=size, n=n, heights=h, rocks=[], hazards=[], sites=sites, habitat=camp[:2], landing_zone=lz[:2],
                   provenance=prov, roughness=roughness, roughness_penalty=ROUGH_PENALTY)
