# Pitch: the script and notes

The full pitch is the five-slide deck plus this script. It fits a three-minute limit. The deck is
`Beyond-Earth-Labs-pitch.pdf`; its source is `pitch.html`. The repository link on slide 5 is
`github.com/kkonnerharris/beyond-earth-labs`; reprint with `node scripts/pitch_pdf.cjs` after any change.

The pitch is about the project: what it is, why a Mars crew needs it, how it works, what powers it, and
where it stands. Every figure comes from [METHODS.md](../METHODS.md), [DATA.md](../DATA.md) or
[TESTS.md](../TESTS.md). If one changes there, change it in `pitch.html` and here.

## What the judges score

Space Apps projects are judged on five things: impact, creativity, validity, relevance and presentation
(the event's Judging and Awards Guide). The deck answers each one:

- **Impact:** slide 1, the three things a crew on Mars has to know.
- **Relevance:** slide 2, what the challenge asks against what the project delivers.
- **Creativity:** slide 2, six other challenges built into one map; slide 4, one network trained on three worlds.
- **Validity:** slides 4 and 5, the checks against measured elevation and Perseverance, the tests, and the stated limits.
- **Presentation:** five plain slides and a three-minute script.

## The script

Written against `Beyond-Earth-Labs-pitch.pdf`, page by page. It says each headline and each line on
the page, in the same order, as spoken sentences, so you can follow the slide with your eyes without
reading it out. It opens with the challenge that was picked and does not ask for awards. If a number
on a slide changes, change it here too.

The limit is three minutes. This script is 408 words, which is 2:48 at a steady 145 words a minute.
Read it aloud once with a timer before presenting.

### Page 1. Beyond Earth Labs (60 words, done by 0:24)

"I picked NASA's Martian Map challenge. My answer is Beyond Earth Labs: one 3D map to plan and carry
out a Marswalk at Jezero Crater. A crew on Mars has to know where it can go, whether it can get
back, and what to do when the plan breaks. This answers all three, on 3D terrain built from NASA
data."

### Page 2. One challenge entered, six more built into it (91 words, done by 1:02)

"One challenge entered, six more built into it. The main challenge is the Martian Map. It asks for a
layered view from several NASA missions: I deliver five missions and twenty datasets on one 3D map.
Three kinds of data: optical, elevation and thermal. Crew safety: slope limits, a supply check and a
radiation estimate. A route that avoids obstacles: routes replanned around hazards. Rover views:
Perseverance's own camera frames. On the right, six other challenges each became a working part of
the same map, like the greenhouse and the Moon."

### Page 3. A Marswalk in three steps: plan, check, run (80 words, done by 1:35)

"A Marswalk in three steps: plan, check, run. Plan: where can the crew go? The route is computed on
NASA elevation, and rovers stay under 20 degrees. Check: can it get back safely? The trip is checked
against oxygen or battery with a reserve, and a plan that does not fit is refused. Run: what if the
plan breaks? An obstacle, a dust storm, a suit leak or a health alert forces a new plan, and the log
records why."

### Page 4. Deep learning finds the Earth sites to rehearse the mission (104 words, done by 2:18)

"Deep learning finds the Earth sites to rehearse the mission. Mars hardware is tested on Earth first,
at sites that resemble Mars. A vision transformer, trained on 4,534 terrain cells from Mars, the
Moon and Earth, finds those sites. On Mars regions it never saw, it explains 64 percent of the
terrain. Matching Earth terrain to Mars, it closes 52 percent of the gap to the best pick. It is
weakest on Earth: even a specialist trained on Earth alone explains only 39 percent, because
vegetation hides the landform. Its top match for Jezero is the Mojave volcanic fields. Routes never
depend on it."

### Page 5. What works today, and what does not (73 words, done by 2:48)

"What works today, and what does not. All seven steps run end to end. The elevation map agrees with
Perseverance's own record to a median of one metre. The limits: routes cannot see rocks, and the
traverse and crew health are simulated. That is Beyond Earth Labs: one 3D map that tells a Mars crew
where to go, whether it can get back, and what to do when the plan breaks. Thank you."

## The short version

One short paragraph a slide: 188 words, about 1:18. Use it when time is tight or as the
version to memorise.

**Slide 1.** "I picked NASA's Martian Map challenge: build a map an astronaut could use to plan and carry out a
walk on Mars. Beyond Earth Labs is my answer, one 3D map of Jezero Crater built from NASA data."

**Slide 2.** "It delivers everything the challenge asks for. Six other Space Apps challenges are built in too,
like a greenhouse for growing food, a crew health monitor, and the Moon."

**Slide 3.** "A crew needs three answers: where can we go, can we get back, and what if the plan breaks. The map
plans a route over real NASA elevation and checks the oxygen or battery. When I reported an
obstacle, it found a new route."

**Slide 4.** "Deep learning picks where to practise on Earth. A neural network trained on Mars, the Moon and Earth
chose the Mojave volcanic fields for Jezero, and real measurements agree. It is weakest on Earth,
and I show that."

**Slide 5.** "It works today, from start to finish, and the map agrees with Perseverance's own record to about
a metre. That is Beyond Earth Labs: one 3D map for where to go, whether you can get back, and what to
do when the plan breaks. Thank you."

## If asked

- **What is next?** Routes on NASA's one metre elevation model of Jezero, which is already tested as
  readable. It would let routes see smaller hazards than the 20 metre cells can.
- **What else is in it?** A ground-level view that can be driven by hand, whole-planet globes of Mars,
  the Moon and Earth, a habitat and greenhouse budget, and NASA's lunar deliveries. See
  [CHALLENGES.md](../CHALLENGES.md).
- **How far do the six other challenges go?** The Earth analog search is complete. The other five are
  partly built, and [CHALLENGES.md](../CHALLENGES.md) says what is left out of each. Only the Martian Map
  is submitted.
- **Radiation?** A dose estimate from one published rate measured by Curiosity. It is not a map layer.
- **Is it trained on Earth?** Yes. The network in the product is trained on all three worlds: 1,911 Mars,
  1,372 Moon and 1,251 Earth cells. On Earth regions it never saw it explains 31%, where classical
  methods score below zero. A specialist trained on Earth alone reaches 39% (experiment E6), better in 9
  of 15 test splits, so the gain is real on average but not consistent. The specialist is not in the
  product, because the Earth-site search needs the shared network. In a separate test with Earth left
  out of training, the network could not read Earth at all (-0.05).
- **How good is the network, really?** A simple linear model on the same features reaches 60%, so the
  gain from the trained head is small (64%). Trained on Earth and the Moon only, it scores 0.05 on Mars
  until each world's images are normalised, with no labels; then 0.42. When matching Earth terrain to a
  Mars cell it closes 52% of the gap between a random pick and the best possible pick; untrained, 17%.
- **What is the network?** DINOv2, a pretrained vision transformer, kept frozen, with a small head
  trained on the project's terrain cells.
- **Which awards fit?** (The deck no longer asks for any; this is only if a judge raises it.) Best Use of Data: 20 NASA datasets and resources from 10 missions, and a map
  checked against a real rover. Best Use of Science: held-out tests, baselines, and a negative result
  reported. Best Mission Concept: supplies are checked first, the way home must always be affordable, and
  the plan changes under four kinds of emergency.
- **How was AI used?** See [AI_USE.md](../AI_USE.md). No language model produces any number in the product.

## Before presenting

- Check the six challenge titles on slide 2 against the official challenge list. Only the Martian Map
  and Space Mission Design Game titles were confirmed on the site; the other four come from the brief.
- Slide 5 shows the 3D world with every overlay hidden. Its terrain shape comes from NASA HiRISE
  elevation; the rover model and the ground textures are illustrative. That 3D world is earlier
  practice code. It is kept out of the public repository and the submission, so be ready to say
  that if a judge asks where it is.

## About the pictures

Every picture is a crop of the running product. Together they go from far to near: the solar system,
Mars in 3D, the ground.

- Slide 1: the product's solar system view, with its heading and buttons hidden. Planets are placed for
  the day of the capture; orbit spacing and planet sizes are not to scale.
- Slide 3: the map's own 3D terrain at Jezero Crater with a planned route (heights doubled), then the
  supply check and the mission report.
- Slide 4: the Earth analog search for Jezero Crater.
- Slide 5: ground level in the 3D world.
- To retake them: `node scripts/ui_pitch.cjs <folder>`, then
  `python scripts/pitch_images.py <folder> docs/pitch/img`, then `node scripts/pitch_pdf.cjs`. Set
  `ONLY=analogs`, `space`, `terrain`, `app` or `world` to retake one part; pictures whose screenshots are
  missing are kept.
