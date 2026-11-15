"use client";

import { PARTS, type PartKey } from "@/lib/parts";
import { Section } from "./ui";

/* The thread that makes the workspace one mission instead of seven screens: what each step
   hands to the next, the way back from the Moon and Earth, and a summary of how the parts
   affected this mission. Nothing here computes a mission value; it only words what the
   services already returned. */

/** The bar under every Mars step: what this step decided, and the way to the next one. */
export function StepFooter({ step, steps, carried, tone, canNext, onStep }: {
  step: number; steps: readonly string[]; carried: string; tone?: "good" | "warn" | "bad";
  canNext: boolean; onStep: (i: number) => void;
}) {
  const colour = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-muted";
  const last = step === steps.length - 1;
  return (
    <footer className="border-t border-line bg-raised px-4 py-2.5" aria-label="Mission progress">
      <p className={`text-[12px] leading-snug ${colour}`} aria-live="polite">
        <span className="label mr-1.5 text-faint">Carried forward</span>{carried}
      </p>
      <div className="mt-2 flex items-center gap-1.5">
        <button className="btn h-7" onClick={() => onStep(step - 1)} disabled={step === 0}>Back</button>
        <span className="num flex-1 text-center text-[11px] text-faint">Step {step + 1} of {steps.length}</span>
        {last
          ? <button className="btn h-7" onClick={() => onStep(0)}>Back to the start</button>
          : <button className="btn btn-primary h-7" onClick={() => onStep(step + 1)} disabled={!canNext}
                    title={canNext ? undefined : "Create the mission first"}>Continue to {steps[step + 1]}</button>}
      </div>
    </footer>
  );
}

/** Shown on the Moon and Earth: these are side trips from the Mars mission, with a way back. */
export function WorldBanner({ missionName, onBack }: { missionName: string | null; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-line bg-raised px-4 py-2">
      <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
        {missionName ? <>Side trip from <span className="text-text">{missionName}</span></> : "Side trip from the Mars mission"}
      </span>
      <button className="btn h-7" onClick={onBack}>Return to Mars</button>
    </div>
  );
}

export type PartRow = { key: PartKey; result: string; action?: { label: string; run: () => void } };

/** Review step: every part of the product, what it did in this mission, and where it lives. */
export function PartsPanel({ rows }: { rows: PartRow[] }) {
  return (
    <Section title="How the parts worked together">
      <p className="mb-2.5 text-[12px] leading-snug text-muted">
        One mission passes through seven parts. Each began as a NASA Space Apps challenge theme and was built as a capability of this map. This is what each one contributed here.
      </p>
      <ol className="flex flex-col gap-2">
        {PARTS.map((p, i) => {
          const row = rows.find((r) => r.key === p.key);
          return (
            <li key={p.key} className="rounded-md border border-line bg-raised px-3 py-2.5">
              <div className="flex items-baseline gap-2">
                <span className="num text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                <span className="flex-1 text-[13px] font-medium text-text">{p.part}</span>
                {p.primary && <span className="chip chip-model">Our challenge</span>}
              </div>
              <p className="mt-1 text-[12px] leading-snug text-text">{row?.result ?? "Nothing to report yet."}</p>
              <p className="mt-1 text-[11.5px] leading-snug text-muted">{p.gives}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="min-w-0 flex-1 text-[11px] leading-snug text-faint">{p.primary ? "Challenge" : "Theme"}: {p.challenge}. {p.where}.</span>
                {row?.action && <button className="btn h-7 shrink-0 text-[11.5px]" onClick={row.action.run}>{row.action.label}</button>}
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
