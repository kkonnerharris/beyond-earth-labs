"use client";

import type { ReactNode } from "react";

/** Where a number comes from. Every figure in the workspace carries one of these. */
export type Kind = "obs" | "calc" | "model" | "sim" | "assume";
const KIND_LABEL: Record<Kind, string> = {
  obs: "NASA data", calc: "Calculated", model: "Model", sim: "Simulated", assume: "Assumption",
};
const KIND_TITLE: Record<Kind, string> = {
  obs: "A NASA measurement, or a value read directly from one",
  calc: "Computed from measurements by a documented formula",
  model: "Predicted by the trained neural network",
  sim: "Produced by the mission simulation",
  assume: "An engineering assumption you can change",
};

export function Chip({ kind }: { kind: Kind }) {
  return <span className={`chip chip-${kind}`} title={KIND_TITLE[kind]}>{KIND_LABEL[kind]}</span>;
}

export function Section({ title, kind, children, action }: { title: string; kind?: Kind; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-3.5 first:border-t-0">
      <header className="mb-2.5 flex items-center gap-2">
        <h3 className="label">{title}</h3>
        {kind && <Chip kind={kind} />}
        <span className="flex-1" />
        {action}
      </header>
      {children}
    </section>
  );
}

export function Stat({ label, value, unit, tone }: { label: string; value: ReactNode; unit?: string; tone?: "good" | "warn" | "bad" }) {
  const colour = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-text";
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-muted">{label}</div>
      <div className={`num text-[15px] font-medium ${colour}`}>
        {value}{unit && <span className="ml-1 text-[11px] font-normal text-muted">{unit}</span>}
      </div>
    </div>
  );
}

export function Grid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={`grid gap-x-3 gap-y-2.5 ${cols === 2 ? "grid-cols-2" : "grid-cols-3"}`}>{children}</div>;
}

/** A horizontal meter. `mark` draws a threshold line (for example the reserve). */
export function Meter({ value, max, mark, tone = "signal", label }: { value: number; max: number; mark?: number; tone?: "signal" | "mars" | "good" | "warn" | "bad"; label: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const bg = { signal: "bg-signal", mars: "bg-mars", good: "bg-good", warn: "bg-warn", bad: "bg-bad" }[tone];
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-sm bg-line" role="meter" aria-label={label}
         aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className={`h-full ${bg} transition-[width] duration-300 ease-out`} style={{ width: `${pct}%` }} />
      {mark !== undefined && max > 0 && (
        <div className="absolute top-0 h-full w-px bg-text" style={{ left: `${Math.min(100, (mark / max) * 100)}%` }} />
      )}
    </div>
  );
}

export function Note({ children, tone }: { children: ReactNode; tone?: "warn" | "bad" | "good" }) {
  const c = tone === "bad" ? "border-bad/40 bg-bad/10 text-[#f6b9b2]"
    : tone === "warn" ? "border-warn/40 bg-warn/10 text-[#f1d894]"
    : tone === "good" ? "border-good/40 bg-good/10 text-[#aee6c8]"
    : "border-line bg-raised text-muted";
  return <p className={`rounded-md border px-2.5 py-2 text-[12px] leading-snug ${c}`}>{children}</p>;
}

export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="num text-right text-[12px] text-text">{children}</span>
    </div>
  );
}
