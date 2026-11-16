import { ChevronDown, ChevronUp, Eye, EyeOff, Navigation, Plane, RefreshCw, Square } from 'lucide-react'
import { useState } from 'react'
import { clsx } from 'clsx'
import { actions } from '@/state/actions'
import { useUI } from '@/state/store'
import { Tag } from '@/dashboard/HUD'

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`)
const hm = (s: number) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min` }

/**
 * The mission planned in the main map, as this world sees it. Every number here is read from the
 * mission service; this world only draws the plan and drives its first stretch on 5 m terrain.
 */
export function MissionLinkCard() {
  const m = useUI((s) => s.mission)
  const err = useUI((s) => s.missionError)
  const show = useUI((s) => s.showMission)
  const flying = useUI((s) => s.flyover)
  const busy = useUI((s) => s.planning)
  const driving = useUI((s) => s.expedition === 'driving')
  const hasRoute = useUI((s) => s.route !== null)
  const [open, setOpen] = useState(true)
  const full = open && !driving && !hasRoute   // the planner below grows once a drive is planned, so this card steps back
  if (!m) {
    if (!err) return null
    return (
      <div className="glass pointer-events-auto w-[370px] shrink-0 rounded-2xl p-3 text-[11px] leading-snug text-ink-3">
        <span className="font-medium text-ink-2">No mission from the main map.</span> {err}
        <button onClick={() => void actions.loadMission()} className="ml-1 underline underline-offset-2 hover:text-ink">Try again</button>
      </div>
    )
  }
  const f = m.fine
  return (
    <div className="glass pointer-events-auto w-[370px] shrink-0 rounded-2xl p-4" data-testid="mission-link">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold"><span className="size-2 rounded-full bg-[#e2733c]" />Mission from the main map</span>
        <span className="flex gap-0.5">
          <button onClick={() => void actions.loadMission()} title="Read the mission again from the mission service" className="rounded-md p-1 text-ink-3 hover:bg-white/10 hover:text-ink"><RefreshCw className="size-3.5" /></button>
          <button onClick={() => setOpen((o) => !o)} aria-expanded={full} title={full ? 'Show less' : 'Show more'} className="rounded-md p-1 text-ink-3 hover:bg-white/10 hover:text-ink">{full ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}</button>
        </span>
      </div>
      <div className="mt-0.5 text-[11px] text-ink-3">{m.name} · {m.mover_name}{m.revision != null && ` · plan ${m.revision}`}</div>

      {!m.planned ? (
        <p className="mt-2 rounded-lg bg-white/5 px-2.5 py-2 text-xs text-ink-2">This mission has no route yet. Plan it in the main map (Route step), then press refresh.</p>
      ) : (<>
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
          {[
            ['Route', km(m.distance_m)],
            ['Legs', String(m.legs.length)],
            ['Moving + science', m.seconds != null ? hm(m.seconds) : 'n/a'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-white/5 py-1.5"><div className="text-[10px] text-ink-3">{k}</div><div className="font-mono text-[13px]">{v}</div></div>
          ))}
        </div>
        {full && <ol className="mt-2 space-y-0.5 text-[11px] text-ink-2">
          {m.targets.map((t, i) => (
            <li key={t.id || i} className="flex justify-between gap-2">
              <span className="truncate"><span className="font-mono text-[#e2733c]">{i + 1}</span> {t.name}</span>
              <span className="shrink-0 text-ink-3">{t.inside ? 'in this map' : 'beyond this map'}</span>
            </li>
          ))}
        </ol>}
        {full && <p className="mt-2 text-[11px] leading-snug text-ink-3">
          {km(m.inside_m)} of the route lies in this 2 km map, on 5 m HiRISE terrain. The rest is drawn on the 80 km CTX backdrop, where the ground is too coarse to drive. <Tag k="CALC" />
        </p>}
        {full && m.feasible != null && (
          <div className={clsx('mt-2 rounded-lg px-2.5 py-1.5 text-[11px] leading-snug', m.feasible ? 'bg-nominal/10 text-nominal' : 'bg-warning/15 text-warning')}>
            {m.feasible ? 'Supplies cover the plan' : 'Supplies do not cover the plan'}{m.feasibility_reason ? `: ${m.feasibility_reason}` : ''} <Tag k="CALC" />
          </div>
        )}
        {f ? (
          <div className={clsx('mt-2 rounded-lg px-2.5 py-1.5 text-[11px] leading-snug', f.clear ? 'bg-nominal/10 text-nominal' : 'bg-warning/15 text-warning')}>
            {f.clear
              ? `1 m check: nothing on this route is steeper than the ${f.limit_deg}° limit.`
              : `1 m check: ${f.stretches} stretch${f.stretches === 1 ? '' : 'es'}, ${f.over_limit_m.toFixed(0)} m in all, steeper than the ${f.limit_deg}° limit (up to ${f.max_slope_deg.toFixed(1)}°). Shown in red on the route.`} <Tag k="NASA" />
          </div>
        ) : (
          <p className="mt-2 text-[11px] leading-snug text-ink-3">This plan has not been checked on the 1 m elevation model yet. Run the check in the main map's Route step to see steep stretches here.</p>
        )}
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {driving
            ? <button onClick={() => actions.stopExpedition('stopped by operator')} className="flex items-center justify-center gap-1.5 rounded-lg bg-warning py-2 text-xs font-semibold text-white"><Square className="size-3.5" />Stop</button>
            : <button onClick={() => void actions.driveMission()} disabled={busy} title="Drive the first leg of the mission inside this map, on the 5 m terrain"
                className="flex items-center justify-center gap-1.5 rounded-lg bg-[#e2733c] py-2 text-xs font-semibold text-black hover:bg-[#f08a55] disabled:opacity-50"><Navigation className="size-3.5" />{busy ? 'Planning…' : 'Drive it'}</button>}
          <button onClick={() => actions.flyMission()} aria-pressed={flying} title="Fly the camera along the whole route, out to every target and back"
            className={clsx('flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium', flying ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/15')}><Plane className="size-3.5" />{flying ? 'Stop flight' : 'Fly the route'}</button>
          <button onClick={() => actions.toggleMission()} aria-pressed={show}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-white/10 py-2 text-xs font-medium hover:bg-white/15">{show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}{show ? 'Hide' : 'Show'}</button>
        </div>
      </>)}
    </div>
  )
}
