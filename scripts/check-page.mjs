import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

/**
 * Checks a page that is already being served (the docs inside dimaac.com, say) the way a visitor
 * would meet it, and takes pictures of it:
 *
 *   node scripts/check-page.mjs http://localhost:3010/tween [outDir] [--mobile] [--dark] [--reduce]
 *
 * It reports console errors and warnings, requests that failed, anything that is still hidden
 * or half-faded once the page has been scrolled through, and whether the page scrolls sideways.
 */

const args = process.argv.slice(2);
const flag = (name) => args.includes("--" + name);
const [url, out = "shots"] = args.filter((arg) => !arg.startsWith("--"));
if (!url) throw new Error("give the page's address");
mkdirSync(out, { recursive: true });

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
  if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text().slice(0, 260)}`);
});
page.on("requestfailed", (request) => problems.push(`failed: ${request.url()} (${request.failure()?.errorText})`));
page.on("response", (response) => {
  if (response.status() >= 400) problems.push(`${response.status()}: ${response.url()}`);
});

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.gs && window.gs.gsap, null, { timeout: 15000 }).catch(() => problems.push("the library never started"));
await page.waitForTimeout(2500);
const name = `${flag("mobile") ? "phone" : "desk"}${flag("dark") ? "-dark" : ""}${flag("reduce") ? "-calm" : ""}`;
await page.screenshot({ path: `${out}/${name}-top.png` });

// Scroll through the whole page the way a wheel does, so every reveal gets its turn
const height = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
for (let y = 0; y <= height; y += 500) {
  await page.evaluate((to) => window.scrollTo(0, to), y);
  await page.waitForTimeout(140);
}
await page.waitForTimeout(1500);

const report = await page.evaluate(() => {
  const docs = document.querySelector(".tween") || document.body;
  const shown = (el) => el.getClientRects().length > 0;
  // Things inside the result boxes replay on purpose, pinned scenes sit mid-scroll: look at the docs' own text
  const own = Array.from(docs.querySelectorAll("h1, h2, h3, p, li, th, td, pre, figure, a.showcase")).filter((el) => shown(el) && !el.closest(".stage, .preset, .scene, .reel, .turn, [data-playground]"));
  const dim = own.filter((el) => {
    const style = getComputedStyle(el);
    return style.visibility === "hidden" || Number(style.opacity) < 0.99;
  });
  return {
    title: document.title,
    library: window.gs ? window.gs.version : null,
    h1: document.querySelectorAll("h1").length,
    examples: docs.querySelectorAll(".pair").length,
    stages: docs.querySelectorAll(".stage").length,
    presets: docs.querySelectorAll(".preset").length,
    tables: docs.querySelectorAll(".ref").length,
    codeBlocks: docs.querySelectorAll("pre.code").length,
    triggers: window.ScrollTrigger ? window.ScrollTrigger.getAll().length : 0,
    stillHidden: dim.slice(0, 8).map((el) => `${el.tagName.toLowerCase()}: ${(el.textContent || "").trim().slice(0, 50)}`),
    sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
    images: Array.from(docs.querySelectorAll("img")).filter((img) => img.complete && !img.naturalWidth).map((img) => img.getAttribute("src")),
    height: document.documentElement.scrollHeight,
  };
});
await page.screenshot({ path: `${out}/${name}-end.png` });
for (const [label, selector] of [
  ["example", "#example"],
  ["start", "#start"],
  ["text", "#text"],
  ["classes", "#classes"],
]) {
  const found = await page.$(selector);
  if (!found) continue;
  await found.scrollIntoViewIfNeeded();
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "start" }), selector);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${out}/${name}-${label}.png` });
}

console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? "problems:\n  " + Array.from(new Set(problems)).join("\n  ") : "no console errors, warnings or failed requests");
await browser.close();
