# Test results

Run on 14 November 2026 (local time) on the build machine: Windows 10, 7.4 GB RAM, no GPU.

| Suite | Command | Result |
|---|---|---|
| Science unit tests | `cd science && python -m pytest` | **22 passed** |
| Mission service unit tests | `cd mission && go test ./...` | **34 passed** in 5 packages |
| Mission API end to end | `python scripts/smoke_mission.py` | **14 of 14 checks passed** |
| Interface walkthrough | `node scripts/ui_check.cjs <folder>` (headless Edge) | 13 screens captured; **no console errors, failed requests or HTTP errors** |
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
  science and full safety; there is no score before the traverse ends.
- Life-support needs scale with crew, the oxygen balance closes, a greenhouse adds load and water and
  reduces shipped food, insolation falls with latitude, and radiation dose scales with stay length and
  dose rate and is not applied to the Moon.
- The walkthrough clicks a point on Perseverance's path and waits for the terrain values and rover images;
  it also opens a CLPS delivery and waits for its Earth analog ranking.

## What is not tested

- No automated test checks the experiment numbers; they are reproduced by rerunning the experiments.
- The interface has a walkthrough with screenshots but no assertions on what is drawn.
- Keyboard-only use and screen readers were not tested.
- The Python API, the ground-view lookup and the climate summary have no unit tests; they were exercised
  through the interface walkthrough and by hand.
- A defect the unit tests missed was found by looking at the interface: the terrain-sample response had
  unnamed fields, so point inspection could not have worked. It is now covered by the end-to-end check.
- Nothing was tested on macOS or Linux.

## Notes

- `experiments/runs/20261115T011721Z-transfer` is an aborted run (a stale feature file was detected and the
  run stopped). It has a log and no metrics and is ignored by the services.
- During the build, the dataset job was stopped once by low memory and resumed without loss, and three
  regions were rebuilt after network errors. The builder now refuses to save a region when a source
  cannot be reached.
