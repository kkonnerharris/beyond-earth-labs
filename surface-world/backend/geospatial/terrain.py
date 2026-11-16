"""Terrain sources.

A `Terrain` is a regular height grid in metres on a local east/north plane, plus the features the
simulation needs (rocks, hazard zones, sites). Everything downstream (mesh, traversability, A*,
the AI tools) only sees this interface, so the procedural source below can be swapped for a real
elevation raster (MOLA / HiRISE DTM via the Phase 3 ingestion pipeline) without other changes.

The procedural region is deterministic for a given seed. It is NOT a real place and must never be
presented as geographically accurate.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

# World frame: x = east (m), z = south (m), y = up (m). Origin at the grid centre.


@dataclass
class Rock:
    x: float
    z: float
    r: float          # radius (m)


@dataclass
class Hazard:
    id: str
    kind: str         # loose_regolith | rock_field | steep_slope | dust_devil_track
    label: str
    x: float
    z: float
    r: float
    penalty: float    # traversal cost multiplier added inside the zone
    note: str


@dataclass
class Site:
    id: str
    name: str
    kind: str
    x: float
    z: float
    description: str
    simulated: bool = True


@dataclass
class Provenance:
    source: str
    kind: str                      # procedural | dem
    seed: int | None
    crs: str
    resolution_m: float
    note: str
    citation: str | None = None


@dataclass
class Terrain:
    size_m: float
    n: int                          # grid is n x n vertices
    heights: np.ndarray             # shape (n, n), float32, metres; [row=z, col=x]
    rocks: list[Rock] = field(default_factory=list)
    hazards: list[Hazard] = field(default_factory=list)
    sites: list[Site] = field(default_factory=list)
    habitat: tuple[float, float] = (0.0, 0.0)
    landing_zone: tuple[float, float] = (0.0, 0.0)
    provenance: Provenance | None = None
    roughness: np.ndarray | None = None   # optional (n, n) 0..1 measured roughness (real DEMs)
    roughness_penalty: float = 0.0

    @property
    def cell(self) -> float:
        return self.size_m / (self.n - 1)

    def to_grid(self, x: float, z: float) -> tuple[float, float]:
        """World metres -> fractional (row, col)."""
        h = self.size_m / 2
        return (z + h) / self.cell, (x + h) / self.cell

    def to_world(self, row: float, col: float) -> tuple[float, float]:
        h = self.size_m / 2
        return col * self.cell - h, row * self.cell - h

    def height_at(self, x: float, z: float) -> float:
        """Bilinear height sample (same interpolation the frontend uses)."""
        r, c = self.to_grid(x, z)
        r = min(max(r, 0.0), self.n - 1.0001)
        c = min(max(c, 0.0), self.n - 1.0001)
        r0, c0 = int(r), int(c)
        fr, fc = r - r0, c - c0
        h = self.heights
        top = h[r0, c0] * (1 - fc) + h[r0, c0 + 1] * fc
        bot = h[r0 + 1, c0] * (1 - fc) + h[r0 + 1, c0 + 1] * fc
        return float(top * (1 - fr) + bot * fr)

    def slope_deg(self) -> np.ndarray:
        """Per-vertex slope in degrees (central differences)."""
        gz, gx = np.gradient(self.heights.astype(np.float64), self.cell)
        return np.degrees(np.arctan(np.hypot(gx, gz))).astype(np.float32)

    def in_bounds(self, x: float, z: float, margin: float = 0.0) -> bool:
        h = self.size_m / 2 - margin
        return -h <= x <= h and -h <= z <= h


# ---------------------------------------------------------------------------- procedural source
def _smoothstep(t: np.ndarray) -> np.ndarray:
    return t * t * (3 - 2 * t)


def _value_noise(rng: np.random.Generator, n: int, cells: int) -> np.ndarray:
    """Smooth value noise on an n x n grid from a (cells+1)^2 lattice of random values."""
    lattice = rng.random((cells + 1, cells + 1))
    t = np.linspace(0, cells - 1e-9, n)
    i = t.astype(int)
    f = _smoothstep(t - i)
    a = lattice[np.ix_(i, i)]
    b = lattice[np.ix_(i, i + 1)]
    c = lattice[np.ix_(i + 1, i)]
    d = lattice[np.ix_(i + 1, i + 1)]
    fx = f[None, :]
    fz = f[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz


def _fbm(rng: np.random.Generator, n: int, base_cells: int = 4, octaves: int = 6, gain: float = 0.5) -> np.ndarray:
    total = np.zeros((n, n))
    amp, norm = 1.0, 0.0
    cells = base_cells
    for _ in range(octaves):
        total += amp * (_value_noise(rng, n, cells) - 0.5)
        norm += amp
        amp *= gain
        cells *= 2
    return total / norm


def generate_procedural(seed: int = 7, size_m: float = 600.0, n: int = 241) -> Terrain:
    """Deterministic Mars-like region: rolling plains, a large crater, smaller craters, a ridge,
    a dune field, rocks. Units are metres. Not a real location."""
    rng = np.random.default_rng(seed)
    xs = np.linspace(-size_m / 2, size_m / 2, n)
    X, Z = np.meshgrid(xs, xs)                       # X[row, col] = east, Z[row, col] = south

    h = 14.0 * _fbm(rng, n, base_cells=3, octaves=6)  # broad relief
    h += 2.2 * _fbm(rng, n, base_cells=24, octaves=3)  # small-scale roughness

    # Ridge running NE-SW across the north of the map
    d_ridge = (X * 0.6 + (Z + 170) * 0.8)
    h += 11.0 * np.exp(-(d_ridge / 38.0) ** 2) * (0.7 + 0.3 * np.cos(X / 55.0))

    def crater(cx: float, cz: float, R: float, depth: float, rim: float) -> np.ndarray:
        d = np.hypot(X - cx, Z - cz) / R
        bowl = -depth * np.clip(1 - d ** 2, 0, None)
        rim_h = rim * np.exp(-((d - 1.0) / 0.22) ** 2)
        ejecta = 0.35 * rim * np.exp(-((d - 1.6) / 0.5) ** 2) * (d > 1)
        return bowl + rim_h + ejecta

    craters = [(150.0, 70.0, 75.0, 22.0, 7.0),          # main crater, east
               (-170.0, 150.0, 34.0, 9.0, 3.5),
               (-60.0, -150.0, 22.0, 6.0, 2.5),
               (60.0, 210.0, 18.0, 5.0, 2.0),
               (-230.0, -40.0, 26.0, 7.0, 3.0)]
    for c in craters:
        h += crater(*c)
    for _ in range(14):                              # small fresh craters
        cx, cz = rng.uniform(-260, 260, 2)
        R = rng.uniform(4, 10)
        h += crater(cx, cz, R, R * 0.25, R * 0.08)

    # Breached rim: a gentle ramp into the main crater from the west, the only drivable way in.
    ax, az = 40.0, 45.0           # ramp top (outside the rim)
    bx, bz = 128.0, 66.0          # ramp foot (on the crater floor)
    vx, vz = bx - ax, bz - az
    L2 = vx * vx + vz * vz
    tpar = np.clip(((X - ax) * vx + (Z - az) * vz) / L2, 0, 1)
    dist = np.hypot(X - (ax + tpar * vx), Z - (az + tpar * vz))
    h_top = float(h[np.unravel_index(np.argmin(np.hypot(X - ax, Z - az)), h.shape)])
    h_foot = float(h[np.unravel_index(np.argmin(np.hypot(X - bx, Z - bz)), h.shape)])
    ramp = h_top + (h_foot - h_top) * tpar
    w = _smoothstep(np.clip(1 - dist / 16.0, 0, 1)) * ((tpar > 0) & (tpar < 1))
    h = h * (1 - w) + ramp * w

    # Dune field to the south-west (wavy, gentle)
    dune_mask = np.exp(-(((X + 150) / 90) ** 2 + ((Z - 40) / 70) ** 2))
    h += 1.6 * np.sin((X * 0.8 + Z * 0.6) / 6.0) * dune_mask

    # Flatten a pad for the habitat and landing zone (the crew would choose flat ground)
    habitat = (-40.0, 20.0)
    landing = (-95.0, -35.0)
    for (px, pz), R in ((habitat, 34.0), (landing, 26.0)):
        w = np.clip(1 - np.hypot(X - px, Z - pz) / R, 0, 1)
        w = _smoothstep(w)
        target = float(h[np.unravel_index(np.argmin(np.hypot(X - px, Z - pz)), h.shape)])
        h = h * (1 - w) + target * w

    heights = h.astype(np.float32)

    # Rocks: sparse everywhere, dense in a rock field north-west of the habitat.
    rocks: list[Rock] = []
    def far_from_pads(x: float, z: float) -> bool:
        return math.hypot(x - habitat[0], z - habitat[1]) > 38 and math.hypot(x - landing[0], z - landing[1]) > 30
    for _ in range(140):
        x, z = rng.uniform(-285, 285, 2)
        if far_from_pads(x, z):
            rocks.append(Rock(float(x), float(z), float(rng.uniform(0.4, 1.6))))
    rf = (-120.0, -110.0)
    for _ in range(110):
        x = rf[0] + rng.normal(0, 26)
        z = rf[1] + rng.normal(0, 20)
        if far_from_pads(x, z):
            rocks.append(Rock(float(x), float(z), float(rng.uniform(0.5, 2.2))))

    hazards = [
        Hazard("hz-dunes", "loose_regolith", "Loose regolith (dune field)", -150.0, 40.0, 75.0, 2.5,
               "Fine-grained sand: high wheel slip and sinkage risk in the simulation model."),
        Hazard("hz-rockfield", "rock_field", "Boulder field", rf[0], rf[1], 55.0, 1.8,
               "Dense rocks raise collision risk and slow driving."),
        Hazard("hz-crater", "steep_slope", "Main crater walls", 150.0, 70.0, 95.0, 1.2,
               "Steep inner walls; slopes above the rover limit are impassable."),
    ]

    sites = [
        Site("site-layered", "Layered outcrop", "outcrop", 210.0, -120.0, "Exposed layers on the ridge flank (procedural placeholder)."),
        Site("site-crater-floor", "Crater floor deposit", "deposit", 150.0, 70.0, "Flat floor inside the main crater (procedural placeholder)."),
        Site("site-dune-crest", "Dune crest", "aeolian", -175.0, 55.0, "Wind-shaped ripples (procedural placeholder)."),
        Site("site-boulder", "Isolated boulder", "boulder", -20.0, 190.0, "Large ejecta block (procedural placeholder)."),
        Site("site-ridge", "Ridge summit", "viewpoint", 40.0, -170.0, "High point with long sight lines (procedural placeholder)."),
    ]

    prov = Provenance(source="Procedural generator (backend/geospatial/terrain.py)", kind="procedural", seed=seed,
                      crs="Local metric frame (x east, z south), origin at map centre",
                      resolution_m=size_m / (n - 1),
                      note="Synthetic Mars-like terrain for development. Not a real location; not geographically accurate.")
    return Terrain(size_m=size_m, n=n, heights=heights, rocks=rocks, hazards=hazards, sites=sites,
                   habitat=habitat, landing_zone=landing, provenance=prov)
