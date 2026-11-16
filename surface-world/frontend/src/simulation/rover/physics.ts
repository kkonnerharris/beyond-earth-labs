import * as THREE from 'three'
import type { Route } from '@/services/api'
import { sim, type RoverSim } from '@/state/store'
import type { World } from '@/simulation/terrain/heightfield'

export const G_MARS = 3.71
export const WHEELBASE = 2.6

export interface DriveInput { throttle: number; steer: number; brake: boolean }

/** Same energy model as backend/simulation/rover_model.py (simulation parameters, not real rover specs). */
export function segmentEnergyWh(w: World, distM: number, dhM: number, terrainFactor: number): number {
  if (distM <= 0) return 0
  const p = w.rover
  const grade = Math.abs(dhM) / distM
  const rolling = distM * p.flat_wh_per_m * terrainFactor * (1 + 2 * grade)
  const climb = (Math.max(0, dhM) * p.mass_kg * G_MARS) / p.drivetrain_eff / 3600
  return rolling + climb
}

const _n = new THREE.Vector3()
const _f = new THREE.Vector3()
const _z = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()

/** Average terrain normal under the rover footprint, so the body pitches/rolls with the ground. */
function footprintNormal(w: World, x: number, z: number, heading: number, out: THREE.Vector3) {
  const c = Math.cos(heading), s = Math.sin(heading)
  out.set(0, 0, 0)
  const tmp = new THREE.Vector3()
  for (const [a, b] of [[1.4, 0.9], [1.4, -0.9], [-1.4, 0.9], [-1.4, -0.9], [0, 0]]) {
    out.add(w.normalAt(x + a * c - b * s, z + a * s + b * c, tmp))
  }
  return out.normalize()
}

export function placeRover(w: World, r: RoverSim) {
  r.y = w.heightAt(r.x, r.z)
  footprintNormal(w, r.x, r.z, r.heading, _n)
  _f.set(Math.cos(r.heading), 0, Math.sin(r.heading))
  _f.sub(_n.clone().multiplyScalar(_f.dot(_n))).normalize()
  _z.crossVectors(_f, _n).normalize()
  _m.makeBasis(_f, _n, _z)
  _q.setFromRotationMatrix(_m)
  r.quat = [_q.x, _q.y, _q.z, _q.w]
  r.slopeDeg = w.slopeAt(r.x, r.z)
}

/** One physics step. Mutates sim.rover; returns a blocking reason if motion was stopped. */
export function stepRover(w: World, dt: number, input: DriveInput): string | null {
  const r = sim.rover
  const p = w.rover
  sim.metS += dt

  r.steer += THREE.MathUtils.clamp(input.steer * 0.55 - r.steer, -2.5 * dt, 2.5 * dt)

  const hz = w.hazardAt(r.x, r.z)
  r.hazard = hz ? hz.label : null
  const fwdGrade = (w.heightAt(r.x + Math.cos(r.heading) * 2, r.z + Math.sin(r.heading) * 2) - w.heightAt(r.x, r.z)) / 2
  const uphill = Math.max(0, fwdGrade * Math.sign(r.speed || input.throttle || 1))
  let vmax = p.max_speed_mps * THREE.MathUtils.clamp(1 - uphill * 2.2, 0.35, 1)
  if (hz?.kind === 'loose_regolith') vmax *= 0.6
  if (hz?.kind === 'rock_field') vmax *= 0.75
  if (r.batteryWh <= 0) vmax = 0

  if (input.brake) {
    r.speed -= Math.sign(r.speed) * Math.min(Math.abs(r.speed), 5 * dt)
  } else if (input.throttle !== 0) {
    r.speed += input.throttle * 1.6 * dt
  } else {
    r.speed *= Math.exp(-1.8 * dt)
    if (Math.abs(r.speed) < 0.02) r.speed = 0
  }
  r.speed = THREE.MathUtils.clamp(r.speed, -1.5, vmax)

  const nh = r.heading + (r.speed / WHEELBASE) * Math.tan(r.steer) * dt
  const nx = r.x + Math.cos(nh) * r.speed * dt
  const nz = r.z + Math.sin(nh) * r.speed * dt

  let blocked: string | null = null
  if (!w.inBounds(nx, nz)) blocked = 'Edge of the mapped region'
  else if (w.slopeAt(nx, nz) > p.max_slope_deg && w.slopeAt(nx, nz) > w.slopeAt(r.x, r.z)) blocked = `Too steep (> ${p.max_slope_deg}° rover limit)`
  else {
    for (const o of w.obstacles) {
      const dNew = Math.hypot(nx - o.x, nz - o.z)
      if (dNew < o.r + p.radius_m * 0.9 && dNew < Math.hypot(r.x - o.x, r.z - o.z)) { blocked = `Obstacle ahead (${o.label})`; break }
    }
  }

  const y0 = r.y, x0 = r.x, z0 = r.z
  if (blocked) {
    r.speed = 0
  } else {
    r.heading = nh
    r.x = nx
    r.z = nz
  }
  placeRover(w, r)

  const dist = Math.hypot(r.x - x0, r.z - z0)
  if (dist > 0) {
    const tf = hz?.kind === 'loose_regolith' ? p.sand_energy_factor : hz?.kind === 'rock_field' ? p.rock_energy_factor : 1
    const e = segmentEnergyWh(w, dist, r.y - y0, tf)
    r.energyUsedWh += e
    r.batteryWh -= e
    r.odometer += dist
  }
  r.batteryWh = THREE.MathUtils.clamp(r.batteryWh + ((p.rtg_charge_w - p.hotel_w) * dt) / 3600, 0, p.battery_wh)
  r.scanning = Math.max(0, r.scanning - dt)
  r.blocked = blocked
  return blocked
}

/** Pure-pursuit path follower: turns the route into throttle/steer commands for stepRover. */
export function autopilot(route: Route, maxSpeed: number): { input: DriveInput; arrived: boolean; remainingM: number } {
  const r = sim.rover
  const pts = route.path
  // advance the progress index to the closest point ahead
  let i = sim.routeIndex
  let best = Infinity
  for (let k = i; k < Math.min(pts.length, i + 25); k++) {
    const d = Math.hypot(pts[k][0] - r.x, pts[k][2] - r.z)
    if (d < best) { best = d; i = k }
  }
  sim.routeIndex = i

  let remaining = 0
  for (let k = i; k < pts.length - 1; k++) remaining += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][2] - pts[k][2])
  remaining += best

  const end = pts[pts.length - 1]
  if (Math.hypot(end[0] - r.x, end[2] - r.z) < 2.2) return { input: { throttle: 0, steer: 0, brake: true }, arrived: true, remainingM: 0 }

  const look = THREE.MathUtils.clamp(3 + Math.abs(r.speed) * 1.5, 3, 9)
  let j = i, acc = 0
  while (j < pts.length - 1 && acc < look) {
    acc += Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][2] - pts[j][2])
    j++
  }
  const target = pts[j]
  const desired = Math.atan2(target[2] - r.z, target[0] - r.x)
  let err = desired - r.heading
  err = Math.atan2(Math.sin(err), Math.cos(err))
  const steer = THREE.MathUtils.clamp(err * 1.8, -1, 1)
  const vTarget = Math.min(maxSpeed * 0.85, remaining < 10 ? 1 + remaining * 0.25 : Infinity) * (Math.abs(err) > 0.9 ? 0.25 : 1)
  const throttle = THREE.MathUtils.clamp((vTarget - r.speed) * 1.2, -1, 1)
  return { input: { throttle, steer, brake: false }, arrived: false, remainingM: remaining }
}
