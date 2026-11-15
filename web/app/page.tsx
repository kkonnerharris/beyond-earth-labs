"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { missionApi, scienceApi, type AnalogResult, type Climate, type Clps, type GroundViews, type M2020, type Mission, type Profile, type RegionInfo, type Terrain } from "@/lib/api";
import type { Focus, LayerState } from "@/components/MapView";
import { ClpsBrowser, StepAnalogs, StepCrew, StepHabitat, StepRegion, StepRoute, StepSim } from "@/components/Steps";
import { StepReview, type Evidence } from "@/components/Review";
import { Chip, Note, type Kind } from "@/components/ui";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

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

const COACH: { task: string; done: (c: { mission: Mission | null; analogs: boolean; triedFoot: boolean }) => boolean }[] = [
  { task: "Open the Jezero map and read how it was checked against the real rover.", done: () => true },
  { task: "Run the Earth analog search, then open the top candidate to see what was measured.", done: (c) => c.analogs },
  { task: "Place two science targets and get a plan the service accepts.", done: (c) => !!c.mission && c.mission.targets.length >= 2 && !!c.mission.plan?.feasibility.ok },
  { task: "Switch the mover to the astronaut on foot. Is the same plan still safe on oxygen?", done: (c) => c.triedFoot },
  { task: "Grow at least 20% of the crew's food. What did it do to the power margin?", done: (c) => (c.mission?.habitat.food_grown_share ?? 0) >= 0.2 },
  { task: "Start the traverse, inject an obstacle, and still score 70 or more.", done: (c) => (c.mission?.sim.replans ?? 0) > 0 && (c.mission?.score?.total ?? 0) >= 70 },
  { task: "Find what the evidence says about learning on Earth and testing on Mars.", done: () => true },
];

export default function Workspace() {
  const [body, setBody] = useState<"mars" | "moon">("mars");
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [m2020, setM2020] = useState<M2020 | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reserves, setReserves] = useState({ oxygen: 0.25, battery: 0.2 });
  const [regions, setRegions] = useState<Record<"mars" | "moon", RegionInfo[]>>({ mars: [], moon: [] });
  const [selected, setSelected] = useState<Record<"mars" | "moon", string | null>>({ mars: "mars:jezero", moon: null });
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
  const inFlight = useRef(false);
  const focusKey = useRef(0);

  const fly = useCallback((lon: number, lat: number, zoom: number) => setFocus({ lon, lat, zoom, key: ++focusKey.current }), []);
  const warn = useCallback((text: string, tone: "bad" | "warn" = "bad") => {
    setToast({ text, tone });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 6000);
  }, []);

  // Load everything the workspace needs. Each failure is reported, never hidden.
  useEffect(() => {
    missionApi.health().then(() => setServices((s) => ({ ...s, mission: true }))).catch(() => setServices((s) => ({ ...s, mission: false })));
    scienceApi.health().then(() => setServices((s) => ({ ...s, science: true }))).catch(() => setServices((s) => ({ ...s, science: false })));
    scienceApi.terrain().then(setTerrain).catch((e) => warn(`Terrain did not load: ${e.message}`));
    scienceApi.m2020().then(setM2020).catch(() => undefined);
    missionApi.profiles().then((r) => { setProfiles(r.profiles); setReserves(r.reserves); }).catch(() => undefined);
    scienceApi.regions("mars").then((r) => setRegions((x) => ({ ...x, mars: r }))).catch(() => undefined);
    scienceApi.regions("moon").then((r) => setRegions((x) => ({ ...x, moon: r }))).catch(() => undefined);
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

  const create = () => command(async () => {
    const m = await missionApi.create(name.trim() || "Exploration mission", mover);
    fly(m.base.lon, m.base.lat, 12.6);
    return m;
  });

  const onMapClick = useCallback((lon: number, lat: number) => {
    if (body !== "mars" || !mission) return;
    if (placing && step === 2) {
      const n = mission.targets.length + 1;
      command(() => missionApi.addTarget(mission.id, lon, lat, `Target ${n}`, "Image and sample the outcrop", 20));
      return;
    }
    setViews(null);
    missionApi.sample(lon, lat)
      .then((r) => {
        setProbe({ lon, lat, elevation_m: r.sample.elevation_m, slope_deg: r.sample.slope_deg, enterable: r.enterable });
        scienceApi.views(r.sample.x, r.sample.y).then(setViews).catch((e) => setViews({ available: false, reason: e.message }));
      })
      .catch(() => setProbe(null));
  }, [body, mission, placing, step, command]);

  const selectRegion = useCallback((r: RegionInfo) => {
    setSelected((s) => ({ ...s, [r.body as "mars" | "moon"]: r.region }));
    fly(r.lon, r.lat, r.body === "moon" ? 5.6 : 6.4);
  }, [fly]);
  const onRegionMarker = useCallback((id: string) => {
    const r = [...regions.mars, ...regions.moon].find((q) => q.region === id);
    if (r) selectRegion(r);
  }, [regions, selectRegion]);

  const region = useMemo(() => regions[body].find((r) => r.region === selected[body]) ?? null, [regions, body, selected]);
  const runAnalogsFor = useCallback((id: string) => {
    setAnalogBusy(true); setAnalogError(null);
    scienceApi.analogs(id, 29)
      .then((r) => setAnalogs((a) => ({ ...a, [id]: r })))
      .catch((e) => setAnalogError(e.message))
      .finally(() => setAnalogBusy(false));
  }, []);
  const runAnalogs = () => { if (region) runAnalogsFor(region.region); };

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
  useEffect(() => {
    if (step !== 4 || !model || climate?.region.region === fieldSite) return;
    setClimateError(null);
    scienceApi.climate(fieldSite).then(setClimate).catch((e) => setClimateError(e.message));
  }, [step, fieldSite, model, climate?.region.region]);

  const switchBody = (b: "mars" | "moon") => {
    setBody(b); setPlacing(false); setProbe(null);
    if (b === "moon") fly(3.6, 20, 2.6); else if (terrain) fly(terrain.grid.lon0, terrain.grid.lat0, 11.4);
  };

  const coach = COACH[step];
  const coachCtx = { mission, analogs: Object.keys(analogs).length > 0, triedFoot };
  const coachScore = COACH.filter((c) => c.done(coachCtx)).length;
  const slopeOn = body === "mars" && !!layers.slope;

  return (
    <div className="grid h-screen grid-rows-[48px_1fr]">
      {/* Top bar */}
      <header className="flex items-center gap-4 border-b border-line bg-panel px-4">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[13px] font-semibold tracking-[0.14em] text-text">BEYOND EARTH LABS</span>
          <span className="text-[12px] text-faint">Martian Map</span>
        </div>
        <div className="ml-2 flex rounded-md border border-line-strong p-0.5" role="radiogroup" aria-label="Body">
          {(["mars", "moon"] as const).map((b) => (
            <button key={b} role="radio" aria-checked={body === b} onClick={() => switchBody(b)}
                    className={`rounded px-3 py-1 text-[12px] font-medium transition-colors ${body === b ? "bg-raised text-text" : "text-muted hover:text-text"}`}>
              {b === "mars" ? "Mars" : "Moon comparison"}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {mission && <span className="truncate text-[12px] text-muted">{mission.name}</span>}
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
                  <button key={s} onClick={() => { setStep(i); if (i !== 2) setPlacing(false); }} aria-current={step === i ? "step" : undefined}
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
                    <span className={coach.done(coachCtx) ? "text-good" : "text-warn"}>{coach.done(coachCtx) ? "Done. " : "Task. "}</span>{coach.task}
                  </p>
                </div>
              )}
              <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
                {step === 0 && <StepRegion terrain={terrain} regions={regions.mars} selected={selected.mars}
                                           onSelect={selectRegion}
                                           onJezero={() => { setSelected((s) => ({ ...s, mars: "mars:jezero" })); if (terrain) fly(terrain.grid.lon0, terrain.grid.lat0, 11.6); }} />}
                {step === 1 && <StepAnalogs result={region ? analogs[region.region] ?? null : null} loading={analogBusy} error={analogError}
                                            region={region} onRun={runAnalogs} modelReady={!!model} />}
                {mission && step === 2 && <StepRoute mission={mission} profiles={profiles} placing={placing} setPlacing={setPlacing} busy={busy}
                                                     onPlan={(mv, obj, risk) => { if (mv === "astronaut") setTriedFoot(true); command(() => missionApi.plan(mission.id, mv, obj, risk)); }}
                                                     onClear={() => command(() => missionApi.clearTargets(mission.id))} />}
                {mission && step === 3 && <StepCrew mission={mission} reserves={reserves} />}
                {mission && step === 4 && <StepHabitat mission={mission} busy={busy} climate={climate} climateError={climateError}
                                                       onChange={(crew, sols, crops, overrides) => command(() => missionApi.habitat(mission.id, crew, sols, crops, overrides))} />}
                {mission && step === 5 && <StepSim mission={mission} running={running} speed={speed} setSpeed={setSpeed} busy={busy}
                                                   onStart={() => { if (mission.sim.phase === "idle") command(() => missionApi.sim(mission.id, "start")).then(() => setRunning(true)); else setRunning(true); }}
                                                   onPause={() => setRunning(false)}
                                                   onReset={() => { setRunning(false); command(() => missionApi.sim(mission.id, "reset")); }}
                                                   onEmergency={(kind) => command(() => missionApi.sim(mission.id, "emergency", { kind }))} />}
                {mission && step === 6 && <StepReview mission={mission} model={model} region={region} />}
              </div>
            </>
          ) : (
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              <div className="border-b border-line px-4 py-3.5">
                <h2 className="text-[14px] font-medium text-text">Lunar comparison</h2>
                <p className="mt-1.5 text-[12px] leading-snug text-muted">
                  The same pipeline reads the Moon: LROC Wide Angle Camera images and LOLA elevation from the Lunar Reconnaissance Orbiter, cut into the same 11 km cells and embedded by the same network. Pick a region to compare it with Earth test sites.
                </p>
                <div className="mt-2"><Note>Lunar route planning is not in this build.</Note></div>
              </div>
              <StepAnalogs result={region ? analogs[region.region] ?? null : null} loading={analogBusy} error={analogError}
                           region={region} onRun={runAnalogs} modelReady={!!model} />
              <ClpsBrowser clps={clps} selected={selected.moon}
                           onRegion={(id) => { onRegionMarker(id); if (model && !analogs[id]) runAnalogsFor(id); }} />
              <StepRegion lunar terrain={null} regions={regions.moon} selected={selected.moon} onSelect={selectRegion} onJezero={() => undefined} />
            </div>
          )}
        </aside>

        {/* Map */}
        <main className="relative min-h-0">
          <MapView body={body} terrain={terrain} m2020={m2020} mission={mission} layers={layers} regions={regions[body]}
                   selectedRegion={selected[body]} focus={focus} placing={placing && step === 2} onClick={onMapClick} onRegion={onRegionMarker} />

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
                  A layered map built from four NASA missions. Pick targets, get a route that respects slope and consumables, compare the terrain with test sites on Earth, then run the traverse and see how the plan holds up.
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
