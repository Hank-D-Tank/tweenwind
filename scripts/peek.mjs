import { chromium } from "playwright-core";
import { serve } from "./serve.mjs";

/**
 * Opens a page, optionally scrolls, runs a JavaScript expression in it and prints the result.
 * For quick questions while debugging:
 *
 *   node scripts/peek.mjs /examples/portfolio/ 12300 "gs.get('.process-bar i').length"
 *   node scripts/peek.mjs / 0 "document.title" --mobile --reduce
 */

const args = process.argv.slice(2);
const flags = args.filter((arg) => arg.startsWith("--"));
const [path = "/", scroll = "0", expression = "document.title"] = args.filter((arg) => !arg.startsWith("--"));
const server = await serve(5399);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] });
const context = await browser.newContext({
  viewport: flags.includes("--mobile") ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  hasTouch: flags.includes("--mobile"),
  reducedMotion: flags.includes("--reduce") ? "reduce" : "no-preference",
});
const page = await context.newPage();
const problems = [];
page.on("pageerror", (error) => problems.push("error: " + error.message));
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text().slice(0, 300)}`);
});
await page.goto("http://localhost:5399" + path, { waitUntil: "networkidle" });
await page.evaluate(() => window.gs && window.gs.ready);
await page.waitForTimeout(3600);
const target = Number(scroll);
if (target) {
  for (let step = 1; step <= 12; step++) {
    await page.evaluate((y) => window.scrollTo(0, y), (target * step) / 12);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(1400);
}
const result = await page.evaluate(`(async () => (${expression}))()`);
console.log(typeof result === "string" ? result : JSON.stringify(result, null, 1));
if (problems.length) console.log(problems.join("\n"));
await browser.close();
server.close();
