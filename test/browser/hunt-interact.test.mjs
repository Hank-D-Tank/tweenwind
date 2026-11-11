import { assert, equal, near, open, run, test } from "./harness.mjs";

// Hover, click and press, clones, late triggers and two copies of the script.
// Found by an independent flaw hunt on 2026-11-10 and kept as regression tests.

test("a hover that began during a reveal is still there after the reveal ends", async (page) => {
  await open(page, `<div id="a" class="box gs-fade-up gs-duration-3 hover:gs-to-[y:-20] hover:gs-duration-0.3"></div>`);
  await page.mouse.move(50, 60); await page.waitForTimeout(4500);
  near(await page.evaluate(() => num("#a","y")), -20, 0.5, "still hovered, y should stay -20 after the reveal ended");
});

test("a gs-trigger target added later works", async (page) => {
  await open(page, `<div id="m" class="box click:gs-to-[x:200] click:gs-trigger-[#late]"></div>`);
  await page.evaluate(async () => { const b = document.createElement("button"); b.id = "late"; b.textContent = "late"; document.body.append(b); await idle(); });
  await page.click("#late"); await page.waitForTimeout(1200);
  equal(await page.evaluate(() => num("#m","x")), 200, "click the late trigger");
});

test("a gs-trigger element that was replaced works", async (page) => {
  await open(page, `<div id="h"><button id="b">t</button></div><div id="m" class="box click:gs-to-[x:200] click:gs-trigger-[#b]"></div>`);
  await page.evaluate(async () => { $("#h").innerHTML = `<button id="b">t</button>`; await idle(); });
  await page.click("#b"); await page.waitForTimeout(1200);
  equal(await page.evaluate(() => num("#m","x")), 200, "click the new trigger");
});

test("a clone made mid-reveal ends visible", async (page) => {
  await open(page, `<div id="host"><div id="a" class="box gs-fade-up"></div></div>`);
  const r = await page.evaluate(async () => {
    const c = $("#a").cloneNode(true); c.id = "c"; $("#host").append(c);
    await idle(); await finish();
    return { a: css("#a","opacity"), c: css("#c","opacity"), st: $("#c").getAttribute("style") };
  });
  equal(r.c, "1", "clone made while original is revealing must also end visible: " + JSON.stringify(r));
});

test("clones of a card in a list all end visible", async (page) => {
  await open(page, `<div id="host"><div class="card gs-fade-up box">a</div></div>`);
  const r = await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) $("#host").append($("#host .card").cloneNode(true));
    await idle(); await finish();
    return $$("#host .card").map(e => getComputedStyle(e).opacity);
  });
  equal(r, ["1","1","1","1"], "all cards visible");
});

test("the same script twice: the first copy stays in charge and window.gs keeps working", async (page, { logs }) => {
  await open(page, `<div id="a" class="box gs-to-[x:100] gs-scrub-true"></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const first = window.gs;
    await new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = "/dist/tweenwind.js";
      tag.onload = resolve;
      tag.onerror = reject;
      document.head.append(tag);
    });
    await frames(3);
    return { same: window.gs === first, timelines: gs.get("#a").length, tweens: gsap.getTweensOf($("#a")).length };
  });
  equal(got, { same: true, timelines: 1, tweens: 1 }, "one copy in charge, one animation on the element");
  assert(logs.some((entry) => entry.text.includes("on this page twice")), "and the console says what happened");
});

test("press: answers to the keyboard", async (page) => {
  await open(page, `<button id="b" class="press:gs-to-[scale:0.5]">b</button>`);
  await page.focus("#b"); await page.keyboard.down("Enter"); await page.waitForTimeout(800);
  near(await page.evaluate(() => num("#b","scale")), 0.5, 0.05, "press while Enter held");
});

test("a hover that has ended leaves no inline transform", async (page) => {
  await open(page, `<div id="a" class="box hover:gs-to-[x:50]"></div>`);
  await page.hover("#a"); await page.waitForTimeout(1000); await page.mouse.move(800,700); await page.waitForTimeout(1200);
  equal(await page.evaluate(() => $("#a").getAttribute("style") || ""), "", "style attr back to plain");
});

await run();
