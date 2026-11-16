import { Html, Line } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import { experimentData } from '@/dashboard/Science'
import { useUI } from '@/state/store'
import type { World } from '@/simulation/terrain/heightfield'

/** One experiment drive on the map: Perseverance's real path (white) against our planner's (cyan). */
export function ExperimentLines({ world }: { world: World }) {
  const i = useUI((s) => s.experimentDrive)
  const data = experimentData()
  const d = i !== null && data ? data.drives[i] : null
  const lines = useMemo(() => {
    if (!d || !data?.best_mode) return null
    const lift = (pts: [number, number][], h: number) => pts.map(([x, z]) => new THREE.Vector3(x, world.heightAt(x, z) + h, z))
    const p = d.plans[data.best_mode]
    return { real: lift(d.real_path, 0.8), plan: 'path' in p ? lift(p.path, 1.1) : null }
  }, [d, data, world])
  if (!d || !lines) return null
  const [ex, ez] = d.real_path[d.real_path.length - 1]
  return (
    <group>
      <Line points={lines.real} color="#ffffff" lineWidth={5} />
      {lines.plan && <Line points={lines.plan} color="#3fd1ff" lineWidth={4} dashed dashSize={3} gapSize={2} />}
      <Html position={[ex, world.heightAt(ex, ez) + 6, ez]} center zIndexRange={[6, 0]}>
        <div className="pointer-events-none whitespace-nowrap rounded bg-black/75 px-2 py-1 font-mono text-[11px] text-white">
          sol {d.sol} · <span className="text-white">— real</span> · <span className="text-[#3fd1ff]">- - planner</span>
        </div>
      </Html>
    </group>
  )
}
