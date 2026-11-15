"""Terrain measurements are checked against surfaces with known answers."""
import math

import numpy as np
import pytest

from bel import terrain
from bel.bodies import EARTH, MARS, MOON
from bel.remote import LocalGrid


def plane(n, cell, gx, gy):
    """z = gx*x + gy*y on an n x n grid of `cell` metres."""
    yy, xx = np.mgrid[0:n, 0:n]
    return gx * xx * cell + gy * yy * cell


@pytest.mark.parametrize("deg", [0.0, 1.0, 5.0, 15.0, 30.0])
def test_slope_of_tilted_plane_is_exact(deg):
    cell = 466.67
    z = plane(24, cell, math.tan(math.radians(deg)), 0.0)
    s = terrain.slope_degrees(z, cell)
    # Interior cells are exact; replicated edges halve the gradient along x.
    assert np.allclose(s[:, 1:-1], deg, atol=1e-9)


def test_slope_is_independent_of_tilt_direction():
    cell = 100.0
    g = math.tan(math.radians(10.0))
    a = terrain.slope_degrees(plane(16, cell, g, 0.0), cell)[2:-2, 2:-2]
    b = terrain.slope_degrees(plane(16, cell, g / math.sqrt(2), g / math.sqrt(2)), cell)[2:-2, 2:-2]
    assert np.allclose(a, 10.0, atol=1e-9)
    assert np.allclose(b, 10.0, atol=1e-9)


def test_slope_scales_with_cell_size():
    z = plane(12, 1.0, 1.0, 0.0)             # rises 1 unit per cell
    assert np.allclose(terrain.slope_degrees(z, 1.0)[:, 1:-1], 45.0)
    assert np.allclose(terrain.slope_degrees(z, 10.0)[:, 1:-1], math.degrees(math.atan(0.1)))


def test_roughness_ignores_regional_tilt_but_sees_bumps():
    cell = 466.67
    tilted = plane(24, cell, 0.05, -0.02)
    assert terrain.plane_detrended_rms(tilted) < 1e-6
    rng = np.random.default_rng(0)
    bumpy = tilted + rng.normal(0.0, 25.0, tilted.shape)
    assert 20.0 < terrain.plane_detrended_rms(bumpy) < 30.0


def test_attribute_vector_order_and_units():
    cell = 466.67
    z = plane(24, cell, math.tan(math.radians(4.0)), 0.0)
    a = terrain.attributes(z, cell)
    named = dict(zip(terrain.ATTRIBUTE_NAMES, a))
    assert named["slope_median_deg"] == pytest.approx(4.0, abs=1e-6)
    assert named["relief_m"] == pytest.approx(23 * cell * math.tan(math.radians(4.0)), rel=1e-9)
    assert named["roughness_m"] == pytest.approx(0.0, abs=1e-6)


def test_attributes_refuse_patches_with_large_gaps():
    z = np.zeros((24, 24))
    z[:6] = np.nan
    assert np.all(np.isnan(terrain.attributes(z, 466.67)))


def test_block_mean_area_averages():
    z = np.arange(16, dtype=float).reshape(4, 4)
    out = terrain.block_mean(z, 2)
    assert out.shape == (2, 2)
    assert out[0, 0] == pytest.approx((0 + 1 + 4 + 5) / 4)


@pytest.mark.parametrize("body,lat,lon", [(MARS, 18.38, 77.58), (MOON, 26.13, 3.63), (EARTH, 38.41, -110.79)])
def test_local_grid_is_metric_and_north_up(body, lat, lon):
    g = LocalGrid(body.key, lat, lon, 78_400.0, 100.0)
    assert g.n == 784
    glon, glat = g.lonlat()
    # Row 0 is north; column 0 is west.
    assert glat[0, 392] > glat[-1, 392]
    assert glon[392, 0] < glon[392, -1]
    # The centre of the grid is the requested point.
    assert glat[391:393, 391:393].mean() == pytest.approx(lat, abs=1e-3)
    # North-south extent in degrees matches the body's radius.
    span_deg = glat[0, 392] - glat[-1, 392]
    expected = (78_400.0 - 100.0) / body.metres_per_degree()
    assert span_deg == pytest.approx(expected, rel=2e-3)


def test_same_ground_distance_spans_more_degrees_on_smaller_bodies():
    spans = {}
    for body in (EARTH, MARS, MOON):
        g = LocalGrid(body.key, 0.0, 10.0, 50_000.0, 500.0)
        _, lat = g.lonlat()
        spans[body.key] = lat[0, 50] - lat[-1, 50]
    assert spans["moon"] > spans["mars"] > spans["earth"]
