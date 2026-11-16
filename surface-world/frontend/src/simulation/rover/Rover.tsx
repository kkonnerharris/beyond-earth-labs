import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { sim, ui } from '@/state/store'

const WHEEL_R = 0.42
// local frame: +x forward, +y up, +z right
const WHEELS: { x: number; z: number; steer: 1 | 0 | -1 }[] = [
  { x: 1.3, z: 1.2, steer: 1 }, { x: 1.3, z: -1.2, steer: 1 },
  { x: 0, z: 1.3, steer: 0 }, { x: 0, z: -1.3, steer: 0 },
  { x: -1.3, z: 1.2, steer: -1 }, { x: -1.3, z: -1.2, steer: -1 },
]

/** Six-wheeled rover. All motion comes from sim.rover, written by the physics step each frame. */
export function Rover() {
  const root = useRef<THREE.Group>(null)
  const wheels = useRef<(THREE.Group | null)[]>([])
  const spins = useRef<(THREE.Mesh | null)[]>([])
  const head = useRef<THREE.Group>(null)
  const beam = useRef<THREE.Mesh>(null)
  const lightTargets = useMemo(() => [new THREE.Object3D(), new THREE.Object3D()], [])

  useFrame(({ clock }) => {
    const r = sim.rover
    const g = root.current
    if (!g) return
    g.position.set(r.x, r.y, r.z)
    g.quaternion.set(...r.quat)
    WHEELS.forEach((w, i) => {
      const steerG = wheels.current[i]
      if (steerG) steerG.rotation.y = -r.steer * w.steer
      const s = spins.current[i]
      if (s) s.rotation.z = -r.odometer / WHEEL_R
    })
    const t = clock.elapsedTime
    if (head.current) head.current.rotation.y = r.scanning > 0 ? Math.sin(t * 2.2) * 1.1 : THREE.MathUtils.lerp(head.current.rotation.y, -r.steer * 0.8, 0.05)
    if (beam.current) {
      beam.current.visible = r.scanning > 0
      ;(beam.current.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.1 * Math.sin(t * 12)
    }
  })

  const select = () => ui.set({ selected: { kind: 'rover', id: 'rover', x: sim.rover.x, z: sim.rover.z, label: 'Rover' } })

  return (
    <group ref={root} onClick={(e) => { e.stopPropagation(); select() }}>
      {/* wheels on steering knuckles */}
      {WHEELS.map((w, i) => (
        <group key={i} position={[w.x, WHEEL_R, w.z]} ref={(el) => { wheels.current[i] = el }}>
          <mesh ref={(el) => { spins.current[i] = el }} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[WHEEL_R, WHEEL_R, 0.36, 20]} />
            <meshStandardMaterial color="#9a9a9a" metalness={0.7} roughness={0.35} />
          </mesh>
          {/* grousers so the spin is visible */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[WHEEL_R * 0.98, 0.035, 6, 14]} />
            <meshStandardMaterial color="#555" />
          </mesh>
          {/* steering strut */}
          <mesh position={[0, 0.45, 0]}><boxGeometry args={[0.08, 0.5, 0.08]} /><meshStandardMaterial color="#d4d4d4" metalness={0.6} /></mesh>
        </group>
      ))}
      {/* rocker-bogie arms */}
      {[1, -1].map((side) => (
        <group key={side} position={[0, 0.95, side * 1.0]}>
          <mesh position={[0.65, 0, 0]} rotation={[0, 0, -0.35]}><boxGeometry args={[1.5, 0.09, 0.09]} /><meshStandardMaterial color="#cfcfcf" metalness={0.6} /></mesh>
          <mesh position={[-0.65, 0, 0]} rotation={[0, 0, 0.35]}><boxGeometry args={[1.5, 0.09, 0.09]} /><meshStandardMaterial color="#cfcfcf" metalness={0.6} /></mesh>
        </group>
      ))}
      {/* body */}
      <mesh position={[0, 1.25, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.7, 0.55, 1.75]} />
        <meshStandardMaterial color="#f1ede6" metalness={0.15} roughness={0.5} />
      </mesh>
      <mesh position={[0.1, 1.56, 0]} castShadow>
        <boxGeometry args={[2.3, 0.08, 1.55]} />
        <meshStandardMaterial color="#c9a14a" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* power source at the rear */}
      <mesh position={[-1.55, 1.45, 0]} rotation={[0, 0, 0.7]} castShadow>
        <cylinderGeometry args={[0.28, 0.28, 0.9, 12]} />
        <meshStandardMaterial color="#3a3a3a" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* high-gain antenna */}
      <group position={[-0.6, 1.65, -0.55]}>
        <mesh position={[0, 0.15, 0]}><cylinderGeometry args={[0.04, 0.04, 0.3]} /><meshStandardMaterial color="#888" /></mesh>
        <mesh position={[0, 0.35, 0]} rotation={[0.5, 0, 0.3]}><cylinderGeometry args={[0.36, 0.36, 0.04, 24]} /><meshStandardMaterial color="#d8d8d8" metalness={0.5} /></mesh>
      </group>
      {/* low-gain antenna */}
      <mesh position={[-0.9, 2.0, 0.6]}><cylinderGeometry args={[0.02, 0.02, 0.8]} /><meshStandardMaterial color="#bbb" /></mesh>
      {/* camera mast with scanning head */}
      <mesh position={[0.95, 2.25, 0.55]} castShadow><cylinderGeometry args={[0.06, 0.07, 1.4]} /><meshStandardMaterial color="#e5e5e5" metalness={0.4} /></mesh>
      <group ref={head} position={[0.95, 3.0, 0.55]}>
        <mesh castShadow><boxGeometry args={[0.32, 0.26, 0.6]} /><meshStandardMaterial color="#f5f5f5" /></mesh>
        {[0.16, -0.16].map((dz) => (
          <mesh key={dz} position={[0.17, 0, dz]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.06, 0.06, 0.06, 12]} /><meshStandardMaterial color="#111" emissive="#204060" emissiveIntensity={0.6} /></mesh>
        ))}
        <mesh ref={beam} position={[4.2, -0.9, 0]} rotation={[0, 0, Math.PI / 2 + 0.22]} visible={false}>
          <coneGeometry args={[1.8, 8, 24, 1, true]} />
          <meshBasicMaterial color="#5fd4e0" transparent opacity={0.2} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      </group>
      {/* inspection lights */}
      {[0.5, -0.5].map((dz, i) => (
        <group key={dz} position={[1.38, 1.2, dz]}>
          <mesh><boxGeometry args={[0.04, 0.12, 0.22]} /><meshBasicMaterial color="#fff6e0" /></mesh>
          <primitive object={lightTargets[i]} position={[8, -1.5, 0]} />
          <spotLight intensity={25} distance={28} angle={0.45} penumbra={0.6} color="#fff1d6" target={lightTargets[i]} />
        </group>
      ))}
    </group>
  )
}
