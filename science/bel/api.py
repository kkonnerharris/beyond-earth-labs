"""Science service API (FastAPI): terrain, imagery tiles, the terrain model and analog ranking.

Run from the `science` folder:
    ../.venv/Scripts/python.exe -m uvicorn bel.api:app --port 8310

Every response that carries a number also carries where it came from:
`kind` is one of
    observation   a NASA measurement or a value read directly from one
    calculated    computed from observations by a documented formula
    model         predicted by the trained neural network
    assumption    an engineering assumption the user can change
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import DATA_DIR, EXPERIMENTS_DIR, MODELS_DIR, __version__, terrain, tiles
from .analog import Gallery, rank_region

app = FastAPI(title="Beyond Earth Labs science service", version=__version__)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:4770", "http://127.0.0.1:4770"],
                   allow_methods=["GET", "POST"], allow_headers=["*"])

JEZERO = DATA_DIR / "jezero"
def _transparent_tile() -> bytes:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGBA", (256, 256), (0, 0, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


EMPTY_PNG = _transparent_tile()


def _deployed_dir() -> Path | None:
    """The deployed model version named in models/deployed.json, else the newest saved version."""
    pointer = MODELS_DIR / "deployed.json"
    if pointer.exists():
        d = MODELS_DIR / json.loads(pointer.read_text(encoding="utf-8"))["directory"]
        if d.exists():
            return d
    dirs = sorted(p for p in MODELS_DIR.glob("terrain-head-*") if (p / "head.pt").exists())
    return dirs[-1] if dirs else None


@lru_cache(maxsize=1)
def _gallery() -> Gallery:
    d = _deployed_dir()
    if d is None:
        raise HTTPException(503, "no trained terrain model is available yet")
    return Gallery.load(d)


@app.get("/health")
def health() -> dict:
    d = _deployed_dir()
    return {"ok": True, "version": __version__, "jezero_terrain": (JEZERO / "terrain.bin").exists(),
            "model": d.name if d else None}


# ---------------------------------------------------------------- Jezero map

@app.get("/jezero/terrain")
def jezero_terrain() -> dict:
    p = JEZERO / "terrain.json"
    if not p.exists():
        raise HTTPException(503, "the Jezero mission area has not been built (python -m bel.jezero build)")
    return json.loads(p.read_text(encoding="utf-8"))


@app.get("/jezero/overlay/{name}.png")
def jezero_overlay(name: str):
    if name not in ("hillshade", "slope", "thermal"):
        raise HTTPException(404, "unknown overlay")
    p = JEZERO / "overlays" / f"{name}.png"
    if not p.exists():
        raise HTTPException(404, "overlay has not been built")
    return FileResponse(p, media_type="image/png")


@app.get("/jezero/m2020")
def jezero_m2020() -> dict:
    p = JEZERO / "m2020.json"
    if not p.exists():
        raise HTTPException(503, "Mars 2020 paths have not been ingested")
    return json.loads(p.read_text(encoding="utf-8"))


@app.get("/jezero/views")
def jezero_views(x: float, y: float, limit: int = 3) -> dict:
    """Perseverance camera frames from the rover stop nearest to a local point (metres)."""
    from . import views

    try:
        return views.near(x, y, max(1, min(limit, 6)))
    except Exception as exc:  # noqa: BLE001 - reported, never replaced with placeholder images
        raise HTTPException(502, f"The Mars 2020 image feed did not answer: {exc!r}"[:300]) from exc


# ------------------------------------------------------------- imagery tiles

@app.get("/layers")
def layers() -> list[dict]:
    return [{"key": l.key, "body": l.body, "title": l.title, "mission": l.mission, "kind": l.kind,
             "source": f"NASA Solar System Treks WMTS: {l.name}", "provenance": "observation",
             "tiles": f"/tiles/{l.key}/{{z}}/{{x}}/{{y}}.png", "max_zoom": l.max_zoom_hint + 1}
            for l in tiles.LAYERS.values()]


@app.get("/tiles/{layer}/{z}/{x}/{y}.png")
def tile(layer: str, z: int, x: int, y: int) -> Response:
    if layer not in tiles.LAYERS:
        raise HTTPException(404, "unknown layer")
    if not (0 <= z <= 20 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
        raise HTTPException(400, "tile out of range")
    data = tiles.render(layer, z, x, y)
    return Response(content=data or EMPTY_PNG, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400"})


# ------------------------------------------------- terrain model and analogs

@app.get("/model")
def model_info() -> dict:
    d = _deployed_dir()
    if d is None:
        raise HTTPException(503, "no trained terrain model is available yet")
    cfg = json.loads((d / "config.json").read_text(encoding="utf-8"))
    out = {"directory": d.name, "config": cfg, "kind": "model"}
    # Every experiment run on this dataset, newest result of each experiment winning.
    experiments, runs = {}, []
    for path in sorted((EXPERIMENTS_DIR / "runs").glob("*/metrics.json")):
        m = json.loads(path.read_text(encoding="utf-8"))
        if m.get("data", {}).get("cells") != cfg.get("dataset", {}).get("cells"):
            continue        # measured on a different dataset: not evidence for this model
        runs.append(m["run"])
        for name, result in m["experiments"].items():
            experiments[name] = {**result, "run": m["run"]}
    out["validation"] = {"runs": runs, "experiments": experiments, "data": cfg.get("dataset")}
    registry = MODELS_DIR / "registry.json"
    if registry.exists():
        out["registry"] = json.loads(registry.read_text(encoding="utf-8"))
    return out


@app.get("/regions")
def regions(body: str | None = None) -> list[dict]:
    g = _gallery()
    out = []
    for rid, meta in g.regions.items():
        if body and meta["body"] != body:
            continue
        idx = g.cells_of(rid)
        med = np.median(g.attrs[idx], axis=0) if len(idx) else np.full(len(terrain.ATTRIBUTE_NAMES), np.nan)
        out.append({"region": rid, **meta, "cells": int(len(idx)),
                    "measured": {n: (round(float(v), 2) if np.isfinite(v) else None)
                                 for n, v in zip(terrain.ATTRIBUTE_NAMES, med)},
                    "measured_kind": "calculated"})
    return out


@app.get("/analogs")
def analogs(region: str = "mars:jezero", top: int = 8) -> dict:
    g = _gallery()
    try:
        return rank_region(g, region, max(1, min(top, 29)))
    except KeyError:
        raise HTTPException(404, f"unknown region {region!r}") from None


@app.get("/clps")
def clps_deliveries() -> dict:
    """NASA's list of CLPS deliveries, quoted, with links to this project's lunar terrain regions."""
    from . import clps

    return clps.listing()


@app.get("/earth/climate")
def earth_climate(region: str = "earth:hanksville") -> dict:
    """Outdoor growing conditions at an Earth analog site, from NASA POWER."""
    from . import power

    g = _gallery()
    meta = g.regions.get(region)
    if not meta or meta["body"] != "earth":
        raise HTTPException(404, f"unknown Earth region {region!r}")
    try:
        out = power.climate(meta["lat"], meta["lon"])
    except Exception as exc:  # noqa: BLE001 - reported to the user, never replaced with made-up values
        raise HTTPException(502, f"NASA POWER did not answer: {exc!r}"[:300]) from exc
    out["region"] = {"region": region, "name": meta["name"], "note": meta.get("note", "")}
    return out


@app.get("/cells")
def cells(region: str) -> dict:
    """Per-cell measured attributes and model predictions for one region (for the map's cell grid)."""
    g = _gallery()
    if region not in g.regions:
        raise HTTPException(404, f"unknown region {region!r}")
    idx = g.cells_of(region)
    return {"region": region, "attribute_names": list(terrain.ATTRIBUTE_NAMES),
            "measured": np.round(g.attrs[idx], 3).tolist()}
