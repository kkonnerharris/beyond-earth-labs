import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { sim } from '@/state/store'
import type { World } from '@/simulation/terrain/heightfield'
import { useOptionalTexture, useOrtho } from '@/simulation/terrain/Terrain'

function hash(i: number) {
  const s = Math.sin(i * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

type Tree = { x: number; z: number; h: number; r: number; turn: number; tilt: number; shade: number }

const SPACING = 14      // one candidate tree per SPACING x SPACING metres of forest
const CLEARING = 42     // no trees this close to the camp, the landing zone, a named site or the rover's start

/**
 * The forest of the Earth site, taken from the aerial photograph.
 *
 * Where: a tree stands wherever the photograph shows tree canopy. Where it shows bare rock, a road or a
 * field, nothing is planted.
 * Colour: each crown is painted with the photograph itself. A point on a crown takes the colour of the
 * photograph directly above it, so the treetops seen here are the real treetops, in their real colours,
 * lifted off the ground. A photo-scanned leaf texture adds the grain a 0.5 m photograph cannot hold.
 * Shape: illustrative. These are not surveyed trees, and vehicles pass through them.
 */
export function Trees({ world }: { world: World }) {
  const url = world.real?.planet === 'earth' ? world.real.ortho : null
  const ortho = useOrtho(url)
  const leaf = useOptionalTexture('/textures/earth/grass.jpg')
  const bark = useOptionalTexture('/textures/earth/bark.jpg')
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
        const size = 0.75 + 0.6 * hash(k * 3.1 + 5)
        out.push({ x, z, h: 14 * size, r: 5.2 * size, turn: hash(k * 5.3) * Math.PI * 2, tilt: (hash(k * 9.1) - 0.5) * 0.16,
                   shade: 0.86 + 0.28 * hash(k * 7.7) })
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
      const f = 0.72 + 0.5 * hash(Math.round(p.getX(i) * 31) + Math.round(p.getY(i) * 57) * 3 + Math.round(p.getZ(i) * 91) * 7)
      p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.9, p.getZ(i) * f)
    }
    g.computeVertexNormals()
    return g
  }, [])
  const trunk = useMemo(() => new THREE.CylinderGeometry(0.22, 0.36, 1, 7), [])

  const crownMat = useMemo(() => {
    if (!ortho || !leaf) return null
    const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 })
    m.customProgramCacheKey = () => 'tree-crown-photo'
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { tPhoto: { value: ortho }, tLeaf: { value: leaf }, uSize: { value: world.size } })
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTreePos;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vTreePos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vTreePos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tPhoto; uniform sampler2D tLeaf; uniform float uSize;\nvarying vec3 vTreePos;')
        .replace('#include <map_fragment>', `
// The aerial photograph, straight down: this point of the crown is the colour of the real treetop above it.
vec3 photo = texture2D(tPhoto, vec2(vTreePos.x / uSize + 0.5, 0.5 - vTreePos.z / uSize)).rgb;
// Leaf grain from a photo-scanned texture, from the top and from the side so the flanks do not smear.
vec3 lf = texture2D(tLeaf, vTreePos.xz / 2.4).rgb * 0.5 + texture2D(tLeaf, vec2(vTreePos.x + vTreePos.z, vTreePos.y) / 2.4).rgb * 0.5;
float grain = dot(lf, vec3(0.333)) / 0.30;
diffuseColor.rgb *= photo * mix(1.0, grain, 0.65) * 1.5;`)
    }
    return m
  }, [ortho, leaf, world.size])

  const trunkMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#8a7a6c', roughness: 1, metalness: 0 })
    if (bark) {
      const t = bark.clone()
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(2, 5)
      t.needsUpdate = true
      m.map = t
    }
    return m
  }, [bark])

  useLayoutEffect(() => {
    const c = canopy.current, t = trunks.current
    if (!c || !t || !trees.length) return
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3()
    const e = new THREE.Euler(), col = new THREE.Color()
    trees.forEach((tr, i) => {
      const y = world.heightAt(tr.x, tr.z)
      q.setFromEuler(e.set(tr.tilt, tr.turn, tr.tilt * 0.6))
      c.setMatrixAt(i, m.compose(p.set(tr.x, y + tr.h * 0.66, tr.z), q, s.set(tr.r, tr.h * 0.44, tr.r)))
      c.setColorAt(i, col.setScalar(tr.shade))
      t.setMatrixAt(i, m.compose(p.set(tr.x, y + tr.h * 0.24, tr.z), q, s.set(1.3, tr.h * 0.5, 1.3)))
    })
    c.instanceMatrix.needsUpdate = true
    t.instanceMatrix.needsUpdate = true
    if (c.instanceColor) c.instanceColor.needsUpdate = true
    c.computeBoundingSphere(); t.computeBoundingSphere()
  }, [trees, world, crownMat])

  if (!url || !trees.length || !crownMat) return null
  return (
    <group>
      <instancedMesh ref={canopy} key={`c${trees.length}`} args={[crown, crownMat, trees.length]} castShadow receiveShadow raycast={() => null} />
      <instancedMesh ref={trunks} key={`t${trees.length}`} args={[trunk, trunkMat, trees.length]} castShadow raycast={() => null} />
    </group>
  )
}
