import { Award, CheckCircle2, ChevronRight, Circle, GraduationCap, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { LESSONS, LESSON_POINTS, MAX_SCORE, QUIZ_POINTS, rank, resetLog, watch, type Quiz } from '@/dashboard/trainerLessons'
import { startRedHorizon } from '@/state/redHorizon'
import { ui, useUI } from '@/state/store'
import type { World } from '@/simulation/terrain/heightfield'

/** Per-lesson results for this session: points and what earned them. */
interface Result { lesson: number; quiz: 'right' | 'wrong' | 'none'; bonus: [number, string] | null }
const results: Result[] = []
const score = () => results.reduce((t, r) => t + LESSON_POINTS + (r.quiz === 'right' ? QUIZ_POINTS : 0) + (r.bonus?.[0] ?? 0), 0)

export function openTrainer(lesson = 0) {
  watch()
  resetLog()
  ui.set({ lesson, story: null, showAbout: false, showScience: false, presentation: false, showHelp: false })
}

export function TrainerCard({ world }: { world: World }) {
  const lesson = useUI((s) => s.lesson)
  const [, tick] = useState(0)
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  useEffect(() => { const id = setInterval(() => tick((t) => t + 1), 300); return () => clearInterval(id) }, [])
  useEffect(() => { setQuiz(null); setPicked(null) }, [lesson])
  if (lesson === null) return null
  const close = <button onClick={() => ui.set({ lesson: null })} aria-label="Close trainer" className="rounded-lg p-1 text-ink-3 hover:bg-white/10 hover:text-ink"><X className="size-5" /></button>

  if (lesson >= LESSONS.length) {
    const s = score()
    return (
      <div className="glass pointer-events-auto w-[min(560px,calc(100vw-32px))] rounded-2xl p-5 text-center" role="dialog" aria-label="Trainer results">
        <div className="flex justify-end">{close}</div>
        <Award className="mx-auto size-10 text-[#ffb07a]" />
        <div className="mt-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#ffb07a]">Certified</div>
        <h2 className="text-2xl font-bold tracking-tight">{rank(s / MAX_SCORE)}</h2>
        <div className="mt-1 font-mono text-sm text-ink-2">{s} / {MAX_SCORE} points</div>
        <ul className="mx-auto mt-3 max-w-sm space-y-1 text-left text-xs text-ink-2">
          {results.map((r) => (
            <li key={r.lesson} className="flex justify-between gap-3"><span>{LESSONS[r.lesson].title}{r.bonus && <span className="text-ink-3"> · {r.bonus[1]}</span>}</span>
              <span className="font-mono">{LESSON_POINTS + (r.quiz === 'right' ? QUIZ_POINTS : 0) + (r.bonus?.[0] ?? 0)}</span></li>
          ))}
        </ul>
        <button onClick={() => { results.length = 0; openTrainer(0) }} className="mt-4 rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15">Train again</button>
      </div>
    )
  }

  const L = LESSONS[lesson]
  const done = L.steps.map((s) => s.done(world))
  const firstOpen = done.indexOf(false)
  const stepsDone = firstOpen === -1
  const recorded = results.some((r) => r.lesson === lesson)
  if (stepsDone && L.quiz && !quiz && !recorded) { const q = L.quiz(world); if (q) setQuiz(q) }
  const quizDone = !L.quiz || picked !== null || recorded
  const finish = () => {
    if (!recorded) results.push({ lesson, quiz: !L.quiz ? 'none' : picked === quiz?.answer ? 'right' : 'wrong', bonus: L.bonus?.(world) ?? null })
    resetLog()
    ui.set({ lesson: lesson + 1 })
  }
  return (
    <div className="glass pointer-events-auto w-[min(560px,calc(100vw-32px))] rounded-2xl p-4" role="dialog" aria-label="Junior Astronaut Mission Trainer">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-[#ffb07a]"><GraduationCap className="size-3.5" />Trainer · lesson {lesson + 1} of {LESSONS.length}</div>
          <h2 className="mt-0.5 text-lg font-bold tracking-tight">{L.title}</h2>
        </div>
        <div className="flex items-center gap-2"><span className="font-mono text-xs text-ink-3">{score()} pts</span>{close}</div>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{L.why}</p>
      <ol className="mt-2 space-y-1">
        {L.steps.map((s, k) => (
          <li key={s.text} className={clsx('flex items-start gap-2 text-[13px]', done[k] ? 'text-nominal' : k === firstOpen ? 'text-ink' : 'text-ink-3')}>
            {done[k] ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <Circle className="mt-0.5 size-4 shrink-0" />}{s.text}
          </li>
        ))}
      </ol>
      {L.action === 'red-horizon' && (!done[0] || ui.get().redHorizon?.phase === 'failed') && (
        <button onClick={() => void startRedHorizon(world)} className="mt-2 rounded-lg bg-warning px-3 py-1.5 text-xs font-semibold text-white">{done[0] ? 'Try again' : 'Start Operation Red Horizon'}</button>
      )}
      {stepsDone && quiz && !recorded && (
        <div className="mt-3 rounded-xl bg-white/5 p-3">
          <div className="text-[13px] font-medium">{quiz.question}</div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {quiz.options.map((o, k) => (
              <button key={o + k} disabled={picked !== null} onClick={() => setPicked(k)}
                className={clsx('rounded-lg px-2 py-1.5 text-xs', picked === null ? 'bg-white/10 hover:bg-white/15' : k === quiz.answer ? 'bg-nominal/20 text-nominal' : k === picked ? 'bg-warning/20 text-warning' : 'bg-white/5 text-ink-3')}>{o}</button>
            ))}
          </div>
          {picked !== null && <p className="mt-2 text-xs leading-relaxed text-ink-2"><span className={picked === quiz.answer ? 'text-nominal' : 'text-warning'}>{picked === quiz.answer ? `Correct, +${QUIZ_POINTS}. ` : 'Not quite. '}</span>{quiz.explain}</p>}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex gap-1" aria-hidden="true">{LESSONS.map((_, k) => <span key={k} className={clsx('h-1.5 rounded-full', k === lesson ? 'w-5 bg-white' : k < lesson ? 'w-1.5 bg-nominal' : 'w-1.5 bg-white/30')} />)}</div>
        <button onClick={finish} disabled={!stepsDone || !quizDone}
          className="flex items-center gap-1 rounded-lg bg-nasa px-4 py-1.5 text-xs font-semibold text-white hover:bg-nasa-hover disabled:opacity-40">
          {lesson === LESSONS.length - 1 ? 'Finish' : 'Next lesson'}<ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  )
}
