"use client";

import { useMemo, useState } from "react";
import type { AnalogResult, Climate, Clps, Mission, Profile, RegionInfo, Route, Terrain } from "@/lib/api";
import { fmtDistance, fmtDuration, fmtEnergy, resourceLabel } from "@/lib/geo";
import { Chip, Grid, Meter, Note, Row, Section, Stat } from "./ui";

const ATTR_LABEL: Record<string, [string, string]> = {
  slope_median_deg: ["Median slope", "°"],
  slope_p90_deg: ["Steep-ground slope (90th pct.)", "°"],
  relief_m: ["Relief", "m"],
  roughness_m: ["Roughness", "m"],
  tri_m: ["Ruggedness index", "m"],
};
const PROCESS_LABEL: Record<string, string> = {
  volcanic: "Volcanic", fluvial: "River-carved", lacustrine: "Lake / playa", aeolian: "Wind-shaped",
  impact: "Impact", tectonic: "Tectonic", periglacial: "Ground ice", hydrothermal: "Hydrothermal",
  megaflood: "Megaflood", vegetated: "Vegetated",
};

/* ------------------------------------------------------------------ 1. Region */

export function StepRegion({ terrain, regions, selected, onSelect, onJezero, lunar: moonMode, earth, onAnalogs }: {
  terrain: Terrain | null; regions: RegionInfo[]; selected: string | null;
  onSelect: (r: RegionInfo) => void; onJezero: () => void; lunar?: boolean; earth?: boolean;
  /** Mars only: go to the analog step for the region being looked at. */
  onAnalogs?: () => void;
}) {
  const lunar = moonMode || earth;
  const v = terrain?.validation;
  const sorted = useMemo(() => [...regions].sort((a, b) => a.name.localeCompare(b.name)), [regions]);
  // On Mars the mission lives at Jezero. Any other selected region is a look elsewhere, and says so.
  const away = !lunar && selected !== "mars:jezero" ? regions.find((r) => r.region === selected) ?? null : null;
  return (
    <>
      {away && (
        <Section title="Another region" kind="calc" action={<button className="btn shrink-0 whitespace-nowrap" onClick={onJezero}>Back to Jezero</button>}>
          <p className="text-[13px] leading-snug text-text">
            {away.name}: median slope <span className="num">{away.measured.slope_median_deg?.toFixed(1)}°</span>, relief <span className="num">{away.measured.relief_m?.toFixed(0)} m</span>.
          </p>
          <p className="mt-1.5 text-[12px] leading-snug text-muted">
            Regional terrain and Earth analogs work here. The route, the habitat and the traverse stay at Jezero, where this build has metre-scale elevation.
          </p>
          {onAnalogs && <button className="btn mt-2 w-full" onClick={onAnalogs}>Compare {away.name} with Earth</button>}
        </Section>
      )}
      {!lunar && <Section title="Mission area" kind="obs" action={<button className="btn" onClick={onJezero}>Go to map</button>}>
        {terrain ? (
          <>
            <p className="mb-2.5 text-[13px] text-text">{terrain.name}: a {(terrain.grid.size_m / 1000).toFixed(1)} km square on the western delta, including the Perseverance landing site.</p>
            <Grid>
              <Stat label="Lowest ground" value={terrain.statistics.elevation_m[0].toFixed(0)} unit="m" />
              <Stat label="Highest ground" value={terrain.statistics.elevation_m[1].toFixed(0)} unit="m" />
              <Stat label="Median slope" value={terrain.statistics.slope_deg.median.toFixed(1)} unit="°" />
              <Stat label="Steepest cell" value={terrain.statistics.slope_deg.max.toFixed(1)} unit="°" />
            </Grid>
            <p className="mt-2.5 text-[11.5px] leading-snug text-muted">
              Elevation: {terrain.elevation_source.title} ({terrain.elevation_source.mission}, {terrain.elevation_source.instrument}),
              doi:{terrain.elevation_source.doi}. Slope is measured over a {terrain.grid.cell_m} m baseline.
            </p>
          </>
        ) : <Note>Terrain has not loaded. Is the science service running?</Note>}
      </Section>}

      {!lunar && v?.waypoint_elevation_minus_model_m && (
        <Section title="Checked against the real rover" kind="calc">
          <p className="mb-2 text-[12px] leading-snug text-muted">
            Perseverance&apos;s published positions are an independent test of this map.
          </p>
          <Row label={`Elevation at ${v.waypoint_elevation_minus_model_m.n} rover waypoints, mission minus map`}>
            {v.waypoint_elevation_minus_model_m.median.toFixed(1)} m median
          </Row>
          <Row label="Steepest ground the rover crossed">{v.slope_deg_on_traverse?.max.toFixed(1)}°</Row>
          <Row label="Share of the area steeper than 20°">{((v.fraction_of_area_steeper_than?.["20"] ?? 0) * 100).toFixed(1)}%</Row>
          <Row label="Share of the rover's path steeper than 20°">{((v.fraction_of_traverse_steeper_than?.["20"] ?? 0) * 100).toFixed(1)}%</Row>
          <p className="mt-2 text-[11.5px] leading-snug text-muted">{v.note}</p>
          {terrain?.validation_1m && (
            <div className="mt-2.5 border-t border-line pt-2.5">
              <p className="mb-1.5 text-[12px] leading-snug text-muted">
                The same path measured on NASA&apos;s 1 m HiRISE elevation model, which is what planned routes are checked against:
              </p>
              <Row label={`99% of the ${(terrain.validation_1m.length_m / 1000).toFixed(1)} km path is under`}>{terrain.validation_1m.slope_deg.p99?.toFixed(1)}°</Row>
              <Row label="Steepest point on the path at 1 m">{terrain.validation_1m.slope_deg.max?.toFixed(1)}°</Row>
              <Row label="Share of the path steeper than 20° at 1 m">{((terrain.validation_1m.fraction_steeper_than?.["20"] ?? 0) * 100).toFixed(1)}%</Row>
            </div>
          )}
        </Section>
      )}

      <Section title={earth ? "Earth sites" : lunar ? "Lunar regions" : "Other regions"} kind="calc">
        <p className="mb-2 text-[12px] leading-snug text-muted">
          {lunar
            ? (earth
              ? "Documented planetary analog sites, plus control regions (amber on the map) that nobody proposes as analogs. Median slope and relief are from NASADEM elevation."
              : "Median slope and relief of each region, measured from LOLA elevation. Select one to compare it with Earth.")
            : "Median slope and relief from MOLA elevation. Regional analysis and Earth analogs work for any of these. Detailed routes need metre-scale elevation, which this build has for Jezero only."}
        </p>
        <ul className={`scroll-thin -mx-1 overflow-y-auto ${lunar ? "max-h-[38vh]" : "max-h-64"}`}>
          {sorted.map((r) => (
            <li key={r.region}>
              <button onClick={() => onSelect(r)} aria-pressed={selected === r.region}
                      className={`flex w-full items-baseline justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-raised ${selected === r.region ? "bg-raised text-text" : "text-muted"}`}>
                <span className="truncate text-[12.5px]">{r.name}</span>
                <span className="num shrink-0 text-[11px] text-faint">{r.measured.slope_median_deg?.toFixed(1)}° · {r.measured.relief_m?.toFixed(0)} m</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------ Lunar deliveries */

export function ClpsBrowser({ clps, selected, onRegion }: { clps: Clps | null; selected: string | null; onRegion: (region: string) => void }) {
  const [show, setShow] = useState<"all" | "past" | "planned">("all");
  if (!clps) return <Section title="NASA lunar deliveries" kind="obs"><p className="text-[12px] text-muted">Loading NASA&apos;s delivery list…</p></Section>;
  const rows = clps.deliveries.filter((d) => show === "all" || d.tense === show);
  return (
    <Section title="NASA lunar deliveries (CLPS)" kind="obs">
      <p className="mb-2 text-[12px] leading-snug text-muted">
        Commercial landers carrying NASA payloads to the Moon. Each entry is NASA&apos;s own sentence. Where a named site falls in a region this build has measured, you can open its terrain and Earth analogs.
      </p>
      <div className="mb-2 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Show deliveries">
        {([["all", "All"], ["past", "Flown"], ["planned", "Planned"]] as const).map(([k, label]) => (
          <button key={k} role="radio" aria-checked={show === k} onClick={() => setShow(k)} className={`btn ${show === k ? "border-mars text-mars-soft" : ""}`}>{label}</button>
        ))}
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((d) => (
          <li key={d.id} className={`rounded-md border px-2.5 py-2 ${d.region && d.region === selected ? "border-mars bg-mars/10" : "border-line bg-raised"}`}>
            <div className="flex items-center gap-2">
              <span className="num text-[11.5px] font-medium text-text">{d.id}</span>
              <span className={`chip ${d.tense === "past" ? "chip-obs" : "chip-assume"}`}>{d.tense === "past" ? "Flown" : "Planned"}</span>
              <span className="flex-1" />
              {d.site && <span className="truncate text-[11px] text-muted">{d.site}</span>}
            </div>
            <p className="mt-1 text-[12px] leading-snug text-muted">{d.nasa_text}</p>
            {d.region && (
              <button className="btn mt-1.5 h-7 w-full text-[11.5px]" onClick={() => onRegion(d.region!)} title={d.region_basis}>
                Terrain and Earth analogs for this site
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-faint">
        Source: {clps.source.publisher}, &quot;{clps.source.title}&quot;, page last updated {clps.source.page_last_updated}, read {clps.source.read_on}. {clps.note}
      </p>
    </Section>
  );
}

/* ----------------------------------------------------------------- 2. Analogs */

function SimBar({ label, value, kind }: { label: string; value: number; kind: "model" | "calc" }) {
  return (
    <div className="grid grid-cols-[112px_1fr_38px] items-center gap-2">
      <span className="text-[11.5px] text-muted">{label}</span>
      <Meter value={value} max={1} tone={kind === "model" ? "mars" : "signal"} label={label} />
      <span className="num text-right text-[11.5px]">{value.toFixed(2)}</span>
    </div>
  );
}

const BODY_LABEL: Record<string, string> = { mars: "Mars", moon: "Moon", earth: "Earth" };
const ELEVATION_SOURCE: Record<string, string> = { mars: "MOLA", moon: "LOLA", earth: "NASADEM" };

export function StepAnalogs({ result, loading, error, region, onRun, modelReady, target = "earth", onOpen }: {
  result: AnalogResult | null; loading: boolean; error: string | null; region: RegionInfo | null;
  onRun: () => void; modelReady: boolean; target?: string;
  /** Opens a candidate on its own world's map, so a match can be looked at where it is. */
  onOpen?: (region: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const fromEarth = region?.body === "earth";
  const qBody = BODY_LABEL[result?.query.body ?? region?.body ?? "mars"];
  const tBody = BODY_LABEL[result?.query.target_body ?? target];
  return (
    <>
      <Section title={fromEarth ? `${BODY_LABEL[target]} match search` : "Earth analog search"} kind="model">
        <p className="mb-2.5 text-[12.5px] leading-snug text-muted">
          The terrain network compares {region?.name ?? "the selected region"} with {""}
          every {BODY_LABEL[target]} region it knows, then elevation data on both bodies checks the match independently.
        </p>
        <button className="btn btn-primary h-auto min-h-[30px] w-full py-1.5 leading-tight" onClick={onRun} disabled={loading || !modelReady || !region}>
          {loading ? "Comparing terrain…" : fromEarth ? `Find ${BODY_LABEL[target]} terrain like ${region?.name ?? "…"}` : `Find Earth analogs for ${region?.name ?? "…"}`}
        </button>
        {!modelReady && <div className="mt-2"><Note tone="warn">No trained terrain model is available yet, so analog search is switched off.</Note></div>}
        {error && <div className="mt-2"><Note tone="bad">{error}</Note></div>}
      </Section>

      {result && (
        <>
          <Section title={`Measured terrain: ${result.query.name}`} kind="calc">
            <Grid>
              <Stat label="Median slope" value={result.query.measured.slope_median_deg?.toFixed(2)} unit="°" />
              <Stat label="Relief" value={result.query.measured.relief_m?.toFixed(0)} unit="m" />
              <Stat label="Roughness" value={result.query.measured.roughness_m?.toFixed(0)} unit="m" />
            </Grid>
            <p className="mt-2 text-[11.5px] leading-snug text-muted">
              Median of {result.query.cells} cells of 11.2 km, from {ELEVATION_SOURCE[result.query.body] ?? "MOLA"} elevation at 467 m. Documented processes: {result.query.processes.map((q) => PROCESS_LABEL[q] ?? q).join(", ") || "none listed"}.
            </p>
          </Section>

          <Section title="Ranked candidates">
            <ol className="flex flex-col gap-2">
              {result.candidates.map((c) => {
                const supported = c.support.startsWith("geologically");
                const control = c.support.startsWith("control");
                const expanded = open === c.region;
                return (
                  <li key={c.region} className="rounded-md border border-line bg-raised">
                    <button className="w-full px-3 py-2.5 text-left" onClick={() => setOpen(expanded ? null : c.region)} aria-expanded={expanded}>
                      <div className="flex items-baseline gap-2">
                        <span className="num text-[11px] text-faint">{String(c.rank).padStart(2, "0")}</span>
                        <span className="flex-1 text-[13px] font-medium text-text">{c.name}</span>
                        <span className="num text-[13px] text-mars-soft">{c.score.toFixed(2)}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className={`chip ${supported ? "chip-obs" : control ? "chip-sim" : "chip-calc"}`}>{c.support}</span>
                        {c.shared_processes.map((q) => <span key={q} className="chip">{PROCESS_LABEL[q] ?? q}</span>)}
                      </div>
                      <div className="mt-2 flex flex-col gap-1">
                        <SimBar label="Network similarity" value={(c.embedding_similarity + 1) / 2} kind="model" />
                        <SimBar label="Measured similarity" value={c.physical_similarity} kind="calc" />
                      </div>
                    </button>
                    {expanded && (
                      <div className="border-t border-line px-3 py-2.5">
                        <table className="w-full text-[11.5px]">
                          <thead><tr className="text-left text-faint"><th className="pb-1 font-medium">Measured attribute</th><th className="pb-1 text-right font-medium">{qBody}</th><th className="pb-1 text-right font-medium">{tBody}</th><th className="pb-1 text-right font-medium">Ratio</th></tr></thead>
                          <tbody>
                            {c.attributes.map((a) => (
                              <tr key={a.attribute} className="border-t border-line/60">
                                <td className="py-1 text-muted">{ATTR_LABEL[a.attribute]?.[0] ?? a.attribute}</td>
                                <td className="num py-1 text-right">{a.query.toFixed(a.query < 10 ? 2 : 0)} {ATTR_LABEL[a.attribute]?.[1]}</td>
                                <td className="num py-1 text-right">{a.candidate.toFixed(a.candidate < 10 ? 2 : 0)} {ATTR_LABEL[a.attribute]?.[1]}</td>
                                <td className={`num py-1 text-right ${a.ratio > 2 ? "text-warn" : ""}`}>{a.ratio.toFixed(2)}×</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="mt-2 text-[11.5px] leading-snug text-muted">{c.note}</p>
                        <p className="mt-1 text-[11px] leading-snug text-faint">
                          {supported
                            ? (c.body === "earth"
                              ? `Why it is useful: published work documents this site as a ${c.documented_analog_for.map((b) => BODY_LABEL[b] ?? b).join(" and ")} analog, and it shares a formation process with the target. `
                              : `Published work documents the selected Earth site as a ${c.documented_analog_for.map((b) => BODY_LABEL[b] ?? b).join(" and ")} analog, and it shares a formation process with this region. `)
                            : control
                              ? (c.body === "earth"
                                ? "This is a control region. A high rank here would mean the comparison is being fooled by appearance. "
                                : "The selected Earth site is a control region, not a proposed analog: this is a terrain-shape match only. ")
                              : "The terrain shape matches, but no shared formation process is documented, so treat it as a look-alike only. "}
                          {c.citation && `Source: ${c.citation}.`} {c.lat.toFixed(2)}°, {c.lon.toFixed(2)}°.
                        </p>
                        {onOpen && (
                          <button className="btn mt-2 h-7 w-full text-[11.5px]" onClick={() => onOpen(c.region)}>
                            See {c.name} on the {BODY_LABEL[c.body] ?? "other"} map
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <p className="mt-2.5 text-[11px] leading-snug text-faint">{result.method}</p>
          </Section>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- 3. Route */

function Profile({ legs, limit }: { legs: Route[]; limit: number }) {
  const pts: { d: number; z: number; s: number }[] = [];
  let offset = 0;
  for (const leg of legs) {
    for (const q of leg.points) pts.push({ d: offset + q.dist_m, z: q.elevation_m, s: q.slope_deg });
    offset += leg.distance_m;
  }
  if (pts.length < 2) return null;
  const W = 352, H = 84, pad = 4;
  const zmin = Math.min(...pts.map((q) => q.z)), zmax = Math.max(...pts.map((q) => q.z));
  const X = (d: number) => pad + (d / offset) * (W - 2 * pad);
  const Y = (z: number) => H - pad - ((z - zmin) / Math.max(zmax - zmin, 1)) * (H - 2 * pad);
  const line = pts.map((q, i) => `${i ? "L" : "M"}${X(q.d).toFixed(1)},${Y(q.z).toFixed(1)}`).join("");
  const steep = pts.filter((q) => q.s > 0.75 * limit);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
           aria-label={`Elevation profile along the route, from ${zmin.toFixed(0)} to ${zmax.toFixed(0)} metres`}>
        <path d={`${line}L${X(offset)},${H}L${X(0)},${H}Z`} fill="rgba(226,115,60,0.12)" />
        <path d={line} fill="none" stroke="#e2733c" strokeWidth="1.5" />
        {steep.map((q, i) => <circle key={i} cx={X(q.d)} cy={Y(q.z)} r="1.6" fill="#e8b84a" />)}
      </svg>
      <figcaption className="text-[10.5px] leading-snug text-faint">
        Elevation along the {fmtDistance(offset)} route, from <span className="num">{zmin.toFixed(0)} m</span> to <span className="num">{zmax.toFixed(0)} m</span>. Amber dots are within 25% of the slope limit.
      </figcaption>
    </figure>
  );
}

/** What the crew does at a target. The time on site is an assumption; it counts against consumables. */
export const GOALS: { label: string; objective: string; dwell_min: number }[] = [
  { label: "Image and sample an outcrop", objective: "Image and sample the outcrop", dwell_min: 20 },
  { label: "Drill a rock core", objective: "Drill and store a rock core", dwell_min: 45 },
  { label: "Panorama and context images", objective: "Take a panorama and context images", dwell_min: 10 },
  { label: "Set up a weather station", objective: "Set up a weather station", dwell_min: 30 },
];

export function StepRoute({ mission, profiles, placing, setPlacing, onPlan, onClear, busy, goal, setGoal, onFine, fineBusy, onWorld }: {
  mission: Mission; profiles: Profile[]; placing: boolean; setPlacing: (v: boolean) => void;
  onPlan: (mover: string, objective: string, risk: number) => void; onClear: () => void; busy: boolean;
  goal: number; setGoal: (i: number) => void;
  /** Measure the plan on the 1 m elevation model; with true, also move the route off steep ground. */
  onFine: (avoid: boolean) => void; fineBusy: boolean;
  /** Open the 3D world on this mission; absent when that service is not running. */
  onWorld?: () => void;
}) {
  const locked = mission.sim.phase !== "idle";
  const prof = profiles.find((q) => q.key === mission.mover);
  const plan = mission.plan;
  return (
    <>
      <Section title="Who is travelling" kind="assume">
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Mover">
          {profiles.map((q) => (
            <button key={q.key} role="radio" aria-checked={mission.mover === q.key} disabled={locked || busy}
                    onClick={() => onPlan(q.key, mission.objective, mission.risk_weight)}
                    className={`rounded-md border px-2 py-2 text-left transition-colors disabled:opacity-40 ${mission.mover === q.key ? "border-mars bg-mars/10" : "border-line-strong bg-raised hover:border-muted"}`}>
              <div className="text-[12px] font-medium leading-tight text-text">{q.name}</div>
              <div className="num mt-1 text-[10.5px] text-muted">{q.kind === "astronaut" ? "on foot" : `${(q.speed_flat_ms * 3.6).toFixed(q.speed_flat_ms < 0.1 ? 2 : 1)} km/h`} · ≤{q.max_slope_deg}°</div>
            </button>
          ))}
        </div>
        {prof && <p className="mt-2 text-[11px] leading-snug text-faint">{prof.basis}</p>}
      </Section>

      <Section title="Science targets" action={mission.targets.length > 0 && <button className="btn" onClick={onClear} disabled={locked || busy}>Clear</button>}>
        <label className="mb-2 block">
          <span className="text-[12px] text-muted">Science at the next target</span>
          <select className="field mt-1" value={goal} onChange={(e) => setGoal(Number(e.target.value))} disabled={locked}>
            {GOALS.map((g, i) => <option key={g.label} value={i}>{g.label} · {g.dwell_min} min</option>)}
          </select>
        </label>
        <button className={`btn w-full ${placing ? "btn-primary" : ""}`} onClick={() => setPlacing(!placing)} disabled={locked}>
          {placing ? "Click the map to place a target (Esc to stop)" : "Add targets on the map"}
        </button>
        {mission.targets.length === 0
          ? <p className="mt-2 text-[12px] text-muted">No targets yet. The delta front, west of the landing site, is where Perseverance went.</p>
          : (
            <ol className="mt-2.5 flex flex-col gap-1">
              {mission.targets.map((t, i) => (
                <li key={t.id} className="flex items-baseline gap-2 text-[12px]">
                  <span className="num grid h-4 w-4 shrink-0 place-items-center rounded-full bg-mars text-[9.5px] font-semibold text-ink">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-text">{t.name}</span>
                    {t.objective && <span className="block truncate text-[11px] text-muted">{t.objective}, {t.dwell_min.toFixed(0)} min on site</span>}
                  </span>
                  <span className="num text-[11px] text-muted">{t.elevation_m.toFixed(0)} m · {t.slope_deg.toFixed(1)}°</span>
                </li>
              ))}
            </ol>
          )}
        <p className="mt-2 text-[11px] leading-snug text-faint">Time on site is an assumption. It is added to the traverse, so longer science uses more oxygen or battery.</p>
      </Section>

      <Section title="Planning preference" kind="assume">
        <div className="mb-2.5 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Objective">
          {[["time", "Fastest"], ["energy", "Least energy"]].map(([k, label]) => (
            <button key={k} role="radio" aria-checked={mission.objective === k} disabled={locked || busy}
                    onClick={() => onPlan(mission.mover, k, mission.risk_weight)}
                    className={`btn ${mission.objective === k ? "border-mars text-mars-soft" : ""}`}>{label}</button>
          ))}
        </div>
        <label className="block">
          <div className="flex justify-between text-[12px] text-muted"><span>Caution on steep or rough ground</span><span className="num text-text">{mission.risk_weight.toFixed(1)}</span></div>
          <input type="range" min={0} max={6} step={0.5} defaultValue={mission.risk_weight} disabled={locked || busy} key={mission.risk_weight}
                 onMouseUp={(e) => onPlan(mission.mover, mission.objective, Number((e.target as HTMLInputElement).value))}
                 onKeyUp={(e) => onPlan(mission.mover, mission.objective, Number((e.target as HTMLInputElement).value))} />
        </label>
      </Section>

      {plan && (
        <Section title={`Route plan ${plan.revision}`} kind="calc">
          <Grid>
            <Stat label="Distance" value={fmtDistance(plan.distance_m)} />
            <Stat label="Duration" value={fmtDuration(plan.seconds)} />
            <Stat label="Energy" value={fmtEnergy(plan.joules)} />
            <Stat label="Steepest ground" value={plan.max_slope_deg.toFixed(1)} unit="°" tone={plan.max_slope_deg > 0.75 * (prof?.max_slope_deg ?? 20) ? "warn" : undefined} />
            <Stat label="Slope limit" value={prof?.max_slope_deg ?? "–"} unit="°" />
            <Stat label="Legs" value={plan.legs.length} />
          </Grid>
          <div className="mt-3"><Profile legs={plan.legs} limit={prof?.max_slope_deg ?? 20} /></div>
          <ul className="mt-2.5 flex flex-col gap-1 text-[12px] leading-snug text-muted">
            {plan.legs.map((leg, i) => <li key={i}><span className="text-faint">Leg {i + 1}.</span> {leg.explanation.slice(0, 2).join(" ")}</li>)}
          </ul>
        </Section>
      )}

      {plan && <FineCheckCard mission={mission} limit={prof?.max_slope_deg ?? 20} locked={locked} busy={busy} fineBusy={fineBusy} onFine={onFine} />}

      {plan && onWorld && (
        <Section title="See it in 3D">
          <p className="text-[12px] leading-snug text-muted">
            The 3D world draws this same plan on the ground: every leg, each target, and the stretches the 1 m check found too steep.
            Fly along the whole route, or drive its first leg on 5 m terrain.
          </p>
          <button className="btn mt-2.5 w-full" onClick={onWorld}>Open this route in the 3D world</button>
        </Section>
      )}
    </>
  );
}

/** The plan measured on NASA's 1 m HiRISE elevation model, with the option to move the route off steep ground. */
function FineCheckCard({ mission, limit, locked, busy, fineBusy, onFine }: {
  mission: Mission; limit: number; locked: boolean; busy: boolean; fineBusy: boolean; onFine: (avoid: boolean) => void;
}) {
  const plan = mission.plan!;
  const f = mission.fine_check && mission.fine_check.revision === plan.revision ? mission.fine_check : null;
  const movable = f ? f.stretches.length - f.unavoidable.length : 0;
  const ref = f?.perseverance;
  return (
    <Section title="Checked at 1 m" kind="calc">
      {!f ? (
        <>
          <p className="text-[12px] leading-snug text-muted">
            This route was planned on 20 m cells, which average away a bank or scarp a few metres across. NASA&apos;s HiRISE elevation model of Jezero has a post every 1 m. Check the route against it before the crew relies on it.
          </p>
          <button className="btn btn-primary mt-2.5 w-full" disabled={locked || busy} onClick={() => onFine(false)}>
            {fineBusy ? "Reading NASA’s 1 m elevation…" : "Check this route at 1 m"}
          </button>
          <p className="mt-2 text-[11px] leading-snug text-faint">The first check of new ground downloads the elevation under the route from NASA and can take up to a minute.</p>
        </>
      ) : (
        <>
          <Note tone={f.clear ? "good" : "warn"}>{f.summary}</Note>
          <div className="mt-3">
            <Grid>
              <Stat label="Checked" value={fmtDistance(f.checked_m)} />
              <Stat label="Steepest at 1 m" value={(f.slope_deg.max ?? 0).toFixed(1)} unit="°" tone={(f.slope_deg.max ?? 0) > limit ? "bad" : (f.slope_deg.max ?? 0) > 0.75 * limit ? "warn" : "good"} />
              <Stat label="Steepest at 20 m" value={plan.max_slope_deg.toFixed(1)} unit="°" />
              <Stat label="Over the limit" value={f.over_limit_m.toFixed(0)} unit="m" tone={f.over_limit_m > 0 ? "bad" : "good"} />
              <Stat label="Typical slope" value={(f.slope_deg.median ?? 0).toFixed(1)} unit="°" />
              <Stat label="Keep-outs added" value={mission.hazards.filter((h) => h.source === "hirise_1m").length} />
            </Grid>
          </div>
          {f.profile && <div className="mt-3"><FineProfile slope={f.profile.slope_deg} spacing={f.profile.spacing_m} limit={limit} /></div>}
          {f.stretches.length > 0 && (
            <ol className="mt-2.5 flex flex-col gap-1 text-[12px] leading-snug text-muted">
              {f.stretches.slice(0, 8).map((s, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2">
                  <span><span className="text-faint">{i + 1}.</span> {s.length_m.toFixed(0)} m, starting {fmtDistance(s.start_m)} along the route</span>
                  <span className="num text-[#f3a79f]">{s.max_slope_deg.toFixed(1)}°</span>
                </li>
              ))}
              {f.stretches.length > 8 && <li className="text-faint">and {f.stretches.length - 8} more, marked on the map</li>}
            </ol>
          )}
          {movable > 0 && (
            <button className="btn btn-primary mt-2.5 w-full" disabled={locked || busy} onClick={() => onFine(true)}>
              {fineBusy ? "Replanning and checking again…" : "Move the route around them"}
            </button>
          )}
          {f.no_data_m > 0 && <p className="mt-2 text-[11.5px] leading-snug text-warn">NASA&apos;s 1 m model has no data under {f.no_data_m.toFixed(0)} m of this route; that part was not checked.</p>}
          {ref && (
            <p className="mt-2.5 text-[11.5px] leading-snug text-muted">
              For comparison, the same measure on the <span className="num">{(ref.length_m / 1000).toFixed(1)} km</span> Perseverance drove here: 99% of it is under <span className="num">{ref.slope_deg.p99?.toFixed(1)}°</span>, and its steepest point reads <span className="num">{ref.slope_deg.max?.toFixed(1)}°</span>.
            </p>
          )}
          <p className="mt-2 text-[11px] leading-snug text-faint">
            {f.source ? `${f.source.title} (${f.source.mission}, ${f.source.instrument}), doi:${f.source.doi}. ` : ""}Slope is the tilt of a plane fitted to the posts in a 4 m window. {f.limits}
          </p>
        </>
      )}
    </Section>
  );
}

/** Slope along the route on the 1 m model, with the mover's limit drawn across it. */
function FineProfile({ slope, spacing, limit }: { slope: (number | null)[]; spacing: number; limit: number }) {
  if (slope.length < 2) return null;
  const W = 352, H = 64, pad = 4;
  const top = Math.max(limit * 1.25, ...slope.map((v) => v ?? 0));
  const X = (i: number) => pad + (i / (slope.length - 1)) * (W - 2 * pad);
  const Y = (v: number) => H - pad - (v / top) * (H - 2 * pad);
  let line = "", pen = false;
  slope.forEach((v, i) => {
    if (v === null) { pen = false; return; }
    line += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
    pen = true;
  });
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
           aria-label={`Slope along the route on the 1 metre elevation model, against the ${limit} degree limit`}>
        <line x1={pad} x2={W - pad} y1={Y(limit)} y2={Y(limit)} stroke="#ef6a5e" strokeWidth="1" strokeDasharray="4 3" />
        <path d={line} fill="none" stroke="#5fd4e0" strokeWidth="1.2" />
        {slope.map((v, i) => (v !== null && v > limit ? <circle key={i} cx={X(i)} cy={Y(v)} r="1.8" fill="#ef6a5e" /> : null))}
      </svg>
      <figcaption className="text-[10.5px] leading-snug text-faint">
        Slope on the 1 m model, sampled every {spacing.toFixed(0)} m along the route. The dashed line is the <span className="num">{limit}°</span> limit.
      </figcaption>
    </figure>
  );
}

/* -------------------------------------------------------------------- 4. Crew */

export function StepCrew({ mission, reserves }: { mission: Mission; reserves: { oxygen: number; battery: number } }) {
  const f = mission.plan?.feasibility;
  const r = resourceLabel(mission.sim.resource);
  const s = mission.sim;
  const running = s.phase !== "idle";
  return (
    <>
      <Section title="Can this traverse be done safely?" kind="calc">
        {!f ? <Note>Add a target to get a consumables check.</Note> : (
          <>
            <Note tone={f.ok ? "good" : "bad"}>{f.reason}</Note>
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[11.5px] text-muted"><span>{r.name} needed, with reserve</span><span className="num text-text">{f.needed_with_reserve.toFixed(r.digits)} of {f.available.toFixed(r.digits)} {r.unit}</span></div>
              <Meter value={f.needed_with_reserve} max={f.available} mark={f.needed} tone={f.ok ? "good" : "bad"} label={`${r.name} needed`} />
              <p className="mt-1 text-[11px] text-faint">The white line marks the need without the {(f.reserve_fraction * 100).toFixed(0)}% reserve.</p>
            </div>
          </>
        )}
      </Section>

      <Section title="Mission rules" kind="assume">
        <Row label="Oxygen kept in reserve on foot">{(reserves.oxygen * 100).toFixed(0)}%</Row>
        <Row label="Battery kept in reserve when driving">{(reserves.battery * 100).toFixed(0)}%</Row>
        <Row label="Dust optical depth that ends a traverse">2</Row>
        <p className="mt-2 text-[11.5px] leading-snug text-muted">
          At every moment the mover must be able to reach base on what it carries with the reserve intact. If continuing would break that, the mission service turns the traverse back and records why.
        </p>
      </Section>

      <Section title="Live safety margin" kind="sim">
        {!running ? <p className="text-[12px] text-muted">Starts when the simulation runs.</p> : (
          <>
            <div className="mb-1 flex justify-between text-[11.5px] text-muted"><span>{r.name} remaining</span><span className="num text-text">{s.remaining.toFixed(r.digits)} {r.unit}</span></div>
            <Meter value={s.remaining} max={s.capacity} mark={s.return_need_with_reserve} tone={s.return_margin < 0 ? "bad" : s.return_margin < 0.15 * s.capacity ? "warn" : "signal"} label={`${r.name} remaining`} />
            <p className="mt-1 text-[11px] text-faint">The white line is what the trip home needs from here, with reserve.</p>
            <div className="mt-2.5"><Grid>
              <Stat label="Way home" value={fmtDistance(s.return_distance_m)} />
              <Stat label="Margin for the return" value={s.return_margin.toFixed(r.digits)} unit={r.unit} tone={s.return_margin < 0 ? "bad" : undefined} />
              <Stat label="Pace" value={`${(s.pace_factor * 100).toFixed(0)}%`} tone={s.pace_factor < 1 ? "warn" : undefined} />
            </Grid></div>
          </>
        )}
      </Section>

      <Section title="Radiation exposure" kind="calc">
        <div className="mb-1 flex justify-between text-[11.5px] text-muted"><span>Surface stay of {mission.sols} sols against the career limit</span><span className="num text-text">{mission.habitat.radiation_msv_stay.toFixed(0)} mSv · {(mission.habitat.radiation_share_of_career_limit * 100).toFixed(0)}%</span></div>
        <Meter value={mission.habitat.radiation_share_of_career_limit} max={1} tone={mission.habitat.radiation_share_of_career_limit > 0.75 ? "bad" : mission.habitat.radiation_share_of_career_limit > 0.5 ? "warn" : "signal"} label="Share of the career radiation limit" />
        <div className="mt-2">
          <Row label="Dose per sol on the surface">{mission.habitat.radiation_msv_per_sol.toFixed(2)} mSv</Row>
          {mission.plan && <Row label="During this traverse">{(mission.habitat.radiation_msv_per_sol * mission.plan.seconds / 88775).toFixed(3)} mSv</Row>}
        </div>
        <p className="mt-2 text-[11.5px] leading-snug text-muted">
          The dose rate is what Curiosity&apos;s radiation detector measured at Gale crater in 2012 to 2013, not a measurement at Jezero. It changes with the solar cycle, and the trip to Mars and back adds more. No shielding is modelled, and no space-weather feed is connected. Both figures are in the Habitat step&apos;s assumptions, flagged for checking.
        </p>
      </Section>

      <Section title="Crew health monitor" kind="sim">
        {!s.health.monitored ? (
          <p className="text-[12px] leading-snug text-muted">The robotic scout carries no crew, so there is nothing to monitor.</p>
        ) : (
          <>
            {s.health.anomaly && <div className="mb-2.5"><Note tone="bad">Heart rate is {(s.health.heart_rate_bpm - s.health.expected_heart_rate_bpm).toFixed(0)} bpm above what the current workload explains. The pace has been reduced and the way home recalculated.</Note></div>}
            <Grid>
              <Stat label="Metabolic rate" value={s.health.metabolic_w.toFixed(0)} unit="W" />
              <Stat label="Heart rate" value={s.health.heart_rate_bpm.toFixed(0)} unit="bpm" tone={s.health.anomaly ? "bad" : undefined} />
              <Stat label="Expected at this workload" value={s.health.expected_heart_rate_bpm.toFixed(0)} unit="bpm" />
            </Grid>
            {s.health.heart_rate_history.length > 1 && (() => {
              const h = s.health.heart_rate_history, lo = Math.min(...h) - 5, hi = Math.max(...h) + 5;
              const pts = h.map((v, i) => `${(i / (h.length - 1)) * 352},${44 - ((v - lo) / (hi - lo)) * 40}`).join(" ");
              return (
                <svg viewBox="0 0 352 46" className="mt-2.5 w-full" role="img" aria-label={`Heart rate over the last ${h.length} minutes, from ${Math.min(...h).toFixed(0)} to ${Math.max(...h).toFixed(0)} beats per minute`}>
                  <polyline points={pts} fill="none" stroke={s.health.anomaly ? "#ef6a5e" : "#5fd4e0"} strokeWidth="1.5" />
                </svg>
              );
            })()}
            <div className="mt-2.5">
              <div className="mb-1 flex justify-between text-[11.5px] text-muted"><span>Fatigue</span><span className="num text-text">{(s.health.fatigue * 100).toFixed(0)}%</span></div>
              <Meter value={s.health.fatigue} max={1} tone={s.health.fatigue > 0.8 ? "bad" : s.health.fatigue > 0.5 ? "warn" : "signal"} label="Fatigue" />
            </div>
          </>
        )}
        <p className="mt-2.5 text-[11.5px] leading-snug text-muted">
          Every reading is simulated from workload: heart rate is assumed to rise 0.21 bpm per watt of metabolic rate, and fatigue to reach 100% after 8 hours at 300 W. The monitor raises an alert when heart rate stays 15 bpm above what the workload explains for 2 minutes, which is how it catches the injected health fault. No person is being measured, and this is not a medical device.
        </p>
      </Section>
    </>
  );
}

/* ----------------------------------------------------------------- 5. Habitat */

const CROPS: [string, string][] = [["potato", "White potato"], ["wheat", "Wheat"], ["soybean", "Soybean"], ["lettuce", "Lettuce"], ["tomato", "Tomato"]];

export function FieldSite({ climate, error, lead, onOpen }: {
  climate: Climate | null; error: string | null; lead?: string;
  /** Opens the site on the Earth map (given in the Habitat step, where the site is one hop away). */
  onOpen?: (region: string) => void;
}) {
  if (error) return <Section title="Field site on Earth" kind="obs"><Note tone="warn">NASA POWER data did not load: {error}</Note></Section>;
  if (!climate) return <Section title="Field site on Earth" kind="obs"><p className="text-[12px] text-muted">Loading NASA POWER records…</p></Section>;
  const e = climate.periods.early, r = climate.periods.recent, c = climate.change;
  const sign = (v: number, digits = 1) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
  const tmin = Math.min(...r.monthly_temperature_c), tmax = Math.max(...r.monthly_temperature_c);
  return (
    <Section title="Field site on Earth" kind="obs">
      <p className="mb-2.5 text-[12px] leading-snug text-muted">
        {lead ?? "Before a greenhouse flies, its crops and systems are tested outdoors at an analog site."} These are NASA&apos;s climate records for <span className="text-text">{climate.region.name}</span>{lead ? "." : ", the best terrain match found for this mission area."}
      </p>
      <div className="mb-2 flex h-12 items-end gap-[3px]" role="img" aria-label={`Monthly mean temperature ${r.years[0]} to ${r.years[1]}, from ${tmin.toFixed(0)} to ${tmax.toFixed(0)} degrees Celsius`}>
        {r.monthly_temperature_c.map((t, i) => (
          <div key={i} className="flex-1 rounded-[2px]" title={`${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][i]}: ${t.toFixed(1)} °C`}
               style={{ height: `${12 + ((t - tmin) / Math.max(tmax - tmin, 1)) * 88}%`, background: t >= 10 ? "#58c98b" : "#2c3c4f" }} />
        ))}
      </div>
      <p className="mb-2 text-[11px] text-faint">Monthly mean air temperature, {r.years[0]} to {r.years[1]}. Green months are warm enough to grow ({climate.conventions.growing_season}).</p>
      <Row label={`Mean temperature, ${r.years[0]}–${r.years[1]}`}>{r.mean_temperature_c.toFixed(1)} °C{c && <span className="text-muted"> ({sign(c.temperature_c)} since {e.years[0]}–{e.years[1]})</span>}</Row>
      <Row label="Rain and snow per year">{r.annual_precipitation_mm.toFixed(0)} mm{c && <span className="text-muted"> ({sign(c.precipitation_percent, 0)}%)</span>}</Row>
      <Row label="Growing season">{r.growing_season_days} days{c && <span className="text-muted"> ({sign(c.growing_season_days, 0)} days)</span>}</Row>
      <Row label="Sunlight for plants in season">{r.growing_season_light_mol_m2_day?.toFixed(0) ?? "–"} mol/m²/day</Row>
      <p className="mt-2 text-[11.5px] leading-snug text-muted">
        On Mars that light has to come from lamps: the greenhouse above budgets 17 to 115 mol/m²/day depending on the crop.
      </p>
      <p className="mt-1.5 text-[11px] leading-snug text-faint">{climate.source.title}. {climate.source.note}</p>
      {onOpen && (
        <button className="btn mt-2 h-7 w-full text-[11.5px]" onClick={() => onOpen(climate.region.region)}>
          See {climate.region.name} on the Earth map
        </button>
      )}
    </Section>
  );
}

export function StepHabitat({ mission, onChange, busy, climate, climateError, onOpenSite }: {
  mission: Mission; busy: boolean; climate: Climate | null; climateError: string | null;
  onOpenSite?: (region: string) => void;
  onChange: (crew: number, sols: number, crops: Record<string, number>, overrides: Record<string, number>) => void;
}) {
  const h = mission.habitat;
  const crops = mission.crop_area_m2;
  const set = (patch: Partial<{ crew: number; sols: number; crops: Record<string, number>; overrides: Record<string, number> }>) =>
    onChange(patch.crew ?? mission.crew, patch.sols ?? mission.sols, patch.crops ?? crops, patch.overrides ?? mission.overrides);
  const tau = h.assumptions.find((a) => a.key === "dust_opacity_tau")?.value ?? 0.5;
  const array = h.assumptions.find((a) => a.key === "solar_array_m2")?.value ?? 400;
  const powerOk = h.power_margin_kwh_per_sol >= 0;
  return (
    <>
      <Section title={`Habitat at ${mission.base.name}`} kind="assume">
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-[12px] text-muted">Crew</span>
            <input className="field num mt-1" type="number" min={1} max={12} defaultValue={mission.crew} key={`c${mission.crew}`} disabled={busy}
                   onBlur={(e) => set({ crew: Math.max(1, Math.min(12, Number(e.target.value) || mission.crew)) })} /></label>
          <label className="block"><span className="text-[12px] text-muted">Surface stay (sols)</span>
            <input className="field num mt-1" type="number" min={1} max={1000} defaultValue={mission.sols} key={`s${mission.sols}`} disabled={busy}
                   onBlur={(e) => set({ sols: Math.max(1, Math.min(1000, Number(e.target.value) || mission.sols)) })} /></label>
        </div>
        <label className="mt-3 block">
          <div className="flex justify-between text-[12px] text-muted"><span>Solar array</span><span className="num text-text">{array.toFixed(0)} m²</span></div>
          <input type="range" min={100} max={2000} step={50} defaultValue={array} key={`a${array}`} disabled={busy}
                 onMouseUp={(e) => set({ overrides: { ...mission.overrides, solar_array_m2: Number((e.target as HTMLInputElement).value) } })}
                 onKeyUp={(e) => set({ overrides: { ...mission.overrides, solar_array_m2: Number((e.target as HTMLInputElement).value) } })} />
        </label>
        <label className="mt-1 block">
          <div className="flex justify-between text-[12px] text-muted"><span>Dust optical depth</span><span className="num text-text">{tau.toFixed(1)}</span></div>
          <input type="range" min={0.2} max={5} step={0.1} defaultValue={tau} key={`t${tau}`} disabled={busy || mission.sim.dust_tau > 0}
                 onMouseUp={(e) => set({ overrides: { ...mission.overrides, dust_opacity_tau: Number((e.target as HTMLInputElement).value) } })}
                 onKeyUp={(e) => set({ overrides: { ...mission.overrides, dust_opacity_tau: Number((e.target as HTMLInputElement).value) } })} />
        </label>
      </Section>

      <Section title="Greenhouse" kind="assume">
        {CROPS.map(([key, name]) => (
          <label key={key} className="mb-1 block">
            <div className="flex justify-between text-[12px] text-muted"><span>{name}</span><span className="num text-text">{(crops[key] ?? 0).toFixed(0)} m²</span></div>
            <input type="range" min={0} max={200} step={10} defaultValue={crops[key] ?? 0} key={`${key}${crops[key] ?? 0}`} disabled={busy}
                   onMouseUp={(e) => set({ crops: { ...crops, [key]: Number((e.target as HTMLInputElement).value) } })}
                   onKeyUp={(e) => set({ crops: { ...crops, [key]: Number((e.target as HTMLInputElement).value) } })} />
          </label>
        ))}
        <p className="text-[11px] leading-snug text-faint">Crop yields, light and water needs are nominal controlled-environment values entered from memory of NASA&apos;s life-support baseline document and are flagged for checking.</p>
      </Section>

      <Section title="Budget per sol" kind="calc">
        <div className="mb-1 flex justify-between text-[11.5px] text-muted"><span>Electrical load against solar supply</span><span className={`num ${powerOk ? "text-good" : "text-bad"}`}>{h.power_margin_kwh_per_sol >= 0 ? "+" : ""}{h.power_margin_kwh_per_sol.toFixed(0)} kWh</span></div>
        <Meter value={h.load_kwh_per_sol} max={Math.max(h.solar_kwh_per_sol, h.load_kwh_per_sol)} mark={h.solar_kwh_per_sol} tone={powerOk ? "good" : "bad"} label="Electrical load" />
        <div className="mt-2.5">
          <Row label="Solar energy collected">{h.solar_kwh_per_sol.toFixed(0)} kWh</Row>
          <Row label="Load, of which grow lights">{h.load_kwh_per_sol.toFixed(0)} kWh · {h.grow_light_kwh_per_sol.toFixed(0)} kWh</Row>
          <Row label="Battery endurance at this load">{h.battery_hours_at_load.toFixed(1)} h</Row>
          <Row label="Oxygen breathed · from plants">{h.oxygen_need_kg_per_sol.toFixed(2)} kg · {h.oxygen_from_plants_kg_per_sol.toFixed(2)} kg</Row>
          <Row label="Water used by crew · through crops">{h.water_need_kg_per_sol.toFixed(1)} kg · {h.water_through_crops_kg_per_sol.toFixed(0)} kg</Row>
          <Row label="Water lost to recycling">{h.water_makeup_kg_per_sol.toFixed(1)} kg</Row>
          <Row label="Food energy grown on site">{(h.food_grown_share * 100).toFixed(0)}%</Row>
        </div>
      </Section>

      <Section title={`Whole stay: ${mission.sols} sols`} kind="calc">
        <Grid>
          <Stat label="Water to supply" value={(h.water_makeup_kg_mission / 1000).toFixed(1)} unit="t" />
          <Stat label="Oxygen to supply" value={(h.oxygen_makeup_kg_mission / 1000).toFixed(2)} unit="t" />
          <Stat label="Food to ship (dry)" value={(h.food_shipped_dry_kg_mission / 1000).toFixed(2)} unit="t" />
        </Grid>
        <ul className="mt-2.5 flex flex-col gap-1 text-[12px] leading-snug text-muted">{h.findings.map((q, i) => <li key={i}>{q}</li>)}</ul>
      </Section>

      <FieldSite climate={climate} error={climateError} onOpen={onOpenSite} />

      <Section title="Assumptions behind these numbers">
        <ul className="flex flex-col gap-2">
          {h.assumptions.map((a) => (
            <li key={a.key} className="text-[11.5px] leading-snug">
              <div className="flex items-baseline justify-between gap-2"><span className="text-text">{a.label}</span><span className="num text-muted">{a.value} {a.unit}</span></div>
              <div className="text-faint">{a.basis}{a.verify && <span className="text-warn"> Needs checking against the source.</span>}</div>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/* ---------------------------------------------------------------- 6. Simulate */

const EMERGENCIES: [string, string, string][] = [
  ["obstacle", "Obstacle ahead", "Blocks the route about 150 m ahead"],
  ["dust_storm", "Dust storm", "Optical depth rises to 4"],
  ["leak", "Leak or power fault", "Extra loss of the limiting consumable"],
  ["crew_health", "Health or mobility fault", "Pace falls to 60%"],
];

export function ScoreCard({ mission, best }: { mission: Mission; best?: number | null }) {
  const sc = mission.score;
  if (!sc) return null;
  return (
    <Section title="Mission score" kind="sim">
      <div className="flex items-baseline gap-3">
        <span className="num text-[30px] font-medium leading-none text-text">{sc.total.toFixed(0)}</span>
        <span className="text-[12px] text-muted">of 100</span>
        <span className="flex-1" />
        <span className={`text-[13px] font-medium ${sc.total >= 70 ? "text-good" : sc.total >= 40 ? "text-warn" : "text-bad"}`}>{sc.rank}</span>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {sc.lines.map((l) => (
          <li key={l.label}>
            <div className="mb-1 flex justify-between text-[12px]"><span className="text-text">{l.label}</span><span className="num text-muted">{l.points.toFixed(0)} / {l.max}</span></div>
            <Meter value={l.points} max={l.max} tone={l.points >= l.max ? "good" : l.points > 0 ? "warn" : "bad"} label={`${l.label} score`} />
            <p className="mt-1 text-[11.5px] leading-snug text-muted">{l.why}</p>
          </li>
        ))}
      </ul>
      {best !== null && best !== undefined && (
        <p className="mt-2.5 text-[12px] text-muted">
          Best in this session: <span className="num text-text">{best.toFixed(0)}</span>{sc.total >= best ? ". This run matches it." : ". Reset and try to beat it."}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-snug text-faint">{sc.note} Reset and try a different mover, route or caution setting.</p>
    </Section>
  );
}

export function StepSim({ mission, running, speed, setSpeed, onStart, onPause, onReset, onEmergency, busy, best, onCrew }: {
  mission: Mission; running: boolean; speed: number; setSpeed: (v: number) => void;
  onStart: () => void; onPause: () => void; onReset: () => void; onEmergency: (kind: string) => void; busy: boolean;
  best?: number | null; onCrew?: () => void;
}) {
  const s = mission.sim;
  const r = resourceLabel(s.resource);
  const live = s.phase === "moving" || s.phase === "at_target";
  const phase = { idle: "Ready", manual: "Driving by hand", moving: "Under way", at_target: "Working at a target", holding: "Holding position",
                  complete: "Back at base", aborted: "Simulated failure" }[s.phase];
  const visited = mission.targets.filter((t) => t.visited).length;
  return (
    <>
      <Section title="Mission simulation" kind="sim">
        <div className="mb-2.5 flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${live ? "bg-good" : s.phase === "aborted" ? "bg-bad" : "bg-faint"}`} />
          <span className="text-[13px] font-medium text-text">{phase}</span>
          <span className="flex-1" />
          <span className="num text-[13px] text-muted">T+ {fmtDuration(s.seconds)}</span>
        </div>
        <div className="flex gap-1.5">
          {s.phase === "idle"
            ? <button className="btn btn-primary flex-1" onClick={onStart} disabled={busy || !mission.plan}>Start traverse</button>
            : <button className="btn btn-primary flex-1" onClick={running ? onPause : onStart} disabled={!live}>{running ? "Pause" : "Resume"}</button>}
          <button className="btn" onClick={onReset} disabled={busy || s.phase === "idle"}>Reset</button>
        </div>
        <label className="mt-3 block">
          <div className="flex justify-between text-[12px] text-muted"><span>Time compression</span><span className="num text-text">{speed}×</span></div>
          <input type="range" min={0} max={5} step={1} value={[10, 30, 60, 120, 600, 3600].indexOf(speed)}
                 onChange={(e) => setSpeed([10, 30, 60, 120, 600, 3600][Number(e.target.value)])} aria-label="Time compression" />
        </label>
        {mission.plan && !mission.plan.feasibility.ok && s.phase === "idle" && <div className="mt-2"><Note tone="bad">The service will refuse to start this plan. {mission.plan.feasibility.reason}</Note></div>}
      </Section>

      <ScoreCard mission={mission} best={best} />

      <Section title="Telemetry" kind="sim">
        <Grid>
          <Stat label="Distance" value={fmtDistance(s.distance_m)} />
          <Stat label="Speed" value={(s.speed_ms * 3.6).toFixed(s.speed_ms < 0.3 ? 3 : 1)} unit="km/h" />
          <Stat label="Ground slope" value={s.slope_deg.toFixed(1)} unit="°" />
          <Stat label={r.name} value={`${((s.remaining / Math.max(s.capacity, 1e-9)) * 100).toFixed(0)}%`} tone={s.remaining / s.capacity < 0.25 ? "warn" : undefined} />
          <Stat label="Targets visited" value={`${visited} / ${mission.targets.length}`} />
          <Stat label="Replans" value={s.replans} tone={s.replans > 0 ? "warn" : undefined} />
        </Grid>
      </Section>

      {/* The crew monitor from step 4, kept in sight while the traverse runs. */}
      <Section title="Crew monitor" kind="sim" action={onCrew && <button className="btn h-7" onClick={onCrew}>Open crew</button>}>
        {!s.health.monitored ? (
          <p className="text-[12px] leading-snug text-muted">The robotic scout carries no crew. Its battery margin for the way home is in the Crew step.</p>
        ) : s.phase === "idle" ? (
          <p className="text-[12px] leading-snug text-muted">Heart rate, fatigue and the margin for the way home appear here once the traverse starts.</p>
        ) : (
          <>
            {s.health.anomaly && <div className="mb-2.5"><Note tone="bad">Health alert: heart rate is {(s.health.heart_rate_bpm - s.health.expected_heart_rate_bpm).toFixed(0)} bpm above what the workload explains. The pace has been reduced.</Note></div>}
            <Grid>
              <Stat label="Heart rate" value={s.health.heart_rate_bpm.toFixed(0)} unit="bpm" tone={s.health.anomaly ? "bad" : undefined} />
              <Stat label="Fatigue" value={`${(s.health.fatigue * 100).toFixed(0)}%`} tone={s.health.fatigue > 0.8 ? "bad" : s.health.fatigue > 0.5 ? "warn" : undefined} />
              <Stat label="Margin to get home" value={s.return_margin.toFixed(r.digits)} unit={r.unit} tone={s.return_margin < 0 ? "bad" : undefined} />
            </Grid>
            <p className="mt-2 text-[11px] leading-snug text-faint">Simulated from workload; no person is being measured.</p>
          </>
        )}
      </Section>

      <Section title="Inject an emergency" kind="sim">
        <div className="grid grid-cols-2 gap-1.5">
          {EMERGENCIES.map(([kind, label, hint]) => (
            <button key={kind} className="btn btn-danger h-auto flex-col items-start gap-0.5 py-2 text-left" disabled={!live || busy} onClick={() => onEmergency(kind)}>
              <span>{label}</span><span className="text-[10.5px] font-normal text-faint">{hint}</span>
            </button>
          ))}
        </div>
        {!live && <p className="mt-2 text-[11.5px] text-muted">Available while the traverse is under way.</p>}
      </Section>

      <Section title="Mission log">
        <ol className="scroll-thin flex max-h-72 flex-col-reverse gap-1.5 overflow-y-auto" aria-live="polite">
          {[...mission.events].reverse().map((e, i) => (
            <li key={mission.events.length - i} className="grid grid-cols-[52px_1fr] gap-2 text-[11.5px] leading-snug">
              <span className="num text-faint">{(e.t_seconds / 60).toFixed(0)} min</span>
              <span className={e.kind === "emergency" ? "text-[#f3a79f]" : e.kind === "decision" ? "text-warn" : e.kind === "warning" ? "text-bad" : e.kind === "arrival" ? "text-good" : "text-muted"}>{e.message}</span>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
