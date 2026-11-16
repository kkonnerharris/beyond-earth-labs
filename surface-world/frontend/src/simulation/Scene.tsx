import { Environment } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { actions } from '@/state/actions'
import { sim, ui, useUI } from '@/state/store'
import { Astronaut } from './astronaut/Astronaut'
import { CameraRig } from './camera/CameraRig'
import { Dust, Habitat, Hazards, LandingZone, Rocks, Sites } from './environment/Props'
import { Trees } from './environment/Trees'
import { DestinationMarker, RouteLine } from './navigation/RouteLine'
import { M20Paths } from './navigation/M20Paths'
import { MissionOverlay } from './navigation/MissionOverlay'
import { ExperimentLines } from './navigation/ExperimentLines'
import { StoryFx } from './navigation/StoryFx'
import { Surroundings } from './terrain/Surroundings'
import { Rover } from './rover/Rover'
import { SimLoop } from './SimLoop'
import { Terrain, useOptionalTexture } from './terrain/Terrain'
import type { World } from './terrain/heightfield'

const MARS = { horizon: '#d4a07a', zenith: '#8f5c46', skyLight: '#f0c9a6', ground: '#5a2f1f', sun: '#ffe4c8' }
const EARTH = { horizon: '#c9dcef', zenith: '#4f86c6', skyLight: '#dbe9ff', ground: '#4a5a3a', sun: '#fff6e8' }
type Palette = typeof MARS
let PAL: Palette = MARS   // set per world before the canvas renders
const HORIZON_OF = () => PAL.horizon

/** Local hour (illustrative lighting): operator override, else the mission clock. */
export function lightingHour(): number {
  const o = ui.get().timeOfDay
  if (o !== null) return o
  const rem = sim.metS % 88775
  return rem / 3699
}

/** Smoothed 0..1 dust-storm level (illustrative atmosphere preset). */
let dustSmoothed = 0
export function dustLevel() { return dustSmoothed }

/** Fog and dust follow the atmosphere preset with a smooth transition. */
function Atmosphere({ k, far = 0 }: { k: number; far?: number }) {
  const scene = useThree((s) => s.scene)
  const clearC = useMemo(() => new THREE.Color(HORIZON_OF()), [])
  const dustC = useMemo(() => new THREE.Color('#b07a52'), [])
  useFrame((state, dt) => {
    const target = ui.get().weather === 'dust' ? 1 : 0
    const alt = Math.max(0, state.camera.position.y - 60)   // overhead views see through the haze, not into it
    dustSmoothed += (target - dustSmoothed) * Math.min(1, dt * 0.8)
    const f = scene.fog as THREE.Fog | null
    if (f) {
      const n0 = far ? far * 0.04 : 180 * k, f0 = far || 900 * k
      f.near = THREE.MathUtils.lerp(n0 + alt * 1.2, 20 + alt * 0.4, dustSmoothed)
      f.far = THREE.MathUtils.lerp(f0 + alt * 2.5, 230 + alt * 1.2, dustSmoothed)
      f.color.copy(clearC).lerp(dustC, dustSmoothed)
    }
    if (scene.background instanceof THREE.Color) scene.background.copy(clearC).lerp(dustC, dustSmoothed)
  })
  return null
}

/** Butterscotch Mars daytime sky as a vertex-coloured dome; darkens toward dusk (illustrative). */
function Sky({ k, radius }: { k: number; radius?: number }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  const geo = useMemo(() => {
    const r = radius ?? 1100 * k
    const g = new THREE.SphereGeometry(r, 32, 16)
    const p = g.getAttribute('position')
    const cols = new Float32Array(p.count * 3)
    const a = new THREE.Color(PAL.horizon), b = new THREE.Color(PAL.zenith), c = new THREE.Color()
    for (let i = 0; i < p.count; i++) {
      const t = THREE.MathUtils.clamp(p.getY(i) / r, 0, 1)
      c.copy(a).lerp(b, Math.pow(t, 0.6))
      cols.set([c.r, c.g, c.b], i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    return g
  }, [k, radius])
  useFrame(() => {
    const h = lightingHour()
    const day = THREE.MathUtils.clamp(Math.sin(((h - 6) / 12) * Math.PI) * 1.4, 0.12, 1)
    const dust = dustLevel()
    mat.current?.color.setRGB(day * (1 - 0.15 * dust), day * (1 - 0.3 * dust), day * (1 - 0.45 * dust))
  })
  return <mesh geometry={geo}><meshBasicMaterial ref={mat} vertexColors side={THREE.BackSide} fog={false} depthWrite={false} /></mesh>
}

/** AI-generated (illustrative) horizon panorama on a cylinder, fading into the sky at the top. */
function HorizonBackdrop({ k }: { k: number }) {
  const clear = useOptionalTexture('/textures/horizon.jpg')
  const dusty = useOptionalTexture('/textures/horizon-dust.jpg')
  const weather = useUI((s) => s.weather)
  const tex = weather === 'dust' && dusty ? dusty : clear
  const alpha = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 4; c.height = 256
    const g = c.getContext('2d')!
    const grad = g.createLinearGradient(0, 0, 0, 256)
    grad.addColorStop(0, 'black'); grad.addColorStop(0.35, 'black'); grad.addColorStop(0.62, 'white'); grad.addColorStop(1, 'white')
    g.fillStyle = grad; g.fillRect(0, 0, 4, 256)
    return new THREE.CanvasTexture(c)
  }, [])
  const map = useMemo(() => {
    if (!tex) return null
    const t = tex.clone()
    t.wrapS = THREE.MirroredRepeatWrapping
    t.repeat.set(4, 1)
    t.needsUpdate = true
    return t
  }, [tex])
  if (!map) return null
  return (
    <mesh position={[0, 40 * k, 0]}>
      <cylinderGeometry args={[950 * k, 950 * k, 300 * k, 64, 1, true]} />
      <meshBasicMaterial map={map} alphaMap={alpha} transparent side={THREE.BackSide} fog={false} depthWrite={false} color="#e9d2c0" />
    </mesh>
  )
}

/** Sun with a shadow frustum that follows the active vehicle; position follows the (illustrative) local hour. */
function Sun({ quality }: { quality: 'low' | 'high' }) {
  const light = useRef<THREE.DirectionalLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const target = useMemo(() => new THREE.Object3D(), [])
  useFrame(() => {
    const r = sim.rover
    const h = lightingHour()
    const elev = Math.max(0.05, Math.sin(((h - 6) / 12) * Math.PI)) * 1.25        // radians
    const az = ((h - 6) / 12) * Math.PI                                           // east -> west
    const d = 160
    light.current?.position.set(r.x + Math.cos(az) * Math.cos(elev) * d, r.y + Math.sin(elev) * d, r.z - Math.sin(az) * 30 + 40)
    const dust = dustLevel()
    if (light.current) light.current.intensity = (0.3 + 2.4 * Math.min(1, Math.sin(elev) * 1.4)) * (1 - 0.65 * dust)
    if (hemi.current) hemi.current.intensity = (0.25 + 0.55 * Math.min(1, Math.sin(elev) * 1.6)) * (1 + 0.3 * dust)
    target.position.set(r.x, r.y, r.z)
    target.updateMatrixWorld()
  })
  const size = quality === 'high' ? 2048 : 1024
  return (
    <>
      <primitive object={target} />
      <hemisphereLight ref={hemi} args={[PAL.skyLight, PAL.ground, 0.75]} />
      <directionalLight ref={light} target={target} intensity={2.6} color={PAL.sun} castShadow
        shadow-mapSize={[size, size]} shadow-camera-left={-70} shadow-camera-right={70} shadow-camera-top={70} shadow-camera-bottom={-70}
        shadow-camera-near={10} shadow-camera-far={450} shadow-bias={-0.0004} />
    </>
  )
}

export function Scene({ world, resetSignal, quality }: { world: World; resetSignal: number; quality: 'low' | 'high' }) {
  const layer = useUI((s) => s.layer)
  const route = useUI((s) => s.route)
  const evaRoute = useUI((s) => s.evaRoute)
  const dest = useUI((s) => s.destination)
  const agent = useUI((s) => s.agent)
  const selected = useUI((s) => s.selected)
  const showM20 = useUI((s) => s.showM20)
  const renderPaused = useUI((s) => s.renderPaused)
  const mission = useUI((s) => s.mission)
  const showMission = useUI((s) => s.showMission)
  const showDest = dest && !(agent === 'rover' ? route : evaRoute)
  const earth = world.real?.planet === 'earth'
  PAL = earth ? EARTH : MARS
  const real = !!world.real?.surround   // real crater around the map replaces the illustrative horizon
  // The camera starts behind the rover, above the ground wherever the ground is (Earth terrain sits far above zero).
  const k = Math.max(1, world.size / 600)   // scene scale: the sky, fog and horizon were tuned on a 600 m map
  return (
    <Canvas frameloop={renderPaused ? 'never' : 'always'} shadows={{ type: THREE.PCFShadowMap }} flat={quality === 'high'} dpr={quality === 'high' ? [1, 1.5] : 1} camera={{ fov: 55, near: real ? 0.5 : 0.3, far: real ? 120_000 : 2500 * k, position: [sim.rover.x - 12, sim.rover.y + 7.5, sim.rover.z + 1] }}
      gl={{ antialias: quality === 'high', powerPreference: 'high-performance' }}>
      <color attach="background" args={[PAL.horizon]} />
      <fog attach="fog" args={[PAL.horizon, 180 * k, 900 * k]} />
      <Atmosphere k={k} far={real ? 60_000 : 0} />
      {/* Earth: the sky is a real photograph of a sky (Poly Haven, CC0; not taken at this site), and it also lights the scene. */}
      {earth ? <Environment files="/textures/earth/sky.hdr" background environmentIntensity={0.6} /> : <Sky k={k} radius={real ? 100_000 : undefined} />}
      {real ? <Surroundings world={world} /> : !earth && <HorizonBackdrop k={k} />}
      <ambientLight intensity={0.12} />
      <Sun quality={quality} />

      <Terrain world={world} layer={layer} onPick={(x, z) => {
        if (document.pointerLockElement) return
        actions.setDestination(x, z)
      }} />
      <Rocks world={world} />
      {earth && <Trees world={world} />}
      <Habitat world={world} />
      <LandingZone world={world} />
      <Hazards world={world} layer={layer} />
      {showM20 && <M20Paths world={world} />}
      {mission && showMission && <MissionOverlay world={world} mission={mission} />}
      <ExperimentLines world={world} />
      <StoryFx world={world} />
      <Sites world={world} selectedId={selected?.kind === 'site' ? selected.id : null} />
      <Rover />
      <Astronaut world={world} />
      {route && <RouteLine route={route} color="#5fd4e0" />}
      {evaRoute && <RouteLine route={evaRoute} color="#58c98b" />}
      {showDest && <DestinationMarker world={world} dest={dest} />}
      {quality === 'high' && <Dust />}

      <SimLoop world={world} />
      <CameraRig world={world} resetSignal={resetSignal} />
      {quality === 'high' && (
        <EffectComposer multisampling={0}>
          <N8AO aoRadius={2.2} intensity={2.2} distanceFalloff={1.2} halfRes />
          <Bloom luminanceThreshold={0.9} intensity={0.35} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Vignette offset={0.32} darkness={0.55} />
          <SMAA />
        </EffectComposer>
      )}
    </Canvas>
  )
}
