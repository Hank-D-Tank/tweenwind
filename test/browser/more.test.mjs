import { assert, equal, near, open, run, test } from "./harness.mjs";

test("count can share an element with an entrance", async (page) => {
  await open(page, `<p><span id="a" class="gs-count gs-fade-up">1,200</span></p>`);
  const start = await page.evaluate(() => {
    gs.get("#a")[0].pause(0);
    return { text: $("#a").textContent, opacity: css("#a", "opacity"), tweens: gs.get("#a")[0].getChildren().length };
  });
  equal(start, { text: "0", opacity: "0", tweens: 2 }, "both start together");
  const end = await page.evaluate(async () => {
    gs.get("#a")[0].play();
    await finish();
    return { text: $("#a").textContent, style: $("#a").getAttribute("style") || "" };
  });
  equal(end, { text: "1,200", style: "" }, "both end clean");
});

test("classes on marquee items also work on the copies", async (page) => {
  await open(
    page,
    `<div id="m" class="gs-marquee" style="width:600px"><span id="one" class="hover:gs-to-[scale:1.3]" style="width:200px;display:block">one</span></div>`,
  );
  const got = await page.evaluate(async () => {
    await idle();
    const clones = $$("#m > [data-gs-clone]");
    return { clones: clones.length, live: clones.every((clone) => gs.get(clone).length === 1), ids: $$("#m [id]").length };
  });
  assert(got.clones >= 3, "copies made: " + got.clones);
  assert(got.live, "each copy has its own hover animation");
  equal(got.ids, 1, "ids are not duplicated");
});

test("snap settles a scene on its steps and a horizontal section on its panels", async (page) => {
  const panel = `<div style="width:1200px;height:400px;flex:none"></div>`;
  await open(
    page,
    `<section id="s" class="screen gs-timeline gs-pin-300 gs-scrub-true gs-snap"><h2 class="gs-fade-up">A</h2><h2 class="gs-fade-up">B</h2><h2 class="gs-fade-up">C</h2></section>
     <section id="h" class="screen gs-horizontal gs-snap"><div>${panel}${panel}${panel}</div></section><div class="spacer"></div>`,
  );
  const got = await page.evaluate(() => ({
    scene: gs.get("#s")[0].scrollTrigger.vars.snap.snapTo,
    labels: Object.keys(gs.get("#s")[0].labels),
    panels: gs.get("#h")[0].scrollTrigger.vars.snap,
  }));
  equal(got.scene, "labels", "scene snaps to its steps");
  equal(got.labels, ["step-0", "step-1", "step-2", "end"], "one label per step");
  near(got.panels, 0.5, 0.0001, "three panels, two stops");
});

test("keyframes, target and trigger classes", async (page) => {
  await open(
    page,
    `<div id="k" class="box gs-to-[keyframes:{x:[0,200,80]},duration:1,ease:none]"></div>
     <div id="wrap" class="gs-target-[.dot] gs-to-[y:30] gs-stagger-0.2"><i class="dot box"></i><b></b><i class="dot box"></i></div>
     <div class="spacer"></div><div id="far" style="height:10px"></div>
     <div id="fixed" class="box gs-fade gs-trigger-[#far]" style="position:fixed;top:0;right:0"></div>`,
  );
  const got = await page.evaluate(async () => {
    await finish();
    const k = num("#k", "x");
    const dots = $$("#wrap .dot").map((dot) => Number(gsap.getProperty(dot, "y")));
    const stagger = gs.get("#wrap")[0].getChildren()[0].vars.stagger;
    const hiddenUntilTrigger = css("#fixed", "opacity");
    $("#far").scrollIntoView();
    await frames(3);
    await finish();
    return { k, dots, stagger, hiddenUntilTrigger, shown: css("#fixed", "opacity") };
  });
  near(got.k, 80, 0.01, "keyframes end on the last value");
  equal(got.dots, [30, 30], "only the targeted children move");
  equal(got.stagger, 0.2, "with the stagger");
  equal(got.hiddenUntilTrigger, "0", "waits for its trigger");
  equal(got.shown, "1", "plays when the trigger arrives");
});

test("a timeline can be opened by a click", async (page) => {
  await open(
    page,
    `<button id="btn" aria-expanded="false">Menu</button>
     <nav id="n" class="click:gs-timeline click:gs-trigger-[#btn] click:gs-duration-0.2"><a id="l1" class="gs-fade-up">One</a><a id="l2" class="gs-fade-up">Two</a></nav>`,
  );
  const closed = await page.evaluate(() => ({ l1: css("#l1", "opacity"), plugin: typeof window.ScrollTrigger }));
  equal(closed, { l1: "0", plugin: "undefined" }, "closed, and no scroll plugin loaded for it");
  await page.click("#btn");
  const opened = await page.evaluate(async () => {
    await finish();
    return [css("#l1", "opacity"), css("#l2", "opacity"), gs.get("#n")[0].duration()];
  });
  equal(opened, ["1", "1", 0.4], "both links in, one after the other");
});

test("a page that grows gets its scroll positions measured again", async (page) => {
  await open(page, `<div id="grow" style="height:200px"></div><div class="screen"></div><div id="a" class="box gs-to-[x:300] gs-scrub"></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const trigger = gs.get("#a")[0].scrollTrigger;
    const before = trigger.start;
    $("#grow").style.height = "900px";
    await sleep(700);
    return { before, after: trigger.start };
  });
  near(got.after - got.before, 700, 2, "trigger moved down with the content");
});

test("refresh and scan", async (page) => {
  await open(page, `<div id="root"></div>`, { config: { observe: false } });
  const got = await page.evaluate(async () => {
    $("#root").innerHTML = `<div id="a" class="box gs-to-[x:50]"></div>`;
    await frames(3);
    const ignored = gs.get("#a").length;
    await gs.scan($("#root"));
    const scanned = gs.get("#a").length;
    await finish();
    const x = num("#a", "x");
    await gs.refresh();
    return { ignored, scanned, x, rebuilt: gs.get("#a").length };
  });
  equal(got, { ignored: 0, scanned: 1, x: 50, rebuilt: 1 }, "manual mode");
});

test("a plugin that fails to load leaves the page readable", async (page, { logs }) => {
  await page.route("**/SplitText.min.js", (route) => route.abort());
  await open(page, `<h1 id="t" class="gs-split-words gs-fade-up">Still here</h1><div id="a" class="box gs-fade-up"></div>`);
  const got = await page.evaluate(async () => {
    await finish();
    return { title: css("#t", "visibility"), ready: $("#t").hasAttribute("data-gs-ready"), other: css("#a", "opacity") };
  });
  equal(got, { title: "visible", ready: true, other: "1" }, "heading is shown plain, the rest still animates");
  assert(logs.some((entry) => entry.text.includes("could not load SplitText")), "says what went wrong");
});

test("GSAP failing to load leaves the page readable", async (page, { logs }) => {
  await page.route("**/gsap.min.js", (route) => route.abort());
  await open(page, `<h1 id="t" class="gs-fade-up">Still here</h1>`, { wait: false });
  await page.waitForFunction(() => document.querySelector("#t").hasAttribute("data-gs-ready"));
  equal(await page.evaluate(() => getComputedStyle(document.querySelector("#t")).visibility), "visible", "shown");
  assert(logs.some((entry) => entry.text.includes("GSAP could not be loaded")), "says what went wrong");
});

test("the page's own GSAP is used when it is already there", async (page) => {
  const head = `<script src="/node_modules/gsap/dist/gsap.min.js"></script><script src="/node_modules/gsap/dist/ScrollTrigger.min.js"></script>
    <script>gsap.registerPlugin(ScrollTrigger); window.mine = gsap;</script>`;
  const body = `<div id="a" class="box gs-to-[x:60] gs-scrub"></div>`;
  const settings = `<script>window.gsConfig = { cdn: "/nowhere/" };</script><script src="/dist/tweenwind.min.js"></script>`;
  await open(page, `<!doctype html><html><head>${head}${settings}</head><body>${body}<div style="height:300vh"></div></body></html>`);
  const got = await page.evaluate(() => ({ same: gs.gsap === window.mine, built: gs.get("#a").length, scripts: document.querySelectorAll('script[src*="nowhere"]').length }));
  equal(got, { same: true, built: 1, scripts: 0 }, "no second copy of GSAP or its plugins");
});

await run();
