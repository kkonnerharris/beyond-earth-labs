import type { Kind } from '@/dashboard/HUD'
import type { World } from '@/simulation/terrain/heightfield'

export type StoryFx = 'none' | 'landing' | 'flight1' | 'traverse' | 'experiment' | 'habitat'
export interface Chapter {
  kicker: string
  title: string
  text: string
  tags: Kind[]
  cam: { pos: [number, number, number]; target: [number, number, number] }
  fx: StoryFx
}

/**
 * The mission story: real places and dates from NASA data, told in six beats, ending with the user in
 * control. Positions come from the loaded data (sites, Mars 2020 paths), never hard-coded guesses.
 */
export function buildStory(world: World, exp: { median: number; within10: number; detours: [number, number] } | null): Chapter[] {
  const site = (id: string) => world.sites.find((s) => s.id === id)
  const at = (x: number, z: number, dx: number, up: number, dz: number) => {
    const y = world.heightAt(x, z)
    return { pos: [x + dx, y + up, z + dz] as [number, number, number], target: [x, y + 1, z] as [number, number, number] }
  }
  const land = site('site-perseverance')
  const wb = site('site-wright-brothers')
  const m = world.m20
  const [hx, hz] = world.habitat
  const out: Chapter[] = [
    {
      kicker: 'Jezero Crater · more than 3.5 billion years ago',
      title: 'A river delta, inside a lake',
      text: 'Jezero is a 45 km impact crater. Long ago a river flowed in from the west and built the delta on the horizon, inside a lake. Lakes like this are where signs of ancient life could have been preserved, which is why NASA sent Perseverance here. Everything you see is real orbital data.',
      tags: ['NASA'],
      cam: { pos: [14000, 9000, 14000], target: [-6000, 0, -4000] },
      fx: 'none',
    },
  ]
  if (land) out.push({
    kicker: '18 February 2021',
    title: 'Perseverance lands',
    text: 'NASA\'s Perseverance rover touches down here, at what is now called Octavia E. Butler Landing, about 2 km from the delta front. The marker is placed from NASA JPL\'s published coordinates.',
    tags: ['NASA'],
    cam: at(land.x, land.z, 70, 55, 70),
    fx: 'landing',
  })
  if (wb) out.push({
    kicker: '19 April 2021 · sol 58',
    title: 'The first flight on another planet',
    text: 'From Wright Brothers Field, the Ingenuity helicopter makes the first powered, controlled flight on another world. It goes on to fly 72 times. The dashed amber lines are its real flight paths.',
    tags: ['NASA'],
    cam: at(wb.x, wb.z, -45, 30, 45),
    fx: 'flight1',
  })
  if (m) out.push({
    kicker: `Sols ${m.summary.sols?.join('–')} on this map`,
    title: `${(m.summary.drive_m / 1000).toFixed(1)} km toward the delta`,
    text: 'Each white line is a real drive, localized by the Mars 2020 team on the same HiRISE map this app uses. Their recorded elevations match our terrain to within centimetres.',
    tags: ['NASA', 'CALC'],
    cam: { pos: [150, 2200, 1900], target: [0, 0, 350] },   // aimed south so the early drives sit above the story card
    fx: 'traverse',
  })
  if (m && exp) out.push({
    kicker: 'Our experiment',
    title: 'Would our planner drive the same way?',
    text: `We planned a route between the endpoints of every real drive, using only slope and roughness from the NASA terrain. The plans stayed a median ${exp.median} m from where Perseverance actually drove, ${Math.round(exp.within10 * 100)}% within 10 m. Where the rover detoured, the planner explained the detour better than a straight line in ${exp.detours[0]} of ${exp.detours[1]} drives.`,
    tags: ['NASA', 'CALC'],
    cam: { pos: [0, 400, 1], target: [0, 0, 0] },   // replaced by the drive framing in the camera rig
    fx: 'experiment',
  })
  out.push({
    kicker: 'Next: humans',
    title: 'Your turn: plan the first Marswalk',
    text: 'The first crews will be 4–24 light-minutes from Earth, too far to wait for permission. Pick a destination, and the planner checks whether the suit\'s oxygen covers the walk out, the walk back and a 25% reserve.',
    tags: ['SIM', 'CALC'],
    cam: at(hx, hz, -30, 18, 32),
    fx: 'habitat',
  })
  return out
}
