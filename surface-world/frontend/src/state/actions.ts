/**
 * The command layer. Every way of changing the mission (keyboard, buttons, and the AI copilot later)
 * calls these functions; nothing else mutates mission state. Each command validates its input, so an
 * AI can only do what a button could do.
 */
import { api, MISSION_ID, REGION, type Route } from '@/services/api'
import { notify, sim, ui, type CameraMode, type Layer } from './store'
import type { World } from '@/simulation/terrain/heightfield'
import { placeRover } from '@/simulation/rover/physics'
import { placeAstronautAtHabitat } from '@/simulation/astronaut/eva'
import { resetHabitat } from '@/simulation/habitat'
import { resetHealth } from '@/simulation/health'

let world: World | null = null
export function bindWorld(w: World) { world = w }

const CAMERAS: CameraMode[] = ['free', 'astronaut', 'rover', 'top']
const LAYERS: Layer[] = ['natural', 'slope', 'hazard']

/** Oxygen needed for an EVA: out + back + the configured reserve fraction of a full suit. */
export function evaFeasibility(route: Route) {
  const p = world!.astronaut
  const oneWay = route.o2_g ?? 0
  const needed = oneWay * 2 + p.reserve_fraction * p.suit_o2_g
  return { oneWay, needed, available: sim.astro.o2G, feasible: sim.astro.o2G >= needed }
}

/** Rover battery reserve that must remain after a round trip, as a fraction of capacity. */
export const ROVER_RESERVE = 0.15

/** Energy for a rover drive: out + back (the return assumed to cost the same) + the reserve. */
export function roverFeasibility(route: Route) {
  const cap = world!.rover.battery_wh
  const needed = route.energy_wh * 2 + ROVER_RESERVE * cap
  return { oneWay: route.energy_wh, needed, available: sim.rover.batteryWh, feasible: sim.rover.batteryWh >= needed }
}

export const actions = {
  setCamera(mode: CameraMode) { ui.set({ camera: mode }) },
  cycleCamera() { ui.set((s) => ({ camera: CAMERAS[(Math.max(0, CAMERAS.indexOf(s.camera)) + 1) % CAMERAS.length] })) },
  setLayer(layer: Layer) { ui.set({ layer }) },
  cycleLayer() {
    const layers = world?.real?.themis ? [...LAYERS, 'thermal' as Layer] : LAYERS
    ui.set((s) => ({ layer: layers[(layers.indexOf(s.layer) + 1) % layers.length] }))
  },
  toggleHelp() { ui.set((s) => ({ showHelp: !s.showHelp })) },
  toggleM20() { ui.set((s) => ({ showM20: !s.showM20 })) },
  setTimeOfDay(h: number | null) { ui.set({ timeOfDay: h }) },
  setWeather(weather: 'clear' | 'dust') { ui.set({ weather }) },

  setAgent(agent: 'rover' | 'astronaut') {
    ui.set({ agent, routeError: null, camera: ui.get().camera === 'top' || ui.get().camera === 'free' ? ui.get().camera : agent })
  },

  setDestination(x: number, z: number) {
    if (!world || !world.inBounds(x, z, 2)) { notify('Destination is outside the mapped region.', 'caution'); return }
    const s = ui.get()
    if (s.agent === 'rover' && s.expedition === 'driving') actions.stopExpedition('New destination selected')
    ui.set(s.agent === 'rover'
      ? { destination: [Math.round(x * 10) / 10, Math.round(z * 10) / 10], route: null, routeError: null, expedition: 'idle' }
      : { destination: [Math.round(x * 10) / 10, Math.round(z * 10) / 10], evaRoute: null, routeError: null })
  },

  setRouteMode(mode: 'fast' | 'balanced' | 'safe') {
    ui.set({ routeMode: mode })
    const s = ui.get()
    if ((s.agent === 'rover' && s.route) || (s.agent === 'astronaut' && s.evaRoute)) void actions.planRoute()
  },

  async planRoute() {
    const s = ui.get()
    if (!s.destination) { notify('Click the terrain or choose a site to set a destination first.', 'caution'); return }
    if (s.agent === 'rover' && s.expedition === 'driving') actions.stopExpedition('Re-planning')
    const start: [number, number] = s.agent === 'rover' ? [sim.rover.x, sim.rover.z] : [sim.astro.x, sim.astro.z]
    ui.set({ planning: true, routeError: null })
    try {
      const route = await api.route(start, s.destination, s.routeMode, s.agent, REGION)
      if (s.agent === 'rover') { ui.set({ route, planning: false, expedition: 'idle' }); sim.routeIndex = 0 }
      else { ui.set({ evaRoute: route, planning: false, eva: 'idle' }); sim.astro.pathIndex = 0 }
    } catch (e) {
      ui.set({ planning: false, routeError: e instanceof Error ? e.message : String(e), ...(s.agent === 'rover' ? { route: null } : { evaRoute: null }) })
    }
  },

  /** Deploy Rover */
  beginExpedition() {
    const { route } = ui.get()
    if (!route) { notify('Plan a rover route first.', 'caution'); return }
    const f = roverFeasibility(route)
    if (!f.feasible) {
      notify(`Drive not feasible: needs ${f.needed.toFixed(0)} Wh (out + back + reserve), battery has ${f.available.toFixed(0)} Wh. Charge at the dock first.`, 'warning')
      return
    }
    sim.routeIndex = 0
    sim.rover.mode = 'auto'
    ui.set({ expedition: 'driving' })
    notify(`Rover deployed: ${route.distance_m.toFixed(0)} m, ~${route.energy_wh.toFixed(0)} Wh (simulated).`)
  },

  stopExpedition(reason = 'Stopped') {
    if (ui.get().expedition !== 'driving') return
    sim.rover.mode = 'manual'
    ui.set({ expedition: 'idle' })
    notify(`Autonomous drive halted: ${reason}.`, 'caution')
  },

  arrived() {
    sim.rover.mode = 'manual'
    ui.set({ expedition: 'arrived' })
    notify('Rover arrived at destination.')
  },

  /** Start EVA: refused when the suit cannot cover the walk out, the walk back and the reserve. */
  startEva() {
    const { evaRoute } = ui.get()
    if (!evaRoute) { notify('Plan an EVA route first.', 'caution'); return }
    const f = evaFeasibility(evaRoute)
    if (!f.feasible) {
      notify(`EVA not feasible: needs ${f.needed.toFixed(0)} g O₂ (out + back + reserve), suit has ${f.available.toFixed(0)} g.`, 'warning')
      return
    }
    sim.astro.pathIndex = 0
    ui.set({ eva: 'walking', camera: ui.get().camera === 'rover' ? 'astronaut' : ui.get().camera })
    notify(`EVA started: ${evaRoute.distance_m.toFixed(0)} m walk, ~${f.oneWay.toFixed(0)} g O₂ each way (simulated).`)
  },

  stopEva() {
    if (ui.get().eva === 'walking') { ui.set({ eva: 'idle' }); notify('EVA paused.', 'caution') }
  },

  evaArrived() { ui.set({ eva: 'arrived' }); notify('Astronaut reached the EVA target.') },

  async returnToHabitat() {
    if (!world) return
    ui.set({ agent: 'astronaut', destination: [world.habitat[0] + 13.5, world.habitat[1] + 2] })
    await actions.planRoute()
    if (ui.get().evaRoute) { sim.astro.pathIndex = 0; ui.set({ eva: 'walking' }); notify('Astronaut returning to the habitat.') }
  },

  /** Read the mission planned in the main map (the one named in the URL, else the newest planned one). */
  async loadMission() {
    if (REGION !== 'jezero') return
    try {
      const mission = await api.mission(MISSION_ID)
      ui.set({ mission, missionError: null })
    } catch (e) {
      ui.set({ mission: null, missionError: e instanceof Error ? e.message : String(e) })
    }
  },

  toggleMission() { ui.set((s) => ({ showMission: !s.showMission })) },

  /** Fly the camera along the whole mission route (or stop). Changes nothing in the mission. */
  flyMission() {
    const s = ui.get()
    if (s.flyover) { ui.set({ flyover: false }); return }
    if (!s.mission?.planned) { notify('There is no planned mission route to fly.', 'caution'); return }
    ui.set({ flyover: true, showMission: true })
  },

  /** Drive the first leg of the mission inside this map: the backend follows the mission line on the 5 m planner. */
  async driveMission() {
    const s = ui.get()
    if (!world || !s.mission?.planned) { notify('There is no planned mission route to drive.', 'caution'); return }
    if (s.expedition === 'driving') actions.stopExpedition('Starting the mission drive')
    // Start beside the mission base when the rover is parked elsewhere (it begins at the habitat dock).
    const b = s.mission.base
    if (b.inside && Math.hypot(sim.rover.x - b.x, sim.rover.z - b.z) > 60) {
      const p0 = s.mission.legs[0]?.points.find(([x, z]) => Math.hypot(x - b.x, z - b.z) > 22) ?? [b.x + 22, b.z, 0]
      Object.assign(sim.rover, { x: p0[0], z: p0[1], speed: 0, steer: 0, heading: Math.atan2(p0[1] - b.z, p0[0] - b.x) })
      placeRover(world, sim.rover)
    }
    ui.set({ planning: true, routeError: null, agent: 'rover', flyover: false })
    try {
      const route = await api.missionDrive(s.mission.id, [sim.rover.x, sim.rover.z])
      const end = route.path[route.path.length - 1]
      sim.routeIndex = 0
      sim.rover.mode = 'auto'
      ui.set({ route, destination: [end[0], end[2]], planning: false, expedition: 'driving', showMission: true, camera: ui.get().camera === 'top' ? 'top' : 'rover' })
      notify(`Driving the mission route: ${route.distance_m.toFixed(0)} m on 5 m terrain, toward ${s.mission.legs[0].to}.`)
    } catch (e) {
      ui.set({ planning: false, routeError: e instanceof Error ? e.message : String(e) })
      notify(`The mission route cannot be driven here: ${e instanceof Error ? e.message : String(e)}`, 'warning')
    }
  },

  select(sel: NonNullable<ReturnType<typeof ui.get>['selected']>) { ui.set({ selected: sel }) },
  clearSelection() { ui.set({ selected: null }) },

  selectSite(id: string) {
    const site = world?.sites.find((s) => s.id === id)
    if (!site) return
    ui.set({ selected: { kind: 'site', id: site.id, x: site.x, z: site.z, label: site.name }, camera: 'orbit' })
  },

  scan() {
    sim.rover.scanning = 4
    notify('Scanning terrain ahead (simulated instrument sweep).')
  },

  resetScenario() {
    if (!world) return
    sim.rover.mode = 'manual'
    Object.assign(sim.rover, { x: world.habitat[0] + 18, z: world.habitat[1] - 6, heading: 0, speed: 0, steer: 0, batteryWh: world.rover.battery_wh, odometer: 0, energyUsedWh: 0 })
    placeRover(world, sim.rover)
    placeAstronautAtHabitat(world)
    resetHabitat()
    resetHealth()
    ui.set({ route: null, evaRoute: null, destination: null, expedition: 'idle', eva: 'idle', routeError: null, weather: 'clear', redHorizon: null })
    notify('Scenario reset.')
  },
}
