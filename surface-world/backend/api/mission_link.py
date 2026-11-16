"""The link between the 3D world and the mission planned in the main map.

The main app plans a mission on the mission service (Go, port 8300): a base, science targets, a
route for each leg, keep-outs, and the check of that route against NASA's 1 m elevation model.
This module reads that mission and puts it in the 3D world's frame (x east, z south, metres from
the centre of the 2 km HiRISE map), so the world draws the same plan instead of a plan of its own.

Positions are converted from the longitude and latitude the mission service reports, with the same
orthographic projection the terrain was imported with. Nothing here plans or changes a mission.
"""
from __future__ import annotations

import json
import math
import os
import urllib.error
import urllib.request

from backend.geospatial.dem import latlon_to_local

MISSION_URL = os.environ.get("MISSION_URL", "http://127.0.0.1:8300")
SPACING_M = 5.0   # the route is planned on 20 m cells; points are added so the line follows 5 m terrain


class MissionUnavailable(Exception):
    """The mission service did not answer, or it has no such mission."""


def _get(path: str):
    try:
        with urllib.request.urlopen(f"{MISSION_URL}{path}", timeout=6) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise MissionUnavailable(f"mission service answered {e.code} for {path}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise MissionUnavailable(f"mission service not reachable at {MISSION_URL}") from e


def fetch(mission_id: str | None) -> tuple[dict, dict]:
    """The mission with this id, or the newest mission that has a plan. Also the mover profiles by key."""
    if mission_id:
        m = _get(f"/api/missions/{mission_id}")
    else:
        m = None
        for row in _get("/api/missions")[:8]:
            cand = _get(f"/api/missions/{row['ID']}")
            if cand.get("plan"):
                m = cand
                break
        if m is None:
            raise MissionUnavailable("no mission with a planned route yet: plan one in the main map first")
    try:
        profiles = {p["key"]: p for p in _get("/api/profiles")["profiles"]}
    except MissionUnavailable:
        profiles = {}
    return m, profiles


def _densify(pts: list[tuple[float, float]], spacing: float = SPACING_M) -> list[tuple[float, float]]:
    """The same polyline with extra points so no two neighbours are further apart than `spacing`."""
    if not pts:
        return []
    out = [pts[0]]
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        d = math.hypot(x1 - x0, z1 - z0)
        k = max(1, math.ceil(d / spacing))
        for i in range(1, k + 1):
            out.append((x0 + (x1 - x0) * i / k, z0 + (z1 - z0) * i / k))
    return out


def to_world(m: dict, region: dict, profiles: dict | None = None) -> dict:
    """The mission in the 3D world's frame. `region` is the `region` block of the terrain manifest."""
    lat0, lon0 = region["centre_lat_deg"], region["centre_lon_deg"]
    half = region["size_m"] / 2

    def local(lon: float, lat: float) -> tuple[float, float]:
        return latlon_to_local(lat, lon, lat0, lon0)

    def inside(x: float, z: float) -> bool:
        return abs(x) <= half and abs(z) <= half

    def site(s: dict) -> dict:
        x, z = local(s["lon"], s["lat"])
        return {"id": s.get("id", ""), "name": s.get("name", ""), "objective": s.get("objective", ""),
                "visited": bool(s.get("visited", False)), "x": round(x, 1), "z": round(z, 1), "inside": inside(x, z)}

    base = site(m["base"])
    targets = [site(t) for t in m.get("targets", [])]
    stops = [base] + targets

    plan = m.get("plan") or None
    fine = m.get("fine_check") or None
    # The 1 m check belongs to one revision of the plan; an older check says nothing about a newer route.
    fine_current = bool(plan and fine and fine.get("revision") == plan.get("revision"))
    stretches = fine.get("stretches", []) if fine_current else []

    legs, total, inside_m = [], 0.0, 0.0
    for leg in (plan or {}).get("legs", []):
        raw = [local(p["lon"], p["lat"]) for p in leg.get("points", [])]
        pts = _densify(raw)
        out, leg_len = [], 0.0
        for i, (x, z) in enumerate(pts):
            if i:
                step = math.hypot(x - pts[i - 1][0], z - pts[i - 1][1])
                leg_len += step
                if inside(x, z) and inside(*pts[i - 1]):
                    inside_m += step
            d = total + leg_len
            steep = any(s["start_m"] <= d <= s["end_m"] for s in stretches)
            out.append([round(x, 1), round(z, 1), 1 if steep else 0])
        end = pts[-1] if pts else (base["x"], base["z"])
        to = min(stops, key=lambda s: math.hypot(s["x"] - end[0], s["z"] - end[1]))["name"]
        legs.append({"to": to, "points": out, "distance_m": round(leg_len, 1),
                     "max_slope_deg": leg.get("max_slope_deg")})
        total += leg_len

    keep_outs = []
    for h in m.get("hazards", []):
        # Keep-outs carry the mission area's local x, y (metres east and north), not lon/lat. They are
        # placed by their offset from the base, whose lon/lat is known. The two frames are different map
        # projections, so this is approximate: within a few metres across the mission area (tested).
        ref = m["base"]
        x0, z0 = local(ref["lon"], ref["lat"])
        x, z = x0 + (h["x"] - ref["x"]), z0 - (h["y"] - ref["y"])
        keep_outs.append({"x": round(x, 1), "z": round(z, 1), "r": h.get("radius_m", 0.0),
                          "source": h.get("source", ""), "reason": h.get("reason", ""), "inside": inside(x, z)})

    steep = []
    for s in stretches:
        x, z = local(s["lon"], s["lat"])
        steep.append({"x": round(x, 1), "z": round(z, 1), "length_m": s["length_m"],
                      "max_slope_deg": s["max_slope_deg"], "inside": inside(x, z)})

    prof = (profiles or {}).get(m.get("mover", ""), {})
    sim = m.get("sim") or {}
    pos = None
    if "lon" in sim and "lat" in sim:
        px, pz = local(sim["lon"], sim["lat"])
        pos = {"x": round(px, 1), "z": round(pz, 1), "phase": sim.get("phase", "idle"), "inside": inside(px, pz)}
    feas = (plan or {}).get("feasibility") or {}
    return {
        "id": m.get("id", ""), "name": m.get("name", ""),
        "mover": m.get("mover", ""), "mover_name": prof.get("name", m.get("mover", "").replace("_", " ")),
        "mover_kind": prof.get("kind", ""), "limit_deg": prof.get("max_slope_deg"),
        "revision": (plan or {}).get("revision"), "planned": bool(plan),
        "base": base, "targets": targets, "legs": legs, "keep_outs": keep_outs, "steep": steep,
        "distance_m": round(total, 1), "inside_m": round(inside_m, 1),
        "seconds": (plan or {}).get("seconds"),
        "feasible": feas.get("ok"), "feasibility_reason": feas.get("reason", ""),
        "fine": None if not fine_current else {
            "clear": bool(fine.get("clear")), "stretches": len(stretches),
            "over_limit_m": fine.get("over_limit_m", 0.0), "limit_deg": fine.get("limit_deg"),
            "max_slope_deg": max((s["max_slope_deg"] for s in stretches), default=0.0),
            "rounds": fine.get("rounds", 0), "keep_outs": fine.get("keep_outs", 0),
            "summary": fine.get("summary", ""),
        },
        "position": pos,
        "world_half_m": half,
        "frame": "x east, z south, metres from the centre of the 2 km HiRISE map",
    }


WAYPOINT_M = 120.0   # the 5 m planner is asked to reach a point on the mission route this often
EDGE_MARGIN_M = 12.0


def drive_route(world_mission: dict, grid, start: tuple[float, float], plan_route, no_route: type[Exception]) -> dict:
    """A route the 3D world's rover can drive that follows the mission's first leg inside the 2 km map.

    The mission route was planned on 20 m cells and knows nothing of the rocks and 5 m slopes in this
    world. So the mission route is used as the way to go, and this world's own planner (5 m cells) is
    asked to reach a point on it every WAYPOINT_M metres. The pieces are joined into one route, with a
    measure of how far the driven line strays from the mission line. It stops at the edge of the 2 km
    map, at the first target inside it, or where the 5 m planner finds no way on.
    """
    legs = world_mission.get("legs") or []
    if not legs:
        raise no_route("the mission has no planned route yet")
    half = world_mission["world_half_m"] - EDGE_MARGIN_M
    line = []
    for x, z, _ in legs[0]["points"]:
        if abs(x) > half or abs(z) > half:
            break
        line.append((x, z))
    if len(line) < 2:
        raise no_route("the mission route does not start inside this 2 km map")
    left_map = len(line) < len(legs[0]["points"])

    # Waypoints along the mission line, by distance; the last point of the in-map part is always one.
    waypoints, acc = [], 0.0
    for a, b in zip(line, line[1:]):
        acc += math.hypot(b[0] - a[0], b[1] - a[1])
        if acc >= WAYPOINT_M:
            waypoints.append(b)
            acc = 0.0
    if not waypoints or waypoints[-1] != line[-1]:
        waypoints.append(line[-1])

    path: list[tuple[float, float, float]] = []
    segments: list[dict] = []
    total = {"distance_m": 0.0, "energy_wh": 0.0, "travel_time_s": 0.0, "elevation_gain_m": 0.0, "expanded_nodes": 0}
    max_slope, slope_weighted, stopped = 0.0, 0.0, None
    here = start
    for wp in waypoints:
        if math.hypot(wp[0] - here[0], wp[1] - here[1]) < 2.0:
            continue
        try:
            r = plan_route(grid, here, wp, "balanced", agent="rover")
        except no_route as e:
            stopped = f"the 5 m planner found no way on after {total['distance_m']:.0f} m: {e}"
            break
        offset = len(path) - (1 if path else 0)
        path.extend(r.path[1:] if path else r.path)
        for s in r.hazard_segments:
            segments.append({**s, "start": s["start"] + offset, "end": s["end"] + offset})
        for k in total:
            total[k] += getattr(r, k)
        max_slope = max(max_slope, r.max_slope_deg)
        slope_weighted += r.mean_slope_deg * r.distance_m
        here = (r.path[-1][0], r.path[-1][2])
    if len(path) < 2:
        raise no_route(stopped or "the rover is already at the end of the mission route inside this map")

    # How far the driven line is from the mission line (nearest mission point, 5 m spacing).
    dev = sorted(min(math.hypot(x - lx, z - lz) for lx, lz in line) for x, _, z in path[::3])
    median_dev, max_dev = dev[len(dev) // 2], dev[-1]

    ends = "at the edge of the 2 km map, where the mission route goes on to its targets" if left_map and not stopped \
        else (stopped if stopped else f"at {legs[0]['to']}")
    explanation = [
        f"This is the first leg of the mission planned in the main map (to {legs[0]['to']}), driven on this world's 5 m terrain.",
        f"The mission route was planned on 20 m cells; this world's planner reaches a point on it every {WAYPOINT_M:.0f} m and steers round rocks and steep 5 m cells between them.",
        f"The driven line stays within {median_dev:.0f} m of the mission line (median; {max_dev:.0f} m at most).",
        f"The drive ends {ends}.",
    ]
    return {
        "path": path, "distance_m": round(total["distance_m"], 1),
        "straight_line_m": round(math.hypot(path[-1][0] - path[0][0], path[-1][2] - path[0][2]), 1),
        "energy_wh": round(total["energy_wh"], 1), "max_slope_deg": round(max_slope, 1),
        "mean_slope_deg": round(slope_weighted / max(total["distance_m"], 1e-6), 1),
        "hazard_segments": segments, "hazards_avoided": [], "hazards_crossed": sorted({s["label"] for s in segments}),
        "mode": "balanced", "goal_adjusted": False, "explanation": explanation,
        "expanded_nodes": int(total["expanded_nodes"]), "agent": "rover",
        "travel_time_s": round(total["travel_time_s"], 1), "elevation_gain_m": round(total["elevation_gain_m"], 1), "o2_g": None,
        "mission": {"id": world_mission["id"], "leg_to": legs[0]["to"], "median_deviation_m": round(median_dev, 1),
                    "max_deviation_m": round(max_dev, 1), "left_map": left_map and not stopped, "stopped": stopped,
                    "mission_line_m": round(sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(line, line[1:])), 1)},
    }
