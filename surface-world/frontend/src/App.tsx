import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ControlsOverlay, InspectPanel, MissionCard, RoutePanel, Telemetry, Toasts, TopBar } from '@/dashboard/HUD'
import { Intro } from '@/dashboard/Intro'
import { About, PresentationStrip } from '@/dashboard/About'
import { Science } from '@/dashboard/Science'
import { StoryCard } from '@/dashboard/Story'
import { TrainerCard } from '@/dashboard/Trainer'
import { RedHorizonCard } from '@/dashboard/Emergency'
import { MissionLinkCard } from '@/dashboard/MissionLink'
import { useKeyboardCapture } from '@/hooks/useKeyboard'
import { api, REGION } from '@/services/api'
import { actions, bindWorld } from '@/state/actions'
import { sim, ui, useUI } from '@/state/store'
import { placeRover } from '@/simulation/rover/physics'
import { placeAstronautAtHabitat } from '@/simulation/astronaut/eva'
import { Scene } from '@/simulation/Scene'
import { World } from '@/simulation/terrain/heightfield'

export default function App() {
  const [world, setWorld] = useState<World | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resetSignal, setReset] = useState(0)
  const [showIntro, setShowIntro] = useState(() => new URLSearchParams(location.search).get('intro') !== '0' && sessionStorage.getItem('pf-intro') !== 'seen')
  const quality: 'low' | 'high' = new URLSearchParams(location.search).get('quality') === 'low' ? 'low' : 'high'
  useKeyboardCapture()
  const presentation = useUI((s) => s.presentation)
  const story = useUI((s) => s.story)
  const lesson = useUI((s) => s.lesson)
  const [, tick] = useState(0)
  useEffect(() => { if (!presentation) return; const id = setInterval(() => tick((t) => t + 1), 500); return () => clearInterval(id) }, [presentation])

  useEffect(() => {
    api.terrain(REGION).then((t) => {
      const w = new World(t)
      bindWorld(w)
      Object.assign(sim.rover, { x: w.habitat[0] + 18, z: w.habitat[1] - 6, heading: 0, batteryWh: w.rover.battery_wh })
      placeRover(w, sim.rover)
      placeAstronautAtHabitat(w)
      setWorld(w)
      ui.set({ ready: true })
      void actions.loadMission()
    }).catch((e) => setError(String(e)))
  }, [])

  // Discrete hotkeys (continuous driving keys are read by the render loop).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (e.repeat) return
      const camMap: Record<string, 'free' | 'astronaut' | 'rover' | 'top' | 'orbit'> = { Digit1: 'free', Digit2: 'astronaut', Digit3: 'rover', Digit4: 'top', Digit5: 'orbit' }
      if (camMap[e.code]) actions.setCamera(camMap[e.code])
      else if (e.code === 'KeyC') actions.cycleCamera()
      else if (e.code === 'KeyH') actions.toggleHelp()
      else if (e.code === 'KeyL') actions.cycleLayer()
      else if (e.code === 'KeyP') void actions.planRoute()
      else if (e.code === 'KeyG') (ui.get().agent === 'rover' ? actions.beginExpedition() : actions.startEva())
      else if (e.code === 'KeyF') ui.set((s) => ({ presentation: !s.presentation }))
      else if (e.code === 'Escape' && ui.get().flyover) ui.set({ flyover: false })
      else if (e.code === 'Escape') { if (ui.get().story !== null) ui.set({ story: null, experimentDrive: null }); else if (ui.get().showScience) ui.set({ showScience: false }); else if (ui.get().experimentDrive !== null) ui.set({ experimentDrive: null }); else if (ui.get().showAbout) ui.set({ showAbout: false }); else if (ui.get().presentation) ui.set({ presentation: false }); else actions.stopExpedition('stopped by operator') }
      else if (e.code === 'KeyX') actions.scan()
      else if (e.code === 'KeyM') actions.toggleM20()
      else if (e.code === 'KeyR' && ui.get().camera !== 'free') setReset((n) => n + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const intro = showIntro && <Intro ready={!!world} onEnter={() => { sessionStorage.setItem('pf-intro', 'seen'); setShowIntro(false) }} />
  if (error) return <div className="flex h-full items-center justify-center p-8 text-center text-sm text-warning">Could not load terrain from the backend ({error}).<br />Start it with: uvicorn backend.api.main:app --port 8320</div>
  if (!world) return intro || <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-3"><Loader2 className="size-5 animate-spin" />Generating terrain…</div>

  return (
    <div className="relative h-full w-full">
      <Scene world={world} resetSignal={resetSignal} quality={quality} />
      <div className="pointer-events-none absolute inset-0 z-10">
        {story !== null ? <StoryCard world={world} /> : presentation ? (
          <PresentationStrip battery={(100 * sim.rover.batteryWh) / world.rover.battery_wh} o2={(100 * sim.astro.o2G) / world.astronaut.suit_o2_g}
            objective={ui.get().eva === 'walking' ? 'EVA in progress' : ui.get().expedition === 'driving' ? 'Rover driving autonomously' : 'Mission control'}
            met={`Sol ${Math.floor(sim.metS / 88775)}`} />
        ) : (
          <>
            <TopBar world={world} onResetCamera={() => setReset((n) => n + 1)} />
            {/* left column: mission summary above telemetry; never overlapping, scrolls on short screens */}
            <div className="absolute bottom-4 left-4 top-4 flex flex-col justify-between gap-3 overflow-y-auto">
              <MissionCard world={world} />
              <Telemetry world={world} />
            </div>
            {/* right column: site details stack above the route planner, never overlapping */}
            <div className="absolute bottom-4 right-4 top-[132px] flex flex-col gap-3 overflow-y-auto">
              <div className="min-h-0 flex-1" />{/* pushes the cards to the bottom, and lets a tall stack scroll from its top */}
              <MissionLinkCard />
              <InspectPanel world={world} />
              <RoutePanel world={world} />
            </div>
          </>
        )}
        {story === null && !presentation && (
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
            <RedHorizonCard />
            <TrainerCard world={world} />
          </div>
        )}
        <Toasts />
        {!showIntro && !presentation && story === null && lesson === null && <ControlsOverlay />}
        <About />
        <Science />
      </div>
      {intro}
    </div>
  )
}
