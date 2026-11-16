import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Route } from '@/services/api'
import type { World } from '@/simulation/terrain/heightfield'

const KIND: Record<string, THREE.Color> = {
  loose_regolith: new THREE.Color('#f6b93b'),
  rock_field: new THREE.Color('#fc3d21'),
  steep_slope: new THREE.Color('#ff7a45'),
}

/** The planned route draped on the terrain; hazardous sections are coloured by hazard type. */
export function RouteLine({ route, color = '#8fb3ff' }: { route: Route; color?: string }) {
  const { points, colors } = useMemo(() => {
    const base = new THREE.Color(color)
    const pts = route.path.map(([x, y, z]) => new THREE.Vector3(x, y + 0.45, z))
    const cols = route.path.map(() => base.clone())
    for (const s of route.hazard_segments) for (let i = s.start; i <= s.end; i++) cols[i] = (KIND[s.kind] ?? KIND.steep_slope).clone()
    return { points: pts, colors: cols }
  }, [route, color])
  const end = route.path[route.path.length - 1]
  return (
    <group>
      <Line points={points} vertexColors={colors} lineWidth={4} transparent opacity={0.95} />
      {route.path.filter((_, i) => i % 12 === 0 && i > 0).map(([x, y, z], i) => (
        <mesh key={i} position={[x, y + 0.5, z]}><sphereGeometry args={[0.14, 10, 8]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.8} /></mesh>
      ))}
      <Marker x={end[0]} y={end[1]} z={end[2]} color="#ffffff" />
    </group>
  )
}

/** Destination beacon (shown before and after planning). */
export function Marker({ x, y, z, color = '#fc3d21' }: { x: number; y: number; z: number; color?: string }) {
  const ring = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ring.current) return
    const k = 1 + ((clock.elapsedTime * 0.8) % 1) * 2
    ring.current.scale.set(k, k, k)
    ;(ring.current.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - ((clock.elapsedTime * 0.8) % 1))
  })
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 2.5, 0]}><cylinderGeometry args={[0.1, 0.1, 5]} /><meshBasicMaterial color={color} /></mesh>
      <mesh position={[0, 5.3, 0]} rotation={[0, 0, Math.PI]}><coneGeometry args={[0.6, 1.1, 4]} /><meshBasicMaterial color={color} /></mesh>
      <mesh ref={ring} position={[0, 0.3, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[1.2, 1.5, 40]} /><meshBasicMaterial color={color} transparent opacity={0.7} /></mesh>
    </group>
  )
}

export function DestinationMarker({ world, dest }: { world: World; dest: [number, number] }) {
  return <Marker x={dest[0]} y={world.heightAt(dest[0], dest[1])} z={dest[1]} />
}
