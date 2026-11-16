import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Tag } from '@/dashboard/HUD'
import { experimentData, setExperimentData } from '@/dashboard/Science'
import { buildStory, type Chapter } from '@/dashboard/storyChapters'
import { api } from '@/services/api'
import { actions } from '@/state/actions'
import { ui, useUI } from '@/state/store'
import type { World } from '@/simulation/terrain/heightfield'

let chapters: Chapter[] = []
export const storyChapter = (i: number | null) => (i === null ? null : chapters[i] ?? null)

/** Start the story; loads the experiment first so its chapter can quote real numbers. */
export async function startStory() {
  if (!experimentData()) {
    try { setExperimentData(await api.experiment()) } catch { /* the story still runs without the experiment chapter */ }
  }
  ui.set({ story: 0, showAbout: false, showScience: false, presentation: false, showHelp: false, selected: null })
}

export function StoryCard({ world }: { world: World }) {
  const i = useUI((s) => s.story)
  const [, force] = useState(0)
  const list = useMemo(() => {
    const e = experimentData()
    const s = e?.best_mode ? e.summary[e.best_mode] : null
    chapters = buildStory(world, e && s ? { median: s.median_deviation_m, within10: s.share_within_10m, detours: [e.detours.planner_closer, e.detours.drives] } : null)
    return chapters
  }, [world, i === null])
  // the experiment chapter replays one detour drive (the one where the planner beat the line by the most)
  useEffect(() => {
    if (i === null) return
    const ch = list[i]
    const e = experimentData()
    if (ch?.fx === 'experiment' && e?.best_mode) {
      let best = 0, gain = -Infinity
      e.drives.forEach((d, k) => { const p = d.plans[e.best_mode!]; if ('mean_deviation_m' in p && d.straight_line_deviation_m - p.mean_deviation_m > gain) { gain = d.straight_line_deviation_m - p.mean_deviation_m; best = k } })
      ui.set({ experimentDrive: best, camera: 'top' })
    } else if (ui.get().experimentDrive !== null) ui.set({ experimentDrive: null })
    force((n) => n + 1)
  }, [i, list])
  if (i === null) return null
  const ch = list[i]
  if (!ch) return null
  const last = i === list.length - 1
  const exit = () => ui.set({ story: null, experimentDrive: null, camera: 'rover' })
  const finish = () => { ui.set({ story: null, experimentDrive: null, agent: 'astronaut', camera: 'top' }); actions.select({ kind: 'habitat', id: 'habitat', x: world.habitat[0], z: world.habitat[1], label: 'Habitat' }) }
  return (
    <div className="pointer-events-auto absolute bottom-6 left-1/2 w-[min(680px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl p-5 glass" role="dialog" aria-label="Mission story">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#ffb07a]">{ch.kicker}</div>
          <h2 className="mt-1 text-xl font-bold tracking-tight">{ch.title}</h2>
        </div>
        <button onClick={exit} aria-label="Exit story" className="rounded-lg p-1 text-ink-3 hover:bg-white/10 hover:text-ink"><X className="size-5" /></button>
      </div>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{ch.text}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {ch.tags.map((t) => <Tag key={t} k={t} />)}
          <div className="ml-2 flex gap-1" aria-hidden="true">{list.map((_, k) => <span key={k} className={clsx('h-1.5 rounded-full transition-all', k === i ? 'w-5 bg-white' : 'w-1.5 bg-white/30')} />)}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => ui.set({ story: Math.max(0, i - 1) })} disabled={i === 0} className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs disabled:opacity-40"><ChevronLeft className="size-4" />Back</button>
          {last
            ? <button onClick={finish} className="rounded-lg bg-nasa px-4 py-1.5 text-xs font-semibold text-white hover:bg-nasa-hover">Plan my Marswalk</button>
            : <button onClick={() => ui.set({ story: i + 1 })} className="flex items-center gap-1 rounded-lg bg-nasa px-4 py-1.5 text-xs font-semibold text-white hover:bg-nasa-hover">Next<ChevronRight className="size-4" /></button>}
        </div>
      </div>
    </div>
  )
}
