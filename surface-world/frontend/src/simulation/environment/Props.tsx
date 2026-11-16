import { Html, Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Hazard, Site } from '@/services/api'
import { ui, type Layer } from '@/state/store'
import type { World } from '@/simulation/terrain/heightfield'
import { useOptionalTexture } from '@/simulation/terrain/Terrain'

function hash(i: number) { const s = Math.sin(i * 78.233 + 1.3) * 43758.5453; return s - Math.floor(s) }

/** Boulders: two instanced sets (dark basalt, tan sedimentary), each rock scaled, squashed and rotated deterministically. */
export function Rocks({ world }: { world: World }) {
  const basalt = useMemo(() => world.rocks.filter((_, i) => hash(i + 21) > 0.35), [world])
  const tan = useMemo(() => world.rocks.filter((_, i) => hash(i + 21) <= 0.35), [world])
  return (
    <>
      <RockSet world={world} rocks={basalt} tex="/textures/rock.jpg" normal="/textures/rock_n.jpg" seed={0} />
      <RockSet world={world} rocks={tan} tex="/textures/rock2.jpg" normal="/textures/rock2_n.jpg" seed={500} />
    </>
  )
}

function RockSet({ world, rocks, tex, normal, seed }: { world: World; rocks: World['rocks']; tex: string; normal: string; seed: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const rockTex = useOptionalTexture(tex)
  const rockN = useOptionalTexture(normal, false)
  const geo = useMemo(() => {
    const g = new THREE.DodecahedronGeometry(1, 2)
    const p = g.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const k = 0.78 + 0.38 * hash(i * 3.1 + seed)
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k)
    }
    g.computeVertexNormals()
    // spherical-ish UVs so the illustrative rock texture wraps each boulder
    const uv = new Float32Array(p.count * 2)
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
      uv[i * 2] = (Math.atan2(z, x) / (2 * Math.PI) + 0.5) * 2
      uv[i * 2 + 1] = y * 0.5 + 0.5
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    return g
  }, [seed])
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    const o = new THREE.Object3D()
    rocks.forEach((r, i) => {
      const j = i + seed
      o.position.set(r.x, world.heightAt(r.x, r.z) + r.r * 0.22, r.z)
      o.rotation.set(hash(j) * 3, hash(j + 7) * 6.28, hash(j + 3) * 3)
      o.scale.set(r.r * (0.9 + hash(j + 1) * 0.4), r.r * (0.55 + hash(j + 2) * 0.4), r.r * (0.9 + hash(j + 5) * 0.4))
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
      m.setColorAt(i, rockTex
        ? new THREE.Color().setHSL(0.05 + hash(j + 9) * 0.03, 0.2, 0.7 + hash(j + 11) * 0.25)
        : new THREE.Color().setHSL(0.04 + hash(j + 9) * 0.02, 0.45, 0.18 + hash(j + 11) * 0.12))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [world, rocks, rockTex, seed])
  if (!rocks.length) return null
  return (
    <instancedMesh ref={ref} args={[geo, undefined, rocks.length]} castShadow receiveShadow>
      <meshStandardMaterial key={rockTex ? 't' : 'p'} roughness={0.92} metalness={0.04} map={rockTex}
        normalMap={rockN} normalScale={new THREE.Vector2(1.4, 1.4)} />
    </instancedMesh>
  )
}

export const HAB_MODULES: { id: string; label: string; detail: string; offset: [number, number] }[] = [
  { id: 'quarters', label: 'Living quarters', detail: 'Inflatable dome: crew sleep stations, galley and workspace.', offset: [0, 0] },
  { id: 'lifesupport', label: 'Life-support unit', detail: 'Oxygen generation, CO₂ removal and thermal control.', offset: [8.5, 0] },
  { id: 'power', label: 'Power storage', detail: 'Battery bank buffering the solar array through the night.', offset: [-2, 8] },
  { id: 'solar', label: 'Solar array', detail: 'Three tracking panels; output drops with dust and at night.', offset: [-4, -11] },
  { id: 'water', label: 'Water storage', detail: 'Insulated tank fed by the water recovery system.', offset: [-8.5, -3] },
  { id: 'dock', label: 'Rover docking station', detail: 'Charging pad and umbilical for the rover.', offset: [18, -6] },
]

/** Surface habitat built from inspectable modules. Click a module to inspect it. */
export function Habitat({ world }: { world: World }) {
  const [x, z] = world.habitat
  const y = world.heightAt(x, z)
  const pick = (id: string) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    const m = HAB_MODULES.find((k) => k.id === id)!
    ui.set({ selected: { kind: 'module', id, x: x + m.offset[0], z: z + m.offset[1], label: m.label } })
  }
  const hover = { onPointerOver: () => (document.body.style.cursor = 'pointer'), onPointerOut: () => (document.body.style.cursor = '') }
  return (
    <group position={[x, y, z]}>
      {/* living quarters dome */}
      <mesh castShadow receiveShadow onClick={pick('quarters')} {...hover}>
        <sphereGeometry args={[6, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#e9e4dc" roughness={0.55} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[6, 7.2, 48]} />
        <meshStandardMaterial color="#8a7a70" roughness={0.9} />
      </mesh>
      {/* life-support module + airlock */}
      <mesh position={[8.5, 1.6, 0]} rotation={[0, 0, Math.PI / 2]} castShadow onClick={pick('lifesupport')} {...hover}>
        <cylinderGeometry args={[1.6, 1.6, 6, 24]} />
        <meshStandardMaterial color="#d8d2c8" roughness={0.5} metalness={0.25} />
      </mesh>
      <mesh position={[11.6, 1.5, 0]} castShadow onClick={pick('lifesupport')} {...hover}>
        <boxGeometry args={[1.8, 2.6, 2.4]} />
        <meshStandardMaterial color="#c7c0b4" metalness={0.3} roughness={0.5} />
      </mesh>
      <pointLight position={[12.8, 2.6, 0]} intensity={8} distance={10} color="#ffd9a8" />
      {/* power storage */}
      <mesh position={[-2, 1.6, 8]} rotation={[0, Math.PI / 2, Math.PI / 2]} castShadow onClick={pick('power')} {...hover}>
        <cylinderGeometry args={[1.6, 1.6, 6, 24]} />
        <meshStandardMaterial color="#d8d2c8" roughness={0.5} metalness={0.25} />
      </mesh>
      {[0, 1, 2].map((k) => (
        <mesh key={k} position={[-4.2 + k * 1.4, 0.6, 11.6]} castShadow onClick={pick('power')} {...hover}>
          <boxGeometry args={[1.1, 1.2, 0.9]} /><meshStandardMaterial color="#3d4656" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      {/* water tank */}
      <mesh position={[-8.5, 1.4, -3]} castShadow onClick={pick('water')} {...hover}>
        <cylinderGeometry args={[1.5, 1.5, 2.8, 24]} /><meshStandardMaterial color="#b9c3cf" metalness={0.5} roughness={0.35} />
      </mesh>
      {/* solar array */}
      {[-1, 0, 1].map((k) => (
        <group key={k} position={[-4 + k * 3.6, 0, -11]} onClick={pick('solar')} {...hover}>
          <mesh position={[0, 0.9, 0]}><cylinderGeometry args={[0.06, 0.06, 1.8]} /><meshStandardMaterial color="#666" /></mesh>
          <mesh position={[0, 1.8, 0]} rotation={[-0.55, 0, 0]} castShadow>
            <boxGeometry args={[3.2, 0.06, 2]} />
            <meshStandardMaterial color="#14213d" metalness={0.6} roughness={0.25} emissive="#0b3d91" emissiveIntensity={0.15} />
          </mesh>
        </group>
      ))}
      {/* rover docking station */}
      <group position={[18, 0.05, -6]} onClick={pick('dock')} {...hover}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[6, 4.5]} /><meshStandardMaterial color="#6e655d" roughness={0.9} /></mesh>
        <mesh position={[3.2, 0.9, 0]} castShadow><boxGeometry args={[0.5, 1.8, 0.8]} /><meshStandardMaterial color="#cfcac2" metalness={0.3} /></mesh>
        <mesh position={[3.2, 1.6, 0.42]}><boxGeometry args={[0.2, 0.1, 0.02]} /><meshBasicMaterial color="#3fd18f" /></mesh>
      </group>
      {/* comms mast */}
      <mesh position={[-7, 3, 4]}><cylinderGeometry args={[0.08, 0.1, 6]} /><meshStandardMaterial color="#aaa" metalness={0.6} /></mesh>
      <mesh position={[-7, 6.2, 4]} rotation={[0.4, 0, 0.5]}><coneGeometry args={[0.9, 0.35, 24, 1, true]} /><meshStandardMaterial color="#ddd" side={THREE.DoubleSide} /></mesh>
      <Html position={[0, 8, 0]} center distanceFactor={60} zIndexRange={[5, 0]}>
        <div className="pointer-events-none whitespace-nowrap rounded bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white">HABITAT</div>
      </Html>
    </group>
  )
}

export function LandingZone({ world }: { world: World }) {
  const [x, z] = world.landing
  const y = world.heightAt(x, z)
  return (
    <group position={[x, y + 0.05, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[13, 14, 64]} />
        <meshBasicMaterial color="#f6efe9" transparent opacity={0.55} />
      </mesh>
      {[0, Math.PI / 2].map((a) => (
        <mesh key={a} rotation={[-Math.PI / 2, 0, a]}><planeGeometry args={[18, 0.35]} /><meshBasicMaterial color="#f6efe9" transparent opacity={0.4} /></mesh>
      ))}
      {/* descent stage / lander */}
      <group position={[4, 0, 0]}>
        <mesh position={[0, 2.4, 0]} castShadow><cylinderGeometry args={[2.2, 2.6, 2, 8]} /><meshStandardMaterial color="#cfc6b8" metalness={0.4} roughness={0.45} /></mesh>
        <mesh position={[0, 3.9, 0]} castShadow><coneGeometry args={[1.6, 1.4, 8]} /><meshStandardMaterial color="#e2dacd" metalness={0.3} /></mesh>
        {[0, 1, 2, 3].map((k) => {
          const a = (k * Math.PI) / 2 + Math.PI / 4
          return <mesh key={k} position={[Math.cos(a) * 2.6, 0.8, Math.sin(a) * 2.6]} rotation={[Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]}><cylinderGeometry args={[0.08, 0.08, 2.4]} /><meshStandardMaterial color="#999" /></mesh>
        })}
      </group>
      <Html position={[0, 7, 0]} center distanceFactor={60} zIndexRange={[5, 0]}>
        <div className="pointer-events-none whitespace-nowrap rounded bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white">LANDING ZONE</div>
      </Html>
    </group>
  )
}

/** Hazard outlines draped on the terrain. Labels show in the hazard layer. */
export function Hazards({ world, layer }: { world: World; layer: Layer }) {
  const color = (h: Hazard) => (h.kind === 'loose_regolith' ? '#f6b93b' : h.kind === 'rock_field' ? '#fc3d21' : '#b07cff')
  return (
    <group>
      {world.hazards.map((h) => {
        const pts: [number, number, number][] = []
        for (let k = 0; k <= 96; k++) {
          const a = (k / 96) * Math.PI * 2
          const x = h.x + Math.cos(a) * h.r * 0.8, z = h.z + Math.sin(a) * h.r * 0.8
          pts.push([x, world.heightAt(x, z) + 0.4, z])
        }
        return (
          <group key={h.id}>
            <Line points={pts} color={color(h)} lineWidth={layer === 'hazard' ? 2.5 : 1.2} dashed dashSize={3} gapSize={2} transparent opacity={layer === 'natural' ? 0.45 : 0.9} />
            {layer !== 'natural' && (
              <Html position={[h.x, world.heightAt(h.x, h.z) + 6, h.z]} center distanceFactor={90} zIndexRange={[4, 0]}>
                <div className="pointer-events-none whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-medium" style={{ borderColor: color(h), color: color(h), background: 'rgba(10,6,5,.7)' }}>
                  ⚠ {h.label}
                </div>
              </Html>
            )}
          </group>
        )
      })}
    </group>
  )
}

/** Science site beacons. Click to select (camera flies to it; can be set as destination). */
export function Sites({ world, selectedId }: { world: World; selectedId: string | null }) {
  return (
    <group>
      {world.sites.map((s) => <Beacon key={s.id} world={world} s={s} active={selectedId === s.id} />)}
    </group>
  )
}

function Beacon({ world, s, active }: { world: World; s: Site; active: boolean }) {
  const y = world.heightAt(s.x, s.z)
  const ring = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (ring.current) {
      const k = 1 + ((clock.elapsedTime * 0.6) % 1) * 1.6
      ring.current.scale.set(k, k, k)
      ;(ring.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - ((clock.elapsedTime * 0.6) % 1))
    }
  })
  const select = () => ui.set({ selected: { kind: 'site', id: s.id, x: s.x, z: s.z, label: s.name }, camera: 'orbit' })
  return (
    <group position={[s.x, y, s.z]} onClick={(e) => { e.stopPropagation(); select() }}>
      <mesh position={[0, 3, 0]}><cylinderGeometry args={[0.12, 0.12, 6]} /><meshBasicMaterial color={active ? '#ffffff' : '#8fb3ff'} /></mesh>
      <mesh position={[0, 6.4, 0]}><octahedronGeometry args={[0.7]} /><meshBasicMaterial color={active ? '#ffffff' : '#8fb3ff'} /></mesh>
      <mesh ref={ring} position={[0, 0.3, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[1.6, 2, 40]} /><meshBasicMaterial color="#8fb3ff" transparent opacity={0.6} /></mesh>
      <Html position={[0, 8.4, 0]} center zIndexRange={[6, 0]}>
        <button onClick={select} className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10.5px] font-medium ${active ? 'bg-white text-black' : 'bg-nasa text-white'}`}>{s.name}</button>
      </Html>
    </group>
  )
}

/** Drifting dust motes near the camera for atmosphere (cheap Points). */
export function Dust() {
  const N = 900
  const ref = useRef<THREE.Points>(null)
  const pos = useMemo(() => {
    const p = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) p.set([(hash(i) - 0.5) * 200, hash(i + 1) * 30, (hash(i + 2) - 0.5) * 200], i * 3)
    return p
  }, [])
  useFrame(({ camera }, dt) => {
    const pts = ref.current
    if (!pts) return
    const a = pts.geometry.attributes.position.array as Float32Array
    for (let i = 0; i < N; i++) {
      a[i * 3] += 1.2 * dt
      if (a[i * 3] > 100) a[i * 3] -= 200
    }
    pts.geometry.attributes.position.needsUpdate = true
    pts.position.set(Math.round(camera.position.x / 50) * 50, camera.position.y - 15, Math.round(camera.position.z / 50) * 50)
  })
  return (
    <points ref={ref}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[pos, 3]} /></bufferGeometry>
      <pointsMaterial size={0.12} color="#e8b48c" transparent opacity={0.5} depthWrite={false} />
    </points>
  )
}
