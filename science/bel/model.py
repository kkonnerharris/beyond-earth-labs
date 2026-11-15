"""The cross-planetary terrain head: a trainable network on frozen DINOv2 features.

    image --(frozen DINOv2 ViT-S/14)--> 768 features --(TerrainHead)--> z, y_hat

* z      : a 128-dimensional unit-length terrain embedding, used to compare
           cells across Earth, Mars and the Moon.
* y_hat  : predicted physical terrain attributes (log1p of the values in
           terrain.ATTRIBUTE_NAMES), i.e. what the elevation model would
           measure, predicted from the image alone.

Training uses two losses on the same batch:

1. Attribute regression (smooth L1) against attributes measured from the
   co-registered elevation data.
2. A kernel-weighted contrastive loss that pulls together cells whose
   measured attributes are close in physical units and pushes apart cells
   whose attributes differ. The embedding therefore encodes physical terrain
   similarity, not image appearance and not which planet a cell is on.

An optional CORAL term (Sun & Saenko 2016) aligns the hidden-feature
covariance of unlabelled target-body cells with the source bodies. It uses
target images only, never target labels.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

from . import terrain

N_ATTR = len(terrain.ATTRIBUTE_NAMES)


@dataclass
class HeadConfig:
    in_dim: int = 768
    hidden: int = 512
    emb_dim: int = 128
    dropout: float = 0.15
    lr: float = 1e-3
    weight_decay: float = 1e-2
    epochs: int = 60
    batch: int = 256
    contrastive_weight: float = 0.5
    temperature: float = 0.1
    kernel_sigma: float = 0.75      # in units of standardised log-attribute distance
    coral_weight: float = 0.0
    seed: int = 0
    attribute_names: tuple = field(default_factory=lambda: tuple(terrain.ATTRIBUTE_NAMES))


def build_head(cfg: HeadConfig):
    import torch
    from torch import nn

    class TerrainHead(nn.Module):
        def __init__(self):
            super().__init__()
            # No normalisation layer on the input: features are already
            # standardised per dimension, and a per-sample LayerNorm here was
            # measured to discard the sample's overall magnitude (it cost
            # about 0.1 R2 on a linear synthetic problem).
            self.trunk = nn.Sequential(
                nn.Linear(cfg.in_dim, cfg.hidden), nn.GELU(), nn.Dropout(cfg.dropout),
                nn.Linear(cfg.hidden, cfg.hidden), nn.GELU(), nn.Dropout(cfg.dropout),
            )
            self.embed = nn.Linear(cfg.hidden, cfg.emb_dim)
            self.attr = nn.Linear(cfg.emb_dim, N_ATTR)

        def forward(self, x):
            h = self.trunk(x)
            e = self.embed(h)
            z = torch.nn.functional.normalize(e, dim=1)
            return z, self.attr(e), h

    return TerrainHead()


@dataclass
class Standardiser:
    """Mean and standard deviation of features (x) and log-attributes (y), fitted on training cells only."""

    x_mean: np.ndarray
    x_std: np.ndarray
    y_mean: np.ndarray
    y_std: np.ndarray

    @classmethod
    def fit(cls, x: np.ndarray, y_log: np.ndarray) -> "Standardiser":
        return cls(x.mean(0), x.std(0) + 1e-6, y_log.mean(0), y_log.std(0) + 1e-6)

    def x(self, x: np.ndarray) -> np.ndarray:
        return ((x - self.x_mean) / self.x_std).astype(np.float32)

    def y(self, y_log: np.ndarray) -> np.ndarray:
        return ((y_log - self.y_mean) / self.y_std).astype(np.float32)

    def y_inverse(self, y_std: np.ndarray) -> np.ndarray:
        return y_std * self.y_std + self.y_mean


def _coral(a, b):
    """Squared Frobenius distance between feature covariances (Deep CORAL)."""
    import torch

    def cov(m):
        m = m - m.mean(0, keepdim=True)
        return m.T @ m / max(m.shape[0] - 1, 1)

    d = a.shape[1]
    return torch.sum((cov(a) - cov(b)) ** 2) / (4.0 * d * d)


def train_head(x: np.ndarray, attrs: np.ndarray, cfg: HeadConfig, x_target_unlabelled: np.ndarray | None = None,
               log=None):
    """Train a head. `x` are backbone features, `attrs` physical attributes (not logged).

    Returns (model, standardiser, history). `x_target_unlabelled` enables the
    CORAL term when cfg.coral_weight > 0.
    """
    import torch

    torch.manual_seed(cfg.seed)
    rng = np.random.default_rng(cfg.seed)
    y_log = terrain.log_attributes(attrs)
    std = Standardiser.fit(x, y_log)
    xs, ys = torch.from_numpy(std.x(x)), torch.from_numpy(std.y(y_log))
    xt = torch.from_numpy(std.x(x_target_unlabelled)) if (
        x_target_unlabelled is not None and cfg.coral_weight > 0) else None

    model = build_head(cfg)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    steps = max(1, cfg.epochs * int(np.ceil(len(xs) / cfg.batch)))
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=cfg.lr, total_steps=steps)
    history = []
    for epoch in range(cfg.epochs):
        model.train()
        order = rng.permutation(len(xs))
        tot = {"reg": 0.0, "con": 0.0, "coral": 0.0, "n": 0}
        for i in range(0, len(order), cfg.batch):
            idx = torch.from_numpy(order[i:i + cfg.batch])
            if len(idx) < 8:
                continue
            xb, yb = xs[idx], ys[idx]
            z, pred, h = model(xb)
            reg = torch.nn.functional.smooth_l1_loss(pred, yb)
            # Kernel-weighted contrastive loss on physical similarity.
            d2 = torch.cdist(yb, yb) ** 2
            w = torch.exp(-d2 / (2.0 * cfg.kernel_sigma ** 2))
            eye = torch.eye(len(idx), dtype=torch.bool)
            w = w.masked_fill(eye, 0.0)
            w = w / w.sum(dim=1, keepdim=True).clamp_min(1e-8)
            logits = (z @ z.T) / cfg.temperature
            logits = logits.masked_fill(eye, -1e9)
            con = -(w * torch.log_softmax(logits, dim=1)).sum(dim=1).mean()
            loss = reg + cfg.contrastive_weight * con
            coral = torch.zeros(())
            if xt is not None:
                tb = xt[torch.from_numpy(rng.integers(0, len(xt), size=len(idx)))]
                _, _, ht = model(tb)
                coral = _coral(h, ht)
                loss = loss + cfg.coral_weight * coral
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            tot["reg"] += reg.item() * len(idx)
            tot["con"] += con.item() * len(idx)
            tot["coral"] += coral.item() * len(idx)
            tot["n"] += len(idx)
        row = {"epoch": epoch + 1, **{k: round(tot[k] / max(tot["n"], 1), 5) for k in ("reg", "con", "coral")}}
        history.append(row)
        if log and (epoch + 1) % 10 == 0:
            log(f"  epoch {row['epoch']:3d} reg={row['reg']:.4f} con={row['con']:.4f} coral={row['coral']:.5f}")
    model.eval()
    return model, std, history


def predict(model, std: Standardiser, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return (embedding z, predicted attributes in physical units)."""
    import torch

    with torch.inference_mode():
        z, pred, _ = model(torch.from_numpy(std.x(x)))
    y_log = std.y_inverse(pred.numpy())
    return z.numpy(), np.expm1(y_log)


def save_model(path: Path, model, std: Standardiser, cfg: HeadConfig, extra: dict) -> None:
    import torch

    path.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), path / "head.pt")
    np.savez(path / "standardiser.npz", x_mean=std.x_mean, x_std=std.x_std, y_mean=std.y_mean, y_std=std.y_std)
    (path / "config.json").write_text(json.dumps({"head": asdict(cfg), **extra}, indent=1, default=str),
                                      encoding="utf-8")


def load_model(path: Path):
    import torch

    meta = json.loads((path / "config.json").read_text(encoding="utf-8"))
    head_cfg = dict(meta["head"])
    head_cfg["attribute_names"] = tuple(head_cfg["attribute_names"])
    cfg = HeadConfig(**head_cfg)
    model = build_head(cfg)
    model.load_state_dict(torch.load(path / "head.pt", map_location="cpu"))
    model.eval()
    s = np.load(path / "standardiser.npz")
    std = Standardiser(s["x_mean"], s["x_std"], s["y_mean"], s["y_std"])
    return model, std, cfg, meta
