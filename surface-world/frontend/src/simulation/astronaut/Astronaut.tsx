import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { sim, ui, useUI } from '@/state/store'
import type { World } from '@/simulation/terrain/heightfield'

/**
 * EVA astronaut (procedural model; no external asset). Faces +x locally.
 * Walk cycle: legs and arms swing in opposition, torso bobs; all driven by sim.astro.
 * The ground ring is the 3D health/resource indicator: green, amber below 50 % O2, red below 25 %.
 */
export function Astronaut({ world }: { world: World }) {
  const root = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const legL = useRef<THREE.Group>(null)
  const legR = useRef<THREE.Group>(null)
  const armL = useRef<THREE.Group>(null)
  const armR = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const selected = useUI((s) => s.selected?.kind === 'astronaut')

  useFrame(({ clock }) => {
    const a = sim.astro
    const g = root.current
    if (!g) return
    g.position.set(a.x, a.y, a.z)
    g.rotation.y = -a.heading
    const walking = a.state === 'walking'
    const s = walking ? Math.sin(a.phase) : 0
    const idle = Math.sin(clock.elapsedTime * 1.4) * 0.03
    if (legL.current) legL.current.rotation.z = s * 0.55
    if (legR.current) legR.current.rotation.z = -s * 0.55
    if (armL.current) armL.current.rotation.z = -s * 0.45 + idle
    if (armR.current) armR.current.rotation.z = s * 0.45 - idle
    if (body.current) body.current.position.y = walking ? Math.abs(Math.cos(a.phase)) * 0.06 : idle * 0.4
    if (ring.current) {
      const frac = a.o2G / world.astronaut.suit_o2_g
      const col = frac < 0.25 ? '#fc3d21' : frac < 0.5 ? '#f6b93b' : '#3fd18f'
      const m = ring.current.material as THREE.MeshBasicMaterial
      m.color.set(col)
      m.opacity = frac < 0.25 ? 0.5 + 0.4 * Math.sin(clock.elapsedTime * 8) : 0.75
    }
  })

  const suit = <meshStandardMaterial color="#f3f1ed" roughness={0.75} />
  const joint = <meshStandardMaterial color="#c9c4bb" roughness={0.6} />
  return (
    <group ref={root} onClick={(e) => { e.stopPropagation(); ui.set({ selected: { kind: 'astronaut', id: 'astronaut', x: sim.astro.x, z: sim.astro.z, label: 'Astronaut' } }) }}>
      <mesh ref={ring} position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[selected ? 0.75 : 0.6, selected ? 0.95 : 0.72, 40]} />
        <meshBasicMaterial color="#3fd18f" transparent opacity={0.75} />
      </mesh>
      <group ref={body}>
        {/* legs pivot at the hip */}
        {[[legL, 0.13], [legR, -0.13]].map(([ref, dz]) => (
          <group key={dz as number} ref={ref as React.RefObject<THREE.Group>} position={[0, 0.88, dz as number]}>
            <mesh position={[0, -0.42, 0]} castShadow><capsuleGeometry args={[0.105, 0.6, 4, 10]} />{suit}</mesh>
            <mesh position={[0.05, -0.84, 0]} castShadow><boxGeometry args={[0.28, 0.1, 0.16]} /><meshStandardMaterial color="#8d8a85" /></mesh>
          </group>
        ))}
        <mesh position={[0, 1.22, 0]} castShadow><capsuleGeometry args={[0.25, 0.42, 4, 12]} />{suit}</mesh>
        <mesh position={[0.2, 1.3, 0]}><boxGeometry args={[0.12, 0.22, 0.3]} /><meshStandardMaterial color="#5b6b82" /></mesh>
        <mesh position={[0.27, 1.32, 0.07]}><boxGeometry args={[0.01, 0.05, 0.08]} /><meshBasicMaterial color="#3fd18f" /></mesh>
        {/* arms pivot at the shoulder */}
        {[[armL, 0.34], [armR, -0.34]].map(([ref, dz]) => (
          <group key={dz as number} ref={ref as React.RefObject<THREE.Group>} position={[0, 1.48, dz as number]}>
            <mesh position={[0, -0.32, 0]} castShadow><capsuleGeometry args={[0.085, 0.5, 4, 8]} />{suit}</mesh>
            <mesh position={[0, -0.66, 0]}><sphereGeometry args={[0.08, 10, 8]} />{joint}</mesh>
          </group>
        ))}
        {/* life-support backpack */}
        <mesh position={[-0.3, 1.28, 0]} castShadow><boxGeometry args={[0.26, 0.66, 0.5]} /><meshStandardMaterial color="#dcd8d1" roughness={0.6} /></mesh>
        {/* helmet with gold visor */}
        <mesh position={[0, 1.78, 0]} castShadow><sphereGeometry args={[0.21, 24, 18]} /><meshStandardMaterial color="#f7f7f7" roughness={0.3} /></mesh>
        <mesh position={[0.08, 1.78, 0]} rotation={[0, 0, 0]}>
          <sphereGeometry args={[0.175, 24, 18, -Math.PI / 2, Math.PI]} />
          <meshStandardMaterial color="#c99a2e" metalness={0.95} roughness={0.12} />
        </mesh>
        <pointLight position={[0.3, 1.9, 0]} intensity={2} distance={6} color="#fff3df" />
      </group>
      {selected && (
        <Html position={[0, 2.4, 0]} center distanceFactor={18}>
          <div className="pointer-events-none whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">EVA-1</div>
        </Html>
      )}
    </group>
  )
}
