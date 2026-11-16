import { OrbitControls, PointerLockControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { keys } from '@/hooks/useKeyboard'
import { sim, ui, useUI } from '@/state/store'
import { missionTrack } from '@/simulation/navigation/MissionOverlay'
import type { World } from '@/simulation/terrain/heightfield'
import { experimentData } from '@/dashboard/Science'
import { storyChapter } from '@/dashboard/Story'

/**
 * Camera modes (switching never changes mission state):
 *   free      : free exploration; click to capture the mouse, WASD + Q/E, Shift = fast, Esc releases
 *   astronaut : third-person chase behind the astronaut (scroll to zoom)
 *   rover     : chase camera behind the rover (scroll to zoom)
 *   top       : top-down strategic map; drag to pan, scroll to zoom, click to set destinations
 *   orbit     : inspect the selected object (site, module, rover, astronaut)
 * Chase cameras keep above the terrain (simple terrain-collision).
 */
export function CameraRig({ world, resetSignal }: { world: World; resetSignal: number }) {
  const mode = useUI((s) => s.camera)
  const selected = useUI((s) => s.selected)
  const expDrive = useUI((s) => s.experimentDrive)
  const story = useUI((s) => s.story)
  const mission = useUI((s) => s.mission)
  const flyover = useUI((s) => s.flyover)
  const track = useMemo(() => (mission?.planned ? missionTrack(world, mission) : null), [world, mission])
  const fly = useRef({ d: 0, i: 0 })
  useEffect(() => { fly.current = { d: 0, i: 0 } }, [flyover, track])
  const { camera, gl } = useThree()
  const dist = useRef({ rover: 12, astronaut: 8.5 })
  const orbit = useRef<any>(null)
  const target = useRef(new THREE.Vector3())
  const look = useRef(new THREE.Vector3())
  const tmp = useRef(new THREE.Vector3())

  useEffect(() => {
    if (mode !== 'rover' && mode !== 'astronaut') return
    const onWheel = (e: WheelEvent) => {
      const k = mode
      dist.current[k] = THREE.MathUtils.clamp(dist.current[k] + e.deltaY * 0.01, k === 'rover' ? 5 : 2.5, 45)
    }
    gl.domElement.addEventListener('wheel', onWheel, { passive: true })
    return () => gl.domElement.removeEventListener('wheel', onWheel)
  }, [mode, gl])

  useEffect(() => {
    const r = sim.rover
    const drive = mode === 'top' && expDrive !== null ? experimentData()?.drives[expDrive] : null
    if (drive) {
      // replaying an experiment drive: frame that drive
      const xs = drive.real_path.map((p) => p[0]), zs = drive.real_path.map((p) => p[1])
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2
      const span = Math.max(60, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 0.75
      const h = span / Math.tan(THREE.MathUtils.degToRad(27.5)) + world.heightAt(cx, cz)
      camera.position.set(cx, h, cz + 0.01)
      target.current.set(cx, world.heightAt(cx, cz), cz)
    } else if (mode === 'top') {
      // strategic view frames the whole mapped region, widened to take in the mission route when there is one
      let cx = 0, cz = 0, span = world.size / 2
      if (track && ui.get().showMission) {
        const xs = track.pts.map((p) => p.x).concat([-world.size / 2, world.size / 2]), zs = track.pts.map((p) => p.z).concat([-world.size / 2, world.size / 2])
        const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs)
        cx = (x0 + x1) / 2; cz = (z0 + z1) / 2; span = Math.max(x1 - x0, z1 - z0) / 2
      }
      const h = span / Math.tan(THREE.MathUtils.degToRad(27.5)) * (track && ui.get().showMission ? 1.3 : 1.08)   // room for the side panels
      camera.position.set(cx, h, cz + 0.01)
      target.current.set(cx, 0, cz)
    } else if (mode === 'orbit') {
      const s = selected ?? { x: r.x, z: r.z }
      const y = world.heightAt(s.x, s.z)
      target.current.set(s.x, y + 2, s.z)
      camera.position.set(s.x - 18, y + 12, s.z + 18)
    } else if (mode === 'free') {
      camera.position.set(r.x - 25, r.y + 18, r.z + 25)
      camera.lookAt(r.x, r.y, r.z)
    }
    if (orbit.current) { orbit.current.target.copy(target.current); orbit.current.update() }
  }, [mode, selected, resetSignal, camera, world, expDrive, track])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const ch = storyChapter(story)
    if (ch && ch.fx !== 'experiment') {
      // story: glide to the chapter's viewpoint
      const k = 1 - Math.exp(-1.6 * Math.min(dtRaw, 0.25))   // wall-clock glide, even at low frame rates
      camera.position.lerp(tmp.current.set(...ch.cam.pos), k)
      look.current.lerp(new THREE.Vector3(...ch.cam.target), k)
      camera.lookAt(look.current)
      return
    }
    if (flyover && track && track.pts.length > 1) {
      // Mission flyover: glide above the route, looking ahead along it. Faster over the coarse backdrop.
      const f = fly.current, total = track.dist[track.dist.length - 1], half = world.size / 2
      while (f.i < track.dist.length - 2 && track.dist[f.i + 1] < f.d) f.i++
      const at = (d: number, out: THREE.Vector3) => {
        let k = f.i
        while (k < track.dist.length - 2 && track.dist[k + 1] < d) k++
        const seg = Math.max(1e-6, track.dist[k + 1] - track.dist[k])
        return out.copy(track.pts[k]).lerp(track.pts[k + 1], THREE.MathUtils.clamp((d - track.dist[k]) / seg, 0, 1))
      }
      const here = at(f.d, tmp.current)
      const inMap = Math.abs(here.x) <= half && Math.abs(here.z) <= half
      const height = inMap ? 38 : 150, back = inMap ? 70 : 260
      const behind = at(Math.max(0, f.d - back), new THREE.Vector3())
      const ahead = at(Math.min(total, f.d + (inMap ? 120 : 420)), new THREE.Vector3())
      const dir = new THREE.Vector3().subVectors(here, behind)
      if (dir.lengthSq() < 1) dir.subVectors(ahead, here)
      dir.y = 0; dir.normalize()
      const desired = new THREE.Vector3(here.x - dir.x * back, here.y + height, here.z - dir.z * back)
      const k = 1 - Math.exp(-2.2 * Math.min(dtRaw, 0.25))
      camera.position.lerp(desired, k)
      look.current.lerp(ahead, k)
      camera.lookAt(look.current)
      f.d += (inMap ? 60 : 240) * Math.min(dtRaw, 0.5)   // wall-clock pace, even at a low frame rate
      if (f.d >= total) ui.set({ flyover: false })
      return
    }
    if (mode === 'rover' || mode === 'astronaut') {
      const e = mode === 'rover' ? sim.rover : sim.astro
      const back = dist.current[mode]
      const up = mode === 'rover' ? back * 0.45 + 2 : back * 0.35 + 1.2
      const desired = tmp.current.set(e.x - Math.cos(e.heading) * back, e.y + up, e.z - Math.sin(e.heading) * back)
      const ground = world.heightAt(desired.x, desired.z) + 1.5
      if (desired.y < ground) desired.y = ground
      camera.position.lerp(desired, 1 - Math.exp(-4 * dt))
      const lookH = mode === 'rover' ? 1.5 : 1.4
      look.current.lerp(new THREE.Vector3(e.x + Math.cos(e.heading) * 3, e.y + lookH, e.z + Math.sin(e.heading) * 3), 1 - Math.exp(-8 * dt))
      camera.lookAt(look.current)
    } else if (mode === 'free') {
      const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 70 : 22) * dt
      const fwd = new THREE.Vector3()
      camera.getWorldDirection(fwd)
      const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize()
      if (keys.has('KeyW')) camera.position.addScaledVector(fwd, speed)
      if (keys.has('KeyS')) camera.position.addScaledVector(fwd, -speed)
      if (keys.has('KeyD')) camera.position.addScaledVector(right, speed)
      if (keys.has('KeyA')) camera.position.addScaledVector(right, -speed)
      if (keys.has('KeyE')) camera.position.y += speed
      if (keys.has('KeyQ')) camera.position.y -= speed
      const ground = world.heightAt(camera.position.x, camera.position.z) + 1.5
      if (camera.position.y < ground) camera.position.y = ground
    } else if (mode === 'orbit' && orbit.current && (selected?.kind === 'rover' || selected?.kind === 'astronaut')) {
      const e = selected.kind === 'rover' ? sim.rover : sim.astro
      orbit.current.target.lerp(new THREE.Vector3(e.x, e.y + 1.2, e.z), 0.1)
    }
  })

  if (story !== null && storyChapter(story)?.fx !== 'experiment') return null
  if (flyover) return null
  if (mode === 'free') return <PointerLockControls makeDefault selector="canvas" />   // lock only when the 3D view is clicked, never from HUD buttons
  if (mode === 'orbit') return <OrbitControls ref={orbit} makeDefault enableDamping maxPolarAngle={Math.PI * 0.48} minDistance={4} maxDistance={220} />
  if (mode === 'top') return <OrbitControls ref={orbit} makeDefault enableRotate={false} screenSpacePanning enableDamping minDistance={60} maxDistance={track ? 30_000 : 900 * Math.max(1, world.size / 600)}
    mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }} />
  return null
}
