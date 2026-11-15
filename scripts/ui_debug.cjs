// Prints the map camera and where the mover's label is on screen after hand driving.
const { chromium } = require(process.argv[2] || "playwright");
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (m) => { if (m.type() !== "log") console.log("console", m.type(), m.text().slice(0, 200)); });
  await page.goto("http://127.0.0.1:4770/", { waitUntil: "networkidle", timeout: 90000 });
  await page.getByRole("button", { name: "Create exploration mission" }).click();
  await page.waitForTimeout(5000);
  await page.getByRole("button", { name: "Surface view", exact: true }).click();
  await page.waitForTimeout(6000);
  for (const key of ["w", "w", "w"]) { await page.keyboard.press(key); await page.waitForTimeout(900); }
  await page.waitForTimeout(5000);
  const state = await page.evaluate(async () => {
    const map = window.__belMap;
    const missions = await (await fetch("/svc/mission/missions")).json();
    const m = await (await fetch("/svc/mission/missions/" + missions[0].ID)).json();
    const c = map.getCenter();
    const pt = map.project([m.sim.lon, m.sim.lat]);
    const labels = [...document.querySelectorAll(".maplibregl-marker")].map((el) => ({ text: el.textContent.trim().slice(0, 40), rect: (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(el.getBoundingClientRect()), display: getComputedStyle(el).display, opacity: getComputedStyle(el).opacity }));
    return { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), sim: [m.sim.lon, m.sim.lat], phase: m.sim.phase,
             moverOnScreen: [Math.round(pt.x), Math.round(pt.y)], terrain: !!map.getTerrain(), centerElevation: map.getCenterElevation(), clamped: map.getCenterClampedToGround(), elevAtMover: map.queryTerrainElevation([m.sim.lon, m.sim.lat]),
             labels: labels.filter((l) => /rover|Astronaut/.test(l.text)) };
  });
  console.log(JSON.stringify(state, null, 1));
  await browser.close();
})().catch((e) => { console.error("debug failed:", e.message); process.exit(1); });
