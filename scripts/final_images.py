"""Turn the photographs taken by scripts/ui_final.cjs into the pictures of the final presentation.

    python scripts/final_images.py <folder of ui_final.cjs screenshots> <folder of ui_models.cjs screenshots> docs/pitch/img/final

Every picture is a crop of a screenshot of the running product. Nothing is drawn or retouched.
"""
import pathlib
import sys

from PIL import Image

shots, models, out = (pathlib.Path(p) for p in sys.argv[1:4])
AERIAL = pathlib.Path(__file__).resolve().parents[1] / "surface-world" / "data" / "processed" / "shawnee" / "ortho.jpg"
out.mkdir(parents=True, exist_ok=True)


def save(name: str, src: pathlib.Path, box: tuple[float, float, float, float] | None = None, width: int | None = None):
    """Crop `src` to `box` (fractions of its size: left, top, right, bottom), optionally scale to `width`, save as JPEG."""
    if not src.exists():
        print("missing", src.name, "- kept the existing", name)
        return
    im = Image.open(src).convert("RGB")
    if box:
        w, h = im.size
        im = im.crop((round(box[0] * w), round(box[1] * h), round(box[2] * w), round(box[3] * h)))
    if width and im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(out / name, quality=90)
    print("saved", name, im.size)


# Cover: the Mars simulation during the route flyover, without the status strip along the bottom.
save("cover-mars.jpg", shots / "f6-mars-flyover-clean.png", (0, 0, 1, 0.885))
# The mission map with a planned route (2x screenshot, scaled for the slide).
save("map-route.jpg", shots / "f1-route.png", width=1760)
# The Route step after the 1 m check and the moved route.
save("check-1m.jpg", shots / "f3-moved.png", width=1760)
# Step 1 of "how it works": the map's own 3D terrain with the six-wheel crew rover (the map pane only).
save("step-plan.jpg", models / "21-3d-crew-rover.png", (0.285, 0.06, 0.80, 0.97))
# The Mars simulation: the flyover with its mission panel, the thermal layer from above, the movers at the base.
save("mars-sim.jpg", shots / "f5-mars-flyover.png")
save("mars-thermal.jpg", shots / "f7-mars-thermal.png", (0.235, 0.20, 0.735, 0.78))
save("mars-mission.jpg", shots / "f4-mars-mission.png", (0.24, 0.30, 0.74, 0.93))
# The Earth simulation, without the status strip.
save("earth-sim.jpg", shots / "f9-earth-rover-clean.png", (0, 0, 1, 0.885))
save("earth-panels.jpg", shots / "f8-earth-rover.png", (0, 0.30, 1, 1))
# The real aerial photograph of the Earth site (USDA NAIP): the bluffs and the trail, as fetched.
save("earth-aerial.jpg", AERIAL, (0.24, 0.33, 0.70, 0.60), width=1320)
