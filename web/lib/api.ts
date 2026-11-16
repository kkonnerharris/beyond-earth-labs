// Typed clients for the two services. The interface never computes mission
// values itself: it sends commands and draws what the services return.

import { BASE, STATIC } from "./base";
import { staticRequest } from "./staticBackend";

export type RoutePoint = {
  x: number; y: number; lon: number; lat: number;
  elevation_m: number; slope_deg: number; dist_m: number; seconds: number; joules: number;
};

export type Route = {
  objective: string; profile: string; points: RoutePoint[];
  distance_m: number; straight_line_m: number; seconds: number; joules: number;
  ascent_m: number; descent_m: number; max_slope_deg: number; mean_slope_deg: number;
  slope_limit_deg: number; explanation: string[];
};

export type Site = {
  id: string; name: string; kind: string; x: number; y: number; lon: number; lat: number;
  elevation_m: number; slope_deg: number; objective?: string; dwell_min: number; visited: boolean;
};

export type Feasibility = {
  ok: boolean; resource: string; needed: number; needed_with_reserve: number;
  available: number; margin: number; reserve_fraction: number; reason: string;
};

export type Plan = {
  legs: Route[]; distance_m: number; seconds: number; move_seconds: number; joules: number;
  max_slope_deg: number; feasibility: Feasibility; revision: number; reason: string;
};

export type Hazard = { id: string; x: number; y: number; radius_m: number; reason: string; source?: string };

/** One stretch of the route steeper than the mover's limit on NASA's 1 m elevation model. */
export type FineStretch = { start_m: number; end_m: number; length_m: number; max_slope_deg: number;
                            x: number; y: number; lon: number; lat: number };
export type FineReference = {
  length_m: number; checked_m: number; slope_deg: Record<string, number>; roughness_m?: Record<string, number>;
  fraction_steeper_than: Record<string, number>;
  waypoint_elevation_minus_model_m?: { n: number; median: number; median_abs_deviation: number }; note: string;
};
/** The current plan measured on the 1 m HiRISE elevation model. */
export type FineCheck = {
  revision: number; limit_deg: number; length_m: number; checked_m: number; no_data_m: number; over_limit_m: number;
  slope_deg: Record<string, number>; roughness_m: Record<string, number>; stretches: FineStretch[];
  profile?: { spacing_m: number; elevation_m: (number | null)[]; slope_deg: (number | null)[] };
  perseverance?: FineReference;
  source?: { title: string; mission: string; instrument: string; doi: string; publisher: string; native_cell_m: number };
  method: string; limits: string;
  clear: boolean; rounds: number; keep_outs: number; unavoidable: FineStretch[];
  first_found: { stretches: number; over_limit_m: number; max_slope_deg: number; distance_m: number } | null;
  added_m: number; summary: string;
};

export type Sim = {
  phase: "idle" | "moving" | "at_target" | "holding" | "complete" | "aborted" | "manual";
  seconds: number; x: number; y: number; lon: number; lat: number;
  elevation_m: number; slope_deg: number; heading_deg: number; speed_ms: number; distance_m: number;
  resource: string; capacity: number; remaining: number;
  return_need_with_reserve: number; return_margin: number; return_distance_m: number;
  leak_per_hour: number; pace_factor: number; dust_tau: number; turned_back: boolean; replans: number;
  active_legs: Route[]; emergencies: { id: string; kind: string; t_seconds: number; detail: string }[];
  track: [number, number][];
  health: { monitored: boolean; metabolic_w: number; heart_rate_bpm: number; expected_heart_rate_bpm: number;
            fatigue: number; anomaly: boolean; heart_rate_history: number[] };
};

export type Assumption = { key: string; label: string; value: number; unit: string; basis: string; verify: boolean };

export type Habitat = {
  assumptions: Assumption[];
  oxygen_need_kg_per_sol: number; oxygen_from_plants_kg_per_sol: number;
  oxygen_recycled_kg_per_sol: number; oxygen_makeup_kg_per_sol: number;
  water_need_kg_per_sol: number; water_through_crops_kg_per_sol: number;
  water_makeup_kg_per_sol: number; water_makeup_kg_mission: number; oxygen_makeup_kg_mission: number;
  food_need_kcal_per_sol: number; food_grown_kcal_per_sol: number; food_grown_share: number;
  food_shipped_dry_kg_mission: number; grow_area_m2: number; grow_light_kwh_per_sol: number;
  load_kwh_per_sol: number; solar_kwh_per_sol: number; power_margin_kwh_per_sol: number;
  battery_hours_at_load: number; sunlight_w_m2_daily_mean: number; findings: string[];
  radiation_msv_per_sol: number; radiation_msv_stay: number; radiation_share_of_career_limit: number;
};

export type MissionEvent = { t_seconds: number; kind: string; message: string };

export type Mission = {
  id: string; name: string; body: string; created_utc: string; mover: string;
  objective: "time" | "energy"; risk_weight: number; base: Site; targets: Site[]; hazards: Hazard[];
  plan: Plan | null; sim: Sim; crew: number; sols: number; crop_area_m2: Record<string, number>;
  overrides: Record<string, number>; habitat: Habitat; events: MissionEvent[]; disclaimer: string;
  score: { total: number; rank: string; note: string; lines: { label: string; points: number; max: number; why: string }[] } | null;
  fine_check: FineCheck | null;
};

export type Profile = {
  key: string; name: string; kind: "rover" | "astronaut"; mass_kg: number; max_slope_deg: number;
  max_roughness_m: number; speed_flat_ms: number; battery_wh?: number; oxygen_kg?: number; basis: string;
};

export type Terrain = {
  name: string; body: string;
  grid: { n: number; cell_m: number; size_m: number; lat0: number; lon0: number;
          corners_lonlat_tl_tr_br_bl: [number, number][] };
  units: Record<string, string>;
  elevation_source: { title: string; mission: string; instrument: string; doi: string; publisher: string;
                      native_cell_m: number; url: string };
  statistics: { elevation_m: [number, number];
                slope_deg: { median: number; p90: number; max: number };
                roughness_m: { median: number; p90: number } };
  landing_site: { name: string; lat: number; lon: number; x: number; y: number };
  overlays: Record<string, { file?: string; kind?: string; unavailable?: string;
                             ramp?: { value: number; rgb: [number, number, number] }[] }>;
  m2020: { traverse_segments: number; waypoints: number };
  validation: {
    traverse_cells?: number;
    slope_deg_on_traverse?: Record<string, number>;
    slope_deg_whole_area?: Record<string, number>;
    fraction_of_area_steeper_than?: Record<string, number>;
    fraction_of_traverse_steeper_than?: Record<string, number>;
    waypoint_elevation_minus_model_m?: { n: number; median: number; median_abs_deviation: number };
    note?: string;
  };
  /** The 1 m measure along Perseverance's path, when it has been built. */
  validation_1m?: FineReference;
};

export type M2020 = {
  credit: string;
  traverse: { sol: number | null; points: [number, number, number, number][] }[];
  waypoints: { sol: number | null; lon: number; lat: number; x: number; y: number }[];
};

export type LayerInfo = { key: string; body: string; title: string; mission: string; kind: string;
                          source: string; tiles: string; max_zoom: number };

export type AnalogCandidate = {
  rank: number; region: string; name: string; lat: number; lon: number; score: number;
  body: "mars" | "moon" | "earth";
  embedding_similarity: number; physical_similarity: number; physical_distance_sd: number;
  support: string; shared_processes: string[]; documented_analog_for: string[]; citation: string; note: string;
  cells: number; attributes: { attribute: string; query: number; candidate: number; ratio: number }[];
};

export type AnalogResult = {
  query: { region: string; name: string; body: string; lat: number; lon: number; processes: string[];
           citation: string; cells: number; measured: Record<string, number>;
           target_body: "mars" | "moon" | "earth"; control: boolean; note: string };
  candidates: AnalogCandidate[]; method: string;
};

export type RegionInfo = {
  region: string; key: string; name: string; body: string; lat: number; lon: number; processes: string[];
  note: string; citation: string; cells: number; measured: Record<string, number | null>;
  control?: boolean; analog_for?: string[];
};

export type ClimatePeriod = {
  years: [number, number]; complete: boolean; mean_temperature_c: number; annual_precipitation_mm: number;
  mean_solar_mj_m2_day: number; growing_season_months: number; growing_season_days: number;
  growing_season_light_mol_m2_day: number | null; monthly_temperature_c: number[];
};
export type Climate = {
  region: { region: string; name: string; note: string }; lat: number; lon: number; elevation_m: number;
  periods: { early: ClimatePeriod; recent: ClimatePeriod };
  change: { temperature_c: number; precipitation_mm: number; precipitation_percent: number; growing_season_days: number } | null;
  conventions: { growing_season: string; light: string };
  source: { title: string; url: string; note: string };
};

export type GroundViews = {
  available: boolean; reason?: string; same_stop?: boolean; note?: string; source?: string;
  waypoint?: { sol: number; distance_m: number; lon: number; lat: number };
  images?: { id: string; title: string; date_utc: string; small: string; large: string; credit: string; mast_elevation_deg: number }[];
};

export type Clps = {
  source: { title: string; publisher: string; url: string; page_last_updated: string; read_on: string };
  deliveries: { id: string; tense: "past" | "planned"; nasa_text: string; site: string | null; region: string | null; region_basis?: string }[];
  note: string;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  if (STATIC) return staticRequest<T>(url, init);   // the shared copy: no server behind it
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" }, cache: "no-store" });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const b = body as { error?: string; detail?: string; mission?: Mission } | null;
    const err = new Error(b?.error ?? b?.detail ?? `${res.status} ${res.statusText}`) as Error & { mission?: Mission };
    if (b?.mission) err.mission = b.mission;
    throw err;
  }
  return body as T;
}

const M = `${BASE}/svc/mission`;
const S = `${BASE}/svc/science`;
// Map tiles go straight to the science service: hundreds of tile requests through the web proxy
// were seen to drop connections. Everything else uses the same-origin proxy paths above.
// In the shared copy the tiles are saved files beside the page; the map needs their full address.
const tilesBase = () => (STATIC ? `${typeof window === "undefined" ? "" : window.location.origin}${BASE}/svc/science`
                                 : process.env.NEXT_PUBLIC_SCIENCE_URL ?? "http://127.0.0.1:8310");
const post = (body?: unknown): RequestInit => ({ method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const missionApi = {
  health: () => request<{ ok: boolean }>(`${M}/health`),
  profiles: () => request<{ profiles: Profile[]; reserves: { oxygen: number; battery: number } }>(`${M}/profiles`),
  create: (name: string, mover: string) => request<Mission>(`${M}/missions`, post({ name, mover })),
  addTarget: (id: string, lon: number, lat: number, name: string, objective: string, dwell_min: number) =>
    request<Mission>(`${M}/missions/${id}/targets`, post({ lon, lat, name, objective, dwell_min })),
  clearTargets: (id: string) => request<Mission>(`${M}/missions/${id}/targets`, { method: "DELETE" }),
  plan: (id: string, mover: string, objective: string, risk_weight: number) =>
    request<Mission>(`${M}/missions/${id}/plan`, post({ mover, objective, risk_weight })),
  habitat: (id: string, crew: number, sols: number, crop_area_m2: Record<string, number>, overrides: Record<string, number>) =>
    request<Mission>(`${M}/missions/${id}/habitat`, post({ crew, sols, crop_area_m2, overrides })),
  sim: (id: string, action: "start" | "step" | "reset" | "emergency" | "drive",
        body?: { seconds?: number; kind?: string; heading_deg?: number; distance_m?: number }) =>
    request<Mission>(`${M}/missions/${id}/sim/${action}`, post(body ?? {})),
  /** Measure the plan on NASA's 1 m elevation model; with `avoid`, also move the route off steep ground. */
  fineCheck: (id: string, avoid: boolean) => request<Mission>(`${M}/missions/${id}/finecheck`, post({ avoid })),
  sample: (lon: number, lat: number) =>
    request<{ sample: { elevation_m: number; slope_deg: number; roughness_m: number; lon: number; lat: number; x: number; y: number };
              enterable: Record<string, boolean> }>(`${M}/terrain/sample?lon=${lon}&lat=${lat}`),
};

export const scienceApi = {
  health: () => request<{ ok: boolean; model: string | null }>(`${S}/health`),
  terrain: () => request<Terrain>(`${S}/jezero/terrain`),
  m2020: () => request<M2020>(`${S}/jezero/m2020`),
  layers: () => request<LayerInfo[]>(`${S}/layers`),
  regions: (body: string) => request<RegionInfo[]>(`${S}/regions?body=${body}`),
  analogs: (region: string, top = 8, target?: string) =>
    request<AnalogResult>(`${S}/analogs?region=${encodeURIComponent(region)}&top=${top}${target ? `&target=${target}` : ""}`),
  terrain3d: () => request<Terrain3D>(`${S}/jezero/terrain3d`),
  demUrl: () => `${tilesBase()}/jezero/dem/{z}/{x}/{y}.png`,
  model: () => request<Record<string, unknown>>(`${S}/model`),
  views: (x: number, y: number) => request<GroundViews>(`${S}/jezero/views?x=${x.toFixed(1)}&y=${y.toFixed(1)}`),
  clps: () => request<Clps>(`${S}/clps`),
  climate: (region: string) => request<Climate>(`${S}/earth/climate?region=${encodeURIComponent(region)}`),
  overlayUrl: (name: string) => `${S}/jezero/overlay/${name}.png`,
  tileUrl: (key: string) => `${tilesBase()}/tiles/${key}/{z}/{x}/{y}.png`,
};

export const MARS_RADIUS_M = 3396190;
export const MOON_RADIUS_M = 1737400;
export type Body = "mars" | "moon" | "earth";
export const BODY_RADIUS_M: Record<Body, number> = { mars: 3396190, moon: 1737400, earth: 6371008.8 };
export const BODY_NAME: Record<Body, string> = { mars: "Mars", moon: "Moon", earth: "Earth" };
export type Terrain3D = {
  tiles: string; encoding: string; tile_size: number; max_zoom: number;
  bounds_lonlat: [number, number, number, number]; base_elevation_m: number; note: string;
};
