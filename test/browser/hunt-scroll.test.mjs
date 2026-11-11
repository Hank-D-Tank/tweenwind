import { assert, equal, near, open, run, test } from "./harness.mjs";

// Scroll-driven animation: timelines, pins and what sits inside them.
// Found by an independent flaw hunt on 2026-11-10 and kept as regression tests.

test("a finished gs-timeline (not scrubbed) leaves no inline styles on its steps", async (page) => {
  await open(page, `<section id="t" class="gs-timeline"><h2 id="a" class="gs-fade-up">One</h2><h2 id="b" class="gs-fade-up">Two</h2></section>`);
  const got = await page.evaluate(async () => {
    await finish();
    await sleep(300);
    return { a: $("#a").getAttribute("style") || "", b: $("#b").getAttribute("style") || "" };
  });
  equal(got, { a: "", b: "" }, "README: when a reveal finishes the element goes back to plain HTML, no inline styles");
});

test("a gs-timeline inside a scrubbed pinned timeline is driven by the outer one", async (page) => {
  await open(page, `<section id="t" class="gs-timeline gs-pin-300 gs-scrub-true screen"><h2 id="a" class="gs-fade-up">A</h2><div class="gs-timeline"><p id="b" class="gs-fade-up">B</p></div><h2 id="d" class="gs-fade-up">D</h2></section><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    await finish();
    const loaded = css("#b", "opacity"); // page at top, outer scrub progress is 0
    const aLoaded = css("#a", "opacity");
    return { loaded, aLoaded };
  });
  equal(got, { loaded: "0", aLoaded: "0" }, "inner steps should stay hidden until the scroll reaches them, like the outer steps");
});

test("gs-marquee-right-300 and gs-marquee-pause-100 are read", async (page, { logs }) => {
  const row = (id, cls) => `<div id="${id}" class="${cls}" style="width:600px;overflow:hidden;white-space:nowrap;height:40px"><span style="display:inline-block;width:300px">A</span><span style="display:inline-block;width:300px">B</span></div>`;
  await open(page, row("m1", "gs-marquee-right-300"));
  const dx = await page.evaluate(async () => {
    const x = () => $("#m1").firstElementChild.getBoundingClientRect().left;
    const a = x();
    await sleep(300);
    return x() - a;
  });
  assert(dx > 30, "direction right and 300px/s expected (about +90 in 300ms), got " + dx.toFixed(1) + "; logs: " + JSON.stringify(logs));
});

test("gs-parallax inside gs-pin drifts for as long as the pin holds", async (page) => {
  await open(page, `<section id="s" class="gs-pin-200" style="height:100vh;overflow:hidden"><div id="p" class="gs-parallax-30" style="height:100vh;background:#c00"></div></section><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const pin = ScrollTrigger.getAll().find((t) => t.pin);
    const p = gs.get("#p")[0].scrollTrigger;
    return { parallaxEnd: p.end, pinEnd: pin.end };
  });
  assert(got.parallaxEnd >= got.pinEnd * 0.9, "drift should span the pin: " + JSON.stringify(got));
});

await run();
