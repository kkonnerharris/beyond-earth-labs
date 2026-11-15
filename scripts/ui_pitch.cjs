// Takes the pictures used in the pitch deck (docs/pitch/).
//   node scripts/ui_pitch.cjs <output folder> [playwright module path]
// Needs the services running (scripts/services.ps1 start).
//
// Part 1, the main app at 2x pixel density: the layered map with a planned route, the slope layer,
// the go / no-go check, a traverse replanned around an obstacle, and the mission report.
// Part 2, the 3D world (surface-world/, port 8320) at 1x: the rover from behind with its planned
// route, and the rover with the habitat and astronaut. Software rendering cannot keep up with the
// 3D world at 2x, and it is driven by its keyboard shortcuts (H help, F presentation mode, P plan,
// 5 inspect camera, 3 rover camera). For these two pictures every overlay (site labels, panels,
// title bar) is hidden, so the frame holds only the 3D scene.
const path = require("path");
const out = process.argv[2] || ".";
const { chromium } = require(process.argv[3] || "playwright");
const only = process.env.ONLY;   // "app", "analogs", "space", "terrain" or "world" to take one part

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chrome", headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const problems = [];

  // Part 0, the Earth analog ranking: the sidebar only, with the first candidate opened.
  if (!only || only === "analogs") {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    page.on("pageerror", (e) => problems.push("analogs pageerror: " + String(e).slice(0, 300)));
    await page.goto("http://127.0.0.1:4770/", { waitUntil: "networkidle", timeout: 90000 });
    await page.getByRole("button", { name: "Create exploration mission" }).click();
    await page.waitForTimeout(6000);
    await page.getByRole("navigation", { name: "Mission steps" }).getByRole("button", { name: /Analogs/ }).click();
    await page.getByRole("button", { name: /Find Earth analogs/ }).click();
    await page.waitForSelector("text=Ranked candidates", { timeout: 60000 });
    await page.locator("ol > li button").first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(out, "m6-analogs.png"), clip: { x: 0, y: 0, width: 400, height: 900 }, timeout: 120000 });
    console.log("saved m6-analogs");
    await page.close();
  }

  // The solar system view: the scene and its planet labels only; the heading, list, button and note are hidden.
  if (!only || only === "space") {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    page.on("pageerror", (e) => problems.push("space pageerror: " + String(e).slice(0, 300)));
    await page.goto("http://127.0.0.1:4770/", { waitUntil: "networkidle", timeout: 90000 });
    await page.getByRole("button", { name: "Space view" }).click();
    await page.waitForTimeout(12000);
    await page.addStyleTag({ content: "[role=dialog] > div.pointer-events-none, [role=dialog] > button.btn, [role=dialog] > ul, [role=dialog] > p { visibility: hidden !important; }" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, "m8-space.png"), clip: { x: 0, y: 48, width: 1440, height: 852 }, timeout: 120000 });
    console.log("saved m8-space");
    await page.close();
  }

  // The map's own 3D terrain at Jezero with a planned route: the map area only, panels folded away.
  if (!only || only === "terrain") {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    page.on("pageerror", (e) => problems.push("terrain pageerror: " + String(e).slice(0, 300)));
    await page.goto("http://127.0.0.1:4770/", { waitUntil: "networkidle", timeout: 90000 });
    await page.getByRole("button", { name: "Create exploration mission" }).click();
    await page.waitForTimeout(9000);
    await page.getByRole("navigation", { name: "Mission steps" }).getByRole("button", { name: /Route/ }).click();
    await page.getByRole("button", { name: "Add targets on the map" }).click();
    const box = await page.locator(".maplibregl-canvas").boundingBox();
    await page.mouse.click(box.x + box.width * 0.50, box.y + box.height * 0.40);
    await page.waitForTimeout(2500);
    await page.mouse.click(box.x + box.width * 0.40, box.y + box.height * 0.30);
    await page.waitForTimeout(3000);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Map layers/ }).click();   // fold the layer panel away
    await page.getByRole("button", { name: "3D terrain", exact: true }).click();
    await page.waitForTimeout(16000);
    await page.screenshot({ path: path.join(out, "m7-terrain3d.png"), clip: { x: 400, y: 48, width: 1040, height: 852 }, timeout: 120000 });
    console.log("saved m7-terrain3d");
    await page.close();
  }

  if (!only || only === "app") {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    page.on("pageerror", (e) => problems.push("app pageerror: " + String(e).slice(0, 300)));
    const shot = async (name) => { await page.screenshot({ path: path.join(out, name + ".png"), timeout: 120000 }); console.log("saved", name); };
    const settle = (ms) => page.waitForTimeout(ms);
    const stepBtn = (name) => page.getByRole("navigation", { name: "Mission steps" }).getByRole("button", { name });
    const layers = page.getByRole("button", { name: /Map layers/ });

    await page.goto("http://127.0.0.1:4770/", { waitUntil: "networkidle", timeout: 90000 });
    await page.getByRole("button", { name: "Create exploration mission" }).click();
    await settle(9000);
    await stepBtn(/Route/).click();
    await page.getByRole("button", { name: "Add targets on the map" }).click();
    const box = await page.locator(".maplibregl-canvas").boundingBox();
    await page.mouse.click(box.x + box.width * 0.50, box.y + box.height * 0.40);
    await settle(2500);
    await page.mouse.click(box.x + box.width * 0.40, box.y + box.height * 0.30);
    await settle(3000);
    await page.keyboard.press("Escape");

    await page.getByLabel("Slope").check();
    await layers.click();                       // fold the layer panel away
    await settle(5000);
    await shot("m2-slope");
    await layers.click();
    await page.getByLabel("Slope").uncheck();
    await layers.click();
    await settle(4000);
    await shot("m1-route");

    await stepBtn(/Crew/).click();
    await settle(1200);
    await shot("m3-crew");

    await stepBtn(/Simulate/).click();
    await page.getByRole("button", { name: "Start traverse" }).click();
    await settle(5000);
    await page.getByRole("button", { name: /Obstacle ahead/ }).click();
    await settle(5000);
    await shot("m4-replanned");

    await page.getByLabel("Time compression").focus();
    await page.keyboard.press("End");
    await page.waitForSelector("text=Mission score", { timeout: 120000 });
    await stepBtn(/Review/).click();
    await settle(1500);
    await shot("m5-report");
    await page.close();
  }

  if (!only || only === "world") {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on("pageerror", (e) => problems.push("world pageerror: " + String(e).slice(0, 300)));
    const settle = (ms) => page.waitForTimeout(ms);
    const key = async (k, ms) => { await page.keyboard.press(k); await settle(ms); };
    // A picture of the 3D scene alone: hide every element that is not the canvas or one of its ancestors.
    const cleanShot = async (name) => {
      const style = await page.addStyleTag({ content: "body *:not(canvas):not(:has(canvas)) { visibility: hidden !important; }" });
      await settle(1500);
      await page.screenshot({ path: path.join(out, name + ".png"), timeout: 120000 });
      await style.evaluate((el) => el.remove());
      console.log("saved", name);
    };

    await page.goto("http://127.0.0.1:8320/?intro=0", { waitUntil: "networkidle", timeout: 120000 });
    await settle(24000);
    if (await page.getByText("Expedition Command controls").count()) await key("h", 3000);   // close the help card
    await page.mouse.click(1080, 430);          // a destination ahead of the rover
    await settle(3000);
    await key("p", 12000);                      // plan the expedition
    await key("f", 9000);                       // presentation mode
    await cleanShot("w1-rover-route");
    await key("5", 12000);                      // inspect camera: rover, habitat and astronaut
    await cleanShot("w2-base");
    await page.close();
  }

  console.log(problems.length ? "PROBLEMS:\n" + [...new Set(problems)].join("\n") : "no page errors");
  await browser.close();
})().catch((e) => { console.error("pitch capture failed:", e.message); process.exit(1); });
