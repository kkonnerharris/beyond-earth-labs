import { AlertTriangle, Battery, BatteryCharging, Bell, Bot, Factory, GraduationCap, Siren, Zap, Camera, Compass, Crosshair, Database, Droplets, Eye, Footprints, Gauge, HeartPulse, HelpCircle, Home, Layers, Map, Mountain, Navigation, Play, Radar, Radio, RotateCcw, Route as RouteIcon, Square, Sun, Thermometer, Timer, Wind, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { actions, evaFeasibility, roverFeasibility, ROVER_RESERVE } from '@/state/actions'
import { sim, ui, useUI, type CameraMode, type Layer } from '@/state/store'
import { suitO2Minutes } from '@/simulation/astronaut/eva'
import { HAB_MODULES } from '@/simulation/environment/Props'
import { lightingHour } from '@/simulation/Scene'
import type { World } from '@/simulation/terrain/heightfield'
import { switchRegion } from '@/services/api'
import { startStory } from '@/dashboard/Story'
import { openTrainer } from '@/dashboard/Trainer'
import { startRedHorizon } from '@/state/redHorizon'
import { hab, HAB, habitatAutonomyH } from '@/simulation/habitat'
import { activeAlerts, history, returnBudget, type Limits, type Vital } from '@/simulation/health'

/** Re-render ~10x per second to sample the mutable sim state. */
function useSample(ms = 100) {
  const [, setT] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setT((t) => t + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

/** Data category tag: every number on screen says where it comes from. */
export type Kind = 'NASA' | 'REAL' | 'CALC' | 'SIM' | 'ILLUS'
const KIND: Record<Kind, [string, string, string]> = {
  NASA: ['NASA', 'bg-nasa text-white', 'NASA-derived: real scientific observation'],
  REAL: ['REAL', 'bg-nominal/20 text-nominal', 'A real observation from a source other than NASA'],
  CALC: ['CALC', 'bg-accent/20 text-accent', 'Calculated from documented inputs'],
  SIM: ['SIM', 'bg-white/10 text-ink-3', 'Simulated: synthetic scenario or vehicle telemetry'],
  ILLUS: ['ILLUS', 'bg-purple-500/20 text-purple-300', 'Illustrative: AI-generated or artistic, not data'],
}
export const Tag = ({ k }: { k: Kind }) => (
  <span className={clsx('rounded px-1 font-mono text-[9px] tracking-wider', KIND[k][1])} title={KIND[k][2]}>{KIND[k][0]}</span>
)

function fmtLmst(s: number) {
  const sol = Math.floor(s / 88775)
  const rem = s - sol * 88775
  const h = Math.floor(rem / 3699), m = Math.floor((rem % 3699) / 61.65)
  return `Sol ${sol} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string; icon?: React.ReactNode; key?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="glass flex items-center gap-0.5 rounded-xl p-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} aria-pressed={value === o.id} title={o.key ? `${o.label} (${o.key})` : o.label}
          className={clsx('flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors [&_svg]:size-3.5', value === o.id ? 'bg-nasa text-white' : 'text-ink-2 hover:bg-white/10 hover:text-ink')}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- top right: cameras + layers
export function TopBar({ world, onResetCamera }: { world: World; onResetCamera: () => void }) {
  const camera = useUI((s) => s.camera)
  const layer = useUI((s) => s.layer)
  return (
    <div className="pointer-events-auto absolute right-4 top-4 flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Seg<CameraMode> label="Camera" value={camera} onChange={actions.setCamera} options={[
          { id: 'free', label: 'Free', icon: <Eye />, key: '1' },
          { id: 'astronaut', label: 'Astronaut', icon: <Footprints />, key: '2' },
          { id: 'rover', label: 'Rover', icon: <Camera />, key: '3' },
          { id: 'top', label: 'Top-down', icon: <Map />, key: '4' },
          { id: 'orbit', label: 'Inspect', icon: <RotateCcw />, key: '5' },
        ]} />
        <button onClick={onResetCamera} title="Reset camera (R)" className="glass rounded-xl px-2.5 text-ink-2 hover:text-ink"><Crosshair className="size-4" /></button>
        <button onClick={actions.toggleHelp} title="Controls (H)" className="glass rounded-xl px-2.5 text-ink-2 hover:text-ink"><HelpCircle className="size-4" /></button>
        <button onClick={() => ui.set({ presentation: true })} title="Presentation mode (F)" className="glass rounded-xl px-3 text-xs font-medium text-ink-2 hover:text-ink">Present</button>
      </div>
      <Seg<Layer> label="Map layer" value={layer} onChange={actions.setLayer} options={[
        { id: 'natural', label: 'Surface', icon: <Mountain />, key: 'L' },
        { id: 'slope', label: 'Slope', icon: <Layers /> },
        { id: 'hazard', label: 'Traversability', icon: <AlertTriangle /> },
        ...(world.real?.themis ? [{ id: 'thermal' as Layer, label: 'Thermal IR', icon: <Thermometer /> }] : []),
      ]} />
      {world.m20 && <M20Toggle world={world} />}
      {layer === 'thermal' && world.real?.themis && (
        <div className="glass w-64 rounded-xl px-3 py-2 text-[11px] text-ink-2">
          <div className="mb-1 flex items-center justify-between font-medium text-ink">THEMIS daytime infrared <Tag k="NASA" /></div>
          <div className="h-2 rounded-full" style={{ background: 'linear-gradient(90deg,#1b1a4a,#6b2a7a,#d2513a,#f6b93b,#fff1b8)' }} />
          <div className="mt-1 flex justify-between font-mono text-[10px]"><span>cooler</span><span>warmer</span></div>
          <p className="mt-1 leading-snug text-ink-3">2001 Mars Odyssey, ~100 m/px. Relative brightness, not calibrated temperature.</p>
        </div>
      )}
      {layer === 'slope' && (
        <div className="glass w-60 rounded-xl px-3 py-2 text-[11px] text-ink-2">
          <div className="mb-1 flex items-center justify-between font-medium text-ink">Slope (degrees) <Tag k="CALC" /></div>
          <div className="h-2 rounded-full" style={{ background: 'linear-gradient(90deg,hsl(119 75% 50%),hsl(60 75% 46%),hsl(0 75% 42%))' }} />
          <div className="mt-1 flex justify-between font-mono text-[10px]"><span>0°</span><span>12°</span><span>{world.rover.max_slope_deg}°+ rover blocked</span></div>
        </div>
      )}
      {layer === 'hazard' && (
        <div className="glass w-60 space-y-1 rounded-xl px-3 py-2 text-[11px] text-ink-2">
          <div className="flex items-center justify-between font-medium text-ink">Traversability <Tag k="CALC" /></div>
          {(world.real
            ? [['#f6b93b', world.real.planet === 'earth' ? 'Rough ground (3DEP slope) / slope > 15°' : 'Rough ground (HiRISE 1 m slope) / slope > 15°'], ['#fc3d21', 'Very rough ground'], ['#b07cff', 'Crater walls / delta scarp'], ['#5a0d06', `Impassable for rover (> ${world.rover.max_slope_deg}°)`]]
            : [['#f6b93b', 'Loose regolith / slope > 15°'], ['#fc3d21', 'Boulder field'], ['#b07cff', 'Crater walls'], ['#5a0d06', `Impassable for rover (> ${world.rover.max_slope_deg}°)`]]).map(([c, t]) => (
            <div key={t} className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: c }} />{t}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- top left: mission summary
export function MissionCard({ world }: { world: World }) {
  useSample(500)
  const dest = useUI((s) => s.destination)
  const exp = useUI((s) => s.expedition)
  const eva = useUI((s) => s.eva)
  const agent = useUI((s) => s.agent)
  const tod = useUI((s) => s.timeOfDay)
  const weather = useUI((s) => s.weather)
  const [open, setOpen] = useState<null | 'view' | 'sources'>(null)
  const toggle = (k: 'view' | 'sources') => setOpen((o) => (o === k ? null : k))
  const objective = eva === 'walking' ? 'EVA in progress: monitor suit oxygen and crew health'
    : exp === 'driving' ? 'Rover driving autonomously to the destination'
    : dest ? `Plan the ${agent === 'rover' ? 'rover expedition' : 'EVA'}` : 'Choose a destination on the terrain or a science site'
  return (
    <div className="glass pointer-events-auto w-[320px] shrink-0 rounded-2xl p-4">
      <div className="flex items-center gap-2.5">
        <svg viewBox="0 0 32 32" className="size-8" aria-hidden><rect width="32" height="32" rx="8" fill="#121a24" stroke="#2c3c4f" /><circle cx="16" cy="16" r="9" fill="#e2733c" /><path d="M8 19c3-2 6-1 9 0s5 1 7-1" stroke="#ffb07a" strokeWidth="1.6" fill="none" /></svg>
        <div className="min-w-0 flex-1">
          <div className="whitespace-nowrap text-[15px] font-bold tracking-tight">3D WORLD</div>
          <div className="whitespace-nowrap text-[11px] text-ink-3">{world.real?.planet === 'earth' ? 'Earth · Illinois' : world.real ? 'Jezero Crater' : 'Test terrain'}</div>
        </div>
        <div className="flex gap-1">{world.m20 && <button onClick={() => void startStory()} className="rounded-lg bg-white/10 px-2 py-1 text-[11px] font-medium hover:bg-white/15">Story</button>}{world.m20 && <button onClick={() => ui.set({ showScience: true })} className="rounded-lg bg-nasa px-2 py-1 text-[11px] font-medium text-white hover:bg-nasa-hover">Science</button>}<button onClick={() => ui.set({ showAbout: true })} className="rounded-lg bg-white/10 px-2 py-1 text-[11px] font-medium hover:bg-white/15">About</button></div>
      </div>
      <div className="mt-3 rounded-xl bg-white/5 px-3 py-2.5">
        <div className="text-[11px] text-ink-3">Objective</div>
        <div className="text-sm font-medium leading-snug">{objective}</div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button onClick={() => openTrainer()} title="Junior Astronaut Mission Trainer: five guided lessons with a score" className="flex items-center justify-center gap-1.5 rounded-lg bg-white/10 py-1.5 text-[11px] font-medium hover:bg-white/15"><GraduationCap className="size-3.5" />Trainer</button>
        <button onClick={() => void startRedHorizon(world)} title="Operation Red Horizon: a coordinated emergency with live re-planning" className="flex items-center justify-center gap-1.5 rounded-lg bg-warning/20 py-1.5 text-[11px] font-medium text-warning hover:bg-warning/30"><Siren className="size-3.5" />Red Horizon</button>
      </div>
      <AlertPill />
      <dl className="mt-3 grid grid-cols-2 items-center gap-y-1.5 text-xs">
        <dt className="text-ink-3">Mission time</dt><dd className="text-right font-mono tabular">{fmtLmst(sim.metS)} <Tag k="SIM" /></dd>
        <dt className="flex items-center gap-1 text-ink-3"><Radio className="size-3" />Earth delay</dt><dd className="text-right font-mono">{(sim.commDelayS / 60).toFixed(1)} min <Tag k="SIM" /></dd>
      </dl>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        <button onClick={() => toggle('view')} aria-expanded={open === 'view'} className={clsx('flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px]', open === 'view' ? 'bg-white/20' : 'bg-white/10 hover:bg-white/15')}><Sun className="size-3.5" />View</button>
        <button onClick={() => toggle('sources')} aria-expanded={open === 'sources'} className={clsx('flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px]', open === 'sources' ? 'bg-white/20' : 'bg-white/10 hover:bg-white/15')}><Database className="size-3.5" />Data</button>
        <button onClick={actions.resetScenario} className="flex items-center justify-center gap-1 rounded-lg bg-white/10 py-1.5 text-[11px] hover:bg-white/15"><RotateCcw className="size-3.5" />Reset</button>
      </div>
      {open === 'view' && (
        <dl className="mt-3 grid grid-cols-2 items-center gap-y-2 border-t border-line pt-3 text-xs">
          <dt className="text-ink-3">Sim speed</dt>
          <dd className="flex justify-end gap-1">{[1, 2, 4].map((k) => (
            <button key={k} onClick={() => { sim.timeScale = k }} aria-pressed={sim.timeScale === k}
              className={clsx('rounded-md px-1.5 font-mono text-[11px]', sim.timeScale === k ? 'bg-nasa text-white' : 'bg-white/10 text-ink-2 hover:bg-white/15')}>{k}×</button>
          ))}</dd>
          <dt className="flex items-center gap-1 text-ink-3">Lighting <Tag k="ILLUS" /></dt>
          <dd className="flex items-center justify-end gap-1.5">
            <input type="range" min={6} max={18} step={0.25} value={tod ?? lightingHour()} onChange={(e) => actions.setTimeOfDay(Number(e.target.value))}
              aria-label="Illustrative time of day" className="w-20 accent-[#e2733c]" />
            <span className="w-9 font-mono text-[11px]">{(tod ?? lightingHour()).toFixed(1)}h</span>
          </dd>
          <dt className="flex items-center gap-1 text-ink-3">Atmosphere <Tag k="ILLUS" /></dt>
          <dd className="flex justify-end gap-1">{(['clear', 'dust'] as const).map((w) => (
            <button key={w} onClick={() => actions.setWeather(w)} aria-pressed={weather === w}
              className={clsx('rounded-md px-1.5 text-[11px]', weather === w ? 'bg-nasa text-white' : 'bg-white/10 text-ink-2 hover:bg-white/15')}>{w === 'clear' ? 'Clear' : 'Dust storm'}</button>
          ))}</dd>
        </dl>
      )}
      {open === 'sources' && (
        <div className="mt-3 space-y-2 border-t border-line pt-3 text-[11px] leading-snug text-ink-2">
          <RegionSwitch world={world} />
          {world.real?.planet === 'earth' ? (<>
            <div><Tag k="NASA" /> <span className="font-medium text-ink">Earth analog:</span> Garden of the Gods, Shawnee National Forest, Illinois. Terrain from USGS 3DEP (10 m). NASA's NASADEM, measured from orbit by the Space Shuttle's radar, reads a median {world.real.region.nasadem_minus_3dep_median_m?.toFixed(1)} m higher: its C-band radar partly reflects off the forest canopy, a known effect over dense trees.</div>
            <div><Tag k="REAL" /> <span className="font-medium text-ink">Imagery:</span> a real aerial photograph of the site, taken on 18 August 2023 for the USDA National Agriculture Imagery Program (NAIP), natural colour, shown at 0.5 m per pixel. Colours are as photographed.</div>
            <div><Tag k="ILLUS" /> <span className="font-medium text-ink">Trees:</span> illustrative shapes, stood up wherever the photograph shows tree canopy and coloured from the photograph at that spot. Vehicles pass through them.</div>
            <div><Tag k="CALC" /> <span className="font-medium text-ink">Slope, traversability, routes:</span> the same planner as on Mars, on Earth terrain.</div>
            <AnalogCompare />
            <div><Tag k="SIM" /> <span className="font-medium text-ink">Field camp, helicopter LZ, suit and rover:</span> simulated, as in NASA analog field tests that simulate EVA consumables.</div>
            <ul className="space-y-1 border-t border-line pt-2">{world.real.sources.map((s) => <li key={s.id}><span className="text-ink">{s.instrument}</span> · {s.mission}. <a href={s.doi} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">source</a></li>)}</ul>
          </>) : world.real ? (<>
            <div><Tag k="NASA" /> <span className="font-medium text-ink">Terrain:</span> Jezero Crater, {(world.real.region.size_m / 1000).toFixed(0)} × {(world.real.region.size_m / 1000).toFixed(0)} km around the Perseverance landing site. HiRISE 1 m elevation model averaged to {world.cell.toFixed(0)} m; elevation {world.real.region.elevation_min_m.toFixed(0)} to {world.real.region.elevation_max_m.toFixed(0)} m. Cross-checked against CTX: median difference {world.real.region.hirise_minus_ctx_median_m?.toFixed(2)} m.</div>
            <div><Tag k="NASA" /> <span className="font-medium text-ink">Ground imagery:</span> HiRISE orthoimage (25 cm/px, shown at ~0.5 m). Grayscale, colour-mapped for display.</div>
            {world.real.surround && <div><Tag k="NASA" /> <span className="font-medium text-ink">Horizon:</span> 80 km of real terrain around the map, from the Mars 2020 Science Investigation CTX elevation and image mosaics (MRO): Jezero's delta and crater rim, with Mars' curvature applied. Beyond the mosaic edge the ground is smoothly filled and shown in a flat tone.</div>}
            {world.real.themis && <div><Tag k="NASA" /> <span className="font-medium text-ink">Thermal IR layer:</span> THEMIS daytime infrared, Mars Odyssey.</div>}
            {world.m20 && <div><Tag k="NASA" /> <span className="font-medium text-ink">Perseverance &amp; Ingenuity:</span> the rover's real drives (sols {world.m20.summary.sols?.join('–')}, {(world.m20.summary.drive_m / 1000).toFixed(1)} km here) and the helicopter's real flights, from NASA/JPL Mars 2020 localization. Rover elevations match the HiRISE terrain to {Math.abs((world.m20.summary.dtm_minus_rover_elev_median_m ?? 0) * 100).toFixed(0)} cm (median).</div>}
            <div><Tag k="CALC" /> <span className="font-medium text-ink">Slope, roughness, traversability, routes:</span> computed from the NASA elevation data.</div>
            <div><Tag k="SIM" /> <span className="font-medium text-ink">Habitat, landing pad, rover, suit, crew health:</span> simulation. Rocks are illustrative, placed where the data says the ground is rough.</div>
            <div><Tag k="ILLUS" /> <span className="font-medium text-ink">Fine surface grain, horizon, title image:</span> AI-generated (Higgsfield).</div>
            <ul className="space-y-1 border-t border-line pt-2">
              {world.real.sources.map((s) => (
                <li key={s.id}><span className="text-ink">{s.instrument}</span> · {s.mission}. <a href={s.doi} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">{s.doi.replace('https://doi.org/', 'doi:')}</a></li>
              ))}
            </ul>
            <div className="text-ink-3">Data: USGS Astrogeology Science Center / NASA PDS, retrieved {world.real.retrieved}. Not affiliated with or endorsed by NASA.</div>
          </>) : (<>
            <div><Tag k="SIM" /> <span className="font-medium text-ink">Terrain:</span> procedural, seed {world.provenance.seed}, {world.provenance.resolution_m.toFixed(1)} m grid. <span className="text-caution">Not a real location.</span></div>
            <div><Tag k="CALC" /> <span className="font-medium text-ink">Slope, traversability, routes:</span> computed from the terrain heights.</div>
            <div><Tag k="SIM" /> <span className="font-medium text-ink">Rover, suit, crew health:</span> documented simulation models.</div>
            <div><Tag k="ILLUS" /> <span className="font-medium text-ink">Textures, horizon, title image:</span> AI-generated (Higgsfield), artistic only.</div>
          </>)}
        </div>
      )}
    </div>
  )
}

function M20Toggle({ world }: { world: World }) {
  const on = useUI((s) => s.showM20)
  const m = world.m20!
  return (
    <div className="glass w-64 rounded-xl px-3 py-2 text-[11px] text-ink-2">
      <div className="flex items-center justify-between gap-2">
        <button onClick={actions.toggleM20} aria-pressed={on} title="Toggle Perseverance & Ingenuity (M)"
          className={clsx('rounded-md px-2 py-0.5 text-[11px] font-medium', on ? 'bg-nasa text-white' : 'bg-white/10 text-ink-2 hover:bg-white/15')}>
          {on ? 'Hide' : 'Show'} real mission paths
        </button>
        <Tag k="NASA" />
      </div>
      {on && (
        <div className="mt-1.5 space-y-1">
          <div className="flex items-center gap-2"><span className="h-0.5 w-5 bg-[#f4f4f4]" />Perseverance drives · sols {m.summary.sols?.join('–')}</div>
          <div className="flex items-center gap-2"><span className="h-0 w-5 border-t-2 border-dashed border-[#f6b93b]" />Ingenuity flights {m.summary.flights[0]}–{m.summary.flights[m.summary.flights.length - 1]} (in this area)</div>
        </div>
      )}
    </div>
  )
}

type AnalogM = { relief_m: number; slope_p50_deg: number; slope_p90_deg: number; share_over_20_deg: number }
/** Mars site vs Earth analog, same metrics side by side (GET /api/analog). No single similarity score, on purpose. */
function AnalogCompare() {
  const [d, setD] = useState<{ mars: AnalogM; earth: AnalogM; summary: string } | null>(null)
  useEffect(() => { fetch('/api/analog').then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => {}) }, [])
  if (!d) return null
  const rows: [string, (m: AnalogM) => string][] = [
    ['Relief', (m) => `${m.relief_m.toFixed(0)} m`],
    ['Median slope', (m) => `${m.slope_p50_deg}°`],
    ['90th pct slope', (m) => `${m.slope_p90_deg}°`],
    ['Ground > 20°', (m) => `${(m.share_over_20_deg * 100).toFixed(1)}%`],
  ]
  return (
    <div className="rounded-lg bg-white/5 p-2">
      <div className="mb-1 flex items-center justify-between font-medium text-ink">Analog vs Jezero <Tag k="CALC" /></div>
      <table className="w-full font-mono text-[10.5px]"><thead className="text-ink-3"><tr><th className="text-left font-normal" /><th className="text-right font-normal">Jezero</th><th className="text-right font-normal">Shawnee</th></tr></thead>
        <tbody>{rows.map(([k, f]) => <tr key={k}><td className="text-ink-3">{k}</td><td className="text-right">{f(d.mars)}</td><td className="text-right">{f(d.earth)}</td></tr>)}</tbody></table>
      <p className="mt-1 leading-snug text-ink-3">{d.summary}</p>
    </div>
  )
}

function RegionSwitch({ world }: { world: World }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-3">Map</span>
      <div className="flex flex-wrap justify-end gap-1">{([['jezero', 'Jezero (Mars)'], ['shawnee', 'Shawnee (Earth)'], ['procedural', 'Procedural']] as const).map(([id, label]) => (
        <button key={id} onClick={() => id !== world.region && switchRegion(id)} aria-pressed={world.region === id}
          className={clsx('rounded-md px-1.5 py-0.5 text-[11px]', world.region === id ? 'bg-nasa text-white' : 'bg-white/10 text-ink-2 hover:bg-white/15')}>{label}</button>
      ))}</div>
    </div>
  )
}

// ---------------------------------------------------------------- bottom left: telemetry
function Row({ icon, label, value, k = 'SIM', tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; k?: Kind | null; tone?: 'ok' | 'caution' | 'warning' }) {
  return (
    <div className="flex items-center gap-2 text-xs [&_svg]:size-3.5">
      <span className="text-ink-3">{icon}</span>
      <span className="text-ink-3">{label}</span>
      <span className={clsx('ml-auto font-mono tabular', tone === 'caution' ? 'text-caution' : tone === 'warning' ? 'text-warning' : 'text-ink')}>{value}</span>
      {k && <Tag k={k} />}
    </div>
  )
}

function Bar({ label, icon, pct, text, k = 'SIM' }: { label: string; icon: React.ReactNode; pct: number; text: string; k?: Kind }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5 text-ink-3 [&_svg]:size-3.5">{icon}{label}</span><span className="font-mono">{text} <Tag k={k} /></span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full transition-[width]" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: pct < 25 ? '#fc3d21' : pct < 50 ? '#f6b93b' : '#3fd18f' }} /></div>
    </div>
  )
}

export function Telemetry({ world }: { world: World }) {
  useSample(100)
  const agent = useUI((s) => s.agent)
  const eva = useUI((s) => s.eva)
  const [tab, setTab] = useState<'rover' | 'astronaut' | 'habitat'>(agent)
  const [seenAgent, setSeenAgent] = useState(agent)
  if (agent !== seenAgent) { setSeenAgent(agent); setTab(agent) }
  const r = sim.rover
  const a = sim.astro
  const p = world.rover
  const ap = world.astronaut
  const compass = ((((r.heading * 180) / Math.PI) + 90) % 360 + 360) % 360
  const dir = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(compass / 45) % 8]
  const difficulty = r.slopeDeg > 18 || r.hazard ? 'High' : r.slopeDeg > 9 ? 'Moderate' : 'Low'
  const o2pct = (100 * a.o2G) / ap.suit_o2_g
  const hrTone = a.heartRate > 140 ? 'warning' : a.heartRate > 120 ? 'caution' : 'ok'
  return (
    <div className="glass pointer-events-auto w-[320px] shrink-0 rounded-2xl p-4">
      <div className="mb-3 flex items-center gap-1 rounded-xl bg-white/5 p-1" role="tablist">
        {(['rover', 'astronaut', 'habitat'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={clsx('flex-1 rounded-lg py-1.5 text-xs font-medium', tab === t ? 'bg-white/15 text-ink' : 'text-ink-3 hover:text-ink')}>
            {t === 'rover' ? 'Rover' : t === 'astronaut' ? 'Crew health' : 'Habitat'}
          </button>
        ))}
      </div>
      {tab === 'habitat' ? <HabitatPower /> : tab === 'rover' ? (
        <>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Rover R-1</span>
            <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold', r.blocked ? 'bg-warning/20 text-warning' : r.mode === 'auto' ? 'bg-nasa text-white' : 'bg-white/10 text-ink-2')}>
              {r.blocked ? 'Blocked' : r.mode === 'auto' ? 'Autonomous' : 'Manual'}
            </span>
          </div>
          <div className="mb-2.5"><Bar label="Battery" icon={<Battery />} pct={(100 * r.batteryWh) / p.battery_wh} text={`${r.batteryWh.toFixed(0)} Wh`} /></div>
          <div className="space-y-1.5">
            <Row icon={<Gauge />} label="Speed" value={`${Math.abs(r.speed).toFixed(2)} m/s`} />
            <Row icon={<Navigation />} label="Est. range" value={`${(r.batteryWh / p.flat_wh_per_m / 1000).toFixed(1)} km flat`} k="CALC" />
            <Row icon={<Compass />} label="Heading" value={`${compass.toFixed(0)}° ${dir}`} k={null} />
            <Row icon={<Crosshair />} label="Position" value={`${r.x.toFixed(0)} E, ${(-r.z).toFixed(0)} N · ${r.y.toFixed(1)} m`} k="CALC" />
            <Row icon={<Mountain />} label="Slope under rover" value={`${r.slopeDeg.toFixed(1)}°`} tone={r.slopeDeg > 18 ? 'warning' : r.slopeDeg > 12 ? 'caution' : 'ok'} k="CALC" />
            <Row icon={<AlertTriangle />} label="Terrain difficulty" value={r.hazard ? `${difficulty} · ${r.hazard}` : difficulty} tone={difficulty === 'High' ? 'caution' : 'ok'} k="CALC" />
            <Row icon={<RouteIcon />} label="Odometer" value={`${r.odometer.toFixed(0)} m · ${r.energyUsedWh.toFixed(0)} Wh`} />
            <Row icon={<Gauge />} label="Render" value={`${sim.fps.toFixed(0)} fps`} k={null} />
          </div>
          {r.blocked && <div className="mt-2 rounded-lg bg-warning/15 px-2.5 py-1.5 text-xs text-warning">{r.blocked}</div>}
        </>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">EVA-1 (synthetic crew data)</span>
            <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold', eva === 'walking' ? 'bg-nasa text-white' : 'bg-white/10 text-ink-2')}>{a.state === 'walking' ? 'Walking' : 'Idle'}</span>
          </div>
          <div className="mb-2 space-y-2">
            <Bar label="Suit O₂" icon={<Wind />} pct={o2pct} text={`${a.o2G.toFixed(0)} g · ${suitO2Minutes().toFixed(0)} min`} />
            <Bar label="Suit power" icon={<Battery />} pct={(100 * a.suitWh) / ap.suit_power_wh} text={`${a.suitWh.toFixed(0)} Wh`} />
          </div>
          <div className="space-y-1.5">
            <Row icon={<Timer />} label="EVA duration" value={fmtDur(a.evaS)} />
            <Row icon={<HeartPulse />} label="Heart rate" value={`${a.heartRate.toFixed(0)} bpm`} tone={hrTone} />
            <Row icon={<HeartPulse />} label="SpO₂" value={`${a.spo2.toFixed(1)} %`} />
            <Row icon={<Gauge />} label="Metabolic rate" value={`${a.metabolicW.toFixed(0)} W`} />
            <Row icon={<Footprints />} label="Fatigue" value={`${a.fatigue.toFixed(0)} / 100`} tone={a.fatigue > 70 ? 'caution' : 'ok'} />
            <Row icon={<Droplets />} label="Hydration" value={`${a.hydration.toFixed(0)} %`} tone={a.hydration < 70 ? 'caution' : 'ok'} />
            <Row icon={<Thermometer />} label="Body temp" value={`${a.bodyTemp.toFixed(1)} °C`} />
          </div>
          <HealthTrends world={world} />
          <button onClick={() => void actions.returnToHabitat()} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/10 py-1.5 text-xs hover:bg-white/15"><Home className="size-3.5" />Return to habitat</button>
          <p className="mt-2 text-[10.5px] leading-snug text-ink-3">Synthetic physiology from a metabolic model. Not a medical device; it does not diagnose or treat.</p>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- bottom right: planner
export function RoutePanel({ world }: { world: World }) {
  useSample(200)
  const dest = useUI((s) => s.destination)
  const agent = useUI((s) => s.agent)
  const route = useUI((s) => (s.agent === 'rover' ? s.route : s.evaRoute))
  const mode = useUI((s) => s.routeMode)
  const planning = useUI((s) => s.planning)
  const err = useUI((s) => s.routeError)
  const exp = useUI((s) => s.expedition)
  const eva = useUI((s) => s.eva)
  const site = dest && world.sites.find((s) => Math.hypot(s.x - dest[0], s.z - dest[1]) < 1)
  const active = agent === 'rover' ? exp === 'driving' : eva === 'walking'
  const done = agent === 'rover' ? exp === 'arrived' : eva === 'arrived'
  let remaining = 0
  if (route && active) {
    const idx = agent === 'rover' ? sim.routeIndex : sim.astro.pathIndex
    for (let k = idx; k < route.path.length - 1; k++) remaining += Math.hypot(route.path[k + 1][0] - route.path[k][0], route.path[k + 1][2] - route.path[k][2])
  }
  const progress = route ? (done ? 1 : active ? 1 - remaining / route.distance_m : 0) : 0
  const feas = route && agent === 'astronaut' ? evaFeasibility(route) : null
  const rfeas = route && agent === 'rover' && !active && !done ? roverFeasibility(route) : null
  return (
    <div className="glass pointer-events-auto w-[370px] shrink-0 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Expedition planner</span>
        <span className="text-[11px] text-ink-3">A* · slope, rocks, hazards</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1" role="group" aria-label="Agent">
        {(['rover', 'astronaut'] as const).map((g) => (
          <button key={g} onClick={() => actions.setAgent(g)} aria-pressed={agent === g}
            className={clsx('flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium', agent === g ? 'bg-nasa text-white' : 'text-ink-3 hover:text-ink')}>
            {g === 'rover' ? <><Camera className="size-3.5" />Rover</> : <><Footprints className="size-3.5" />Astronaut EVA</>}
          </button>
        ))}
      </div>
      <div className="mt-2 rounded-xl bg-white/5 px-3 py-2 text-xs">
        <span className="text-ink-3">Destination </span>
        {dest ? <span className="font-medium">{site ? site.name : `${dest[0].toFixed(0)} E, ${(-dest[1]).toFixed(0)} N`}</span> : <span className="text-ink-3">click the terrain or a site</span>}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1" role="group" aria-label="Route preference">
        {(['fast', 'balanced', 'safe'] as const).map((m) => (
          <button key={m} onClick={() => actions.setRouteMode(m)} aria-pressed={mode === m}
            className={clsx('rounded-lg py-1.5 text-xs font-medium', mode === m ? 'bg-white/15 text-ink' : 'text-ink-3 hover:text-ink')}>
            {m === 'safe' ? 'Lowest risk' : m === 'fast' ? 'Shortest' : 'Balanced'}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <button onClick={() => void actions.planRoute()} disabled={!dest || planning}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-nasa py-2 text-sm font-semibold text-white hover:bg-nasa-hover disabled:opacity-40">
          <Radar className="size-4" />{planning ? 'Planning…' : 'Plan Expedition'}
        </button>
        {active
          ? <button onClick={() => (agent === 'rover' ? actions.stopExpedition('stopped by operator') : actions.stopEva())} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-warning py-2 text-sm font-semibold text-white"><Square className="size-4" />Stop</button>
          : <button onClick={agent === 'rover' ? actions.beginExpedition : actions.startEva} disabled={!route || (feas !== null && !feas.feasible) || (rfeas !== null && !rfeas.feasible)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white py-2 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-40">
              <Play className="size-4" />{agent === 'rover' ? 'Deploy Rover' : 'Start EVA'}
            </button>}
      </div>
      {err && <div className="mt-2 rounded-lg bg-warning/15 px-2.5 py-1.5 text-xs text-warning">No route for the {agent}: {err}</div>}
      {route && (
        <div className="mt-3 space-y-2">
          {(active || done) && (
            <div>
              <div className="flex justify-between text-[11px] text-ink-3"><span>Progress</span><span className="font-mono">{done ? 'arrived' : `${remaining.toFixed(0)} m to go`}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} /></div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-1.5 text-center">
            {[
              ['Distance', `${route.distance_m.toFixed(0)} m`],
              ['Travel time', fmtDur(route.travel_time_s)],
              agent === 'rover' ? ['Energy', `${route.energy_wh.toFixed(0)} Wh`] : ['O₂ one way', `${(route.o2_g ?? 0).toFixed(1)} g`],
              ['Elev. gain', `${route.elevation_gain_m.toFixed(0)} m`],
              ['Max slope', `${route.max_slope_deg.toFixed(1)}°`],
              ['Hazards', String(route.hazard_segments.length)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-white/5 py-1.5"><div className="text-[10px] text-ink-3">{k}</div><div className="font-mono text-[13px]">{v}</div></div>
            ))}
          </div>
          {feas && (
            <div className={clsx('rounded-lg px-2.5 py-1.5 text-[11px]', feas.feasible ? 'bg-nominal/10 text-nominal' : 'bg-warning/15 text-warning')}>
              {feas.feasible ? 'Feasible' : 'Not feasible'}: needs {feas.needed.toFixed(0)} g O₂ (out + back + {Math.round(world.astronaut.reserve_fraction * 100)}% reserve), suit has {feas.available.toFixed(0)} g <Tag k="CALC" />
            </div>
          )}
          {rfeas && (
            <div className={clsx('rounded-lg px-2.5 py-1.5 text-[11px]', rfeas.feasible ? 'bg-nominal/10 text-nominal' : 'bg-warning/15 text-warning')}>
              {rfeas.feasible ? 'Feasible' : 'Not feasible'}: needs {rfeas.needed.toFixed(0)} Wh (out + back + {Math.round(ROVER_RESERVE * 100)}% reserve), battery has {rfeas.available.toFixed(0)} Wh{!rfeas.feasible && '. Park at the dock to charge'} <Tag k="CALC" />
            </div>
          )}
          {route.hazard_segments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {[...new Set(route.hazard_segments.map((s) => s.label))].map((l) => <span key={l} className="rounded-md bg-caution/15 px-1.5 py-0.5 text-[10.5px] text-caution">⚠ {l}</span>)}
            </div>
          )}
          <details className="text-xs text-ink-2">
            <summary className="cursor-pointer text-ink-3">Why this route · model limits</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">{route.explanation.map((e) => <li key={e}>{e}</li>)}</ul>
            <p className="mt-1.5 text-[11px] text-ink-3">Confidence: planned on {world.real ? 'NASA HiRISE terrain' : 'procedural terrain'} at {world.cell.toFixed(1)} m resolution with simplified energy and metabolic models. Not certified rover or EVA performance.</p>
          </details>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- inspector
export function InspectPanel({ world }: { world: World }) {
  useSample(500)
  const sel = useUI((s) => s.selected)
  if (!sel || (sel.kind !== 'site' && sel.kind !== 'module')) return null
  const close = <button onClick={() => ui.set({ selected: null })} aria-label="Close" className="text-ink-3 hover:text-ink"><X className="size-4" /></button>
  if (sel.kind === 'module') {
    const m = HAB_MODULES.find((k) => k.id === sel.id)!
    return (
      <div className="glass pointer-events-auto w-[370px] shrink-0 rounded-2xl p-4">
        <div className="flex items-start justify-between gap-2">
          <div><div className="text-[11px] text-accent">Habitat module</div><div className="text-base font-semibold">{m.label}</div></div>{close}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{m.detail}</p>
        <ModuleStatus id={m.id} />
      </div>
    )
  }
  const site = world.sites.find((s) => s.id === sel.id)
  if (!site) return null
  const d = Math.hypot(site.x - sim.rover.x, site.z - sim.rover.z)
  const da = Math.hypot(site.x - sim.astro.x, site.z - sim.astro.z)
  return (
    <div className="glass pointer-events-auto w-[370px] shrink-0 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div><div className="text-[11px] text-accent">{site.kind === 'historic' ? 'Mission landmark' : 'Science site'}</div><div className="text-base font-semibold">{site.name}</div></div>{close}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{site.description}</p>
      <dl className="mt-2 grid grid-cols-2 gap-y-1 text-xs">
        <dt className="text-ink-3">Location</dt><dd className="text-right font-mono">{site.x.toFixed(0)} E, {(-site.z).toFixed(0)} N</dd>
        <dt className="text-ink-3">Elevation</dt><dd className="text-right font-mono">{(world.heightAt(site.x, site.z) + world.datum).toFixed(1)} m{world.real && <> <Tag k="NASA" /></>}</dd>
        <dt className="text-ink-3">From rover / astronaut</dt><dd className="text-right font-mono">{d.toFixed(0)} m / {da.toFixed(0)} m</dd>
      </dl>
      {world.real
        ? <p className="mt-2 rounded-lg bg-white/5 px-2 py-1 text-[11px] text-ink-2">{site.simulated ? <>Simulated site <Tag k="SIM" /></> : <>Real location on {world.real.planet === 'earth' ? 'Earth' : 'Mars'} <Tag k="NASA" />. Terrain and imagery here are {world.real.planet === 'earth' ? 'public survey and satellite' : 'NASA'} data.</>}</p>
        : <p className="mt-2 rounded-lg bg-caution/10 px-2 py-1 text-[11px] text-caution">Procedural placeholder site <Tag k="SIM" />. Switch the map to Jezero for real NASA terrain.</p>}
      <button onClick={() => { actions.setDestination(site.x, site.z); void actions.planRoute() }}
        className="mt-3 w-full rounded-xl bg-nasa py-2 text-sm font-semibold text-white hover:bg-nasa-hover">Set as destination & plan</button>
    </div>
  )
}

export function Toasts() {
  const msgs = useUI((s) => s.messages)
  return (
    <div className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 flex-col items-center gap-2">
      {msgs.map((m) => (
        <div key={m.id} className={clsx('glass max-w-[520px] rounded-xl px-4 py-2 text-center text-sm', m.level === 'warning' ? 'text-warning' : m.level === 'caution' ? 'text-caution' : 'text-ink')}>{m.text}</div>
      ))}
    </div>
  )
}

export function ControlsOverlay() {
  const show = useUI((s) => s.showHelp)
  if (!show) return null
  const rows: [string, string][] = [
    ['W A S D / Arrows', 'Drive the rover (arrows only in Free camera) · Space brakes'],
    ['1 2 3 4 5 · C', 'Free · Astronaut · Rover · Top-down · Inspect · cycle'],
    ['Click terrain / site', 'Set destination'],
    ['Click habitat / astronaut', 'Inspect module or crew member'],
    ['P · G · Esc', 'Plan · Deploy rover (or start EVA) · Stop'],
    ['L · X', 'Cycle map layer · Mast scan'],
    ['R · H · F', 'Reset camera · Toggle this help · Presentation mode'],
    ['Free camera', 'Click to capture mouse, WASD + Q/E, Shift = fast, Esc = release'],
  ]
  return (
    <div className="glass pointer-events-auto absolute left-1/2 top-1/2 w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-base font-semibold"><Bot className="size-4 text-accent" />Expedition Command controls</div>
        <button onClick={actions.toggleHelp} className="rounded-lg bg-white/10 px-2.5 py-1 text-xs hover:bg-white/15">Got it (H)</button>
      </div>
      <dl className="space-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3"><dt className="w-44 shrink-0 font-mono text-xs text-accent">{k}</dt><dd className="text-ink-2">{v}</dd></div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-ink-3">
        <span><Tag k="NASA" /> NASA-derived</span><span><Tag k="CALC" /> Calculated</span><span><Tag k="SIM" /> Simulated</span><span><Tag k="ILLUS" /> Illustrative</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- habitat power
const kw = (w: number) => `${(w / 1000).toFixed(1)} kW`

function ModuleStatus({ id }: { id: string }) {
  const rows = ({
    solar: [['Output', kw(hab.solarW), 'SIM'], ['Peak (clear noon)', kw(HAB.arrayPeakW), 'SIM'], ['Sky', ui.get().weather === 'dust' ? `dust storm, ${HAB.transmission.dust * 100}% light` : `clear, ${HAB.transmission.clear * 100}% light`, 'ILLUS']],
    power: [['Bank', `${(hab.batteryWh / 1000).toFixed(1)} / ${(HAB.batteryWh / 1000).toFixed(0)} kWh`, 'SIM'], ['Net', kw(hab.solarW - hab.loadW), 'CALC']],
    lifesupport: [['Life support load', kw(HAB.loads.lifesupport), 'SIM'], ['O₂ production (ISRU)', hab.shed ? 'shed to save power' : kw(HAB.loads.isru), 'SIM']],
    dock: [['Rover', hab.roverCharging ? `charging at ${kw(HAB.roverChargeW)}` : 'not docked', 'SIM'], ['Rover battery', `${sim.rover.batteryWh.toFixed(0)} Wh`, 'SIM']],
    quarters: [['Load', kw(HAB.loads.quarters), 'SIM']],
    water: [['Load', 'on the life-support circuit', 'SIM']],
  } as Record<string, [string, string, Kind][]>)[id] ?? []
  return (
    <dl className="mt-2 space-y-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs">
      <div className="flex justify-between"><dt className="text-ink-3">Status</dt><dd className={hab.shed ? 'text-caution' : 'text-nominal'}>{hab.shed ? 'Power saving' : 'Nominal'} <Tag k="SIM" /></dd></div>
      {rows.map(([k, v, t]) => <div key={k} className="flex justify-between gap-3"><dt className="text-ink-3">{k}</dt><dd className="font-mono">{v} <Tag k={t} /></dd></div>)}
    </dl>
  )
}

function HabitatPower() {
  const auto = habitatAutonomyH()
  const net = hab.solarW - hab.loadW
  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Habitat power</span>
        <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold', hab.shed ? 'bg-caution/20 text-caution' : net >= 0 ? 'bg-nominal/20 text-nominal' : 'bg-white/10 text-ink-2')}>{hab.shed ? 'Shedding load' : net >= 0 ? 'Charging' : 'On battery'}</span>
      </div>
      <div className="mb-2.5"><Bar label="Battery bank" icon={<Battery />} pct={(100 * hab.batteryWh) / HAB.batteryWh} text={`${(hab.batteryWh / 1000).toFixed(1)} kWh`} /></div>
      <div className="space-y-1.5">
        <Row icon={<Sun />} label="Solar array" value={kw(hab.solarW)} />
        <Row icon={<Zap />} label="Load" value={kw(hab.loadW)} />
        <Row icon={<Gauge />} label="Net" value={`${net >= 0 ? '+' : ''}${kw(net)}`} tone={net < 0 ? 'caution' : 'ok'} k="CALC" />
        <Row icon={<Timer />} label="To reserve" value={auto === null ? 'charging' : `${auto.toFixed(1)} h`} tone={auto !== null && auto < 4 ? 'warning' : 'ok'} k="CALC" />
        <Row icon={<Factory />} label="O₂ production" value={hab.shed ? 'shed' : 'running'} tone={hab.shed ? 'caution' : 'ok'} />
        <Row icon={<BatteryCharging />} label="Rover dock" value={hab.roverCharging ? 'charging rover' : 'idle'} />
      </div>
      <p className="mt-2 text-[10.5px] leading-snug text-ink-3">Solar follows the sun on the mission clock (or the lighting slider) and drops in a dust storm. Below {(HAB.reserveWh / 1000).toFixed(0)} kWh the base sheds oxygen production first. Simulated planning values, not a real system design.</p>
    </>
  )
}

// ---------------------------------------------------------------- crew health trends and alerts
function Spark({ data, limit, color }: { data: number[]; limit?: number; color: string }) {
  const W = 110, H = 22
  if (data.length < 2) return <span className="w-[110px] text-right text-[10px] text-ink-3">collecting…</span>
  const vals = limit === undefined ? data : [...data, limit]
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1
  const y = (v: number) => H - 2 - ((v - lo) / span) * (H - 4)
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg width={W} height={H} className="shrink-0" aria-hidden="true">
      {limit !== undefined && <line x1={0} x2={W} y1={y(limit)} y2={y(limit)} stroke="#fc3d21" strokeOpacity={0.6} strokeDasharray="3 3" />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}

const TRENDS: { vital: Vital; label: string; limit: keyof Limits; unit: string }[] = [
  { vital: 'heartRate', label: 'Heart rate', limit: 'heartRateHigh', unit: 'bpm' },
  { vital: 'o2Min', label: 'Suit O₂ left', limit: 'o2MinLow', unit: 'min' },
  { vital: 'fatigue', label: 'Fatigue', limit: 'fatigueHigh', unit: '' },
  { vital: 'hydration', label: 'Hydration', limit: 'hydrationLow', unit: '%' },
]
const LIMIT_LABELS: [keyof Limits, string][] = [['heartRateHigh', 'Heart rate above (bpm)'], ['spo2Low', 'SpO₂ below (%)'], ['o2MinLow', 'Suit O₂ below (min)'], ['fatigueHigh', 'Fatigue above'], ['hydrationLow', 'Hydration below (%)'], ['bodyTempHigh', 'Body temp above (°C)']]

function HealthTrends({ world }: { world: World }) {
  const limits = useUI((s) => s.alertLimits)
  const alerts = useUI((s) => s.alerts)
  const b = sim.astro.evaS > 0 ? returnBudget(world) : null
  return (
    <div className="mt-3 space-y-2 border-t border-line pt-2.5">
      {b && (
        <div className={clsx('rounded-lg px-2.5 py-1.5 text-[11px]', b.margin < 0 ? 'bg-warning/15 text-warning' : b.margin < 40 ? 'bg-caution/15 text-caution' : 'bg-nominal/10 text-nominal')}>
          {b.margin < 0 ? 'Walking home is not safe' : 'Can walk home'}: ~{b.dist.toFixed(0)} m at the current pace needs {b.needed.toFixed(0)} g O₂ with reserve, suit has {b.available.toFixed(0)} g <Tag k="CALC" />
        </div>
      )}
      <div className="text-[11px] text-ink-3">Trends, last 20 min · red line = alert limit</div>
      {TRENDS.map((t) => {
        const d = history[t.vital]
        return (
          <div key={t.vital} className="flex items-center gap-2 text-xs">
            <span className="w-24 text-ink-3">{t.label}</span>
            <Spark data={d} limit={limits[t.limit]} color="#7fd4ff" />
            <span className="ml-auto font-mono tabular">{d.length ? d[d.length - 1].toFixed(0) : '–'} {t.unit}</span>
          </div>
        )
      })}
      <details className="text-xs">
        <summary className="flex cursor-pointer items-center gap-1.5 text-ink-3"><Bell className="size-3.5" />Alerts ({alerts.length}) · limits</summary>
        <ul className="mt-1.5 max-h-28 space-y-1 overflow-y-auto">
          {alerts.length === 0 && <li className="text-ink-3">No alerts yet.</li>}
          {[...alerts].reverse().map((al) => <li key={al.id} className={al.level === 'warning' ? 'text-warning' : 'text-caution'}><span className="font-mono text-ink-3">{fmtLmst(al.metS).split(' · ')[1]}</span> {al.text}</li>)}
        </ul>
        <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1">
          {LIMIT_LABELS.map(([k, label]) => (
            <label key={k} className="contents"><span className="text-ink-3">{label}</span>
              <input type="number" value={limits[k]} step={k === 'bodyTempHigh' ? 0.1 : 1} onChange={(e) => ui.set((s) => ({ alertLimits: { ...s.alertLimits, [k]: Number(e.target.value) } }))}
                className="w-16 rounded bg-white/10 px-1.5 py-0.5 text-right font-mono" /></label>
          ))}
        </div>
      </details>
    </div>
  )
}

/** Shown on the mission card whenever any crew alert is active, so it is visible whatever tab is open. */
function AlertPill() {
  useSample(500)
  const alerts = useUI((s) => s.alerts)
  const n = activeAlerts()
  if (!n || !alerts.length) return null
  const last = alerts[alerts.length - 1]
  return (
    <button onClick={() => ui.set({ agent: 'astronaut' })} className={clsx('mt-2 flex w-full items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-[11px]', last.level === 'warning' ? 'bg-warning/15 text-warning' : 'bg-caution/15 text-caution')}>
      <Bell className="mt-0.5 size-3.5 shrink-0" /><span><b>{n} crew alert{n > 1 ? 's' : ''}</b> · {last.text}</span>
    </button>
  )
}
