import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { serve } from "./serve.mjs";

/**
 * Checks the thing people notice most in a letter reveal: do the letters sit in exactly the same
 * place while they are split as they do in plain text, and is any letter cut by its mask?
 *
 *   node scripts/probe-split.mjs <url path> <selector> [outDir]
 */

const [path = "/examples/portfolio/", selector = ".hero-name", out = "shots"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const server = await serve(5397);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:5397" + path, { waitUntil: "networkidle" });
await page.evaluate(() => gs.ready);
await page.evaluate(() => document.fonts.ready);

const result = await page.evaluate(async (selector) => {
  const el = document.querySelector(selector);
  document.querySelectorAll(".loader-wrap").forEach((node) => (node.style.display = "none"));
  const unit = gs.get(el)[0];
  if (!unit) return { error: "no animation on " + selector + " (already finished?)" };
  unit.pause();
  unit.progress(0.9999);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  // Where each letter is while split: the box of its own element.
  const pieces = Array.from(el.querySelectorAll("div, span")).filter((node) => node.children.length === 0 && node.textContent.trim().length === 1);
  const split = pieces.map((node) => ({ char: node.textContent, left: node.getBoundingClientRect().left }));
  const splitBox = el.getBoundingClientRect();
  return { split, splitHeight: splitBox.height, count: pieces.length };
}, selector);

if (result.error) {
  console.log(result.error);
} else {
  await page.screenshot({ path: `${out}/split-state.png` });
  const plain = await page.evaluate(async (selector) => {
    const el = document.querySelector(selector);
    const unit = gs.get(el)[0];
    unit.progress(1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Where each letter is in plain text: a one-character range.
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (let i = 0; i < node.length; i++) {
        if (!node.data[i].trim()) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        out.push({ char: node.data[i], left: range.getBoundingClientRect().left });
      }
    }
    return { plain: out, html: el.innerHTML.slice(0, 80), height: el.getBoundingClientRect().height };
  }, selector);
  await page.screenshot({ path: `${out}/plain-state.png` });
  const shifts = result.split.map((piece, index) => {
    const other = plain.plain[index];
    return other ? `${piece.char}:${(piece.left - other.left).toFixed(2)}` : `${piece.char}:?`;
  });
  const worst = Math.max(...result.split.map((piece, index) => (plain.plain[index] ? Math.abs(piece.left - plain.plain[index].left) : 0)));
  console.log(`letters ${result.count}, height split ${result.splitHeight.toFixed(1)} / plain ${plain.height.toFixed(1)}`);
  console.log("shift per letter (split minus plain, px): " + shifts.join("  "));
  console.log("largest shift: " + worst.toFixed(2) + "px");
  console.log("after: " + plain.html);
}
await browser.close();
server.close();
