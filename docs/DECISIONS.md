# Engineering decisions

Each entry records a choice, the measurement or fact behind it, and what it costs.

## D1. One common scale for the cross-planetary dataset: 11.2 km cells

- Images at 100 m per pixel (112 x 112), elevation at 467 m per cell (24 x 24).
- Why: 100 m is the native resolution of the two global mosaics (THEMIS on Mars, LROC WAC on the Moon),
  and 463 m / 474 m are the native resolutions of the official MOLA and LOLA gridded products. Earth data
  (HLS 30 m, NASADEM 30 m) is averaged down to match.
- Slope depends on the baseline it is measured over, so elevation is brought to the same cell size on all
  three bodies before any slope is computed.
- Cost: this is a regional scale. It says which kind of terrain a place is, not where a boulder is.
  Route safety on the Jezero map uses measured metre-scale elevation instead, not this model.

## D2. Mars images are thermal infrared; Earth and Moon images are visible light

- THEMIS daytime infrared is the only global 100 m Mars mosaic. In daytime it is dominated by sunlit and
  shaded slopes, so it shows landforms, but it is not the same kind of measurement as a visible image.
- This is a real domain shift and is treated as one: experiment E2 trains without any Mars labels and
  reports what transfers, and E5 measures how separable the bodies are in feature space.
- Each cell image is stretched between its own 1st and 99th percentiles, because the three sensors'
  brightness scales are unrelated. The model therefore cannot use a cell's overall contrast.

## D3. Imagery from NASA Trek tiles, elevation from PDS numeric grids

- Measured: reading one 78 km region from the USGS global THEMIS GeoTIFF took 255 s and from the LROC WAC
  GeoTIFF 120 s, because both files are stored in full-width strips. The same region from NASA Trek tiles
  took 3.2 s and 1.0 s.
- Trek tiles are lossy display images. They are used only as image inputs. Every elevation number comes
  from a numeric product (MOLA MEGDR, LOLA GDR, NASADEM, CTX and HiRISE elevation models).

## D4. Earth imagery: NASA HLS from a public mirror

- HLS L30 (Landsat 8/9, 30 m) is a NASA product. Its home archive (LP DAAC) needs an Earthdata login.
  The same product is on Microsoft's Planetary Computer with an anonymous read token, so that mirror is
  used. No access control is bypassed.
- One Landsat pass covers only part of an HLS tile, so several clear dates are combined per region.

## D5. Elevation above 60 degrees north: Copernicus GLO-30 instead of NASADEM

- NASADEM (from the Shuttle Radar Topography Mission) stops at 60 N. Iceland and Devon Island are
  important analog sites, so those two regions use the ESA Copernicus DEM and are labelled as such.

## D6. Frozen backbone, trained head

- The build machine has 7.4 GB of memory and no GPU. Fine-tuning a vision transformer is not feasible
  there, so DINOv2 ViT-S/14 stays frozen and a small head is trained on cached features.
- Cost: the backbone cannot adapt to planetary imagery. The linear-probe baseline (E1-E3, `dino_ridge`)
  shows how much of the result comes from the head rather than from DINOv2 itself.

## D7. No PostGIS on the build machine

- The portable PostgreSQL 18 available here has no PostGIS extension, and Docker is not installed.
- Plan: the schema enables PostGIS when the extension is available and otherwise stores coordinates as
  plain longitude/latitude columns plus GeoJSON. Spatial work that matters (grids, routes) is done on
  metric local grids in the services, not in SQL.

## D8. Removing the input LayerNorm from the head

- Measured on a linear synthetic problem: with a LayerNorm on the input the head reached R2 0.89 where
  ridge regression reached 0.985; without it the head reached 0.995. A per-sample LayerNorm discards the
  sample's overall magnitude, and the inputs are already standardised per dimension.

## D9. Per-body feature normalisation is part of the model

- Measured (experiment E2): trained on Earth and the Moon and tested on Mars, the head scores R2 0.05
  without it and 0.42 with it. A linear classifier can tell the bodies apart from raw DINOv2 features
  95.5% of the time.
- It uses each body's images and no labels, so it is legitimate unsupervised adaptation. In the
  held-out-region experiments the statistics are fitted on training regions only.
- Cost: a new body needs a few hundred images before the model can be applied to it.

## D10. The terrain model is not used for route costs

- The model is validated at an 11 km scale against 467 m elevation. Routes are planned on 20 m cells.
  Nothing measured supports using the model at that scale, so routes use measured slope only.
- The brief asks for the model's terrain intelligence in navigation "where supported by validation".
  It is not supported, and the interface says so.

## D11. Slope limit from the real rover

- Perseverance's published path never crosses a 20 m cell steeper than 18.3 degrees, while 1.7% of the
  mission area is steeper than 20. The two rover profiles therefore use a 20 degree limit.
- Cost: this is a statement about 20 m baselines. A rover can meet steeper ground within a cell.

## D12. The browser drives the clock; the mission service computes every step

- The interface calls `sim/step` four times a second with the amount of mission time to advance. All
  movement, consumption, margin checks and replanning happen in the Go service.
- Cost: closing the browser pauses the mission.

## D13. Missions are stored as JSON files

- No PostGIS on the build machine (D7) and little time. Each mission is written to `data/missions/`
  after every command. It is a record, not a resumable session: a restarted service does not reload them.

## D14. Imagery is proxied and reprojected on demand

- NASA Treks serves equirectangular tiles; MapLibre needs Web Mercator. The science service resamples
  on request and caches the result, so no mosaic is stored and any Treks layer can be added in one line.
- Cost: the first view of an area waits on NASA's servers, and the build once saw Treks stop answering
  for about an hour after roughly 1,700 tile requests.

## D15. CLPS information is quoted, not summarised

- The lunar delivery list stores NASA's own sentence for each of the 15 entries on its CLPS Deliveries
  page (last updated 23 October 2026), with the date it was read. Nothing is added from other sources:
  secondary lists were found but not checked, and a status can change after the page was read.
- NASA's page gives no coordinates, so no landing point is drawn. Four deliveries name a site that lies in
  a lunar region this build has measured; that link is ours and is labelled with its basis.

## D16. Ground views come from the nearest rover stop

- Perseverance's waypoints carry the sol of each stop, and the raw-image feed is searchable by sol. A
  clicked point is matched to the nearest stop within 600 m and shown that sol's navigation-camera frames.
- Cost: the frames are from the stop, not the point, and the camera's compass heading is not worked out,
  so the panel says so and claims no viewing direction.

## D17. The mission score

- Science 60, safety 25, efficiency 15. The weights are this project's choice and are shown on screen.
  Safety is full only if the reserve was never needed.
- Cost: on a grid, a detour around a small obstacle can cost no extra distance, so efficiency is often
  unchanged by one replan.

## D18. 3D is a way of looking, not a second data path

- The globe and the tilted view are the same map with a different projection. The 3D surface is raised
  from the CTX elevation model the planner already uses, encoded as terrain tiles by the science service.
- Heights are relative to the mission area's median, faded out over the outer 1.5 km of the elevation
  model, and doubled on screen. All three are stated in the interface or the guide. Routes never read
  these tiles.
- The sky colours in the tilted view are illustrative.

## D19. NASA's Perseverance model, enlarged

- The rover in the 3D view is NASA's published 3D model (credit NASA/JPL-Caltech), downloaded by a script
  and not stored in the repository. It stands at Perseverance's last published waypoint inside the map,
  or drives the route when the scout rover is the mover.
- A 3 m rover would be invisible at map scale, so the model is held at about 84 pixels until the view is
  close enough for true size. The label says "enlarged".
- The crew rover and the astronaut keep their flat icons: there is no NASA model that honestly
  represents this project's assumed crew rover.

## D20. Earth as a third body

- The same analog ranking runs in any direction. From an Earth site it ranks Mars or Moon regions; the
  literature label is still decided from the Earth site's documented analog status.
- Earth imagery is NASA's Blue Marble from GIBS, read by the browser directly. It is a display layer;
  the model's Earth inputs remain HLS and NASADEM.

## D21. A failed tile download is never cached as "empty"

- Found by looking at the globe: tiles that timed out once had been saved as empty and left a hole.
  A download failure now raises an error and the browser is told not to keep the blank tile; only a
  definite "no such tile" answer from NASA is cached as empty.

## D22. Every mover is a NASA model in 3D (supersedes the last point of D19)

- The crew rover is drawn as NASA's Space Exploration Vehicle and the astronaut as NASA's Z-2 suit, both
  from NASA's public 3D Resources repository. The SEV is a pressurised concept vehicle, while this
  project's crew rover profile is an assumed unpressurised one, so the label names the model for what it
  is: a NASA concept model standing in for the crew rover.
- Two of the files are Draco-compressed; the decoder files are copied from three.js into `web/public/draco/`.
- The suit model is a static figure. It glides along the route; it does not walk.

## D23. The space view

- Earth, the Moon and Mars are spheres at their true relative radii, textured with one whole-body NASA
  image each (Blue Marble from GIBS; LROC WAC and Viking mosaics stitched from Treks tiles).
- Distances are not to scale and the stars are generated, and the view says both.

## D24. The space view shows the whole solar system (replaces D23's three-sphere layout)

- The Sun and eight planets, each placed in its direction from the Sun on the day it is viewed, from
  mean longitude and mean motion (circular orbits). The constants follow JPL's "Approximate Positions of
  the Planets" and were entered from memory; they need checking. Ignoring orbital eccentricity leaves an
  error of up to about 10 degrees for Mars and more for Mercury, and the view says so.
- Orbit spacing and sizes are for legibility. Only Earth, the Moon and Mars carry imagery and are clickable.

## D25. Surface view and hand driving

- A ground-level chase camera behind the mover, built on the map's own 3D terrain and 3D models.
- Hand driving is a command to the mission service (`sim/drive`): the browser sends a heading and a
  distance, and the service applies the same mobility model, slope limits and consumables as a planned
  route, then reports the way home. The browser never moves the mover itself.
- The camera is anchored to the terrain height under the mover. The 3D heights are relative and doubled,
  so the ground can be hundreds of metres from the map's zero level.
- The rust tint on the ground is a display choice and is labelled illustrative.

## D26. Map tiles bypass the web proxy

- Measured: bursts of new high-zoom tiles through the Next.js proxy produced "socket hang up" errors,
  while the same tiles loaded directly from the science service. Tile and elevation-tile requests now go
  straight to the science service (`NEXT_PUBLIC_SCIENCE_URL`, default `http://127.0.0.1:8310`).

## D27. One thread through the workspace

- Reviewed on the second day: each part worked, but the workspace read as seven screens and two extra
  worlds. Nothing told the user that the analog search chose the habitat's field site, the health monitor
  was only visible on a step the user was not on while the traverse ran, and the Moon and Earth views had
  no way back to the mission.
- Three additions, all in the interface and none computing a mission value:
  1. A footer on every Mars step ("Carried forward") words what the step decided from the service's own
     numbers and leads to the next step.
  2. Any region opens on its own world's map (`openRegion` in `web/app/page.tsx`): analog matches, the
     habitat's field site, and Mars or Moon matches found from Earth. The Moon and Earth views carry a
     "Return to Mars" bar. Opening a Mars region other than Jezero lands on the Region step, which says
     that the route, habitat and traverse stay at Jezero.
  3. The Review step lists what each of the seven parts did in the mission just run.
- The seven parts and the challenge theme behind each are defined once, in `web/lib/parts.ts`, and read by
  the Review step and the guide. [CHALLENGES.md](CHALLENGES.md) is the written account.
- Science at a target is now chosen from four activities. Their times on site (10 to 45 minutes) are
  assumptions; the mission service already added dwell time to the traverse and to consumable use, so
  the choice has a real effect on the consumables check without new service code.
- The crew monitor's main readings are repeated in the Simulate step, because that is where the user is
  when an injected health fault raises the alert.
- The best score of a session is kept in the browser only. It is not mission state and is not saved.
- At the time of this decision the "3D world" had its own state and did not join this thread. D29 changes that.

## D28. Plan at 20 m, check at 1 m

- The 1 m HiRISE elevation model was first set aside because the whole file (1.8 GB) does not fit the
  build machine. It is uncompressed, so any post is at a known byte offset: a route can be checked by
  reading only the posts under it. Planning stays on the 20 m grid; the 1 m model is the second opinion.
- The check never changes a route unless asked. When asked, it keeps the route out of whole 20 m cells
  that have steep ground in them (eight or more 1 m points, 2% of the cell), replans and measures again.
- First version: if keeping out of all the steep ground left no route, it gave up and changed nothing.
  The end-to-end check caught this on the demonstration route, where the delta top can only be reached
  across the scarp. Now the stretches are taken one at a time, worst first, and the result states what
  could not be avoided. On that route: 258 m over the limit before, 46 m after.
- Not claimed: a route that is "clear" at 1 m is clear of banks and rims a few metres across, not of rocks.

## D29. The 3D world joins the mission

- The 3D world in `surface-world/` was a separate scene with its own routes. It now reads the mission
  from the mission service (`backend/api/mission_link.py`) and draws that plan: legs, targets, keep-outs
  and the 1 m result. Positions are converted from longitude and latitude, not from either map's grid.
- Its detailed terrain is 2 km across; a traverse to the delta is longer. Inside the 2 km the route lies
  on 5 m HiRISE terrain; beyond it the route is drawn on the 80 km CTX backdrop, on the same triangles
  the backdrop is drawn with, so the line sits on the ground. The panel says how much of the route is in
  each.
- "Drive it" does not replay the 20 m line blindly: the world's own 5 m planner is asked to reach a
  point on the mission line every 120 m, so the rover steers round rocks and steep 5 m cells. On the
  demonstration route the driven line stays a median 2.6 m from the mission line (20 m at most).
- One direction only. The 3D world never changes the mission; driving there does not advance the
  mission's simulation. Two-way state was left out as too much to test in the time.

## D30. One rover, one look

- The map's 3D and surface views drew the crew rover as NASA's Space Exploration Vehicle, while the 3D
  world drove a six-wheel rover: two vehicles for one mover. The crew rover is now the six-wheel rover in
  both (`web/components/roverModel.ts` builds it from the same shapes and sizes as
  `surface-world/frontend/src/simulation/rover/Rover.tsx`). The scout is still NASA's Perseverance model
  and the astronaut NASA's Z-2 suit. This supersedes the crew rover line of D22.
- The 3D world now uses the map's type (IBM Plex) and palette: Mars orange for the primary action and the
  mission route, the same teal for the driven line, the same panel colours.
