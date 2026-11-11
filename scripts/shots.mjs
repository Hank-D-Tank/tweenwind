import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { serve } from "./serve.mjs";

/**
 * Takes pictures of the docs site at a set of scroll positions, in a real browser, so the page
 * can be checked by eye without opening it. Usage:
 *
 *   node scripts/shots.mjs [outDir] [--dark] [--mobile] [--reduce] [--at=0,900,1800]
 */

const args = process.argv.slice(2);
const flag = (name) => args.includes("--" + name);
const out = args.find((arg) => !arg.startsWith("--")) || "shots";
const at = (args.find((arg) => arg.startsWith("--at=")) || "").slice(5);
const path = (args.find((arg) => arg.startsWith("--path=")) || "--path=/").slice(7);

mkdirSync(out, { recursive: true });
const server = await serve(5396);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] });
const context = await browser.newContext({
  viewport: flag("mobile") ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: flag("mobile") ? 2 : 1,
  colorScheme: flag("dark") ? "dark" : "light",
  reducedMotion: flag("reduce") ? "reduce" : "no-preference",
});
const page = await context.newPage();
const problems = [];
page.on("pageerror", (error) => problems.push("error: " + error.message));
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text().slice(0, 240)}`);
});
page.on("requestfailed", (request) => problems.push("failed: " + request.url()));

await page.goto("http://localhost:5396" + path, { waitUntil: "networkidle" });
await page.evaluate(() => window.gs && window.gs.ready);
// --wait=ms: how long after the library is ready the first picture is taken (to catch a page mid-entrance).
const wait = Number((args.find((arg) => arg.startsWith("--wait=")) || "").slice(7)) || 2600;
await page.waitForTimeout(wait);

const height = await page.evaluate(() => document.documentElement.scrollHeight);
const stops = at ? at.split(",").map(Number) : Array.from({ length: Math.ceil(height / 800) }, (_, i) => i * 800);
let index = 0;
for (const y of stops) {
  // Scroll in small steps, the way a person does, so scrubbed things get to catch up.
  const from = await page.evaluate(() => window.scrollY);
  for (let step = 1; step <= 8; step++) {
    await page.evaluate((to) => window.scrollTo(0, to), from + ((y - from) * step) / 8);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(1500);
  const name = `${out}/${String(index++).padStart(2, "0")}-${y}.png`;
  await page.screenshot({ path: name });
}
console.log(`page height ${height}px, ${stops.length} pictures in ${out}/`);
console.log(problems.length ? problems.join("\n") : "no console errors or warnings");
await browser.close();
server.close();
