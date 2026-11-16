"""How similar is the Earth analog to the Mars site? Same metrics, same grid spacing, no arbitrary score.

Both regions are 2 km squares on a 5 m grid, so slope statistics compare directly. We report the numbers
side by side and say what they mean for EVA training; we do not collapse them into one similarity score.
"""
from __future__ import annotations

import numpy as np

from backend.geospatial.terrain import Terrain


def metrics(t: Terrain) -> dict:
    s = t.slope_deg()
    p50, p90, p99 = np.percentile(s, [50, 90, 99])
    return {
        "relief_m": round(float(t.heights.max() - t.heights.min()), 1),
        "slope_p50_deg": round(float(p50), 1),
        "slope_p90_deg": round(float(p90), 1),
        "slope_p99_deg": round(float(p99), 1),
        "share_over_15_deg": round(float((s > 15).mean()), 3),
        "share_over_20_deg": round(float((s > 20).mean()), 3),
        "cell_m": round(t.cell, 2),
    }


def compare(mars: Terrain, earth: Terrain) -> dict:
    m, e = metrics(mars), metrics(earth)
    harder = e["share_over_20_deg"] > m["share_over_20_deg"]
    return {
        "mars": m, "earth": e,
        "summary": (f"Similar relief ({m['relief_m']:.0f} m vs {e['relief_m']:.0f} m), but the Earth site is "
                    f"{'steeper' if harder else 'gentler'}: median slope {e['slope_p50_deg']} deg vs {m['slope_p50_deg']} deg, and "
                    f"{e['share_over_20_deg'] * 100:.1f}% of the ground is above an astronaut's 20 deg limit vs {m['share_over_20_deg'] * 100:.1f}% at Jezero. "
                    + ("As a training analog it is harder than the Mars site, so routes that work here have margin on Mars."
                       if harder else "As a training analog it is easier than the Mars site.")),
        "note": "Both maps: 2 km square, 5 m grid. Mars terrain: HiRISE DTM. Earth terrain: USGS 3DEP. No single similarity score is computed, on purpose.",
    }
