export interface Rock { x: number; z: number; r: number }
export interface Hazard { id: string; kind: string; label: string; x: number; z: number; r: number; penalty: number; note: string }
export interface Site { id: string; name: string; kind: string; x: number; z: number; description: string; simulated: boolean }
export interface Provenance { source: string; kind: string; seed: number | null; crs: string; resolution_m: number; note: string; citation: string | null }
export interface RoverParams {
  mass_kg: number; radius_m: number; max_slope_deg: number; max_speed_mps: number; battery_wh: number; rtg_charge_w: number
  flat_wh_per_m: number; drivetrain_eff: number; sand_energy_factor: number; rock_energy_factor: number; hotel_w: number
}
export interface AstronautParams {
  radius_m: number; max_slope_deg: number; walk_speed_mps: number; rest_w: number; walk_w: number; grade_w_per_unit: number
  suit_o2_g: number; suit_power_wh: number; suit_power_w: number; reserve_fraction: number
}
export type Region = 'jezero' | 'procedural' | 'shawnee'
export interface DataSource { id: string; title: string; mission: string; instrument: string; publisher: string; year: number; doi: string; citation: string; url: string }
export interface RealData {
  planet: 'mars' | 'earth'
  region: {
    name: string; centre_lat_deg: number; centre_lon_deg: number; landing_site_lat_lon: [number, number]; size_m: number; grid_n: number; cell_m: number
    datum_offset_m: number; elevation_min_m: number; elevation_max_m: number; hirise_coverage?: number; hirise_minus_ctx_median_m?: number | null
    nasadem_minus_3dep_median_m?: number
  }
  processing: string[]; retrieved: string; sources: DataSource[]; ortho: string
  themis: { n: number; values_b64: string; min: number; max: number } | null
  m20: M20Paths | null
  /** 80 km of real terrain around the map (CTX), heights relative to the region datum */
  surround: { n: number; size_m: number; heights_b64: string; image: string; image_coverage: number | null } | null
}
/** NASA/JPL Mars 2020 localization: Perseverance drives and Ingenuity flights inside the region (local metres). */
export interface M20Paths {
  drives: { sol: number; length_m: number; path: [number, number][] }[]
  stops: { sol: number; site: number; drive: number; x: number; z: number; elev_m: number | null }[]
  flights: { flight: number; sol: number; length_m: number; path: [number, number][] }[]
  landings: { flight: number; sol: number; x: number; z: number }[]
  summary: { drive_m: number; sols: [number, number] | null; flights: number[]; dtm_minus_rover_elev_median_m: number | null }
}
export interface TerrainResponse {
  region: Region; real: RealData | null; hazard_b64: string; rough_b64: string | null
  size_m: number; n: number; cell_m: number; heights_b64: string; slope_b64: string
  rocks: Rock[]; hazards: Hazard[]; sites: Site[]; habitat: [number, number]; landing_zone: [number, number]
  provenance: Provenance; rover: RoverParams; astronaut: AstronautParams
}
type Plan = { length_m: number; length_ratio: number; mean_deviation_m: number; corridor_agreement: number; max_slope: number; mean_roughness: number; path: [number, number][] } | { error: string }
export interface Experiment {
  hypothesis: string; method: string; n_drives: number; best_mode: RouteMode | null; limits: string; findings: string[]
  summary: Record<string, { drives: number; median_deviation_m: number; median_corridor_agreement: number; share_within_10m: number; median_length_ratio: number }>
  straight_line_median_deviation_m: number | null; real_max_slope_overall: number | null; real_median_max_slope: number | null
  detours: { threshold_m: number; drives: number; planner_closer: number; median_planner_deviation_m: number | null; median_straight_deviation_m: number | null }
  drives: { sol: number; real_length_m: number; real_max_slope: number; straight_line_deviation_m: number; real_path: [number, number][]; plans: Record<string, Plan> }[]
}
export type RouteMode = 'fast' | 'balanced' | 'safe'
export type Agent = 'rover' | 'astronaut'
export interface Route {
  path: [number, number, number][]
  distance_m: number; straight_line_m: number; energy_wh: number; max_slope_deg: number; mean_slope_deg: number
  hazard_segments: { start: number; end: number; kind: string; label: string }[]
  hazards_avoided: string[]; hazards_crossed: string[]; mode: RouteMode; goal_adjusted: boolean; explanation: string[]; expanded_nodes: number
  agent: Agent; travel_time_s: number; elevation_gain_m: number; o2_g: number | null
}

/** A stop of the mission planned in the main map, in this world's frame. */
export interface MissionSite { id: string; name: string; objective: string; visited: boolean; x: number; z: number; inside: boolean }
/** The mission planned in the main map (mission service), placed in this world's frame by the backend. */
export interface MissionPlan {
  id: string; name: string; mover: string; mover_name: string; mover_kind: string; limit_deg: number | null
  revision: number | null; planned: boolean
  base: MissionSite; targets: MissionSite[]
  /** each point is [x, z, 1 when the 1 m elevation model measures this ground as steeper than the limit] */
  legs: { to: string; points: [number, number, number][]; distance_m: number; max_slope_deg: number | null }[]
  keep_outs: { x: number; z: number; r: number; source: string; reason: string; inside: boolean }[]
  steep: { x: number; z: number; length_m: number; max_slope_deg: number; inside: boolean }[]
  distance_m: number; inside_m: number; seconds: number | null
  feasible: boolean | null; feasibility_reason: string
  fine: { clear: boolean; stretches: number; over_limit_m: number; limit_deg: number; max_slope_deg: number; rounds: number; keep_outs: number; summary: string } | null
  position: { x: number; z: number; phase: string; inside: boolean } | null
  world_half_m: number
}
/** Mission id handed over by the main map (?mission=...). Without one, the newest planned mission is used. */
export const MISSION_ID = new URLSearchParams(location.search).get('mission')
/** True when the world is shown inside the mission map's pane (?embed=1): its own help overlay starts closed. */
export const EMBEDDED = new URLSearchParams(location.search).get('embed') === '1'

/** True in the shared copy published as static files: there is no server to plan routes or read a mission. */
export const STATIC = import.meta.env.VITE_STATIC === '1'
const noServer = <T,>(what: string): Promise<T> => Promise.reject(new Error(`${what} needs the full app; this shared copy has no server behind it`))

/** Map region, from the URL (?region=procedural). Real NASA terrain (Jezero) is the default. */
const asked = new URLSearchParams(location.search).get('region')
export const REGION: Region = asked === 'procedural' || asked === 'shawnee' ? asked : 'jezero'

export function switchRegion(region: Region) {
  const u = new URL(location.href)
  if (region === 'jezero') u.searchParams.delete('region'); else u.searchParams.set('region', region)
  u.searchParams.set('intro', '0')
  location.assign(u.toString())
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = res.statusText
    try { const b = await res.json(); msg = typeof b.detail === 'string' ? b.detail : JSON.stringify(b.detail) } catch { /* keep */ }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export const api = {
  mission: (id: string | null) => STATIC ? noServer<MissionPlan>('The mission link') : fetch(`/api/mission${id ? `?id=${encodeURIComponent(id)}` : ''}`).then((r) => json<MissionPlan>(r)),
  missionDrive: (id: string | null, start: [number, number], agent: Agent) =>
    STATIC ? noServer<Route>('Driving a mission') : fetch('/api/mission/drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, start, agent }) }).then((r) => json<Route>(r)),
  experiment: () => STATIC ? noServer<Experiment>('The route experiment') : fetch('/api/experiment').then((r) => json<Experiment>(r)),
  terrain: (region: Region) => fetch(STATIC ? `./api/terrain-${region}.json` : `/api/terrain?region=${region}`).then((r) => json<TerrainResponse>(r)),
  route: (start: [number, number], goal: [number, number], mode: RouteMode, agent: Agent = 'rover', region: Region = REGION) =>
    STATIC ? noServer<Route>('Route planning') : fetch('/api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start, goal, mode, agent, region }) }).then((r) => json<Route>(r)),
}

export function decodeF32(b64: string): Float32Array {
  const bin = atob(b64)
  const buf = new ArrayBuffer(bin.length)
  const u8 = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return new Float32Array(buf)
}
