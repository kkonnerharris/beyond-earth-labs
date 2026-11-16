# Final presentation: seven slides, about seven minutes

Slides: `docs/pitch/Beyond-Earth-Labs-final-presentation.pdf` (source `final.html`, printed by
`node scripts/final_pdf.cjs`). Seven slides, about 900 words, at an easy speaking pace: roughly a minute a
slide. The times in the margin are where you should be when each slide ends. A shared copy of the 3D
simulation is at https://kkonnerharris.github.io/beyond-earth-labs/.

Every figure below is on the slide it is spoken over and comes from `docs/METHODS.md`, `docs/DATA.md`
or `docs/TESTS.md`. If a figure changes there, change it here and on the slide.

---

**1. Cover** (0:30)

I'm Konner Harris, and this is Beyond Earth Labs, my entry for the Martian Map challenge.

It is one 3D map for planning a Marswalk at Jezero Crater, checking it, and rehearsing it, on Mars and on
Earth. What you see behind me is the product itself: a planned route across the crater floor, with
beacons on two science targets on the delta.

**2. The problem and the product** (1:40)

A crew leaving the habitat has three questions. Where can we go? Can we get back? And what do we do when
the plan breaks?

The challenge asks for a layered map from several NASA missions, with at least three kinds of data, crew
safety, a route that avoids obstacles, and rover images. Each line on this slide pairs what was asked
with what I built.

And the product is one mission running through seven connected parts, along the bottom of this slide. The
map sets the slope limit. The analog search picks where on Earth to rehearse. The route sets the distance
and the time on site. Crew safety says go, or refuses and says why. The habitat is what the crew comes
home to. The simulation runs it and scores it. The review says what to change.

*(still slide 2: the three steps)*

A Marswalk runs in three steps. Plan: the route is computed on NASA elevation for a crew rover, a scout
rover or an astronaut on foot, and each science stop costs time. Check: the trip has to fit the oxygen
or the battery with a reserve, or the plan is refused and you are told by how much. Run: the traverse
plays out as a simulation. Report an obstacle, a dust storm or a suit leak, and it replans and logs why.

**3. The map, checked at one metre** (3:10)

It starts with the map. Five NASA missions are on it: orbital photographs down to 25 centimetres,
elevation at 20 metres and at 1 metre, thermal infrared, and the path Perseverance actually drove, in
white.

That path is how I know the map can be trusted. My elevation agrees with the rover's own record at 464
waypoints, to about a metre. And Perseverance never crossed ground steeper than 18 degrees here, which
is where my 20 degree limit for rovers comes from. Every number on screen is labelled: NASA data,
calculated, model, simulated, or assumption.

*(still slide 3: the three figures)*

Here is the part I am proudest of. A route planned on 20 metre squares cannot see a steep bank a few
metres wide. NASA's 1 metre model can.

On this traverse to the delta front, the 20 metre plan said the steepest ground was nine and a half
degrees. The 1 metre model found nine stretches over the rover's limit, 152 metres in all, up to 42
degrees. I asked it to move the route. Two replans later it is clear, and 656 metres longer. The red on
the map is the ground it now stays out of.

It does not always win. To the top of the delta, some steep ground cannot be avoided, and the check says
so instead of calling the route safe.

**4. The 3D simulation on Mars** (4:00)

Then you can stand on it. This is the crew rover and the astronaut at the mission base, in 3D, on the real
terrain of Jezero. The simulation reads the same mission and draws it on the ground: the route in orange,
the targets as beacons, the steep stretches in red.

You can fly the whole route. You can drive the first leg with the rover, on 5 metre terrain, where it
steers round rocks the plan could not see and stays about two and a half metres from the planned line.
Or you can walk it with the astronaut, who stops where the oxygen would no longer cover the walk home.
The thermal infrared layer is here too.

**5. How a test on Earth could help** (4:55)

Nobody should try this for the first time on Mars. So the same rover, astronaut and planner also run on
Earth, at Garden of the Gods in Shawnee National Forest, on USGS elevation and a real aerial photograph
of the site.

On ground you can actually walk, a test could answer three things. Do the predictions hold: is the time
and energy what the planner said? Are the limits right, and what did the map miss, like rocks and roots
under a metre? And do the rules work under pressure, when you rehearse turning back for a leak?

I want to be straight about this: I have not run that field test. This slide is how the product makes
one possible.

**6. Deep learning and AI use** (6:05)

Which Earth sites are worth the trip? A terrain network answers that. It is a vision transformer with a
head I trained on about 4,500 terrain cells from Mars, the Moon and Earth.

On Mars regions it never saw, it explains 64 percent of the variation in slope, relief and roughness;
classical methods reach 52. For matching Earth terrain to Mars it closes 52 percent of the gap to a
perfect pick. It is weakest on Earth, where vegetation hides the landform. And it only ranks rehearsal
sites. Routes never depend on it.

And since this slide is about AI, here is how AI was used. I built this with Claude, through Claude Code,
for scaffolding, for choosing and testing which NASA data to use, and as a coding assistant. Inside the
product, the AI is this terrain network. No language model produces any number you saw.

**7. Data sources and status** (7:00)

Everything rests on NASA data: twenty datasets and resources from ten missions, listed here with what
each one is used for. Four other sources are named below them, and marked as not NASA.

What works: all seven steps, end to end, with the tests passing. What does not: single rocks are still
invisible, the traverse is simulated, and some life-support figures are assumptions.

One 3D map that tells a Mars crew where to go, whether it can get back, and what to do when the plan
breaks, and lets it be rehearsed on Earth first. Thank you.

---

## If a judge asks

- **Is the Earth site one the network picked?** No. The network's top match for Jezero is the Mojave
  volcanic fields. Garden of the Gods is a practice ground close to home, with steep sandstone bluffs.
- **Is the Earth picture real?** The ground is a real aerial photograph (USDA NAIP, 18 August 2023) and
  the elevation is real (USGS 3DEP). The tree shapes, the close-up ground detail and the sky are
  illustrative, and the app labels them so. Those sources are not NASA data.
- **Why two elevation models?** The 1 metre file is 1.8 GB, too large to plan on with this machine. So
  routes are planned at 20 metres and then checked at 1 metre, reading only the elevation under the route.
- **How much of the 3D ground is detailed?** Two kilometres around the landing site, at 5 metres. Beyond
  that the route is drawn on a coarser backdrop.
- **Does the simulation change the mission?** No. It reads the plan; driving there does not move the
  mission's own simulation.
- **How was AI used?** See `docs/AI_USE.md`.

## Before presenting

- Start the services (`scripts/services.ps1 start`) and open http://localhost:4770 once, so the map
  tiles are cached if you switch to a live demonstration.
- The figures on slide 5 are the ones in its photograph. If you retake that photograph, read the new
  numbers off it and change the slide and this script together.
