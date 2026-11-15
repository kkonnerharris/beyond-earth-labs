"""Ground-level views: what Perseverance photographed near a point on the map.

The challenge statement suggests including point-of-view images "so the
astronaut knows what to expect when they arrive". Perseverance's published
waypoints carry the sol, site and drive index of each stop, and NASA's
raw-image feed can be searched by sol. This module joins the two: for a map
point it finds the nearest rover stop and returns navigation-camera frames
taken there.

What this is not: the images are raw, uncalibrated browse products, taken
from the rover's stop and not from the clicked point. The camera's compass
heading is not derived (mast azimuth is in the rover's own frame), so no
viewing direction is claimed.
"""
from __future__ import annotations

import json
import math

import requests

from . import DATA_DIR
from .remote import USER_AGENT

FEED = "https://mars.nasa.gov/rss/api/"
CACHE = DATA_DIR / "cache" / "m2020_images"
MAX_DISTANCE_M = 600.0


def _load_waypoints() -> list[dict]:
    p = DATA_DIR / "jezero" / "m2020.json"
    if not p.exists():
        return []
    return [w for w in json.loads(p.read_text(encoding="utf-8"))["waypoints"] if w.get("sol") is not None]


def _feed(sol: int) -> list[dict]:
    """Left navigation camera frames for one sol (cached on disk)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"sol_{sol:05d}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    r = requests.get(FEED, params={"feed": "raw_images", "category": "mars2020", "feedtype": "json", "num": 100,
                                   "page": 0, "order": "sol asc", "search": "NAVCAM_LEFT", "sol": sol},
                     headers={"User-Agent": USER_AGENT}, timeout=60)
    r.raise_for_status()
    images = []
    for im in r.json().get("images", []):
        ext, files = im.get("extended") or {}, im.get("image_files") or {}
        if im.get("sample_type") != "Full" or not files.get("small"):
            continue
        try:
            el = float(ext.get("mastEl"))
            az = float(ext.get("mastAz"))
        except (TypeError, ValueError):
            continue
        images.append({"id": im.get("imageid"), "title": im.get("title"), "date_utc": im.get("date_taken_utc"),
                       "site": im.get("site"), "drive": str(im.get("drive")), "mast_elevation_deg": round(el, 1),
                       "mast_azimuth_rover_frame_deg": round(az, 1), "small": files.get("small"),
                       "large": files.get("large") or files.get("medium"), "credit": im.get("credit")})
    path.write_text(json.dumps(images), encoding="utf-8")
    return images


def _pick(images: list[dict], site, drive, limit: int) -> tuple[list[dict], bool]:
    """Prefer frames from the same stop that look out across the ground rather than down at the deck."""
    same = [i for i in images if str(i["site"]) == str(site) and i["drive"] == str(drive)]
    pool, exact = (same, True) if same else (images, False)
    outward = [i for i in pool if -30.0 <= i["mast_elevation_deg"] <= 5.0] or pool
    outward.sort(key=lambda i: abs(i["mast_elevation_deg"] + 12.0))
    chosen: list[dict] = []
    for im in outward:                      # spread the views around the mast
        if all(abs(((im["mast_azimuth_rover_frame_deg"] - c["mast_azimuth_rover_frame_deg"] + 180) % 360) - 180) > 40
               for c in chosen):
            chosen.append(im)
        if len(chosen) == limit:
            break
    return chosen, exact


def near(x: float, y: float, limit: int = 3) -> dict:
    """Rover camera frames from the stop nearest to a local point (metres in the mission-area frame)."""
    wps = _load_waypoints()
    if not wps:
        return {"available": False, "reason": "Perseverance waypoints have not been ingested."}
    ranked = sorted(wps, key=lambda w: math.hypot(w["x"] - x, w["y"] - y))
    tried = []
    for w in ranked[:6]:                    # the nearest stop may have no outward frames; try a few
        d = math.hypot(w["x"] - x, w["y"] - y)
        if d > MAX_DISTANCE_M:
            break
        sol = int(w["sol"])
        if sol in tried:
            continue
        tried.append(sol)
        chosen, exact = _pick(_feed(sol), w.get("site"), w.get("drive"), limit)
        if chosen:
            return {
                "available": True,
                "waypoint": {"sol": sol, "site": w.get("site"), "drive": w.get("drive"), "lon": w["lon"],
                             "lat": w["lat"], "distance_m": round(d, 0)},
                "same_stop": exact, "images": chosen, "kind": "observation",
                "source": "NASA/JPL-Caltech, Mars 2020 raw images (left navigation camera)",
                "note": ("Raw browse images taken from the rover's stop, not from the selected point. "
                         + ("" if exact else "No frame matched this exact stop, so these are from the same sol. ")
                         + "Viewing direction is not derived."),
            }
    nearest = math.hypot(ranked[0]["x"] - x, ranked[0]["y"] - y)
    return {"available": False,
            "reason": (f"Perseverance's nearest stop is {nearest:.0f} m away; views are shown within {MAX_DISTANCE_M:.0f} m."
                       if nearest > MAX_DISTANCE_M else "No navigation-camera frames were found for the nearest stops.")}
