// Drives the workspace in headless Chrome and saves screenshots.
//   node scripts/ui_check.cjs <output folder> [playwright module path]
// Needs the three services running (mission :8300, science :8310, web :4770).
const path = require("path");
const out = process.argv[2] || ".";
const { chromium } = require(process.argv[3] || "playwright");

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chrome", headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text().slice(0, 300)); });
  page.on("pageerror", (e) => problems.push("pageerror: " + String(e).slice(0, 300)));
  // The map cancels tile requests it no longer needs when the view moves; those are not failures.
  page.on("requestfailed", (r) => {
    const why = r.failure()?.errorText ?? "";
    if (!why.includes("ERR_ABORTED")) problems.push(`request failed (${why}): ${r.url().slice(0, 140)}`);
  });
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url().slice(0, 140)}`); });
  const shot = async (name) => { await page.screenshot({ path: path.join(out, name + ".png") }); console.log("saved", name); };
  const settle = (ms) => page.waitForTimeout(ms);
  // Step buttons are looked up inside the step bar: the footer's "Continue to ..." button names the next step too.
  const stepBtn = (name) => page.getByRole("navigation", { name: "Mission steps" }).getByRole("button", { name });

  await page.goto("http://127.0.0.1:4770/", { waitUntil: "networkidle", timeout: 90000 });
  await settle(2500);
  await shot("01-start");

  await page.getByRole("button", { name: "Create exploration mission" }).click();
  await settle(9000);
  await shot("02-mission-created");

  // Step 2: analogs.
  await stepBtn(/Analogs/).click();
  await page.getByRole("button", { name: /Find Earth analogs/ }).click();
  await page.waitForSelector("text=Ranked candidates", { timeout: 30000 });
  await page.locator("ol > li button").first().click();
  await settle(600);
  await shot("03-analogs");

  // Step 3: place two targets west of the landing site.
  await stepBtn(/Route/).click();
  await page.getByRole("button", { name: "Add targets on the map" }).click();
  const map = page.locator(".maplibregl-canvas");
  const box = await map.boundingBox();
  await page.mouse.click(box.x + box.width * 0.50, box.y + box.height * 0.40);
  await settle(1500);
  await page.getByLabel("Science at the next target").selectOption({ index: 1 });
  await page.mouse.click(box.x + box.width * 0.40, box.y + box.height * 0.30);
  await settle(2000);
  await page.keyboard.press("Escape");
  await page.waitForSelector("text=45 min on site", { timeout: 15000 });
  await shot("04-route");

  // The same route measured on NASA's 1 m elevation model, then moved off any steep ground it finds.
  // (The first run downloads the elevation under the route, so the waits are long.)
  await page.getByRole("button", { name: "Check this route at 1 m" }).click();
  await page.waitForSelector("text=Steepest at 1 m", { timeout: 300000 });
  await page.getByText("Steepest at 1 m").scrollIntoViewIfNeeded();
  await settle(800);
  await shot("04c-checked-at-1m");
  const move = page.getByRole("button", { name: "Move the route around them" });
  if (await move.count()) {
    await move.click();
    await page.waitForFunction(() => /The route was (moved|replanned)|stays on the route|left on the route|has to go/.test(document.body.innerText), null, { timeout: 300000 });
    await settle(1500);
    await shot("04d-moved-off-steep-ground");
  }

  // Inspect a point on Perseverance's path: terrain values and rover camera frames.
  await page.mouse.click(box.x + box.width * 0.515, box.y + box.height * 0.62);
  await page.waitForSelector("text=View from the ground", { timeout: 15000 });
  await settle(9000);
  await shot("04a-point-and-ground-view");

  await page.getByRole("checkbox", { name: /^Slope/ }).check();
  await settle(2500);
  await shot("04b-slope-layer");
  await page.getByRole("checkbox", { name: /^Slope/ }).uncheck();

  await stepBtn(/Crew/).click();
  await settle(400);
  await shot("05-crew");

  await page.getByRole("button", { name: "Continue to Habitat" }).click();
  await settle(400);
  await shot("06-habitat");

  // Step 6: run, inject an obstacle.
  await stepBtn(/Simulate/).click();
  await page.getByRole("button", { name: "Start traverse" }).click();
  await settle(5000);
  await page.getByRole("button", { name: /Obstacle ahead/ }).click();
  await settle(4000);
  await page.waitForSelector("text=Margin to get home", { timeout: 15000 });
  await shot("07-simulate-obstacle");

  // Run the rest of the traverse at the highest time compression and capture the score.
  await page.getByLabel("Time compression").focus();
  await page.keyboard.press("End");
  await page.waitForSelector("text=Mission score", { timeout: 90000 });
  await settle(800);
  await shot("07b-score");

  await stepBtn(/Review/).click();
  await settle(800);
  await shot("08-review");
  await page.locator("text=How the parts worked together").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForSelector("text=Lunar delivery browser", { timeout: 15000 });
  await settle(500);
  await shot("08a-parts");

  // 3D: raise the terrain at Jezero, then pull back to the globe.
  await stepBtn(/Region/).click();
  await page.getByRole("button", { name: "3D terrain", exact: true }).click();
  await settle(14000);
  await shot("08b-3d-terrain");
  await page.getByRole("button", { name: /Whole planet/ }).click();
  await settle(12000);
  await shot("08c-mars-globe");

  await page.getByRole("radio", { name: "Moon", exact: true }).click();
  await settle(7000);
  await shot("09-moon");

  // NASA's CLPS list: open the terrain comparison for the first delivery with a measured site.
  await page.getByRole("button", { name: "Terrain and Earth analogs for this site" }).first().click();
  await page.waitForSelector("text=Ranked candidates", { timeout: 30000 });
  await page.locator("aside .scroll-thin").first().evaluate((el) => el.scrollTo(0, 0));
  await settle(5000);
  await shot("10-clps-site-analogs");

  // Earth: the globe, then one test site compared with Mars.
  await page.getByRole("radio", { name: "Earth", exact: true }).click();
  await settle(9000);
  await shot("11-earth-globe");
  await page.getByRole("button", { name: /Hanksville/ }).first().click();
  await page.getByRole("button", { name: /Find Mars terrain like/ }).click();
  await page.waitForSelector("text=Ranked candidates", { timeout: 30000 });
  await settle(9000);
  await shot("12-earth-site");

  // Cross-world links: a Mars match opens on the Mars map with the mission still there, the habitat's
  // field site opens on the Earth map, and the Earth view has a way back.
  await page.locator("ol > li button").first().click();
  await page.getByRole("button", { name: /^See .* on the Mars map$/ }).click();
  await page.waitForSelector("nav[aria-label=\"Mission steps\"]", { timeout: 15000 });
  await page.waitForSelector("text=Another region", { timeout: 15000 });
  await settle(9000);
  await shot("12b-match-opened-on-mars");
  await stepBtn(/Habitat/).click();
  await page.getByRole("button", { name: /^See .* on the Earth map$/ }).click({ timeout: 60000 });
  await page.waitForSelector("text=Side trip from", { timeout: 15000 });
  await settle(6000);
  await shot("12c-field-site-on-earth");
  await page.getByRole("button", { name: "Return to Mars" }).click();
  await page.waitForSelector("nav[aria-label=\"Mission steps\"]", { timeout: 15000 });
  await page.getByLabel("Training mode").check();
  await page.waitForSelector("text=Why it matters", { timeout: 15000 });
  await settle(5000);
  await shot("12d-back-on-mars-training");

  await page.goto("http://127.0.0.1:4770/guide", { waitUntil: "networkidle", timeout: 60000 });
  await settle(1500);
  await shot("13-guide");

  console.log(problems.length ? "PROBLEMS:\n" + [...new Set(problems)].join("\n") : "no console errors, failed requests or HTTP errors");
  await browser.close();
})().catch((e) => { console.error("UI check failed:", e.message); process.exit(1); });
