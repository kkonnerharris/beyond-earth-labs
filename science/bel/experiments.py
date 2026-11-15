"""Evaluation experiments for the cross-planetary terrain model.

Every experiment splits by REGION, never by cell: cells from one 78 km
region are spatially correlated, so they always stay on the same side of a
split. All numbers are computed on cells the model never saw in training.

E1  in_domain        5-fold region cross-validation on all bodies.
E2  leave_body_out   Train on two bodies, test on the third (the domain-shift
                     test: "learn on Earth, adapt on Mars"), with and without
                     label-free domain adaptation.
E3  few_shot         Add k labelled regions of the target body; learning curve.
E4  retrieval        Mars cell -> nearest Earth cells. Are the retrieved cells
                     physically closer than chance, and are documented analog
                     sites preferred over control regions?
E5  domain_gap       How well a linear classifier can tell which body a
                     feature vector came from (lower = smaller domain gap).

Methods compared in E1-E3:
    mean         predict the training mean (no information from the image)
    hand_ridge   classical texture features + ridge regression
    hand_rf      classical texture features + random forest
    dino_ridge   frozen DINOv2 features + ridge regression (linear probe)
    head         frozen DINOv2 features + the trained TerrainHead

DINOv2 features are centred and scaled per body from image statistics (no
labels) before either DINOv2 method, because E2 measured that without this
step they do not transfer between bodies. E2 reports both variants.

Usage:
    python -m bel.experiments run [--only E1 E2 ...] [--seeds 3] [--tag NAME]
    python -m bel.experiments train-final --version v1
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone

import numpy as np

from . import EXPERIMENTS_DIR, MODELS_DIR, terrain
from .dataset import DATASET_VERSION, PATCH_DIR
from .features import BACKBONE_NAME, FEATURE_DIR
from .model import HeadConfig, Standardiser, predict, save_model, train_head

BODIES = ("earth", "mars", "moon")
PRIMARY = ("slope_median_deg", "relief_m", "roughness_m")


# ----------------------------------------------------------------------------
# Data
# ----------------------------------------------------------------------------

class Cells:
    """All terrain cells with both feature kinds, attributes and region labels."""

    def __init__(self):
        dino, hand, attrs, body, region, control, analog = [], [], [], [], [], [], []
        self.region_meta = {}
        for meta_path in sorted(PATCH_DIR.glob("*/*.json")):
            b, key = meta_path.parent.name, meta_path.stem
            npz, fd, fh = (meta_path.with_suffix(".npz"), FEATURE_DIR / "dinov2" / b / f"{key}.npy",
                           FEATURE_DIR / "handcrafted" / b / f"{key}.npy")
            if not (npz.exists() and fd.exists() and fh.exists()):
                continue
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            a = np.load(npz)["attrs"]
            xd, xh = np.load(fd), np.load(fh)
            if not (len(xd) == len(xh) == len(a)):
                raise SystemExit(f"{b}/{key}: features are stale ({len(xd)}, {len(xh)} rows for {len(a)} cells); "
                                 "rerun bel.features extract")
            dino.append(xd)
            hand.append(xh)
            attrs.append(a)
            rid = f"{b}:{key}"
            body += [b] * len(a)
            region += [rid] * len(a)
            control += [bool(meta["region"]["control"])] * len(a)
            analog += [bool(meta["region"]["analog_for"])] * len(a)
            self.region_meta[rid] = meta["region"]
        if not dino:
            raise SystemExit("no cells with features found; run bel.dataset build and bel.features extract first")
        self.dino = np.concatenate(dino).astype(np.float32)
        self.hand = np.concatenate(hand).astype(np.float32)
        self.attrs = np.concatenate(attrs).astype(np.float64)
        self.y = terrain.log_attributes(self.attrs)
        self.body = np.array(body)
        self.region = np.array(region)
        self.control = np.array(control)
        self.analog = np.array(analog)

    def summary(self) -> dict:
        out = {"dataset_version": DATASET_VERSION, "cells": int(len(self.y)), "bodies": {}}
        for b in BODIES:
            m = self.body == b
            if m.any():
                out["bodies"][b] = {
                    "cells": int(m.sum()), "regions": int(len(set(self.region[m]))),
                    "median": {n: round(float(np.median(self.attrs[m, i])), 3)
                               for i, n in enumerate(terrain.ATTRIBUTE_NAMES)},
                }
        return out


def body_normalise(x: np.ndarray, body: np.ndarray, fit: np.ndarray | None = None, min_cells: int = 50):
    """Centre and scale features separately for each body, using image statistics only (no labels).

    `fit` marks the cells whose statistics may be used (the training cells).
    A body with fewer than `min_cells` such cells is a target body: its
    statistics then come from all of its own images, which is unsupervised
    domain adaptation and is reported as such. Returns (normalised x, stats).
    """
    out = x.copy()
    stats = {}
    for b in BODIES:
        mb = body == b
        if not mb.any():
            continue
        src = mb & fit if fit is not None and (mb & fit).sum() >= min_cells else mb
        mean, std = x[src].mean(0), x[src].std(0) + 1e-6
        out[mb] = (x[mb] - mean) / std
        stats[b] = (mean, std)
    return out, stats


def region_folds(regions: np.ndarray, k: int, seed: int) -> list[np.ndarray]:
    """k disjoint groups of whole regions, stratified by body. Returns boolean test masks."""
    rng = np.random.default_rng(seed)
    masks = [np.zeros(len(regions), dtype=bool) for _ in range(k)]
    for b in BODIES:
        uniq = sorted({r for r in regions if r.startswith(b + ":")})
        rng.shuffle(uniq)
        for i, r in enumerate(uniq):
            masks[i % k] |= regions == r
    return masks


# ----------------------------------------------------------------------------
# Methods and metrics
# ----------------------------------------------------------------------------

def r2_and_mae(y_true: np.ndarray, y_pred: np.ndarray, y_train_mean: np.ndarray) -> dict:
    """Per-attribute R2 in log space and median absolute error in physical units.

    R2 is measured against the *training* mean, so a model that only learns
    the training set's average scores 0 and one that is misled scores < 0.
    """
    out = {}
    for i, n in enumerate(terrain.ATTRIBUTE_NAMES):
        ss_res = float(((y_true[:, i] - y_pred[:, i]) ** 2).sum())
        ss_tot = float(((y_true[:, i] - y_train_mean[i]) ** 2).sum())
        phys_err = np.abs(np.expm1(y_true[:, i]) - np.expm1(y_pred[:, i]))
        out[n] = {"r2": round(1.0 - ss_res / max(ss_tot, 1e-12), 4),
                  "median_abs_error": round(float(np.median(phys_err)), 4)}
    return out


def fit_predict(method: str, c: Cells, train: np.ndarray, test: np.ndarray, seed: int,
                cfg: HeadConfig | None = None, adapt: str = "body_norm") -> np.ndarray:
    """Train `method` on train cells and return predicted log-attributes for test cells.

    adapt (head and dino_ridge only):
        none        features used as they are
        body_norm   each body's features are centred and scaled with that
                    body's own image statistics (labels are not used)
        coral       head only: CORAL loss against unlabelled test-body images
    """
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.linear_model import RidgeCV
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    ytr = c.y[train]
    if method == "mean":
        return np.tile(ytr.mean(0), (int(test.sum()), 1))
    if method in ("hand_ridge", "hand_rf"):
        xtr, xte = c.hand[train], c.hand[test]
        if method == "hand_ridge":
            m = make_pipeline(StandardScaler(), RidgeCV(alphas=np.logspace(-2, 3, 12)))
        else:
            m = RandomForestRegressor(n_estimators=100, min_samples_leaf=3, n_jobs=4, random_state=seed)
        return m.fit(xtr, ytr).predict(xte)

    x = c.dino
    if adapt == "body_norm":
        x, _ = body_normalise(c.dino, c.body, fit=train)
    xtr, xte = x[train], x[test]
    if method == "dino_ridge":
        m = make_pipeline(StandardScaler(), RidgeCV(alphas=np.logspace(0, 5, 12)))
        return m.fit(xtr, ytr).predict(xte)
    if method == "head":
        cfg = cfg or HeadConfig()
        cfg = HeadConfig(**{**asdict(cfg), "seed": seed,
                            "coral_weight": 1.0 if adapt == "coral" else 0.0})
        model, std, _ = train_head(xtr, c.attrs[train], cfg,
                                   x_target_unlabelled=xte if adapt == "coral" else None)
        _, pred = predict(model, std, xte)
        return terrain.log_attributes(pred)
    raise ValueError(method)


METHODS = ("mean", "hand_ridge", "hand_rf", "dino_ridge", "head")


def _aggregate(runs: list[dict]) -> dict:
    """Mean and standard deviation over seeds/folds of nested {attr: {metric: value}} dicts."""
    out = {}
    for attr in runs[0]:
        out[attr] = {}
        for metric in runs[0][attr]:
            v = np.array([r[attr][metric] for r in runs], dtype=np.float64)
            out[attr][metric] = round(float(v.mean()), 4)
            out[attr][metric + "_sd"] = round(float(v.std()), 4)
    return out


# ----------------------------------------------------------------------------
# Experiments
# ----------------------------------------------------------------------------

def e1_in_domain(c: Cells, seeds: int, log) -> dict:
    res = {m: {b: [] for b in BODIES} for m in METHODS}
    for seed in range(seeds):
        for fold, test in enumerate(region_folds(c.region, 5, seed)):
            train = ~test
            for m in METHODS:
                pred = fit_predict(m, c, train, test, seed)
                for b in BODIES:
                    mb = c.body[test] == b
                    if mb.sum() >= 20:
                        res[m][b].append(r2_and_mae(c.y[test][mb], pred[mb], c.y[train].mean(0)))
            log(f"E1 seed {seed} fold {fold} done")
    return {"design": "5-fold cross-validation over regions, stratified by body; metrics per body on held-out regions",
            "results": {m: {b: _aggregate(v) for b, v in res[m].items() if v} for m in METHODS},
            "n_runs": seeds * 5}


def e2_leave_body_out(c: Cells, seeds: int, log) -> dict:
    variants = [("mean", "none"), ("hand_ridge", "none"), ("hand_rf", "none"), ("dino_ridge", "none"),
                ("dino_ridge", "body_norm"), ("head", "none"), ("head", "body_norm"), ("head", "coral")]
    out = {}
    for target in BODIES:
        test = c.body == target
        train = ~test
        if test.sum() < 50 or len(set(c.body[train])) < 2:
            continue
        out[target] = {"train_bodies": sorted(set(c.body[train])), "test_cells": int(test.sum())}
        for method, adapt in variants:
            runs = [r2_and_mae(c.y[test], fit_predict(method, c, train, test, s, adapt=adapt), c.y[train].mean(0))
                    for s in range(seeds if method in ("head", "hand_rf") else 1)]
            out[target][f"{method}+{adapt}"] = _aggregate(runs)
        log(f"E2 target {target} done")
    return {"design": "train on two bodies, test on every cell of the third; no target labels are ever used. "
                      "body_norm and coral use target images only.",
            "results": out}


def e3_few_shot(c: Cells, seeds: int, log, target: str = "mars") -> dict:
    ks = (0, 1, 2, 4, 8, 16)
    regions = sorted({r for r in c.region if r.startswith(target + ":")})
    if len(regions) < 24:
        return {"skipped": f"only {len(regions)} {target} regions"}
    out = {k: {"head": [], "dino_ridge": [], "target_only_head": []} for k in ks}
    for seed in range(seeds):
        rng = np.random.default_rng(100 + seed)
        perm = list(rng.permutation(regions))
        test_regions, pool = perm[:12], perm[12:]
        test = np.isin(c.region, test_regions)
        source = c.body != target
        for k in ks:
            shots = np.isin(c.region, pool[:k])
            train = source | shots
            for m in ("head", "dino_ridge"):
                pred = fit_predict(m, c, train, test, seed)
                out[k][m].append(r2_and_mae(c.y[test], pred, c.y[train].mean(0)))
            if k >= 2:      # reference: the same target regions without any Earth/Moon data
                pred = fit_predict("head", c, shots, test, seed)
                out[k]["target_only_head"].append(r2_and_mae(c.y[test], pred, c.y[shots].mean(0)))
        log(f"E3 seed {seed} done")
    return {"design": f"12 held-out {target} regions as a fixed test set per seed; training = all cells of the other "
                      f"bodies plus k labelled {target} regions. target_only_head trains on the k regions alone.",
            "results": {str(k): {m: _aggregate(v) for m, v in out[k].items() if v} for k in ks}}


def _embeddings_without_target(c: Cells, target: str, seed: int) -> dict[str, np.ndarray]:
    """Representations for retrieval, none of which used labels from `target`."""
    from sklearn.preprocessing import StandardScaler

    train = c.body != target
    xbn, _ = body_normalise(c.dino, c.body, fit=train)
    model, std, _ = train_head(xbn[train], c.attrs[train], HeadConfig(seed=seed))
    z, _ = predict(model, std, xbn)
    hand = StandardScaler().fit(c.hand[train]).transform(c.hand)
    hand /= np.linalg.norm(hand, axis=1, keepdims=True) + 1e-9
    dino = c.dino / (np.linalg.norm(c.dino, axis=1, keepdims=True) + 1e-9)
    dino_bn = xbn / (np.linalg.norm(xbn, axis=1, keepdims=True) + 1e-9)
    return {"head": z, "dinov2_body_norm": dino_bn, "dinov2_raw": dino, "handcrafted": hand}


def e4_retrieval(c: Cells, seeds: int, log, query_body: str = "mars", gallery_body: str = "earth",
                 k: int = 10) -> dict:
    q, g = c.body == query_body, c.body == gallery_body
    if q.sum() < 50 or g.sum() < 50:
        return {"skipped": "not enough query or gallery cells"}
    # Physical distance in standardised log-attribute space (statistics from the gallery).
    ystd = Standardiser.fit(c.dino[g], c.y[g])
    yq, yg = ystd.y(c.y[q]), ystd.y(c.y[g])
    d_phys = np.linalg.norm(yq[:, None, :] - yg[None, :, :], axis=2)
    rng = np.random.default_rng(0)
    random_idx = rng.integers(0, g.sum(), size=(int(q.sum()), k))
    chance = float(np.take_along_axis(d_phys, random_idx, axis=1).mean())
    oracle = float(np.sort(d_phys, axis=1)[:, :k].mean())
    g_control, g_analog = c.control[g], c.analog[g]
    out = {"k": k, "queries": int(q.sum()), "gallery": int(g.sum()),
           "chance_physical_distance": round(chance, 4), "oracle_physical_distance": round(oracle, 4),
           "gallery_control_fraction": round(float(g_control.mean()), 4), "methods": {}}
    per_method: dict[str, list[dict]] = {}
    for seed in range(seeds):
        reps = _embeddings_without_target(c, query_body, seed)
        for name, emb in reps.items():
            sim = emb[q] @ emb[g].T
            top = np.argsort(-sim, axis=1)[:, :k]
            per_method.setdefault(name, []).append({
                "physical_distance_at_k": float(np.take_along_axis(d_phys, top, axis=1).mean()),
                "control_fraction_at_k": float(g_control[top].mean()),
                "documented_analog_fraction_at_k": float(g_analog[top].mean()),
            })
        log(f"E4 seed {seed} done")
    for name, runs in per_method.items():
        out["methods"][name] = {kk: round(float(np.mean([r[kk] for r in runs])), 4) for kk in runs[0]}
        gain = (chance - out["methods"][name]["physical_distance_at_k"]) / max(chance - oracle, 1e-9)
        out["methods"][name]["fraction_of_chance_to_oracle_gap_closed"] = round(float(gain), 4)
    out["design"] = (f"each {query_body} cell retrieves its {k} nearest {gallery_body} cells by cosine similarity. "
                     f"The head was trained without any {query_body} labels. Physical distance is the Euclidean "
                     "distance between standardised log-attributes measured from elevation data. "
                     "chance = random gallery cells; oracle = the physically nearest gallery cells.")
    return out


def e5_domain_gap(c: Cells, seeds: int, log) -> dict:
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    body_norm, _ = body_normalise(c.dino, c.body)
    model, std, _ = train_head(body_norm, c.attrs, HeadConfig(seed=0))
    z, _ = predict(model, std, body_norm)
    reps = {"handcrafted": c.hand, "dinov2_raw": c.dino, "dinov2_body_norm": body_norm, "head_embedding": z}
    labels = c.body
    counts = {b: int((labels == b).sum()) for b in BODIES}
    majority = max(counts.values()) / len(labels)
    out = {"majority_class_accuracy": round(majority, 4), "representations": {}}
    for name, x in reps.items():
        accs = []
        for seed in range(seeds):
            for test in region_folds(c.region, 5, seed)[:2]:
                clf = make_pipeline(StandardScaler(), LogisticRegression(max_iter=300, C=0.1))
                clf.fit(x[~test], labels[~test])
                accs.append(float((clf.predict(x[test]) == labels[test]).mean()))
        out["representations"][name] = {"body_classifier_accuracy": round(float(np.mean(accs)), 4),
                                        "sd": round(float(np.std(accs)), 4)}
        log(f"E5 {name} done")
    out["design"] = ("a linear classifier predicts which body a held-out-region cell came from. Accuracy near the "
                     "majority-class rate means the representation carries little body-specific signal. Note: the "
                     "head embedding here comes from a head trained on all cells, so it is descriptive only.")
    return out


EXPERIMENTS = {"E1": e1_in_domain, "E2": e2_leave_body_out, "E3": e3_few_shot, "E4": e4_retrieval,
               "E5": e5_domain_gap}


def run(only: list[str] | None, seeds: int, tag: str) -> dict:
    c = Cells()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = EXPERIMENTS_DIR / "runs" / f"{stamp}-{tag}"
    run_dir.mkdir(parents=True, exist_ok=True)
    log_path = run_dir / "log.txt"

    def log(msg: str) -> None:
        line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
        print(line, flush=True)
        with open(log_path, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")

    report = {"run": f"{stamp}-{tag}", "data": c.summary(), "backbone": BACKBONE_NAME,
              "head_config": asdict(HeadConfig()), "seeds": seeds, "experiments": {}}
    log(json.dumps(report["data"]))
    for name, fn in EXPERIMENTS.items():
        if only and name not in only:
            continue
        t0 = time.time()
        report["experiments"][name] = fn(c, seeds, log)
        report["experiments"][name]["seconds"] = round(time.time() - t0, 1)
        (run_dir / "metrics.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    log(f"wrote {run_dir / 'metrics.json'}")
    return report


def train_final(version: str, seed: int = 0) -> dict:
    """Train the deployable head on every cell and save it with its provenance.

    The saved model's accuracy is NOT measured here (it has seen all cells).
    Its expected accuracy is the cross-validated figure from the most recent
    experiment run, which is copied into the model's config for reference.
    """
    c = Cells()
    cfg = HeadConfig(seed=seed)
    xbn, stats = body_normalise(c.dino, c.body)
    model, std, hist = train_head(xbn, c.attrs, cfg, log=print)
    z, _ = predict(model, std, xbn)
    out_dir = MODELS_DIR / f"terrain-head-{version}"
    runs = sorted((EXPERIMENTS_DIR / "runs").glob("*/metrics.json"))
    extra = {
        "version": version, "backbone": BACKBONE_NAME, "dataset": c.summary(),
        "trained_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "final_training_loss": hist[-1],
        "validated_by_run": runs[-1].parent.name if runs else None,
        "input": "DINOv2 features centred and scaled per body with that body's image statistics (body_stats.npz)",
        "note": "trained on all cells; see validated_by_run for held-out accuracy",
    }
    save_model(out_dir, model, std, cfg, extra)
    np.savez(out_dir / "body_stats.npz", **{f"{b}_mean": m for b, (m, _) in stats.items()},
             **{f"{b}_std": sd for b, (_, sd) in stats.items()})
    np.savez_compressed(out_dir / "gallery.npz", z=z.astype(np.float32), attrs=c.attrs.astype(np.float32),
                        body=c.body, region=c.region, control=c.control, analog=c.analog)
    (out_dir / "regions.json").write_text(json.dumps(c.region_meta, indent=1), encoding="utf-8")
    return extra


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--only", nargs="*")
    r.add_argument("--seeds", type=int, default=3)
    r.add_argument("--tag", default="eval")
    t = sub.add_parser("train-final")
    t.add_argument("--version", required=True)
    args = ap.parse_args(argv)
    if args.cmd == "run":
        run(args.only, args.seeds, args.tag)
    else:
        print(json.dumps(train_final(args.version), indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
