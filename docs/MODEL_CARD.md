# Model card: terrain-head-v1

| | |
|---|---|
| **What it is** | A small neural network on top of a frozen DINOv2 ViT-S/14 image encoder. From an image of an 11.2 km terrain cell it produces a 128-number terrain embedding and predicts five terrain attributes. |
| **Trained** | 15 November 2026 (UTC), on a laptop CPU, from cached encoder features |
| **Files** | `models/terrain-head-v1/`: `head.pt` (weights), `standardiser.npz`, `body_stats.npz`, `config.json`, `gallery.npz` (embeddings of all cells), `regions.json` |
| **Trainable parameters** | 722,693 (the 22 million encoder parameters are frozen) |
| **Training data** | 4,534 cells from 96 regions: Mars 1,911, Moon 1,372, Earth 1,251 (dataset `terra-cells-v1`, see [DATA.md](DATA.md)) |
| **Labels** | Slope, relief and roughness measured from MOLA, LOLA and NASADEM elevation at a common 467 m cell size |
| **Code** | `science/bel/model.py`, `features.py`, `experiments.py` |

## Intended use

- Ranking Earth regions as terrain analogs for a Mars or Moon region, alongside an independent elevation-based comparison.
- Describing regional terrain (kilometre scale) from imagery.

## Not for

- Route planning, hazard avoidance, landing-site certification or any safety decision.
- Terrain smaller than a few kilometres.
- Earth terrain with vegetation or snow: accuracy there is poor (R² about 0.3). A specialist trained on
  Earth alone reached 0.39 in experiment E6 ([METHODS.md](METHODS.md)); it is not deployed, because the
  analog search needs the shared embedding.

## Accuracy on regions it never saw

The deployed weights were trained on all cells, so their own accuracy cannot be measured directly. The
figures below are from the same recipe trained with regions held out ([METHODS.md](METHODS.md)).

| Test | Mars | Moon | Earth |
|---|---|---|---|
| Held-out regions of the same body, mean R² (slope, relief, roughness) | 0.64 | 0.82 | 0.31 |
| Best classical baseline on the same test | 0.52 | 0.65 | −0.09 |
| Body never seen in training, per-body normalisation | 0.42 | 0.55 | −0.05 |

Finding Earth matches for Mars cells: 52% of the gap between random and ideal closed, against 17% for the untrained encoder.

## How it can be wrong

- **Sensor mismatch.** Mars inputs are thermal infrared, the others visible light. A change of Mars imagery would need retraining.
- **Per-body statistics.** The normalisation step needs a few hundred images of a body. It cannot be applied to a single image of a new world.
- **Small sample.** 96 regions. Accuracy varies by 0.05 to 0.2 in R² from one set of held-out regions to another.
- **Overfitting.** Training loss is far below held-out error; hyperparameters were not tuned.
- **Shading.** Image brightness depends on sun angle, which differs between mosaics and is not modelled.

## Versioning

`models/registry.json` records each version, the experiment run that judged it, each gate check with its
numbers, and the decision. `models/deployed.json` names the version the services load. Version v1 is the
only model so far.
