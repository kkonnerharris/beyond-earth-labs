"""The 1 m route check: the slope and roughness measure, route sampling and stretch reporting.

No test here downloads anything: the elevation posts are made up, with known shapes.
"""
import math

import numpy as np
import pytest

from bel import hirise


def _windows(fn, n=1, k=5, east_m=1.0):
    """k x k post windows of the surface z = fn(east_metres, north_metres)."""
    o = np.arange(k) - (k - 1) / 2.0
    dr, dc = np.meshgrid(o, o, indexing="ij")
    return np.repeat(fn(dc * east_m, -dr)[None], n, axis=0).astype(np.float32)


def test_plane_fit_recovers_a_known_tilt():
    for deg in (3.0, 15.0, 28.0):
        g = math.tan(math.radians(deg))
        slope, rough = hirise.plane_fit(_windows(lambda e, n: 100.0 + g * e))
        assert slope[0] == pytest.approx(deg, abs=0.01)
        assert rough[0] == pytest.approx(0.0, abs=1e-4)
        slope, _ = hirise.plane_fit(_windows(lambda e, n: g * n))
        assert slope[0] == pytest.approx(deg, abs=0.01)


def test_plane_fit_uses_the_true_east_west_post_spacing():
    # At Jezero's latitude the posts are about 0.95 m apart east-west, not 1 m.
    g = math.tan(math.radians(20.0))
    win = _windows(lambda e, n: g * e, east_m=0.95)
    assert hirise.plane_fit(win, 0.95)[0][0] == pytest.approx(20.0, abs=0.01)
    assert hirise.plane_fit(win, 1.0)[0][0] < 19.5          # ignoring it would under-read the slope


def test_roughness_is_height_about_the_plane_not_the_tilt():
    rng = np.random.default_rng(0)
    bumps = rng.normal(0, 0.3, (200, 5, 5))
    tilted = _windows(lambda e, n: 0.4 * e + 0.2 * n, n=200) + bumps
    _, rough = hirise.plane_fit(tilted)
    assert 0.2 < float(np.median(rough)) < 0.3            # a little under 0.3: the fit absorbs some of it


def test_a_missing_post_gives_no_value():
    win = _windows(lambda e, n: e)
    win[0, 1, 3] = np.nan
    slope, rough = hirise.plane_fit(win)
    assert np.isnan(slope[0]) and np.isnan(rough[0])


def test_densify_samples_every_metre_along_the_route():
    x, y, d = hirise.densify([[0, 0], [30, 0], [30, 40]])
    assert d[0] == 0 and d[-1] == pytest.approx(70.0)
    assert len(d) == 71
    assert (x[30], y[30]) == pytest.approx((30.0, 0.0))
    assert (x[-1], y[-1]) == pytest.approx((30.0, 40.0))
    with pytest.raises(ValueError):
        hirise.densify([[5, 5]])
    with pytest.raises(ValueError):
        hirise.densify([[5, 5], [5, 5]])


def test_stretches_join_short_gaps_and_ignore_single_posts():
    d = np.arange(0.0, 100.0)
    flag = np.zeros(100, dtype=bool)
    flag[10:16] = True          # 6 m
    flag[18:20] = True          # 2 m gap: same stretch
    flag[50] = True             # one post: ignored
    flag[80:84] = True          # 4 m, separate
    value = np.where(flag, 25.0, 5.0)
    value[12] = 31.0
    x, y = d.copy(), np.zeros(100)
    out = hirise.stretches(d, flag, value, x, y)
    assert [(s["start_m"], s["end_m"]) for s in out] == [(10.0, 20.0), (80.0, 84.0)]
    assert out[0]["max_slope_deg"] == 31.0 and out[0]["length_m"] == 10.0


@pytest.fixture
def made_up_ground(monkeypatch):
    """Flat ground with a 30 degree bank 12 m wide running north-south, in place of NASA's file."""
    monkeypatch.setattr(hirise, "_header", {"url": "test", "width": 21400, "height": 21488, "x0": 4577366.0,
                                            "y0": 1106618.0, "cell": 1.0, "first_byte": 0, "dtype": "<f4",
                                            "nodata": -3.4e38, "crs": "ESRI:103885", "radius_m": 3396190.0})
    monkeypatch.setattr(hirise, "_blocks", {})
    rows, cols, lat = hirise.to_posts(np.array([0.0]), np.array([0.0]))
    bank_col = int(round(cols[0]))
    east_m = math.cos(math.radians(float(lat[0])))

    def fake(keys, workers=24):
        for br, bc in keys:
            if (br, bc) not in hirise._blocks:
                c = np.arange(bc * hirise.BLOCK, (bc + 1) * hirise.BLOCK)
                climb = np.clip(c - bank_col, 0, 12) * east_m * math.tan(math.radians(30.0))
                hirise._blocks[(br, bc)] = np.tile(climb.astype(np.float32), (hirise.BLOCK, 1))
        return 0

    monkeypatch.setattr(hirise, "ensure_blocks", fake)
    monkeypatch.setattr(hirise, "OUT", hirise.OUT.with_name("not-there.json"))


def test_a_route_across_a_bank_is_flagged_where_the_bank_is(made_up_ground):
    out = hirise.check([[-60.0, 0.0], [80.0, 0.0]], 20.0)
    assert out["no_data_m"] == 0 and out["length_m"] == 140.0
    assert len(out["stretches"]) == 1
    s = out["stretches"][0]
    assert 5.0 <= s["length_m"] <= 14.0
    assert s["max_slope_deg"] == pytest.approx(30.0, abs=0.5)
    assert 0.0 <= s["x"] <= 13.0                           # on the bank, which starts at x = 0
    assert out["over_limit_m"] == s["length_m"]
    assert out["slope_deg"]["median"] == 0.0


def test_survey_counts_how_much_of_each_cell_is_too_steep(made_up_ground):
    # Cells 20 m square: one on flat ground west of the bank, one over the bank, one on the flat top.
    out = hirise.survey([[-50.0, 0.0], [10.0, 0.0], [50.0, 0.0]], 20.0, 20.0)["cells"]
    west, bank, top = out
    assert west["steep_posts"] == 0 and top["steep_posts"] == 0
    assert west["posts"] == 400 and west["max_slope_deg"] == 0.0
    assert bank["steep_posts"] >= 100                      # a 12 m bank across a 20 m cell: about half of it
    assert bank["max_slope_deg"] == pytest.approx(30.0, abs=0.5)
    # A mover that can take 35 degrees finds nothing too steep in the same cell.
    assert hirise.survey([[10.0, 0.0]], 20.0, 35.0)["cells"][0]["steep_posts"] == 0


def test_the_same_bank_is_fine_for_a_mover_with_a_higher_limit_and_along_its_foot(made_up_ground):
    assert hirise.check([[-60.0, 0.0], [80.0, 0.0]], 35.0)["stretches"] == []
    assert hirise.check([[-30.0, -50.0], [-30.0, 50.0]], 20.0)["stretches"] == []
