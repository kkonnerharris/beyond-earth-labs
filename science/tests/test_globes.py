"""The whole-body elevation used for relief on the 3D planets."""
import numpy as np
import pytest

from bel import globes


def _or_skip(body: str) -> np.ndarray:
    try:
        return globes.elevation(body)
    except Exception as exc:  # noqa: BLE001 - no network: the test cannot say anything
        pytest.skip(f"NASA elevation for {body} could not be read: {exc!r}"[:160])


def test_mars_elevation_puts_olympus_mons_and_hellas_where_they_are():
    z = _or_skip("mars")
    assert z.shape == (720, 1440)
    row, col = np.unravel_index(np.argmax(z), z.shape)
    lat, lon = 90 - (row + 0.5) / 4, -180 + (col + 0.5) / 4
    assert abs(lat - 18.65) < 1.5 and abs(lon - (-133.8)) < 1.5      # Olympus Mons, 18.65 N, 226.2 E
    assert 20_000 < z.max() < 22_500
    row, col = np.unravel_index(np.argmin(z), z.shape)
    lat, lon = 90 - (row + 0.5) / 4, -180 + (col + 0.5) / 4
    assert -50 < lat < -30 and 55 < lon < 85                            # the floor of Hellas basin
    assert -8_600 < z.min() < -7_000


def test_moon_elevation_is_in_metres_about_the_reference_sphere():
    z = _or_skip("moon")
    assert z.shape == (720, 1440)
    assert -9_500 < z.min() < -8_000 and 9_500 < z.max() < 11_500     # South Pole-Aitken floor, far-side highlands


def test_relief_image_spans_black_to_white():
    try:
        data, span = globes.relief("mars")
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"NASA elevation could not be read: {exc!r}"[:160])
    assert data[:2] == b"\xff\xd8" and span["highest_m"] > span["lowest_m"]


def test_no_relief_image_for_earth():
    with pytest.raises(KeyError):
        globes.relief("earth")
