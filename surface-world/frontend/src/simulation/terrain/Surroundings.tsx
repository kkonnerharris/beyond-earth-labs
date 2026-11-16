import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { decodeF32 } from '@/services/api'
import type { World } from './heightfield'

const R_MARS = 3_396_190

/**
 * NASA data: an 80 km square of real Jezero terrain around the playable map (Mars 2020 Science
 * Investigation CTX DEM + orthoimage), so the horizon is the actual delta and crater rim.
 * Heights follow Mars' curvature (a drop of d^2 / 2R), which hides distant ground the way it would
 * on Mars. The playable HiRISE map sits in a hole cut exactly to its edges.
 */
export function Surroundings({ world }: { world: World }) {
  const s = world.real?.surround
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    if (!s) return
    let alive = true
    new THREE.TextureLoader().load(s.image, (t) => {
      if (!alive) return
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 8
      setTex(t)
    })
    return () => { alive = false }
  }, [s])
  const geom = useMemo(() => {
    if (!s) return null
    // Resample to a grid whose lines fall exactly on the playable map's edges (250 m cells for a 2 km map),
    // cut a hole where the HiRISE map is, and pin the edge vertices to HiRISE heights so the seam is exact.
    const src = decodeF32(s.heights_b64), sn = s.n, size = s.size_m, h = size / 2, scell = size / (sn - 1)
    const half = world.size / 2
    const cell = half / Math.max(1, Math.round(half / 250))
    const n = Math.round(size / cell) + 1
    const sample = (x: number, z: number) => {
      const fc = THREE.MathUtils.clamp((x + h) / scell, 0, sn - 1.001), fr = THREE.MathUtils.clamp((z + h) / scell, 0, sn - 1.001)
      const r0 = Math.floor(fr), c0 = Math.floor(fc), a = fr - r0, b = fc - c0
      return (src[r0 * sn + c0] * (1 - b) + src[r0 * sn + c0 + 1] * b) * (1 - a) + (src[(r0 + 1) * sn + c0] * (1 - b) + src[(r0 + 1) * sn + c0 + 1] * b) * a
    }
    const eps = cell * 0.01
    const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const k = i * n + j, x = j * cell - h, z = i * cell - h
      const onEdge = Math.abs(x) <= half + eps && Math.abs(z) <= half + eps
      pos[k * 3] = x
      pos[k * 3 + 1] = (onEdge ? world.heightAt(x, z) : sample(x, z)) - (x * x + z * z) / (2 * R_MARS)
      pos[k * 3 + 2] = z
      uv[k * 2] = j / (n - 1); uv[k * 2 + 1] = 1 - i / (n - 1)
    }
    const idx: number[] = []
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) {
      const cx = (j + 0.5) * cell - h, cz = (i + 0.5) * cell - h
      if (Math.abs(cx) < half && Math.abs(cz) < half) continue   // the HiRISE map covers this cell
      const a = i * n + j, b = a + 1, c = a + n, d = c + 1
      idx.push(a, c, b, b, c, d)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }, [s, world.size])
  if (!geom || !tex) return null
  return (
    <mesh geometry={geom} raycast={() => null}>
      <meshStandardMaterial map={tex} roughness={1} metalness={0} />
    </mesh>
  )
}
