"""Download NASA's 3D models for the 3D map view.

    python scripts/fetch_nasa_models.py

The files (about 50 MB together) are not stored in the repository. Without
them the map still works and shows movers as flat icons.

Sources and credits:
  perseverance.glb  NASA Science, "Mars Perseverance Rover, 3D Model"
                    https://science.nasa.gov/resource/mars-perseverance-rover-3d-model/  (NASA/JPL-Caltech)
  sev.glb           NASA 3D Resources, "Space Exploration Vehicle" (NASA's crewed surface rover concept)
  z2_suit.glb       NASA 3D Resources, "Z2 Spacesuit" (NASA's prototype planetary surface suit)
                    https://github.com/nasa/NASA-3D-Resources
"""
import pathlib
import urllib.parse
import urllib.request

REPO = "https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D Models/"
MODELS = {
    "perseverance.glb": "https://assets.science.nasa.gov/content/dam/science/psd/mars/resources/gltf_files/25042_Perseverance.glb",
    "sev.glb": REPO + "Space Exploration Vehicle/Space Exploration Vehicle.glb",
    "z2_suit.glb": REPO + "Z2 Spacesuit/Z2 Spacesuit.glb",
}

out_dir = pathlib.Path(__file__).resolve().parents[1] / "web" / "public" / "models"
out_dir.mkdir(parents=True, exist_ok=True)
for name, url in MODELS.items():
    out = out_dir / name
    if out.exists() and out.stat().st_size > 100_000:
        print(f"have  {name} ({out.stat().st_size / 1e6:.1f} MB)")
        continue
    safe = urllib.parse.quote(url, safe=":/")
    req = urllib.request.Request(safe, headers={"User-Agent": "Mozilla/5.0 (beyond-earth-labs)"})
    with urllib.request.urlopen(req, timeout=600) as r:
        data = r.read()
    if data[:4] != b"glTF":
        raise SystemExit(f"{name}: the download is not a binary glTF file; check {url}")
    out.write_bytes(data)
    print(f"saved {name} ({len(data) / 1e6:.1f} MB)")
