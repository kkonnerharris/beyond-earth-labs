import { FlaskConical, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { api, type Experiment } from '@/services/api'
import { ui, useUI } from '@/state/store'

let cache: Experiment | null = null
export const experimentData = () => cache
export const setExperimentData = (d: Experiment) => { cache = d }

/**
 * The Perseverance route experiment, for judges and curious users: hypothesis, method, results with
 * a baseline, limits, and every drive replayable on the map (real drive vs our planner).
 */
export function Science() {
  const show = useUI((s) => s.showScience)
  const sel = useUI((s) => s.experimentDrive)
  const [data, setData] = useState<Experiment | null>(cache)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!show || cache) return
    api.experiment().then((d) => { cache = d; setData(d) }).catch((e) => setErr(String(e)))
  }, [show])
  if (!show) return null
  const close = () => ui.set({ showScience: false })
  const best = data?.best_mode
  const s = best ? data!.summary[best] : null
  const pick = (i: number) => ui.set({ experimentDrive: i, showScience: false, camera: 'top' })
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-6" onClick={close}>
      <div className="glass max-h-full w-full max-w-3xl overflow-y-auto rounded-2xl p-7" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Perseverance route experiment">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-[#ffb07a]"><FlaskConical className="size-4" />Experiment · NASA data</div>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">Would our planner have driven where Perseverance drove?</h2>
          </div>
          <button onClick={close} aria-label="Close" className="rounded-lg p-1 text-ink-3 hover:bg-white/10 hover:text-ink"><X className="size-5" /></button>
        </div>
        {err && <p className="mt-4 text-sm text-warning">{err}</p>}
        {!data && !err && <p className="mt-4 text-sm text-ink-3">Running the experiment on the real drives…</p>}
        {data && s && (<>
          <dl className="mt-4 space-y-2 text-sm leading-relaxed text-ink-2">
            <div><dt className="inline font-semibold text-ink">Hypothesis. </dt><dd className="inline">{data.hypothesis}</dd></div>
            <div><dt className="inline font-semibold text-ink">Method. </dt><dd className="inline">{data.method}</dd></div>
          </dl>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [`${s.median_deviation_m} m`, 'median distance from the real drive'],
              [`${Math.round(s.share_within_10m * 100)}%`, 'of drives within 10 m'],
              [`${data.detours.planner_closer} of ${data.detours.drives}`, 'detours explained better than a straight line'],
              [`${data.real_max_slope_overall}°`, 'steepest slope Perseverance drove'],
            ].map(([v, l]) => (
              <div key={l} className="rounded-xl bg-white/5 p-3"><div className="font-mono text-lg font-semibold text-ink">{v}</div><div className="text-[11px] leading-snug text-ink-3">{l}</div></div>
            ))}
          </div>
          <h3 className="mt-5 text-sm font-semibold uppercase tracking-wider text-ink-3">Findings</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-ink-2">{data.findings.map((f) => <li key={f}>{f}</li>)}</ol>
          <p className="mt-3 rounded-lg bg-caution/10 px-3 py-2 text-[12.5px] leading-relaxed text-ink-2"><span className="font-semibold text-ink">Limits. </span>{data.limits}</p>
          <h3 className="mt-5 text-sm font-semibold uppercase tracking-wider text-ink-3">Replay a drive on the map</h3>
          <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-line">
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-[#141a26] text-ink-3"><tr><th className="px-3 py-1.5">Sol</th><th>Real</th><th>Straight line off by</th><th>Planner off by</th><th /></tr></thead>
              <tbody>
                {data.drives.map((d, i) => {
                  const p = d.plans[best!]
                  const win = 'mean_deviation_m' in p && p.mean_deviation_m < d.straight_line_deviation_m
                  return (
                    <tr key={i} className={clsx('border-t border-line', sel === i && 'bg-white/5')}>
                      <td className="px-3 py-1 font-mono">{d.sol}</td>
                      <td className="font-mono">{Math.round(d.real_length_m)} m</td>
                      <td className="font-mono">{d.straight_line_deviation_m.toFixed(1)} m</td>
                      <td className={clsx('font-mono', win && d.straight_line_deviation_m > 5 && 'text-nominal')}>{'mean_deviation_m' in p ? `${p.mean_deviation_m.toFixed(1)} m` : '—'}</td>
                      <td className="pr-2 text-right"><button onClick={() => pick(i)} className="rounded-md bg-nasa px-2 py-0.5 text-[11px] font-medium text-white hover:bg-nasa-hover">Show</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink-3">Real drives: NASA/JPL Mars 2020 localization. Terrain: HiRISE DTM (MRO). Reproduce: <code>GET /api/experiment</code> or <code>backend/science/experiment.py</code>.</p>
        </>)}
      </div>
    </div>
  )
}
