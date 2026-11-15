# How AI tools were used

The Space Apps rules allow AI tools and require a description of their use. This file is that record.

## Development

I am a solo developer. During the event I used **Claude (Anthropic)**, through Claude Code on a Claude
Max subscription, working from my written project brief. I used it for three things:

- **Project scaffolding.** It set up the structure of the repository: the Next.js web app (`web/`), the Go
  mission service (`mission/`), the Python science service (`science/`), the scripts that start, test and
  check them (`scripts/`), and the set of documents in `docs/`.
- **Choosing which data to use.** It researched the official challenge statement, recommended which NASA
  dataset to use for each job, and tested each data endpoint before the code relied on it. For example,
  it recommended the 20 m CTX elevation model for routes because the 1 m HiRISE model was too large for
  the build machine, NASA Solar System Treks tiles for map imagery, and Landsat HLS through a public
  mirror because the home archive needs a login. The choices, and the datasets that were considered and
  not used, are recorded in [DATA.md](DATA.md).
- **Coding help.** I used it as a coding assistant on the code, the tests and the documentation,
  including the pitch material in `docs/pitch/`.

I direct the work, make the decisions, review the results, and am responsible for the submission.

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
- The times on site for the four science activities (`GOALS` in `web/components/Steps.tsx`, 10 to 45
  minutes) are round-number assumptions, not taken from a NASA source.
- Five of the seven challenge titles in `docs/CHALLENGES.md` and `web/lib/parts.ts` are written as they
  appear in the project brief. Only the Martian Map and Space Mission Design Game titles were checked
  against the official site.
