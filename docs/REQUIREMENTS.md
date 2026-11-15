# Requirements traceability

Source: the official challenge page, *Interplanetary Survival Guide: Martian Map*,
<https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/>,
read on 2026-11-14 (page last published 2026-11-13). Quoted text is from that page.

Status key: **Done** = code exists and its tests or a live run passed. **Partly** = some of it works; the
gap is stated. **Not built** = nothing yet. Evidence for each test is in [TESTS.md](TESTS.md).

Last updated: 2026-11-14, end of the first build day.

## A. What the challenge asks for

| ID | Requirement (from the challenge statement) | How Beyond Earth Labs meets it | Status | Evidence |
|---|---|---|---|---|
| A1 | "create a layered, integrated view of a location or route on the Martian surface" | One workspace centred on a Jezero map with eight switchable layers | Done | `web/components/MapView.tsx`; interface walkthrough |
| A2 | "pulls together data from multiple NASA science missions" | Mars Reconnaissance Orbiter, 2001 Mars Odyssey, Mars Global Surveyor, Viking, Mars 2020 | Done | [DATA.md](DATA.md) |
| A3 | "help a human explorer plan and carry out a successful Marswalk" | Route planning with slope and consumable limits; a simulated traverse with a standing return rule | Done | `mission/internal/planner`, `mission/internal/mission`; 32 Go tests; `scripts/smoke_mission.py` |
| A4 | "while conducting new and exciting science along the way" | Science targets with dwell time; Earth analog sites for rehearsal | Partly | Targets carry a generic objective. No target suggestions from mineral or geologic data |
| A5 | "a map, tool, or interface a Mars astronaut could use ... using NASA data and tools" | Web app backed by two services; imagery served from NASA Solar System Treks | Done | Walkthrough ran with no errors |
| A6 | "identifying some scientific goals ... and the location the astronaut will explore" | "Create exploration mission", region step, targets placed on the map | Partly | Location and targets yes; goals are free text, not chosen from a list |
| A7 | "at least three kinds of data" | Optical (HiRISE, CTX, Viking), topographic (CTX elevation, MOLA), thermal (THEMIS) | Done | Layer panel |
| A8 | "what information might help a crew move safely" | Slope layer, point inspection (elevation, slope, passable for each mover), consumables check, return margin | Done | `GET /api/terrain/sample`; Crew step |
| A9 | "the radiation environment ... you might include space weather data" | Crew step: surface dose per sol, per traverse and per stay against the career limit, from the dose rate Curiosity measured | Partly | `mission/internal/lifesupport`; the rate is from Gale crater, not Jezero. No map layer and no space-weather feed. Both figures were entered from memory and are flagged for checking |
| A10 | "spacesuits and ... equipment ... how this might impact their mobility" | Suited walking speed and metabolic cost depend on grade and carried mass | Partly | `mission/internal/mobility`; model constants still need checking against the source papers |
| A11 | "a route map ... while avoiding significant obstacles" | A* route drawn on the map; keep-out areas; replanning | Partly | Avoids steep ground and reported hazards. Rocks smaller than a 20 m cell are not in the data |

## B. Optional considerations the statement lists

| ID | Consideration | Status | Note |
|---|---|---|---|
| B1 | Habitat display, tablet or helmet HUD | Partly | Habitat planning display only |
| B2 | A tool that generates maps of different locations | Partly | Regional analysis and analogs for 39 Mars regions; detailed routes for Jezero only |
| B3 | Maps of other destinations | Done | Moon view on LRO data with the same terrain comparison |
| B4 | Time frame | Done | Terrain has none; the mission clock is simulated and labelled |
| B5 | Point-of-view images from surface missions | Done | Click any point within 600 m of Perseverance's path: navigation-camera frames from the nearest rover stop (`science/bel/views.py`). Raw images from the stop, not the clicked point; viewing direction is not derived |
| B6 | Rovers, or astronauts in pairs | Partly | Scout rover, crew rover or one walker per mission; no joint traverses |

## C. What our own brief adds

| ID | Requirement | Status | Evidence or gap |
|---|---|---|---|
| C1 | A real neural network trained on real Earth, Mars and Moon data | Done | `models/terrain-head-v1`, 4,534 cells; [MODEL_CARD.md](MODEL_CARD.md) |
| C2 | Leakage-safe geographic splits | Done | Every split is by whole region (`bel/experiments.py`) |
| C3 | Non-deep-learning baselines | Done | Classical texture + ridge and + random forest; a mean predictor; a linear probe |
| C4 | Explicit domain-shift test | Done | E2 and E5 in [METHODS.md](METHODS.md) |
| C5 | Analogs that separate look-alikes from geologically supported sites | Done | Three separate pieces of evidence per candidate (`bel/analog.py`) |
| C6 | Model outputs on the map | Partly | Analog ranking and regional attributes are in the workspace. The model does not draw a map layer and is deliberately not used for route costs |
| C7 | Rover simulator: routes, energy, obstacles, replanning | Done | Go tests; walkthrough |
| C8 | Crew health and consumables | Partly | Consumables, pace, a simulated health fault and a radiation dose estimate. No physiological monitoring and no anomaly detection |
| C9 | Habitat, greenhouse, water, power; NASA Earth agriculture data | Partly | Budget and greenhouse done; NASA POWER climate at the field site done. No MODIS vegetation or SMAP soil moisture; no crop-rotation analysis |
| C10 | Lunar comparison and CLPS browser | Partly | Lunar terrain comparison done. All 15 deliveries on NASA's CLPS page are listed in NASA's own words, and 4 link to a measured lunar region with Earth analogs. NASA's page gives no coordinates, so landing points are not plotted; polar sites have no terrain analysis |
| C11 | Mission design game | Partly | A finished traverse is scored out of 100 by the mission service (science 60, safety 25, efficiency 15) with the reason for each part, and can be reset and replayed with a different mover, route or caution setting. No levels, budgets or launch design |
| C12 | Junior astronaut trainer | Partly | Training mode sets a task per step and checks it on the live mission, ending with "inject an obstacle and still score 70". No lessons or quizzes, and the wording is not written for children |
| C13 | Continuous-learning pipeline | Partly | Experiment runs are recorded; a validation gate decides deployment; a registry records it. No automatic dataset discovery, and no second model has been trained |
| C14 | Go for mission state; Python for science; PyTorch | Done | `mission/`, `science/` |
| C15 | PostgreSQL with PostGIS; object storage | Not built | Missions are saved as JSON files. PostGIS was not available on the build machine ([DECISIONS.md](DECISIONS.md) D7) |
| C16 | Next.js, TypeScript, Tailwind, MapLibre | Done | `web/` |
| C17 | Public repository, install instructions, methods, data registry, model card, tests, demo script, submission text | Partly | All written. Nothing has been committed or pushed, and no video exists |

## D. Event rules that constrain the build

| Rule (participant FAQ, read 2026-11-14) | Consequence |
|---|---|
| "Teams are not allowed to begin working on the challenges prior to the hackathon." | All code here was written during the event. Earlier practice projects were not copied. One public NASA data file already on the machine was reused as data, with its checksum recorded. |
| "teams are only permitted to work on one challenge" | The entry is the Martian Map. Other themes appear only as capabilities of that map. |
| AI tools may be used; the submission must describe how | [AI_USE.md](AI_USE.md) |
