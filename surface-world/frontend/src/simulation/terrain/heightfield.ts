import * as THREE from 'three'
import { decodeF32, type AstronautParams, type Hazard, type Provenance, type RealData, type Region, type Rock, type RoverParams, type Site, type TerrainResponse } from '@/services/api'

/**
 * The world as the simulation sees it. Heights use the same bilinear interpolation as the backend
 * planner (backend/geospatial/terrain.py), so the rover drives on exactly the surface the route
 * was planned over. Frame: x = east, z = south, y = up, metres, origin at map centre.
 */
export class World {
  readonly n: number
  readonly size: number
  readonly cell: number
  readonly heights: Float32Array
  readonly slope: Float32Array
  /** Per-cell traversal penalty from the backend cost grid (hazard zones + measured roughness). */
  readonly hazard: Float32Array
  /** 0..1 roughness measured from the 1 m HiRISE slope (real terrain only). */
  readonly rough: Float32Array | null
  readonly region: Region
  /** Present when the terrain is real NASA data: sources, DOIs, region metadata. */
  readonly real: RealData | null
  /** Add to a height to get true elevation (m, MOLA areoid). 0 for procedural terrain. */
  readonly datum: number
  /** Perseverance and Ingenuity paths in this region (NASA), when imported. */
  readonly m20: RealData['m20']
  readonly rocks: Rock[]
  readonly obstacles: { x: number; z: number; r: number; label: string }[]
  readonly hazards: Hazard[]
  readonly sites: Site[]
  readonly habitat: [number, number]
  readonly landing: [number, number]
  readonly provenance: Provenance
  readonly rover: RoverParams
  readonly astronaut: AstronautParams

  constructor(t: TerrainResponse) {
    this.n = t.n
    this.size = t.size_m
    this.cell = t.cell_m
    this.heights = decodeF32(t.heights_b64)
    this.slope = decodeF32(t.slope_b64)
    this.hazard = decodeF32(t.hazard_b64)
    this.rough = t.rough_b64 ? decodeF32(t.rough_b64) : null
    this.region = t.region
    this.real = t.real
    this.datum = t.real?.region.datum_offset_m ?? 0
    this.m20 = t.real?.m20 ?? null
    this.rocks = t.rocks
    this.hazards = t.hazards
    this.sites = t.sites
    this.habitat = t.habitat
    this.landing = t.landing_zone
    this.provenance = t.provenance
    this.rover = t.rover
    this.astronaut = t.astronaut
    this.obstacles = [
      ...t.rocks.filter((r) => r.r >= 0.8).map((r) => ({ ...r, label: 'boulder' })),
      { x: t.habitat[0], z: t.habitat[1], r: 11, label: 'habitat' },
      { x: t.landing_zone[0] + 4, z: t.landing_zone[1], r: 4.5, label: 'lander' },
    ]
  }

  private grid(x: number, z: number): [number, number] {
    const h = this.size / 2
    return [(z + h) / this.cell, (x + h) / this.cell]
  }

  private sample(arr: Float32Array, x: number, z: number): number {
    let [r, c] = this.grid(x, z)
    r = Math.min(Math.max(r, 0), this.n - 1.0001)
    c = Math.min(Math.max(c, 0), this.n - 1.0001)
    const r0 = Math.floor(r), c0 = Math.floor(c)
    const fr = r - r0, fc = c - c0
    const n = this.n
    const top = arr[r0 * n + c0] * (1 - fc) + arr[r0 * n + c0 + 1] * fc
    const bot = arr[(r0 + 1) * n + c0] * (1 - fc) + arr[(r0 + 1) * n + c0 + 1] * fc
    return top * (1 - fr) + bot * fr
  }

  heightAt(x: number, z: number): number { return this.sample(this.heights, x, z) }
  slopeAt(x: number, z: number): number { return this.sample(this.slope, x, z) }

  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = this.cell * 0.75
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z)
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e)
    return out.set(-hx, 2 * e, -hz).normalize()
  }

  inBounds(x: number, z: number, margin = 6): boolean {
    const h = this.size / 2 - margin
    return x >= -h && x <= h && z >= -h && z <= h
  }

  /** Hazard zone the point is inside (strongest), if any. */
  hazardAt(x: number, z: number): Hazard | null {
    let best: Hazard | null = null
    let bestW = 0
    for (const h of this.hazards) {
      const d = Math.hypot(x - h.x, z - h.z) / h.r
      if (d < 0.8) {
        const w = (1 - d) * h.penalty
        if (w > bestW) { bestW = w; best = h }
      }
    }
    return best
  }
}
