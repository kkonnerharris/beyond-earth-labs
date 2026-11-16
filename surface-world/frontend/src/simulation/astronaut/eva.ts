import * as THREE from 'three'
import type { Route } from '@/services/api'
import { sim } from '@/state/store'
import type { World } from '@/simulation/terrain/heightfield'

/**
 * EVA astronaut model (SIMULATED; same parameters as backend/simulation/astronaut_model.py).
 * Metabolic rate drives oxygen (~14 kJ per gram O2), heart rate, fatigue and hydration. This is a
 * transparent educational model, not a physiological or medical model.
 */
const KJ_PER_G_O2 = 14

export function stepAstronaut(w: World, dt: number, route: Route | null, walking: boolean): 'arrived' | null {
  const a = sim.astro
  const p = w.astronaut
  let arrived: 'arrived' | null = null
  let grade = 0

  if (walking && route) {
    const pts = route.path
    // advance along the polyline at walking speed (kinematic: astronauts don't skid)
    const speed = p.walk_speed_mps * a.paceFactor
    let remaining = speed * dt
    while (remaining > 0 && a.pathIndex < pts.length - 1) {
      const nx = pts[a.pathIndex + 1][0], nz = pts[a.pathIndex + 1][2]
      const d = Math.hypot(nx - a.x, nz - a.z)
      if (d <= remaining) {
        a.x = nx; a.z = nz; remaining -= d; a.pathIndex++
      } else {
        a.x += ((nx - a.x) / d) * remaining
        a.z += ((nz - a.z) / d) * remaining
        remaining = 0
      }
      const target = Math.atan2(nz - a.z, nx - a.x)
      let err = target - a.heading
      err = Math.atan2(Math.sin(err), Math.cos(err))
      a.heading += THREE.MathUtils.clamp(err, -3 * dt, 3 * dt)
    }
    const y0 = a.y
    a.y = w.heightAt(a.x, a.z)
    const moved = speed * dt
    grade = moved > 0 ? (a.y - y0) / moved : 0
    a.speed = speed
    a.state = 'walking'
    a.phase += dt * 6.2
    if (a.pathIndex >= pts.length - 1) { a.state = 'idle'; a.speed = 0; arrived = 'arrived' }
  } else {
    a.y = w.heightAt(a.x, a.z)
    a.speed = 0
    a.state = 'idle'
  }

  // metabolic model
  const target = a.state === 'walking' ? p.rest_w + (p.walk_w - p.rest_w) * a.paceFactor + Math.max(0, grade) * p.grade_w_per_unit : p.rest_w
  a.metabolicW += (target - a.metabolicW) * Math.min(1, dt * 0.5)
  // EVA = more than 4 m from the airlock door (habitat + 12.8 m east); inside it the suit is on umbilical
  const outside = Math.hypot(a.x - (w.habitat[0] + 12.8), a.z - w.habitat[1]) > 4
  if (outside) {
    a.evaS += dt
    a.o2G = Math.max(0, a.o2G - (a.metabolicW * dt) / 1000 / KJ_PER_G_O2 - a.leakGps * dt)
    a.suitWh = Math.max(0, a.suitWh - (p.suit_power_w * dt) / 3600)
    a.hydration = Math.max(0, a.hydration - dt * (a.state === 'walking' ? 0.004 : 0.0015))
  } else {
    // inside the habitat airlock: suit recharges, crew rehydrates
    a.o2G = Math.min(p.suit_o2_g, a.o2G + dt * 2)
    a.suitWh = Math.min(p.suit_power_wh, a.suitWh + dt * 0.5)
    a.hydration = Math.min(100, a.hydration + dt * 0.05)
  }
  const exertion = (a.metabolicW - p.rest_w) / (p.walk_w - p.rest_w)      // 0 rest, 1 flat walking
  a.heartRate += (68 + exertion * 32 + (100 - a.hydration) * 0.15 + a.fatigue * 0.12 - a.heartRate) * Math.min(1, dt * 0.3)
  a.fatigue = THREE.MathUtils.clamp(a.fatigue + dt * (exertion > 0.6 ? 0.012 * exertion : -0.006), 0, 100)
  a.spo2 = 98 - Math.max(0, exertion - 1.4) * 1.5
  a.bodyTemp = 36.8 + exertion * 0.25
  return arrived
}

export function suitO2Minutes(): number {
  const a = sim.astro
  return a.o2G / ((a.metabolicW / 1000 / KJ_PER_G_O2 + a.leakGps) * 60)
}

export function placeAstronautAtHabitat(w: World) {
  const a = sim.astro
  a.x = w.habitat[0] + 13.5
  a.z = w.habitat[1] + 2
  a.y = w.heightAt(a.x, a.z)
  a.heading = 0
  a.pathIndex = 0
  a.state = 'idle'
  Object.assign(a, { leakGps: 0, paceFactor: 1, o2G: w.astronaut.suit_o2_g, suitWh: w.astronaut.suit_power_wh, evaS: 0, heartRate: 72, fatigue: 8, hydration: 100, metabolicW: w.astronaut.rest_w })
}
