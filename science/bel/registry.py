"""Model registry and validation gate.

A trained head becomes the deployed model only by passing a gate that
compares held-out measurements. Nothing is promoted on training loss, on
simulated missions, or on a claim.

Gate for the first model (nothing deployed yet):
    A. On held-out Mars regions (experiment E1) the head must beat the best
       non-deep-learning baseline on the mean R2 of slope, relief and
       roughness.
    B. In Mars-to-Earth retrieval (E4) the head must close more of the
       chance-to-oracle gap than the untrained DINOv2 features.

Gate for a later candidate (a model is already deployed):
    C. Mean held-out Mars R2 improves by at least MIN_GAIN.
    D. No body's mean held-out R2 falls by more than MAX_REGRESSION.
    E. Retrieval gap closed does not fall by more than MAX_REGRESSION.

Usage:
    python -m bel.registry gate --version v1 --run <run folder name>
    python -m bel.registry show
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

from . import EXPERIMENTS_DIR, MODELS_DIR

PRIMARY = ("slope_median_deg", "relief_m", "roughness_m")
MIN_GAIN = 0.01
MAX_REGRESSION = 0.02
REGISTRY = MODELS_DIR / "registry.json"
DEPLOYED = MODELS_DIR / "deployed.json"


def _mean_r2(block: dict) -> float:
    return sum(block[a]["r2"] for a in PRIMARY) / len(PRIMARY)


def summarise(run: str) -> dict:
    """The numbers the gate uses, taken from one experiment run."""
    metrics = json.loads((EXPERIMENTS_DIR / "runs" / run / "metrics.json").read_text(encoding="utf-8"))
    ex = metrics["experiments"]
    if "E1" not in ex or "E4" not in ex or "methods" not in ex["E4"]:
        raise SystemExit(f"run {run} does not contain experiments E1 and E4; the gate needs both")
    e1 = ex["E1"]["results"]
    out = {"run": run, "cells": metrics["data"]["cells"], "held_out_r2": {}, "baseline_r2_mars": {}}
    for body, block in e1["head"].items():
        out["held_out_r2"][body] = round(_mean_r2(block), 4)
    for method in ("hand_ridge", "hand_rf"):
        if "mars" in e1.get(method, {}):
            out["baseline_r2_mars"][method] = round(_mean_r2(e1[method]["mars"]), 4)
    out["linear_probe_r2_mars"] = round(_mean_r2(e1["dino_ridge"]["mars"]), 4)
    m = ex["E4"]["methods"]
    out["retrieval_gap_closed"] = {k: v["fraction_of_chance_to_oracle_gap_closed"] for k, v in m.items()}
    return out


def gate(version: str, run: str) -> dict:
    cand = summarise(run)
    registry = json.loads(REGISTRY.read_text(encoding="utf-8")) if REGISTRY.exists() else {"models": []}
    deployed = next((m for m in registry["models"] if m.get("deployed")), None)
    checks = []
    if deployed is None:
        best_base = max(cand["baseline_r2_mars"].values())
        checks.append({"check": "A. beats the best classical baseline on held-out Mars regions",
                       "candidate": cand["held_out_r2"]["mars"], "reference": best_base,
                       "passed": cand["held_out_r2"]["mars"] > best_base})
        g = cand["retrieval_gap_closed"]
        checks.append({"check": "B. closes more of the retrieval gap than untrained DINOv2 features",
                       "candidate": g["head"], "reference": g["dinov2_raw"], "passed": g["head"] > g["dinov2_raw"]})
    else:
        prev = deployed["summary"]
        gain = cand["held_out_r2"]["mars"] - prev["held_out_r2"]["mars"]
        checks.append({"check": f"C. held-out Mars R2 improves by at least {MIN_GAIN}",
                       "candidate": cand["held_out_r2"]["mars"], "reference": prev["held_out_r2"]["mars"],
                       "passed": gain >= MIN_GAIN})
        for body, v in cand["held_out_r2"].items():
            ref = prev["held_out_r2"].get(body)
            if ref is not None:
                checks.append({"check": f"D. no regression beyond {MAX_REGRESSION} on {body}",
                               "candidate": v, "reference": ref, "passed": v >= ref - MAX_REGRESSION})
        checks.append({"check": f"E. retrieval gap closed does not fall by more than {MAX_REGRESSION}",
                       "candidate": cand["retrieval_gap_closed"]["head"],
                       "reference": prev["retrieval_gap_closed"]["head"],
                       "passed": cand["retrieval_gap_closed"]["head"] >= prev["retrieval_gap_closed"]["head"] - MAX_REGRESSION})
    passed = all(c["passed"] for c in checks)
    entry = {"version": version, "directory": f"terrain-head-{version}", "summary": cand, "checks": checks,
             "passed": passed, "deployed": passed, "compared_with": deployed["version"] if deployed else None,
             "decided_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
             "decision": "deployed" if passed else "rejected: the deployed model is unchanged"}
    if passed:
        for m in registry["models"]:
            m["deployed"] = False
        DEPLOYED.write_text(json.dumps({"directory": entry["directory"], "version": version}, indent=1), encoding="utf-8")
    registry["models"] = [m for m in registry["models"] if m["version"] != version] + [entry]
    REGISTRY.write_text(json.dumps(registry, indent=1), encoding="utf-8")
    return entry


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gate")
    g.add_argument("--version", required=True)
    g.add_argument("--run", required=True)
    sub.add_parser("show")
    args = ap.parse_args(argv)
    if args.cmd == "gate":
        print(json.dumps(gate(args.version, args.run), indent=1))
    else:
        print(REGISTRY.read_text(encoding="utf-8") if REGISTRY.exists() else "no models registered")
    return 0


if __name__ == "__main__":
    sys.exit(main())
