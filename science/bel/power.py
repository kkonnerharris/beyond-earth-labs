"""Outdoor growing conditions at an Earth site from NASA POWER.

This is the Earth-facing agriculture component. It answers two questions
with observations, not models of ours:

* How have temperature, rainfall and sunlight at this site changed between
  the first and the most recent decade of the record?
* How much photosynthetic light does the Sun deliver there, which is what
  a greenhouse on Mars has to replace with lamps?

Source: NASA POWER monthly and annual, agroclimatology community
(MERRA-2 meteorology, CERES/SRB surface solar), 1984 onward, on a grid of
about half a degree. It describes a region, not a field.
"""
from __future__ import annotations

import json

import requests

from . import DATA_DIR
from .remote import USER_AGENT

URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"
CACHE = DATA_DIR / "cache" / "power"
EARLY, RECENT = (1984, 1993), (2015, 2024)
DAYS = (31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
GROWING_T_C = 10.0          # a month counts as growing season when its mean air temperature reaches this
PAR_FRACTION = 0.45         # share of surface solar energy that is photosynthetically active (400-700 nm)
PAR_MOL_PER_MJ = 4.57       # mol of photons per MJ of sunlight in that band (McCree 1972)


def _fetch(lat: float, lon: float) -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{lat:.2f}_{lon:.2f}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    r = requests.get(URL, params={"parameters": "T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN", "community": "AG",
                                  "longitude": lon, "latitude": lat, "start": EARLY[0], "end": RECENT[1],
                                  "format": "JSON"}, headers={"User-Agent": USER_AGENT}, timeout=120)
    r.raise_for_status()
    data = r.json()
    path.write_text(json.dumps(data), encoding="utf-8")
    return data


def _period(series: dict, years: tuple[int, int], fill: float) -> list[float | None]:
    """Mean of each calendar month over a span of years, skipping fill values."""
    out = []
    for month in range(1, 13):
        vals = [series.get(f"{y}{month:02d}") for y in range(years[0], years[1] + 1)]
        vals = [v for v in vals if v is not None and v != fill]
        out.append(sum(vals) / len(vals) if vals else None)
    return out


def _summary(t: list, p: list, s: list) -> dict:
    ok = all(v is not None for v in t + p + s)
    if not ok:
        return {"complete": False}
    season = [i for i in range(12) if t[i] >= GROWING_T_C]
    season_days = sum(DAYS[i] for i in season)
    par = [s[i] * PAR_FRACTION * PAR_MOL_PER_MJ for i in range(12)]
    return {
        "complete": True,
        "mean_temperature_c": round(sum(t[i] * DAYS[i] for i in range(12)) / sum(DAYS), 2),
        "annual_precipitation_mm": round(sum(p[i] * DAYS[i] for i in range(12)), 0),
        "mean_solar_mj_m2_day": round(sum(s[i] * DAYS[i] for i in range(12)) / sum(DAYS), 2),
        "growing_season_months": len(season),
        "growing_season_days": round(season_days),
        "growing_season_light_mol_m2_day": round(sum(par[i] * DAYS[i] for i in season) / season_days, 1) if season else None,
        "monthly_temperature_c": [round(v, 1) for v in t],
        "monthly_precipitation_mm": [round(p[i] * DAYS[i], 0) for i in range(12)],
        "monthly_light_mol_m2_day": [round(v, 1) for v in par],
    }


def climate(lat: float, lon: float) -> dict:
    data = _fetch(lat, lon)
    prm = data["properties"]["parameter"]
    fill = data["header"].get("fill_value", -999.0)
    early = _summary(*[_period(prm[k], EARLY, fill) for k in ("T2M", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN")])
    recent = _summary(*[_period(prm[k], RECENT, fill) for k in ("T2M", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN")])
    change = None
    if early.get("complete") and recent.get("complete"):
        change = {
            "temperature_c": round(recent["mean_temperature_c"] - early["mean_temperature_c"], 2),
            "precipitation_mm": round(recent["annual_precipitation_mm"] - early["annual_precipitation_mm"], 0),
            "precipitation_percent": round(100 * (recent["annual_precipitation_mm"] / max(early["annual_precipitation_mm"], 1e-6) - 1), 1),
            "growing_season_days": recent["growing_season_days"] - early["growing_season_days"],
        }
    return {
        "lat": lat, "lon": lon, "elevation_m": data["geometry"]["coordinates"][2],
        "periods": {"early": {"years": list(EARLY), **early}, "recent": {"years": list(RECENT), **recent}},
        "change": change, "kind": "observation",
        "conventions": {
            "growing_season": f"months whose mean air temperature is at least {GROWING_T_C:g} C",
            "light": f"surface solar energy x {PAR_FRACTION} (photosynthetically active share) x {PAR_MOL_PER_MJ} mol per MJ",
        },
        "source": {"title": "NASA POWER monthly and annual, agroclimatology community",
                   "url": "https://power.larc.nasa.gov/", "inputs": data["header"].get("sources"),
                   "note": "About half a degree of latitude and longitude per grid cell: a regional value, not a field measurement. "
                           "A difference between two decades is a description of the record, not a tested trend."},
    }
