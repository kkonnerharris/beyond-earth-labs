import type { Route } from '@/services/api'
import { sim, ui, type Layer } from '@/state/store'
import type { World } from '@/simulation/terrain/heightfield'

/**
 * Junior Astronaut Mission Trainer: five hands-on lessons. Each step is checked against the live
 * simulation, and each quiz is built from numbers the player just produced, so the right answer is
 * whatever the real terrain and models say, never a hard-coded fact.
 */
export interface PlannedRoute { agent: Route['agent']; mode: Route['mode']; dest: string; energy: number; hazards: number; distance: number; maxSlope: number; o2: number | null }

/** What the player has done since the current lesson started. */
export const log = { startOdo: 0, blocked: false, layers: new Set<Layer>(), routes: [] as PlannedRoute[], evaStarted: false }
export function resetLog() {
  Object.assign(log, { startOdo: sim.rover.odometer, blocked: false, layers: new Set<Layer>(), routes: [], evaStarted: false })
}

let watching = false
/** Record routes, layers and EVA starts as they happen (called once when the trainer opens). */
export function watch() {
  if (watching) return
  watching = true
  let prev = ui.get()
  ui.subscribe(() => {
    const s = ui.get()
    if (s.layer !== prev.layer) log.layers.add(s.layer)
    for (const r of [s.route !== prev.route ? s.route : null, s.evaRoute !== prev.evaRoute ? s.evaRoute : null]) {
      if (r && s.destination) log.routes.push({ agent: r.agent, mode: r.mode, dest: s.destination.join(','), energy: r.energy_wh, hazards: r.hazard_segments.length, distance: r.distance_m, maxSlope: r.max_slope_deg, o2: r.o2_g })
    }
    if (s.eva === 'walking' && prev.eva !== 'walking') log.evaStarted = true
    prev = s
  })
  setInterval(() => { if (sim.rover.blocked) log.blocked = true }, 250)
}

export interface Quiz { question: string; options: string[]; answer: number; explain: string }
export interface Lesson {
  title: string
  why: string
  steps: { text: string; done: (w: World) => boolean }[]
  quiz?: (w: World) => Quiz | null
  /** extra points earned in this lesson, with the reason */
  bonus?: (w: World) => [number, string] | null
  action?: 'red-horizon'
}

const fmtMin = (s: number) => `${(s / 60).toFixed(1)} min`
const lastRoute = (pred: (r: PlannedRoute) => boolean) => [...log.routes].reverse().find(pred)
/** The latest Shortest + Lowest-risk rover routes that share a destination. */
function pair() {
  const fast = lastRoute((r) => r.agent === 'rover' && r.mode === 'fast')
  const safe = fast && lastRoute((r) => r.agent === 'rover' && r.mode === 'safe' && r.dest === fast.dest)
  return fast && safe ? { fast, safe } : null
}

export const LESSONS: Lesson[] = [
  {
    title: 'Drive on Mars',
    why: 'Nobody on Earth can joystick a Mars rover: every command takes minutes to arrive. Rovers drive themselves, and people plan ahead.',
    steps: [
      { text: 'Switch to the Rover camera (press 3)', done: () => ui.get().camera === 'rover' },
      { text: 'Drive 25 m with W A S D (bonus points if you never get blocked)', done: () => sim.rover.odometer - log.startOdo >= 25 },
    ],
    quiz: () => {
      const d = sim.commDelayS
      return { question: `A radio signal takes ${fmtMin(d)} to reach Earth. If you press "forward" from Earth, how long until you see the rover move?`,
        options: [fmtMin(d), fmtMin(2 * d), 'Instantly', '1 second'], answer: 1,
        explain: `The command takes ${fmtMin(d)} to get there, and the camera picture takes ${fmtMin(d)} to come back: ${fmtMin(2 * d)} in total.` }
    },
    bonus: () => (log.blocked ? null : [25, 'drove without getting blocked']),
  },
  {
    title: 'Read the ground',
    why: 'Steep or rough ground can trap a rover or tire an astronaut. Engineers read slope maps computed from NASA elevation data before choosing a path.',
    steps: [
      { text: 'Open the Slope layer (press L or use the layer buttons)', done: () => log.layers.has('slope') || ui.get().layer === 'slope' },
      { text: 'Open the Traversability layer', done: () => log.layers.has('hazard') || ui.get().layer === 'hazard' },
    ],
    quiz: (w) => {
      const r = w.rover.max_slope_deg, a = w.astronaut.max_slope_deg
      const answer = r > a ? 0 : a > r ? 1 : 2
      return { question: `In this simulation the rover can climb up to ${r}° and an astronaut up to ${a}°. Who can take steeper ground?`,
        options: ['The rover', 'The astronaut', 'They are the same'], answer,
        explain: answer === 0 ? `The rover: ${r}° against ${a}°. Six wheels grip better than boots on loose slopes, and a fall in a suit is dangerous.` : `The astronaut: ${a}° against ${r}°.` }
    },
  },
  {
    title: 'Plan like an engineer',
    why: 'The shortest path is not always the best one. Mission planners trade distance against risk and energy.',
    steps: [
      { text: 'Pick a destination for the rover: click the terrain or a science site', done: () => ui.get().agent === 'rover' && !!ui.get().destination },
      { text: 'Choose "Shortest" and press Plan Expedition', done: () => !!lastRoute((r) => r.agent === 'rover' && r.mode === 'fast') },
      { text: 'Now choose "Lowest risk" for the same spot (it re-plans)', done: () => !!pair() },
    ],
    quiz: () => {
      const p = pair()
      if (!p) return null
      const diff = Math.abs(p.fast.energy - p.safe.energy)
      const answer = diff < 1 ? 2 : p.fast.energy < p.safe.energy ? 0 : 1
      return { question: 'You planned both routes to the same place. Which one needs less energy?', options: ['Shortest', 'Lowest risk', 'About the same'], answer,
        explain: `Shortest: ${p.fast.distance.toFixed(0)} m, ${p.fast.energy.toFixed(0)} Wh, ${p.fast.hazards} hazard segments. Lowest risk: ${p.safe.distance.toFixed(0)} m, ${p.safe.energy.toFixed(0)} Wh, ${p.safe.hazards} hazard segments. ${answer === 1 ? 'The safer detour avoided energy-hungry rough ground.' : answer === 0 ? 'Avoiding hazards cost extra distance, and distance costs energy: that is the trade-off.' : 'Here the detour cost almost nothing.'}` }
    },
  },
  {
    title: 'Oxygen is the clock',
    why: 'An astronaut must always carry enough oxygen to get back, plus a safety reserve. The planner refuses any EVA that breaks this rule.',
    steps: [
      { text: 'In the planner, switch to Astronaut EVA', done: () => ui.get().agent === 'astronaut' },
      { text: 'Pick a destination and plan an EVA route', done: () => !!lastRoute((r) => r.agent === 'astronaut') },
      { text: 'Start the EVA', done: () => log.evaStarted },
    ],
    quiz: (w) => {
      const r = lastRoute((x) => x.agent === 'astronaut')
      if (!r || r.o2 === null) return null
      const one = r.o2, reserve = w.astronaut.reserve_fraction * w.astronaut.suit_o2_g
      const opts = [one, 2 * one, 2 * one + reserve, one + reserve].map((g) => `${g.toFixed(0)} g`)
      return { question: `Your walk out uses about ${one.toFixed(0)} g of oxygen. The rule keeps a ${reserve.toFixed(0)} g reserve. How much must the suit hold before you leave?`,
        options: opts, answer: 2, explain: `Out (${one.toFixed(0)} g) + back (${one.toFixed(0)} g) + reserve (${reserve.toFixed(0)} g) = ${(2 * one + reserve).toFixed(0)} g. You always plan the way home before you leave.` }
    },
  },
  {
    title: 'Operation Red Horizon',
    why: 'Things go wrong. With Earth minutes away, the crew must compare options quickly and act on numbers, not hope.',
    steps: [
      { text: 'Start the emergency', done: () => !!ui.get().redHorizon },
      { text: 'Read the advisory and approve a plan', done: () => { const p = ui.get().redHorizon?.phase; return p === 'executing' || p === 'resolved' || p === 'failed' } },
      { text: 'Bring the astronaut home safely', done: () => ui.get().redHorizon?.phase === 'resolved' },
    ],
    bonus: (w) => {
      const r = ui.get().redHorizon?.result
      if (!r || ui.get().redHorizon?.phase !== 'resolved') return null
      return r.o2LeftG >= w.astronaut.reserve_fraction * w.astronaut.suit_o2_g ? [50, 'got home with the full oxygen reserve'] : [20, 'got home, but below the reserve']
    },
    action: 'red-horizon',
  },
]

export const LESSON_POINTS = 100
export const QUIZ_POINTS = 50
export const MAX_SCORE = LESSONS.length * LESSON_POINTS + LESSONS.filter((l) => l.quiz).length * QUIZ_POINTS + 25 + 50
export const rank = (pct: number) => (pct >= 0.9 ? 'Flight Director' : pct >= 0.7 ? 'Mission Specialist' : 'Junior Astronaut')
