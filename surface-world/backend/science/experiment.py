"""Experiment: would our route planner have driven where Perseverance drove?

Hypothesis
    If the planner's cost model (slope + measured 1 m roughness from the HiRISE DTM) captures what
    matters for driving on Jezero's floor, then for the same start and end points its routes will
    stay close to the drives NASA's rover planners actually commanded.

Method
    For every Perseverance drive that lies wholly inside the map and is at least 25 m long, plan an
    A* route between the drive's real start and end, in each risk mode (fast, balanced, safe). Compare
    each plan with the real drive:
      * mean deviation: average distance from the planned path to the real path (m)
      * corridor agreement: share of the planned path within 10 m (two grid cells) of the real path
      * length ratio: planned length / real length
      * max slope and mean roughness along each path (same grids for both)
    Then ask which risk weighting explains the real drives best (lowest median deviation).

Limits (stated in the results)
    Real drives also serve science targets, instrument placement, communication windows and
    hazards smaller than our 5 m grid, so we do not expect a perfect match. The planner knows none of
    those. A close match on most drives would mean terrain alone explains much of the real routing.
"""
from __future__ import annotations

import math
from statistics import median

import numpy as np

from backend.geospatial.terrain import Terrain
from backend.pathfinding.planner import CostGrid, NoRoute, plan_route

MODES = ("fast", "balanced", "safe")
CORRIDOR_M = 10.0
MIN_DRIVE_M = 25.0


def _seg_dist(px: float, pz: float, ax: float, az: float, bx: float, bz: float) -> float:
    vx, vz = bx - ax, bz - az
    L2 = vx * vx + vz * vz
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * vx + (pz - az) * vz) / L2))
    return math.hypot(px - (ax + t * vx), pz - (az + t * vz))


def _dist_to_path(px: float, pz: float, path: list[tuple[float, float]]) -> float:
    return min(_seg_dist(px, pz, *path[i], *path[i + 1]) for i in range(len(path) - 1))


def _resample(path: list[tuple[float, float]], step: float = 2.5) -> list[tuple[float, float]]:
    out = [path[0]]
    for (ax, az), (bx, bz) in zip(path, path[1:]):
        d = math.hypot(bx - ax, bz - az)
        n = max(1, int(d / step))
        out += [(ax + (bx - ax) * k / n, az + (bz - az) * k / n) for k in range(1, n + 1)]
    return out


def _length(path: list[tuple[float, float]]) -> float:
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(path, path[1:]))


def _sample(grid: np.ndarray, t: Terrain, pts: list[tuple[float, float]]) -> list[float]:
    out = []
    for x, z in pts:
        r, c = t.to_grid(x, z)
        out.append(float(grid[min(t.n - 1, max(0, int(round(r)))), min(t.n - 1, max(0, int(round(c))))]))
    return out


def run(t: Terrain, g: CostGrid, drives: list[dict]) -> dict:
    rough = t.roughness if t.roughness is not None else np.zeros_like(t.heights)
    cases, seen = [], set()
    for d in drives:   # the published traverse repeats some drives under consecutive sols; count each path once
        key = (round(d["path"][0][0]), round(d["path"][0][1]), round(d["path"][-1][0]), round(d["path"][-1][1]), round(d["length_m"]))
        if d.get("inside") and d["length_m"] >= MIN_DRIVE_M and len(d["path"]) >= 2 and key not in seen:
            seen.add(key)
            cases.append(d)
    results = []
    for d in cases:
        real = [tuple(p) for p in d["path"]]
        real_pts = _resample(real)
        row = {"sol": d["sol"], "from": d.get("from"), "to": d.get("to"), "real_length_m": round(_length(real), 1),
               "real_max_slope": round(max(_sample(g.slope, t, real_pts)), 1),
               "real_mean_roughness": round(float(np.mean(_sample(rough, t, real_pts))), 3),
               "real_path": [[round(x, 1), round(z, 1)] for x, z in real], "plans": {}}
        for mode in MODES:
            try:
                r = plan_route(g, real[0], real[-1], mode)
            except NoRoute as e:
                row["plans"][mode] = {"error": str(e)}
                continue
            planned = [(x, z) for x, _, z in r.path]
            pp = _resample(planned)
            dev = [_dist_to_path(x, z, real) for x, z in pp]
            row["plans"][mode] = {
                "length_m": round(_length(planned), 1),
                "length_ratio": round(_length(planned) / max(1e-6, _length(real)), 3),
                "mean_deviation_m": round(float(np.mean(dev)), 2),
                "corridor_agreement": round(float(np.mean([v <= CORRIDOR_M for v in dev])), 3),
                "max_slope": round(max(_sample(g.slope, t, pp)), 1),
                "mean_roughness": round(float(np.mean(_sample(rough, t, pp))), 3),
                "path": [[round(x, 1), round(z, 1)] for x, z in planned],
            }
        results.append(row)

    summary = {}
    for mode in MODES:
        ok = [r["plans"][mode] for r in results if "error" not in r["plans"].get(mode, {"error": 1})]
        if not ok:
            continue
        summary[mode] = {
            "drives": len(ok),
            "median_deviation_m": round(median(p["mean_deviation_m"] for p in ok), 2),
            "median_corridor_agreement": round(median(p["corridor_agreement"] for p in ok), 3),
            "share_within_10m": round(sum(p["mean_deviation_m"] <= CORRIDOR_M for p in ok) / len(ok), 3),
            "median_length_ratio": round(median(p["length_ratio"] for p in ok), 3),
            "median_mean_roughness": round(median(p["mean_roughness"] for p in ok), 3),
        }
    real_rough = median(r["real_mean_roughness"] for r in results) if results else None
    best = min(summary, key=lambda m: summary[m]["median_deviation_m"]) if summary else None
    # Baseline: a straight line between the same endpoints, so "close to the real drive" means something.
    base = []
    for r in results:
        real = [tuple(p) for p in r["real_path"]]
        line = _resample([real[0], real[-1]])
        r["straight_line_deviation_m"] = round(float(np.mean([_dist_to_path(x, z, real) for x, z in line])), 2)
        base.append(r["straight_line_deviation_m"])
    # The drives that tell us something: where Perseverance did NOT go straight (> 5 m off the line).
    det = [r for r in results if r["straight_line_deviation_m"] > 5 and "error" not in r["plans"].get(best or "", {"error": 1})]
    detours = {
        "threshold_m": 5.0,
        "drives": len(det),
        "planner_closer": sum(r["plans"][best]["mean_deviation_m"] < r["straight_line_deviation_m"] for r in det),
        "median_planner_deviation_m": round(median(r["plans"][best]["mean_deviation_m"] for r in det), 2) if det else None,
        "median_straight_deviation_m": round(median(r["straight_line_deviation_m"] for r in det), 2) if det else None,
    }
    real_slopes = [r["real_max_slope"] for r in results]
    return {
        "hypothesis": "A planner that sees only slope and measured roughness will route close to the drives NASA actually commanded.",
        "method": f"{len(results)} real drives (>= {MIN_DRIVE_M:.0f} m, wholly on the map); A* between each drive's real endpoints in 3 risk modes; "
                  f"deviation from the real path, share within {CORRIDOR_M:.0f} m, length ratio; straight-line baseline.",
        "n_drives": len(results),
        "summary": summary,
        "best_mode": best,
        "real_median_mean_roughness": real_rough,
        "straight_line_median_deviation_m": round(median(base), 2) if base else None,
        "detours": detours,
        "real_max_slope_overall": max(real_slopes) if real_slopes else None,
        "real_median_max_slope": round(median(real_slopes), 1) if real_slopes else None,
        "findings": [
            f"On most drives the rover went nearly straight, and so did the planner: median deviation {summary[best]['median_deviation_m'] if best else '?'} m, "
            f"against {round(median(base), 2) if base else '?'} m for a straight line. On this smooth crater floor, terrain alone adds little to a straight line.",
            f"Where Perseverance detoured (> 5 m off the straight line, {detours['drives']} drives), the terrain-only planner was closer to the real route "
            f"than a straight line in {detours['planner_closer']} of {detours['drives']} (median {detours['median_planner_deviation_m']} m vs {detours['median_straight_deviation_m']} m).",
            f"Perseverance never drove anything steeper than {max(real_slopes) if real_slopes else '?'} deg on the 5 m HiRISE slope map (median of each drive's steepest point: "
            f"{round(median(real_slopes), 1) if real_slopes else '?'} deg). Real operations keep a wide margin below the engineering limit, so a planner tuned for safety "
            "should treat even moderate slopes as costly.",
        ],
        "limits": "Real drives also serve science targets, instrument placement and hazards smaller than the 5 m grid, which the planner cannot see.",
        "drives": results,
    }
