"""Image representations for terrain cells.

Two representations are computed for every cell and cached on disk:

* `dinov2`      : a frozen DINOv2 ViT-S/14 vision transformer (Oquab et al.
                  2023, arXiv:2304.07193), [CLS] token concatenated with the
                  mean patch token: 768 numbers per cell. This is the input
                  to the trainable terrain head.
* `handcrafted` : classical texture statistics (grey-level moments, gradient
                  statistics at three scales, local binary patterns, grey-level
                  co-occurrence). This is the non-deep-learning baseline.

Both see exactly the same normalised image and nothing else: no elevation,
no coordinates, no body label.

Usage:
    python -m bel.features extract [--kinds dinov2 handcrafted] [--batch 16]
"""
from __future__ import annotations

import argparse
import json
import sys
import time

import numpy as np

from . import DATA_DIR
from .dataset import PATCH_DIR

FEATURE_DIR = DATA_DIR / "features"
BACKBONE_NAME = "vit_small_patch14_dinov2.lvd142m"
BACKBONE_INPUT = 224
DINOV2_DIM = 768

_IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def normalise_patch(img: np.ndarray) -> np.ndarray:
    """Robust per-cell contrast stretch to 0..1.

    The three sensors (thermal infrared, visible 643 nm, visible red
    reflectance) have unrelated radiometric scales, so absolute brightness
    is not comparable between bodies. Stretching each cell between its own
    1st and 99th percentiles keeps texture and shading and discards the
    sensor's scale. The cost, stated in the model card, is that the overall
    contrast of a cell is no longer available to the model.
    """
    img = np.asarray(img, dtype=np.float32)
    lo, hi = np.percentile(img, [1.0, 99.0])
    if hi - lo < 1e-6:
        return np.full_like(img, 0.5)
    return np.clip((img - lo) / (hi - lo), 0.0, 1.0)


# ----------------------------------------------------------------------------
# Classical baseline features
# ----------------------------------------------------------------------------

def _lbp_histogram(g: np.ndarray) -> np.ndarray:
    """Rotation-invariant uniform local binary patterns, 8 neighbours, radius 1 (10 bins)."""
    c = g[1:-1, 1:-1]
    neigh = [g[0:-2, 0:-2], g[0:-2, 1:-1], g[0:-2, 2:], g[1:-1, 2:],
             g[2:, 2:], g[2:, 1:-1], g[2:, 0:-2], g[1:-1, 0:-2]]
    bits = np.stack([(n >= c) for n in neigh]).astype(np.int8)
    transitions = np.abs(bits - np.roll(bits, 1, axis=0)).sum(axis=0)
    ones = bits.sum(axis=0)
    code = np.where(transitions <= 2, ones, 9)
    hist = np.bincount(code.ravel(), minlength=10).astype(np.float64)
    return hist / hist.sum()


def _glcm_stats(g: np.ndarray, levels: int = 16) -> list[float]:
    """Contrast, homogeneity, energy and correlation of the co-occurrence matrix (offsets 1 and 4 px)."""
    q = np.minimum((g * levels).astype(np.int32), levels - 1)
    out: list[float] = []
    i, j = np.mgrid[0:levels, 0:levels]
    for d in (1, 4):
        pairs = []
        for a, b in ((q[:, :-d], q[:, d:]), (q[:-d, :], q[d:, :])):
            m = np.bincount((a * levels + b).ravel(), minlength=levels * levels).reshape(levels, levels)
            pairs.append(m + m.T)
        p = (pairs[0] + pairs[1]).astype(np.float64)
        p /= p.sum()
        mu_i, mu_j = (i * p).sum(), (j * p).sum()
        sd_i = np.sqrt(((i - mu_i) ** 2 * p).sum())
        sd_j = np.sqrt(((j - mu_j) ** 2 * p).sum())
        corr = ((i - mu_i) * (j - mu_j) * p).sum() / (sd_i * sd_j) if sd_i * sd_j > 1e-12 else 0.0
        out += [float(((i - j) ** 2 * p).sum()), float((p / (1.0 + np.abs(i - j))).sum()),
                float((p ** 2).sum()), float(corr)]
    return out


def handcrafted_features(img: np.ndarray) -> np.ndarray:
    """Classical texture descriptor of one normalised cell image (0..1)."""
    g = normalise_patch(img).astype(np.float64)
    feats: list[float] = [g.mean(), g.std()]
    feats += list(np.percentile(g, [5, 25, 50, 75, 95]))
    centred = g - g.mean()
    sd = g.std() + 1e-9
    feats += [float((centred ** 3).mean() / sd ** 3), float((centred ** 4).mean() / sd ** 4)]
    cur = g
    for _ in range(3):                                   # gradient statistics at 1x, 2x, 4x
        gy, gx = np.gradient(cur)
        mag = np.hypot(gx, gy)
        feats += [mag.mean(), mag.std(), float(np.percentile(mag, 90))]
        lap = (np.roll(cur, 1, 0) + np.roll(cur, -1, 0) + np.roll(cur, 1, 1) + np.roll(cur, -1, 1) - 4 * cur)
        feats.append(float((lap[1:-1, 1:-1] ** 2).mean()))
        h, w = (cur.shape[0] // 2) * 2, (cur.shape[1] // 2) * 2
        cur = cur[:h, :w].reshape(h // 2, 2, w // 2, 2).mean(axis=(1, 3))
    feats += list(_lbp_histogram(g))
    feats += _glcm_stats(g)
    return np.asarray(feats, dtype=np.float32)


# ----------------------------------------------------------------------------
# DINOv2 backbone
# ----------------------------------------------------------------------------

class Backbone:
    """Frozen DINOv2 ViT-S/14. Loads lazily; weights come from the timm / Hugging Face hub."""

    def __init__(self, threads: int | None = None):
        import timm
        import torch

        if threads:
            torch.set_num_threads(threads)
        self.torch = torch
        self.model = timm.create_model(BACKBONE_NAME, pretrained=True, num_classes=0, img_size=BACKBONE_INPUT)
        self.model.eval()
        for p in self.model.parameters():
            p.requires_grad_(False)
        self.n_prefix = getattr(self.model, "num_prefix_tokens", 1)
        self.n_params = sum(p.numel() for p in self.model.parameters())

    def preprocess(self, imgs: np.ndarray):
        """(N, H, W) raw cell images -> (N, 3, 224, 224) normalised tensor."""
        torch = self.torch
        x = np.stack([normalise_patch(i) for i in imgs]).astype(np.float32)
        t = torch.from_numpy(x)[:, None]
        t = torch.nn.functional.interpolate(t, size=(BACKBONE_INPUT, BACKBONE_INPUT), mode="bilinear",
                                            align_corners=False)
        t = t.repeat(1, 3, 1, 1)
        mean = torch.from_numpy(_IMAGENET_MEAN)[None, :, None, None]
        std = torch.from_numpy(_IMAGENET_STD)[None, :, None, None]
        return (t - mean) / std

    def embed(self, imgs: np.ndarray, batch: int = 16) -> np.ndarray:
        torch = self.torch
        out = []
        with torch.inference_mode():
            for i in range(0, len(imgs), batch):
                tokens = self.model.forward_features(self.preprocess(imgs[i:i + batch]))
                cls = tokens[:, 0]
                patch_mean = tokens[:, self.n_prefix:].mean(dim=1)
                out.append(torch.cat([cls, patch_mean], dim=1).numpy())
        return np.concatenate(out).astype(np.float32)


def extract(kinds: list[str], batch: int = 16, force: bool = False) -> dict:
    """Compute and cache features for every region file under data/patches."""
    backbone = None
    done = {k: 0 for k in kinds}
    t0 = time.time()
    for npz_path in sorted(PATCH_DIR.glob("*/*.npz")):
        body, key = npz_path.parent.name, npz_path.stem
        images = None
        for kind in kinds:
            out_path = FEATURE_DIR / kind / body / f"{key}.npy"
            # A cached file is reused only if it is newer than the region's cells.
            if out_path.exists() and not force and out_path.stat().st_mtime >= npz_path.stat().st_mtime:
                continue
            if images is None:
                images = np.load(npz_path)["images"]
            if kind == "dinov2":
                if backbone is None:
                    backbone = Backbone()
                feats = backbone.embed(images, batch)
            elif kind == "handcrafted":
                feats = np.stack([handcrafted_features(i) for i in images])
            else:
                raise ValueError(kind)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            np.save(out_path, feats.astype(np.float32))
            done[kind] += len(feats)
        print(f"{body}/{key}: {time.time() - t0:.0f}s elapsed", flush=True)
    manifest = {
        "backbone": BACKBONE_NAME, "backbone_input_px": BACKBONE_INPUT, "dinov2_dim": DINOV2_DIM,
        "pooling": "[CLS] token concatenated with mean patch token",
        "normalisation": "per-cell 1-99 percentile stretch, grey replicated to 3 channels, ImageNet mean/std",
        "cells_embedded_this_run": done, "seconds": round(time.time() - t0, 1),
    }
    FEATURE_DIR.mkdir(parents=True, exist_ok=True)
    (FEATURE_DIR / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return manifest


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extract")
    e.add_argument("--kinds", nargs="+", default=["dinov2", "handcrafted"])
    e.add_argument("--batch", type=int, default=16)
    e.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)
    print(json.dumps(extract(args.kinds, args.batch, args.force), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
