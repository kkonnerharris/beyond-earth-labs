// Opens the 3D rover world from the main app and saves a screenshot.
//   node scripts/ui_world.cjs <output folder> [playwright module path]
const path = require("path");
const out = process.argv[2] || ".";
const { chromium } = require(process.argv[3] || "playwright");
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + String(e).slice(0, 200)));
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url().slice(0, 120)}`); });
  await page.goto("http://127.0.0.1:4770/", { waitUntil: "networkidle", timeout: 90000 });
  await page.getByRole("button", { name: "3D world", exact: true }).click();
  const frame = page.frameLocator('iframe[title="3D rover world of Jezero Crater"]');
  await frame.locator("canvas").first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(25000);
  await page.screenshot({ path: path.join(out, "30-3d-world.png") });
  console.log("saved 30-3d-world");
  // Drive forward for a moment with the keyboard, as a player would.
  await frame.locator("canvas").first().click({ position: { x: 700, y: 420 } });
  await page.keyboard.down("w"); await page.waitForTimeout(6000); await page.keyboard.up("w");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(out, "31-3d-world-driving.png") });
  console.log("saved 31-3d-world-driving");
  console.log(problems.length ? "PROBLEMS:\n" + [...new Set(problems)].join("\n") : "no page errors or HTTP errors");
  await browser.close();
})().catch((e) => { console.error("world check failed:", e.message); process.exit(1); });
