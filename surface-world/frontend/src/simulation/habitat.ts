import { sim, ui } from '@/state/store'
import { lightingHour } from '@/simulation/Scene'
import type { World } from '@/simulation/terrain/heightfield'

/**
 * Habitat power (SIMULATED, documented parameters). A solar array follows the sun and loses output in
 * dust; a battery bank carries the base through the night; the rover charges at its dock. The numbers
 * are round planning values for a small crewed outpost, not a design of any real system.
 */
export const HAB = {
  arrayPeakW: 14000,          // array output at local noon in clear air
  batteryWh: 90000,           // usable battery bank
  reserveWh: 30000,           // bank level below which non-critical loads are shed
  loads: { lifesupport: 2400, quarters: 900, isru: 1600 } as Record<string, number>,
  roverChargeW: 900,          // dock charging rate into the rover battery
  dockRadiusM: 6,             // rover counts as docked within this distance of the charging pad
  /** fraction of sunlight reaching the panels; dust storms on Mars cut it sharply */
  transmission: { clear: 0.85, dust: 0.3 },
}

export interface HabitatSim { batteryWh: number; solarW: number; loadW: number; roverCharging: boolean; shed: boolean }
export const hab: HabitatSim = { batteryWh: HAB.batteryWh * 0.7, solarW: 0, loadW: 0, roverCharging: false, shed: false }

export const dockPosition = (w: World): [number, number] => [w.habitat[0] + 18, w.habitat[1] - 6]

/** Clear-sky sun factor 0..1 for a local hour (sunrise 6, sunset 18). */
export const sunFactor = (h: number) => Math.max(0, Math.sin((Math.PI * (h - 6)) / 12))

export function stepHabitat(w: World, dt: number) {
  const trans = HAB.transmission[ui.get().weather]
  hab.solarW = HAB.arrayPeakW * sunFactor(lightingHour()) * trans
  const [dx, dz] = dockPosition(w)
  const docked = Math.hypot(sim.rover.x - dx, sim.rover.z - dz) < HAB.dockRadiusM && Math.abs(sim.rover.speed) < 0.1
  hab.shed = hab.batteryWh < HAB.reserveWh
  hab.roverCharging = docked && !hab.shed && sim.rover.batteryWh < w.rover.battery_wh - 1
  // ISRU (oxygen production) is the first load shed when the bank runs low
  hab.loadW = HAB.loads.lifesupport + HAB.loads.quarters + (hab.shed ? 0 : HAB.loads.isru) + (hab.roverCharging ? HAB.roverChargeW : 0)
  hab.batteryWh = Math.min(HAB.batteryWh, Math.max(0, hab.batteryWh + ((hab.solarW - hab.loadW) * dt) / 3600))
  if (hab.roverCharging) sim.rover.batteryWh = Math.min(w.rover.battery_wh, sim.rover.batteryWh + (HAB.roverChargeW * 0.9 * dt) / 3600)
}

/** Hours until the bank reaches the shedding reserve at the current net draw (null when charging). */
export function habitatAutonomyH(): number | null {
  const net = hab.loadW - hab.solarW
  if (net <= 0) return null
  return Math.max(0, hab.batteryWh - HAB.reserveWh) / net
}

export function resetHabitat() { Object.assign(hab, { batteryWh: HAB.batteryWh * 0.7, roverCharging: false, shed: false }) }
