import { chromium } from "playwright-core";
import { serve } from "./serve.mjs";

/**
 * Takes the picture of the example portfolio that the docs page shows:
 *
 *   node scripts/poster.mjs
 *
 * It waits for the loader and the name's reveal to finish, so the picture is the settled page.
 */

const server = await serve(5399);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:5399/examples/portfolio/", { waitUntil: "networkidle" });
await page.evaluate(() => window.gs.ready);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(6500);
await page.screenshot({ path: "site/assets/portfolio.jpg", type: "jpeg", quality: 84 });
await browser.close();
server.close();
console.log("site/assets/portfolio.jpg");
