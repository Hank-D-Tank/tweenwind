import { assert, equal, near, open, run, test } from "./harness.mjs";

// Classes combined on one element or on a parent and its children.
// Found by an independent flaw hunt on 2026-11-10 and kept as regression tests.

test("a child with its own reveal under a stagger parent ends visible", async (page) => {
  await open(page, `<ul id="l" class="gs-fade-up gs-stagger-0.1"><li class="gs-zoom-in">a</li><li>b</li></ul>`);
  const g = await page.evaluate(async () => { await finish(); await finish(); return $$("#l li").map(e => getComputedStyle(e).opacity + "|" + (e.getAttribute("style")||"")); });
  equal(g, ["1|", "1|"], "both visible");
});

test("a reveal plus gs-float reveals, then floats", async (page) => {
  await open(page, `<div id="a" class="box gs-fade-up gs-float"></div>`);
  const g = await page.evaluate(async () => { await finish(); await finish(); return css("#a","opacity"); });
  equal(g, "1", "visible");
});

test("a staggered list gives each child its own timeline, and the delay holds for each", async (page) => {
  await open(page, `<ul id="l" class="gs-fade gs-stagger-0.2 gs-delay-1 gs-duration-0.5"><li>1</li><li>2</li><li>3</li></ul>`);
  const got = await page.evaluate(() => gs.get("#l").map((timeline) => timeline.totalDuration()));
  equal(got, [1.5, 1.5, 1.5], "three timelines, each a second of delay and half a second of fade");
});

test("a clip-path reveal leaves no inline style", async (page) => {
  await open(page, `<div id="a" class="box gs-from-[clipPath:inset(0_100%_0_0)]"></div>`);
  const g = await page.evaluate(async () => { await finish(); return $("#a").getAttribute("style")||""; });
  equal(g, "");
});

test("reveals on inline elements leave no inline style", async (page) => {
  await open(page, `<p>Hi <span id="a" class="gs-fade-up">inline</span> and <a id="b" href="#" class="gs-slide-up gs-fade">link</a></p>`);
  const g = await page.evaluate(async () => { await finish(); return [$("#a").getAttribute("style")||"", $("#b").getAttribute("style")||""]; });
  equal(g, ["",""]);
});

test("a yPercent reveal leaves no inline style", async (page) => {
  await open(page, `<div id="a" class="box gs-from-[yPercent:100,opacity:0] gs-ease-expo.out"></div>`);
  const g = await page.evaluate(async () => { await finish(); return $("#a").getAttribute("style")||""; });
  equal(g, "");
});

test("after a reveal only the ready mark is left, no style attribute", async (page) => {
  await open(page, `<p id="a" class="gs-fade-up">x</p>`);
  const g = await page.evaluate(async () => { await finish(); return $("#a").outerHTML; });
  // data-gs-ready stays on purpose: it is what tells the stylesheet this element no longer waits.
  equal(g, `<p id="a" class="gs-fade-up" data-gs-ready="">x</p>`);
});

await run();
