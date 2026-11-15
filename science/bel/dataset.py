"""Build the cross-planetary terrain-cell dataset from live NASA sources.

One region (see sites.py) becomes a GRID x GRID block of terrain cells.
Each cell has:

* an image, IMG_PX x IMG_PX at IMG_CELL_M metres per pixel
    Mars  : THEMIS daytime infrared mosaic (2001 Mars Odyssey), NASA Trek
    Moon  : LROC Wide Angle Camera mosaic (LRO), NASA Trek
    Earth : HLS L30 red band (Landsat 8/9), NASA
* an elevation patch, DEM_PX x DEM_PX at DEM_CELL_M metres
    Mars  : MOLA MEGDR 128 px/deg (MGS)       native 463 m
    Moon  : LOLA GDR 64 px/deg (LRO)          native 474 m
    Earth : NASADEM 1 arc-second, area-averaged to the same cell size
* the physical attribute vector measured from that elevation patch.

Elevation is brought to one common cell size on all three bodies before
any slope is computed, because slope depends strongly on the baseline it is
measured over. Images are never used to compute a label and elevation is
never shown to the image model: the labels are independent measurements.

Usage:
    python -m bel.dataset build [--bodies mars moon earth] [--only KEY ...]
    python -m bel.dataset index
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import traceback
from datetime import datetime, timezone

import numpy as np

from . import DATA_DIR, terrain
from .earth_sources import read_earth_dem, read_hls_red
from .remote import LROC_WAC, THEMIS_DAY_IR, LocalGrid, lola_tiles, mola_tiles, read_raw_grid, read_trek
from .sites import Region, regions_for

CELL_KM = 11.2
IMG_CELL_M = 100.0
IMG_PX = 112
DEM_PX = 24
DEM_CELL_M = CELL_KM * 1000.0 / DEM_PX      # 466.67 m
GRID = 7                                     # cells per region side
REGION_M = GRID * CELL_KM * 1000.0           # 78.4 km
DATASET_VERSION = "terra-cells-v1"

PATCH_DIR = DATA_DIR / "patches"


def _read_region(region: Region) -> tuple[np.ndarray, np.ndarray, dict]:
    g_img = LocalGrid(region.body, region.lat, region.lon, REGION_M, IMG_CELL_M)
    g_dem = g_img.with_cell(DEM_CELL_M)
    if region.body == "mars":
        img, img_info = read_trek(THEMIS_DAY_IR, g_img)
        dem, dem_info = read_raw_grid(mola_tiles(), g_dem)
        img_info.update({"product": "THEMIS Day IR controlled mosaic, 100 m", "mission": "2001 Mars Odyssey",
                         "modality": "thermal infrared (daytime)"})
        dem_info.update({"product": "MOLA MEGDR 128 px/deg topography", "mission": "Mars Global Surveyor",
                         "dataset_id": "MGS-M-MOLA-5-MEGDR-L3-V1.0", "native_cell_m": 463.0})
    elif region.body == "moon":
        img, img_info = read_trek(LROC_WAC, g_img)
        dem, dem_info = read_raw_grid(lola_tiles(), g_dem)
        img_info.update({"product": "LROC WAC global mosaic, 100 m", "mission": "Lunar Reconnaissance Orbiter",
                         "modality": "visible (643 nm)"})
        dem_info.update({"product": "LOLA GDR 64 px/deg (LDEM_64)", "mission": "Lunar Reconnaissance Orbiter",
                         "dataset_id": "LRO-L-LOLA-4-GDR-V1.0", "native_cell_m": 473.8})
    elif region.body == "earth":
        img, img_info = read_hls_red(g_img)
        dem, dem_info = read_earth_dem(g_dem, region.dem)
        img_info.update({"mission": "Landsat 8/9 (NASA/USGS)", "modality": "visible red (0.64-0.67 um)"})
    else:
        raise ValueError(region.body)
    return img, dem, {"image": img_info, "elevation": dem_info}


def build_region(region: Region, force: bool = False) -> dict:
    out_dir = PATCH_DIR / region.body
    out_dir.mkdir(parents=True, exist_ok=True)
    npz_path, meta_path = out_dir / f"{region.key}.npz", out_dir / f"{region.key}.json"
    if npz_path.exists() and meta_path.exists() and not force:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    t0 = time.time()
    img, dem, sources = _read_region(region)
    g_img = LocalGrid(region.body, region.lat, region.lon, REGION_M, IMG_CELL_M)
    x, y = g_img.xy()
    lon, lat = g_img.lonlat()

    images, dems, attrs, rc, centres, xy = [], [], [], [], [], []
    rejected = {"image_gaps": 0, "elevation_gaps": 0, "flat_water": 0}
    for r in range(GRID):
        for c in range(GRID):
            ip = img[r * IMG_PX:(r + 1) * IMG_PX, c * IMG_PX:(c + 1) * IMG_PX]
            dp = dem[r * DEM_PX:(r + 1) * DEM_PX, c * DEM_PX:(c + 1) * DEM_PX]
            if np.isfinite(ip).mean() < 0.98:
                rejected["image_gaps"] += 1
                continue
            if np.isfinite(dp).mean() < 0.98:
                rejected["elevation_gaps"] += 1
                continue
            # Open water: flat in the DEM *and* dark in the red band. A salt
            # flat or playa is just as flat but bright, and is real terrain.
            if region.body == "earth" and np.nanstd(dp) < 0.5 and np.nanmedian(ip) < 0.06:
                rejected["flat_water"] += 1
                continue
            ip = np.where(np.isfinite(ip), ip, np.nanmedian(ip)).astype(np.float32)
            dp = np.where(np.isfinite(dp), dp, np.nanmedian(dp)).astype(np.float32)
            a = terrain.attributes(dp, DEM_CELL_M)
            if not np.all(np.isfinite(a)):
                rejected["elevation_gaps"] += 1
                continue
            images.append(ip)
            dems.append(dp)
            attrs.append(a)
            rc.append((r, c))
            cy, cx = r * IMG_PX + IMG_PX // 2, c * IMG_PX + IMG_PX // 2
            centres.append((float(lat[cy, cx]), float(lon[cy, cx])))
            xy.append((float(x[cy, cx]), float(y[cy, cx])))

    meta = {
        "dataset_version": DATASET_VERSION,
        "region": {"key": region.key, "name": region.name, "body": region.body, "lat": region.lat,
                   "lon": region.lon, "processes": list(region.processes), "note": region.note,
                   "citation": region.citation, "analog_for": list(region.analog_for), "control": region.control},
        "grid": {"cells_per_side": GRID, "cell_km": CELL_KM, "image_px": IMG_PX, "image_cell_m": IMG_CELL_M,
                 "dem_px": DEM_PX, "dem_cell_m": DEM_CELL_M,
                 "projection": "Lambert azimuthal equal-area centred on the region"},
        "sources": sources,
        "cells_kept": len(images),
        "cells_rejected": rejected,
        "attribute_names": list(terrain.ATTRIBUTE_NAMES),
        "retrieved_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seconds": round(time.time() - t0, 1),
    }
    if images:
        np.savez_compressed(
            npz_path,
            images=np.stack(images).astype(np.float32),
            dems=np.stack(dems).astype(np.float32),
            attrs=np.stack(attrs).astype(np.float32),
            rc=np.array(rc, dtype=np.int16),
            latlon=np.array(centres, dtype=np.float64),
            xy=np.array(xy, dtype=np.float32),
        )
    meta_path.write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return meta


def build(bodies: list[str], only: list[str] | None, force: bool) -> None:
    failures = []
    for body in bodies:
        for region in regions_for(body):
            if only and region.key not in only:
                continue
            try:
                m = build_region(region, force)
                print(f"[{body}] {region.key:18s} kept={m['cells_kept']:2d} rejected={m['cells_rejected']} "
                      f"{m['seconds']}s", flush=True)
            except Exception as exc:  # noqa: BLE001 - keep going, report at the end
                failures.append((body, region.key, repr(exc)[:300]))
                print(f"[{body}] {region.key:18s} FAILED {exc!r}"[:400], flush=True)
                traceback.print_exc(limit=2)
    (PATCH_DIR / "build_failures.json").write_text(json.dumps(failures, indent=1), encoding="utf-8")
    print(f"done; {len(failures)} region(s) failed", flush=True)


def write_index() -> int:
    """Flatten every region file into data/patches/index.csv (one row per terrain cell)."""
    rows = []
    for meta_path in sorted(PATCH_DIR.glob("*/*.json")):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        npz_path = meta_path.with_suffix(".npz")
        if not npz_path.exists():
            continue
        d = np.load(npz_path)
        reg = meta["region"]
        for i in range(len(d["attrs"])):
            rows.append({
                "cell_id": f"{reg['body']}:{reg['key']}:{int(d['rc'][i][0])}-{int(d['rc'][i][1])}",
                "body": reg["body"], "region": reg["key"], "index_in_region": i,
                "row": int(d["rc"][i][0]), "col": int(d["rc"][i][1]),
                "lat": round(float(d["latlon"][i][0]), 5), "lon": round(float(d["latlon"][i][1]), 5),
                "control": int(bool(reg["control"])),
                **{n: round(float(v), 4) for n, v in zip(terrain.ATTRIBUTE_NAMES, d["attrs"][i])},
            })
    if not rows:
        return 0
    with open(PATCH_DIR / "index.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    return len(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--bodies", nargs="+", default=["mars", "moon", "earth"])
    b.add_argument("--only", nargs="*")
    b.add_argument("--force", action="store_true")
    sub.add_parser("index")
    args = ap.parse_args(argv)
    if args.cmd == "build":
        build(args.bodies, args.only, args.force)
        print("index rows:", write_index())
    else:
        print("index rows:", write_index())
    return 0


if __name__ == "__main__":
    sys.exit(main())
