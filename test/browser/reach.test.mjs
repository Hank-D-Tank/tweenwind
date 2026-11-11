import { assert, equal, open, run, test } from "./harness.mjs";

// What waits for the scroll stays within reach of the Tab key and of screen readers.
// From the end-to-end check on 2026-11-10: a keyboard visitor could not get to the docs'
// install tabs, because every reveal that had not played yet was visibility: hidden.

const TALL = `<div style="height:1800px"></div>`;

test("a reveal that has not played is see-through, not hidden, so it can be reached", async (page) => {
  await open(page, `<a id="top" href="#">top</a>${TALL}<a id="far" class="gs-fade-up" href="#x">far</a><h2 id="head" class="gs-fade-up">Heading</h2>`);
  const r = await page.evaluate(async () => {
    await idle();
    await sleep(200);
    const far = getComputedStyle($("#far"));
    const head = getComputedStyle($("#head"));
    return { far: [far.visibility, far.opacity], head: [head.visibility, head.opacity] };
  });
  equal(r, { far: ["visible", "0"], head: ["visible", "0"] }, "waiting state");
});

test("Tab reaches a link that has not been scrolled to, and focusing it plays its reveal", async (page) => {
  await open(page, `<a id="top" href="#">top</a>${TALL}<a id="far" class="gs-fade-up" href="#x">far</a>`);
  await page.evaluate(async () => { await idle(); await sleep(150); });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const r = await page.evaluate(async () => {
    const focused = document.activeElement && document.activeElement.id;
    await sleep(1400);
    const far = getComputedStyle($("#far"));
    return { focused, scrolled: scrollY > 600, opacity: far.opacity, style: $("#far").getAttribute("style") };
  });
  equal(r, { focused: "far", scrolled: true, opacity: "1", style: null }, "after two Tabs");
});

test("staggered children that have not played are reachable too", async (page) => {
  await open(page, `<a id="top" href="#">top</a>${TALL}<ul class="gs-fade-up gs-stagger-0.1"><li><a id="one" href="#1">one</a></li><li><a id="two" href="#2">two</a></li></ul>`);
  await page.evaluate(async () => { await idle(); await sleep(150); });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  equal(focused, "one", "second Tab");
});

test("the steps of a scroll-driven timeline are reachable before they play", async (page) => {
  await open(page, `<a id="top" href="#">top</a>${TALL}<section class="gs-timeline gs-scrub" style="height:600px"><p class="gs-fade-up"><a id="step" href="#s">step</a></p></section>${TALL}`);
  const r = await page.evaluate(async () => {
    await idle();
    await sleep(200);
    return getComputedStyle($("#step").parentElement).visibility;
  });
  equal(r, "visible", "a step that has not played");
});

test("a closed click menu and its steps stay out of reach", async (page) => {
  await open(
    page,
    `<button id="btn">Menu</button><a id="after" href="#">after</a>
     <div id="menu" class="click:gs-timeline click:gs-fade click:gs-trigger-[#btn]"><a id="item" class="gs-fade-up" href="#i">item</a></div>`,
  );
  await page.evaluate(async () => { await idle(); await sleep(200); });
  const closed = await page.evaluate(() => ({ menu: getComputedStyle($("#menu")).visibility, item: getComputedStyle($("#item")).visibility }));
  equal(closed, { menu: "hidden", item: "hidden" }, "closed");
  await page.focus("#btn");
  await page.keyboard.press("Tab");
  equal(await page.evaluate(() => document.activeElement.id), "after", "Tab from the button skips the closed menu");
  await page.click("#btn");
  const open1 = await page.evaluate(async () => { await sleep(1600); return { menu: getComputedStyle($("#menu")).visibility, item: [getComputedStyle($("#item")).visibility, getComputedStyle($("#item")).opacity] }; });
  equal(open1, { menu: "visible", item: ["visible", "1"] }, "open");
});

test("a load animation with a delay is still hidden until it plays (nothing to reach behind a loader)", async (page) => {
  await open(page, `<a id="nav" class="load:gs-fade load:gs-delay-2" href="#">nav</a>`);
  const r = await page.evaluate(async () => {
    await idle();
    await sleep(300);
    return getComputedStyle($("#nav")).visibility;
  });
  equal(r, "hidden", "waiting for its delay");
  assert(true);
});

await run();
