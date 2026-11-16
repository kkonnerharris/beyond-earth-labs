import { useSyncExternalStore } from 'react'
import { EMBEDDED, type MissionPlan, type Route, type RouteMode } from '@/services/api'
import type { Alert, Limits } from '@/simulation/health'
import type { RHState } from '@/state/redHorizon'

/**
 * Two kinds of state:
 *  - `sim`: high-frequency simulation state, mutated in place by the render loop (60 fps). React never
 *    re-renders from it directly; the HUD samples it on a timer.
 *  - `ui` store: discrete choices (camera mode, route, selection). Changes notify subscribers.
 * Anything that changes the mission (keyboard, buttons, later the AI copilot) goes through the same
 * small set of actions below, so the render loop never waits on a network call or an LLM.
 */

export type CameraMode = 'free' | 'astronaut' | 'rover' | 'top' | 'orbit'
export type Layer = 'natural' | 'slope' | 'hazard' | 'thermal'
export type Selection = { kind: 'site' | 'habitat' | 'module' | 'rover' | 'astronaut' | 'hazard'; id: string; x: number; z: number; label: string } | null

export interface AstronautSim {
  x: number; z: number; y: number; heading: number; speed: number
  state: 'idle' | 'walking'
  phase: number            // walk-cycle phase (radians)
  o2G: number; suitWh: number; evaS: number
  heartRate: number; spo2: number; fatigue: number; hydration: number; bodyTemp: number
  metabolicW: number
  pathIndex: number
  /** extra O₂ loss from a suit leak, g/s (0 normally; Operation Red Horizon sets it) */
  leakGps: number
  /** walking speed multiplier (1 normally; an injury lowers it) */
  paceFactor: number
}

export interface RoverSim {
  x: number; z: number; y: number
  heading: number          // radians; 0 = facing +x (east), positive turns toward +z (south)
  speed: number            // m/s, signed
  steer: number            // radians, front-wheel angle
  batteryWh: number
  odometer: number
  energyUsedWh: number
  mode: 'manual' | 'auto'
  blocked: string | null
  slopeDeg: number
  hazard: string | null
  quat: [number, number, number, number]
  scanning: number         // seconds remaining
}

export const sim = {
  metS: 34 * 88775 + 9 * 3600,   // Sol 34 (Mars sol = 88 775 s), simulation clock
  commDelayS: 744,               // simulated one-way light time (12.4 min)
  routeIndex: 0,
  astroIndex: 0,
  fps: 60,
  timeScale: 1,
  rover: {
    x: 0, z: 0, y: 0, heading: 0, speed: 0, steer: 0, batteryWh: 2400, odometer: 0, energyUsedWh: 0,
    mode: 'manual', blocked: null, slopeDeg: 0, hazard: null, quat: [0, 0, 0, 1], scanning: 0,
  } as RoverSim,
  astro: {
    x: 0, z: 0, y: 0, heading: 0, speed: 0, state: 'idle', phase: 0, o2G: 560, suitWh: 300, evaS: 0,
    heartRate: 72, spo2: 98, fatigue: 8, hydration: 100, bodyTemp: 36.8, metabolicW: 110, pathIndex: 0, leakGps: 0, paceFactor: 1,
  } as AstronautSim,
}

export interface UIState {
  camera: CameraMode
  layer: Layer
  destination: [number, number] | null
  route: Route | null
  agent: 'rover' | 'astronaut'
  evaRoute: Route | null
  eva: 'idle' | 'walking' | 'arrived'
  timeOfDay: number | null   // illustrative lighting override, hours LMST
  weather: 'clear' | 'dust'  // illustrative atmosphere preset
  showAbout: boolean
  presentation: boolean
  /** stop drawing frames (an embedding page sets this while the map is hidden, to save the GPU) */
  renderPaused: boolean
  routeMode: RouteMode
  planning: boolean
  routeError: string | null
  expedition: 'idle' | 'driving' | 'arrived'
  selected: Selection
  showHelp: boolean
  /** NASA overlay: Perseverance traverse + Ingenuity flights */
  showM20: boolean
  /** the Perseverance route experiment panel, and which drive is drawn on the map */
  showScience: boolean
  experimentDrive: number | null
  /** guided mission story: chapter index, or null when not playing */
  story: number | null
  ready: boolean
  /** crew health: operator-set alert limits and the alert log */
  alertLimits: Limits
  alerts: Alert[]
  /** Junior Astronaut trainer: open lesson index, or null */
  lesson: number | null
  /** Operation Red Horizon emergency, or null when not running */
  redHorizon: RHState | null
  /** the mission planned in the main map, in this world's frame; null when there is none */
  mission: MissionPlan | null
  missionError: string | null
  showMission: boolean
  /** the camera is flying along the mission route */
  flyover: boolean
  messages: { id: number; level: 'info' | 'caution' | 'warning'; text: string }[]
}

type Listener = () => void
let state: UIState = {
  camera: 'rover', layer: 'natural', destination: null, route: null, agent: 'rover', evaRoute: null, eva: 'idle', timeOfDay: null, weather: 'clear', showAbout: false, presentation: false, renderPaused: false, routeMode: 'balanced', planning: false, routeError: null,
  expedition: 'idle', selected: null, showHelp: !EMBEDDED, showM20: true, showScience: false, experimentDrive: null, story: null, ready: false, messages: [],
  alertLimits: { heartRateHigh: 140, spo2Low: 94, o2MinLow: 20, fatigueHigh: 70, hydrationLow: 70, bodyTempHigh: 38 }, alerts: [], lesson: null, redHorizon: null,
  mission: null, missionError: null, showMission: true, flyover: false,
}
const listeners = new Set<Listener>()

export const ui = {
  get: () => state,
  set(patch: Partial<UIState> | ((s: UIState) => Partial<UIState>)) {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
    listeners.forEach((l) => l())
  },
  subscribe(l: Listener) { listeners.add(l); return () => listeners.delete(l) },
}

export function useUI<T>(select: (s: UIState) => T): T {
  return useSyncExternalStore(ui.subscribe, () => select(state), () => select(state))
}

let msgId = 1
export function notify(text: string, level: 'info' | 'caution' | 'warning' = 'info') {
  const id = msgId++
  ui.set((s) => ({ messages: [...s.messages.slice(-3), { id, level, text }] }))
  setTimeout(() => ui.set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })), 5000)
}
