import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { sim } from '@/state/store'
import type { World } from '@/simulation/terrain/heightfield'

function hash(i: number) {
  const s = Math.sin(i * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

type Tree = { x: number; z: number; h: number; r: number; color: THREE.Color; lean: number }

const SPACING = 13      // one candidate tree per SPACING x SPACING metres of forest
const CLEARING = 42     // no trees this close to the camp, the landing zone, a named site or the rover's start

/**
 * The forest of the Earth site. The ground picture is a real aerial photograph, and from the height
 * of a rover a photograph of treetops lies flat. So a tree is stood up wherever the photograph shows
 * tree canopy, and each one takes its colour from the photograph at that spot: where the photo shows
 * bare rock, a road or a field, nothing is planted. The tree shapes are illustrative, not surveyed
 * trees, and vehicles pass through them.
 */
export function Trees({ world }: { world: World }) {
  const url = world.real?.planet === 'earth' ? world.real.ortho : null
  const [trees, setTrees] = useState<Tree[]>([])
  const canopy = useRef<THREE.InstancedMesh>(null)
  const trunks = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    if (!url) return
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (!alive) return
      const N = 1024
      const c = document.createElement('canvas')
      c.width = N; c.height = N
      const g = c.getContext('2d', { willReadFrequently: true })!
      g.drawImage(img, 0, 0, N, N)
      const px = g.getImageData(0, 0, N, N).data
      const half = world.size / 2
      const keepClear: [number, number][] = [world.habitat, world.landing, [sim.rover.x, sim.rover.z], [sim.astro.x, sim.astro.z], ...world.sites.map((s) => [s.x, s.z] as [number, number])]
      const out: Tree[] = []
      const n = Math.floor(world.size / SPACING)
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const k = i * n + j
        const x = -half + (j + 0.15 + 0.7 * hash(k * 1.7 + 3)) * SPACING
        const z = -half + (i + 0.15 + 0.7 * hash(k * 2.3 + 11)) * SPACING
        if (Math.abs(x) > half - 6 || Math.abs(z) > half - 6) continue
        if (keepClear.some(([cx, cz]) => Math.hypot(x - cx, z - cz) < CLEARING)) continue
        if (world.slopeAt(x, z) > 38) continue                       // bluff faces are rock
        const u = Math.min(N - 1, Math.max(0, Math.round(((x + half) / world.size) * N)))
        const v = Math.min(N - 1, Math.max(0, Math.round(((z + half) / world.size) * N)))
        const o = (v * N + u) * 4
        const r = px[o], gr = px[o + 1], b = px[o + 2]
        // Canopy in the photograph: green is the strongest channel and the pixel is not pale (rock, road, dry field).
        const green = gr > r * 1.04 && gr > b * 1.12
        const autumn = r > gr && r > b * 1.35 && r < 190               // turning leaves are still trees
        if (!(green || autumn) || r + gr + b > 470) continue
        // The colour is lifted a little: a crown seen from the side catches more light than its picture from above shows.
        const size = 0.75 + 0.6 * hash(k * 3.1 + 5)
        out.push({ x, z, h: 13 * size, r: 4.6 * size, lean: hash(k * 5.3) * Math.PI * 2,
                   color: new THREE.Color(r / 255, gr / 255, b / 255).convertSRGBToLinear().multiplyScalar(1.25 + 0.45 * hash(k * 7.7)) })
      }
      setTrees(out)
    }
    img.src = url
    return () => { alive = false }
  }, [url, world])

  const crown = useMemo(() => {
    // A lumpy crown: an icosahedron pushed in and out so no two silhouettes line up.
    const g = new THREE.IcosahedronGeometry(1, 1)
    const p = g.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const f = 0.82 + 0.32 * hash(Math.round(p.getX(i) * 31) + Math.round(p.getY(i) * 57) * 3 + Math.round(p.getZ(i) * 91) * 7)
      p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.9, p.getZ(i) * f)
    }
    g.computeVertexNormals()
    return g
  }, [])
  const trunk = useMemo(() => new THREE.CylinderGeometry(0.22, 0.34, 1, 6), [])

  useLayoutEffect(() => {
    const c = canopy.current, t = trunks.current
    if (!c || !t || !trees.length) return
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    trees.forEach((tr, i) => {
      const y = world.heightAt(tr.x, tr.z)
      q.setFromAxisAngle(up, tr.lean)
      c.setMatrixAt(i, m.compose(p.set(tr.x, y + tr.h * 0.66, tr.z), q, s.set(tr.r, tr.h * 0.42, tr.r)))
      c.setColorAt(i, tr.color)
      t.setMatrixAt(i, m.compose(p.set(tr.x, y + tr.h * 0.24, tr.z), q, s.set(1.3, tr.h * 0.5, 1.3)))
    })
    c.instanceMatrix.needsUpdate = true
    t.instanceMatrix.needsUpdate = true
    if (c.instanceColor) c.instanceColor.needsUpdate = true
    c.computeBoundingSphere(); t.computeBoundingSphere()
  }, [trees, world])

  if (!url || !trees.length) return null
  return (
    <group>
      <instancedMesh ref={canopy} key={`c${trees.length}`} args={[crown, undefined, trees.length]} castShadow receiveShadow raycast={() => null}>
        <meshStandardMaterial roughness={1} metalness={0} />
      </instancedMesh>
      <instancedMesh ref={trunks} key={`t${trees.length}`} args={[trunk, undefined, trees.length]} castShadow raycast={() => null}>
        <meshStandardMaterial color="#4a3a2c" roughness={1} metalness={0} />
      </instancedMesh>
    </group>
  )
}
