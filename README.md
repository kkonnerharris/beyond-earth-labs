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
   slope limits, a caution weight, time or energy objectives and an elevation profile.
4. **Crew safety.** A consumables check with reserves before departure, a standing rule during the
   traverse (the mover must always be able to get home with the reserve intact), and a radiation dose
   estimate from the rate Curiosity measured on the surface.
5. **Habitat.** Power, water, oxygen and food budgets with a greenhouse, plus NASA POWER climate records
   for the best-matching Earth test site.
6. **Simulation.** The mover follows the route; obstacles, dust storms, leaks and health faults change the
   plan, and the mission log records each decision and its reason. A finished traverse gets a score out of
   100 for science done, reserve kept and efficiency.
7. **Review.** A mission report, the model's held-out accuracy against baselines, and the limits of the build.

A training mode sets a task for each step and checks it against the live mission. A Moon view runs the
same terrain comparison on lunar regions and lists NASA's commercial lunar deliveries (CLPS) in NASA's own
words, linking the ones whose sites this build has measured.

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
../.venv/Scripts/python -m bel.experiments train-final --version v1
../.venv/Scripts/python -m bel.registry gate --version v1 --run <the eval run folder>
../.venv/Scripts/python -m bel.jezero build           # the Jezero mission area
cd ..

# 3. Mission service and web app
cd mission && go build -o bin/missiond.exe ./cmd/missiond && cd ..
cd web && npm install && npm run build && cd ..

# 4. Start everything (Windows PowerShell)
powershell -ExecutionPolicy Bypass -File scripts/services.ps1 start
# open http://localhost:4770
```

On macOS or Linux start the three processes by hand: `mission/bin/missiond`, `uvicorn bel.api:app --port 8310`
from `science/`, and `npm start` from `web/`.

## Tests

```bash
cd science && ../.venv/Scripts/python -m pytest          # terrain maths, grids, model machinery
cd mission && go test ./...                               # projection, mobility, planner, life support, mission
python scripts/smoke_mission.py                           # end to end through the mission API
node scripts/ui_check.cjs <screenshot folder>             # drives the interface in a headless browser
```

See [docs/TESTS.md](docs/TESTS.md) for the latest results.

## Layout

| Path | What |
|---|---|
| `science/bel/` | Python: data readers, terrain measurements, dataset, features, model, experiments, registry, analog ranking, tiles, API |
| `mission/` | Go: terrain grid, mobility models, A* planner, life support, mission state and simulation, HTTP API |
| `web/` | Next.js + MapLibre interface |
| `models/` | Trained head, its registry entry and the gate decision |
| `experiments/runs/` | Every experiment run with its metrics and log |
| `docs/` | Requirements, methods, data registry, model card, decisions, demo script, submission text |

## Documents

[Requirements traceability](docs/REQUIREMENTS.md) · [Methods](docs/METHODS.md) · [Data registry](docs/DATA.md) ·
[Model card](docs/MODEL_CARD.md) · [Decisions](docs/DECISIONS.md) · [Tests](docs/TESTS.md) ·
[Demo script](docs/DEMO.md) · [Submission text](docs/SUBMISSION.md) · [AI use](docs/AI_USE.md)
