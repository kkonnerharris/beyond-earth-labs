"""Build the shared copy of the 3D simulation for GitHub Pages (docs/sim/).

    python scripts/build_pages.py        (the 3D world service must be running on port 8320)

GitHub Pages serves files only: there is no mission service, no planner and no science service behind
it. So this publishes the part of the product that needs none of them, the 3D simulation itself:

  - the interface, built with VITE_STATIC=1 (paths relative to the page, server calls switched off);
  - the terrain of the Mars site and the Earth site, saved once from the running service as files;
  - the ground imagery those sites use.

In the shared copy the rover and the astronaut can be driven and walked by hand, the cameras and the
layers (slope, traversability, thermal infrared) work, and Perseverance's real path is drawn. Planning a
route and showing a mission from the main map need the full app, and the copy says so on screen.
"""
import json
import os
import pathlib
import shutil
import subprocess
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORLD = ROOT / "surface-world"
OUT = ROOT / "docs" / "sim"
SERVICE = "http://127.0.0.1:8320"

# 1. The interface.
env = dict(os.environ, VITE_STATIC="1")
subprocess.run(["node", "node_modules/vite/bin/vite.js", "build", "--outDir", str(OUT), "--emptyOutDir", "--base", "./"],
               cwd=WORLD / "frontend", env=env, check=True)

# 2. The terrain of each site, as the running service reports it, with its picture paths made relative.
(OUT / "api").mkdir(parents=True, exist_ok=True)
for region in ("jezero", "shawnee"):
    with urllib.request.urlopen(f"{SERVICE}/api/terrain?region={region}", timeout=120) as r:
        text = r.read().decode("utf-8")
    json.loads(text)                                   # fails loudly if the service returned something else
    text = text.replace('"/data/', '"./data/')
    (OUT / "api" / f"terrain-{region}.json").write_text(text, encoding="utf-8")
    print(f"saved terrain-{region}.json ({len(text) / 1e6:.1f} MB)")

# 3. The pictures the terrain files point to.
for region in ("jezero", "shawnee"):
    dst = OUT / "data" / region
    dst.mkdir(parents=True, exist_ok=True)
    for jpg in (WORLD / "data" / "processed" / region).glob("*.jpg"):
        shutil.copy2(jpg, dst / jpg.name)
        print("copied", region, jpg.name)

size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
print(f"docs/sim is {size / 1e6:.0f} MB in {sum(1 for f in OUT.rglob('*') if f.is_file())} files")
