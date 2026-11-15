"""Planetary constants used across the science service.

Every number here is a published reference value. Units are SI unless the
name says otherwise.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Body:
    key: str
    name: str
    radius_m: float           # mean / reference sphere radius used by the map products
    gravity_ms2: float        # surface gravity
    sol_seconds: float        # length of a solar day
    has_atmosphere: bool
    solar_constant_wm2: float  # mean top-of-atmosphere solar irradiance
    source: str

    def laea(self, lat0: float, lon0: float) -> str:
        """PROJ string for an equal-area local metric frame centred on a point."""
        if self.key == "earth":
            return f"+proj=laea +lat_0={lat0} +lon_0={lon0} +datum=WGS84 +units=m +no_defs"
        return f"+proj=laea +lat_0={lat0} +lon_0={lon0} +R={self.radius_m} +units=m +no_defs"

    def metres_per_degree(self) -> float:
        import math

        return math.pi * self.radius_m / 180.0


MARS = Body(
    key="mars",
    name="Mars",
    radius_m=3_396_190.0,      # IAU 2000 Mars sphere used by USGS / MOLA map products
    gravity_ms2=3.721,
    sol_seconds=88_775.244,
    has_atmosphere=True,
    solar_constant_wm2=586.2,  # at 1.524 au mean distance
    source="IAU/IAG 2000 (Seidelmann et al. 2002); NASA Mars Fact Sheet",
)

MOON = Body(
    key="moon",
    name="Moon",
    radius_m=1_737_400.0,      # LOLA / LRO reference sphere
    gravity_ms2=1.62,
    sol_seconds=2_551_443.0,   # synodic month
    has_atmosphere=False,
    solar_constant_wm2=1361.0,
    source="LRO/LOLA reference sphere; NASA Moon Fact Sheet",
)

EARTH = Body(
    key="earth",
    name="Earth",
    radius_m=6_371_008.8,      # mean radius; WGS84 ellipsoid is used for projection
    gravity_ms2=9.807,
    sol_seconds=86_400.0,
    has_atmosphere=True,
    solar_constant_wm2=1361.0,
    source="WGS84; NASA Earth Fact Sheet",
)

BODIES = {b.key: b for b in (MARS, MOON, EARTH)}


def get_body(key: str) -> Body:
    try:
        return BODIES[key]
    except KeyError as exc:
        raise ValueError(f"unknown body {key!r}; expected one of {sorted(BODIES)}") from exc
