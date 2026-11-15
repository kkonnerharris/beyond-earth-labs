"""Rank Earth regions as analogs for a Mars or Moon location.

Three separate pieces of evidence are reported for every candidate and are
never blended into a single unexplained number:

1. embedding similarity  : cosine similarity of the trained terrain
                           embeddings (what the neural network sees);
2. physical similarity   : agreement of terrain attributes measured from
                           elevation data on both bodies (slope, relief,
                           roughness), independent of the network;
3. geologic support      : whether published literature documents the Earth
                           site as an analog and whether the two places share
                           a documented formation process.

The ranking score is the mean of (1) and (2). Geologic support does not
change the score; it sets the label, so a look-alike without a documented
geologic basis is shown as "morphometric analog only".
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import terrain

SUPPORTED = "geologically supported"
MORPHOMETRIC = "morphometric analog only"
CONTROL = "control region (not a planetary analog)"


@dataclass
class Gallery:
    """Embeddings and measured attributes of every cell the deployed model knows."""

    z: np.ndarray
    attrs: np.ndarray
    body: np.ndarray
    region: np.ndarray
    regions: dict            # "body:key" -> region metadata from sites.py
    y_mean: np.ndarray
    y_std: np.ndarray        # standardisation of log-attributes over Earth cells

    @classmethod
    def load(cls, model_dir: Path) -> "Gallery":
        g = np.load(model_dir / "gallery.npz", allow_pickle=False)
        regions = json.loads((model_dir / "regions.json").read_text(encoding="utf-8"))
        earth = g["body"] == "earth"
        y = terrain.log_attributes(g["attrs"])
        return cls(g["z"], g["attrs"], g["body"], g["region"], regions, y[earth].mean(0), y[earth].std(0) + 1e-6)

    def cells_of(self, region_id: str) -> np.ndarray:
        return np.where(self.region == region_id)[0]


def _physical_similarity(g: Gallery, a_query: np.ndarray, a_cand: np.ndarray) -> tuple[float, float]:
    """Similarity in (0, 1] and the underlying distance between two sets of measured attributes."""
    q = (terrain.log_attributes(np.median(a_query, axis=0)) - g.y_mean) / g.y_std
    c = (terrain.log_attributes(np.median(a_cand, axis=0)) - g.y_mean) / g.y_std
    d = float(np.linalg.norm(q - c) / np.sqrt(len(q)))     # RMS difference in Earth standard deviations
    return float(np.exp(-0.5 * d * d)), d


def _embedding_similarity(zq: np.ndarray, zc: np.ndarray, top: int = 5) -> float:
    """Mean over query cells of their mean similarity to their `top` best cells in the candidate region."""
    sim = zq @ zc.T
    k = min(top, sim.shape[1])
    best = np.sort(sim, axis=1)[:, -k:]
    return float(best.mean())


def _explain(a_query: np.ndarray, a_cand: np.ndarray) -> list[dict]:
    """Per-attribute comparison in physical units, closest attribute first."""
    q, c = np.median(a_query, axis=0), np.median(a_cand, axis=0)
    rows = []
    for i, name in enumerate(terrain.ATTRIBUTE_NAMES):
        ratio = float(max(q[i], c[i]) / max(min(q[i], c[i]), 1e-6))
        rows.append({"attribute": name, "query": round(float(q[i]), 2), "candidate": round(float(c[i]), 2),
                     "ratio": round(ratio, 2)})
    rows.sort(key=lambda r: r["ratio"])
    return rows


def rank(g: Gallery, zq: np.ndarray, a_query: np.ndarray, query_body: str, query_processes: list[str] | None = None,
         top_n: int = 10, target_body: str = "earth", query_meta: dict | None = None) -> list[dict]:
    """Rank every region of `target_body` for a query given as cell embeddings and measured attributes.

    The Earth side of a pair is the one the literature speaks about: a pair
    is "geologically supported" when the Earth region is documented as an
    analog for the other body and the two share a documented process.
    """
    query_processes = list(query_processes or [])
    query_meta = query_meta or {}
    out = []
    for rid, meta in g.regions.items():
        if not rid.startswith(target_body + ":"):
            continue
        idx = g.cells_of(rid)
        if len(idx) < 3:
            continue
        emb = _embedding_similarity(zq, g.z[idx])
        phys, dist = _physical_similarity(g, a_query, g.attrs[idx])
        shared = sorted(set(query_processes) & set(meta.get("processes", [])))
        earth_meta, other_body = (meta, query_body) if target_body == "earth" else (query_meta, target_body)
        if earth_meta.get("control"):
            label = CONTROL
        elif other_body in earth_meta.get("analog_for", []) and shared:
            label = SUPPORTED
        else:
            label = MORPHOMETRIC
        out.append({
            "region": rid, "name": meta["name"], "lat": meta["lat"], "lon": meta["lon"],
            "score": round(0.5 * (0.5 * (emb + 1.0)) + 0.5 * phys, 4),
            "embedding_similarity": round(emb, 4),
            "physical_similarity": round(phys, 4),
            "physical_distance_sd": round(dist, 3),
            "support": label,
            "shared_processes": shared,
            "documented_analog_for": earth_meta.get("analog_for", []),
            "body": target_body,
            "citation": meta.get("citation", ""),
            "note": meta.get("note", ""),
            "cells": int(len(idx)),
            "attributes": _explain(a_query, g.attrs[idx]),
        })
    out.sort(key=lambda r: -r["score"])
    for i, r in enumerate(out):
        r["rank"] = i + 1
    return out[:top_n]


def rank_region(g: Gallery, region_id: str, top_n: int = 10, target_body: str | None = None) -> dict:
    """Rank the regions of another body for one of the dataset's own regions.

    Mars and Moon regions are compared with Earth by default; an Earth region
    is compared with Mars by default (or the Moon when asked).
    """
    if region_id not in g.regions:
        raise KeyError(region_id)
    meta = g.regions[region_id]
    if target_body is None:
        target_body = "mars" if meta["body"] == "earth" else "earth"
    if target_body == meta["body"] or target_body not in ("earth", "mars", "moon"):
        raise ValueError("choose a different body to compare with")
    idx = g.cells_of(region_id)
    ranked = rank(g, g.z[idx], g.attrs[idx], meta["body"], meta.get("processes"), top_n, target_body, meta)
    med = np.median(g.attrs[idx], axis=0)
    return {
        "query": {"region": region_id, "name": meta["name"], "body": meta["body"], "lat": meta["lat"],
                  "lon": meta["lon"], "processes": meta.get("processes", []), "citation": meta.get("citation", ""),
                  "control": bool(meta.get("control")), "analog_for": meta.get("analog_for", []),
                  "note": meta.get("note", ""), "target_body": target_body, "cells": int(len(idx)),
                  "measured": {n: round(float(v), 2) for n, v in zip(terrain.ATTRIBUTE_NAMES, med)}},
        "candidates": ranked,
        "method": ("score = mean of embedding similarity (rescaled to 0..1) and physical similarity. "
                   "Physical similarity compares attributes measured from elevation data and does not use the "
                   "neural network. The support label comes from published literature, not from the model."),
    }
