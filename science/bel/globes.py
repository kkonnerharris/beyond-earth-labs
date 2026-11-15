"""Whole-body images for the outer-space view.

Each is one equirectangular image (2048 x 1024) that the interface wraps
around a sphere. They are display images only.

    Mars   Viking colour mosaic (MDIM 2.1), NASA Solar System Treks, stitched from level-2 tiles
    Moon   LROC Wide Angle Camera mosaic, NASA Solar System Treks, stitched from level-2 tiles
    Earth  Blue Marble shaded relief and bathymetry, NASA GIBS (one WMS request)
"""
from __future__ import annotations

import io

import numpy as np

from . import DATA_DIR, tiles
from .remote import _http

CACHE = DATA_DIR / "tilecache" / "globes"
GIBS_WMS = ("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
            "&LAYERS=BlueMarble_ShadedRelief_Bathymetry&STYLES=&FORMAT=image/jpeg&CRS=EPSG:4326"
            "&BBOX=-90,-180,90,180&WIDTH=2048&HEIGHT=1024")
TREK = {"mars": "mars_viking", "moon": "moon_wac"}
CREDIT = {"mars": "Viking Orbiters colour mosaic, NASA Solar System Treks",
          "moon": "LROC Wide Angle Camera mosaic, NASA Solar System Treks",
          "earth": "Blue Marble, NASA GIBS"}


def texture(body: str) -> bytes:
    """JPEG bytes of the whole-body image; cached on disk after the first request."""
    from PIL import Image

    if body not in CREDIT:
        raise KeyError(body)
    path = CACHE / f"{body}.jpg"
    if path.exists() and path.stat().st_size > 10_000:
        return path.read_bytes()
    if body == "earth":
        r = _http().get(GIBS_WMS, timeout=180)
        r.raise_for_status()
        data = r.content
        if data[:2] != b"\xff\xd8":
            raise IOError("NASA GIBS did not return an image")
    else:
        layer, z = tiles.LAYERS[TREK[body]], 2          # level 2 is 8 x 4 tiles of 256 px
        mosaic = np.zeros((4 * 256, 8 * 256, 3), dtype=np.uint8)
        for row in range(4):
            for col in range(8):
                t = tiles._fetch(layer, z, row, col)    # raises if NASA's server cannot be reached
                if t is not None:
                    mosaic[row * 256:(row + 1) * 256, col * 256:(col + 1) * 256] = t[..., :3].astype(np.uint8)
        buf = io.BytesIO()
        Image.fromarray(mosaic, "RGB").save(buf, format="JPEG", quality=90)
        data = buf.getvalue()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data
