import { assert, equal, near, open, run, test } from "./harness.mjs";
const S = () => { const e = document.querySelector("#a"); return { attr: e.getAttribute("style"), tr: getComputedStyle(e).transform }; };
const wait = (p, ms = 900) => p.waitForTimeout(ms);
const B = `<div style="padding:50px"><button id="a" class="box click:gs-to-[rotate:45] hover:gs-to-[scale:1.2]" style="width:100px;border:0"></button></div>`;

// Several animations on one element: an SVG shape after a hover, a click and a hover racing.
// From the third independent test round on 2026-11-10, kept as regression tests.

test("a click menu that closes while a hover just came and went hands the button back exactly as written", async (page) => {
  await open(page, B); await page.evaluate(() => finish());
  await page.mouse.move(100, 100); await wait(page, 500);
  await page.mouse.down(); await page.mouse.up(); await wait(page, 1000);       // open, hovered
  await page.mouse.move(700, 700); await wait(page, 1200);                     // hover leaves, still open
  await page.click("#a");                                                       // re-enter and close at once
  await page.mouse.move(700, 700); await wait(page, 3000);
  const s = await page.evaluate(S);
  equal(s, { attr: "width:100px;border:0", tr: "none" }, "style after everything has ended");
});

test("same, the hover is kept for a while before leaving", async (page) => {
  await open(page, B); await page.evaluate(() => finish());
  await page.mouse.move(100, 100); await wait(page, 500);
  await page.mouse.down(); await page.mouse.up(); await wait(page, 1000);
  await page.mouse.move(700, 700); await wait(page, 1200);
  await page.click("#a"); await wait(page, 1500);
  await page.mouse.move(700, 700); await wait(page, 3000);
  const s = await page.evaluate(S);
  equal(s, { attr: "width:100px;border:0", tr: "none" }, "style after everything has ended");
});

test("a hovered svg shape is handed back as written", async (page) => {
  await open(page, `<svg width="300" height="200"><rect id="a" x="20" y="20" width="60" height="60" fill="red" class="hover:gs-to-[scale:1.5]" style="stroke:blue"/></svg>`);
  await page.hover("#a"); await wait(page); await page.mouse.move(700, 700); await wait(page, 1500);
  const e = await page.evaluate(() => ({ style: $("#a").getAttribute("style"), transform: $("#a").getAttribute("transform") }));
  equal(e, { style: "stroke:blue", transform: null }, "style and transform attribute after the hover ended");
});

await run();
