"""The 3D world's backend (Beyond Earth Labs).

    uvicorn backend.api.main:app --port 8320

Endpoints: the mission planned in the main map, placed in this world's frame (mission_link.py); terrain (real Jezero Crater from NASA MRO data, or the seeded procedural region), rover and
astronaut model parameters, A* route planning. Select the region with ?region=jezero|procedural.
The 3D render loop runs in the browser and never waits on this server: the frontend fetches
the terrain once and asks for routes on demand.
"""
from __future__ import annotations

import base64
import os
from dataclasses import asdict
from functools import lru_cache
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.api import mission_link
from backend.geospatial import dem, earth
from backend.geospatial.terrain import Terrain, generate_procedural
from backend.pathfinding.planner import CostGrid, NoRoute, build_cost_grid, plan_route
from backend.simulation.astronaut_model import ASTRONAUT
from backend.simulation.astronaut_model import params_dict as astro_params
from backend.simulation.rover_model import params_dict

SEED = int(os.environ.get("PATHFINDER_SEED", "7"))
ROOT = Path(__file__).resolve().parents[2]


Region = Literal["jezero", "procedural", "shawnee"]
DEFAULT_REGION: Region = "jezero" if dem.available() else "procedural"


@lru_cache(maxsize=2)
def world(region: Region = DEFAULT_REGION) -> tuple[Terrain, CostGrid]:
    if region == "jezero":
        if not dem.available():
            raise HTTPException(404, "Jezero data not prepared; run scripts/import_mars_data.py")
        t = dem.load_jezero(seed=SEED)
    elif region == "shawnee":
        if not earth.available():
            raise HTTPException(404, "Earth region not prepared; run scripts/import_earth.py")
        t = earth.load_shawnee()
    else:
        t = generate_procedural(seed=SEED)
    return t, build_cost_grid(t)


@lru_cache(maxsize=2)
def astro_grid(region: Region = DEFAULT_REGION) -> CostGrid:
    t, _ = world(region)
    return build_cost_grid(t, max_slope_deg=ASTRONAUT.max_slope_deg, radius_m=ASTRONAUT.radius_m)


class RouteRequest(BaseModel):
    start: tuple[float, float] = Field(description="[x, z] metres")
    goal: tuple[float, float] = Field(description="[x, z] metres")
    mode: Literal["fast", "balanced", "safe"] = "balanced"
    agent: Literal["rover", "astronaut"] = "rover"
    region: Region = DEFAULT_REGION


app = FastAPI(title="Beyond Earth Labs: 3D world", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health() -> dict:
    t, _ = world()
    return {"ok": True, "terrain": t.provenance.kind, "region": DEFAULT_REGION,
            "regions": [r for r, ok in (("jezero", dem.available()), ("shawnee", earth.available()), ("procedural", True)) if ok], "seed": SEED}


@app.get("/api/mission")
def mission(id: str | None = Query(None, description="mission id from the main map; the newest planned mission when omitted")) -> dict:
    """The mission planned in the main map, in this world's frame, so the 3D world shows the same plan."""
    if not dem.available():
        raise HTTPException(404, "Jezero data not prepared")
    try:
        m, profiles = mission_link.fetch(id)
    except mission_link.MissionUnavailable as e:
        raise HTTPException(404, str(e))
    return mission_link.to_world(m, dem.manifest()["region"], profiles)


class MissionDriveRequest(BaseModel):
    id: str | None = None
    start: tuple[float, float] = Field(description="[x, z] metres: where the rover is now")


@app.post("/api/mission/drive")
def mission_drive(req: MissionDriveRequest) -> dict:
    """The mission's first leg as a route this world's rover can drive (see mission_link.drive_route)."""
    wm = mission(req.id)
    _, g = world("jezero")
    try:
        return mission_link.drive_route(wm, g, req.start, plan_route, NoRoute)
    except NoRoute as e:
        raise HTTPException(422, str(e))


@app.get("/api/terrain")
def terrain(region: Region = Query(DEFAULT_REGION)) -> dict:
    t, g = world(region)
    real = None
    if region == "shawnee":
        m = earth.manifest()
        real = {"planet": "earth", "region": m["region"], "processing": m["processing"], "retrieved": m["retrieved"],
                "sources": [{k: v for k, v in s.items() if k != "read_meta"} | {"id": sid} for sid, s in m["sources"].items()],
                "ortho": "/data/shawnee/ortho.jpg", "themis": None, "m20": None, "surround": None}
    if region == "jezero":
        m = dem.manifest()
        real = {"planet": "mars", "region": m["region"], "processing": m["processing"], "retrieved": m["retrieved"],
                "sources": [{k: v for k, v in s.items() if k != "read_meta"} | {"id": sid} for sid, s in m["sources"].items()],
                "ortho": "/data/jezero/ortho.jpg",
                "themis": _themis_layer(),
                "m20": dem.m20_paths(),
                "surround": dem.surround()}
    return {
        "region": region,
        "real": real,
        "hazard_b64": base64.b64encode(g.hazard.astype("<f4").tobytes()).decode(),
        "rough_b64": base64.b64encode(t.roughness.astype("<f4").tobytes()).decode() if t.roughness is not None else None,
        "size_m": t.size_m,
        "n": t.n,
        "cell_m": t.cell,
        "heights_b64": base64.b64encode(t.heights.astype("<f4").tobytes()).decode(),
        "slope_b64": base64.b64encode(g.slope.astype("<f4").tobytes()).decode(),
        "rocks": [asdict(r) for r in t.rocks],
        "hazards": [asdict(h) for h in t.hazards],
        "sites": [asdict(s) for s in t.sites],
        "habitat": t.habitat,
        "landing_zone": t.landing_zone,
        "provenance": asdict(t.provenance),
        "rover": params_dict(),
        "astronaut": astro_params(),
    }


@app.post("/api/route")
def route(req: RouteRequest) -> dict:
    t, g = world(req.region)
    grid = astro_grid(req.region) if req.agent == "astronaut" else g
    try:
        r = plan_route(grid, req.start, req.goal, req.mode, agent=req.agent)
    except NoRoute as e:
        raise HTTPException(422, str(e))
    return asdict(r)


@lru_cache(maxsize=1)
def experiment() -> dict:
    """The Perseverance route experiment (backend/science/experiment.py) on the Jezero region."""
    from backend.science.experiment import run
    m20 = dem.m20_paths()
    if not m20:
        raise HTTPException(404, "Mars 2020 paths not imported; run scripts/import_m20_paths.py")
    t, g = world("jezero")
    return run(t, g, m20["drives"])


@app.get("/api/experiment")
def experiment_endpoint() -> dict:
    return experiment()


@app.get("/api/analog")
def analog() -> dict:
    """Mars site vs Earth analog: the same slope metrics side by side (backend/science/analog.py)."""
    from backend.science.analog import compare
    if not (dem.available() and earth.available()):
        raise HTTPException(404, "both the Jezero and Shawnee regions must be imported")
    return compare(world("jezero")[0], world("shawnee")[0])


@app.get("/api/rover")
def rover() -> dict:
    return params_dict()


def _themis_layer() -> dict | None:
    p = dem.DATA / "themis_dir.npy"
    if not p.exists():
        return None
    import numpy as np
    a = np.load(p).astype("<f4")
    return {"n": int(a.shape[0]), "values_b64": base64.b64encode(a.tobytes()).decode(),
            "min": float(np.nanmin(a)), "max": float(np.nanmax(a))}


if dem.DATA.exists():
    app.mount("/data/jezero", StaticFiles(directory=dem.DATA), name="jezero-data")
if earth.DATA.exists():
    app.mount("/data/shawnee", StaticFiles(directory=earth.DATA), name="shawnee-data")

dist = ROOT / "frontend" / "dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
