import { chromium } from "playwright-core";
import { serve } from "./serve.mjs";

/**
 * Traces a top-to-bottom scroll and adds up where the drawing time goes: painting, rasterising,
 * image decoding and GPU work. The numbers are from software rendering, so read them as a
 * comparison between two runs, not as milliseconds on a real screen.
 *
 *   node scripts/paint.mjs [--path=/] [--dpr=2] [--css=".nav{backdrop-filter:none}"] [--from=0] [--to=1]
 */

const args = process.argv.slice(2);
const option = (name, fallback) => (args.find((arg) => arg.startsWith(`--${name}=`)) || `--${name}=${fallback}`).slice(name.length + 3);
const path = option("path", "/");
const dpr = Number(option("dpr", "2"));
const css = option("css", "");
const from = Number(option("from", "0"));
const to = Number(option("to", "1"));

const server = await serve(5398);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
const page = await context.newPage();
await page.goto("http://localhost:5398" + path, { waitUntil: "load" });
await page.evaluate(() => window.gs && window.gs.ready);
if (css) await page.addStyleTag({ content: css });
await page.waitForTimeout(3000);

await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "cc", "gpu", "viz", "blink"] });
const frames = await page.evaluate(
  async ([start, end]) => {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    const a = total * start;
    const b = total * end;
    const steps = Math.min(900, Math.ceil((b - a) / 40));
    for (let i = 0; i <= steps; i++) {
      window.scrollTo(0, a + ((b - a) * i) / steps);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return steps;
  },
  [from, to],
);
const buffer = await browser.stopTracing();
const events = JSON.parse(buffer.toString()).traceEvents;

const sums = new Map();
for (const event of events) {
  if (event.ph !== "X" || !event.dur) continue;
  const entry = sums.get(event.name) || { ms: 0, count: 0 };
  entry.ms += event.dur / 1000;
  entry.count++;
  sums.set(event.name, entry);
}
const WANTED = ["Paint", "PrePaint", "Layerize", "UpdateLayerTree", "Commit", "RasterTask", "ImageDecodeTask", "Decode Image", "Decode LazyPixelRef", "GPUTask", "DrawFrame", "Draw LazyPixelRef", "CompositeLayers", "RunTask"];
const report = {};
for (const name of WANTED) {
  const entry = sums.get(name);
  if (entry) report[name] = `${Math.round(entry.ms)} ms / ${entry.count}`;
}
console.log(`\n${path}${css ? "  with " + css.slice(0, 70) : ""}  (${frames} frames, dpr ${dpr})`);
console.log(JSON.stringify(report, null, 1));
const top = Array.from(sums.entries())
  .filter(([name]) => !WANTED.includes(name))
  .sort((a, b) => b[1].ms - a[1].ms)
  .slice(0, 12)
  .map(([name, entry]) => `${name}: ${Math.round(entry.ms)} ms / ${entry.count}`);
console.log("other big ones:", top.join(" | "));

await browser.close();
server.close();
