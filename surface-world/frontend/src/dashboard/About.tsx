import { Database, Footprints, Map, Route, ShieldCheck, X } from 'lucide-react'
import { ui, useUI } from '@/state/store'

/** In-app mission brief for judges and first-time users: what this is, why, and how it maps to the challenges. */
export function About() {
  const show = useUI((s) => s.showAbout)
  if (!show) return null
  const close = () => ui.set({ showAbout: false })
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-6" onClick={close}>
      <div className="glass max-h-full w-full max-w-3xl overflow-y-auto rounded-2xl p-7" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="About the 3D world">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-[#ffb07a]">Mission brief</div>
            <h2 className="mt-1 text-3xl font-bold tracking-tight">Beyond Earth Labs: the 3D world</h2>
          </div>
          <button onClick={close} aria-label="Close" className="rounded-lg p-1 text-ink-3 hover:bg-white/10 hover:text-ink"><X className="size-5" /></button>
        </div>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
          A 3D mission-planning map for the first crewed Marswalks. Commanders explore the terrain, plan routes for a rover and an
          astronaut, and see in real time whether the plan is safe: slope, hazards, rover energy and suit oxygen are calculated from the
          map itself, not guessed.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
          This world shows the mission planned in the main map: the same route, targets and 1 m steepness check are drawn here, and
          the rover drives the mission's first leg on 5 m terrain.
        </p>

        <h3 className="mt-6 text-sm font-semibold uppercase tracking-wider text-ink-3">Why it matters</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          On Mars, Earth is 4–24 minutes away by radio. Crews must decide on site whether a walk is worth the risk. A good map does
          more than show the ground: it answers "can we get there, and back, with what we carry?"
        </p>

        <h3 className="mt-6 text-sm font-semibold uppercase tracking-wider text-ink-3">How it works</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {[
            [<Map key="m" />, 'Layered 3D map', 'Real HiRISE imagery and elevation, with slope, traversability and THEMIS thermal layers on the same terrain.'],
            [<Route key="r" />, 'Terrain-aware routes', 'A* over slope and 1 m-scale roughness measured from the NASA elevation model; three risk modes with a plain-language explanation.'],
            [<Footprints key="f" />, 'Marswalk feasibility', 'Suit oxygen from a metabolic model. An EVA is refused unless oxygen covers out, back and a 25% reserve.'],
            [<ShieldCheck key="s" />, 'Honest numbers', 'Every value is tagged NASA-derived, Calculated, Simulated or Illustrative.'],
          ].map(([icon, title, body]) => (
            <div key={title as string} className="rounded-xl bg-white/5 p-4">
              <div className="flex items-center gap-2 font-semibold [&_svg]:size-4 [&_svg]:text-accent">{icon}{title}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{body}</p>
            </div>
          ))}
        </div>

        <h3 className="mt-6 text-sm font-semibold uppercase tracking-wider text-ink-3">NASA Space Apps 2026 challenges</h3>
        <ul className="mt-2 space-y-2 text-sm text-ink-2">
          <li><span className="font-semibold text-ink">Interplanetary Survival Guide: Martian Map (primary).</span> A layered, interactive Mars map for planning and carrying out a Marswalk.</li>
          <li><span className="font-semibold text-ink">Health monitoring for astronauts.</span> Live synthetic EVA vitals and suit resources tied to the walk being planned.</li>
          <li><span className="font-semibold text-ink">Junior astronaut mission trainer.</span> Drive, walk and plan hands-on, with immediate feedback on safety.</li>
          <li><span className="font-semibold text-ink">Earth analogs.</span> Planned: compare the Mars site with an Earth training location using real elevation data.</li>
        </ul>

        <div className="mt-6 flex items-start gap-3 rounded-xl border border-nominal/40 bg-nominal/10 p-4 text-[13px] leading-relaxed text-ink-2">
          <Database className="mt-0.5 size-4 shrink-0 text-nominal" />
          <div>
            <span className="font-semibold text-ink">Real NASA terrain.</span> The map is a 2 × 2 km region of Jezero Crater around the
            Perseverance landing site, built from NASA Mars Reconnaissance Orbiter data: the HiRISE 1 m elevation model and 25 cm
            orthoimage (USGS Astrogeology, Mars 2020 surface-operations products), cross-checked against the CTX elevation model. A thermal
            infrared layer comes from THEMIS on 2001 Mars Odyssey. Habitat, rover, suit and crew values are simulations; fine surface
            grain, horizon and title image are AI-generated illustrations. Not affiliated with or endorsed by NASA.
          </div>
        </div>
        <p className="mt-4 text-xs text-ink-3">Full documentation: docs/ in the project repository.</p>
      </div>
    </div>
  )
}

/** Presentation mode: hides the control panels and leaves a slim status strip for live demos. */
export function PresentationStrip({ battery, o2, objective, met }: { battery: number; o2: number; objective: string; met: string }) {
  return (
    <div className="pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-6 rounded-2xl px-6 py-3 glass">
      <div className="text-sm font-semibold">BEYOND EARTH LABS · 3D WORLD</div>
      <div className="h-6 w-px bg-white/15" />
      <div className="max-w-[360px] truncate text-sm text-ink-2">{objective}</div>
      <div className="h-6 w-px bg-white/15" />
      <div className="font-mono text-sm">Rover {battery.toFixed(0)}%</div>
      <div className="font-mono text-sm">Suit O₂ {o2.toFixed(0)}%</div>
      <div className="font-mono text-sm text-ink-3">{met}</div>
      <button onClick={() => ui.set({ presentation: false })} className="rounded-lg bg-white/10 px-2.5 py-1 text-xs hover:bg-white/15">Exit (F)</button>
    </div>
  )
}
