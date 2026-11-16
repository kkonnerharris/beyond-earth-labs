import { Html, Line } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { MissionPlan } from '@/services/api'
import { makeGround } from '@/simulation/terrain/ground'
import type { World } from '@/simulation/terrain/heightfield'

/** Colours match the main map: the mission route is Mars orange, ground the 1 m model calls too steep is red. */
export const MISSION_ROUTE = '#e2733c'
export const MISSION_STEEP = '#ff3b30'
const KEEP_OUT = '#ef6a5e'

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m.toFixed(0)} m`)

/** The route as [x, y, z] along the drawn ground, every leg joined, with distance along it. Used by the flyover. */
export function missionTrack(world: World, mission: MissionPlan): { pts: THREE.Vector3[]; dist: number[] } {
  const ground = makeGround(world)
  const pts: THREE.Vector3[] = [], dist: number[] = []
  let d = 0
  for (const leg of mission.legs) for (const [x, z] of leg.points) {
    const p = new THREE.Vector3(x, ground(x, z), z)
    if (pts.length) {
      const step = Math.hypot(p.x - pts[pts.length - 1].x, p.z - pts[pts.length - 1].z)
      if (step < 0.01) continue
      d += step
    }
    pts.push(p); dist.push(d)
  }
  return { pts, dist }
}

/**
 * The mission planned in the main map, drawn in this world: every leg of the route, the science
 * targets, the keep-outs, and the stretches NASA's 1 m elevation model measures as too steep.
 * Inside the 2 km map the line lies on the 5 m HiRISE terrain; beyond it, on the 80 km backdrop.
 */
export function MissionOverlay({ world, mission }: { world: World; mission: MissionPlan }) {
  const ground = useMemo(() => makeGround(world), [world])
  const half = world.size / 2
  const lift = (x: number, z: number) => (Math.abs(x) <= half && Math.abs(z) <= half ? 0.6 : 5)

  const legs = useMemo(() => {
    const base = new THREE.Color(MISSION_ROUTE), steep = new THREE.Color(MISSION_STEEP)
    return mission.legs.filter((l) => l.points.length > 1).map((l) => ({
      points: l.points.map(([x, z]) => new THREE.Vector3(x, ground(x, z) + lift(x, z), z)),
      colors: l.points.map(([, , s]) => (s ? steep : base)),
    }))
  }, [mission, ground])   // eslint-disable-line

  const rings = useMemo(() => mission.keep_outs.map((k) => {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2, x = k.x + Math.cos(a) * k.r, z = k.z + Math.sin(a) * k.r
      pts.push(new THREE.Vector3(x, ground(x, z) + lift(x, z) + 0.4, z))
    }
    return pts
  }), [mission, ground])   // eslint-disable-line

  const b = mission.base
  return (
    <group>
      {legs.map((l, i) => <Line key={i} points={l.points} vertexColors={l.colors} lineWidth={4.5} transparent opacity={0.95} />)}
      {rings.map((pts, i) => <Line key={i} points={pts} color={KEEP_OUT} lineWidth={2} dashed dashSize={6} gapSize={4} transparent opacity={0.9} />)}

      {mission.targets.map((t, i) => {
        const y = ground(t.x, t.z), tall = t.inside ? 45 : 320
        const away = Math.hypot(t.x - b.x, t.z - b.z)
        return (
          <group key={t.id || i}>
            <Line points={[[t.x, y, t.z], [t.x, y + tall, t.z]]} color={MISSION_ROUTE} lineWidth={2.5} transparent opacity={0.9} />
            <Html position={[t.x, y + tall, t.z]} center zIndexRange={[5, 0]}>
              <div className="pointer-events-none -translate-y-4 whitespace-nowrap rounded-md border border-[#e2733c]/60 bg-black/70 px-2 py-1 text-center font-mono text-[10.5px] leading-tight text-white">
                <div className="font-semibold">TARGET {i + 1} · {t.name}</div>
                <div className="text-[9.5px] text-white/70">{km(away)} from base{t.inside ? '' : ' · beyond the 2 km map'}</div>
              </div>
            </Html>
          </group>
        )
      })}

      {b.inside && (
        <Html position={[b.x, ground(b.x, b.z) + 16, b.z]} center distanceFactor={120} zIndexRange={[5, 0]}>
          <div className="pointer-events-none whitespace-nowrap rounded bg-[#e2733c] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-black">MISSION BASE · {b.name}</div>
        </Html>
      )}

      {mission.steep.filter((s) => s.inside).map((s, i) => (
        <Html key={i} position={[s.x, ground(s.x, s.z) + 7, s.z]} center distanceFactor={90} zIndexRange={[4, 0]}>
          <div className="pointer-events-none whitespace-nowrap rounded bg-[#ff3b30]/90 px-1.5 py-0.5 font-mono text-[10px] text-white">
            {s.max_slope_deg.toFixed(0)}° over {s.length_m.toFixed(0)} m · 1 m model
          </div>
        </Html>
      ))}
    </group>
  )
}
