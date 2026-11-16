"""Fetch a real aerial photograph of the Earth site for the 3D simulation.

    python scripts/import_earth_photo.py

The Earth site (Garden of the Gods, Shawnee National Forest, Illinois) is drawn on USGS 3DEP elevation.
Its ground picture was a 10 m satellite image, which is a smear of green from the height of a rover.
This replaces it with the National Agriculture Imagery Program (NAIP) aerial photograph, 0.6 m:
public-domain photography of the real place, flown for the USDA.

The photographs are read from the public NAIP archive on the Microsoft Planetary Computer (cloud-optimised
GeoTIFFs, an anonymous read token, no login). Only the part over the site is read. The simulation's ground
is a metric grid (transverse Mercator centred on the site), so the photograph is resampled onto that grid,
north up, exactly covering the 2 km square. The USGS National Map serves the same imagery, but its export
service timed out on the day this was written.
"""
import json
import pathlib

import numpy as np
import rasterio
import requests
from PIL import Image
from rasterio.crs import CRS
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject

ROOT = pathlib.Path(__file__).resolve().parents[1] / "surface-world"
MANIFEST = ROOT / "data" / "manifests" / "shawnee_region.json"
OUT = ROOT / "data" / "processed" / "shawnee" / "ortho.jpg"
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
TOKEN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/naip"
PX = 4096          # output picture is PX x PX over the 2 km square: about 0.49 m per pixel

manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
reg = manifest["region"]
lat0, lon0, size = reg["centre_lat_deg"], reg["centre_lon_deg"], reg["size_m"]
half = size / 2
dlat = 1.05 * half / 111_195.0
dlon = 1.05 * half / (111_320.0 * np.cos(np.radians(lat0)))
bbox = [lon0 - dlon, lat0 - dlat, lon0 + dlon, lat0 + dlat]

# Every NAIP photograph that touches the square; the newest year is used, older ones only fill gaps.
found = requests.post(STAC, json={"collections": ["naip"], "bbox": bbox, "limit": 50}, timeout=60).json()["features"]
if not found:
    raise SystemExit("no NAIP photograph covers the site")
found.sort(key=lambda f: f["properties"]["datetime"], reverse=True)
print("photographs:", [(f["id"], f["properties"]["datetime"][:10]) for f in found], flush=True)
token = requests.get(TOKEN, timeout=60).json()["token"]

dst_crs = CRS.from_proj4(reg["local_crs"])
dst_transform = from_bounds(-half, -half, half, half, PX, PX)   # row 0 is the north edge
out = np.zeros((3, PX, PX), dtype=np.uint8)
filled = np.zeros((PX, PX), dtype=bool)
used = []
for f in found:
    if filled.all():
        break
    href = f["assets"]["image"]["href"] + "?" + token
    part = np.zeros((3, PX, PX), dtype=np.uint8)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="2"):
        with rasterio.open(href) as src:
            for band in range(3):   # red, green, blue; the fourth band is near infrared
                reproject(source=rasterio.band(src, band + 1), destination=part[band], dst_transform=dst_transform,
                          dst_crs=dst_crs, resampling=Resampling.bilinear)
    has = part.sum(axis=0) > 0
    new = has & ~filled
    if new.any():
        out[:, new] = part[:, new]
        filled |= new
        used.append({"id": f["id"], "date": f["properties"]["datetime"][:10], "share_of_square": round(float(new.mean()), 4)})
    print(f"{f['id']} ({f['properties']['datetime'][:10]}): filled {new.mean():.1%} of the square", flush=True)

empty = float((~filled).mean())
print(f"empty pixels {empty:.4%}")
if empty > 0.002:
    raise SystemExit("the photographs do not cover the whole square")

Image.fromarray(np.moveaxis(out, 0, -1)).save(OUT, quality=88)
print("saved", OUT, f"{OUT.stat().st_size / 1e6:.1f} MB")

manifest["sources"]["naip"] = {
    "url": "https://planetarycomputer.microsoft.com/dataset/naip",
    "title": "National Agriculture Imagery Program (NAIP) aerial orthophotographs, natural colour, 0.6 m",
    "mission": "USDA National Agriculture Imagery Program",
    "instrument": "Aerial camera",
    "publisher": "USDA Farm Service Agency; read from the public NAIP archive on the Microsoft Planetary Computer",
    "year": int(used[0]["date"][:4]),
    "doi": "https://naip-usdaonline.hub.arcgis.com/",
    "citation": "USDA Farm Service Agency, National Agriculture Imagery Program. Public domain.",
    "read_meta": {"photographs": used, "output_px": PX, "output_m_per_px": size / PX},
}
manifest["sources"].pop("sentinel2", None)
manifest["processing"] = [p for p in manifest.get("processing", []) if "Sentinel-2" not in p] + [
    f"NAIP aerial photograph ({', '.join(sorted({u['date'] for u in used}))}) resampled (bilinear) to {PX} x {PX} "
    f"over the 2 km square, {size / PX:.2f} m per pixel. Colours are as photographed."]
MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print("manifest updated")
