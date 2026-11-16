/**
 * Operation Red Horizon: a coordinated emergency (SIMULATED scenario on the real map).
 *
 * An astronaut is out on an EVA when a dust storm arrives, a suit seal starts leaking and they twist an
 * ankle. Earth is 12.4 minutes away each way, so the crew has to decide on the spot. The advisory plans
 * both options on the real terrain with the same planner and models as everything else, says which one
 * gets the astronaut home with more oxygen, and runs nothing until the operator approves.
 */
import { api, REGION, type Route } from '@/services/api'
import { actions, roverFeasibility } from '@/state/actions'
import { notify, sim, ui } from '@/state/store'
import { dockPosition, habitatAutonomyH } from '@/simulation/habitat'
import { airlock } from '@/simulation/health'
import type { World } from '@/simulation/terrain/heightfield'

export const RH = {
  startO2G: 260,        // suit oxygen when the emergency starts (about half a suit)
  leakGps: 0.3,         // seal leak, g/s
  injuredPace: 0.4,     // walking speed after the ankle injury, fraction of normal
  cartridgeG: 200,      // spare oxygen carried on the rover
  evaElapsedS: 25 * 60, // how long the EVA had been running
  targetM: [220, 380] as [number, number], // how far from the airlock the astronaut is
}

export interface RHOption {
  id: 'walk' | 'rover'
  title: string
  feasible: boolean
  timeS: number
  o2HomeG: number          // estimated suit oxygen on reaching safety
  lines: string[]
  routes: Route[]
}
export interface RHState {
  phase: 'advisory' | 'executing' | 'resolved' | 'failed'
  options: RHOption[] | null
  recommended: RHOption['id'] | null
  chosen: RHOption['id'] | null
  stage: 'walk-home' | 'rover-out' | 'ride-home' | null
  startMetS: number
  minO2G: number
  /** times the rescue drive was re-planned after the rover stopped */
  replans: number
  result: { o2LeftG: number; minutes: number; text: string } | null
  error: string | null
}

let world: World | null = null
/** The scenario lives in the UI store, so a scenario reset (which clears it) also ends it. */
const get = () => ui.get().redHorizon
const set = (patch: Partial<RHState>) => ui.set((s) => ({ redHorizon: s.redHorizon ? { ...s.redHorizon, ...patch } : null }))

/** Where the astronaut is when it starts: the science site whose distance from the airlock fits best. */
function pickSpot(w: World): [number, number] {
  const [ax, az] = airlock(w)
  const mid = (RH.targetM[0] + RH.targetM[1]) / 2
  const candidates = w.sites
    .map((s) => ({ s, d: Math.hypot(s.x - ax, s.z - az) }))
    .filter(({ s, d }) => d >= RH.targetM[0] && d <= RH.targetM[1] && w.inBounds(s.x, s.z, 10))
    .sort((a, b) => Math.abs(a.d - mid) - Math.abs(b.d - mid))
  if (candidates.length) return [candidates[0].s.x + 6, candidates[0].s.z + 6]
  // no site in range: walk out along the direction with the most room
  for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
    const x = ax + Math.cos(ang) * mid, z = az + Math.sin(ang) * mid
    if (w.inBounds(x, z, 10)) return [x, z]
  }
  return [ax + 100, az]
}

export async function startRedHorizon(w: World) {
  world = w
  actions.resetScenario()
  const [x, z] = pickSpot(w)
  Object.assign(sim.astro, { x, z, y: w.heightAt(x, z), o2G: RH.startO2G, leakGps: RH.leakGps, paceFactor: RH.injuredPace, evaS: RH.evaElapsedS, fatigue: 35, hydration: 82, heartRate: 118, metabolicW: w.astronaut.rest_w })
  ui.set({ weather: 'dust', agent: 'astronaut', eva: 'idle', camera: 'top', showHelp: false, story: null, selected: null })
  ui.set({ redHorizon: { phase: 'advisory', options: null, recommended: null, chosen: null, stage: null, startMetS: sim.metS, minO2G: RH.startO2G, replans: 0, result: null, error: null } })
  notify('Red Horizon: suit leak and ankle injury during a dust storm. Building the advisory…', 'warning')
  await buildAdvisory()
}

async function buildAdvisory() {
  const w = world!
  const a = sim.astro, p = w.astronaut
  const [ax, az] = airlock(w)
  const restGps = p.rest_w / 1000 / 14
  const options: RHOption[] = []

  // A: walk home alone at the injured pace; the leak runs the whole way
  try {
    const r = await api.route([a.x, a.z], [ax, az], 'safe', 'astronaut', REGION)
    const speed = p.walk_speed_mps * RH.injuredPace
    const timeS = r.distance_m / speed
    // same metabolic model as eva.ts: a slower pace burns less per second, for longer
    const ratePerS = (p.rest_w + (p.walk_w - p.rest_w) * RH.injuredPace) / 1000 / 14 + RH.leakGps
    const home = a.o2G - ratePerS * timeS
    const shortM = r.distance_m - (a.o2G / ratePerS) * speed
    options.push({ id: 'walk', title: 'Walk back alone', feasible: home > 0, timeS, o2HomeG: home, routes: [r], lines: [
      `${r.distance_m.toFixed(0)} m on the lowest-risk route at ${(RH.injuredPace * 100).toFixed(0)}% pace: about ${(timeS / 60).toFixed(0)} min.`,
      `The leak runs the whole way: ${(RH.leakGps * timeS).toFixed(0)} g of O₂ lost.`,
      home > 0 ? `Reaches the airlock with about ${home.toFixed(0)} g O₂.` : `The suit runs out about ${shortM.toFixed(0)} m short of the airlock.`,
    ] })
  } catch (e) { options.push({ id: 'walk', title: 'Walk back alone', feasible: false, timeS: 0, o2HomeG: -1, routes: [], lines: [`No walking route home: ${e instanceof Error ? e.message : e}`] }) }

  // B: the astronaut rests in place while the rover drives out with a patch kit and a spare cartridge
  try {
    const out = await api.route([sim.rover.x, sim.rover.z], [a.x, a.z], 'safe', 'rover', REGION)
    const back = await api.route([a.x, a.z], dockPosition(w), 'safe', 'rover', REGION)
    const waitS = out.travel_time_s + 60  // plus a minute to patch the seal and swap the cartridge
    const atRendezvous = a.o2G - (restGps + RH.leakGps) * waitS
    const home = Math.min(p.suit_o2_g, atRendezvous + RH.cartridgeG) - restGps * back.travel_time_s
    const f = roverFeasibility(out)
    const feasible = atRendezvous > 0 && f.feasible
    options.push({ id: 'rover', title: 'Rover rendezvous', feasible, timeS: waitS + back.travel_time_s, o2HomeG: home, routes: [out, back], lines: [
      `Rover drives ${out.distance_m.toFixed(0)} m on the lowest-risk route (~${(out.travel_time_s / 60).toFixed(1)} min); the astronaut rests to cut oxygen use.`,
      `Waiting costs ${((restGps + RH.leakGps) * waitS).toFixed(0)} g O₂, then the seal is patched and a ${RH.cartridgeG} g cartridge is swapped in.`,
      f.feasible ? `Rover energy is fine: ${f.needed.toFixed(0)} Wh needed with reserve, ${f.available.toFixed(0)} Wh on board.` : `Rover battery too low: needs ${f.needed.toFixed(0)} Wh, has ${f.available.toFixed(0)} Wh.`,
      `Rides back on the rover, reaching the dock with about ${home.toFixed(0)} g O₂.`,
    ] })
  } catch (e) { options.push({ id: 'rover', title: 'Rover rendezvous', feasible: false, timeS: 0, o2HomeG: -1, routes: [], lines: [`No rover route: ${e instanceof Error ? e.message : e}`] }) }

  const ok = options.filter((o) => o.feasible).sort((x, y) => y.o2HomeG - x.o2HomeG)
  set({ options, recommended: ok[0]?.id ?? null })
}

export function approve(id: RHOption['id']) {
  const opt = get()?.options?.find((o) => o.id === id)
  if (!opt || !opt.feasible) return
  set({ phase: 'executing', chosen: id, stage: id === 'walk' ? 'walk-home' : 'rover-out' })
  if (id === 'walk') {
    sim.astro.pathIndex = 0
    ui.set({ agent: 'astronaut', evaRoute: opt.routes[0], eva: 'walking', destination: null })
  } else {
    sim.routeIndex = 0
    ui.set({ agent: 'rover', route: opt.routes[0] })
    actions.beginExpedition()
  }
  notify(`Approved: ${opt.title.toLowerCase()}.`)
}

export function abortRedHorizon() {
  actions.resetScenario()
}

let replanning = false
const MAX_REPLANS = 6
/** The rover stopped mid-rescue (blocked, or an operator override): plan again from where it is and carry on. */
async function replanRover(w: World, stage: 'rover-out' | 'ride-home') {
  if (replanning) return
  replanning = true
  const why = sim.rover.blocked ?? 'rover stopped'
  notify(`Rescue drive interrupted (${why}). Re-planning from the rover's position…`, 'caution')
  try {
    const goal: [number, number] = stage === 'rover-out' ? [sim.astro.x, sim.astro.z] : dockPosition(w)
    const r = await api.route([sim.rover.x, sim.rover.z], goal, 'safe', 'rover', REGION)
    const st = get()
    if (!st || st.phase !== 'executing' || st.stage !== stage) return
    set({ replans: st.replans + 1 })
    sim.routeIndex = 0
    ui.set({ route: r })
    actions.beginExpedition()
  } catch (e) {
    notify(`No rover route from here: ${e instanceof Error ? e.message : e}`, 'warning')
  } finally { replanning = false }
}

/** Runs every frame from the sim loop: tracks the rescue and moves it to its next stage. */
export function stepRedHorizon(w: World) {
  const state = get()
  if (!state || state.phase !== 'executing') return
  const a = sim.astro, s = ui.get()
  if (a.o2G < state.minO2G) state.minO2G = a.o2G  // tracked in place; shown only in the result
  const minutes = (sim.metS - state.startMetS) / 60
  if (a.o2G <= 0) {
    a.paceFactor = 1; a.leakGps = 0
    set({ phase: 'failed', result: { o2LeftG: 0, minutes, text: 'The suit ran out of oxygen before reaching safety. In the simulation, that ends the EVA.' } })
    ui.set({ eva: 'idle', expedition: 'idle' })
    return
  }
  if ((state.stage === 'rover-out' || state.stage === 'ride-home') && s.expedition === 'idle') {
    if (state.replans >= MAX_REPLANS) {
      set({ phase: 'failed', result: { o2LeftG: a.o2G, minutes, text: `The rover could not get through after ${MAX_REPLANS} re-plans. In a real mission the crew would now try the walking option.` } })
      a.paceFactor = 1; a.leakGps = 0
      return
    }
    void replanRover(w, state.stage)
    return
  }
  if (state.stage === 'walk-home' && s.eva === 'arrived') finish(minutes, state.minO2G)
  else if (state.stage === 'rover-out' && s.expedition === 'arrived') {
    a.leakGps = 0
    a.o2G = Math.min(w.astronaut.suit_o2_g, a.o2G + RH.cartridgeG)
    const back = state.options!.find((o) => o.id === 'rover')!.routes[1]
    set({ stage: 'ride-home' })
    sim.routeIndex = 0
    ui.set({ route: back })
    actions.beginExpedition()
    notify('Rendezvous: seal patched, cartridge swapped. Riding back to the habitat.')
  } else if (state.stage === 'ride-home') {
    // the astronaut rides on the rover's deck
    a.x = sim.rover.x - Math.cos(sim.rover.heading) * 0.6
    a.z = sim.rover.z - Math.sin(sim.rover.heading) * 0.6
    a.y = sim.rover.y + 0.9
    if (s.expedition === 'arrived') finish(minutes, state.minO2G)
  }
}

function finish(minutes: number, minO2G: number) {
  const a = sim.astro
  a.paceFactor = 1; a.leakGps = 0
  const o2 = a.o2G
  const replans = get()?.replans ?? 0
  set({ phase: 'resolved', result: { o2LeftG: o2, minutes, text: `Astronaut safe with ${o2.toFixed(0)} g O₂ after ${minutes.toFixed(1)} min. Lowest point: ${minO2G.toFixed(0)} g.${replans ? ` The rescue drive was re-planned ${replans}×.` : ''}` } })
  notify('Red Horizon resolved: astronaut back at the habitat.')
}

export const habitatNote = () => {
  const h = habitatAutonomyH()
  return h === null ? 'Habitat solar still covers the base load.' : `Habitat on battery in the storm: about ${h.toFixed(1)} h before it sheds oxygen production.`
}
