# Test results

Run on 15 November 2026 (local time) on the build machine: Windows 10, 7.4 GB RAM, no GPU.

| Suite | Command | Result |
|---|---|---|
| Science unit tests | `cd science && python -m pytest` | **22 passed** |
| Mission service unit tests | `cd mission && go test ./...` | **37 passed** in 5 packages |
| Mission API end to end | `python scripts/smoke_mission.py` | **14 of 14 checks passed** |
| Interface walkthrough | `node scripts/ui_check.cjs <folder>` (headless Edge) | 22 screens captured, including 3D terrain, the three globes, the links between worlds, training mode and the guide page; **no console errors, failed requests or HTTP errors** |
| Space view, 3D models, hand driving | `node scripts/ui_models.cjs <folder>` (headless Edge) | Solar system view, and each mover's NASA model in 3D and in the surface view after driving by keyboard; no console or HTTP errors |
| Type check and production build | `tsc --noEmit`, `next build` | clean |
| `go vet`, `gofmt` | | clean |

## What the tests cover

**Science (`science/tests/`)**
- Slope of a tilted plane is exact at 0, 1, 5, 15 and 30 degrees, in any direction, and scales with cell size.
- Roughness ignores regional tilt and responds to bumps.
- Local grids are metric and north-up on Mars, the Moon and Earth, centred on the requested point.
- The head learns a synthetic problem, its embedding is unit length, embedding distance tracks physical
  distance, save and load round-trip, the CORAL term runs.
- The standardiser is fitted on training cells only.
- Classical features are finite and respond to texture; normalisation removes a sensor's brightness scale.

**Mission (`mission/internal/...`)**
- The Go map projection matches PROJ at the four corners of the real Jezero grid to under 12 cm, and the
  landing site's elevation is where it should be.
- Rover energy on flat ground equals a hand calculation; uphill costs more; braking recovers nothing; the
  Moon costs less than Mars; limits are hard.
- No mover can ever beat the bounds the planner's heuristic relies on (checked over grades, roughness and both bodies).
- Routes are straight on flat ground, go through the only gap in a steep wall, report "no route" when
  sealed, avoid reported hazards, and the energy objective never uses more energy than the time objective.
- On the real Jezero grid, routes for all three movers stay within their slope limits.
- The simulation reproduces the plan's distance, time and consumable use to within 1%.
- An infeasible plan is refused with numbers. An obstacle forces a replan that stays out of the keep-out
  area, including when injected while stopped at a target. A leak turns the traverse back before the
  reserve is broken. A dust storm orders a return and cuts habitat solar. A health fault lengthens the
  traverse. Reset restores the mission. A nominal traverse scores 100; an early turn-back scores no
  science and full safety; there is no score before the traverse ends. The health monitor tracks
  workload, raises no alert on a nominal walk, flags the injected fault, and does not monitor the scout.
- Life-support needs scale with crew, the oxygen balance closes, a greenhouse adds load and water and
  reduces shipped food, insolation falls with latitude, and radiation dose scales with stay length and
  dose rate and is not applied to the Moon.
- The walkthrough clicks a point on Perseverance's path and waits for the terrain values and rover images;
  it also opens a CLPS delivery and waits for its Earth analog ranking.
- The walkthrough also covers the links that join the parts (added 15 November): it picks a 45-minute
  science activity and waits for it on the target, moves from Crew to Habitat with the footer's Continue
  button, waits for the crew monitor in the Simulate step, opens the "How the parts worked together" list,
  opens a Mars match from the Earth view and waits for the Region step's note, opens the habitat's field
  site on the Earth map, returns to Mars, and turns training mode on.

## What is not tested

- No automated test checks the experiment numbers; they are reproduced by rerunning the experiments.
  Experiment E6 (added 15 November) has no unit test of its own; its shared-head row reproduced E1's
  figures (0.64, 0.82, 0.31), which is the check that it uses the same folds and metric.
- The interface has a walkthrough with screenshots but no assertions on what is drawn.
- Keyboard-only use and screen readers were not tested.
- The Python API, the ground-view lookup and the climate summary have no unit tests; they were exercised
  through the interface walkthrough and by hand.
- A defect the unit tests missed was found by looking at the interface: the terrain-sample response had
  unnamed fields, so point inspection could not have worked. It is now covered by the end-to-end check.
- The 3D terrain tiles, the rover model layer and analog ranking from Earth have no unit tests; they
  were checked by decoding a tile, by direct calls and by looking at the screenshots.
- Two defects were found only by looking at screenshots: a camera move cancelled the 3D tilt, and map
  tiles that failed to download once were cached as permanently empty. Both are fixed.
- Hand driving is unit-tested in Go (limits, blocking, the map edge, reset) and exercised by keyboard in
  the browser. Whether the models face exactly the way they move was judged by eye from screenshots.
- A third defect found by measuring, not by tests: the chase camera aimed at sea level while the 3D
  ground sat 208 m lower, which put the mover off-screen. The camera is now anchored to the ground height.
- The "Carried forward" wording, the training-task checks and the session best score have no unit tests;
  they were read off the walkthrough's screenshots.
- The last web build after the walkthrough changed only the guide page (one added picture); that page and
  its picture were then fetched and returned HTTP 200, and the walkthrough was not rerun.
- The pitch deck (`docs/pitch/`) is checked by `scripts/pitch_pdf.cjs`, which reports missing pictures,
  fonts that did not load and any slide taller than its page; it printed five pages with none of those.
- Nothing was tested on macOS or Linux.

## Notes

- `experiments/runs/20261115T011721Z-transfer` is an aborted run (a stale feature file was detected and the
  run stopped). It has a log and no metrics and is ignored by the services.
- During the build, the dataset job was stopped once by low memory and resumed without loss, and three
  regions were rebuilt after network errors. The builder now refuses to save a region when a source
  cannot be reached.
