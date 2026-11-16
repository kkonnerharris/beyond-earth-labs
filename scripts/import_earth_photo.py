"""Fetch a real aerial photograph of the Earth site for the 3D simulation.

    python scripts/import_earth_photo.py

The Earth site (Garden of the Gods, Shawnee National Forest, Illinois) is drawn on USGS 3DEP elevation.
Its ground picture was a 10 m satellite image, which is a smear of green from the height of a rover.
This replaces it with the National Agriculture Imagery Program (NAIP) aerial photograph, 0.6 m, served
by the USGS National Map: public-domain photography of the real place.

The service returns pictures in longitude and latitude. The simulation's ground is a metric grid
(transverse Mercator centred on the site), so the picture is resampled onto that grid, north up,
exactly covering the 2 km square.
"""
import io
import json
import pathlib
import time
import urllib.request

import numpy as np
import rasterio
from PIL import Image
from rasterio.crs import CRS
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject

ROOT = pathlib.Path(__file__).resolve().parents[1] / "surface-world"
MANIFEST = ROOT / "data" / "manifests" / "shawnee_region.json"
OUT = ROOT / "data" / "processed" / "shawnee" / "ortho.jpg"
SERVICE = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer"
CACHE = pathlib.Path(__file__).resolve().parents[1] / "data" / "cache" / "naip"
CACHE.mkdir(parents=True, exist_ok=True)
PX = 4096          # output picture is PX x PX over the 2 km square: about 0.49 m per pixel
REQUEST_PX = 4000  # the service's largest picture

manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
reg = manifest["region"]
lat0, lon0, size = reg["centre_lat_deg"], reg["centre_lon_deg"], reg["size_m"]
half = size / 2

# A lon/lat box a little larger than the square, so the resampled picture has no empty corners.
margin = 1.06
dlat = margin * half / 111_195.0
dlon = margin * half / (111_320.0 * np.cos(np.radians(lat0)))
west, east, south, north = lon0 - dlon, lon0 + dlon, lat0 - dlat, lat0 + dlat
# The service times out on one 4000 x 4000 picture, so it is asked for a grid of smaller ones.
TILES = 4
tile_px = REQUEST_PX // TILES
src = np.zeros((REQUEST_PX, REQUEST_PX, 3), dtype=np.uint8)
for row in range(TILES):          # row 0 is the north edge
    for col in range(TILES):
        w = west + (east - west) * col / TILES
        e = west + (east - west) * (col + 1) / TILES
        n = north - (north - south) * row / TILES
        s_ = north - (north - south) * (row + 1) / TILES
        url = (f"{SERVICE}/exportImage?bbox={w},{s_},{e},{n}&bboxSR=4326&imageSR=4326"
               f"&size={tile_px},{tile_px}&format=jpg&f=image")
        saved = CACHE / f"naip_{row}_{col}.jpg"
        if saved.exists():
            tile = np.asarray(Image.open(saved).convert("RGB"))
        else:
            for attempt in range(10):
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (beyond-earth-labs)"})
                    with urllib.request.urlopen(req, timeout=120) as r:
                        raw = r.read()
                    tile = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"))
                    saved.write_bytes(raw)   # kept, so a rerun does not ask for it again
                    break
                except Exception as err:     # a slow or busy service: wait and try again
                    print(f"  tile {row},{col} attempt {attempt + 1} failed: {err}", flush=True)
                    if attempt == 9:
                        raise
                    time.sleep(6 + 4 * attempt)
        src[row * tile_px:(row + 1) * tile_px, col * tile_px:(col + 1) * tile_px] = tile
        print(f"tile {row},{col} ok", flush=True)
print("received", src.shape)
if src.std() < 2:
    raise SystemExit("the picture is blank: the service returned no imagery for this area")

src_transform = from_bounds(west, south, east, north, src.shape[1], src.shape[0])
dst_crs = CRS.from_proj4(reg["local_crs"])
dst_transform = from_bounds(-half, -half, half, half, PX, PX)   # row 0 is the north edge
out = np.zeros((3, PX, PX), dtype=np.uint8)
for band in range(3):
    reproject(source=src[:, :, band], destination=out[band], src_transform=src_transform, src_crs="EPSG:4326",
              dst_transform=dst_transform, dst_crs=dst_crs, resampling=Resampling.bilinear)
empty = float((out.sum(axis=0) == 0).mean())
print(f"resampled to {PX} x {PX}; empty pixels {empty:.4%}")
if empty > 0.001:
    raise SystemExit("the resampled picture has empty areas; widen the request margin")

Image.fromarray(np.moveaxis(out, 0, -1)).save(OUT, quality=88)
print("saved", OUT, f"{OUT.stat().st_size / 1e6:.1f} MB")

manifest["sources"]["naip"] = {
    "url": SERVICE,
    "title": "National Agriculture Imagery Program (NAIP) aerial orthoimagery, natural colour, 0.6 m",
    "mission": "USDA National Agriculture Imagery Program",
    "instrument": "Aerial camera",
    "publisher": "USDA Farm Service Agency, served by the USGS National Map",
    "year": 2025,
    "doi": "https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip",
    "citation": "USGS, USDA, The National Map: Orthoimagery (NAIP). Public domain.",
    "read_meta": {"bbox_lonlat": [west, south, east, north], "request_px": REQUEST_PX, "output_px": PX,
                  "output_m_per_px": size / PX},
}
manifest["sources"].pop("sentinel2", None)
MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print("manifest updated")
