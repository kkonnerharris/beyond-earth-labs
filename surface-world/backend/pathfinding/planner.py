"""Traversability grid + A* route planner.

Deterministic: the same terrain, start, goal and mode always produce the same route.

Cost of stepping between neighbouring cells:
    step = distance * (1 + w_slope * (slope / max_slope)^2 + w_hazard * hazard_penalty + w_rock * rock_density)
Cells are impassable when slope > rover max slope, or within (rock radius + rover radius) of a
large rock, or outside the map margin. The heuristic is straight-line distance, which never
overestimates (all multipliers are >= 1), so A* returns the optimal path for the chosen weights.
"""
from __future__ import annotations

import heapq
import math
from dataclasses import dataclass

import numpy as np

from backend.geospatial.terrain import Terrain
from backend.simulation.astronaut_model import ASTRONAUT, segment_o2_g
from backend.simulation.rover_model import ROVER, RoverParams, segment_energy_wh

MODES = {
    # w_slope, w_hazard, w_rock: how strongly each factor is avoided
    "fast": (0.6, 0.2, 0.3),
    "balanced": (3.0, 1.0, 1.0),
    "safe": (9.0, 4.0, 3.0),
}
LARGE_ROCK_M = 0.8   # rocks at least this big are obstacles; smaller ones only add cost


@dataclass
class CostGrid:
    terrain: Terrain
    slope: np.ndarray          # degrees
    hazard: np.ndarray         # summed hazard penalty per cell
    hazard_kind: np.ndarray    # dominant hazard kind index per cell (-1 none)
    rock_density: np.ndarray   # 0..1
    blocked: np.ndarray        # bool
    kinds: list[str]
    max_slope_deg: float = ROVER.max_slope_deg


def build_cost_grid(t: Terrain, p: RoverParams = ROVER, max_slope_deg: float | None = None, radius_m: float | None = None) -> CostGrid:
    """Cost grid for an agent. Defaults are the rover; pass the astronaut's slope limit and radius for EVA planning."""
    max_slope = p.max_slope_deg if max_slope_deg is None else max_slope_deg
    radius = p.radius_m if radius_m is None else radius_m
    n = t.n
    slope = t.slope_deg()
    xs = np.linspace(-t.size_m / 2, t.size_m / 2, n)
    X, Z = np.meshgrid(xs, xs)

    kinds = sorted({h.kind for h in t.hazards} | ({"rough_terrain"} if t.roughness is not None else set()))
    hazard = np.zeros((n, n), dtype=np.float32)
    kind_idx = np.full((n, n), -1, dtype=np.int8)
    best = np.zeros((n, n), dtype=np.float32)
    for h in t.hazards:
        d = np.hypot(X - h.x, Z - h.z) / h.r
        w = np.clip(1 - d, 0, 1) ** 0.5 * h.penalty   # strongest at the centre, fading to the edge
        hazard += w
        stronger = w > best
        kind_idx[stronger & (w > 0)] = kinds.index(h.kind)
        best = np.maximum(best, w)

    if t.roughness is not None:   # measured from a real DEM's fine-scale slope
        w = (t.roughness * t.roughness_penalty).astype(np.float32)
        hazard += w
        kind_idx[(w > best) & (w > 0.3)] = kinds.index("rough_terrain")
        best = np.maximum(best, w)

    rock_density = np.zeros((n, n), dtype=np.float32)
    blocked = slope > max_slope
    margin = 6.0
    blocked |= (np.abs(X) > t.size_m / 2 - margin) | (np.abs(Z) > t.size_m / 2 - margin)
    cell = t.cell
    for r in t.rocks:
        r0, c0 = t.to_grid(r.x, r.z)
        reach = int(math.ceil((r.r + radius + 6) / cell))
        i0, i1 = max(0, int(r0) - reach), min(n, int(r0) + reach + 2)
        j0, j1 = max(0, int(c0) - reach), min(n, int(c0) + reach + 2)
        d = np.hypot(X[i0:i1, j0:j1] - r.x, Z[i0:i1, j0:j1] - r.z)
        rock_density[i0:i1, j0:j1] += np.clip(1 - d / (r.r + 6), 0, 1) * min(1.0, r.r / 2)
        if r.r >= LARGE_ROCK_M:
            blocked[i0:i1, j0:j1] |= d < (r.r + radius)
    rock_density = np.clip(rock_density, 0, 1)
    return CostGrid(t, slope, hazard, kind_idx, rock_density, blocked, kinds, max_slope)


@dataclass
class RouteResult:
    path: list[tuple[float, float, float]]      # world x, y, z
    distance_m: float
    straight_line_m: float
    energy_wh: float
    max_slope_deg: float
    mean_slope_deg: float
    hazard_segments: list[dict]                 # {start, end, kind, label}
    hazards_avoided: list[str]
    hazards_crossed: list[str]
    mode: str
    goal_adjusted: bool
    explanation: list[str]
    expanded_nodes: int
    agent: str = 'rover'
    travel_time_s: float = 0.0
    elevation_gain_m: float = 0.0
    o2_g: float | None = None


class NoRoute(Exception):
    pass


def _nearest_free(g: CostGrid, r: int, c: int, max_radius: int = 8) -> tuple[int, int] | None:
    n = g.terrain.n
    if 0 <= r < n and 0 <= c < n and not g.blocked[r, c]:
        return r, c
    for rad in range(1, max_radius + 1):
        best = None
        for dr in range(-rad, rad + 1):
            for dc in range(-rad, rad + 1):
                rr, cc = r + dr, c + dc
                if 0 <= rr < n and 0 <= cc < n and not g.blocked[rr, cc]:
                    d = dr * dr + dc * dc
                    if best is None or d < best[0]:
                        best = (d, rr, cc)
        if best:
            return best[1], best[2]
    return None


def plan_route(g: CostGrid, start: tuple[float, float], goal: tuple[float, float], mode: str = "balanced",
               p: RoverParams = ROVER, agent: str = "rover") -> RouteResult:
    if mode not in MODES:
        raise ValueError(f"unknown mode '{mode}'")
    t = g.terrain
    if not t.in_bounds(*start) or not t.in_bounds(*goal):
        raise NoRoute("start or goal is outside the map")
    ws, wh, wr = MODES[mode]
    n = t.n
    cell = t.cell

    sr, sc = (int(round(v)) for v in t.to_grid(*start))
    gr0, gc0 = (int(round(v)) for v in t.to_grid(*goal))
    s = _nearest_free(g, sr, sc)
    gl = _nearest_free(g, gr0, gc0)
    if s is None:
        raise NoRoute("the start position is not traversable")
    if gl is None:
        raise NoRoute("the destination is not reachable: too steep or blocked by rocks")
    goal_adjusted = gl != (gr0, gc0)

    # Per-cell multiplier, precomputed for this mode.
    mult = 1.0 + ws * (g.slope / g.max_slope_deg) ** 2 + wh * g.hazard + wr * g.rock_density
    heights = t.heights

    nbrs = [(-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
            (-1, -1, math.sqrt(2)), (-1, 1, math.sqrt(2)), (1, -1, math.sqrt(2)), (1, 1, math.sqrt(2))]
    INF = float("inf")
    gscore = np.full((n, n), INF)
    parent = np.full((n, n, 2), -1, dtype=np.int32)
    gscore[s] = 0.0
    gr, gc = gl
    def h(r: int, c: int) -> float:
        return math.hypot(r - gr, c - gc) * cell
    heap = [(h(*s), 0.0, s[0], s[1])]
    closed = np.zeros((n, n), dtype=bool)
    expanded = 0
    while heap:
        f, gs, r, c = heapq.heappop(heap)
        if closed[r, c]:
            continue
        closed[r, c] = True
        expanded += 1
        if (r, c) == gl:
            break
        for dr, dc, k in nbrs:
            rr, cc = r + dr, c + dc
            if not (0 <= rr < n and 0 <= cc < n) or closed[rr, cc] or g.blocked[rr, cc]:
                continue
            if dr and dc and (g.blocked[r + dr, c] or g.blocked[r, c + dc]):
                continue  # no corner cutting past obstacles
            dist = k * cell
            dh = float(heights[rr, cc] - heights[r, c])
            d3 = math.hypot(dist, dh)
            step = d3 * 0.5 * (mult[r, c] + mult[rr, cc])
            ng = gs + step
            if ng < gscore[rr, cc]:
                gscore[rr, cc] = ng
                parent[rr, cc] = (r, c)
                heapq.heappush(heap, (ng + h(rr, cc), ng, rr, cc))
    if not closed[gl]:
        raise NoRoute("no traversable route connects the start to the destination for this agent")

    # Reconstruct
    cells = [gl]
    while cells[-1] != s:
        pr, pc = parent[cells[-1]]
        cells.append((int(pr), int(pc)))
    cells.reverse()

    path, dist_total, energy, slopes, gain, o2 = [], 0.0, 0.0, [], 0.0, 0.0
    seg_kinds: list[str | None] = []
    for i, (r, c) in enumerate(cells):
        x, z = t.to_world(r, c)
        y = float(heights[r, c])
        path.append((round(x, 2), round(y, 3), round(z, 2)))
        slopes.append(float(g.slope[r, c]))
        kind = None
        if g.hazard_kind[r, c] >= 0 and g.hazard[r, c] > 0.15:
            kind = g.kinds[g.hazard_kind[r, c]]
        elif g.slope[r, c] > 15:
            kind = "steep_slope"
        elif g.rock_density[r, c] > 0.35:
            kind = "rock_field"
        seg_kinds.append(kind)
        if i:
            px, py, pz = path[i - 1]
            d = math.hypot(x - px, z - pz)
            dh = y - py
            dist_total += math.hypot(d, dh)
            tf = 1.0
            if kind == "loose_regolith":
                tf = p.sand_energy_factor
            elif kind in ("rock_field", "rough_terrain"):
                tf = p.rock_energy_factor
            energy += segment_energy_wh(math.hypot(d, dh), dh, tf, p)
            o2 += segment_o2_g(math.hypot(d, dh), dh)
            gain += max(0.0, dh)

    hazard_segments = []
    i = 0
    labels = {"loose_regolith": "Loose regolith", "rock_field": "Rocky ground", "steep_slope": "Steep slope (>15°)",
              "dust_devil_track": "Dust devil track", "rough_terrain": "Rough ground (measured slope)"}
    while i < len(seg_kinds):
        if seg_kinds[i]:
            j = i
            while j + 1 < len(seg_kinds) and seg_kinds[j + 1] == seg_kinds[i]:
                j += 1
            if j > i:
                hazard_segments.append({"start": i, "end": j, "kind": seg_kinds[i], "label": labels.get(seg_kinds[i], seg_kinds[i])})
            i = j + 1
        else:
            i += 1

    # Which hazard zones did the straight line cross, and did the route avoid them?
    straight = math.hypot(goal[0] - start[0], goal[1] - start[1])
    def crosses(hz, pts) -> bool:
        return any(math.hypot(px - hz.x, pz - hz.z) < hz.r * 0.8 for px, pz in pts)
    line_pts = [(start[0] + (goal[0] - start[0]) * k / 60, start[1] + (goal[1] - start[1]) * k / 60) for k in range(61)]
    route_pts = [(x, z) for x, _, z in path]
    avoided = [hz.label for hz in t.hazards if crosses(hz, line_pts) and not crosses(hz, route_pts)]
    crossed = [hz.label for hz in t.hazards if crosses(hz, route_pts)]

    max_slope = max(slopes) if slopes else 0.0
    mean_slope = float(np.mean(slopes)) if slopes else 0.0
    mode_text = {"fast": "Shortest practical route: distance weighted most, hazards only lightly.",
                 "balanced": "Balanced route: trades extra distance against slope, hazards and rocks.",
                 "safe": "Lowest-risk route: strongly avoids slopes, hazard zones and rocks, even if longer."}[mode]
    expl = [mode_text,
            f"Route is {dist_total:.0f} m against {straight:.0f} m in a straight line ({(dist_total / max(straight, 1) - 1) * 100:.0f}% longer).",
            f"Steepest point {max_slope:.1f}° ({agent} limit in this model: {g.max_slope_deg:.0f}°); average {mean_slope:.1f}°."]
    if avoided:
        expl.append("Detours around: " + ", ".join(avoided) + ".")
    if crossed:
        expl.append("Still passes through: " + ", ".join(crossed) + " (highlighted on the route).")
    if agent == "astronaut":
        expl.append(f"Estimated suit oxygen {o2:.0f} g one way at {ASTRONAUT.walk_speed_mps} m/s (simulation model: metabolic rate from walking and climbing).")
    else:
        expl.append(f"Estimated energy {energy:.0f} Wh (simulation model: driving cost × terrain factor + climbing work).")
    if goal_adjusted:
        expl.append("The exact destination was not traversable, so the route ends at the nearest reachable point.")

    return RouteResult(path=path, distance_m=round(dist_total, 1), straight_line_m=round(straight, 1), energy_wh=round(energy, 1),
                       max_slope_deg=round(max_slope, 1), mean_slope_deg=round(mean_slope, 1), hazard_segments=hazard_segments,
                       hazards_avoided=avoided, hazards_crossed=crossed, mode=mode, goal_adjusted=goal_adjusted,
                       explanation=expl, expanded_nodes=expanded, agent=agent,
                       travel_time_s=round(dist_total / (ASTRONAUT.walk_speed_mps if agent == 'astronaut' else p.max_speed_mps * 0.85), 1),
                       elevation_gain_m=round(gain, 1), o2_g=round(o2, 1) if agent == 'astronaut' else None)
