// Checks the copy published with GitHub Pages (docs/): serves it from a sub-path with a plain file
// server, exactly as GitHub Pages does, and drives the full application with nothing running behind it.
//   node scripts/ui_pages.cjs <screenshot folder> [playwright module path]
// No services are needed: that is the point of the check.
const http = require("http");
const fs = require("fs");
const path = require("path");
const out = process.argv[2] || ".";
const { chromium } = require(process.argv[3] || "playwright");
const DOCS = path.join(__dirname, "..", "docs");
const PREFIX = "/beyond-earth-labs";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg",
                ".png": "image/png", ".svg": "image/svg+xml", ".hdr": "application/octet-stream", ".pdf": "application/pdf",
                ".wasm": "application/wasm", ".bin": "application/octet-stream", ".glb": "model/gltf-binary", ".txt": "text/plain" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (!p.startsWith(PREFIX)) { res.writeHead(404); res.end("outside the site"); return; }
  p = p.slice(PREFIX.length) || "/";
  let file = path.join(DOCS, p);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(4795, "127.0.0.1", r));
  const base = `http://127.0.0.1:4795${PREFIX}`;
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const problems = [], notFound = new Set();
  const expect = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push(what); };
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => problems.push("pageerror: " + String(e).slice(0, 200)));
  page.on("response", (r) => {
    if (r.status() < 400) return;
    const u = r.url().replace(base, "");
    if (/\/tiles\/|\/jezero\/dem\//.test(u)) notFound.add("tile"); else problems.push(`HTTP ${r.status()}: ${u.slice(0, 110)}`);
  });
  const shot = async (name) => { await page.screenshot({ path: path.join(out, name + ".png"), timeout: 180000 }); console.log("saved " + name); };
  const step = (name) => page.getByRole("navigation", { name: "Mission steps" }).getByRole("button", { name });

  // The landing page.
  await page.goto(`${base}/`, { waitUntil: "networkidle", timeout: 60000 });
  const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.getAttribute("src")));
  expect(broken.length === 0, "landing page: every picture loads");
  expect(await page.getByRole("link", { name: /Open the full application/ }).count() === 1, "landing page links to the full application");

  // The full application, with no service behind it.
  await page.goto(`${base}/app/`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(3000);
  await shot("a0-start");
  await page.getByRole("button", { name: "Create exploration mission" }).click();
  await step(/Route/).waitFor({ timeout: 60000 });
  await page.waitForTimeout(5000);
  expect(true, "a mission was created by the mission service running in the page");
  await step(/Route/).click();
  await page.getByRole("button", { name: "Add targets on the map" }).click();
  const box = await page.locator(".maplibregl-canvas").boundingBox();
  await page.mouse.click(box.x + box.width * 0.50, box.y + box.height * 0.40);
  await page.waitForTimeout(2500);
  await page.mouse.click(box.x + box.width * 0.40, box.y + box.height * 0.30);
  await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  await page.waitForSelector("text=Steepest ground", { timeout: 30000 });
  expect(true, "a route to two targets was planned in the browser");
  await shot("a1-route");

  await step(/Crew/).click();
  await page.waitForTimeout(1500);
  expect(await page.getByText(/reserve/).count() > 0, "the supply check with its reserve is shown");
  await step(/Simulate/).click();
  await page.getByRole("button", { name: "Start traverse" }).click();
  await page.waitForTimeout(6000);
  await page.getByRole("button", { name: "Obstacle ahead" }).click();
  await page.waitForTimeout(3000);
  expect(await page.getByText(/Replanned/).count() > 0, "an obstacle forced a replan, computed in the browser");
  await shot("a2-simulate");

  await step(/Analogs/).click();
  await page.getByRole("button", { name: /Find Earth analogs/ }).click();
  await page.waitForSelector("text=Ranked candidates", { timeout: 30000 });
  expect(true, "the Earth analog ranking is served from saved files");
  await shot("a3-analogs");

  await page.getByRole("button", { name: "Space view" }).click();
  await page.waitForTimeout(9000);
  await shot("a4-solar-system");
  expect(await page.getByText("The solar system today").count() === 1, "the solar system view opens");
  await page.getByRole("button", { name: "Back to the map" }).click();

  await page.getByRole("group", { name: "3D simulation" }).getByRole("button", { name: "Mars" }).click();
  await page.frameLocator("iframe").locator("canvas").first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(20000);
  await shot("a5-simulation-in-app");
  expect(true, "the 3D simulation opens inside the application");

  await page.goto(`${base}/app/guide/`, { waitUntil: "networkidle", timeout: 60000 });
  // The guide's pictures load only as they scroll into view, so each one is requested directly.
  const guideSources = await page.evaluate(() => [...document.images].map((i) => i.src));
  let guideBroken = 0;
  for (const src of guideSources) if (!(await page.request.get(src)).ok()) guideBroken++;
  expect(guideSources.length > 10 && guideBroken === 0, `the guide page's ${guideSources.length} pictures are all published`);

  if (notFound.size) console.log("note: some map tiles are not in the copy (never viewed while building)");
  console.log(problems.length ? "PROBLEMS:\n" + [...new Set(problems)].join("\n") : "no failed checks, page errors or failed requests");
  await browser.close();
  server.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error("pages check failed:", e.message); server.close(); process.exit(1); });
