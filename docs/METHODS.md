# Scientific methods and results

All results below come from `experiments/runs/20261115T011739Z-transfer` (E2) and
`experiments/runs/20261115T012908Z-eval` (E1, E3, E4, E5), on dataset `terra-cells-v1` (4,534 cells).
Reproduce them with the commands in the README. Print any run with `python scripts/show_metrics.py <metrics.json>`.

## 1. The question

Can a network that has learned what terrain looks like on one body say something true about terrain on
another, and is that useful for choosing where on Earth to test Mars hardware?

"True" needs a yardstick that does not come from the network. Ours is elevation data: slope, relief and
roughness measured from laser and radar altimetry on all three bodies.

## 2. Data

One **terrain cell** is an 11.2 km square with two independent measurements of the same ground.

| | Image (model input) | Elevation (yardstick) |
|---|---|---|
| Mars | THEMIS daytime infrared, 100 m (2001 Mars Odyssey) | MOLA MEGDR, 463 m (Mars Global Surveyor) |
| Moon | LROC Wide Angle Camera, 100 m (LRO) | LOLA GDR, 474 m (LRO) |
| Earth | HLS L30 red band, 30 m averaged to 100 m (Landsat 8/9) | NASADEM, 30 m averaged to 467 m (SRTM); Copernicus GLO-30 above 60° N |

- Images are 112 × 112 pixels; elevation patches are 24 × 24 cells of 467 m, the same on every body.
- A **region** is a 7 × 7 block of cells (78 km). 39 Mars, 28 Moon and 29 Earth regions: 1,911 + 1,372 + 1,251 cells.
- Earth regions are 23 documented planetary analog sites and 6 control regions (farmland, forest, alpine)
  that nobody proposes as analogs.
- Attributes per cell: median slope, 90th-percentile slope, relief, roughness (RMS height about the
  best-fit plane), terrain ruggedness index. The model predicts log(1 + value), in physical units, never
  normalised per body.
- Cells with gaps in image or elevation are dropped. On Earth, open water is dropped (flat **and** dark);
  salt flats are kept.

## 3. Model

```
image → frozen DINOv2 ViT-S/14 → 768 features → per-body normalisation → TerrainHead → 128-d embedding, 5 attributes
```

- **Backbone:** DINOv2 ViT-S/14 (22 M parameters), frozen. [CLS] token plus mean patch token.
- **Per-body normalisation:** features are centred and scaled with each body's own image statistics. It
  uses images only, no labels. Experiment E2 is why it exists.
- **TerrainHead:** two hidden layers of 512, a 128-d unit-length embedding, and a linear layer from the
  embedding to the five attributes (0.72 M trainable parameters).
- **Loss:** smooth-L1 regression on the attributes, plus a kernel-weighted contrastive loss that pulls
  together cells whose *measured* attributes are close and pushes apart cells whose attributes differ.
  The embedding therefore encodes physical similarity, not appearance.
- 60 epochs, AdamW, one-cycle schedule, batch 256, CPU only.

## 4. Experiments and results

Every split is by whole region. Cells of one region are spatially correlated, so they never straddle a
split. R² is in log space against the **training** mean: 0 means no better than knowing the average, below
0 means misled. Figures are means over slope, relief and roughness unless stated.

### E1. Held-out regions on the same body (5-fold over regions, 3 seeds)

| Method | Mars | Moon | Earth |
|---|---|---|---|
| Classical texture + ridge | 0.52 | 0.60 | −0.30 |
| Classical texture + random forest | 0.52 | 0.65 | −0.09 |
| DINOv2 + ridge (linear probe) | 0.60 | 0.79 | 0.27 |
| **DINOv2 + trained head** | **0.64** | **0.82** | **0.31** |

The head is best on every body. The gain over the linear probe is real but small (0.03 to 0.04). Earth is
hard for every method: vegetation and land cover control brightness there, not landform. Standard
deviations across folds are 0.05 to 0.2, so differences between the top two rows are within one fold's noise on Earth.

### E2. Train on two bodies, test on the third, with no labels from the test body

| Method | → Mars | → Moon | → Earth |
|---|---|---|---|
| Classical texture + ridge | 0.21 | 0.25 | −0.61 |
| DINOv2 + ridge | 0.11 | 0.39 | −0.39 |
| Trained head, no adaptation | 0.05 | 0.47 | −0.20 |
| Trained head, CORAL | 0.04 | 0.47 | −0.21 |
| DINOv2 + ridge, per-body normalisation | **0.43** | **0.65** | −0.07 |
| Trained head, per-body normalisation | **0.42** | 0.55 | −0.05 |

- Without adaptation, deep features do **not** transfer to Mars. The classical baseline is better.
- Per-body normalisation, which needs only unlabelled target images, lifts transfer to Mars to 0.42 to 0.43.
  The trained head is no better than the linear probe here.
- CORAL as implemented made no difference.
- Transfer **to Earth fails** for every method.

### E3. How many labelled Mars regions are needed (12 held-out Mars regions, 3 seeds)

| Labelled Mars regions | Earth + Moon + Mars | Mars only |
|---|---|---|
| 0 | 0.43 | — |
| 2 | 0.46 | 0.27 |
| 4 | 0.49 | 0.33 |
| 8 | 0.52 | 0.56 |
| 16 | 0.59 | 0.62 |

Other-body data helps when Mars labels are scarce (up to about 4 regions). From 8 regions on, Mars-only
training is as good or slightly better. "Learn on Earth" is a head start, not a lasting advantage.

### E4. Mars cell → 10 nearest Earth cells (head trained with no Mars labels)

| Representation | Share of the random-to-ideal gap closed | Controls in top 10 |
|---|---|---|
| Classical texture | −0.18 | 8% |
| DINOv2, untrained | 0.17 | 10% |
| DINOv2, per-body normalised | 0.13 | 14% |
| **Trained head embedding** | **0.52** | 9% |

"Gap closed" compares the physical distance of retrieved Earth cells with random cells (0) and with the
physically nearest cells (1). The trained embedding is three times better than untrained DINOv2 at
finding physically similar Earth terrain. Control regions are 17% of Earth cells; every method retrieves
them less often than chance, and the head is not better than the others at avoiding them.

### E5. How separable are the bodies?

A linear classifier identifies the body from an untrained DINOv2 feature 95.5% of the time (majority
class 42%). From the trained embedding: 63%. The embedding still carries body-specific signal.

## 5. Validation gate

`python -m bel.registry gate` decides deployment from held-out measurements only. Version v1 passed:
held-out Mars R² 0.635 against 0.519 for the best classical baseline, and retrieval gap closed 0.525
against 0.172 for untrained DINOv2. A later candidate must improve held-out Mars R² by at least 0.01
without losing more than 0.02 on any body. No second model has been trained, so **no improvement over
time has been demonstrated or is claimed.**

## 6. The Jezero map checked against the real rover

`data/jezero/validation.json`, built by `bel.jezero`:

- At 464 Perseverance waypoints, the mission's recorded elevation minus our CTX-derived grid has a median
  of 1.0 m and a median absolute deviation of 1.8 m.
- Perseverance crossed no 20 m cell steeper than 18.3°. 1.7% of the mission area is steeper than 20°;
  0% of the rover's path is. This is the basis for the rovers' 20° limit.

## 7. What the model is and is not used for

- **Used:** ranking Earth analog regions; regional terrain attributes where only imagery is at hand.
- **Not used:** route costs or hazard decisions. Routes use measured elevation at 20 m. The model works at
  11 km and has not been validated at rover scale, so using it for routing would be unsupported.

## 8. Limitations

- Mars images are thermal infrared; Moon and Earth images are visible light. Results mix a sensor
  difference with a planet difference and cannot separate them.
- Elevation labels at 467 m describe regional terrain. Nothing here speaks to metre-scale hazards.
- Per-cell contrast stretching removes absolute brightness, which carries information about slope.
- Region centres and literature citations were written from the AI model's knowledge and need a human check.
- The final head reaches a training loss far below its cross-validated error: it has capacity to spare and
  its hyperparameters were not tuned.
- 96 regions is a small sample of three worlds. Fold-to-fold variation is large.
- The Earth "documented analog" label comes from our own reading of the literature, not from a
  community database.
