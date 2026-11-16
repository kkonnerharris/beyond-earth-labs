"use client";

import type { Mission, RegionInfo } from "@/lib/api";
import { fmtDistance, fmtDuration, resourceLabel } from "@/lib/geo";
import { ScoreCard } from "./Steps";
import { PartsPanel, type PartRow } from "./Thread";
import { Grid, Note, Row, Section, Stat } from "./ui";

/* The evidence tables are built from the experiment files the science service
   returns. No accuracy figure is typed into this file. */

type AttrBlock = Record<string, { r2: number; r2_sd?: number }>;
type Evidence = {
  directory?: string;
  config?: { version?: string; backbone?: string; trained_utc?: string; dataset?: { cells?: number; bodies?: Record<string, { cells: number; regions: number }> } };
  validation?: {
    runs?: string[];
    experiments?: {
      E1?: { results: Record<string, Record<string, AttrBlock>> };
      E2?: { results: Record<string, Record<string, AttrBlock | unknown>> };
      E3?: { results?: Record<string, Record<string, AttrBlock>> };
      E4?: { k: number; queries: number; gallery_control_fraction: number;
             methods?: Record<string, { fraction_of_chance_to_oracle_gap_closed: number; control_fraction_at_k: number }> };
      E5?: { majority_class_accuracy: number; representations: Record<string, { body_classifier_accuracy: number }> };
    };
  };
  registry?: { models: { version: string; decision: string; passed: boolean; decided_utc: string;
                         checks: { check: string; candidate: number; reference: number; passed: boolean }[] }[] };
};

const PRIMARY = ["slope_median_deg", "relief_m", "roughness_m"];
const mean = (b?: AttrBlock | unknown): number | null => {
  const block = b as AttrBlock | undefined;
  if (!block || !PRIMARY.every((a) => block[a])) return null;
  return PRIMARY.reduce((s, a) => s + block[a].r2, 0) / PRIMARY.length;
};
const f2 = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v.toFixed(2));

const METHOD_LABEL: Record<string, string> = {
  mean: "Training average (no image)", hand_ridge: "Classical texture + ridge", hand_rf: "Classical texture + forest",
  dino_ridge: "DINOv2 + linear probe", head: "DINOv2 + trained terrain head",
};

function Table({ head, rows }: { head: string[]; rows: (string | number | null)[][] }) {
  return (
    <table className="w-full text-[11.5px]">
      <thead><tr className="text-faint">{head.map((h, i) => <th key={i} className={`pb-1 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-line/60">
            {r.map((c, j) => <td key={j} className={`py-1 ${j ? "num text-right" : "text-muted"} ${j && i === rows.length - 1 ? "text-mars-soft" : ""}`}>{typeof c === "number" ? f2(c) : c ?? "–"}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ModelEvidence({ model }: { model: Evidence | null }) {
  const ex = model?.validation?.experiments;
  if (!model || !ex) return <Section title="Terrain model evidence"><Note tone="warn">No trained model or experiment results are available from the science service.</Note></Section>;
  const e1 = ex.E1?.results, e2 = ex.E2?.results, e3 = ex.E3?.results, e4 = ex.E4, e5 = ex.E5;
  const ds = model.config?.dataset;
  const gate = model.registry?.models?.find((m) => m.version === model.config?.version);
  return (
    <>
      <Section title="Terrain model" kind="model">
        <Row label="Deployed version">{model.config?.version ?? model.directory}</Row>
        <Row label="Image encoder (frozen)">{model.config?.backbone?.split(".")[0]}</Row>
        <Row label="Training cells">{ds?.cells} across {Object.values(ds?.bodies ?? {}).reduce((s, b) => s + b.regions, 0)} regions</Row>
        <p className="mt-2 text-[11.5px] leading-snug text-muted">
          The network sees an image of an 11 km cell and predicts what the elevation data measures there. Every figure below is from regions it never saw in training. R² of 1 is perfect; 0 is no better than the training average; below 0 is worse than that.
        </p>
      </Section>

      {e1 && (
        <Section title="Held-out regions on the same planet" kind="calc">
          <Table head={["Method", "Mars", "Moon", "Earth"]}
                 rows={["hand_ridge", "hand_rf", "dino_ridge", "head"].filter((m) => e1[m]).map((m) => [METHOD_LABEL[m], mean(e1[m].mars), mean(e1[m].moon), mean(e1[m].earth)])} />
          <p className="mt-2 text-[11px] leading-snug text-faint">Mean R² over slope, relief and roughness. Five-fold cross-validation over whole regions.</p>
        </Section>
      )}

      {e2 && (
        <Section title="Trained on two bodies, tested on the third" kind="calc">
          <Table head={["No labels from the test body", "→ Mars", "→ Moon", "→ Earth"]}
                 rows={[["hand_ridge+none", "Classical texture + ridge"], ["head+none", "Terrain head, no adaptation"], ["head+body_norm", "Terrain head, per-body normalisation"]]
                   .map(([k, label]) => [label, mean(e2.mars?.[k]), mean(e2.moon?.[k]), mean(e2.earth?.[k])])} />
          <p className="mt-2 text-[11px] leading-snug text-faint">Per-body normalisation uses the test body&apos;s images but none of its labels.</p>
        </Section>
      )}

      {e3 && (
        <Section title="How many labelled Mars regions are needed" kind="calc">
          <Table head={["Labelled Mars regions", "Earth + Moon + Mars", "Mars only"]}
                 rows={Object.keys(e3).map((k) => [k, mean(e3[k].head), mean(e3[k].target_only_head)])} />
          <p className="mt-2 text-[11px] leading-snug text-faint">Tested on 12 other Mars regions. &quot;Mars only&quot; trains on the labelled Mars regions alone.</p>
        </Section>
      )}

      {e4?.methods && (
        <Section title="Finding Earth matches for Mars cells" kind="calc">
          <Table head={["Representation", "Gap closed", "Controls in top 10"]}
                 rows={[["handcrafted", "Classical texture"], ["dinov2_raw", "DINOv2, untrained"], ["head", "Trained terrain head"]].filter(([k]) => e4.methods![k])
                   .map(([k, label]) => [label, e4.methods![k].fraction_of_chance_to_oracle_gap_closed, e4.methods![k].control_fraction_at_k])} />
          <p className="mt-2 text-[11px] leading-snug text-faint">
            Gap closed: 0 is a random Earth cell, 1 is the physically closest Earth cell by elevation data. Control regions (farmland, forest, alpine) are {(e4.gallery_control_fraction * 100).toFixed(0)}% of the Earth cells. The head was trained without Mars labels for this test.
          </p>
        </Section>
      )}

      <Section title="What the evidence says">
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[12px] leading-snug text-muted">
          {e1?.head?.mars && e1?.hand_rf?.mars && <li>On held-out Mars regions the trained head reaches R² {f2(mean(e1.head.mars))} against {f2(Math.max(mean(e1.hand_rf.mars) ?? -9, mean(e1.hand_ridge?.mars) ?? -9))} for the best classical baseline.</li>}
          {e2?.mars && <li>Without adaptation, what is learned on Earth and the Moon {(mean(e2.mars["head+none"]) ?? 0) < 0.15 ? "does not carry over" : "partly carries over"} to Mars (R² {f2(mean(e2.mars["head+none"]))}). With label-free per-body normalisation it reaches {f2(mean(e2.mars["head+body_norm"]))}.</li>}
          {e2?.earth && (mean(e2.earth["head+body_norm"]) ?? 0) < 0.1 && <li>The reverse direction fails: a model trained on Mars and the Moon cannot read Earth terrain (R² {f2(mean(e2.earth["head+body_norm"]))}). Vegetation and land cover break the link between brightness and landform.</li>}
          {e3 && e3["16"] && <li>Earth and Moon data help most when Mars labels are scarce. With 16 labelled Mars regions, Mars-only training scores {f2(mean(e3["16"].target_only_head))} against {f2(mean(e3["16"].head))} with the other bodies added.</li>}
          {e5 && <li>A simple classifier can tell which body an untrained DINOv2 feature came from {(e5.representations.dinov2_raw.body_classifier_accuracy * 100).toFixed(0)}% of the time, which is the domain gap in one number. For the trained embedding it is {(e5.representations.head_embedding.body_classifier_accuracy * 100).toFixed(0)}%.</li>}
        </ul>
      </Section>

      {gate && (
        <Section title="Validation gate" kind="calc">
          <Note tone={gate.passed ? "good" : "bad"}>Version {gate.version}: {gate.decision}.</Note>
          <ul className="mt-2 flex flex-col gap-1.5">
            {gate.checks.map((c) => (
              <li key={c.check} className="text-[11.5px] leading-snug">
                <span className={c.passed ? "text-good" : "text-bad"}>{c.passed ? "Passed" : "Failed"}</span>
                <span className="text-muted"> · {c.check.replace(/^[A-E]\.\s*/, "")}: </span>
                <span className="num text-text">{c.candidate.toFixed(3)} against {c.reference.toFixed(3)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-snug text-faint">A retrained model replaces this one only if it scores higher on held-out Mars regions without falling back on any body. Nothing has been retrained yet, so no improvement over time is claimed.</p>
        </Section>
      )}
    </>
  );
}

export function StepReview({ mission, model, region, parts, best }: {
  mission: Mission; model: Evidence | null; region: RegionInfo | null; parts: PartRow[]; best?: number | null;
}) {
  const s = mission.sim, p = mission.plan;
  const r = resourceLabel(s.resource);
  const ran = s.phase !== "idle";
  const visited = mission.targets.filter((t) => t.visited).length;
  const decisions = mission.events.filter((e) => e.kind === "decision" || e.kind === "emergency" || e.kind === "warning");
  const download = () => {
    const blob = new Blob([JSON.stringify({ exported_utc: new Date().toISOString(), region: region?.region, mission, model_version: model?.config?.version }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${mission.id}-report.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <Section title="Mission report" kind="sim" action={<button className="btn" onClick={download}>Download JSON</button>}>
        {!ran ? <Note>Run the simulation to produce a report.</Note> : (
          <>
            <Grid>
              <Stat label="Planned" value={p ? fmtDistance(p.distance_m) : "–"} />
              <Stat label="Travelled" value={fmtDistance(s.distance_m)} />
              <Stat label="Elapsed" value={fmtDuration(s.seconds)} />
              <Stat label="Targets visited" value={`${visited} / ${mission.targets.length}`} tone={visited < mission.targets.length ? "warn" : "good"} />
              <Stat label={`${r.name} left`} value={`${((s.remaining / Math.max(s.capacity, 1e-9)) * 100).toFixed(0)}%`} />
              <Stat label="Replans" value={s.replans} />
            </Grid>
            <p className="mt-2.5 text-[12px] leading-snug text-muted">
              {mission.fine_check && p && mission.fine_check.revision === p.revision
                ? <>1 m check: {mission.fine_check.summary}</>
                : <>This plan was not checked against NASA&apos;s 1 m elevation model (Route step).</>}
            </p>
            {decisions.length > 0 && (
              <ol className="mt-3 flex flex-col gap-1.5 border-t border-line pt-2.5">
                {decisions.map((e, i) => (
                  <li key={i} className="grid grid-cols-[52px_1fr] gap-2 text-[11.5px] leading-snug">
                    <span className="num text-faint">{(e.t_seconds / 60).toFixed(0)} min</span>
                    <span className={e.kind === "decision" ? "text-warn" : "text-[#f3a79f]"}>{e.message}</span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </Section>

      <ScoreCard mission={mission} best={best} />

      <PartsPanel rows={parts} />

      <ModelEvidence model={model} />

      <Section title="Can this mission improve the model?">
        <p className="text-[12px] leading-snug text-muted">
          No. Everything in the mission report above is simulated, and a simulation written by this project cannot be independent evidence about real terrain. The only real traverse evidence in this build is Perseverance&apos;s published path, which was used to check the map and the slope limit. New labelled regions, or real rover drive outcomes, would count: they would be added to the dataset, the model retrained, and the candidate put through the gate above.
        </p>
      </Section>

      <Section title="Limits of this build">
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[12px] leading-snug text-muted">
          <li>Routes are planned on 20 m elevation cells and can then be checked on NASA&apos;s 1 m elevation model, which shows banks and scarps a few metres across. Individual rocks, ripples and loose sand are invisible to both.</li>
          <li>The terrain model works at an 11 km regional scale. It does not assess metre-scale hazards and is not used for route costs.</li>
          <li>Mars cells are thermal-infrared images; Earth and Moon cells are visible light.</li>
          <li>Rover, suit, life-support and crop numbers are assumptions; several were entered from memory of NASA documents and are flagged for checking.</li>
          <li>{mission.disclaimer}</li>
        </ul>
      </Section>
    </>
  );
}

export type { Evidence };
