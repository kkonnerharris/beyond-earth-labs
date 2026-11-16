// Checks the link between the mission and the 3D world, and saves screenshots of it.
//   node scripts/ui_world.cjs <output folder> [playwright module path]
// Needs the services running (scripts/services.ps1 start).
//
// It plans a real mission through the mission service (two targets on the delta, then the 1 m check),
// opens the 3D world on that mission the way the main app does, and checks that the world shows the
// same plan: the mission panel, the route flyover, the whole-route view, and the drive of the first leg.
const path = require("path");
const out = process.argv[2] || ".";
const { chromium } = require(process.argv[3] || "playwright");
const M = "http://127.0.0.1:8300/api", W = "http://127.0.0.1:8320";

async function call(url, body) {
  const r = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} from ${url}`);
  return r.json();
}

(async () => {
  const problems = [];
  const expect = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push(what); };

  // A real mission, planned by the mission service.
  const m = await call(`${M}/missions`, { name: "Delta front traverse", mover: "crew_rover" });
  await call(`${M}/missions/${m.id}/targets`, { lon: 77.4115, lat: 18.45977, name: "Delta front scarp", objective: "sample", dwell_min: 30 });
  await call(`${M}/missions/${m.id}/targets`, { lon: 77.39727, lat: 18.47327, name: "Delta top", objective: "image", dwell_min: 20 });
  const planned = await call(`${M}/missions/${m.id}/plan`, { mover: "crew_rover", objective: "time", risk_weight: 1 });
  const checked = await call(`${M}/missions/${m.id}/finecheck`, { avoid: false });

  // The same mission as the 3D world reports it.
  const w = await call(`${W}/api/mission?id=${m.id}`);
  expect(w.id === m.id && w.revision === planned.plan.revision, "the 3D world reads the same mission and plan revision");
  expect(Math.abs(w.distance_m - planned.plan.distance_m) / planned.plan.distance_m < 0.02,
         `route length agrees: world ${w.distance_m.toFixed(0)} m, mission ${planned.plan.distance_m.toFixed(0)} m`);
  expect(w.legs.length === planned.plan.legs.length && w.targets.length === 2, "every leg and target is carried over");
  expect(w.base.inside && w.inside_m > 500, `the base and ${w.inside_m.toFixed(0)} m of route lie inside the 2 km map`);
  expect(!!w.fine && w.fine.stretches === checked.fine_check.stretches.length,
         `the 1 m check is carried over (${w.fine ? w.fine.stretches : "none"} steep stretches)`);
  const drive = await call(`${W}/api/mission/drive`, { id: m.id, start: [w.base.x + 22, w.base.z] });
  expect(drive.path.length > 50 && drive.mission.median_deviation_m < 15,
         `first leg drivable on 5 m terrain: ${drive.distance_m.toFixed(0)} m, median ${drive.mission.median_deviation_m} m from the mission line`);

  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => problems.push("pageerror: " + String(e).slice(0, 200)));
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url().slice(0, 120)}`); });
  const shot = async (name) => { await page.screenshot({ path: path.join(out, name + ".png"), timeout: 120000 }); console.log("saved " + name); };

  await page.goto(`${W}/?intro=0&mission=${m.id}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  const card = page.getByTestId("mission-link");
  await card.waitFor({ timeout: 120000 });
  expect((await card.innerText()).includes("Delta front traverse"), "the mission panel names the mission");
  await page.keyboard.press("h");            // hide the controls help
  await page.waitForTimeout(20000);
  await shot("40-world-mission");

  await card.getByRole("button", { name: "Fly the route" }).click();
  await page.waitForTimeout(14000);
  await shot("41-world-flyover-in-map");
  await page.waitForTimeout(55000);         // software rendering is slow; on a real GPU the flight leaves the 2 km map in about 30 s
  await shot("42-world-flyover-beyond");
  await card.getByRole("button", { name: "Stop flight" }).click().catch(() => undefined);

  await page.keyboard.press("4");            // top-down: framed on the whole route
  await page.waitForTimeout(12000);
  await shot("43-world-whole-route");

  await card.getByRole("button", { name: "Drive it" }).click();
  await page.waitForTimeout(3000);
  await page.keyboard.press("3");            // rover camera
  await page.waitForTimeout(20000);
  expect(await card.getByRole("button", { name: "Stop" }).count() === 1, "the rover is driving the mission route");
  await shot("44-world-driving-mission");

  console.log(problems.length ? "PROBLEMS:\n" + [...new Set(problems)].join("\n") : "no failed checks, page errors or HTTP errors");
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error("world check failed:", e.message); process.exit(1); });
