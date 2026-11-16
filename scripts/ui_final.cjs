// Takes the photographs of the product used in the final presentation (docs/pitch/final.html).
//   node scripts/ui_final.cjs <output folder> [playwright module path]
// Needs the services running (scripts/services.ps1 start).
//
// 1. The main map at 2x: a traverse to the delta planned in the interface, checked on the 1 m elevation
//    model, then moved off the steep ground.
// 2. The 3D simulation on Mars at 1x: the same kind of mission on the ground, the route flyover, and the
//    thermal infrared layer.
// 3. The 3D simulation on Earth at 1x: the rover at Garden of the Gods, with and without the panels.
// Software rendering is slow, so the waits are long.
const path = require("path");
const out = process.argv[2] || ".";
const { chromium } = require(process.argv[3] || "playwright");
const M = "http://127.0.0.1:8300/api", W = "http://127.0.0.1:8320";
const only = process.env.ONLY;   // "map", "mars" or "earth" to take one part

async function call(url, body) {
  const r = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} from ${url}`);
  return r.json();
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const problems = [];
  const watch = (page, tag) => page.on("pageerror", (e) => problems.push(`${tag} pageerror: ` + String(e).slice(0, 200)));

  if (!only || only === "map") {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    watch(page, "map");
    const shot = async (name) => { await page.screenshot({ path: path.join(out, name + ".png"), timeout: 120000 }); console.log("saved " + name); };
    await page.goto("http://127.0.0.1:4770/", { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(2500);
    await shot("f0-start");
    await page.getByRole("button", { name: "Create exploration mission" }).click();
    await page.waitForTimeout(7000);
    await page.getByRole("navigation", { name: "Mission steps" }).getByRole("button", { name: /Route/ }).click();
    await page.getByRole("button", { name: "Add targets on the map" }).click();
    const box = await page.locator(".maplibregl-canvas").boundingBox();
    // Two targets on the delta, west and north-west of the landing site.
    await page.mouse.click(box.x + box.width * 0.17, box.y + box.height * 0.34);
    await page.waitForTimeout(2500);
    await page.mouse.click(box.x + box.width * 0.06, box.y + box.height * 0.20);
    await page.waitForTimeout(3000);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    await shot("f1-route");
    await page.getByRole("button", { name: "Check this route at 1 m" }).click();
    await page.waitForSelector("text=Steepest at 1 m", { timeout: 300000 });
    await page.getByText("Steepest at 1 m").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await shot("f2-checked-at-1m");
    const move = page.getByRole("button", { name: "Move the route around them" });
    if (await move.count()) {
      await move.click();
      await page.waitForFunction(() => /The route was (moved|replanned)|stays on the route|left on the route|has to go/.test(document.body.innerText), null, { timeout: 300000 });
      await page.getByText("Steepest at 1 m").scrollIntoViewIfNeeded();
      await page.waitForTimeout(2000);
      await shot("f3-moved");
    }
    console.log("1 m summary on screen:", (await page.locator("text=/elevation model/").first().innerText().catch(() => "")).slice(0, 260));
    await page.close();
  }

  if (!only || only === "mars") {
    const m = await call(`${M}/missions`, { name: "Delta front traverse", mover: "crew_rover" });
    await call(`${M}/missions/${m.id}/targets`, { lon: 77.4115, lat: 18.45977, name: "Delta front scarp", objective: "sample", dwell_min: 30 });
    await call(`${M}/missions/${m.id}/targets`, { lon: 77.39727, lat: 18.47327, name: "Delta top", objective: "image", dwell_min: 20 });
    await call(`${M}/missions/${m.id}/plan`, { mover: "crew_rover", objective: "time", risk_weight: 1 });
    await call(`${M}/missions/${m.id}/finecheck`, { avoid: false });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    watch(page, "mars");
    const shot = async (name) => { await page.screenshot({ path: path.join(out, name + ".png"), timeout: 240000 }); console.log("saved " + name); };
    await page.goto(`${W}/?intro=0&embed=1&mission=${m.id}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    const card = page.getByTestId("mission-link");
    await card.waitFor({ timeout: 120000 });
    await page.waitForTimeout(18000);
    await shot("f4-mars-mission");
    await card.getByRole("button", { name: "Fly the route" }).click();
    await page.waitForTimeout(26000);
    await shot("f5-mars-flyover");
    await page.keyboard.press("f");                       // presentation mode: the scene without the panels
    await page.waitForTimeout(5000);
    await shot("f6-mars-flyover-clean");
    await page.keyboard.press("f");
    await card.getByRole("button", { name: "Stop flight" }).click().catch(() => undefined);
    await page.getByRole("button", { name: /Thermal IR/ }).click();
    await page.keyboard.press("4");                       // from above, framed on the route
    await page.waitForTimeout(14000);
    console.log("thermal layer legend shown:", await page.getByText("THEMIS daytime infrared").count());
    await shot("f7-mars-thermal");
    await page.close();
  }

  if (!only || only === "earth") {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    watch(page, "earth");
    const shot = async (name) => { await page.screenshot({ path: path.join(out, name + ".png"), timeout: 240000 }); console.log("saved " + name); };
    await page.goto(`${W}/?region=shawnee&intro=0&embed=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.locator("canvas").first().waitFor({ timeout: 90000 });
    await page.waitForTimeout(40000);
    await shot("f8-earth-rover");
    await page.keyboard.press("f");
    await page.waitForTimeout(6000);
    await shot("f9-earth-rover-clean");
    await page.close();
  }

  console.log(problems.length ? "PROBLEMS:\n" + [...new Set(problems)].join("\n") : "no page errors");
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error("final photographs failed:", e.message); process.exit(1); });
