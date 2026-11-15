"""The head and the classical baseline are exercised on synthetic inputs.

These tests check the machinery (shapes, learning, save/load, no use of
test data). They say nothing about real-world accuracy: that is measured
only on real NASA data by bel.experiments.
"""
import numpy as np
import pytest

from bel import features, terrain
from bel.model import HeadConfig, Standardiser, load_model, predict, save_model, train_head

torch = pytest.importorskip("torch")


def synthetic(n=400, in_dim=32, seed=0):
    """Features that linearly encode two latent terrain factors, plus noise."""
    rng = np.random.default_rng(seed)
    latent = rng.normal(size=(n, 2))
    mix = rng.normal(size=(2, in_dim))
    x = latent @ mix + 0.1 * rng.normal(size=(n, in_dim))
    slope = np.exp(1.0 + 0.6 * latent[:, 0])
    relief = np.exp(5.0 + 0.8 * latent[:, 1])
    attrs = np.column_stack([slope, slope * 2.2, relief, relief * 0.2, relief * 0.1])
    return x.astype(np.float32), attrs.astype(np.float32)


def test_head_learns_and_embedding_is_unit_length():
    x, a = synthetic()
    cfg = HeadConfig(in_dim=32, hidden=64, emb_dim=16, epochs=150, batch=64)   # about 750 steps, like a real run
    model, std, hist = train_head(x[:300], a[:300], cfg)
    assert hist[-1]["reg"] < 0.5 * hist[0]["reg"]
    z, pred = predict(model, std, x[300:])
    assert z.shape == (100, 16) and pred.shape == (100, 5)
    assert np.allclose(np.linalg.norm(z, axis=1), 1.0, atol=1e-5)
    # Held-out slope is predicted far better than by the training mean.
    y, yhat = np.log1p(a[300:, 0]), np.log1p(pred[:, 0])
    r2 = 1 - ((y - yhat) ** 2).sum() / ((y - np.log1p(a[:300, 0]).mean()) ** 2).sum()
    assert r2 > 0.95


def test_embedding_distance_tracks_physical_distance():
    x, a = synthetic(seed=1)
    cfg = HeadConfig(in_dim=32, hidden=64, emb_dim=16, epochs=150, batch=64)   # about 750 steps, like a real run
    model, std, _ = train_head(x[:300], a[:300], cfg)
    z, _ = predict(model, std, x[300:])
    y = std.y(terrain.log_attributes(a[300:]))
    iu = np.triu_indices(100, 1)
    d_emb = (1 - z @ z.T)[iu]
    d_phys = np.linalg.norm(y[:, None] - y[None], axis=2)[iu]
    assert np.corrcoef(d_emb, d_phys)[0, 1] > 0.5


def test_standardiser_uses_training_cells_only():
    x, a = synthetic()
    s1 = Standardiser.fit(x[:200], terrain.log_attributes(a[:200]))
    s2 = Standardiser.fit(x, terrain.log_attributes(a))
    assert not np.allclose(s1.x_mean, s2.x_mean)


def test_save_and_load_round_trip(tmp_path):
    x, a = synthetic()
    cfg = HeadConfig(in_dim=32, hidden=64, emb_dim=16, epochs=3, batch=64)
    model, std, _ = train_head(x, a, cfg)
    save_model(tmp_path / "m", model, std, cfg, {"version": "test"})
    model2, std2, cfg2, meta = load_model(tmp_path / "m")
    z1, p1 = predict(model, std, x[:10])
    z2, p2 = predict(model2, std2, x[:10])
    assert np.allclose(z1, z2, atol=1e-6) and np.allclose(p1, p2, rtol=1e-5)
    assert meta["version"] == "test" and cfg2.emb_dim == 16


def test_coral_term_runs_with_unlabelled_target():
    x, a = synthetic()
    cfg = HeadConfig(in_dim=32, hidden=64, emb_dim=16, epochs=3, batch=64, coral_weight=1.0)
    _, _, hist = train_head(x[:200], a[:200], cfg, x_target_unlabelled=x[200:] + 0.5)
    assert hist[-1]["coral"] >= 0.0


def test_handcrafted_features_are_finite_and_respond_to_texture():
    rng = np.random.default_rng(0)
    smooth = np.tile(np.linspace(0, 1, 112), (112, 1))
    rough = rng.random((112, 112))
    fs, fr = features.handcrafted_features(smooth), features.handcrafted_features(rough)
    assert fs.shape == fr.shape and np.all(np.isfinite(fs)) and np.all(np.isfinite(fr))
    assert fr[9] > fs[9] * 5          # mean gradient magnitude at full resolution


def test_normalise_patch_removes_sensor_scale():
    rng = np.random.default_rng(0)
    img = rng.random((112, 112)).astype(np.float32)
    a = features.normalise_patch(img)
    b = features.normalise_patch(img * 4000.0 + 250.0)   # same scene, different radiometric scale
    assert np.allclose(a, b, atol=1e-4)
    assert a.min() >= 0.0 and a.max() <= 1.0
