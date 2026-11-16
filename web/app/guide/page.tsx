import type { Metadata } from "next";
import Link from "next/link";
import { PARTS } from "@/lib/parts";

export const metadata: Metadata = {
  title: "Guide · Beyond Earth Labs",
  description: "What the Martian Map does and how to use it, step by step.",
};

function Shot({ file, alt, caption }: { file: string; alt: string; caption: string }) {
  return (
    <figure className="my-5 overflow-hidden rounded-lg border border-line-strong bg-panel">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/guide/${file}`} alt={alt} loading="lazy" className="block w-full" />
      <figcaption className="border-t border-line px-3.5 py-2 text-[12px] leading-snug text-muted">{caption}</figcaption>
    </figure>
  );
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="mt-12 scroll-mt-6 text-[22px] font-semibold leading-tight text-text">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[14.5px] leading-relaxed text-[#b9c6d6]">{children}</p>;
}
function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-[14.5px] leading-relaxed text-[#b9c6d6] marker:text-faint">{children}</ol>;
}

const TAGS: [string, string, string][] = [
  ["chip-obs", "NASA data", "A NASA measurement, or a value read directly from one."],
  ["chip-calc", "Calculated", "Computed from measurements by a documented formula, such as slope from elevation."],
  ["chip-model", "Model", "Predicted by the trained terrain network."],
  ["chip-sim", "Simulated", "Produced by the mission simulation. Nothing simulated is evidence about the real Mars."],
  ["chip-assume", "Assumption", "An engineering assumption, such as rover mass or crop yield. Most can be changed."],
];

// Every NASA dataset the product reads: [world, dataset, mission or source, what it is used for].
const DATASETS: [string, string, string, string][] = [
  ["Mars", "MOLA gridded topography (MEGDR), 463 m", "Mars Global Surveyor", "Measured slope, relief and roughness of every Mars terrain cell"],
  ["Mars", "THEMIS daytime infrared global mosaic, 100 m", "2001 Mars Odyssey", "What the terrain network sees on Mars; the global thermal layer"],
  ["Mars", "THEMIS daytime infrared, Syrtis Major quadrangle, 100 m", "2001 Mars Odyssey", "Thermal layer of the mission area"],
  ["Mars", "CTX stereo elevation model of Jezero, 20 m", "Mars Reconnaissance Orbiter", "Elevation, slope, every route, and the 3D terrain"],
  ["Mars", "CTX orthomosaic of Jezero, 6 m", "Mars Reconnaissance Orbiter", "Map imagery"],
  ["Mars", "HiRISE orthomosaic of Jezero, 25 cm", "Mars Reconnaissance Orbiter", "Map imagery, draped on the 3D terrain"],
  ["Mars", "Viking colour mosaic (MDIM 2.1), 232 m", "Viking Orbiters 1 and 2", "Global basemap and the Mars globe"],
  ["Mars", "Perseverance traverse and waypoints", "Mars 2020", "The rover's real path; checking the map and the slope limit"],
  ["Mars", "Perseverance raw images, navigation camera", "Mars 2020", "Ground views near a selected point"],
  ["Mars", "Surface radiation dose rate (one published value)", "Mars Science Laboratory, Curiosity RAD", "Crew radiation estimate"],
  ["Mars", "Mars Perseverance Rover, 3D Model", "NASA/JPL-Caltech", "The scout rover, and Perseverance at its last stop, in the 3D view"],
  ["Mars", "HiRISE stereo elevation model of Jezero, 1 m", "Mars Reconnaissance Orbiter", "Checking a planned route for steep ground, and the terrain of the 3D world"],
  ["Mars", "Z-2 Spacesuit, 3D model", "NASA 3D Resources", "The astronaut in the 3D view"],
  ["Moon", "LOLA gridded elevation (LDEM 64), 474 m", "Lunar Reconnaissance Orbiter", "Measured terrain of every Moon cell"],
  ["Moon", "LROC Wide Angle Camera global mosaic, 100 m", "Lunar Reconnaissance Orbiter", "What the terrain network sees on the Moon; the Moon globe"],
  ["Moon", "CLPS Deliveries page (text)", "NASA Science", "The lunar delivery list, quoted"],
  ["Earth", "Harmonized Landsat Sentinel-2 (HLS L30), red band, 30 m", "Landsat 8 and 9", "What the terrain network sees on Earth"],
  ["Earth", "NASADEM elevation, 30 m", "Shuttle Radar Topography Mission", "Measured terrain of Earth cells"],
  ["Earth", "Blue Marble shaded relief and bathymetry", "NASA GIBS (MODIS, Terra)", "The Earth globe"],
  ["Earth", "POWER monthly climate record", "NASA Langley (MERRA-2, CERES)", "Temperature, rainfall and sunlight at the Earth test site"],
];

const CONTENTS: [string, string][] = [
  ["start", "Start in one minute"], ["thread", "One mission, seven parts"], ["space", "The solar system"], ["map", "The map"], ["three-d", "3D terrain and globes"], ["surface", "Surface view: drive it yourself"], ["analogs", "Earth analogs"],
  ["route", "Routes"], ["world", "The 3D world"], ["crew", "Crew safety and health"], ["habitat", "Habitat and farming"], ["simulate", "Run the traverse"],
  ["review", "Review the evidence"], ["worlds", "The Moon and Earth"], ["training", "Training mode"], ["tags", "What the tags mean"],
  ["limits", "Limits"], ["data", "NASA datasets used"],
];

export default function Guide() {
  return (
    <div className="scroll-thin h-screen overflow-y-auto">
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-10 px-6 py-10 lg:grid-cols-[200px_1fr]">
        <nav className="hidden lg:block" aria-label="Guide contents">
          <div className="sticky top-10">
            <Link href="/" className="text-[12px] text-muted underline-offset-4 hover:text-text hover:underline">← Back to the map</Link>
            <ul className="mt-5 flex flex-col gap-1.5 border-l border-line pl-3.5">
              {CONTENTS.map(([id, label]) => (
                <li key={id}><a href={`#${id}`} className="text-[12.5px] text-muted hover:text-text">{label}</a></li>
              ))}
            </ul>
          </div>
        </nav>

        <main className="min-w-0 max-w-[760px] pb-24">
          <p className="label text-mars-soft">Beyond Earth Labs · Guide</p>
          <h1 className="mt-2 text-[34px] font-semibold leading-[1.1] text-text">A map for planning a walk on Mars</h1>
          <P>
            This is a map of Jezero Crater, where NASA&apos;s Perseverance rover landed, built for one job: helping an astronaut plan a trip across the surface and carry it out safely. It layers data from five NASA missions, plans routes that avoid steep ground, checks that oxygen or battery will last, finds places on Earth to rehearse, and then lets you run the trip and throw problems at it.
          </P>
          <P>
            It was built for the NASA Space Apps Challenge 2026, &quot;Interplanetary Survival Guide: Martian Map&quot;. It is a planning aid made at a hackathon. Its numbers are estimates and nothing here is certified for real operations.
          </P>
          <Shot file="mission.jpg" alt="The workspace: seven steps on the left, the Jezero map on the right with Perseverance's path in white"
                caption="The workspace. Seven steps down the left, the map on the right. The white line is where Perseverance actually drove." />

          <H2 id="start">Start in one minute</H2>
          <Steps>
            <li>Click <strong>Create exploration mission</strong>. The crew rover is a good first choice.</li>
            <li>Open step 3, <strong>Route</strong>. Click <strong>Add targets on the map</strong>, click two places west of the landing site, then press Esc.</li>
            <li>Open step 6, <strong>Simulate</strong>, and click <strong>Start traverse</strong>.</li>
            <li>While it drives, click <strong>Obstacle ahead</strong> and watch the route change.</li>
            <li>Drag <strong>Time compression</strong> right to finish the trip and get a score.</li>
          </Steps>

          <H2 id="thread">One mission, seven parts</H2>
          <P>
            The product is one map, entered in one challenge: the Martian Map. Six other NASA Space Apps challenge themes shaped it. Each was built as a part of the same mission, so what you do in one part changes the others. None of them is a separate app.
          </P>
          <div className="mt-4 overflow-x-auto rounded-lg border border-line-strong">
            <table className="w-full min-w-[640px] border-collapse text-[13px] leading-snug">
              <thead>
                <tr className="bg-panel text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                  <th className="px-3 py-2 font-semibold">Challenge theme</th><th className="px-3 py-2 font-semibold">What it became</th>
                  <th className="px-3 py-2 font-semibold">What it gives the mission</th>
                </tr>
              </thead>
              <tbody>
                {PARTS.map((p) => (
                  <tr key={p.key} className="border-t border-line align-top">
                    <td className="px-3 py-2 text-text">{p.challenge}{p.primary && <span className="chip chip-model ml-2">Our challenge</span>}</td>
                    <td className="px-3 py-2 text-[#b9c6d6]">{p.part}<span className="block text-[12px] text-muted">{p.where}</span></td>
                    <td className="px-3 py-2 text-[#b9c6d6]">{p.gives}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <P>
            Three things hold the parts together. The bar at the bottom of every step says what that step decided and carries it into the next one. Matches found on one world open on that world&apos;s map, and the Moon and Earth views always have a way back to your Mars mission. And the Review step ends with a list of what every part did in the mission you just ran.
          </P>
          <Shot file="parts.jpg" alt="The Review step listing the map, the Earth analog search, the crew health monitor and the greenhouse, each with what it did in this mission"
                caption="The Review step after a traverse: each part, what it did in this mission, and a button to open it." />
          <P>The full account, part by part, is in <code className="num text-[13px] text-text">docs/CHALLENGES.md</code> in the repository.</P>

          <H2 id="space">The solar system</H2>
          <P>
            Click <strong>Space view</strong> in the top bar to see the whole solar system: the Sun and all eight planets on their orbits, with Earth, the Moon and Mars picked out and wrapped in NASA imagery. Each planet is drawn in the direction it lies from the Sun today. Click Earth, the Moon or Mars to open its map.
          </P>
          <P>
            The orbit spacing and planet sizes are drawn so everything fits and can be seen; they are not to scale. The positions come from each planet&apos;s average motion, so they can be off by about ten degrees for Mars. The other planets are plain colours and the stars are generated.
          </P>
          <Shot file="space.jpg" alt="The solar system seen from above at an angle: the Sun, eight planets on their orbits, with Earth, the Moon and Mars labelled"
                caption="The solar system on the day of the screenshot. Earth, the Moon and Mars open their maps." />

          <H2 id="map">The map</H2>
          <P>
            Drag to move and scroll to zoom. The <strong>Map layers</strong> panel switches imagery and analysis on and off: a global colour mosaic, thermal infrared, Jezero at 6 metres and at 25 centimetres per pixel, slope, shaded relief, and Perseverance&apos;s real path.
          </P>
          <P>
            Click any point to inspect it. You get its elevation and slope, and whether a walker, the crew rover and the scout rover can cross it. If Perseverance stopped within 600 metres, you also see photographs from its navigation cameras at that stop, so you know what the ground looks like before you go.
          </P>
          <Shot file="point.jpg" alt="A point inspection card showing elevation, slope, passability and two Perseverance camera frames"
                caption="Inspecting a point on the rover's path: measured terrain, and Perseverance's own camera frames from a stop 25 metres away." />
          <Shot file="slope.jpg" alt="The slope layer over Jezero, blue on gentle ground and red on the delta front"
                caption="The slope layer. Blue is gentle; red is too steep for any mover. The red band is the front of the ancient river delta." />

          <H2 id="three-d">3D terrain and globes</H2>
          <P>
            Click <strong>3D terrain</strong> above the map to tilt the view and raise the surface. The shape comes from the same measured elevation the routes are planned on, with the orbital photographs laid over it. Heights are doubled so the relief is easy to read, and the map says so. Hold the right mouse button and drag to tilt and turn; the compass button resets north.
          </P>
          <Shot file="terrain3d.jpg" alt="Jezero in a tilted 3D view with the route on the terrain and a 3D vehicle at the landing site"
                caption="Jezero in 3D, raised from the CTX stereo elevation model with HiRISE imagery on top. The view opens on your rover or astronaut." />
          <P>
            In the 3D view everyone is a 3D model. The crew rover is the six-wheel rover, the same one you drive in the 3D world. The robotic scout is NASA&apos;s model of Perseverance. The astronaut wears the Z-2, NASA&apos;s prototype suit for walking on another world. They move along the route as the traverse runs. A second Perseverance stands where the real rover last reported its position inside this map. All of them are drawn far larger than life until you zoom right in, and the label says so.
          </P>
          <Shot file="astronaut3d.jpg" alt="A 3D model of an astronaut in NASA's Z-2 suit seen from behind, walking across the terrain"
                caption="The astronaut on foot in NASA's Z-2 suit, walking away from the landing site." />
          <P>
            Click <strong>Whole planet</strong> to pull back until Mars is a globe. The Moon and Earth do the same. On a globe, each dot is a region the terrain network knows; click one to select it.
          </P>
          <Shot file="globe.jpg" alt="Mars as a globe with region markers" caption="Mars as a globe, from the Viking orbiters' colour mosaic. Each dot is a region with measured terrain." />

          <H2 id="surface">Surface view: drive it yourself</H2>
          <P>
            Click <strong>Surface view</strong> above the map to drop to ground level. The camera rides close behind your rover or astronaut, looking where they are heading, with the horizon and the Martian sky ahead.
          </P>
          <Steps>
            <li>Press <strong>W</strong> or the up arrow to move forward and <strong>S</strong> or the down arrow to back up.</li>
            <li>Press <strong>A</strong> and <strong>D</strong>, or the left and right arrows, to turn.</li>
            <li>Watch the strip at the bottom: heading, the slope under you, distance driven, and battery or oxygen.</li>
          </Steps>
          <P>
            Every move is worked out by the mission service with the same rules as a planned route. If the ground ahead is too steep for your mover you are stopped and told why, and you are warned when you have gone too far to get home with your reserve. If a planned traverse is running, the camera simply rides along. Reset the simulation to return to base.
          </P>
          <Shot file="surface.jpg" alt="Ground-level view from behind a rover model on tinted Mars terrain, with a strip showing heading, slope, distance and battery"
                caption="Driving the crew rover by hand. The blue line is where it has been." />
          <P>
            The orbital photographs are grey, so the ground is tinted rust in this view to look like Mars; the tint is illustrative. Up close the ground looks soft because the elevation data has one height every 20 metres.
          </P>

          <H2 id="analogs">Earth analogs</H2>
          <P>
            Before anyone walks on Mars, the mission is rehearsed somewhere on Earth that resembles it. Step 2 asks a neural network, trained on terrain from Mars, the Moon and Earth, which Earth regions are most like the one you selected.
          </P>
          <P>
            Every candidate shows three separate things. <strong>Network similarity</strong> is what the model sees in the images. <strong>Measured similarity</strong> compares slope, relief and roughness from elevation data and does not use the network at all. The <strong>label</strong> says whether published geology supports the site as an analog, or whether it is only a look-alike. Open a card to see the measurements side by side, and to jump to that site on the Earth map. The best supported match becomes the field site in the Habitat step.
          </P>
          <Shot file="analogs.jpg" alt="Ranked Earth analog candidates for Jezero with similarity bars and a table of measured attributes"
                caption="Earth analogs for Jezero. Farmland and alpine control regions land at the bottom of the list, which is a check that the ranking is not fooled by appearance." />

          <H2 id="route">Routes</H2>
          <P>
            Choose who is travelling: an astronaut on foot, a crew rover, or a robotic scout. Choose the science to do at the next target (sampling an outcrop, drilling a core, a panorama, or setting up a weather station), then place targets on the map. Each kind of science takes an assumed time on site, and that time counts against oxygen or battery. The mission service finds the cheapest path from base to each target and home again that never enters ground beyond that mover&apos;s slope limit. The rovers&apos; 20 degree limit is not a guess: Perseverance never crossed ground steeper than 18 degrees on this map.
          </P>
          <P>
            <strong>Fastest</strong> and <strong>Least energy</strong> change what the route minimises. <strong>Caution</strong> makes it keep further from steep and rough ground. The profile under the plan shows the climb.
          </P>
          <Shot file="route.jpg" alt="A three-leg route from the landing site to two targets with distance, duration, energy and an elevation profile"
                caption="A planned traverse: distance, time, energy, the steepest ground crossed, and the elevation profile." />
          <P>
            The route is planned on 20 metre squares, and a square that size cannot see a bank a few metres wide. Press <strong>Check this route at 1 m</strong> to measure the same route on NASA&apos;s 1 metre elevation model from the HiRISE camera. It lists every stretch steeper than your mover&apos;s limit and marks them on the map. <strong>Move the route around them</strong> replans to keep off the steep ground it can avoid, and tells you plainly what it could not: a target on top of a scarp can only be reached across it. The first check reads the elevation under your route from NASA&apos;s file, so it can take a minute.
          </P>

          <H2 id="world">The 3D world</H2>
          <P>
            Click <strong>3D world</strong> at the top, or <strong>Open this route in the 3D world</strong> in the Route step, to stand on the ground your mission crosses. It is the same plan, read from the same mission service: the orange line is your route, each target has a beacon, and the red stretches are the ground the 1 metre check found too steep.
          </P>
          <Steps>
            <li><strong>Fly the route</strong> takes the camera along the whole traverse, out to every target and back.</li>
            <li><strong>Drive it</strong> sends the rover down the first leg. It follows your route but steers round rocks and steep patches the 20 metre plan could not see, and the panel says how closely it kept to your line.</li>
            <li>Press <strong>4</strong> for a view from above framed on the whole route, <strong>3</strong> to ride behind the rover, <strong>1</strong> to fly free.</li>
          </Steps>
          <Shot file="world.jpg" alt="A 3D view across Jezero: an orange route line runs over rippled ground toward the delta, with two labelled target beacons on the horizon and a mission panel on the right"
                caption="The mission in the 3D world: the planned route in orange, beacons on the two targets at the delta, and the 1 m check's result in the panel." />
          <P>
            Only the 2 kilometres around the landing site are detailed, from the HiRISE elevation model at 5 metres. Beyond that the route is drawn on a coarser 80 kilometre backdrop that shows the delta and the crater rim but cannot be driven. The 3D world shows your mission; it does not change it.
          </P>

          <H2 id="crew">Crew safety and health</H2>
          <P>
            Step 4 answers one question before departure: is there enough oxygen or battery for the whole trip with a reserve left over? If not, the service refuses the plan and says by how much.
          </P>
          <P>
            During the trip one rule always holds: the mover must be able to get home from where it is with the reserve intact. If going on would break that, the trip turns back and the log records why. The step also shows a radiation estimate, using the dose rate NASA&apos;s Curiosity rover measured on the surface, and a crew health monitor. The monitor&apos;s readings are simulated from workload. It raises an alert when heart rate is higher than the workload explains, which is how it catches an injected health fault.
          </P>

          <H2 id="habitat">Habitat and farming</H2>
          <P>
            Step 5 sizes a base: crew, length of stay, solar panels and dust. Add greenhouse area crop by crop and watch what it costs. Grow lights add to the electrical load and plants move more water through the recycling system, and both feed straight into the power margin.
          </P>
          <P>
            Below that is the Earth side: NASA&apos;s climate record for the test site the model chose, comparing 1984 to 1993 with 2015 to 2024. It shows how the growing season, rainfall and sunlight have changed there. The sunlight figure is the amount a Mars greenhouse has to replace with lamps.
          </P>

          <H2 id="simulate">Run the traverse</H2>
          <P>
            Step 6 runs the plan. The rover or astronaut follows the route while distance, speed, slope and consumables update. Four buttons inject trouble: an obstacle on the route, a dust storm, a leak or power fault, and a health or mobility fault. Each one changes the plan, and the mission log explains every decision. The crew&apos;s heart rate, fatigue and margin to get home stay in view under the telemetry, so a health alert is seen where the traverse is being run.
          </P>
          <Shot file="simulate.jpg" alt="The simulation panel with telemetry, emergency buttons and a mission log showing an obstacle and a replan"
                caption="An obstacle reported 170 metres ahead. The service replans from the current position and logs the reason." />
          <P>
            When the mover is back at base the trip is scored out of 100: 60 for science (targets visited), 25 for safety (home with the reserve untouched), 15 for efficiency. The best score of your session is kept beside it. Reset and try a different mover, route or caution setting to beat it.
          </P>
          <Shot file="score.jpg" alt="A mission score of 100 with science, safety and efficiency bars" caption="The score, with the reason for each part." />

          <H2 id="review">Review the evidence</H2>
          <P>
            Step 7 is the honest part. It shows what happened on the trip, and then how good the terrain network actually is: its accuracy on regions it never saw in training, against simpler methods. It also states plainly what failed. The model does not transfer to Mars from Earth and the Moon without an extra normalisation step, and it cannot read Earth terrain at all when trained on the other two.
          </P>
          <Shot file="review.jpg" alt="The review step with a mission report and tables comparing the terrain network with baselines"
                caption="Held-out accuracy tables, built from the experiment files, not typed in." />

          <H2 id="worlds">The Moon and Earth</H2>
          <P>
            The switch in the top bar changes world. <strong>Moon</strong> shows the lunar surface from the Lunar Reconnaissance Orbiter, the same Earth-analog search for lunar regions, and NASA&apos;s list of commercial lunar deliveries (CLPS) in NASA&apos;s own words. Where a delivery&apos;s landing site is in a region this build has measured, one click opens its terrain and Earth analogs.
          </P>
          <Shot file="moon.jpg" alt="The Moon view with a CLPS delivery list and Earth analog ranking for a lunar region"
                caption="A lunar delivery site compared with Earth test sites." />
          <P>
            <strong>Earth</strong> turns the question around. Pick a test site and ask which Mars or Moon terrain it most resembles, then read NASA&apos;s climate record for it. Amber dots are control regions such as farmland, included to check the model.
          </P>
          <Shot file="earth.jpg" alt="Earth as a globe with analog sites, and Mars regions ranked for a selected Earth site"
                caption="An Earth test site and the Mars regions it most resembles." />
          <P>Missions, routes and the simulation exist on Mars only. The Moon and Earth are side trips for comparison: each has a <strong>Return to Mars</strong> button at the top, and your mission is still there when you come back.</P>

          <H2 id="training">Training mode</H2>
          <P>
            Tick <strong>Training mode</strong> in the top bar. Each step then shows one task in plain words, with the reason it matters, checked against what you actually do in the live mission. The first is to click the real rover&apos;s path and see what it saw; the hardest is to add an obstacle and still score 70 or more. It is written for a young or first-time user, but it has no lessons or quizzes.
          </P>

          <H2 id="tags">What the tags mean</H2>
          <P>Every number carries a tag saying where it came from.</P>
          <ul className="mt-3 flex flex-col gap-2.5">
            {TAGS.map(([cls, name, text]) => (
              <li key={name} className="flex items-baseline gap-3 text-[14px] leading-snug text-[#b9c6d6]">
                <span className={`chip ${cls} shrink-0`}>{name}</span><span>{text}</span>
              </li>
            ))}
          </ul>

          <H2 id="limits">Limits</H2>
          <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-[14.5px] leading-relaxed text-[#b9c6d6]">
            <li>Routes are planned on 20 metre squares. The 1 metre check sees banks and rims a few metres across; a single rock or a sand ripple is still invisible.</li>
            <li>The 3D world is detailed for 2 kilometres around the landing site only, and driving there does not move the mission&apos;s simulation.</li>
            <li>The terrain network works at an 11 kilometre scale. It ranks regions; it is not used to plan routes.</li>
            <li>The 3D view doubles heights and fades them out at the edge of the elevation data. It is for looking, not measuring.</li>
            <li>The 3D models are enlarged and do not animate: the astronaut glides and the wheels do not turn.</li>
            <li>In the solar system view only the planets&apos; directions from the Sun are real, and only approximately.</li>
            <li>Crew health readings are simulated. No person is measured and this is not a medical device.</li>
            <li>The radiation rate was measured at Gale crater, not Jezero.</li>
            <li>Rover, suit, life-support and crop figures are assumptions. Several still need checking against NASA&apos;s documents.</li>
          </ul>

          <H2 id="data">NASA datasets used</H2>
          <P>Twenty NASA datasets and resources from ten missions. Mars and Moon imagery is served by NASA&apos;s Solar System Treks.</P>
          <div className="mt-4 overflow-x-auto rounded-lg border border-line-strong">
            <table className="w-full min-w-[640px] border-collapse text-[13px] leading-snug">
              <thead>
                <tr className="bg-panel text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                  <th className="px-3 py-2 font-semibold">World</th><th className="px-3 py-2 font-semibold">Dataset</th>
                  <th className="px-3 py-2 font-semibold">Mission or source</th><th className="px-3 py-2 font-semibold">Used for</th>
                </tr>
              </thead>
              <tbody>
                {DATASETS.map(([world, name, mission, use]) => (
                  <tr key={name} className="border-t border-line align-top">
                    <td className="px-3 py-2 text-muted">{world}</td><td className="px-3 py-2 text-text">{name}</td>
                    <td className="px-3 py-2 text-[#b9c6d6]">{mission}</td><td className="px-3 py-2 text-[#b9c6d6]">{use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <P>
            One dataset is not NASA&apos;s: the Copernicus GLO-30 elevation model (European Space Agency) is used for Iceland and Devon Island, which lie north of the shuttle radar&apos;s coverage. The image encoder inside the terrain network is DINOv2 (Meta AI), used frozen.
          </P>
          <P>References and access details for every dataset are in <code className="num text-[13px] text-text">docs/DATA.md</code> in the repository.</P>
        </main>
      </div>
    </div>
  );
}
