# surface-world: the 3D world

A full 3D scene of Jezero Crater that shows the mission planned in the main map. It opens from the
**3D world** button in the main app (or **Open this route in the 3D world** in the Route step) and runs
as its own service on port 8320.

- **The same plan, on the ground.** The world reads the mission from the mission service and draws it:
  every leg of the route in orange, a beacon on each target, keep-outs, and in red the stretches NASA's
  1 m elevation model measured as too steep for the mover.
- **Fly the route.** The camera follows the whole traverse out to every target and back.
- **Drive it.** The six-wheel crew rover drives the mission's first leg on 5 m terrain. The mission route
  was planned on 20 m cells, so this world's own planner is asked to reach a point on it every 120 m and
  steers round rocks and steep 5 m cells in between. The panel reports how far the driven line strays
  from the mission line (a median of 2.6 m on the demonstration route).
- **Walk it.** The astronaut walks the same leg on foot, and stops where going further would leave the
  suit too little oxygen for the walk back and the reserve. A mission planned for an astronaut opens on
  the astronaut; one planned for a rover opens on the rover. Both stand at the mission base.
- **Earth too.** `?region=shawnee` runs the same rover and astronaut at Garden of the Gods, Illinois.
- Around that: keyboard driving, an astronaut on foot, five cameras, slope and thermal layers, and
  Perseverance's and Ingenuity's real paths.

Detailed terrain covers 2 km around the landing site (HiRISE, 5 m). Beyond it the route is drawn on an
80 km backdrop of CTX terrain, which shows the delta and the crater rim but is too coarse to drive. The
world reads the mission and never changes it.

## How it joins the mission

| File | What |
|---|---|
| `backend/api/mission_link.py` | Reads the mission from the mission service, converts it from longitude and latitude to this world's frame, and builds the drivable route for the first leg |
| `backend/api/main.py` | `/api/mission` and `/api/mission/drive`, beside the terrain and route endpoints |
| `frontend/src/simulation/navigation/MissionOverlay.tsx` | The route, target beacons, keep-outs and steep stretches in the scene |
| `frontend/src/simulation/terrain/ground.ts` | Ground height anywhere, so the route lies on the drawn backdrop |
| `frontend/src/dashboard/MissionLink.tsx` | The mission panel: Drive it, Fly the route, Hide |
| `frontend/src/simulation/camera/CameraRig.tsx` | The flyover and the whole-route view |
| `../scripts/ui_world.cjs` | Plans a mission and checks the world shows the same plan as the mission service |

The crew rover here (`frontend/src/simulation/rover/Rover.tsx`) and in the main map's 3D view
(`web/components/roverModel.ts`) are the same six-wheel rover, and the panels use the main map's type
and colours.

## Run

Started by `scripts/services.ps1 start` with the other services, or by hand from this folder:

    ../.venv/Scripts/python -m uvicorn backend.api.main:app --port 8320

The built interface is in `frontend/dist/`, so no Node build is needed to run it. To rebuild after
changing `frontend/src/`: `cd frontend && npm install && npm run build`.

The mission service is expected at `http://127.0.0.1:8300` (set `MISSION_URL` to change it). Open
`http://127.0.0.1:8320/?mission=<mission id>` for one mission; without an id the newest planned mission
is shown.

## Test

    ../.venv/Scripts/python -m pytest            # 36 tests: terrain, planner, energy, the mission link
    node ../scripts/ui_world.cjs <folder>        # plans a mission and checks the world shows the same plan

## Contents

- `backend/`: FastAPI service: terrain, rover and astronaut models, the 5 m route planner, the mission link.
- `frontend/src/`: the scene and panels (React, react-three-fiber). `frontend/dist/` is the built interface.
- `data/processed/`, `data/manifests/`: the 2 km Jezero terrain grid and imagery built from NASA HiRISE,
  CTX and THEMIS products and Mars 2020 localisation, with their provenance records.
- Three kinds of image are AI-generated and illustrative, not data: the fine surface grain textures, the
  horizon panorama used when no real backdrop is loaded, and the title image
  (`data/manifests/illustrative_assets.json`).
