// Prints docs/pitch/final.html (the final presentation, seven slides) to a PDF, one 1920 x 1080 slide per page (seven slides).
//   node scripts/final_pdf.cjs [playwright module path]
// Needs Chrome or Edge (BROWSER_CHANNEL=msedge). The fonts come from Google Fonts; offline, Arial is used.
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require(process.argv[2] || "playwright");

const dir = path.join(__dirname, "..", "docs", "pitch");
const pdf = path.join(dir, "Beyond-Earth-Labs-final-presentation.pdf");

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const missing = [];
  page.on("requestfailed", (r) => missing.push(r.url()));
  await page.goto(pathToFileURL(path.join(dir, "final.html")).href, { waitUntil: "networkidle", timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family));
  const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.getAttribute("src")));
  // A slide whose content is taller than the page would be cut off in the PDF: report it.
  const overflow = await page.evaluate(() => [...document.querySelectorAll("section")]
    .filter((s) => s.scrollHeight > 1080 || s.scrollWidth > 1920).map((s) => s.id));
  // Optional: PITCH_PREVIEW=<folder> also saves one picture per slide, for checking the layout by eye.
  if (process.env.PITCH_PREVIEW) {
    for (const id of await page.evaluate(() => [...document.querySelectorAll("section")].map((s) => s.id))) {
      await page.locator(`#${id}`).screenshot({ path: path.join(process.env.PITCH_PREVIEW, `${id}.png`) });
    }
  }
  await page.pdf({ path: pdf, width: "1920px", height: "1080px", printBackground: true, pageRanges: "" });
  console.log("wrote", pdf);
  console.log("fonts loaded:", [...new Set(fonts)].join(", ") || "none (fallback fonts used)");
  console.log(broken.length ? "BROKEN IMAGES: " + broken.join(", ") : "all images loaded");
  console.log(overflow.length ? "OVERFLOWING SLIDES: " + overflow.join(", ") : "no slide overflows its page");
  if (missing.length) console.log("failed requests:", missing.join(", "));
  await browser.close();
})().catch((e) => { console.error("final presentation PDF failed:", e.message); process.exit(1); });
