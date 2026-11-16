import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Layer } from '@/state/store'
import { decodeF32 } from '@/services/api'
import type { World } from './heightfield'
import { computeSplat, makeTerrainMaterial } from './terrainMaterial'

// Deterministic per-vertex jitter so the ground has grain without a texture download.
function hash(i: number) {
  const s = Math.sin(i * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

const C = {
  dust: new THREE.Color('#c98a5a'),
  rust: new THREE.Color('#a5532f'),
  basalt: new THREE.Color('#5c2f20'),
  pale: new THREE.Color('#d9a477'),
}

/** Bilinear sampler over the THEMIS grid (row 0 = north edge), normalised 0..1. */
function themisSampler(world: World): (x: number, z: number) => number {
  const t = world.real!.themis!
  const v = decodeF32(t.values_b64)
  const m = t.n
  return (x, z) => {
    const fc = THREE.MathUtils.clamp((x / world.size + 0.5) * m - 0.5, 0, m - 1.001)
    const fr = THREE.MathUtils.clamp((z / world.size + 0.5) * m - 0.5, 0, m - 1.001)
    const r0 = Math.floor(fr), c0 = Math.floor(fc), a = fr - r0, b = fc - c0
    const val = (v[r0 * m + c0] * (1 - b) + v[r0 * m + c0 + 1] * b) * (1 - a) + (v[(r0 + 1) * m + c0] * (1 - b) + v[(r0 + 1) * m + c0 + 1] * b) * a
    return (val - t.min) / Math.max(1e-6, t.max - t.min)
  }
}

/** Dark blue -> purple -> orange -> pale yellow, for relative thermal brightness. */
const HEAT = ['#1b1a4a', '#6b2a7a', '#d2513a', '#f6b93b', '#fff1b8'].map((h) => new THREE.Color(h))
function heatColor(t: number, out: THREE.Color) {
  const stops = HEAT
  const f = THREE.MathUtils.clamp(t, 0, 1) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(f))
  return out.copy(stops[i]).lerp(stops[i + 1], f - i)
}

function slopeColor(deg: number, max: number, out: THREE.Color) {
  if (deg > max) return out.set('#2a0b07')
  const t = deg / max
  return out.setHSL(0.33 * (1 - t), 0.75, 0.42 + 0.08 * (1 - t))
}

/** Loads an optional texture; resolves to null if the file is missing (procedural colouring is used instead). */
export function useOptionalTexture(url: string, srgb = true): THREE.Texture | null {
  // srgb=false for normal maps (linear data)
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    let alive = true
    new THREE.TextureLoader().load(url, (t) => {
      if (!alive) return
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.anisotropy = 8
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      setTex(t)
    }, undefined, () => alive && setTex(null))
    return () => { alive = false }
  }, [url, srgb])
  return tex
}

const orthoCache = new Map<string, Promise<THREE.Texture | null>>()
/** The real-terrain orthoimage: one texture over the whole map, clamped, mipmapped. Loaded once and shared (the trees use it too). */
export function useOrtho(url: string | null): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    if (!url) { setTex(null); return }
    let alive = true
    let p = orthoCache.get(url)
    if (!p) {
      p = new Promise((resolve) => new THREE.TextureLoader().load(url, (t) => {
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
        t.anisotropy = 8
        t.colorSpace = THREE.SRGBColorSpace
        resolve(t)
      }, undefined, () => resolve(null)))
      orthoCache.set(url, p)
    }
    void p.then((t) => { if (alive) setTex(t) })
    return () => { alive = false }
  }, [url])
  return tex
}

export function Terrain({ world, layer, onPick }: { world: World; layer: Layer; onPick: (x: number, z: number, e: ThreeEvent<MouseEvent>) => void }) {
  // On Earth the close-up ground comes from photo-scanned textures of real forest floor, grass and rock.
  const onEarth = world.real?.planet === 'earth'
  const regolith = useOptionalTexture(onEarth ? '/textures/earth/ground.jpg' : '/textures/regolith.jpg')
  const regolithN = useOptionalTexture(onEarth ? '/textures/earth/ground_n.jpg' : '/textures/regolith_n.jpg', false)
  const sand = useOptionalTexture(onEarth ? '/textures/earth/grass.jpg' : '/textures/sand.jpg')
  const sandN = useOptionalTexture(onEarth ? '/textures/earth/grass_n.jpg' : '/textures/sand_n.jpg', false)
  const cliff = useOptionalTexture(onEarth ? '/textures/earth/rock.jpg' : '/textures/cliff.jpg')
  const ortho = useOrtho(world.real?.ortho ?? null)
  const orthoReady = !world.real || !!ortho
  const splatMat = useMemo(() => (regolith && regolithN && sand && sandN && cliff && orthoReady
    ? makeTerrainMaterial({ regolith, regolithN, sand, sandN, cliff, ortho, orthoRgb: world.real?.planet === 'earth', size: world.size }) : null), [regolith, regolithN, sand, sandN, cliff, ortho, orthoReady, world.size, world.real])
  const textured = !!regolith && layer === 'natural'
  const splatted = !!splatMat && layer === 'natural'
  const geom = useMemo(() => {
    const { n, cell, size, heights } = world
    const h = size / 2
    const pos = new Float32Array(n * n * 3)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const k = i * n + j
        pos[k * 3] = j * cell - h
        pos[k * 3 + 1] = heights[k]
        pos[k * 3 + 2] = i * cell - h
      }
    }
    // world-space UVs: one texture tile per 9 m, so detail density is constant across the map
    const uv = new Float32Array(n * n * 2)
    for (let k = 0; k < n * n; k++) { uv[k * 2] = pos[k * 3] / 9; uv[k * 2 + 1] = pos[k * 3 + 2] / 9 }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6)
    let p = 0
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < n - 1; j++) {
        const a = i * n + j, b = a + 1, c = a + n, d = c + 1
        idx[p++] = a; idx[p++] = c; idx[p++] = b
        idx[p++] = b; idx[p++] = c; idx[p++] = d
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    const sandZones = world.hazards.filter((hz) => hz.kind === 'loose_regolith')
    g.setAttribute('splat', new THREE.BufferAttribute(computeSplat(n, cell, size, world.slope, sandZones), 3))
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }, [world])

  // Recolour for the selected map layer.
  useEffect(() => {
    const { n, heights, slope, rover, rough } = world
    const themis = layer === 'thermal' && world.real?.themis ? themisSampler(world) : null
    const col = geom.getAttribute('color') as THREE.BufferAttribute
    let min = Infinity, max = -Infinity
    for (const v of heights) { if (v < min) min = v; if (v > max) max = v }
    const c = new THREE.Color()
    const tmp = new THREE.Color()
    for (let k = 0; k < n * n; k++) {
      const s = slope[k]
      if (layer === 'slope') {
        slopeColor(s, rover.max_slope_deg, c)
      } else if (themis) {
        const x = (k % n) * world.cell - world.size / 2
        const z = Math.floor(k / n) * world.cell - world.size / 2
        heatColor(themis(x, z), c)
      } else if (textured && world.real) {
        c.setRGB(1, 1, 1)   // the orthoimage carries all colour and shading
      } else if (textured) {
        // texture carries colour and grain; vertex colour only shades by slope/height for macro variation
        const ht = (heights[k] - min) / (max - min)
        const j = hash(k)
        const lum = 0.92 + ht * 0.16 + (j - 0.5) * 0.08 - Math.max(0, s - 14) / 45
        c.setRGB(lum, lum * 0.97, lum * 0.94)
      } else {
        const ht = (heights[k] - min) / (max - min)
        const j = hash(k)
        c.copy(C.rust).lerp(C.dust, THREE.MathUtils.clamp(0.25 + ht * 0.7 - s / 40, 0, 1))
        c.lerp(C.basalt, THREE.MathUtils.clamp((s - 12) / 20, 0, 0.85))
        c.lerp(C.pale, j * 0.12)
        c.multiplyScalar(0.92 + j * 0.12)
        if (layer === 'hazard') {
          const x = (k % n) * world.cell - world.size / 2
          const z = Math.floor(k / n) * world.cell - world.size / 2
          const hz = world.hazardAt(x, z)
          c.lerp(tmp.set('#3a2a24'), 0.55)
          if (s > rover.max_slope_deg) c.set('#5a0d06')
          else if (rough) {
            // measured: roughness from the 1 m HiRISE slope; annotated steep zones tinted
            const p = rough[k]
            if (p > 0.55) c.lerp(tmp.set('#fc3d21'), 0.6)
            else if (p > 0.12 || s > 15) c.lerp(tmp.set('#f6b93b'), 0.25 + Math.max(p, s > 15 ? 0.4 : 0) * 0.5)
            else if (hz) c.lerp(tmp.set('#b07cff'), 0.35)
          } else if (hz) c.lerp(tmp.set(hz.kind === 'loose_regolith' ? '#f6b93b' : hz.kind === 'rock_field' ? '#fc3d21' : '#b07cff'), 0.55)
          else if (s > 15) c.lerp(tmp.set('#f6b93b'), 0.35)
        }
      }
      col.setXYZ(k, c.r, c.g, c.b)
    }
    col.needsUpdate = true
  }, [geom, layer, world, textured])

  const down = useRef<[number, number] | null>(null)
  return (
    <mesh geometry={geom} receiveShadow castShadow={false}
      onPointerDown={(e) => { down.current = [e.clientX, e.clientY] }}
      onClick={(e) => {
        const d = down.current
        if (d && Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 5) return   // was a drag, not a click
        e.stopPropagation()
        onPick(e.point.x, e.point.z, e)
      }}>
      {splatted
        ? <primitive object={splatMat!} attach="material" />
        : <meshStandardMaterial key={textured ? 'tex' : 'plain'} vertexColors roughness={0.96} metalness={0.02}
            map={textured ? regolith : null} bumpMap={textured ? regolith : null} bumpScale={1.2} />}
    </mesh>
  )
}
