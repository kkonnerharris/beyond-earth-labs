# Scientific methods and results

All results below come from `experiments/runs/20261115T011739Z-transfer` (E2) and
`experiments/runs/20261115T012908Z-eval` (E1, E3, E4, E5) and `experiments/runs/20261115T182943Z-perworld`
(E6), on dataset `terra-cells-v1` (4,534 cells).
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

### E6. One shared model, or one specialist per world? (the E1 folds, 3 seeds)

Added on 15 November to ask whether Earth is better served by a model trained on Earth alone. A
specialist is trained on one world's training regions only. "Ensemble" averages the specialist head and
the specialist linear probe. Same folds and metric as E1; every method sees the same 15 folds.

| Method | Mars | Moon | Earth |
|---|---|---|---|
| Shared head (the deployed recipe) | 0.64 | 0.82 | 0.31 |
| Specialist head per world | 0.65 | 0.83 | 0.37 |
| Specialist linear probe per world | 0.65 | 0.82 | 0.37 |
| **Specialist ensemble per world** | **0.67** | **0.83** | **0.39** |

Gain of the ensemble over the shared head, paired fold by fold: Mars +0.04 (better in 15 of 15 folds),
Moon +0.01 (11 of 15), Earth +0.08 (9 of 15).

- Specialists help on every world. The Mars gain is small and consistent. The Earth gain is the largest
  on average and the least consistent: it loses in 6 folds of 15, and Earth's fold-to-fold spread (0.18)
  is more than twice the gain.
- Earth is still the weakest world by a wide margin. A different network head does not remove the cause:
  vegetation and land cover, not landform, control brightness in the red band.
- The shared linear probe scores lower here (0.60, 0.80, 0.27) than the shared head on every world.
- **Not deployed.** The product ranks Earth analogs with the shared embedding, which specialists do not
  have (a specialist's embedding is not comparable across worlds). The deployed model is unchanged.
- The specialist recipe was chosen after a look at one seed, then confirmed on three. Four variants were
  screened, so the 0.39 carries a small selection bias.

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

## 6b. Checking a route on the 1 m elevation model

Routes are planned on 20 m cells, which cannot see a bank or a crater rim a few metres wide. NASA's 1 m
HiRISE elevation model of Jezero can (`science/bel/hirise.py`, `mission/internal/mission/finecheck.go`).

- **Reading it.** The file is 1.8 GB and uncompressed, so the bytes of any elevation post sit at a known
  offset. Only the posts under a route are read, in 128 x 128 blocks by HTTP range request, and kept on
  disk. The mission area is still not planned on it: that would need the whole file in memory.
- **The measure.** Every 1 m along the route a plane is fitted to the 5 x 5 posts around that point (4 m
  across, about a rover's footprint). Slope is the tilt of that plane; roughness is the RMS height about
  it. A stretch is reported when slope stays above the mover's limit for 2 m or more.
- **Checked against the real rover.** The same measure along the 26.8 km Perseverance drove inside the
  mission area gives a median slope of 3.6 degrees and a 99th percentile of 15.5; 0.1% of it is steeper
  than 20 degrees. The path and the orbital model can be a few metres out of register, so the steepest
  values are an upper bound. The model's elevation agrees with the rover's at 464 waypoints to a median
  of 0.00 m (median absolute deviation 0.02 m).
- **What it finds.** On the two-target route used in the tests (7.6 km to the delta front and the delta
  top), the 20 m plan reports a steepest slope of 17.2 degrees. The 1 m model finds 10 stretches, 258 m
  in all, steeper than the crew rover's 20 degree limit, up to 41.8 degrees.
- **Moving the route.** When asked, the mission service surveys the ground around each steep stretch on
  the 1 m model, keeps the route out of every 20 m cell with steep ground in it, replans and measures
  again, up to six times. If keeping out of all of it leaves no route (a target on top of a scarp can
  only be reached across it), the stretches are taken one at a time, worst first, and the ground around
  one is kept out only if every target can still be reached. On the same route this leaves 5 stretches,
  46 m, up to 27.3 degrees, on a route 0.8 km longer. That is a real reduction and not a clear route: the
  delta top cannot be reached by the crew rover without crossing ground the 1 m model shows as steep, and
  the check says so.
- **Limits.** A 1 m model made from orbital stereo resolves shapes a few metres across. It does not show
  single rocks, loose sand or ripples.

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
