# The challenges behind the product

Beyond Earth Labs is entered in **one** NASA Space Apps 2026 challenge: *Interplanetary Survival Guide:
Martian Map*. Six other Space Apps 2026 challenge themes shaped what the map can do. This page says, for
each of the seven, what it contributed, where to find it in the product, what NASA data it uses, how it
connects to the rest, and what was left out.

The project brief set the rule the build followed: the Martian Map is the product, and every other theme
has to work as a capability of that map, not as a separate app.

> **About the rules.** The participant FAQ says a team works on one challenge. This entry is the Martian
> Map and nothing else is submitted. The six themes below are ideas that were built into that one map.
> If the project page mentions them, describe them the way this page does: as parts of the Martian Map.

> **About the titles.** The Martian Map and Space Mission Design Game titles were checked against their
> pages on spaceappschallenge.org on 15 November 2026. The other five are written as they appear in the
> project brief and should be checked against the official challenge list before they are quoted.

## At a glance

| # | Challenge theme | What it became | Where it is | Status |
|---|---|---|---|---|
| 1 | **Interplanetary Survival Guide: Martian Map** (the challenge entered) | The layered Jezero map, route planning, and the simulated Marswalk | Steps 1 Region, 3 Route, 6 Simulate; the map itself | Done, with stated limits |
| 2 | Identify Earth Locations That Analog Moon and Mars | Earth analog search by a terrain network, checked against elevation data | Step 2 Analogs; the Earth and Moon views | Done |
| 3 | Create Health Monitoring Software for Astronauts | Crew health monitor and radiation estimate | Step 4 Crew; live in step 6 Simulate | Partly: every reading is simulated |
| 4 | Field Shift: Adapting Farms with NASA Data | Greenhouse budget and NASA climate records for the Earth field site | Step 5 Habitat; the Earth view | Partly: climate only, no farm advice |
| 5 | Space Mission Design Game | Mission score with a best score to beat | Steps 6 Simulate and 7 Review | Partly: one scored scenario, no levels |
| 6 | Build a Junior Astronaut Mission Trainer | Training mode: one task per step, checked on the live mission | "Training mode" in the top bar | Partly: tasks, no lessons or quizzes |
| 7 | CLPS Lunar Mission Browser | NASA's lunar delivery list with terrain comparison for the landing regions | The Moon view | Partly: no landing points plotted |

"Partly" is used the same way as in [REQUIREMENTS.md](REQUIREMENTS.md): some of it works, and the gap is
stated below.

## How one mission passes through all seven

A user creates one mission and walks it through seven steps. Each step uses what the earlier ones decided.

1. **Region** (Martian Map). The Jezero map loads, with its check against Perseverance's real path.
2. **Analogs** (Earth analogs). The terrain network ranks Earth sites for the mission area. The best
   supported match becomes the mission's rehearsal site.
3. **Route** (Martian Map). The user picks who travels and what science to do at each target. The time
   each kind of science takes is added to the traverse.
4. **Crew** (health monitoring). The route is checked against oxygen or battery with a reserve. The
   radiation estimate and the health monitor are here.
5. **Habitat** (farms). The greenhouse is sized, and its lamps and water count against the habitat's
   power and water budget. NASA's climate record for the rehearsal site from step 2 is shown beside it.
6. **Simulate** (Martian Map, health monitoring, design game). The traverse runs. Emergencies change the
   plan, the crew monitor stays in view, and the finished traverse is scored.
7. **Review** (all of them). The mission report, a list of what each of the seven parts did in this
   mission, and the evidence for the terrain network.

Two side trips leave from the same mission and return to it:

- **Moon** (CLPS browser). NASA's lunar deliveries, with the same terrain network run on the regions they
  land in. "Return to Mars" brings the mission back as it was.
- **Earth** (Earth analogs, farms). Any test site, compared the other way round with Mars or the Moon,
  with its NASA climate record.

Training mode (junior trainer) runs across all seven steps: it sets one task per step and checks it
against the mission's real state.

### What one part changes in another

These links are what make it one product. Each was exercised in the interface walkthrough or the Go tests.

| Do this | And this changes |
|---|---|
| Run the analog search (step 2) | The Habitat step's field site becomes the top supported match, with its NASA climate record |
| Choose longer science at a target (step 3) | Traverse time and consumable use rise, so the Crew step's check can fail and the traverse be refused |
| Switch from a rover to the astronaut on foot (step 3) | The slope limit and the limiting consumable (oxygen instead of battery) change; choose the robotic scout and there is no crew to monitor |
| Add greenhouse area (step 5) | Grow-light load and water turnover rise, and the power margin falls |
| Inject a dust storm (step 6) | The traverse is ordered home and the habitat's solar supply drops |
| Inject a health fault (step 6) | The monitor raises an alert, the pace falls, and the margin to get home is recalculated |
| Inject an obstacle (step 6) | The route is replanned around a keep-out area, and the replan is recorded in the log, the report and the score |
| Open a lunar delivery site (Moon) | The same network ranks Earth sites for it, and each match opens on the Earth map |
| Do a training task (any step) | The trainer marks it done from the mission's state, not from a button press |

The interface shows these links in three places: the bar at the bottom of every step ("Carried forward"),
the buttons that open a match on its own world's map, and the "How the parts worked together" list in the
Review step. The list of parts shown there and in the built-in guide comes from one file,
`web/lib/parts.ts`, so the product and this page name the parts the same way.

## The seven, one at a time

### 1. Interplanetary Survival Guide: Martian Map (the challenge entered)

- **What it contributed.** The product itself: a layered map of Jezero Crater for planning and carrying
  out a Marswalk. Requirement by requirement, see [REQUIREMENTS.md](REQUIREMENTS.md) section A.
- **In the product.** Eight switchable layers, point inspection with Perseverance's own camera frames,
  3D terrain, a ground-level surface view that can be driven by hand, routes for three kinds of mover,
  science activities at each target, and a simulated traverse with four kinds of emergency.
- **NASA data.** Mars Reconnaissance Orbiter (HiRISE and CTX imagery, CTX elevation), 2001 Mars Odyssey
  (THEMIS thermal infrared), Mars Global Surveyor (MOLA elevation), Viking (global colour), Mars 2020
  (Perseverance's path and navigation-camera images).
- **Code.** `web/components/MapView.tsx`, `science/bel/{jezero,tiles,terrain3d,views}.py`,
  `mission/internal/{terrain,mobility,planner,mission}`.
- **Checked at 1 m, seen in 3D.** A planned route can be measured on NASA's 1 m HiRISE elevation model
  and moved off the steep ground it finds. The "3D world" (`surface-world/`) opens the same mission in a
  full 3D scene, draws the plan and the 1 m result on the ground, flies the route and drives its first
  leg on 5 m terrain.
- **Left out.** Routes are planned on 20 m cells; the 1 m check sees banks and rims but not single rocks
  or ripples. No radiation map layer and no space-weather feed. Science targets are placed by the user,
  not suggested from mineral data. The 3D world reads the mission and does not write back to it.

### 2. Identify Earth Locations That Analog Moon and Mars

- **What it contributed.** The project's main technical idea: a terrain network trained on NASA data from
  Earth, Mars and the Moon that ranks Earth sites against any Mars or Moon region, and the reverse.
- **In the product.** Step 2 for the mission area, the same search for any of 39 Mars and 28 Moon
  regions, and from any of 29 Earth sites towards Mars or the Moon. Each candidate shows the network's
  similarity, an independent similarity from elevation data, and whether published work supports it as an
  analog or it is only a look-alike. Control regions (farmland, forest, alpine) are in the list on purpose.
- **How it feeds the Marswalk.** It answers where the traverse could be rehearsed. That site is carried
  into the Habitat step as the field site.
- **NASA data.** MOLA and THEMIS (Mars), LOLA and LROC Wide Angle Camera (Moon), Harmonized Landsat
  Sentinel-2 and NASADEM (Earth). Copernicus GLO-30 (ESA) covers two Earth sites north of 60 degrees.
- **Code.** `science/bel/{dataset,features,model,experiments,registry,analog,sites}.py`.
- **What the evidence supports.** On held-out Mars regions the trained head reaches R² 0.64 against 0.52
  for the best classical baseline. Trained on Earth and the Moon only, it does not transfer to Mars (0.05)
  until a label-free normalisation step is added (0.42). Transfer to Earth fails. Details and the other
  results are in [METHODS.md](METHODS.md).
- **Left out.** The network works at an 11 km scale and is not used for route costs. Some literature
  citations for the Earth sites were written from memory and need a human check.

### 3. Create Health Monitoring Software for Astronauts

- **What it contributed.** The idea that the map should watch the crew, not only the route.
- **In the product.** Step 4 shows the consumables check, the standing rule that the mover must always be
  able to get home with the reserve intact, a radiation dose estimate, and a health monitor with metabolic
  rate, heart rate, fatigue and a heart-rate trace. The monitor raises an alert when heart rate stays
  15 bpm above what the workload explains for 2 minutes. Its main readings are repeated in step 6 so an
  alert is seen while the traverse is being run.
- **How it feeds the Marswalk.** An alert reduces the pace, which lengthens the traverse and changes the
  margin to get home. The mission log records it.
- **NASA data.** One value: the surface dose rate measured by Curiosity's radiation detector at Gale
  crater, entered from memory and flagged for checking.
- **Code.** `mission/internal/mission/health.go`, `mission/internal/lifesupport`.
- **Left out.** Every health reading is simulated from workload. No person is measured, no real
  physiological data is used, and this is not a medical device. The dose rate is from Gale, not Jezero.

### 4. Field Shift: Adapting Farms with NASA Data

- **What it contributed.** The link between growing food on Mars and field work on Earth.
- **In the product.** Step 5 sizes a greenhouse crop by crop and shows what it does to power, water and
  shipped food. Below it is NASA's climate record for the rehearsal site: temperature, precipitation,
  growing season and sunlight for plants, comparing 1984 to 1993 with 2015 to 2024. The Earth view shows
  the same record for any of the 29 sites.
- **How it feeds the Marswalk.** The greenhouse's lamps and water are part of the habitat budget the
  mission leaves from, and the sunlight figure on Earth is what a Mars greenhouse must supply with lamps.
- **NASA data.** NASA POWER monthly climate records (MERRA-2 and CERES).
- **Code.** `science/bel/power.py`, `mission/internal/lifesupport`.
- **Left out.** No MODIS vegetation or SMAP soil moisture, no crop-rotation analysis and no advice to
  farmers. A difference between two decades describes the record; it is not a tested trend. Crop yield,
  light and water figures are assumptions flagged for checking.

### 5. Space Mission Design Game

- **What it contributed.** A reason to replay: a mission is scored, and the score explains itself.
- **In the product.** A finished traverse is scored out of 100 by the mission service: 60 for science
  (targets visited), 25 for safety (home with the reserve untouched), 15 for efficiency. Each part states
  its reason. The best score of the session is kept beside it, and the simulation can be reset and
  replayed with a different mover, route, science plan or caution setting.
- **How it feeds the Marswalk.** It turns the plan into something that can be compared with another plan.
- **NASA data.** None of its own; it scores a traverse planned on the NASA terrain data.
- **Code.** `mission/internal/mission/score.go`; the best score is kept in the browser only.
- **Left out.** No levels, budgets or launch design. The weights are this project's choice, not a NASA
  standard.

### 6. Build a Junior Astronaut Mission Trainer

- **What it contributed.** A guided way through the product for a young or first-time user.
- **In the product.** Training mode shows one task per step in plain words, with one sentence on why it
  matters. Each task is checked against the live mission: clicking the real rover's path, running the
  analog search, getting an accepted route, trying the trip on foot, growing 20% of the food, adding an
  obstacle and still scoring 70, and opening the review.
- **How it feeds the Marswalk.** It teaches the same mission the rest of the product runs; there is no
  separate training scenario.
- **NASA data.** None of its own.
- **Code.** The task list is `COACH` in `web/app/page.tsx`.
- **Left out.** No lessons, quizzes or reading-level testing with children.

### 7. CLPS Lunar Mission Browser

- **What it contributed.** The Moon as a second destination for the same pipeline.
- **In the product.** The Moon view lists all 15 deliveries on NASA's CLPS page in NASA's own words,
  filtered by flown or planned. Four name a site inside a lunar region this build has measured; one click
  opens that region's terrain and its Earth analogs, and each analog opens on the Earth map.
- **How it feeds the Marswalk.** It shows the terrain network and the analog search are not tied to Mars,
  which is the point of training on three bodies. The mission is kept while the user is on the Moon.
- **NASA data.** The CLPS Deliveries page on science.nasa.gov (text, read 14 November 2026), LOLA
  elevation and the LROC Wide Angle Camera mosaic from the Lunar Reconnaissance Orbiter.
- **Code.** `science/bel/clps.py`, `ClpsBrowser` in `web/components/Steps.tsx`.
- **Left out.** NASA's page gives no coordinates, so landing points are not plotted. Polar sites have no
  terrain analysis. There are no lunar routes or missions.

## Where each theme is checked

| Theme | Check |
|---|---|
| Martian Map | Go tests for projection, mobility, planner and simulation; the mission API end-to-end check; the interface walkthrough |
| Earth analogs | Experiments E1 to E6 and the validation gate; the walkthrough runs the search on Mars, the Moon and Earth |
| Health monitoring | Go tests: the monitor tracks workload, raises no alert on a nominal walk, flags the injected fault, and does not monitor the scout |
| Farms | Go tests for the greenhouse budget; the walkthrough loads the NASA POWER record and opens the field site on the Earth map |
| Design game | Go tests: a nominal traverse scores 100, an early turn-back scores no science and full safety, and there is no score before the end |
| Junior trainer | The walkthrough turns training mode on and waits for the task; the task checks themselves have no unit tests |
| CLPS browser | The walkthrough opens a delivery and waits for its Earth analog ranking |

Results are in [TESTS.md](TESTS.md).
