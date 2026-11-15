"""Cut the pitch deck's pictures out of screenshots of the running product.

    python scripts/pitch_images.py <pitch shots> <docs/pitch/img>

<pitch shots> is the folder written by scripts/ui_pitch.cjs: the main app at 2880 x 1800 (the analog
panel at 800 x 1800) and the 3D world at 1920 x 1080. Every picture in the deck is a crop of the
product; nothing is drawn or generated for the deck.

A picture whose screenshot is not in <pitch shots> is left as it is, so one part can be retaken
(ONLY=analogs, app or world in ui_pitch.cjs) without the others. Files the deck does not use are removed.
"""
import sys
from pathlib import Path

from PIL import Image

shots, out = (Path(p) for p in sys.argv[1:3])
out.mkdir(parents=True, exist_ok=True)

# name: (source, (left, top, right, bottom))
CROPS = {
    # The 3D world (surface-world/): the rover with its planned route.
    "cover-rover": (shots / "w1-rover-route.png", (560, 0, 1600, 1080)),
    # The main app.
    "screen-check": (shots / "m3-crew.png", (0, 205, 797, 778)),         # the go / no-go check
    "screen-run": (shots / "m5-report.png", (0, 222, 797, 812)),         # the report after a replan
    "screen-analogs": (shots / "m6-analogs.png", (0, 500, 800, 1576)),   # Jezero's terrain and the top Earth match
    "plan-3d": (shots / "m7-terrain3d.png", (560, 390, 1560, 1110)),     # the map's own 3D terrain with a route
    "cover-space": (shots / "m8-space.png", (800, 0, 2640, 1704)),       # the solar system view
}


def target(name: str) -> Path:
    return out / (f"{name}.png" if name.startswith("screen-") else f"{name}.jpg")


wanted = {target(name).name for name in CROPS}
for old in out.glob("*"):
    if old.suffix.lower() in {".jpg", ".png"} and old.name not in wanted:
        old.unlink()
        print("removed", old.name)

for name, (src, box) in CROPS.items():
    if not src.exists():
        print(name, "kept as it is" if target(name).exists() else "MISSING", f"(no {src.name})")
        continue
    im = Image.open(src).convert("RGB").crop(box)
    if name.startswith("screen-"):
        im.save(target(name), optimize=True)      # interface text stays sharp as PNG
    else:
        im.save(target(name), quality=90, optimize=True)
    print(name, im.size)
