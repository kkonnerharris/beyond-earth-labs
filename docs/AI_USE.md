# How AI tools were used

The Space Apps rules allow AI tools and require a description of their use. This file is that record.

## Development

- **Claude Code (Anthropic)** wrote the code and documentation in this repository during the event,
  working from the team's written project brief. It also researched the official challenge statement and
  tested each NASA data endpoint before the code relied on it.
- The team directs the work, reviews the results, and is responsible for the submission.

## Inside the product

- **DINOv2 ViT-S/14** (Meta AI, Apache 2.0 licence) is used as a frozen image encoder.
- **The terrain head** is a small neural network trained by this project on NASA data. Its accuracy is
  reported only from held-out regions (`experiments/runs/`).
- No large language model produces any number shown in the product. Similarity scores, routes, risks
  and resource budgets come from the trained model or from documented calculations.

## Things a person must check before submission

- Literature citations in `science/bel/sites.py` were written from the AI model's knowledge. Several were
  replaced where the model was unsure, but none has been checked against the publisher's page.
- Coordinates of named regions in `science/bel/sites.py` are approximate centres typed from the AI
  model's knowledge. The Jezero and Hadley regions were confirmed by looking at the returned images;
  the rest have not been looked at.

## More things a person must check before submission

- Life-support and crop values in `mission/internal/lifesupport/lifesupport.go` marked `Verify: true`
  were entered from the AI model's memory of NASA's Baseline Values and Assumptions Document.
- The walking speed and metabolic model constants in `mission/internal/mobility/mobility.go` were entered
  from memory of Santee et al. (2001) and Marquez (2008).
- The dust transmission assumption (sunlight falls as exp(-0.26 tau)) is an approximation to be checked
  against Appelbaum and Flood (1990).
- Dataset references and DOIs in `docs/DATA.md`: those for the Jezero products, NASADEM and HLS were
  taken from the products' own records; the journal references were written from memory.
