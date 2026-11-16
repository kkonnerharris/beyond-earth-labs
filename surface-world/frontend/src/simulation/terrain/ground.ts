import { decodeF32 } from '@/services/api'
import type { World } from './heightfield'

const R_MARS = 3_396_190

/**
 * Ground height anywhere in the scene, in scene units (y up).
 * Inside the 2 km map it is the HiRISE heightfield. Outside it is the surface of the 80 km backdrop
 * exactly as Surroundings.tsx draws it: the same 250 m grid, the same edge pinning, the same triangles
 * and the same drop for Mars' curvature. A line placed with this sits on the drawn ground, not inside it.
 */
export function makeGround(world: World): (x: number, z: number) => number {
  const s = world.real?.surround
  const half = world.size / 2
  if (!s) return (x, z) => world.heightAt(x, z)
  const src = decodeF32(s.heights_b64), sn = s.n, size = s.size_m, h = size / 2, scell = size / (sn - 1)
  const cell = half / Math.max(1, Math.round(half / 250))
  const n = Math.round(size / cell) + 1
  const eps = cell * 0.01
  const sample = (x: number, z: number) => {
    const fc = Math.min(Math.max((x + h) / scell, 0), sn - 1.001), fr = Math.min(Math.max((z + h) / scell, 0), sn - 1.001)
    const r0 = Math.floor(fr), c0 = Math.floor(fc), a = fr - r0, b = fc - c0
    return (src[r0 * sn + c0] * (1 - b) + src[r0 * sn + c0 + 1] * b) * (1 - a) + (src[(r0 + 1) * sn + c0] * (1 - b) + src[(r0 + 1) * sn + c0 + 1] * b) * a
  }
  const vertex = (i: number, j: number) => {
    const x = j * cell - h, z = i * cell - h
    const onEdge = Math.abs(x) <= half + eps && Math.abs(z) <= half + eps
    return (onEdge ? world.heightAt(x, z) : sample(x, z)) - (x * x + z * z) / (2 * R_MARS)
  }
  return (x, z) => {
    if (Math.abs(x) <= half && Math.abs(z) <= half) return world.heightAt(x, z)
    const fj = Math.min(Math.max((x + h) / cell, 0), n - 1.0001), fi = Math.min(Math.max((z + h) / cell, 0), n - 1.0001)
    const i = Math.floor(fi), j = Math.floor(fj), u = fj - j, v = fi - i
    const a = vertex(i, j), b = vertex(i, j + 1), c = vertex(i + 1, j), d = vertex(i + 1, j + 1)
    return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d)
  }
}
