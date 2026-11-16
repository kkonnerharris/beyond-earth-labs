# Beyond Earth Labs — Martian Map

**NASA Space Apps Challenge 2026 · Interplanetary Survival Guide: Martian Map**

A layered map of Jezero Crater for planning and carrying out a Marswalk. It combines data from five NASA
missions, plans routes that respect slope and consumables, compares Martian terrain with test sites on
Earth using a neural network trained on NASA data from three bodies, and runs the traverse as a
simulation with emergencies and replanning.

> Planning aid built during a hackathon. Routes, times and consumables are estimates from stated
> assumptions. Nothing here is certified for spacecraft operations or crew safety.

## What it does

1. **Map.** Jezero imagery at 6 m and 25 cm (MRO CTX and HiRISE), thermal infrared (Mars Odyssey THEMIS),
   slope from a 20 m elevation model (MRO CTX), global context (Viking, MOLA), and Perseverance's real
   path (Mars 2020). Click a point for its elevation and slope, whether each mover can cross it, and what
   Perseverance's cameras saw from the nearest stop. Every layer and number is tagged NASA data,
   calculated, model, simulated or assumption.
2. **Earth analogs.** A terrain network ranks 29 Earth regions against any of 39 Mars or 28 Moon regions.
   Each candidate shows the network's similarity, an independent similarity from elevation data, and
   whether published literature supports it as an analog.
3. **Routes.** A* over measured terrain for a robotic scout, a crew rover or an astronaut on foot, with
   slope limits, a caution weight, time or energy objectives and an elevation profile. Each target gets a
   science activity from a list, and its time on site counts against consumables. A planned route can then
   be **checked on NASA's 1 m HiRISE elevation model**: the 20 m plan cannot see a bank a few metres wide,
   the 1 m model can. The check lists every stretch steeper than the mover's limit and, when asked, moves
   the route off the steep ground it can avoid and says what it could not.
4. **Crew safety.** A consumables check with reserves before departure, a standing rule during the
   traverse (the mover must always be able to get home with the reserve intact), and a radiation dose
   estimate from the rate Curiosity measured on the surface.
5. **Habitat.** Power, water, oxygen and food budgets with a greenhouse, plus NASA POWER climate records
   for the best-matching Earth test site.
6. **Simulation.** The mover follows the route; obstacles, dust storms, leaks and health faults change the
   plan, and the mission log records each decision and its reason. A finished traverse gets a score out of
   100 for science done, reserve kept and efficiency.
7. **Review.** A mission report, the model's held-out accuracy against baselines, and the limits of the build.

A training mode sets a task for each step and checks it against the live mission.

**3D and three worlds.** "Space view" shows the whole solar system with each planet in its direction
from the Sun today; Earth, the Moon and Mars carry NASA imagery and open their maps. "Surface view" drops
to ground level behind your rover or astronaut and lets you drive by hand with W, A, S, D, under the same
slope limits as a planned route. Zoomed out, each is a globe. At Jezero, "3D terrain" tilts the view and
raises the surface from the measured elevation model, and every mover is a 3D model: the six-wheel
crew rover, NASA's Perseverance model for the scout rover, and NASA's Z-2 suit for the astronaut. The Moon view runs the same terrain comparison
on lunar regions and lists NASA's commercial lunar deliveries (CLPS) in NASA's own words. The Earth view
turns the comparison around: pick a test site and see which Mars or Moon terrain it most resembles, with
its NASA climate record. Missions, routes and the simulation are on Mars only.

**The 3D simulation.** The "3D simulation" buttons (top bar, above the map, and on the start screen) open
a full 3D scene with a rover and an astronaut, on Mars or on Earth. The Earth one is Garden of the Gods
in Shawnee National Forest, Illinois, on USGS elevation with a real aerial photograph (USDA NAIP) on the
ground. The Mars one opens the same mission in a full 3D scene of Jezero
(`surface-world/`): 2 km of HiRISE terrain at 5 m around the landing site, inside 80 km of CTX terrain.
It reads the plan from the mission service and draws it on the ground: every leg, a beacon at each
target, and the stretches the 1 m check found too steep, in red. "Fly the route" takes the camera along
the whole traverse; "Drive it" sends the rover down the mission's first leg on the 5 m terrain, steering
round rocks the 20 m plan cannot see; "Walk it" does the same for the astronaut on foot, as far as the
suit's oxygen covers the way back and a reserve. It opens in the map's place, beside the mission steps. The crew rover is the same six-wheel rover in both places: the
vehicle a route is planned for in the map is the vehicle that drives it in the 3D world.

A guide to every feature is built into the site at `/guide`.

## One map, seven challenge themes

The entry is the Martian Map. Six other Space Apps 2026 challenge themes were built as parts of that one
map, so a single mission passes through all of them and each part changes the others.

| Challenge theme | What it became in the map |
|---|---|
| **Interplanetary Survival Guide: Martian Map** (the challenge entered) | The layered Jezero map, routes and the simulated Marswalk |
| Identify Earth Locations That Analog Moon and Mars | Earth analog search by the terrain network; its top match is the habitat's field site |
| Create Health Monitoring Software for Astronauts | Crew health monitor and radiation estimate, live during the traverse |
| Field Shift: Adapting Farms with NASA Data | Greenhouse budget beside NASA climate records for the field site |
| Space Mission Design Game | A scored traverse with a best score to beat |
| Build a Junior Astronaut Mission Trainer | Training mode: one plain-worded task per step, checked on the live mission |
| CLPS Lunar Mission Browser | NASA's lunar deliveries with terrain comparison for their landing regions |

The bar at the bottom of every step carries each decision into the next step, matches open on their own
world's map, and the Review step lists what every part did in the mission just run.
[docs/CHALLENGES.md](docs/CHALLENGES.md) explains each theme: what it contributed, where it is, what NASA
data it uses and what was left out.

## What the evidence shows

Measured on regions the network never saw in training (details in [docs/METHODS.md](docs/METHODS.md)):

| Question | Result |
|---|---|
| Held-out Mars regions, mean R² over slope, relief, roughness | trained head **0.64**, linear probe 0.60, best classical baseline 0.52 |
| Held-out Moon / Earth regions | head 0.82 / 0.31 |
| Train on Earth + Moon, test on Mars, no adaptation | head 0.05 (classical baseline 0.21) |
| Same, with label-free per-body normalisation | head **0.42** |
| Train on Mars + Moon, test on Earth | fails: −0.05 at best |
| Mars cell → nearest Earth cells, share of the random-to-ideal gap closed | head **0.52**, untrained DINOv2 0.17, classical −0.18 |

Plainly: the trained head beats the baselines within a body and is much better at finding physically
similar Earth terrain. Transfer to Mars works only after a label-free normalisation step, and reaches
about two thirds of the in-domain accuracy. Transfer to Earth does not work. Earth and Moon data help
most when few Mars regions are labelled; with 16 labelled Mars regions, Mars-only training is as good.

## Run it

Requirements: Python 3.12, Go 1.22 or newer, Node.js 20 or newer. About 2 GB of disk. No GPU needed.

```bash
# 1. Python environment
python -m venv .venv
.venv/Scripts/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/python -m pip install -r science/requirements.txt

# 2. Data, features, experiments, model (from science/)
cd science
../.venv/Scripts/python -m bel.dataset build          # about 20 minutes, 96 regions from live NASA sources
../.venv/Scripts/python -m bel.features extract       # about 15 minutes on a laptop CPU
../.venv/Scripts/python -m bel.experiments run --only E2 --tag transfer
../.venv/Scripts/python -m bel.experiments run --only E1 E3 E4 E5 --tag eval
../.venv/Scripts/python -m bel.experiments run --only E6 --tag perworld
../.venv/Scripts/python -m bel.experiments train-final --version v1
../.venv/Scripts/python -m bel.registry gate --version v1 --run <the eval run folder>
../.venv/Scripts/python -m bel.jezero build           # the Jezero mission area
cd ..

# 3. Mission service and web app
cd mission && go build -o bin/missiond.exe ./cmd/missiond && cd ..
cd web && npm install && npm run build && cd ..
python scripts/fetch_nasa_models.py                   # optional: NASA's 3D models for the 3D view (50 MB)

# 4. Start everything (Windows PowerShell)
powershell -ExecutionPolicy Bypass -File scripts/services.ps1 start
# open http://localhost:4770
```

On macOS or Linux start the processes by hand: `mission/bin/missiond`, `uvicorn bel.api:app --port 8310`
from `science/`, `uvicorn backend.api.main:app --port 8320` from `surface-world/` (the 3D world; its
built interface is in the repository), and `npm start` from `web/`.

## Tests

```bash
cd science && ../.venv/Scripts/python -m pytest          # terrain maths, grids, model machinery
cd mission && go test ./...                               # projection, mobility, planner, life support, mission
cd surface-world && ../.venv/Scripts/python -m pytest    # the 3D world: terrain, planner, the mission link
python scripts/smoke_mission.py                           # end to end through the mission API
node scripts/ui_check.cjs <screenshot folder>             # drives the interface in a headless browser
node scripts/ui_world.cjs <screenshot folder>             # plans a mission and checks the 3D world shows the same plan
```

See [docs/TESTS.md](docs/TESTS.md) for the latest results.

## Layout

| Path | What |
|---|---|
| `science/bel/` | Python: data readers, terrain measurements, dataset, features, model, experiments, registry, analog ranking, tiles, API |
| `mission/` | Go: terrain grid, mobility models, A* planner, life support, mission state and simulation, HTTP API |
| `web/` | Next.js + MapLibre interface |
| `surface-world/` | The 3D world: FastAPI service and react-three-fiber scene of Jezero, linked to the mission |
| `models/` | Trained head, its registry entry and the gate decision |
| `experiments/runs/` | Every experiment run with its metrics and log |
| `docs/` | The challenges behind the product, requirements, methods, data registry, model card, decisions, demo script, submission text |

## Documents

[The challenges behind the product](docs/CHALLENGES.md) · [Requirements traceability](docs/REQUIREMENTS.md) · [Methods](docs/METHODS.md) · [Data registry](docs/DATA.md) ·
[Model card](docs/MODEL_CARD.md) · [Decisions](docs/DECISIONS.md) · [Tests](docs/TESTS.md) ·
[Demo script](docs/DEMO.md) · [Submission text](docs/SUBMISSION.md) · [AI use](docs/AI_USE.md) ·
[Final presentation, 7 minutes (PDF)](docs/pitch/Beyond-Earth-Labs-final-presentation.pdf) with its [script](docs/pitch/final-script.md) ·
[Pitch deck, 3 minutes (PDF)](docs/pitch/Beyond-Earth-Labs-pitch.pdf) with [speaker notes](docs/pitch/speaker-notes.md)
