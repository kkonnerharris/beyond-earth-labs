"use client";

import dynamic from "next/dynamic";
import { BASE, STATIC } from "@/lib/base";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BODY_NAME, missionApi, scienceApi, type AnalogResult, type Body, type Climate, type Clps, type GroundViews, type M2020, type Terrain3D, type Mission, type Profile, type RegionInfo, type Terrain } from "@/lib/api";
import type { Focus, LayerState } from "@/components/MapView";
import { ClpsBrowser, FieldSite, GOALS, StepAnalogs, StepCrew, StepHabitat, StepRegion, StepRoute, StepSim } from "@/components/Steps";
import { StepReview, type Evidence } from "@/components/Review";
import { StepFooter, WorldBanner, type PartRow } from "@/components/Thread";
import { Chip, Note, type Kind } from "@/components/ui";
import { fmtDistance, fmtDuration } from "@/lib/geo";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });
const SpaceView = dynamic(() => import("@/components/SpaceView"), { ssr: false });

// The 3D simulation (surface-world/) runs as its own service on port 8320. For Mars it is handed the
// mission's id, reads the same plan from the mission service and draws it at Jezero. For Earth it opens on
// the field site at Garden of the Gods, Illinois. Its buttons are shown only when that service answers.
const WORLD_URL = process.env.NEXT_PUBLIC_WORLD_URL ?? "http://127.0.0.1:8320";
// In the shared copy the simulation is a page beside this one; it shows the two sites without the mission link.
const WORLD_INDEX = STATIC ? "/index.html" : "/";

const STEPS = ["Region", "Analogs", "Route", "Crew", "Habitat", "Simulate", "Review"] as const;

const LAYER_GROUPS: { title: string; items: { key: string; label: string; kind: Kind; source: string }[] }[] = [
  { title: "Imagery", items: [
    { key: "mars_viking", label: "Global colour", kind: "obs", source: "Viking Orbiters, 232 m" },
    { key: "mars_themis_day", label: "Thermal infrared, global", kind: "obs", source: "2001 Mars Odyssey THEMIS, 100 m" },
    { key: "jezero_ctx", label: "Jezero, 6 m", kind: "obs", source: "Mars Reconnaissance Orbiter CTX" },
    { key: "jezero_hirise", label: "Jezero, 25 cm", kind: "obs", source: "Mars Reconnaissance Orbiter HiRISE" },
  ] },
  { title: "Analysis", items: [
    { key: "slope", label: "Slope", kind: "calc", source: "From the CTX elevation model, 20 m baseline" },
    { key: "hillshade", label: "Shaded relief", kind: "calc", source: "Shading of the CTX elevation model" },
    { key: "thermal", label: "Thermal infrared, mission area", kind: "obs", source: "THEMIS daytime mosaic; relative brightness, not a temperature" },
  ] },
  { title: "Mission", items: [
    { key: "m2020", label: "Perseverance's real path", kind: "obs", source: "NASA/JPL-Caltech Mars 2020 location data" },
  ] },
];
const DEFAULT_LAYERS: LayerState = { mars_viking: true, jezero_ctx: true, jezero_hirise: true, m2020: true, moon_wac: true };

// Training mode: one task per step, in plain words, each checked against the live mission.
type CoachCtx = { mission: Mission | null; analogs: boolean; triedFoot: boolean; probed: boolean; reviewed: boolean };
const COACH: { task: string; why: string; done: (c: CoachCtx) => boolean }[] = [
  { task: "The white line is where the real Perseverance rover drove. Click a point on it to see what the rover saw there.",
    why: "A map that has been checked against a real rover is a map you can trust.",
    done: (c) => c.probed },
  { task: "Find places on Earth that are like Jezero, then open the first one to see what was measured.",
    why: "Crews practise on Earth first, at places like the one they will explore.",
    done: (c) => c.analogs },
  { task: "Put two science targets on the map and get a route the mission service accepts.",
    why: "A route has to stay off ground that is too steep to cross.",
    done: (c) => !!c.mission && c.mission.targets.length >= 2 && !!c.mission.plan?.feasibility.ok },
  { task: "Switch to the astronaut on foot. Is there still enough oxygen for the same trip?",
    why: "Walking is slower than driving, and a suit carries only so much oxygen.",
    done: (c) => c.triedFoot },
  { task: "Grow at least 20% of the crew's food. Watch what happens to the power.",
    why: "On Mars plants need lamps, and lamps need electricity.",
    done: (c) => (c.mission?.habitat.food_grown_share ?? 0) >= 0.2 },
  { task: "Start the trip, add an obstacle, and still score 70 or more.",
    why: "Plans change. A good crew still does its science and gets home safely.",
    done: (c) => (c.mission?.sim.replans ?? 0) > 0 && (c.mission?.score?.total ?? 0) >= 70 },
  { task: "Open this step and find out: can a network learn on Earth and then understand Mars?",
    why: "Good scientists also say what did not work.",
    done: (c) => c.reviewed },
];

export default function Workspace() {
  const [body, setBody] = useState<Body>("mars");
  const [threeD, setThreeD] = useState(false);
  const [space, setSpace] = useState(false);
  const [surface, setSurface] = useState(false);
  const [world, setWorld] = useState(false);          // the 3D simulation is showing in the map's pane
  const [worldSite, setWorldSite] = useState<"mars" | "earth">("mars");   // which world it is showing
  const openWorld = (site: "mars" | "earth") => { setWorldSite(site); setWorld(true); };
  const [worldUp, setWorldUp] = useState(false);      // true once that optional service has answered
  const [fineBusy, setFineBusy] = useState(false);    // the 1 m elevation check is reading NASA's file
  const [aim, setAim] = useState(0);
  const [dem, setDem] = useState<Terrain3D | null>(null);
  const [earthTarget, setEarthTarget] = useState<"mars" | "moon">("mars");
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [m2020, setM2020] = useState<M2020 | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reserves, setReserves] = useState({ oxygen: 0.25, battery: 0.2 });
  const [regions, setRegions] = useState<Record<Body, RegionInfo[]>>({ mars: [], moon: [], earth: [] });
  const [selected, setSelected] = useState<Record<Body, string | null>>({ mars: "mars:jezero", moon: null, earth: null });
  const [model, setModel] = useState<Evidence | null>(null);
  const [services, setServices] = useState<{ mission: boolean | null; science: boolean | null }>({ mission: null, science: null });
  const [mission, setMission] = useState<Mission | null>(null);
  const [step, setStep] = useState(0);
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [layersOpen, setLayersOpen] = useState(true);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [placing, setPlacing] = useState(false);
  const [analogs, setAnalogs] = useState<Record<string, AnalogResult>>({});
  const [analogBusy, setAnalogBusy] = useState(false);
  const [analogError, setAnalogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(60);
  const [toast, setToast] = useState<{ text: string; tone: "bad" | "warn" } | null>(null);
  const [probe, setProbe] = useState<{ lon: number; lat: number; elevation_m: number; slope_deg: number; enterable: Record<string, boolean> } | null>(null);
  const [views, setViews] = useState<GroundViews | null>(null);
  const [clps, setClps] = useState<Clps | null>(null);
  const [training, setTraining] = useState(false);
  const [triedFoot, setTriedFoot] = useState(false);
  const [name, setName] = useState("Jezero delta traverse");
  const [mover, setMover] = useState("crew_rover");
  const [climate, setClimate] = useState<Climate | null>(null);
  const [climateError, setClimateError] = useState<string | null>(null);
  const [goal, setGoal] = useState(0);                 // which science activity the next target gets
  const [best, setBest] = useState<number | null>(null); // best mission score in this browser session
  const [probed, setProbed] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const inFlight = useRef(false);
  const focusKey = useRef(0);

  const fly = useCallback((lon: number, lat: number, zoom: number, pitch?: number, bearing?: number) =>
    setFocus({ lon, lat, zoom, pitch, bearing, key: ++focusKey.current }), []);
  const warn = useCallback((text: string, tone: "bad" | "warn" = "bad") => {
    setToast({ text, tone });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 6000);
  }, []);

  // Load everything the workspace needs. Each failure is reported, never hidden.
  useEffect(() => {
    missionApi.health().then(() => setServices((s) => ({ ...s, mission: true }))).catch(() => setServices((s) => ({ ...s, mission: false })));
    scienceApi.health().then(() => setServices((s) => ({ ...s, science: true }))).catch(() => setServices((s) => ({ ...s, science: false })));
    fetch(WORLD_URL, { mode: "no-cors" }).then(() => setWorldUp(true)).catch(() => setWorldUp(false));
    scienceApi.terrain().then(setTerrain).catch((e) => warn(`Terrain did not load: ${e.message}`));
    scienceApi.m2020().then(setM2020).catch(() => undefined);
    missionApi.profiles().then((r) => { setProfiles(r.profiles); setReserves(r.reserves); }).catch(() => undefined);
    scienceApi.regions("mars").then((r) => setRegions((x) => ({ ...x, mars: r }))).catch(() => undefined);
    scienceApi.regions("moon").then((r) => setRegions((x) => ({ ...x, moon: r }))).catch(() => undefined);
    scienceApi.regions("earth").then((r) => setRegions((x) => ({ ...x, earth: r }))).catch(() => undefined);
    scienceApi.terrain3d().then(setDem).catch(() => setDem(null));
    scienceApi.model().then((m) => setModel(m as Evidence)).catch(() => setModel(null));
    scienceApi.clps().then(setClps).catch(() => undefined);
  }, [warn]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPlacing(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Run a mission command; on refusal, keep the state the service sent back and say why. */
  const command = useCallback(async (fn: () => Promise<Mission>) => {
    setBusy(true);
    try { setMission(await fn()); }
    catch (e) {
      const err = e as Error & { mission?: Mission };
      if (err.mission) setMission(err.mission);
      warn(err.message);
    } finally { setBusy(false); }
  }, [warn]);

  // Surface view: W or Up drives forward, S or Down backs up, A/D or Left/Right turn the view.
  // Every move is computed by the mission service, with the same slope limits as a planned route.
  const planned = mission?.sim.phase === "moving" || mission?.sim.phase === "at_target";
  useEffect(() => {
    if (!surface || !mission) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const k = e.key.toLowerCase();
      const turn = k === "a" || k === "arrowleft" ? -15 : k === "d" || k === "arrowright" ? 15 : 0;
      const go = k === "w" || k === "arrowup" ? 1 : k === "s" || k === "arrowdown" ? -1 : 0;
      if (!turn && !go) return;
      e.preventDefault();
      if (turn) { setAim((a) => (a + turn + 360) % 360); return; }
      if (planned || inFlight.current) return;
      inFlight.current = true;
      const heading = go > 0 ? aim : (aim + 180) % 360;
      missionApi.sim(mission.id, "drive", { heading_deg: heading, distance_m: mission.mover === "astronaut" ? 6 : 12 })
        .then(setMission)
        .catch((err: Error & { mission?: Mission }) => { if (err.mission) setMission(err.mission); warn(err.message, "warn"); })
        .finally(() => { inFlight.current = false; });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [surface, mission?.id, mission?.mover, aim, planned, warn]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = () => command(async () => {
    const m = await missionApi.create(name.trim() || "Exploration mission", mover);
    fly(m.base.lon, m.base.lat, 12.6);
    return m;
  });

  const onMapClick = useCallback((lon: number, lat: number) => {
    if (body !== "mars" || !mission) return;
    if (placing && step === 2) {
      const n = mission.targets.length + 1;
      const g = GOALS[goal] ?? GOALS[0];
      command(() => missionApi.addTarget(mission.id, lon, lat, `Target ${n}`, g.objective, g.dwell_min));
      return;
    }
    setViews(null);
    missionApi.sample(lon, lat)
      .then((r) => {
        setProbed(true);
        setProbe({ lon, lat, elevation_m: r.sample.elevation_m, slope_deg: r.sample.slope_deg, enterable: r.enterable });
        scienceApi.views(r.sample.x, r.sample.y).then(setViews).catch((e) => setViews({ available: false, reason: e.message }));
      })
      .catch(() => setProbe(null));
  }, [body, mission, placing, step, command, goal]);

  const selectRegion = useCallback((r: RegionInfo) => {
    setSelected((s) => ({ ...s, [r.body as Body]: r.region }));
    fly(r.lon, r.lat, r.body === "moon" ? 5.6 : r.body === "earth" ? 6.2 : 6.4);
  }, [fly]);
  const onRegionMarker = useCallback((id: string) => {
    const r = [...regions.mars, ...regions.moon, ...regions.earth].find((q) => q.region === id);
    if (r) selectRegion(r);
  }, [regions, selectRegion]);

  const region = useMemo(() => regions[body].find((r) => r.region === selected[body]) ?? null, [regions, body, selected]);
  // Mars and Moon regions are compared with Earth; an Earth site is compared with Mars or the Moon.
  const runAnalogsFor = useCallback((id: string, target?: "mars" | "moon") => {
    setAnalogBusy(true); setAnalogError(null);
    scienceApi.analogs(id, 40, target)
      .then((r) => setAnalogs((a) => ({ ...a, [target ? `${id}|${target}` : id]: r })))
      .catch((e) => setAnalogError(e.message))
      .finally(() => setAnalogBusy(false));
  }, []);
  const analogKey = region ? (region.body === "earth" ? `${region.region}|${earthTarget}` : region.region) : "";
  const runAnalogs = () => { if (region) runAnalogsFor(region.region, region.body === "earth" ? earthTarget : undefined); };

  // The simulation clock is driven from here, but every step is computed by the mission service.
  const live = mission?.sim.phase === "moving" || mission?.sim.phase === "at_target";
  useEffect(() => {
    if (!running || !mission || !live) { if (running && mission && !live) setRunning(false); return; }
    const id = window.setInterval(async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try { setMission(await missionApi.sim(mission.id, "step", { seconds: speed * 0.25 })); }
      catch (e) { setRunning(false); warn((e as Error).message); }
      finally { inFlight.current = false; }
    }, 250);
    return () => window.clearInterval(id);
  }, [running, live, mission?.id, speed, warn]); // eslint-disable-line react-hooks/exhaustive-deps

  // The Earth field site is the best analog found for the mission area (Hanksville until a search has run).
  const fieldSite = analogs["mars:jezero"]?.candidates.find((c) => !c.support.startsWith("control"))?.region ?? "earth:hanksville";
  const climateSite = body === "earth" ? selected.earth : body === "mars" && step === 4 ? fieldSite : null;
  useEffect(() => {
    if (!climateSite || !model || climate?.region.region === climateSite) return;
    setClimateError(null); setClimate(null);
    scienceApi.climate(climateSite).then(setClimate).catch((e) => setClimateError(e.message));
  }, [climateSite, model, climate?.region.region]);

  const switchBody = (b: Body) => {
    setBody(b); setPlacing(false); setProbe(null); setThreeD(false); setSurface(false); setWorld(false);
    if (b === "moon") fly(3.6, 20, 2.2);
    else if (b === "earth") fly(-60, 25, 1.7);
    else if (terrain) fly(terrain.grid.lon0, terrain.grid.lat0, 11.4);
  };

  /** Open any region on its own world's map: the link that joins the Mars, Moon and Earth views. */
  const openRegion = (id: string) => {
    const r = [...regions.mars, ...regions.moon, ...regions.earth].find((q) => q.region === id);
    if (!r) return;
    if (r.body !== body) switchBody(r.body as Body);
    if (id === "mars:jezero") {
      // The mission area: go to the mission map, not the regional view.
      setSelected((s) => ({ ...s, mars: id }));
      if (terrain) fly(terrain.grid.lon0, terrain.grid.lat0, 11.4);
      return;
    }
    selectRegion(r);
    // Another Mars region is a look elsewhere; the Region step is the one that explains it.
    if (r.body === "mars") { setStep(0); setPlacing(false); }
  };

  const goStep = (i: number) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, i));
    setStep(next);
    if (next !== 2) setPlacing(false);
  };
  useEffect(() => { if (step === 6 && mission) setReviewed(true); }, [step, mission]);
  // The best score of the session, so a replay has something to beat.
  const total = mission?.score?.total;
  useEffect(() => { if (total !== undefined) setBest((b) => (b === null || total > b ? total : b)); }, [total]);

  const coach = COACH[step];
  const coachCtx: CoachCtx = { mission, analogs: Object.keys(analogs).length > 0, triedFoot, probed, reviewed };
  const coachScore = COACH.filter((c) => c.done(coachCtx)).length;
  const slopeOn = body === "mars" && !!layers.slope;

  // What each step hands to the next. Words only: every value comes from the services.
  const jezeroAnalogs = analogs["mars:jezero"];
  const siteName = regions.earth.find((r) => r.region === fieldSite)?.name ?? "Hanksville";
  const moverName = profiles.find((q) => q.key === mission?.mover)?.name ?? "mover";
  const feas = mission?.plan?.feasibility;
  const visited = mission?.targets.filter((t) => t.visited).length ?? 0;
  const ran = !!mission && mission.sim.phase !== "idle" && mission.sim.phase !== "manual";
  const carried: { text: string; tone?: "good" | "warn" | "bad" } = (() => {
    if (step === 0) return { text: terrain ? "The Jezero map is loaded and checked against the real rover's path. Next, find where on Earth this ground can be rehearsed." : "The mission area has not loaded." };
    if (step === 1) return jezeroAnalogs
      ? { text: `Rehearsal site for Jezero: ${siteName}. It becomes the field site in the Habitat step.`, tone: "good" }
      : { text: `No search for Jezero yet, so ${siteName} stands in as the field site until you run one.` };
    if (!mission) return { text: "Create the mission to continue." };
    if (step === 2) return mission.plan
      ? { text: `${mission.targets.length} target${mission.targets.length === 1 ? "" : "s"}, ${fmtDistance(mission.plan.distance_m)} and ${fmtDuration(mission.plan.seconds)} for the ${moverName.toLowerCase()}. Next, check it can be done safely.`, tone: "good" }
      : { text: "No route yet. Add a target on the map to get one." };
    if (step === 3) return !feas ? { text: "No route to check yet. Add a target in the Route step." }
      : feas.ok ? { text: "The route passes the consumables check with its reserve. Next, size the habitat it leaves from.", tone: "good" }
      : { text: "The route fails the consumables check, so the traverse will be refused. Change the mover or move the targets.", tone: "bad" };
    if (step === 4) return { text: `${(mission.habitat.food_grown_share * 100).toFixed(0)}% of food grown on site; power margin ${mission.habitat.power_margin_kwh_per_sol >= 0 ? "+" : ""}${mission.habitat.power_margin_kwh_per_sol.toFixed(0)} kWh per sol. Next, run the traverse.`,
                             tone: mission.habitat.power_margin_kwh_per_sol >= 0 ? undefined : "warn" };
    if (step === 5) return mission.score
      ? { text: `Traverse finished: ${mission.score.total.toFixed(0)} of 100. The review shows what happened and what the evidence supports.`, tone: "good" }
      : ran ? { text: `Traverse under way: ${visited} of ${mission.targets.length} targets visited, ${mission.sim.replans} replan${mission.sim.replans === 1 ? "" : "s"}.` }
      : { text: mission.plan ? "The plan is ready. Start the traverse." : "No route yet. Add a target in the Route step." };
    return { text: "This is the whole mission. Reset the simulation to replay it, or visit the Moon and Earth from the top bar." };
  })();

  // Review step: what every part of the product did in this mission.
  const linkedClps = clps?.deliveries.filter((d) => d.region).length ?? 0;
  const partRows: PartRow[] = !mission ? [] : [
    { key: "map", result: mission.plan
        ? `${mission.targets.length} target${mission.targets.length === 1 ? "" : "s"} on a ${fmtDistance(mission.plan.distance_m)} route for the ${moverName.toLowerCase()}${ran ? `; ${visited} visited, ${mission.sim.replans} replan${mission.sim.replans === 1 ? "" : "s"}` : ""}.`
        : "No route was planned.",
      action: { label: "Open route", run: () => goStep(2) } },
    { key: "analogs", result: jezeroAnalogs
        ? `The search picked ${siteName} as the place to rehearse Jezero.`
        : `No search was run for Jezero, so ${siteName} stood in as the rehearsal site.`,
      action: { label: "Open analogs", run: () => goStep(1) } },
    { key: "health", result: !mission.sim.health.monitored ? "The robotic scout carries no crew, so nothing was monitored."
        : !ran ? "The monitor starts with the traverse."
        : `Heart rate ${mission.sim.health.heart_rate_bpm.toFixed(0)} bpm and fatigue ${(mission.sim.health.fatigue * 100).toFixed(0)}% at the last reading${mission.sim.health.anomaly ? ", with an alert active" : ", with no alert active"}. Simulated.`,
      action: { label: "Open crew", run: () => goStep(3) } },
    { key: "farm", result: `${(mission.habitat.food_grown_share * 100).toFixed(0)}% of the crew's food energy grown on site, with NASA climate records for ${siteName} beside it.`,
      action: { label: "Open habitat", run: () => goStep(4) } },
    { key: "game", result: mission.score
        ? `${mission.score.total.toFixed(0)} of 100 (${mission.score.rank})${best !== null && best > mission.score.total ? `; best this session ${best.toFixed(0)}` : ""}.`
        : "No score yet: it is given when the traverse ends.",
      action: { label: "Open simulation", run: () => goStep(5) } },
    { key: "trainer", result: training ? `${coachScore} of ${COACH.length} training tasks done.` : "Training mode is off. Turn it on for one task in each step.",
      action: training ? undefined : { label: "Turn on training", run: () => setTraining(true) } },
    { key: "clps", result: clps ? `${clps.deliveries.length} NASA lunar deliveries listed, ${linkedClps} linked to lunar terrain this build has measured.` : "NASA's delivery list did not load.",
      action: { label: "Open the Moon", run: () => switchBody("moon") } },
  ];

  return (
    <div className="grid h-screen grid-rows-[48px_1fr]">
      {/* Top bar */}
      <header className="flex items-center gap-4 border-b border-line bg-panel px-4">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[13px] font-semibold tracking-[0.14em] text-text">BEYOND EARTH LABS</span>
          <span className="text-[12px] text-faint">Martian Map</span>
        </div>
        <div className="ml-2 flex rounded-md border border-line-strong p-0.5" role="radiogroup" aria-label="Body">
          {(["mars", "moon", "earth"] as const).map((b) => (
            <button key={b} role="radio" aria-checked={body === b} onClick={() => switchBody(b)}
                    className={`rounded px-3 py-1 text-[12px] font-medium transition-colors ${body === b ? "bg-raised text-text" : "text-muted hover:text-text"}`}>
              {BODY_NAME[b]}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {mission && <span className="truncate text-[12px] text-muted">{mission.name}</span>}
        {worldUp && (
          <div className="flex items-center gap-1 rounded-md border border-mars/60 bg-mars/10 py-0.5 pl-2.5 pr-0.5" role="group" aria-label="3D simulation">
            <span className="text-[12px] font-semibold text-mars-soft">3D simulation</span>
            {(["mars", "earth"] as const).map((site) => {
              const on = world && worldSite === site;
              return (
                <button key={site} className={`btn h-6 px-2.5 ${on ? "border-mars text-mars-soft" : "btn-primary"}`} aria-pressed={on}
                        onClick={() => (on ? setWorld(false) : openWorld(site))}
                        title={site === "mars" ? "Your rover and your astronaut on the ground at Jezero Crater, running this mission"
                                               : "The same rover and astronaut on Earth, at Garden of the Gods in Shawnee National Forest, Illinois"}>
                  {site === "mars" ? "Mars" : "Earth"}
                </button>
              );
            })}
          </div>
        )}
        <button className={`btn h-7 ${space ? "border-mars text-mars-soft" : ""}`} aria-pressed={space} onClick={() => setSpace((v) => !v)}
                title="See Earth, the Moon and Mars together">Space view</button>
        <a href={`${BASE}/guide${STATIC ? "/" : ""}`} target="_blank" rel="noreferrer" className="text-[12px] text-muted underline-offset-4 hover:text-text hover:underline">Guide</a>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
          <input type="checkbox" checked={training} onChange={(e) => setTraining(e.target.checked)} className="accent-[var(--color-mars)]" />
          Training mode
        </label>
        <div className="flex items-center gap-3 text-[11px] text-muted" aria-label="Service status">
          {(["mission", "science"] as const).map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${services[k] === null ? "bg-faint" : services[k] ? "bg-good" : "bg-bad"}`} />
              {k} service{services[k] === false && " offline"}
            </span>
          ))}
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[400px_1fr]">
        {/* Sidebar */}
        <aside className="flex min-h-0 flex-col border-r border-line bg-panel">
          {body === "mars" ? (
            <>
              <nav className="grid grid-cols-7 border-b border-line" aria-label="Mission steps">
                {STEPS.map((s, i) => (
                  <button key={s} onClick={() => goStep(i)} aria-current={step === i ? "step" : undefined}
                          disabled={!mission && i > 1}
                          className={`flex flex-col items-center gap-0.5 border-b-2 py-2 transition-colors disabled:opacity-35 ${step === i ? "border-mars text-text" : "border-transparent text-muted hover:text-text"}`}>
                    <span className="num text-[10px] text-faint">{i + 1}</span>
                    <span className="text-[11px] font-medium">{s}</span>
                  </button>
                ))}
              </nav>
              {training && (
                <div className="border-b border-line bg-[#141024] px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="label text-[#b59ae6]">Trainer</span>
                    <span className="flex-1" />
                    <span className="num text-[11px] text-muted">{coachScore} of {COACH.length} done</span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-snug text-text">
                    <span className={coach.done(coachCtx) ? "text-good" : "text-warn"}>{coach.done(coachCtx) ? "Done. " : "Your task. "}</span>{coach.task}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-snug text-[#b59ae6]">Why it matters: {coach.why}</p>
                  {coachScore === COACH.length && <p className="mt-1 text-[11.5px] font-medium text-good">All seven tasks done. You have planned and flown a whole Marswalk.</p>}
                </div>
              )}
              <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
                {step === 0 && <StepRegion terrain={terrain} regions={regions.mars} selected={selected.mars}
                                           onSelect={selectRegion} onAnalogs={() => goStep(1)}
                                           onJezero={() => { setSelected((s) => ({ ...s, mars: "mars:jezero" })); if (terrain) fly(terrain.grid.lon0, terrain.grid.lat0, 11.6); }} />}
                {step === 1 && <StepAnalogs result={region ? analogs[region.region] ?? null : null} loading={analogBusy} error={analogError}
                                            region={region} onRun={runAnalogs} modelReady={!!model} onOpen={openRegion} />}
                {mission && step === 2 && <StepRoute mission={mission} profiles={profiles} placing={placing} setPlacing={setPlacing} busy={busy}
                                                     goal={goal} setGoal={setGoal} fineBusy={fineBusy} onWorld={worldUp ? () => openWorld("mars") : undefined}
                                                     onFine={(avoid) => { setFineBusy(true); command(() => missionApi.fineCheck(mission.id, avoid)).finally(() => setFineBusy(false)); }}
                                                     onPlan={(mv, obj, risk) => { if (mv === "astronaut") setTriedFoot(true); command(() => missionApi.plan(mission.id, mv, obj, risk)); }}
                                                     onClear={() => command(() => missionApi.clearTargets(mission.id))} />}
                {mission && step === 3 && <StepCrew mission={mission} reserves={reserves} />}
                {mission && step === 4 && <StepHabitat mission={mission} busy={busy} climate={climate} climateError={climateError} onOpenSite={openRegion}
                                                       onChange={(crew, sols, crops, overrides) => command(() => missionApi.habitat(mission.id, crew, sols, crops, overrides))} />}
                {mission && step === 5 && <StepSim mission={mission} running={running} speed={speed} setSpeed={setSpeed} busy={busy}
                                                   best={best} onCrew={() => goStep(3)}
                                                   onStart={() => { if (mission.sim.phase === "idle") command(() => missionApi.sim(mission.id, "start")).then(() => setRunning(true)); else setRunning(true); }}
                                                   onPause={() => setRunning(false)}
                                                   onReset={() => { setRunning(false); command(() => missionApi.sim(mission.id, "reset")); }}
                                                   onEmergency={(kind) => command(() => missionApi.sim(mission.id, "emergency", { kind }))} />}
                {mission && step === 6 && <StepReview mission={mission} model={model} region={region} parts={partRows} best={best} />}
              </div>
              <StepFooter step={step} steps={STEPS} carried={carried.text} tone={carried.tone} canNext={!!mission || step < 1} onStep={goStep} />
            </>
          ) : body === "moon" ? (
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              <WorldBanner missionName={mission?.name ?? null} onBack={() => switchBody("mars")} />
              <div className="border-b border-line px-4 py-3.5">
                <h2 className="text-[14px] font-medium text-text">Lunar comparison</h2>
                <p className="mt-1.5 text-[12px] leading-snug text-muted">
                  The same pipeline reads the Moon: LROC Wide Angle Camera images and LOLA elevation from the Lunar Reconnaissance Orbiter, cut into the same 11 km cells and embedded by the same network that ranked Earth sites for your Mars mission. Pick a region, or one of NASA&apos;s lunar deliveries below, to compare it with Earth test sites.
                </p>
                <div className="mt-2"><Note>Lunar route planning is not in this build.</Note></div>
              </div>
              <StepAnalogs result={region ? analogs[region.region] ?? null : null} loading={analogBusy} error={analogError}
                           region={region} onRun={runAnalogs} modelReady={!!model} onOpen={openRegion} />
              <ClpsBrowser clps={clps} selected={selected.moon}
                           onRegion={(id) => { onRegionMarker(id); if (model && !analogs[id]) runAnalogsFor(id); }} />
              <StepRegion lunar terrain={null} regions={regions.moon} selected={selected.moon} onSelect={selectRegion} onJezero={() => undefined} />
            </div>
          ) : (
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              <WorldBanner missionName={mission?.name ?? null} onBack={() => switchBody("mars")} />
              <div className="border-b border-line px-4 py-3.5">
                <h2 className="text-[14px] font-medium text-text">Earth test sites</h2>
                <p className="mt-1.5 text-[12px] leading-snug text-muted">
                  Hardware and crews for Mars and the Moon are rehearsed on Earth. Pick a site to see which Mars or Moon terrain it most resembles, and NASA&apos;s climate record for it. Imagery is NASA&apos;s Blue Marble; terrain is from the Shuttle Radar Topography Mission.
                </p>
                <div className="mt-2.5 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Compare with">
                  {(["mars", "moon"] as const).map((t) => (
                    <button key={t} role="radio" aria-checked={earthTarget === t} onClick={() => setEarthTarget(t)}
                            className={`btn ${earthTarget === t ? "border-mars text-mars-soft" : ""}`}>Compare with {BODY_NAME[t]}</button>
                  ))}
                </div>
              </div>
              <StepAnalogs result={analogs[analogKey] ?? null} loading={analogBusy} error={analogError}
                           region={region} onRun={runAnalogs} modelReady={!!model} target={earthTarget} onOpen={openRegion} />
              {selected.earth && <FieldSite climate={climate} error={climateError} lead="What farming and field work face at this site." />}
              <StepRegion earth terrain={null} regions={regions.earth} selected={selected.earth} onSelect={selectRegion} onJezero={() => undefined} />
            </div>
          )}
        </aside>

        {/* Map */}
        <main className="relative min-h-0">
          <MapView body={body} terrain={terrain} dem={dem} threeD={threeD} surface={surface}
                   aim={planned && mission ? mission.sim.heading_deg : aim} m2020={m2020} mission={mission} layers={layers} regions={regions[body]}
                   selectedRegion={selected[body]} focus={focus} placing={placing && step === 2} onClick={onMapClick} onRegion={onRegionMarker} />

          {world && (
            <div className="absolute inset-0 z-40 bg-black" role="region" aria-label={worldSite === "earth" ? "3D simulation on Earth" : "3D simulation: the mission on the ground at Jezero"}>
              {worldSite === "earth" ? (
                <iframe key="earth" src={`${WORLD_URL}${WORLD_INDEX}?region=shawnee&intro=0&embed=1`}
                        title="3D simulation of the Earth field site at Garden of the Gods, Illinois" className="h-full w-full border-0" allow="fullscreen" />
              ) : (
                <iframe key={`${mission?.id ?? "none"}-${mission?.mover ?? ""}-${mission?.plan?.revision ?? 0}-${mission?.fine_check?.revision ?? 0}`}
                        src={`${WORLD_URL}${WORLD_INDEX}?intro=0&embed=1${mission ? `&mission=${encodeURIComponent(mission.id)}` : ""}`}
                        title="3D world of Jezero Crater showing this mission" className="h-full w-full border-0" allow="fullscreen" />
              )}
              <button className="btn absolute bottom-4 left-1/2 -translate-x-1/2 bg-panel/95" onClick={() => setWorld(false)}>Back to the map</button>
            </div>
          )}

          {space && (
            <SpaceView counts={{ mars: regions.mars.length, moon: regions.moon.length, earth: regions.earth.length }}
                       onClose={() => setSpace(false)}
                       onPick={(b) => { setSpace(false); switchBody(b); }} />
          )}

          {/* View controls */}
          <div className="absolute left-14 top-3 flex gap-1.5">
            {body === "mars" && (
              <button className={`btn bg-panel/95 ${threeD ? "border-mars text-mars-soft" : ""}`} aria-pressed={threeD} disabled={!dem}
                      title={dem ? "Raise the surface from the measured elevation model" : "3D terrain is not available"}
                      onClick={() => { if (terrain) { if (threeD) fly(terrain.grid.lon0, terrain.grid.lat0, 11.6); else if (mission) fly(mission.sim.lon, mission.sim.lat, 14.6, 70, -32); else fly(terrain.grid.lon0 - 0.012, terrain.grid.lat0 - 0.004, 12.5, 66, -30); } setThreeD((v) => !v); }}>
                {threeD ? "3D terrain on" : "3D terrain"}
              </button>
            )}
            {body === "mars" && mission && (
              <button className={`btn bg-panel/95 ${surface ? "border-mars text-mars-soft" : ""}`} aria-pressed={surface} disabled={!dem}
                      title="Ride close behind your rover or astronaut and drive by hand"
                      onClick={() => {
                        if (surface) { setSurface(false); fly(mission.sim.lon, mission.sim.lat, 14.6, 70, -32); }
                        else { setAim(mission.sim.heading_deg); setThreeD(true); setSurface(true); }
                      }}>
                {surface ? "Surface view on" : "Surface view"}
              </button>
            )}
            {body !== "moon" && worldUp && (
              <button className="btn btn-primary"
                      title={body === "earth" ? "The 3D simulation on Earth: the rover and the astronaut at Garden of the Gods, Illinois"
                                              : "The 3D simulation: your rover and your astronaut on the ground at Jezero, running this mission"}
                      onClick={() => openWorld(body === "earth" ? "earth" : "mars")}>
                3D simulation
              </button>
            )}
            <button className="btn bg-panel/95" title={`Zoom out to see all of ${BODY_NAME[body]}`}
                    onClick={() => { setThreeD(false); const c = body === "mars" ? [77.4, 18.4] : body === "moon" ? [3.6, 20] : [-60, 25]; fly(c[0], c[1], 1.6); }}>
              Whole {body === "moon" ? "Moon" : "planet"}
            </button>
            {body === "mars" && terrain && (
              <button className="btn bg-panel/95" onClick={() => fly(terrain.grid.lon0, terrain.grid.lat0, 11.6)}>Jezero</button>
            )}
          </div>

          {/* Layers */}
          {body === "mars" && (
            <div className="absolute right-3 top-3 w-64 rounded-lg border border-line-strong bg-panel/95 backdrop-blur">
              <button className="flex w-full items-center justify-between px-3 py-2" onClick={() => setLayersOpen((v) => !v)} aria-expanded={layersOpen}>
                <span className="label">Map layers</span><span className="text-[11px] text-faint">{layersOpen ? "Hide" : "Show"}</span>
              </button>
              {layersOpen && (
                <div className="border-t border-line px-3 pb-2.5 pt-1.5">
                  {LAYER_GROUPS.map((g) => (
                    <fieldset key={g.title} className="mt-1.5">
                      <legend className="mb-1 text-[10.5px] text-faint">{g.title}</legend>
                      {g.items.map((it) => {
                        const missing = (it.key === "thermal" || it.key === "slope" || it.key === "hillshade") && !terrain?.overlays?.[it.key]?.file;
                        return (
                          <label key={it.key} title={it.source} className={`flex items-center gap-2 py-[3px] text-[12px] ${missing ? "text-faint" : "cursor-pointer text-text"}`}>
                            <input type="checkbox" className="accent-[var(--color-mars)]" disabled={missing} checked={!!layers[it.key]}
                                   onChange={(e) => setLayers((l) => ({ ...l, [it.key]: e.target.checked }))} />
                            <span className="flex-1">{it.label}{missing && " (not built)"}</span>
                            <Chip kind={it.kind} />
                          </label>
                        );
                      })}
                    </fieldset>
                  ))}
                  {slopeOn && terrain?.overlays.slope?.ramp && (
                    <div className="mt-2 border-t border-line pt-2">
                      <div className="h-2 rounded-sm" style={{ background: `linear-gradient(90deg, ${terrain.overlays.slope.ramp.map((s) => `rgb(${s.rgb.join(",")})`).join(",")})` }} />
                      <div className="num mt-0.5 flex justify-between text-[10px] text-muted">{terrain.overlays.slope.ramp.map((s) => <span key={s.value}>{s.value}°</span>)}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Point inspection */}
          {probe && body === "mars" && (
            <div className="absolute bottom-10 left-3 w-[300px] rounded-lg border border-line-strong bg-panel/95 p-3 backdrop-blur">
              <div className="mb-1.5 flex items-center gap-2"><span className="label">This point</span><Chip kind="calc" /><span className="flex-1" />
                <button className="text-[11px] text-faint hover:text-text" onClick={() => setProbe(null)} aria-label="Close point details">Close</button></div>
              <div className="num text-[11px] text-muted">{probe.lat.toFixed(4)}° N, {probe.lon.toFixed(4)}° E</div>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <div><div className="text-[11px] text-muted">Elevation</div><div className="num text-[14px]">{probe.elevation_m.toFixed(0)} m</div></div>
                <div><div className="text-[11px] text-muted">Slope</div><div className={`num text-[14px] ${probe.slope_deg > 20 ? "text-bad" : probe.slope_deg > 15 ? "text-warn" : ""}`}>{probe.slope_deg.toFixed(1)}°</div></div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {profiles.map((q) => <span key={q.key} className={`chip ${probe.enterable[q.key] ? "chip-obs" : "chip-sim"}`}>{q.kind === "astronaut" ? "On foot" : q.name.split(" ")[0] + " rover"}: {probe.enterable[q.key] ? "passable" : "too steep"}</span>)}
              </div>
              <div className="mt-3 border-t border-line pt-2.5">
                <div className="mb-1.5 flex items-center gap-2"><span className="label">View from the ground</span><Chip kind="obs" /></div>
                {!views && <p className="text-[11.5px] text-muted">Looking for rover images near here…</p>}
                {views && !views.available && <p className="text-[11.5px] leading-snug text-muted">{views.reason}</p>}
                {views?.available && views.images && views.waypoint && (
                  <>
                    <div className="grid grid-cols-3 gap-1">
                      {views.images.map((im) => (
                        <a key={im.id} href={im.large} target="_blank" rel="noreferrer" title={`${im.title}, ${im.date_utc.slice(0, 10)}. Opens the full image.`}
                           className="block overflow-hidden rounded border border-line hover:border-muted">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={im.small} alt={`Perseverance navigation camera view, sol ${views.waypoint!.sol}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                        </a>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px] leading-snug text-muted">
                      Perseverance Navcam, sol {views.waypoint.sol}, from a stop <span className="num">{views.waypoint.distance_m.toFixed(0)} m</span> from this point. NASA/JPL-Caltech.
                    </p>
                    <p className="mt-0.5 text-[10.5px] leading-snug text-faint">{views.note}</p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Surface view heads-up strip */}
          {surface && mission && body === "mars" && (
            <div className="absolute bottom-10 left-1/2 w-[min(640px,86%)] -translate-x-1/2 rounded-lg border border-line-strong bg-panel/90 px-4 py-2.5 backdrop-blur">
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium text-text">
                    {planned ? "Riding along the planned route" : mission.sim.phase === "idle" || mission.sim.phase === "manual" ? "Drive by hand" : "Traverse finished: reset to drive by hand"}
                  </div>
                  <div className="text-[11.5px] text-muted">
                    {planned ? "The camera follows the mover." : <>
                      <kbd className="num rounded border border-line-strong px-1">W</kbd> forward · <kbd className="num rounded border border-line-strong px-1">S</kbd> back · <kbd className="num rounded border border-line-strong px-1">A</kbd> <kbd className="num rounded border border-line-strong px-1">D</kbd> turn · arrow keys work too
                    </>}
                  </div>
                </div>
                <div className="num grid grid-cols-4 gap-x-4 text-[11px] text-muted">
                  <span>heading<br /><span className="text-[13px] text-text">{Math.round(planned ? mission.sim.heading_deg : aim)}°</span></span>
                  <span>slope<br /><span className={`text-[13px] ${mission.sim.slope_deg > 15 ? "text-warn" : "text-text"}`}>{mission.sim.slope_deg.toFixed(1)}°</span></span>
                  <span>driven<br /><span className="text-[13px] text-text">{mission.sim.distance_m.toFixed(0)} m</span></span>
                  <span>{mission.sim.resource === "oxygen_kg" ? "oxygen" : "battery"}<br /><span className={`text-[13px] ${mission.sim.return_margin < 0 ? "text-bad" : "text-text"}`}>{((mission.sim.remaining / Math.max(mission.sim.capacity, 1e-9)) * 100).toFixed(0)}%</span></span>
                </div>
              </div>
              <p className="mt-1.5 text-[10.5px] leading-snug text-faint">
                Moves are computed by the mission service with the same slope limits as a planned route. The rust tint over the grey orbital images is illustrative, and the model is enlarged.
              </p>
            </div>
          )}

          {toast && (
            <div className="absolute left-1/2 top-3 w-[min(560px,80%)] -translate-x-1/2" role="alert"><Note tone={toast.tone}>{toast.text}</Note></div>
          )}

          {/* Start */}
          {!mission && body === "mars" && (
            <div className="absolute inset-0 grid place-items-center bg-ink/55 backdrop-blur-[2px]">
              <form className="w-[440px] rounded-xl border border-line-strong bg-panel p-6 shadow-2xl" onSubmit={(e) => { e.preventDefault(); create(); }}>
                <p className="label text-mars-soft">Interplanetary Survival Guide · Martian Map</p>
                <h1 className="mt-2 text-[22px] font-semibold leading-tight text-text">Plan a Marswalk at Jezero Crater</h1>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">
                  A layered map built from five NASA missions. One mission runs through seven steps: the map, a rehearsal site on Earth, a route, crew safety, a habitat, the traverse itself, and a review of what happened.
                </p>
                <label className="mt-4 block"><span className="text-[12px] text-muted">Mission name</span>
                  <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></label>
                <fieldset className="mt-3"><legend className="text-[12px] text-muted">Who is travelling</legend>
                  <div className="mt-1 grid grid-cols-3 gap-1.5">
                    {(profiles.length ? profiles : [{ key: "crew_rover", name: "Crew rover" } as Profile]).map((q) => (
                      <button type="button" key={q.key} onClick={() => setMover(q.key)} aria-pressed={mover === q.key}
                              className={`rounded-md border px-2 py-2 text-left text-[12px] leading-tight transition-colors ${mover === q.key ? "border-mars bg-mars/10 text-text" : "border-line-strong text-muted hover:border-muted"}`}>{q.name}</button>
                    ))}
                  </div></fieldset>
                <button className="btn btn-primary mt-5 h-9 w-full text-[13px]" disabled={busy || services.mission === false}>Create exploration mission</button>
                {worldUp && (
                  <div className="mt-3 rounded-md border border-line-strong p-2.5">
                    <p className="text-[12px] text-muted">Or go straight to the ground in the 3D simulation, with a rover and an astronaut:</p>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      <button type="button" className="btn" onClick={() => openWorld("mars")}>Mars · Jezero Crater</button>
                      <button type="button" className="btn" onClick={() => openWorld("earth")}>Earth · Garden of the Gods</button>
                    </div>
                  </div>
                )}
                {services.mission === false && <p className="mt-2 text-[12px] text-bad">The mission service is not reachable on port 8300.</p>}
                <p className="mt-3 text-[11px] leading-snug text-faint">Planning aid built for a hackathon. Estimates only; not certified for spacecraft operations or crew safety.</p>
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
