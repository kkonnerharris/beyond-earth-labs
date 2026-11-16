"""Build the whole application for GitHub Pages (docs/app/), where nothing runs but the browser.

    python scripts/build_pages_app.py [--no-prefetch]
    (the science service must be running on port 8310; build the 3D simulation copy with build_pages.py)

GitHub Pages serves files only. The product has two services, so each is handled differently:

  Mission service (Go)   compiled to WebAssembly from the same code and run in the page. Routes, supply
                         checks, the habitat budget, the traverse simulation, emergencies and the score
                         are computed in the browser exactly as on the server.
  Science service (Py)   its answers are saved as files: the Jezero terrain description, Perseverance's
                         path, the regions of three worlds, the Earth analog ranking for every region, the
                         climate record of every Earth site, the lunar delivery list, the map tiles that
                         have been viewed, the 3D elevation tiles, the overlays and the globe images.

What the copy cannot do, and says so when asked: the 1 m elevation check and the rover camera frames,
which read NASA's servers live. Map tiles that were never viewed while building are blank. Colour tiles
(the Viking mosaic) are saved with a 256-colour palette to keep the copy small.
"""
import concurrent.futures
import json
import math
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
OUT = ROOT / "docs" / "app"
SCIENCE = "http://127.0.0.1:8310"
BASE_PATH = "/beyond-earth-labs/app"
WORLD_PATH = "/beyond-earth-labs/sim"
GO = shutil.which("go") or str(ROOT.parent.parent / "Tools" / "go" / "bin" / "go.exe")


def get(path: str, timeout: float = 180) -> bytes:
    with urllib.request.urlopen(SCIENCE + path, timeout=timeout) as r:
        return r.read()


def safe(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", s)


def write(rel: str, data: bytes) -> None:
    p = OUT / "svc" / "science" / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


# ---------------------------------------------------------------- 1. tiles a visitor is likely to ask for
def tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def prefetch(deadline_s: float = 300) -> None:
    """Ask the running science service for the tiles around Jezero and the whole globes, so its cache has them."""
    wanted: list[str] = []
    # Around the mission area (a 9.6 km square at 18.465 N, 77.385 E), with a margin.
    w, e, s, n = 77.28, 77.50, 18.36, 18.57
    for key, zooms in (("jezero_ctx", range(9, 15)), ("jezero_hirise", range(12, 16)), ("mars_viking", range(4, 9)),
                       ("mars_themis_day", range(4, 10))):
        for z in zooms:
            x0, y0 = tile(w, n, z)
            x1, y1 = tile(e, s, z)
            wanted += [f"/tiles/{key}/{z}/{x}/{y}.png" for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    for z in range(9, 13):
        x0, y0 = tile(w, n, z)
        x1, y1 = tile(e, s, z)
        wanted += [f"/jezero/dem/{z}/{x}/{y}.png" for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    # The whole planet at low zoom, for the globes.
    for key in ("mars_viking", "moon_wac"):
        for z in range(0, 4):
            wanted += [f"/tiles/{key}/{z}/{x}/{y}.png" for x in range(2 ** z) for y in range(2 ** z)]
    end = time.time() + deadline_s

    def one(path: str) -> bool:
        if time.time() > end:
            return False
        try:
            get(path, timeout=40)
            return True
        except Exception:  # noqa: BLE001 - a tile outside the data, or NASA's server is slow: skip it
            return False

    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        ok = sum(pool.map(one, wanted))
    print(f"prefetch: {ok} of {len(wanted)} tiles answered")


if "--no-prefetch" not in sys.argv:
    prefetch()

# ---------------------------------------------------------------- 2. the mission service for the browser
static_public = WEB / "public-static"
static_public.mkdir(exist_ok=True)
subprocess.run([GO, "build", "-ldflags=-s -w", "-o", str(static_public / "mission.wasm"), "./cmd/missiond"],
               cwd=ROOT / "mission", env=dict(os.environ, GOOS="js", GOARCH="wasm"), check=True)
goroot = subprocess.run([GO, "env", "GOROOT"], capture_output=True, text=True, check=True).stdout.strip()
shutil.copy2(pathlib.Path(goroot) / "lib" / "wasm" / "wasm_exec.js", static_public / "wasm_exec.js")
print(f"mission.wasm: {(static_public / 'mission.wasm').stat().st_size / 1e6:.1f} MB")

# ---------------------------------------------------------------- 3. the interface as plain files
env = dict(os.environ, NEXT_PUBLIC_STATIC="1", NEXT_PUBLIC_BASE_PATH=BASE_PATH, NEXT_PUBLIC_WORLD_URL=WORLD_PATH)
subprocess.run(["node", "node_modules/next/dist/bin/next", "build"], cwd=WEB, env=env, check=True)
exported = WEB / "out-static"
if not (exported / "index.html").exists():
    raise SystemExit("the static build did not produce index.html in web/out-static")
if OUT.exists():
    shutil.rmtree(OUT)
shutil.copytree(exported, OUT, ignore=shutil.ignore_patterns("cache", "*.map", "sev.glb"))
for name in ("mission.wasm", "wasm_exec.js"):
    shutil.copy2(static_public / name, OUT / name)

# ---------------------------------------------------------------- 4. the terrain the mission service plans on
(OUT / "svc" / "terrain").mkdir(parents=True, exist_ok=True)
for name in ("terrain.json", "terrain.bin"):
    shutil.copy2(ROOT / "data" / "jezero" / name, OUT / "svc" / "terrain" / name)

# ---------------------------------------------------------------- 5. the science service's answers
for path in ("/health", "/jezero/terrain", "/jezero/m2020", "/layers", "/model", "/clps", "/jezero/terrain3d"):
    write(path.lstrip("/") + ".json", get(path))
regions: dict[str, list[dict]] = {}
for body in ("mars", "moon", "earth"):
    raw = get(f"/regions?body={body}")
    regions[body] = json.loads(raw)
    write(f"regions/{body}.json", raw)
print("regions:", {b: len(r) for b, r in regions.items()})

missing: list[str] = []


def analog(region: str, target: str | None) -> None:
    q = f"/analogs?region={urllib.parse.quote(region)}&top=40" + (f"&target={target}" if target else "")
    try:
        write(f"analogs/{safe(region)}__{target or 'default'}.json", get(q))
    except Exception as exc:  # noqa: BLE001
        missing.append(f"analogs {region} {target or ''}: {exc!r}"[:120])


jobs = [(r["region"], None) for b in ("mars", "moon") for r in regions[b]]
jobs += [(r["region"], t) for r in regions["earth"] for t in ("mars", "moon")]
with concurrent.futures.ThreadPoolExecutor(4) as pool:
    list(pool.map(lambda j: analog(*j), jobs))
print(f"analog rankings saved: {len(jobs) - sum(1 for m in missing if m.startswith('analogs'))} of {len(jobs)}")


def climate(region: str) -> None:
    try:
        write(f"earth/climate/{safe(region)}.json", get(f"/earth/climate?region={urllib.parse.quote(region)}", timeout=120))
    except Exception as exc:  # noqa: BLE001 - NASA POWER did not answer for this site: the copy says so when asked
        missing.append(f"climate {region}: {exc!r}"[:120])


with concurrent.futures.ThreadPoolExecutor(4) as pool:
    list(pool.map(climate, [r["region"] for r in regions["earth"]]))
print(f"climate records saved: {len(regions['earth']) - sum(1 for m in missing if m.startswith('climate'))} of {len(regions['earth'])}")

# ---------------------------------------------------------------- 6. tiles, elevation tiles, overlays, globe images
cache = ROOT / "data" / "tilecache"
tiles = 0
for key in ("jezero_ctx", "jezero_hirise", "mars_viking", "mars_themis_day", "mars_themis_night", "mars_mola_shade", "moon_wac"):
    if (cache / key).exists():
        shutil.copytree(cache / key, OUT / "svc" / "science" / "tiles" / key, dirs_exist_ok=True)
        tiles += sum(1 for _ in (cache / key).rglob("*.png"))
if (cache / "jezero_dem").exists():
    shutil.copytree(cache / "jezero_dem", OUT / "svc" / "science" / "jezero" / "dem", dirs_exist_ok=True)
    tiles += sum(1 for _ in (cache / "jezero_dem").rglob("*.png"))
for body in ("mars", "moon", "earth"):
    write(f"globe/{body}.jpg", get(f"/globe/{body}.jpg"))
for body in ("mars", "moon"):
    try:
        (OUT / "svc" / "science" / "globe" / body).mkdir(parents=True, exist_ok=True)
        write(f"globe/{body}/relief.jpg", get(f"/globe/{body}/relief.jpg"))
    except Exception as exc:  # noqa: BLE001 - an older science service without the relief endpoint
        missing.append(f"relief {body}: {exc!r}"[:120])
for png in (ROOT / "data" / "jezero" / "overlays").glob("*.png"):
    write(f"jezero/overlay/{png.name}", png.read_bytes())

def slim(png: pathlib.Path) -> int:
    """Rewrite one imagery tile in the smallest PNG form that shows the same picture. Returns bytes saved.

    The service writes every tile as 32-bit colour with transparency. Most imagery is grey (CTX, HiRISE,
    THEMIS, LROC), so it is stored as 8-bit grey; colour imagery (Viking) is stored with a 256-colour
    palette. Transparency is kept where a tile has any. Elevation tiles are numbers, not pictures, and
    are never touched.
    """
    from PIL import Image

    before = png.stat().st_size
    try:
        im = Image.open(png).convert("RGBA")
    except Exception:  # noqa: BLE001 - the cache keeps an empty file where NASA has no tile: nothing to publish
        png.unlink()
        return before
    r, g, b_, alpha = im.split()
    opaque = alpha.getextrema()[0] == 255
    grey = r.tobytes() == g.tobytes() == b_.tobytes()
    if grey:
        out = r if opaque else Image.merge("LA", (r, alpha))
    elif opaque:
        out = im.convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    else:
        out = im
    out.save(png, optimize=True)
    return before - png.stat().st_size


tile_files = list((OUT / "svc" / "science" / "tiles").rglob("*.png"))
with concurrent.futures.ThreadPoolExecutor(6) as pool:
    saved = sum(pool.map(slim, tile_files))
print(f"map tiles rewritten smaller: {saved / 1e6:.0f} MB saved over {len(tile_files)} tiles")

size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
print(f"docs/app: {size / 1e6:.0f} MB in {sum(1 for f in OUT.rglob('*') if f.is_file())} files, {tiles} map tiles")
if missing:
    print("NOT SAVED (the copy will say these need the full app):")
    for m in missing:
        print("  ", m)
