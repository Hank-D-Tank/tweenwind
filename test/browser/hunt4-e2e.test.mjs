import { ORIGIN, assert, equal, near, open, run, test } from "./harness.mjs";

// From the end-to-end check on 2026-11-10 (four independent testers on the docs page, the
// example site and every row of the docs), kept as regression tests.

const within = (promise, ms, label) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(label), ms))]);

test("reloading the example half way down does not hang the page", async (page) => {
  // A reveal already scrolled past used to leave ScrollTrigger's list while GSAP was walking it
  // (inside the measuring of a new pin). GSAP threw with the pins taken apart, and the library
  // then rebuilt them without end.
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const y of [3300, 4600]) {
    await page.goto(`${ORIGIN}/examples/portfolio/`, { waitUntil: "load" });
    await page.waitForTimeout(5200);
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await page.waitForTimeout(1500);
    page.reload({ waitUntil: "commit" }).catch(() => {});
    await page.waitForTimeout(5500);
    const state = await within(
      page.evaluate(() => ({
        ready: document.readyState,
        pins: window.ScrollTrigger.getAll().filter((t) => t.pin).map((t) => t.pin.parentNode.classList.contains("pin-spacer")),
      })),
      4000,
      "the page did not answer",
    );
    equal(state, { ready: "complete", pins: [true, true] }, `after a reload at ${y}`);
  }
});

test("a staggered list under a sideways section waits for the scroll", async (page) => {
  // The list used to be measured before the sideways section's pin had made its room, so its
  // first child took itself for on screen and played at load, 2000 px down the page.
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(
    page,
    `<style>.c{height:200px;background:#555}</style>
     <section class="gs-horizontal"><div style="display:flex;width:max-content">
       <div style="width:80vw;flex:none"><span class="gs-fade-up">A</span></div>
       <div style="width:80vw;flex:none"><span class="gs-fade-up">B</span></div>
       <div style="width:80vw;flex:none"><span class="gs-fade-up">C</span></div>
     </div></section>
     <div id="list" class="gs-stagger-0.1"><div class="c"></div><div class="c"></div><div class="c"></div></div>
     <div style="height:1200px"></div>`,
  );
  const r = await page.evaluate(async () => {
    await sleep(900);
    const before = $$(".c").map((c) => getComputedStyle(c).opacity);
    $("#list").scrollIntoView({ block: "center" });
    await sleep(1600);
    return { before, after: $$(".c").map((c) => getComputedStyle(c).opacity) };
  });
  equal(r, { before: ["0", "0", "0"], after: ["1", "1", "1"] }, "waits, then plays when scrolled to");
});

test("without the script a click menu stays closed, and everything else shows after three seconds", async (page) => {
  // The failsafe used to show the closed menu too: a full-screen menu laid over the page for good.
  await open(
    page,
    `<button id="btn">Menu</button>
     <div id="menu" class="click:gs-timeline click:gs-fade click:gs-trigger-[#btn]" style="position:fixed;inset:0;background:#111"><a id="item" class="gs-fade-up" href="#">item</a></div>
     <h1 id="title" class="gs-fade-up">Title</h1>`,
    { script: null, head: `<link rel="stylesheet" href="/dist/tweenwind.css">`, wait: false },
  );
  const early = await page.evaluate(() => ["#menu", "#item", "#title"].map((s) => getComputedStyle(document.querySelector(s)).visibility));
  equal(early, ["hidden", "hidden", "hidden"], "before the failsafe");
  await page.waitForTimeout(3400);
  const late = await page.evaluate(() => ["#menu", "#item", "#title"].map((s) => getComputedStyle(document.querySelector(s)).visibility));
  equal(late, ["hidden", "hidden", "visible"], "after the failsafe");
});

test("when GSAP cannot be loaded the page is shown, and a click menu stays closed", async (page) => {
  const errors = [];
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  await open(
    page,
    `<button id="btn">Menu</button>
     <div id="menu" class="click:gs-timeline click:gs-fade click:gs-trigger-[#btn]" style="position:fixed;inset:0;background:#111"><a id="item" class="gs-fade-up" href="#">item</a></div>
     <h1 id="title" class="gs-fade-up">Title</h1>`,
    { config: { cdn: "/nowhere/" }, wait: false },
  );
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ["#menu", "#item", "#title"].map((s) => getComputedStyle(document.querySelector(s)).visibility));
  equal(state, ["hidden", "hidden", "visible"], "menu closed, page shown");
  assert(errors.some((e) => e.includes("tweenwind")), "the console says what went wrong");
});

test("a scrubbed move follows the scrollbar evenly unless an ease is given", async (page) => {
  await open(
    page,
    `<div class="spacer"></div>
     <div id="a" class="box gs-to-[x:300] gs-scrub-0"></div>
     <div id="b" class="box gs-to-[x:300] gs-scrub-0 gs-ease-power3.out"></div>
     <div class="spacer"></div><div class="spacer"></div>`,
  );
  const r = await page.evaluate(async () => {
    const trigger = ScrollTrigger.getAll().find((t) => t.trigger === $("#a"));
    await scrollToY(trigger.start + (trigger.end - trigger.start) * 0.3);
    await frames(4);
    return { a: num("#a", "x"), b: num("#b", "x") };
  });
  near(r.a, 90, 12, "linear at 30%");
  assert(r.b > 150, `with an ease-out it runs ahead (${r.b})`);
});

test("the typo hint for a data-gs word has no class prefix", async (page) => {
  const warnings = [];
  page.on("console", (message) => message.type() === "warning" && warnings.push(message.text()));
  await open(page, `<div data-gs="fad-up"></div><div class="gs-fad-up"></div>`);
  await page.waitForTimeout(200);
  assert(warnings.some((w) => w.includes('Did you mean "fade-up"?')), "data-gs: " + warnings.join(" / "));
  assert(warnings.some((w) => w.includes('Did you mean "gs-fade-up"?')), "class: " + warnings.join(" / "));
});

await run();
