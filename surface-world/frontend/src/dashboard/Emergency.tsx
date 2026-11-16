import { AlertTriangle, CheckCircle2, Loader2, Radio, X, XCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { Tag } from '@/dashboard/HUD'
import { abortRedHorizon, approve, habitatNote, RH } from '@/state/redHorizon'
import { sim, useUI } from '@/state/store'
import { useEffect, useState } from 'react'

const mins = (s: number) => `${(s / 60).toFixed(1)} min`

/** Operation Red Horizon: the advisory, the approval and the outcome. */
export function RedHorizonCard() {
  const rh = useUI((s) => s.redHorizon)
  const [, tick] = useState(0)
  useEffect(() => { const id = setInterval(() => tick((t) => t + 1), 250); return () => clearInterval(id) }, [])
  if (!rh) return null
  const delay = sim.commDelayS
  return (
    <div className="glass pointer-events-auto w-[min(640px,calc(100vw-32px))] rounded-2xl border border-warning/40 p-4" role="dialog" aria-label="Operation Red Horizon">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-warning"><AlertTriangle className="size-3.5" />Operation Red Horizon <Tag k="SIM" /></div>
          <h2 className="mt-1 text-lg font-bold tracking-tight">
            {rh.phase === 'advisory' ? 'Suit leak and ankle injury in a dust storm' : rh.phase === 'executing' ? 'Rescue under way' : rh.phase === 'resolved' ? 'Crew member safe' : 'Rescue failed'}
          </h2>
        </div>
        <button onClick={abortRedHorizon} aria-label="End scenario" title="End the scenario and reset" className="rounded-lg p-1 text-ink-3 hover:bg-white/10 hover:text-ink"><X className="size-5" /></button>
      </div>

      {rh.phase === 'advisory' && (<>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
          Suit O₂ {sim.astro.o2G.toFixed(0)} g and falling {RH.leakGps} g/s faster than normal. The astronaut can only walk at {RH.injuredPace * 100}% pace. {habitatNote()}
        </p>
        <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-[11.5px] text-ink-2"><Radio className="mt-0.5 size-3.5 shrink-0 text-accent" />
          Earth will see this {mins(delay)} from now and could answer in {mins(delay * 2)} at the earliest. The crew decides with this advisory.</p>
        {!rh.options ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-ink-3"><Loader2 className="size-4 animate-spin" />Planning both options on the terrain…</div>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {rh.options.map((o) => {
              const rec = rh.recommended === o.id
              return (
                <div key={o.id} className={clsx('flex flex-col rounded-xl p-3', rec ? 'bg-nominal/10 ring-1 ring-nominal/50' : 'bg-white/5')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{o.title}</span>
                    {rec ? <span className="rounded-full bg-nominal/20 px-2 py-0.5 text-[10px] font-semibold text-nominal">Recommended</span>
                      : !o.feasible ? <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-semibold text-warning">Not survivable</span> : null}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-ink-3">{o.timeS ? `${mins(o.timeS)} · ` : ''}{o.o2HomeG > 0 ? `${o.o2HomeG.toFixed(0)} g O₂ at safety` : 'O₂ runs out'} <Tag k="CALC" /></div>
                  <ul className="mt-1.5 flex-1 list-disc space-y-0.5 pl-4 text-[11.5px] leading-snug text-ink-2">{o.lines.map((l) => <li key={l}>{l}</li>)}</ul>
                  <button onClick={() => approve(o.id)} disabled={!o.feasible}
                    className={clsx('mt-2 rounded-lg py-1.5 text-xs font-semibold disabled:opacity-40', rec ? 'bg-nasa text-white hover:bg-nasa-hover' : 'bg-white/10 hover:bg-white/15')}>Approve</button>
                </div>
              )
            })}
          </div>
        )}
      </>)}

      {rh.phase === 'executing' && (
        <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
          {[
            ['Stage', rh.stage === 'walk-home' ? 'Walking home' : rh.stage === 'rover-out' ? 'Rover en route' : 'Riding home'],
            ['Suit O₂', `${sim.astro.o2G.toFixed(0)} g`],
            ['Leak', sim.astro.leakGps > 0 ? `${sim.astro.leakGps} g/s` : 'patched'],
            ['Re-plans', String(rh.replans)],
          ].map(([k, v]) => <div key={k} className="rounded-lg bg-white/5 py-1.5"><div className="text-[10px] text-ink-3">{k}</div><div className={clsx('font-mono text-[13px]', k === 'Suit O₂' && sim.astro.o2G < 60 && 'text-warning')}>{v}</div></div>)}
        </div>
      )}

      {(rh.phase === 'resolved' || rh.phase === 'failed') && rh.result && (
        <div className={clsx('mt-2 flex items-start gap-2 rounded-xl px-3 py-2 text-[13px]', rh.phase === 'resolved' ? 'bg-nominal/10 text-nominal' : 'bg-warning/15 text-warning')}>
          {rh.phase === 'resolved' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
          <span>{rh.result.text}{rh.chosen !== rh.recommended && rh.recommended && rh.phase === 'resolved' ? ' You overrode the advisory and it still worked.' : ''}</span>
        </div>
      )}
      <p className="mt-2 text-[10.5px] text-ink-3">Scenario values (leak rate, injury pace, spare cartridge) are simulation parameters. Routes, slopes and distances come from the real terrain.</p>
    </div>
  )
}
