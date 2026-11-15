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

  await page.goto("http://127.0.0.1:4770/", { waitUntil: "networkidle", timeout: 90000 });
  await settle(2500);
  await shot("01-start");

  await page.getByRole("button", { name: "Create exploration mission" }).click();
  await settle(9000);
  await shot("02-mission-created");

  // Step 2: analogs.
  await page.getByRole("button", { name: /Analogs/ }).click();
  await page.getByRole("button", { name: /Find Earth analogs/ }).click();
  await page.waitForSelector("text=Ranked candidates", { timeout: 30000 });
  await page.locator("ol > li button").first().click();
  await settle(600);
  await shot("03-analogs");

  // Step 3: place two targets west of the landing site.
  await page.getByRole("button", { name: /Route/ }).click();
  await page.getByRole("button", { name: "Add targets on the map" }).click();
  const map = page.locator(".maplibregl-canvas");
  const box = await map.boundingBox();
  await page.mouse.click(box.x + box.width * 0.50, box.y + box.height * 0.40);
  await settle(1500);
  await page.mouse.click(box.x + box.width * 0.40, box.y + box.height * 0.30);
  await settle(2000);
  await page.keyboard.press("Escape");
  await shot("04-route");

  // Inspect a point on Perseverance's path: terrain values and rover camera frames.
  await page.mouse.click(box.x + box.width * 0.515, box.y + box.height * 0.62);
  await page.waitForSelector("text=View from the ground", { timeout: 15000 });
  await settle(9000);
  await shot("04a-point-and-ground-view");

  await page.getByLabel("Slope").check();
  await settle(2500);
  await shot("04b-slope-layer");
  await page.getByLabel("Slope").uncheck();

  await page.getByRole("button", { name: /Crew/ }).click();
  await settle(400);
  await shot("05-crew");

  await page.getByRole("button", { name: /Habitat/ }).click();
  await settle(400);
  await shot("06-habitat");

  // Step 6: run, inject an obstacle.
  await page.getByRole("button", { name: /Simulate/ }).click();
  await page.getByRole("button", { name: "Start traverse" }).click();
  await settle(5000);
  await page.getByRole("button", { name: /Obstacle ahead/ }).click();
  await settle(4000);
  await shot("07-simulate-obstacle");

  // Run the rest of the traverse at the highest time compression and capture the score.
  await page.getByLabel("Time compression").focus();
  await page.keyboard.press("End");
  await page.waitForSelector("text=Mission score", { timeout: 90000 });
  await settle(800);
  await shot("07b-score");

  await page.getByRole("button", { name: /Review/ }).click();
  await settle(800);
  await shot("08-review");

  await page.getByRole("radio", { name: "Moon comparison" }).click();
  await settle(7000);
  await shot("09-moon");

  // NASA's CLPS list: open the terrain comparison for the first delivery with a measured site.
  await page.getByRole("button", { name: "Terrain and Earth analogs for this site" }).first().click();
  await page.waitForSelector("text=Ranked candidates", { timeout: 30000 });
  await page.locator("aside .scroll-thin").first().evaluate((el) => el.scrollTo(0, 0));
  await settle(5000);
  await shot("10-clps-site-analogs");

  console.log(problems.length ? "PROBLEMS:\n" + [...new Set(problems)].join("\n") : "no console errors, failed requests or HTTP errors");
  await browser.close();
})().catch((e) => { console.error("UI check failed:", e.message); process.exit(1); });
