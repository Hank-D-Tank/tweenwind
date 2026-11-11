import { chromium } from "playwright-core";
import { serve } from "../../scripts/serve.mjs";

/**
 * A small test runner for real-browser checks. Each case gets a fresh page.
 * Pages are served from memory at /case.html, next to the built files, so
 * they load the library exactly as a real site would.
 */

// GS_PORT lets several test files run at the same time, each on its own port.
// GS_SCRIPT points the test pages at another build of the library.
const PORT = Number(process.env.GS_PORT) || 5391;
export const ORIGIN = `http://localhost:${PORT}`;
const SCRIPT = process.env.GS_SCRIPT || "/dist/tweenwind.js";
const cases = [];
let only = null;

export function test(name, fn) {
  cases.push({ name, fn });
}
test.only = (name, fn) => {
  only = { name, fn };
};

export function assert(condition, message) {
  if (!condition) throw new Error(message || "assertion failed");
}

export function near(actual, expected, tolerance, label = "value") {
  if (typeof actual !== "number" || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected about ${expected} (within ${tolerance}), got ${actual}`);
  }
}

export function equal(actual, expected, label = "value") {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`);
}

const HEAD = `
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; font: 16px/1.5 Helvetica, Arial, sans-serif; }
  .box { width: 100px; height: 100px; background: #111; }
  .spacer { height: 150vh; }
  .screen { height: 100vh; }
</style>`;

export function html(body, { head = "", config = {}, script = SCRIPT } = {}) {
  const settings = JSON.stringify({ cdn: "/node_modules/gsap/dist/", ...config });
  const tag = script ? `<script>window.gsConfig = ${settings};</script><script src="${script}"></script>` : "";
  return `<!doctype html><html><head>${HEAD}${tag}${head}</head><body>${body}</body></html>`;
}

/** Helpers that run inside the page. */
function installHelpers() {
  window.$ = (selector) => document.querySelector(selector);
  window.$$ = (selector) => Array.from(document.querySelectorAll(selector));
  window.css = (selector, prop) => getComputedStyle(document.querySelector(selector))[prop];
  window.num = (selector, prop) => Number(gsap.getProperty(document.querySelector(selector), prop));
  window.frames = (count = 2) =>
    new Promise((resolve) => {
      const step = () => (count-- > 0 ? requestAnimationFrame(step) : resolve());
      step();
    });
  window.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  window.idle = async () => {
    await gs.ready;
    await gs.scan();
    await window.frames(2);
  };
  window.scrollToY = async (y) => {
    window.scrollTo(0, y);
    await window.frames(3);
  };
  /** Runs GSAP at many times normal speed, then waits long enough for anything under ten seconds to finish. */
  window.finish = async () => {
    gsap.globalTimeline.timeScale(50);
    await window.sleep(260);
    gsap.globalTimeline.timeScale(1);
    await window.frames(2);
  };
}

export async function open(page, body, options = {}) {
  const content = typeof body === "string" && body.startsWith("<!doctype") ? body : html(body, options);
  await page.route("**/case.html", (route) => route.fulfill({ body: content, contentType: "text/html" }));
  await page.addInitScript(installHelpers);
  await page.goto(`${ORIGIN}/case.html`, { waitUntil: options.waitUntil || "load" });
  if (options.wait !== false) await page.evaluate(() => window.idle());
}

export async function run() {
  const server = await serve(PORT);
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] });
  } catch {
    browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
  }
  const list = only ? [only] : cases;
  const filter = process.argv[2];
  let failed = 0;
  let ran = 0;
  for (const { name, fn } of list) {
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) continue;
    ran++;
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    const logs = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => logs.push({ type: message.type(), text: message.text() }));
    try {
      await fn(page, { logs, errors, context });
      if (errors.length) throw new Error("page error: " + errors.join(" | "));
      console.log(`  ok    ${name}`);
    } catch (error) {
      failed++;
      console.log(`  FAIL  ${name}\n        ${String(error.message).split("\n").join("\n        ")}`);
      const noise = logs.filter((entry) => entry.type === "error" || entry.type === "warning").slice(0, 4);
      for (const entry of noise) console.log(`        [${entry.type}] ${entry.text.slice(0, 300)}`);
    }
    await context.close();
  }
  await browser.close();
  server.close();
  console.log(`\n${ran - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
