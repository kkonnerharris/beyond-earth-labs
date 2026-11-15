# Demonstration script

About four minutes. Start the services first (`scripts/services.ps1 start`) and open
<http://localhost:4770>. Load the page once beforehand so map tiles are cached.

Each step says what to click and the one thing to say. Numbers quoted here are what the build showed on
14 November 2026; read them off the screen rather than from this page.

| # | Do | Say |
|---|---|---|
| 1 | Start screen. Leave "Crew rover" selected. Click **Create exploration mission**. | "The challenge asks for a layered map an astronaut could use to plan and carry out a Marswalk. This is Jezero Crater, from five NASA missions." |
| 2 | **Region** step. Point at the white line on the map and the "Checked against the real rover" panel. | "The white line is where Perseverance actually drove. We used it to test our map: our elevation agrees with the rover's at 464 waypoints to about a metre, and the rover never crossed ground steeper than 18 degrees. That is where our 20 degree limit comes from." |
| 3 | Layers panel: tick **Slope**, then untick it. Tick **Thermal infrared, mission area**, untick. | "Optical, topographic and thermal data, each tagged as NASA data or calculated." |
| 3b | Click the map on the white rover path south of the landing site. | "Any point gives its elevation and slope and whether a walker or rover can cross it. And because Perseverance has been here, these are its own camera frames from a stop a few tens of metres away: what an astronaut should expect to see." |
| 4 | **Analogs** step. Click **Find Earth analogs for Jezero Crater**. Open the first card. | "Where on Earth should this mission be rehearsed? A network trained on Earth, Mars and Moon terrain ranks candidates. Each one shows two independent scores: what the network sees, and what elevation data measures. The label says whether the geology literature backs it." |
| 5 | Scroll to the bottom of the list. | "Farmland and alpine control regions land at the bottom. Salar de Uyuni is a real Mars analog, for salt flats, but it is nothing like Jezero's terrain, and the ranking says so." |
| 6 | **Route** step. Click **Add targets on the map**, click two points west of the landing site, press Esc. | "Two science targets. The route is planned on measured terrain and stays under the slope limit. The profile shows the climb." |
| 7 | Click **Astronaut on foot**. Then back to **Crew rover**. | "Same targets on foot: the service recalculates time and oxygen. If the walk needs more oxygen than the suit carries with a 25% reserve, it refuses the plan and says by how much." |
| 8 | **Simulate** step. **Start traverse**. After a few seconds click **Obstacle ahead**. | "The rover is under way. An obstacle is reported ahead. The mission service replans from the current position and logs why." |
| 9 | Click **Dust storm**. Drag **Time compression** to the right until the rover is home. | "A dust storm. The rule is to come home above optical depth 2. Watch the route change, and the habitat's solar supply drop in the log. Back at base the mission is scored: no science this time, full marks for safety." |
| 10 | **Crew** step. | "Throughout, one rule holds: the mover must always be able to get home with the reserve intact. The white mark is what the trip home needs from here. Below it, radiation: at the dose rate Curiosity measured, a 500-sol stay uses about half of a career limit before the journey is counted." |
| 11 | **Habitat** step. Drag **White potato** to about 100 m². Scroll to "Field site on Earth". | "Growing food adds lighting load and water turnover; both feed straight into the power margin. Below are NASA's climate records for the Earth site our model picked: the sunlight plants get there is what a Mars greenhouse must supply with lamps." |
| 12 | Top bar: **Moon comparison**. In the delivery list click **Terrain and Earth analogs for this site** on a flown mission. Switch back to **Mars**. | "The same pipeline and the same network on the Moon, from Lunar Reconnaissance Orbiter data. These are NASA's commercial lunar deliveries in NASA's words; for the sites we have measured, here is the terrain and where on Earth it could be rehearsed." |
| 13 | **Review** step. Scroll through the evidence tables. | "Here is what we can and cannot claim. On Mars regions it never saw, the trained network beats the classical baselines. Trained only on Earth and the Moon, it does not transfer to Mars until a label-free normalisation step is added. And it cannot go the other way, to Earth. The model was deployed by a gate on held-out data, and nothing has been retrained, so we claim no improvement over time." |

## If something goes wrong

- **A service dot is red.** Run `scripts/services.ps1 start` again and reload.
- **Map tiles are blank.** NASA Treks may be slow or rate-limiting. Tiles already seen are cached in
  `data/tilecache/`; pan back to an area you loaded before.
- **"Start traverse" is refused.** The plan fails the consumables check; the message gives the numbers.
  Pick the crew rover or move the targets closer.
- **Analog search says no model.** `models/deployed.json` is missing; rerun the gate command from the README.

## Video

No project video has been recorded. `node scripts/ui_check.cjs <folder>` saves a screenshot of each step,
which can serve as a storyboard.
