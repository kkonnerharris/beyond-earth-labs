import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app, world
from backend.geospatial.terrain import generate_procedural
from backend.pathfinding.planner import LARGE_ROCK_M, NoRoute, build_cost_grid, plan_route
from backend.simulation.rover_model import ROVER, segment_energy_wh


@pytest.fixture(scope="module")
def w():
    t = generate_procedural(seed=7)
    return t, build_cost_grid(t)


# ---------------------------------------------------------------- terrain
def test_terrain_is_deterministic():
    a, b = generate_procedural(seed=7), generate_procedural(seed=7)
    assert np.array_equal(a.heights, b.heights)
    assert [(r.x, r.z) for r in a.rocks] == [(r.x, r.z) for r in b.rocks]


def test_different_seed_differs():
    assert not np.array_equal(generate_procedural(seed=7).heights, generate_procedural(seed=8).heights)


def test_terrain_has_real_relief_not_a_flat_plane(w):
    t, g = w
    assert t.heights.max() - t.heights.min() > 20          # craters, ridge
    assert g.slope.max() > ROVER.max_slope_deg            # some impassable terrain exists
    assert np.median(g.slope) < 10                        # but most ground is drivable


def test_height_sampling_matches_grid_vertices(w):
    t, _ = w
    for r, c in [(0, 0), (10, 20), (120, 120), (240, 3)]:
        x, z = t.to_world(r, c)
        assert t.height_at(x, z) == pytest.approx(float(t.heights[r, c]), abs=1e-3)


def test_habitat_pad_is_flat(w):
    t, g = w
    r, c = (int(round(v)) for v in t.to_grid(*t.habitat))
    assert g.slope[r - 3:r + 4, c - 3:c + 4].max() < 3


def test_provenance_says_procedural(w):
    t, _ = w
    assert t.provenance.kind == "procedural" and "Not a real location" in t.provenance.note


# ---------------------------------------------------------------- cost grid
def test_steep_cells_and_big_rocks_are_blocked(w):
    t, g = w
    assert g.blocked[g.slope > ROVER.max_slope_deg].all()
    big = next(r for r in t.rocks if r.r >= 1.2)
    rr, cc = (int(round(v)) for v in t.to_grid(big.x, big.z))
    assert g.blocked[rr, cc]


# ---------------------------------------------------------------- A*
def test_route_is_repeatable(w):
    t, g = w
    a = plan_route(g, t.habitat, (210, -120), "balanced")
    b = plan_route(g, t.habitat, (210, -120), "balanced")
    assert a.path == b.path and a.energy_wh == b.energy_wh


def test_route_never_enters_blocked_cells(w):
    t, g = w
    for goal in [(150, 70), (-175, 55), (40, -170)]:
        r = plan_route(g, t.habitat, goal, "fast")
        for x, _, z in r.path:
            rr, cc = (int(round(v)) for v in t.to_grid(x, z))
            assert not g.blocked[rr, cc]


def test_route_endpoints_and_length(w):
    t, g = w
    r = plan_route(g, t.habitat, (-20, 190), "balanced")
    sx, _, sz = r.path[0]
    ex, _, ez = r.path[-1]
    assert math.hypot(sx - t.habitat[0], sz - t.habitat[1]) < 3
    assert math.hypot(ex + 20, ez - 190) < 3
    assert r.distance_m >= r.straight_line_m


def test_crater_floor_only_reachable_via_ramp(w):
    t, g = w
    r = plan_route(g, t.habitat, (150, 70), "balanced")
    assert r.max_slope_deg <= ROVER.max_slope_deg
    # the route must pass close to the breached west rim
    assert any(math.hypot(x - 85, z - 55) < 25 for x, _, z in r.path)


def test_safe_mode_trades_distance_for_lower_exposure(w):
    t, g = w
    fast = plan_route(g, t.habitat, (-175, 55), "fast")
    safe = plan_route(g, t.habitat, (-175, 55), "safe")
    assert safe.distance_m > fast.distance_m

    def sand_cells(route):
        return sum(1 for x, _, z in route.path if math.hypot(x + 150, z - 40) < 60)
    assert sand_cells(safe) < sand_cells(fast)


def test_unreachable_goal_is_reported(w):
    t, g = w
    with pytest.raises(NoRoute):
        plan_route(g, t.habitat, (900, 900), "balanced")


def test_unknown_mode_rejected(w):
    t, g = w
    with pytest.raises(ValueError):
        plan_route(g, t.habitat, (0, 0), "reckless")


def test_explanation_mentions_distance_and_energy(w):
    t, g = w
    r = plan_route(g, t.habitat, (210, -120), "safe")
    text = " ".join(r.explanation)
    assert "Lowest-risk" in text and "Wh" in text and "straight line" in text


# ---------------------------------------------------------------- energy model
def test_energy_model():
    flat = segment_energy_wh(100, 0)
    assert flat == pytest.approx(100 * ROVER.flat_wh_per_m)
    assert segment_energy_wh(100, 10) > flat               # climbing costs more
    assert segment_energy_wh(100, 0, terrain_factor=1.6) > flat
    assert segment_energy_wh(0, 0) == 0


# ---------------------------------------------------------------- API
def test_api_terrain_and_route():
    c = TestClient(app)
    t = c.get("/api/terrain", params={"region": "procedural"}).json()
    import base64
    heights = np.frombuffer(base64.b64decode(t["heights_b64"]), dtype="<f4")
    assert heights.size == t["n"] ** 2
    assert t["provenance"]["kind"] == "procedural"
    r = c.post("/api/route", json={"start": t["habitat"], "goal": [210, -120], "mode": "safe", "region": "procedural"})
    assert r.status_code == 200 and r.json()["distance_m"] > 0
    assert c.post("/api/route", json={"start": [0, 0], "goal": [5000, 0]}).status_code == 422
    assert c.post("/api/route", json={"start": [0, 0], "goal": [1, 1], "mode": "yolo"}).status_code == 422


# ----------------------------------------------------------------------------- real NASA terrain
import pytest

from backend.geospatial import dem

needs_jezero = pytest.mark.skipif(not dem.available(), reason="run scripts/import_mars_data.py first")


@needs_jezero
def test_jezero_terrain_is_real_and_validated():
    m = dem.manifest()
    reg = m["region"]
    assert set(m["sources"]) >= {"hirise_dtm", "hirise_ortho", "ctx_dtm"}
    usgs = [m["sources"][k] for k in ("hirise_dtm", "hirise_ortho", "ctx_dtm")]
    assert all(s["doi"].startswith("https://doi.org/10.5066/") for s in usgs)
    assert reg["hirise_coverage"] > 0.99
    assert abs(reg["hirise_minus_ctx_median_m"]) < 2.0          # independent instruments agree
    assert -2700 < reg["elevation_min_m"] < reg["elevation_max_m"] < -2300   # Jezero floor is ~2.5 km below datum
    t = dem.load_jezero()
    assert t.provenance.kind == "dem" and t.n == reg["grid_n"]
    assert np.isfinite(t.heights).all()


@needs_jezero
def test_projection_round_trip_and_landing_site():
    reg = dem.manifest()["region"]
    lat0, lon0 = reg["centre_lat_deg"], reg["centre_lon_deg"]
    x, z = dem.latlon_to_local(18.4447, 77.4508, lat0, lon0)
    assert abs(x - 600) < 2 and abs(z - 500) < 2                # landing site offset used by the import
    lat, lon = dem.local_to_latlon(x, z, lat0, lon0)
    assert abs(lat - 18.4447) < 1e-7 and abs(lon - 77.4508) < 1e-7


@needs_jezero
def test_jezero_routes_reach_real_sites():
    t = dem.load_jezero()
    g = build_cost_grid(t)
    assert all(r.r < LARGE_ROCK_M for r in t.rocks)              # illustrative rocks never block a route
    site = next(s for s in t.sites if s.id == "site-perseverance")
    assert not site.simulated
    r = plan_route(g, t.habitat, (site.x, site.z), "balanced")
    assert r.distance_m >= r.straight_line_m and r.max_slope_deg <= g.max_slope_deg


@needs_jezero
def test_api_jezero_region():
    c = TestClient(app)
    t = c.get("/api/terrain", params={"region": "jezero"}).json()
    assert t["region"] == "jezero" and t["provenance"]["kind"] == "dem"
    assert t["real"]["region"]["landing_site_lat_lon"] == [18.4447, 77.4508]
    r = c.post("/api/route", json={"start": t["habitat"], "goal": [55, -240], "agent": "astronaut", "region": "jezero"})
    assert r.status_code == 200 and r.json()["o2_g"] > 0


@needs_jezero
def test_mars2020_paths_line_up_with_the_terrain():
    m20 = dem.m20_paths()
    if m20 is None:
        pytest.skip("run scripts/import_m20_paths.py")
    assert m20["drives"] and m20["stops"] and m20["flights"]
    # Perseverance is localized on the same HiRISE basemap: its recorded elevations should match our terrain
    assert abs(m20["summary"]["dtm_minus_rover_elev_median_m"]) < 0.5
    t = dem.load_jezero()
    assert any(s.id == "site-wright-brothers" and not s.simulated for s in t.sites)


@needs_jezero
def test_perseverance_experiment_is_honest_and_reproducible():
    if dem.m20_paths() is None:
        pytest.skip("run scripts/import_m20_paths.py")
    c = TestClient(app)
    r = c.get("/api/experiment").json()
    assert r["n_drives"] >= 20 and r["best_mode"] in ("fast", "balanced", "safe")
    assert r["straight_line_median_deviation_m"] is not None          # the baseline is always reported
    det = r["detours"]
    assert 0 <= det["planner_closer"] <= det["drives"]
    assert all(d["plans"][r["best_mode"]]["length_ratio"] > 0.3 for d in r["drives"])
    assert len(r["findings"]) == 3 and r["limits"]


# ----------------------------------------------------------------------------- Earth analog
from backend.geospatial import earth

needs_earth = pytest.mark.skipif(not earth.available(), reason="run scripts/import_earth.py first")


@needs_earth
def test_earth_analog_terrain_and_orbit_check():
    reg = earth.manifest()["region"]
    assert reg["planet"] == "earth" and 100 < reg["elevation_min_m"] < reg["elevation_max_m"] < 400   # Shawnee hills
    # NASADEM sits above the ground model over forest (radar partly sees the canopy), but not absurdly
    assert 0 < reg["nasadem_minus_3dep_median_m"] < 25
    t = earth.load_shawnee()
    assert t.provenance.kind == "dem" and np.isfinite(t.heights).all()


@needs_earth
def test_earth_foot_route_respects_slope_limit():
    t = earth.load_shawnee()
    g = build_cost_grid(t, max_slope_deg=20, radius_m=0.5)
    top = next(s for s in t.sites if s.id == "site-high")
    r = plan_route(g, t.habitat, (top.x, top.z), "balanced", agent="astronaut")
    assert r.max_slope_deg <= 20 and r.distance_m >= r.straight_line_m


@needs_earth
@needs_jezero
def test_analog_comparison_reports_metrics_not_a_score():
    r = TestClient(app).get("/api/analog").json()
    for k in ("relief_m", "slope_p50_deg", "share_over_20_deg"):
        assert k in r["mars"] and k in r["earth"]
    assert "score" not in r and r["summary"]
