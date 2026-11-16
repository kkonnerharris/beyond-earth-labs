import { Html, Line } from '@react-three/drei'
import { useMemo, useState } from 'react'
import * as THREE from 'three'
import type { World } from '@/simulation/terrain/heightfield'

export const ROVER_PATH = '#f4f4f4'
export const HELI_PATH = '#f6b93b'

/**
 * NASA data: Perseverance's actual drives and Ingenuity's actual flights in this region, from the
 * Mars 2020 team's localization (the public "Where is the rover?" map). Drives are draped on the
 * HiRISE terrain; flights are drawn a few metres up, with a mark where each one landed.
 */
export function M20Paths({ world }: { world: World }) {
  const m20 = world.m20
  const [hover, setHover] = useState<string | null>(null)
  const drives = useMemo(() => m20?.drives.map((d) => d.path.map(([x, z]) => new THREE.Vector3(x, world.heightAt(x, z) + 0.3, z))) ?? [], [m20, world])
  const flights = useMemo(() => m20?.flights.map((f) => ({ ...f, pts: f.path.map(([x, z]) => new THREE.Vector3(x, world.heightAt(x, z) + 6, z)) })) ?? [], [m20, world])
  if (!m20) return null
  return (
    <group>
      {drives.map((pts, i) => pts.length > 1 && <Line key={i} points={pts} color={ROVER_PATH} lineWidth={2.2} transparent opacity={0.85} />)}
      {m20.stops.map((s) => (
        <mesh key={`${s.sol}-${s.site}-${s.drive}`} position={[s.x, world.heightAt(s.x, s.z) + 0.6, s.z]}
          onPointerOver={(e) => { e.stopPropagation(); setHover(`Perseverance · sol ${s.sol}`) }} onPointerOut={() => setHover(null)}>
          <sphereGeometry args={[0.35, 10, 8]} /><meshBasicMaterial color={ROVER_PATH} />
          {hover === `Perseverance · sol ${s.sol}` && <Html center position={[0, 3, 0]} zIndexRange={[6, 0]}><Tip text={hover} /></Html>}
        </mesh>
      ))}
      {flights.map((f) => f.pts.length > 1 && <Line key={f.flight} points={f.pts} color={HELI_PATH} lineWidth={1.8} dashed dashSize={4} gapSize={3} transparent opacity={0.9} />)}
      {m20.landings.map((l) => {
        const label = l.flight === 0 ? `Ingenuity deployed · sol ${l.sol}` : `Ingenuity flight ${l.flight} landed · sol ${l.sol}`
        return (
          <mesh key={l.flight} position={[l.x, world.heightAt(l.x, l.z) + 0.8, l.z]} rotation={[0, Math.PI / 4, 0]}
            onPointerOver={(e) => { e.stopPropagation(); setHover(label) }} onPointerOut={() => setHover(null)}>
            <octahedronGeometry args={[0.55]} /><meshBasicMaterial color={HELI_PATH} />
            {hover === label && <Html center position={[0, 3, 0]} zIndexRange={[6, 0]}><Tip text={label} /></Html>}
          </mesh>
        )
      })}
    </group>
  )
}

function Tip({ text }: { text: string }) {
  return <div className="pointer-events-none whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10.5px] text-white">{text}</div>
}
