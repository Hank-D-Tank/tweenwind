import { assert, equal, near, open, run, test } from "./harness.mjs";

// The newer behaviours combined: a reveal with a hover, press or click, an open menu across a breakpoint, the odometer for screen readers.
// From the second independent test round on 2026-11-10, kept as regression tests.

async function place(page, extra) {
  await open(page, `<div id="a" class="box gs-fade-up gs-duration-0.3 ${extra}" style="margin:100px"></div>`);
  await page.evaluate(() => sleep(900));
  return page.evaluate(() => $("#a").getBoundingClientRect().top);
}
const now = (page) => page.evaluate(() => ({ top: $("#a").getBoundingClientRect().top, style: $("#a").getAttribute("style") }));

test("reveal + hover, after leave the element is back in place with no stray transform", async (page) => {
  const top0 = await place(page, "hover:gs-to-[scale:1.5] hover:gs-duration-0.3");
  await page.mouse.move(150, 150); await page.evaluate(() => sleep(600));
  await page.mouse.move(700, 600); await page.evaluate(() => sleep(900));
  const got = await now(page);
  near(got.top, top0, 0.5, "same place as before the hover (reveal start offset leaked back)");
  assert(!/transform/.test(got.style), "no leftover transform in style: " + got.style);
});

test("reveal + press, after release the element is back in place", async (page) => {
  const top0 = await place(page, "press:gs-to-[scale:0.9] press:gs-duration-0.1");
  await page.mouse.move(150, 150); await page.mouse.down(); await page.evaluate(() => sleep(400)); await page.mouse.up();
  await page.evaluate(() => sleep(600));
  near((await now(page)).top, top0, 0.5, "same place");
});

test("reveal + click toggle, after second click the element is back in place", async (page) => {
  const top0 = await place(page, "click:gs-to-[rotate:20] click:gs-duration-0.1");
  await page.mouse.click(150, 150); await page.evaluate(() => sleep(400));
  await page.mouse.click(150, 150); await page.evaluate(() => sleep(400));
  near((await now(page)).top, top0, 0.5, "same place");
});

test("an open click menu stays open when the window crosses an md: breakpoint", async (page) => {
  await open(page, `<button id="b" aria-expanded="false">B</button><div id="m" class="box click:gs-from-[autoAlpha:0] md:click:gs-from-[autoAlpha:0,x:50] click:gs-trigger-[#b]"></div>`);
  await page.evaluate(async () => { $("#b").click(); await finish(); });
  await page.setViewportSize({ width: 500, height: 800 });
  const r = await page.evaluate(async () => { await frames(8); await finish(); return [css("#m", "opacity"), $("#b").getAttribute("aria-expanded")]; });
  equal(r, ["1", "true"], "still open after the rebuild");
});

test("a rolling odometer keeps its number readable for assistive tech", async (page) => {
  await open(page, `<p id="a" class="gs-odometer load:gs-duration-2">1,234</p>`);
  const r = await page.evaluate(async () => {
    await frames(4);
    const el = $("#a");
    return { label: el.getAttribute("aria-label"), hasVisible: [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || !!el.querySelector(".sr-only,[data-gs-sr]") };
  });
  assert(r.label || r.hasVisible, "no aria-label and no readable text node while rolling");
});
await run();
