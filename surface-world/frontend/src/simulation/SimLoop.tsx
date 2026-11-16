import { useFrame } from '@react-three/fiber'
import { keys } from '@/hooks/useKeyboard'
import { actions } from '@/state/actions'
import { sim, ui } from '@/state/store'
import { autopilot, stepRover, type DriveInput } from './rover/physics'
import { stepAstronaut } from './astronaut/eva'
import { stepHabitat } from './habitat'
import { stepHealth } from './health'
import { stepRedHorizon } from '@/state/redHorizon'
import type { World } from './terrain/heightfield'

/**
 * The simulation tick, driven by the render loop (fixed small sub-steps for stable physics).
 * It reads keys and the current route; it never awaits the network or the AI.
 */
export function SimLoop({ world }: { world: World }) {
  useFrame((_, dtRaw) => {
    const s = ui.get()
    // Frame-rate independent: gaps up to 0.5 s are sub-stepped, so sim time tracks real time even at low fps.
    const dt = Math.min(dtRaw, 0.5) * sim.timeScale
    sim.fps = sim.fps * 0.95 + (1 / Math.max(dtRaw, 1e-3)) * 0.05
    const freeCam = s.camera === 'free'
    const fw = keys.has('ArrowUp') || (!freeCam && keys.has('KeyW'))
    const bk = keys.has('ArrowDown') || (!freeCam && keys.has('KeyS'))
    const lf = keys.has('ArrowLeft') || (!freeCam && keys.has('KeyA'))
    const rt = keys.has('ArrowRight') || (!freeCam && keys.has('KeyD'))
    const manual: DriveInput = { throttle: (fw ? 1 : 0) - (bk ? 1 : 0), steer: (rt ? 1 : 0) - (lf ? 1 : 0), brake: keys.has('Space') }
    const touching = manual.throttle !== 0 || manual.steer !== 0 || manual.brake

    let input = manual
    if (s.expedition === 'driving' && s.route) {
      if (touching) {
        actions.stopExpedition('manual override')
      } else {
        const ap = autopilot(s.route, world.rover.max_speed_mps)
        input = ap.input
        if (ap.arrived && Math.abs(sim.rover.speed) < 0.15) actions.arrived()
      }
    }

    const steps = Math.max(1, Math.ceil(dt / 0.016))
    let blocked: string | null = null
    for (let i = 0; i < steps; i++) blocked = stepRover(world, dt / steps, input) ?? blocked
    if (blocked && s.expedition === 'driving') actions.stopExpedition(blocked)

    // astronaut shares the same clock
    const evaDone = stepAstronaut(world, dt, s.evaRoute, s.eva === 'walking')
    if (evaDone && s.eva === 'walking') actions.evaArrived()

    stepHabitat(world, dt)
    stepHealth(world, dt)
    stepRedHorizon(world)
  })
  return null
}
