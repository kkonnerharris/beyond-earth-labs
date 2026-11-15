// The seven NASA Space Apps 2026 challenge themes behind the product, and the part of the one
// mission workspace each became. The Review step and the guide both read this list, so the
// interface and the documentation name the parts the same way. See docs/CHALLENGES.md.

export type PartKey = "map" | "analogs" | "health" | "farm" | "game" | "trainer" | "clps";

export type Part = {
  key: PartKey;
  /** Challenge title. The first is the challenge the entry is submitted under. */
  challenge: string;
  primary: boolean;
  /** What the theme became inside the product. */
  part: string;
  where: string;
  /** What this part hands to the rest of the mission. */
  gives: string;
};

export const PARTS: Part[] = [
  { key: "map", primary: true, challenge: "Interplanetary Survival Guide: Martian Map",
    part: "The map, the route and the traverse", where: "Steps 1, 3 and 6",
    gives: "The layered Jezero map that every other part is drawn on, the route across it, and the simulated Marswalk." },
  { key: "analogs", primary: false, challenge: "Identify Earth Locations That Analog Moon and Mars",
    part: "Earth analog search", where: "Step 2, and the Earth and Moon views",
    gives: "Where on Earth this ground could be rehearsed. The top match becomes the field site in the Habitat step." },
  { key: "health", primary: false, challenge: "Create Health Monitoring Software for Astronauts",
    part: "Crew health monitor", where: "Step 4, and live in step 6",
    gives: "Watches the crew while the traverse runs. An alert slows the pace, and the way home is recalculated." },
  { key: "farm", primary: false, challenge: "Field Shift: Adapting Farms with NASA Data",
    part: "Greenhouse and Earth field site", where: "Step 5, and the Earth view",
    gives: "NASA climate records for the rehearsal site, beside a greenhouse whose lamps and water load the habitat's budget." },
  { key: "game", primary: false, challenge: "Space Mission Design Game",
    part: "Mission score", where: "Steps 6 and 7",
    gives: "Scores a finished traverse for science, safety and efficiency, so a plan can be replayed and beaten." },
  { key: "trainer", primary: false, challenge: "Build a Junior Astronaut Mission Trainer",
    part: "Training mode", where: "Top bar, then every step",
    gives: "One task per step in plain words, checked against what you actually do in the live mission." },
  { key: "clps", primary: false, challenge: "CLPS Lunar Mission Browser",
    part: "Lunar delivery browser", where: "The Moon view",
    gives: "NASA's commercial lunar deliveries, with the same terrain comparison run on the regions they land in." },
];
