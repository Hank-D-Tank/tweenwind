import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { serve } from "./serve.mjs";

/**
 * Measures how heavy a page is while it sits still and while it is scrolled: long tasks,
 * layouts, style recalculations, observer callbacks and ScrollTrigger refreshes.
 *
 *   node scripts/perf.mjs [--path=/] [--lib=path/to/another-build.min.js] [--mobile] [--dpr=2] [--css=".nav{backdrop-filter:none}"]
 *
 * --lib swaps in another build of the library, to compare two versions on the same page.
 * --dpr sets the pixel density (2 is a laptop screen). --css adds a rule, to try a fix.
 */

const args = process.argv.slice(2);
const option = (name, fallback) => (args.find((arg) => arg.startsWith(`--${name}=`)) || `--${name}=${fallback}`).slice(name.length + 3);
const path = option("path", "/");
const lib = option("lib", "");
const mobile = args.includes("--mobile");
const dpr = Number(option("dpr", "1"));
const css = option("css", "");

const server = await serve(5397);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] });
const size = option("size", mobile ? "390x844" : "1440x900").split("x").map(Number);
const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: dpr });
const page = await context.newPage();
if (lib) {
  const body = readFileSync(lib, "utf8");
  await page.route(/tweenwind(\.min)?\.js/, (route) => route.fulfill({ body, contentType: "text/javascript" }));
}

await page.addInitScript(() => {
  const stats = (window.__perf = { mutationCallbacks: 0, mutationRecords: 0, refreshes: 0, longTasks: 0, longTaskMs: 0, intervals: 0, resizeCallbacks: 0 });
  const Native = window.MutationObserver;
  window.MutationObserver = class extends Native {
    constructor(callback) {
      super((records, self) => {
        stats.mutationCallbacks++;
        stats.mutationRecords += records.length;
        callback(records, self);
      });
    }
  };
  const NativeResize = window.ResizeObserver;
  window.ResizeObserver = class extends NativeResize {
    constructor(callback) {
      super((entries, self) => {
        stats.resizeCallbacks++;
        callback(entries, self);
      });
    }
  };
  const setI = window.setInterval;
  window.setInterval = (fn, ms, ...rest) => {
    stats.intervals++;
    return setI(fn, ms, ...rest);
  };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      stats.longTasks++;
      stats.longTaskMs += entry.duration;
    }
  }).observe({ entryTypes: ["longtask"] });
  const hook = setI(() => {
    if (!window.ScrollTrigger) return;
    clearInterval(hook);
    window.ScrollTrigger.addEventListener("refresh", () => stats.refreshes++);
  }, 20);
});

const client = await context.newCDPSession(page);
await client.send("Performance.enable");
// --throttle=4 makes the processor four times slower, like a phone or a busy laptop.
const throttle = Number(option("throttle", "1"));
if (throttle > 1) await client.send("Emulation.setCPUThrottlingRate", { rate: throttle });
const metrics = async () => {
  const { metrics: list } = await client.send("Performance.getMetrics");
  const pick = (name) => list.find((metric) => metric.name === name).value;
  return { layouts: pick("LayoutCount"), styles: pick("RecalcStyleCount"), layoutMs: pick("LayoutDuration") * 1000, styleMs: pick("RecalcStyleDuration") * 1000, scriptMs: pick("ScriptDuration") * 1000, taskMs: pick("TaskDuration") * 1000 };
};
const diff = (a, b) => Object.fromEntries(Object.keys(a).map((key) => [key, Math.round((b[key] - a[key]) * 10) / 10]));
const snap = () => page.evaluate(() => ({ ...window.__perf }));

const started = Date.now();
await page.goto("http://localhost:5397" + path, { waitUntil: "load" });
await page.evaluate(() => window.gs && window.gs.ready);
if (css) await page.addStyleTag({ content: css });
const ready = Date.now() - started;
await page.waitForTimeout(3000);

const loadMetrics = await metrics();
const loadStats = await snap();
console.log(`\n${path}${lib ? "  (" + lib + ")" : ""}`);
console.log(`ready after ${ready} ms. Load and first 3 s:`, JSON.stringify({ ...loadStats, ...Object.fromEntries(Object.entries(loadMetrics).map(([key, value]) => [key, Math.round(value)])) }));

// Sitting still for three seconds.
let before = await metrics();
let stats = await snap();
await page.waitForTimeout(3000);
console.log("idle 3 s:", JSON.stringify({ ...diff(before, await metrics()), ...diff(stats, await snap()) }));

// A steady scroll from top to bottom, one step a frame, like a wheel or a trackpad.
before = await metrics();
stats = await snap();
const frames = await page.evaluate(async () => {
  const total = document.documentElement.scrollHeight - window.innerHeight;
  const steps = Math.min(900, Math.ceil(total / 40));
  const times = [];
  let last = performance.now();
  for (let i = 1; i <= steps; i++) {
    window.scrollTo(0, (total * i) / steps);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const now = performance.now();
    times.push(now - last);
    last = now;
  }
  times.sort((a, b) => a - b);
  const sum = times.reduce((all, time) => all + time, 0);
  return {
    height: total,
    frames: times.length,
    average: Math.round((sum / times.length) * 10) / 10,
    p95: Math.round(times[Math.floor(times.length * 0.95)] * 10) / 10,
    worst: Math.round(times[times.length - 1]),
    over33: times.filter((time) => time > 33).length,
    triggers: window.ScrollTrigger ? window.ScrollTrigger.getAll().length : 0,
    tweens: window.gsap ? window.gsap.globalTimeline.getChildren(true, true, true).length : 0,
  };
});
console.log("scroll:", JSON.stringify(frames));
console.log("scroll cost:", JSON.stringify({ ...diff(before, await metrics()), ...diff(stats, await snap()) }));

await browser.close();
server.close();
