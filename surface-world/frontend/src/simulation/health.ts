import { notify, sim, ui } from '@/state/store'
import { suitO2Minutes } from '@/simulation/astronaut/eva'
import type { World } from '@/simulation/terrain/heightfield'

/**
 * Crew health monitor (SYNTHETIC data from the metabolic model in eva.ts). It keeps a short history for
 * trend charts, checks every reading against limits the operator can change, and works out whether the
 * suit still holds enough oxygen to get home. Not a medical device: it does not diagnose or treat.
 */
export type Vital = 'heartRate' | 'spo2' | 'o2Min' | 'fatigue' | 'hydration' | 'bodyTemp'
export interface Limits { heartRateHigh: number; spo2Low: number; o2MinLow: number; fatigueHigh: number; hydrationLow: number; bodyTempHigh: number }
export const DEFAULT_LIMITS: Limits = { heartRateHigh: 140, spo2Low: 94, o2MinLow: 20, fatigueHigh: 70, hydrationLow: 70, bodyTempHigh: 38 }

export interface Alert { id: number; metS: number; level: 'caution' | 'warning'; vital: Vital | 'return'; text: string }

const SAMPLE_S = 5
const KEEP = 240 // 20 minutes of mission time
export const history: Record<Vital, number[]> = { heartRate: [], spo2: [], o2Min: [], fatigue: [], hydration: [], bodyTemp: [] }
let sinceSample = 0
const active = new Set<string>()
let alertId = 1

export const airlock = (w: World): [number, number] => [w.habitat[0] + 13.5, w.habitat[1] + 2]

/**
 * Oxygen needed to walk back to the airlock right now: straight-line distance times a 1.3 detour
 * factor (typical of the planner's routes here), at the astronaut's current pace (an injury slows it),
 * plus any leak over the walk, plus the reserve. Uses the same metabolic model as eva.ts.
 */
export function returnBudget(w: World) {
  const a = sim.astro, p = w.astronaut
  const [ax, az] = airlock(w)
  const dist = Math.hypot(a.x - ax, a.z - az) * 1.3
  const walkS = dist / (p.walk_speed_mps * a.paceFactor)
  const ratePerS = (p.rest_w + (p.walk_w - p.rest_w) * a.paceFactor) / 1000 / 14 + a.leakGps
  const needed = ratePerS * walkS + p.reserve_fraction * p.suit_o2_g
  return { dist, needed, available: a.o2G, margin: a.o2G - needed }
}

function readings(): Record<Vital, number> {
  const a = sim.astro
  return { heartRate: a.heartRate, spo2: a.spo2, o2Min: suitO2Minutes(), fatigue: a.fatigue, hydration: a.hydration, bodyTemp: a.bodyTemp }
}

function raise(key: string, on: boolean, level: Alert['level'], vital: Alert['vital'], text: string) {
  if (on && !active.has(key)) {
    active.add(key)
    const alert: Alert = { id: alertId++, metS: sim.metS, level, vital, text }
    ui.set((s) => ({ alerts: [...s.alerts.slice(-29), alert] }))
    notify(text, level)
  } else if (!on && active.has(key)) active.delete(key)
}

export const activeAlerts = () => active.size

export function stepHealth(w: World, dt: number) {
  const r = readings()
  sinceSample += dt
  if (sinceSample >= SAMPLE_S) {
    sinceSample = 0
    for (const k of Object.keys(history) as Vital[]) { history[k].push(r[k]); if (history[k].length > KEEP) history[k].shift() }
  }
  const L = ui.get().alertLimits
  const outside = sim.astro.evaS > 0 && Math.hypot(sim.astro.x - airlock(w)[0], sim.astro.z - airlock(w)[1]) > 4
  // small hysteresis so a reading hovering on a limit does not flood the log
  const over = (key: string, v: number, lim: number, sign: 1 | -1) => { const d = sign * (v - lim); return active.has(key) ? d > -0.02 * Math.abs(lim) : d > 0 }
  raise('hr', over('hr', r.heartRate, L.heartRateHigh, 1), 'caution', 'heartRate', `Heart rate ${r.heartRate.toFixed(0)} bpm is above the ${L.heartRateHigh} bpm limit.`)
  raise('spo2', over('spo2', r.spo2, L.spo2Low, -1), 'warning', 'spo2', `SpO₂ ${r.spo2.toFixed(1)} % is below ${L.spo2Low} %.`)
  raise('fat', over('fat', r.fatigue, L.fatigueHigh, 1), 'caution', 'fatigue', `Fatigue ${r.fatigue.toFixed(0)} is above ${L.fatigueHigh}. Plan a rest stop.`)
  raise('hyd', over('hyd', r.hydration, L.hydrationLow, -1), 'caution', 'hydration', `Hydration ${r.hydration.toFixed(0)} % is below ${L.hydrationLow} %.`)
  raise('temp', over('temp', r.bodyTemp, L.bodyTempHigh, 1), 'caution', 'bodyTemp', `Body temperature ${r.bodyTemp.toFixed(1)} °C is above ${L.bodyTempHigh} °C.`)
  raise('o2', outside && over('o2', r.o2Min, L.o2MinLow, -1), 'warning', 'o2Min', `Suit O₂ is down to ${r.o2Min.toFixed(0)} minutes at the current rate.`)
  if (outside) {
    const b = returnBudget(w)
    raise('return', b.margin < 0, 'warning', 'return', `Walking home is no longer safe: it needs ${b.needed.toFixed(0)} g O₂ with reserve, the suit has ${b.available.toFixed(0)} g.`)
    raise('return-soon', b.margin >= 0 && b.margin < 40, 'caution', 'return', `Turn-back point is close: ${b.margin.toFixed(0)} g O₂ of margin left.`)
  } else { raise('return', false, 'warning', 'return', ''); raise('return-soon', false, 'caution', 'return', '') }
}

export function resetHealth() {
  for (const k of Object.keys(history) as Vital[]) history[k] = []
  active.clear()
  ui.set({ alerts: [] })
}
