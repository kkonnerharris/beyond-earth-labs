"""Print a compact summary of an experiment run's metrics.json (argument 1)."""
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")
m = json.load(open(sys.argv[1], encoding="utf-8"))
ex = m["experiments"]
A = ["slope_median_deg", "relief_m", "roughness_m"]
print("run:", m["run"], "| cells:", m["data"]["cells"], "| seeds:", m["seeds"])

if "E1" in ex:
    print("\nE1 held-out regions, R2 in log space (sd over folds): slope / relief / roughness")
    for meth, res in ex["E1"]["results"].items():
        for b, v in res.items():
            print(f"  {meth:11s} {b:6s} " + "  ".join(f"{v[a]['r2']:6.3f} ({v[a]['r2_sd']:.3f})" for a in A))
if "E2" in ex:
    print("\nE2 leave one body out, R2: slope / relief / roughness")
    for target, res in ex["E2"]["results"].items():
        for k, v in res.items():
            if isinstance(v, dict):
                print(f"  -> {target:6s} {k:22s} " + "  ".join(f"{v[a]['r2']:6.3f}" for a in A))
if "E3" in ex and "results" in ex["E3"]:
    print("\nE3 few labelled Mars regions, R2: slope / relief / roughness")
    for k, res in ex["E3"]["results"].items():
        print(f"  k={k:>2s} " + " | ".join(f"{meth}: " + " ".join(f"{v[a]['r2']:.3f}" for a in A) for meth, v in res.items()))
if "E4" in ex and "methods" in ex["E4"]:
    e = ex["E4"]
    print(f"\nE4 Mars -> Earth retrieval, k={e['k']}, {e['queries']} queries, {e['gallery']} gallery cells")
    print(f"  chance distance {e['chance_physical_distance']}, oracle {e['oracle_physical_distance']}, "
          f"control share of gallery {e['gallery_control_fraction']}")
    for n, v in e["methods"].items():
        print(f"  {n:18s} dist@k {v['physical_distance_at_k']:.3f}  gap closed {v['fraction_of_chance_to_oracle_gap_closed']:.3f}  "
              f"controls@k {v['control_fraction_at_k']:.3f}  documented analogs@k {v['documented_analog_fraction_at_k']:.3f}")
if "E5" in ex:
    print(f"\nE5 body classifier accuracy (majority class {ex['E5']['majority_class_accuracy']}):")
    for k, v in ex["E5"]["representations"].items():
        print(f"  {k:18s} {v['body_classifier_accuracy']:.3f} (sd {v['sd']:.3f})")
