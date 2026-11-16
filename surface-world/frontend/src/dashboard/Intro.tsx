import { ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Cinematic title screen. The background is an AI-generated concept image (Higgsfield) with a slow
 * CSS push-in; it is labeled as illustrative. It also covers terrain loading, so judges never see a spinner.
 * Skipped with ?intro=0 (tests) and after the first visit in a session.
 */
export function Intro({ ready, onEnter }: { ready: boolean; onEnter: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const [hasVideo, setHasVideo] = useState(false)
  useEffect(() => {
    fetch('/intro/intro.mp4', { method: 'HEAD' }).then((r) => setHasVideo(r.ok && (r.headers.get('content-type') ?? '').includes('video'))).catch(() => {})
  }, [])
  const enter = () => {
    setLeaving(true)
    setTimeout(onEnter, 700)
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (ready && (e.code === 'Enter' || e.code === 'Space')) enter() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  return (
    <div className={`absolute inset-0 z-50 overflow-hidden bg-black transition-opacity duration-700 ${leaving ? 'opacity-0' : 'opacity-100'}`}>
      {hasVideo
        ? <video className="absolute inset-0 size-full object-cover" src="/intro/intro.mp4" poster="/intro/intro.jpg" autoPlay muted loop playsInline />
        : <div className="intro-kenburns absolute inset-0 bg-cover bg-center" style={{ backgroundImage: 'url(/intro/intro.jpg)' }} />}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/40" />
      <div className="absolute inset-x-0 bottom-0 px-10 pb-14 md:px-16">
        <div className="max-w-3xl">
          <div className="mb-3 flex items-center gap-3 text-xs font-medium uppercase tracking-[0.25em] text-[#ffb07a]">
            <span className="h-px w-10 bg-[#ffb07a]" />NASA Space Apps 2026 · Beyond Earth Labs
          </div>
          <h1 className="text-5xl font-bold tracking-tight text-white md:text-7xl">BEYOND EARTH LABS</h1>
          <p className="mt-2 text-xl font-light text-white/85 md:text-2xl">The 3D world of Jezero Crater</p>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-white/75">
            Plan a Marswalk across real Jezero Crater terrain from NASA's HiRISE camera. Drive the rover, guide the astronaut, and
            watch every decision ripple through power, oxygen and crew health.
          </p>
          <button onClick={enter} disabled={!ready}
            className="mt-8 inline-flex items-center gap-3 rounded-full bg-white px-7 py-3.5 text-base font-semibold text-black transition hover:gap-4 disabled:opacity-60">
            {ready ? <>Enter mission control <ArrowRight className="size-5" /></> : 'Preparing terrain…'}
          </button>
        </div>
      </div>
      <div className="absolute bottom-4 right-5 text-right text-[11px] leading-snug text-white/55">
        Title image: concept visualization · AI-generated (Higgsfield) · not a real photograph<br />
        Not affiliated with or endorsed by NASA
      </div>
    </div>
  )
}
