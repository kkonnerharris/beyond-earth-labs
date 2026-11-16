import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { storyChapter } from '@/dashboard/Story'
import { useUI } from '@/state/store'
import type { World } from '@/simulation/terrain/heightfield'

/** Story-only effects: Perseverance's drives drawn out sol by sol, and Ingenuity's first flight replayed. */
export function StoryFx({ world }: { world: World }) {
  const i = useUI((s) => s.story)
  const fx = storyChapter(i)?.fx ?? 'none'
  if (fx === 'traverse') return <TraverseReveal world={world} key={i} />
  if (fx === 'flight1') return <FirstFlight world={world} key={i} />
  return null
}

function TraverseReveal({ world }: { world: World }) {
  const drives = useMemo(() => [...(world.m20?.drives ?? [])].sort((a, b) => a.sol - b.sol)
    .map((d) => d.path.map(([x, z]) => new THREE.Vector3(x, world.heightAt(x, z) + 1.5, z))), [world])
  const [shown, setShown] = useState(0)
  const t0 = useRef(performance.now())
  useFrame(() => {
    const t = (performance.now() - t0.current) / 1000
    const n = Math.min(drives.length, Math.floor((t / 8) * drives.length) + 1)   // the whole traverse in ~8 s of wall time
    if (n !== shown) setShown(n)
  })
  return <group>{drives.slice(0, shown).map((pts, k) => pts.length > 1 && <Line key={k} points={pts} color="#3fd1ff" lineWidth={4} />)}</group>
}

function FirstFlight({ world }: { world: World }) {
  const f = world.m20?.flights.find((x) => x.flight === 1)
  const heli = useRef<THREE.Group>(null)
  const t = useRef(0)
  const wb = world.m20?.landings.find((l) => l.flight === 0)
  useFrame((_, dt) => {
    if (!heli.current || !wb) return
    t.current = (t.current + Math.min(dt, 0.1)) % 6
    // flight 1: straight up to ~3 m, hover, straight down (about 40 s in reality, compressed to 6 s here)
    const k = t.current / 6
    const alt = k < 0.25 ? (k / 0.25) * 3 : k < 0.75 ? 3 : (1 - (k - 0.75) / 0.25) * 3
    heli.current.position.set(wb.x, world.heightAt(wb.x, wb.z) + 0.3 + alt, wb.z)
    heli.current.rotation.y += dt * 30
  })
  if (!wb) return null
  return (
    <group>
      {f && <Line points={f.path.map(([x, z]) => new THREE.Vector3(x, world.heightAt(x, z) + 3, z))} color="#f6b93b" lineWidth={3} />}
      <group ref={heli}>
        <mesh><boxGeometry args={[0.2, 0.15, 0.2]} /><meshStandardMaterial color="#d8d2c8" /></mesh>
        <mesh position={[0, 0.25, 0]}><boxGeometry args={[1.2, 0.02, 0.08]} /><meshStandardMaterial color="#222" /></mesh>
        <mesh position={[0, 0.32, 0]} rotation={[0, Math.PI / 2, 0]}><boxGeometry args={[1.2, 0.02, 0.08]} /><meshStandardMaterial color="#222" /></mesh>
      </group>
    </group>
  )
}
