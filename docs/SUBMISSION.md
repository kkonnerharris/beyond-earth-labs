# Submission text

Draft text for the project page. Check each figure against `docs/METHODS.md` before submitting, and fill
the bracketed items.

**Challenge:** Interplanetary Survival Guide: Martian Map
**Project name:** Beyond Earth Labs
**Team:** [team name and members]
**Repository:** [public URL]
**Video:** [not recorded yet]

## High-level summary (about 100 words)

Beyond Earth Labs is a map an astronaut could use to plan and carry out a Marswalk at Jezero Crater. It
layers optical, topographic and thermal data from five NASA missions, plans routes that respect slope
and consumables, and runs the traverse as a simulation in which obstacles, dust storms and suit leaks
force the plan to change. A neural network trained on NASA data from Earth, Mars and the Moon ranks Earth
sites where the mission could be rehearsed, and every ranking is checked against elevation measurements.
Each number on screen is labelled as NASA data, calculated, model output, simulation or assumption.

## Project details

**What it does.** A single mission workspace: choose a region, find Earth analog sites, place science
targets, get a route for a rover or a walker, check consumables, size a habitat and greenhouse, run the
traverse, and review what happened and what the evidence supports.

**How it addresses the challenge.**
- *Layered, integrated view from multiple NASA missions:* Mars Reconnaissance Orbiter (HiRISE and CTX
  imagery, CTX elevation), 2001 Mars Odyssey (THEMIS thermal infrared), Mars Global Surveyor (MOLA
  elevation), Viking (global colour), Mars 2020 (Perseverance's path).
- *Three or more kinds of data:* optical, topographic, thermal.
- *Crew safety:* slope limits taken from where Perseverance actually drove; an oxygen or battery check
  with reserves before departure; a rule during the traverse that the way home must always be affordable;
  a radiation dose estimate from the rate Curiosity measured on the surface.
- *Point-of-view images:* click near Perseverance's path to see its navigation-camera frames from the
  nearest stop.
- *A route that avoids obstacles:* A* on measured terrain, with keep-out areas and replanning.
- *Robotic help:* a scout rover and a crew rover share the map with the walker.

**What is new.** A terrain network that learns from three bodies at once, with elevation data as an
independent yardstick. It was tested the hard way: trained on Earth and the Moon and asked about Mars.

**What we found.**
- On Mars regions it never saw, the network explains 64% of the variance in slope, relief and roughness,
  against 52% for classical image features.
- Trained on Earth and the Moon only, it does not transfer to Mars (5%) until a label-free normalisation
  step is added (42%).
- It cannot transfer to Earth at all: vegetation breaks the link between brightness and landform.
- For finding Earth terrain that physically matches a Mars cell, the trained embedding closes 52% of the
  gap between a random pick and the ideal one; the untrained encoder closes 17%.
- Our 20 m elevation grid agrees with Perseverance's recorded elevation at 464 waypoints to a median of 1.0 m.

**Limits.** Routes use 20 m cells and cannot see rocks or ripples. The network works at an 11 km scale
and is not used for routing. Crew health is modelled only as workload. Life-support and crop figures are
assumptions, some still to be checked against NASA's baseline document. Nothing here is certified for
operations.

## NASA data and resources

See [DATA.md](DATA.md) for the full registry with access routes and references. In short: MOLA MEGDR and
LOLA GDR (PDS Geosciences Node), THEMIS, CTX, HiRISE, Viking and LROC mosaics (NASA Solar System Treks and
USGS Astrogeology), Mars 2020 traverse data (JPL), HLS (NASA/USGS Landsat), NASADEM (SRTM), NASA POWER.

## Other data and tools

Copernicus DEM GLO-30 (ESA) for two Earth sites above 60° N. DINOv2 (Meta AI) as a frozen image encoder.
PyTorch, timm, rasterio, PROJ, scikit-learn, FastAPI, Go, Next.js, MapLibre GL JS.

## Use of AI tools

See [AI_USE.md](AI_USE.md). Claude Code (Anthropic) wrote the code and documentation during the event
under the team's direction. DINOv2 is used inside the product as an image encoder. No language model
produces any number shown in the product.

## Space Apps awards this could be considered for

| Award | Why |
|---|---|
| Best Use of Data | Fifteen NASA datasets from nine missions, each with a stated role (measurement or image), an access record and a reference; the map checked against real rover data |
| Best Use of Science | A stated question, held-out tests, baselines, a negative result reported (no transfer to Earth; no advantage once Mars labels are plentiful) |
| Best Mission Concept | Consumables-first planning with reserves, a standing return rule, and replanning under four kinds of emergency |
