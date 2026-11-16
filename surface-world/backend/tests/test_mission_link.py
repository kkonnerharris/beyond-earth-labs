"""The mission link: a mission from the main map placed in the 3D world's frame."""
import math

import pytest

from backend.api import mission_link
from backend.geospatial import dem

pytestmark = pytest.mark.skipif(not dem.available(), reason="Jezero terrain not prepared")

# Positions reported by the mission service for one real mission (x, y in the mission area's frame).
BASE = {"id": "base", "name": "Octavia E. Butler Landing", "x": 3690.0, "y": -1210.0,
        "lon": 77.4506236100967, "lat": 18.4445752796396}
SCARP = {"id": "t1", "name": "Delta front scarp", "objective": "sample", "x": 1490.0, "y": -310.0,
         "lon": 77.41150076594815, "lat": 18.45976827139889, "visited": False}


def _line(a: dict, b: dict, n: int = 12) -> list[dict]:
    return [{"lon": a["lon"] + (b["lon"] - a["lon"]) * i / n, "lat": a["lat"] + (b["lat"] - a["lat"]) * i / n}
            for i in range(n + 1)]


def _mission(**extra) -> dict:
    m = {"id": "m1", "name": "Test", "mover": "crew_rover", "base": BASE, "targets": [SCARP], "hazards": [],
         "plan": {"revision": 3, "seconds": 5000.0, "feasibility": {"ok": True, "reason": "enough"},
                  "legs": [{"points": _line(BASE, SCARP), "max_slope_deg": 9.0},
                           {"points": _line(SCARP, BASE), "max_slope_deg": 9.0}]},
         "sim": {"lon": BASE["lon"], "lat": BASE["lat"], "phase": "idle"}}
    m.update(extra)
    return m


@pytest.fixture(scope="module")
def region() -> dict:
    return dem.manifest()["region"]


def test_base_is_the_landing_site_of_the_world(region):
    w = mission_link.to_world(_mission(), region)
    lx, lz = dem.latlon_to_local(*region["landing_site_lat_lon"], region["centre_lat_deg"], region["centre_lon_deg"])
    assert w["base"]["inside"]
    assert math.hypot(w["base"]["x"] - lx, w["base"]["z"] - lz) < 30   # the mission base is the same landing site


def test_target_west_of_the_map_is_marked_outside(region):
    w = mission_link.to_world(_mission(), region)
    t = w["targets"][0]
    assert not t["inside"] and t["x"] < -region["size_m"] / 2
    assert t["z"] < w["base"]["z"]   # the scarp is north of the landing site, and z points south


def test_route_is_densified_and_split_into_inside_and_outside(region):
    w = mission_link.to_world(_mission(), region)
    assert [leg["to"] for leg in w["legs"]] == ["Delta front scarp", "Octavia E. Butler Landing"]
    for leg in w["legs"]:
        pts = leg["points"]
        steps = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:])]
        assert max(steps) <= mission_link.SPACING_M + 0.2
    straight = math.hypot(w["targets"][0]["x"] - w["base"]["x"], w["targets"][0]["z"] - w["base"]["z"])
    assert w["distance_m"] == pytest.approx(2 * straight, rel=0.01)
    assert 0 < w["inside_m"] < w["distance_m"]


def test_steep_stretches_mark_route_points_only_for_the_current_plan(region):
    stretch = {"start_m": 100.0, "end_m": 140.0, "length_m": 40.0, "max_slope_deg": 31.0,
               "lon": BASE["lon"], "lat": BASE["lat"]}
    fine = {"revision": 3, "clear": False, "over_limit_m": 40.0, "limit_deg": 20.0, "stretches": [stretch], "summary": "s"}
    w = mission_link.to_world(_mission(fine_check=fine), region)
    flagged = sum(p[2] for p in w["legs"][0]["points"])
    assert 7 <= flagged <= 10   # 40 m of route at 5 m spacing
    assert w["fine"]["stretches"] == 1 and w["fine"]["max_slope_deg"] == 31.0 and len(w["steep"]) == 1

    stale = mission_link.to_world(_mission(fine_check={**fine, "revision": 2}), region)
    assert stale["fine"] is None and stale["steep"] == []
    assert sum(p[2] for leg in stale["legs"] for p in leg["points"]) == 0


def test_keep_out_placed_by_offset_agrees_with_lon_lat(region):
    hazard = {"id": "h1", "x": SCARP["x"], "y": SCARP["y"], "radius_m": 30.0, "reason": "steep", "source": "hirise_1m"}
    w = mission_link.to_world(_mission(hazards=[hazard]), region)
    k, t = w["keep_outs"][0], w["targets"][0]
    assert math.hypot(k["x"] - t["x"], k["z"] - t["z"]) < 5.0
    assert k["source"] == "hirise_1m" and k["r"] == 30.0


def test_unplanned_mission_has_no_legs(region):
    w = mission_link.to_world(_mission(plan=None), region)
    assert w["planned"] is False and w["legs"] == [] and w["distance_m"] == 0


def test_endpoint_reports_a_missing_mission_service(monkeypatch):
    from fastapi.testclient import TestClient
    from backend.api.main import app
    monkeypatch.setattr(mission_link, "MISSION_URL", "http://127.0.0.1:9")   # nothing listens here
    r = TestClient(app).get("/api/mission?id=nope")
    assert r.status_code == 404 and "mission service" in r.json()["detail"]


def test_drive_route_follows_the_mission_line_on_the_5m_planner(region):
    from backend.api.main import world
    from backend.pathfinding.planner import NoRoute, plan_route
    _, g = world("jezero")
    wm = mission_link.to_world(_mission(), region)
    start = (wm["base"]["x"] + 20.0, wm["base"]["z"])
    try:
        r = mission_link.drive_route(wm, g, start, plan_route, NoRoute)
    except NoRoute as e:
        pytest.skip(f"no drivable way along this straight test line: {e}")
    assert len(r["path"]) > 20 and r["distance_m"] > 100
    steps = [math.hypot(b[0] - a[0], b[2] - a[2]) for a, b in zip(r["path"], r["path"][1:])]
    assert max(steps) < 12   # the joined pieces leave no gap
    for s in r["hazard_segments"]:
        assert 0 <= s["start"] <= s["end"] < len(r["path"])
    assert r["mission"]["median_deviation_m"] <= r["mission"]["max_deviation_m"]
    half = region["size_m"] / 2
    assert all(abs(x) <= half and abs(z) <= half for x, _, z in r["path"])


def test_drive_route_refuses_a_mission_without_a_plan(region):
    from backend.pathfinding.planner import NoRoute, plan_route
    wm = mission_link.to_world(_mission(plan=None), region)
    with pytest.raises(NoRoute):
        mission_link.drive_route(wm, None, (0.0, 0.0), plan_route, NoRoute)
