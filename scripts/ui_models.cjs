// Checks the outer-space view and the NASA 3D models for each mover in headless Chrome or Edge.
//   node scripts/ui_models.cjs <output folder> [playwright module path]
// Needs the three services running and the models fetched (scripts/fetch_nasa_models.py).
const path = require("path");
const out = process.argv[2] || ".";
const { chromium } = require(process.argv[3] || "playwright");

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chrome", headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const problems = [];
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text().slice(0, 300)); });
    page.on("pageerror", (e) => problems.push("pageerror: " + String(e).slice(0, 300)));
    page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url().slice(0, 140)}`); });
    await page.goto("http://127.0.0.1:4770/", { waitUntil: "networkidle", timeout: 90000 });
    return page;
  };
  const shot = async (page, name) => { await page.screenshot({ path: path.join(out, name + ".png") }); console.log("saved", name); };

  // 1. Outer space: the three worlds together.
  let page = await open();
  await page.getByRole("button", { name: "Space view" }).click();
  await page.waitForTimeout(9000);
  await shot(page, "20-space-view");
  await page.getByRole("button", { name: /^Mars/ }).first().click();   // pick Mars from space
  await page.waitForTimeout(1500);
  await page.close();

  // 2. Each mover as a NASA 3D model, close up on the terrain.
  const movers = [["Astronaut on foot", "astronaut"], ["Crew rover (unpressurised)", "crew-rover"], ["Robotic scout rover", "scout"]];
  for (const [mover, label] of movers.filter((m) => !process.env.ONLY || m[1] === process.env.ONLY)) {
    page = await open();
    await page.getByRole("button", { name: mover, exact: true }).click();
    await page.getByRole("button", { name: "Create exploration mission" }).click();
    await page.waitForTimeout(6000);
    await page.getByRole("button", { name: "3D terrain", exact: true }).click();
    await page.waitForTimeout(9000);
    await page.waitForTimeout(9000);
    await shot(page, `21-3d-${label}`);
    // Surface view: ride behind the mover and drive it by hand.
    await page.getByRole("button", { name: "Surface view", exact: true }).click();
    await page.waitForTimeout(7000);
    for (const key of ["w", "w", "w", "d", "d", "w", "w", "w", "w"]) { await page.keyboard.press(key); await page.waitForTimeout(900); }
    await page.waitForTimeout(9000);
    await shot(page, `22-surface-${label}`);
    await page.close();
  }

  console.log(problems.length ? "PROBLEMS:\n" + [...new Set(problems)].join("\n") : "no console errors or HTTP errors");
  await browser.close();
})().catch((e) => { console.error("model check failed:", e.message); process.exit(1); });
