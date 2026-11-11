import { assert, equal, near, open, run, test } from "./harness.mjs";

test("an element at the very bottom of the page still gets its turn", async (page) => {
  await open(page, `<div class="spacer"></div><p id="a" class="gs-fade-up" style="margin:0;height:30px">Last line</p>`);
  const got = await page.evaluate(async () => {
    const before = css("#a", "opacity");
    await scrollToY(document.documentElement.scrollHeight);
    await frames(3);
    await finish();
    return { before, after: css("#a", "opacity") };
  });
  equal(got, { before: "0", after: "1" }, "plays when the page hits the bottom");
});

test("a scrubbed element in the first screen starts at its beginning", async (page) => {
  await open(page, `<div id="a" class="box gs-to-[x:400] gs-scrub-true gs-ease-none" style="margin-top:300px"></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    await frames(3);
    const atTop = num("#a", "x");
    const trigger = gs.get("#a")[0].scrollTrigger;
    await scrollToY(trigger.end);
    return { atTop, start: trigger.start, atEnd: num("#a", "x") };
  });
  near(got.atTop, 0, 0.5, "not already part way through at the top of the page");
  equal(got.start, 0, "start clamped to the top");
  near(got.atEnd, 400, 1, "still finishes");
});

test("scrubbing inside a pinned section lasts as long as the pin", async (page) => {
  await open(
    page,
    `<div class="screen"></div>
     <section id="s" class="screen gs-pin-200"><div id="a" class="box gs-to-[x:300] gs-scrub-true gs-ease-none"></div></section>
     <div class="spacer"></div>`,
  );
  const got = await page.evaluate(async () => {
    const pin = ScrollTrigger.getAll().find((trigger) => trigger.pin === $("#s"));
    const inner = gs.get("#a")[0].scrollTrigger;
    await scrollToY(pin.start + 800);
    const mid = inner.progress;
    await scrollToY(pin.end + 150);
    return { mid, end: inner.progress, container: inner.vars.pinnedContainer === $("#s") };
  });
  assert(got.container, "the pinned ancestor is passed to ScrollTrigger");
  assert(got.mid > 0.2 && got.mid < 0.9, "still under way in the middle of the pin: " + got.mid);
  near(got.end, 1, 0.001, "done once the pin has let go");
});

test("breakpoint presets replace the base one in the browser too", async (page) => {
  await open(page, `<div id="a" class="box gs-fade-up md:gs-fade-left"></div>`);
  const wide = await page.evaluate(() => {
    gs.get("#a")[0].pause(0);
    return { x: num("#a", "x"), y: num("#a", "y") };
  });
  equal(wide, { x: 40, y: 0 }, "desktop: from the right only");
  await page.setViewportSize({ width: 500, height: 800 });
  const narrow = await page.evaluate(async () => {
    await frames(4);
    gs.get("#a")[0].pause(0);
    return { x: num("#a", "x"), y: num("#a", "y") };
  });
  equal(narrow, { x: 0, y: 40 }, "phone: from below only");
});

test("a preset can build its own tweens", async (page) => {
  const head = `<script>gs.preset("glow", { natural: true, build(timeline, words) {
    timeline.from(words, { opacity: 0, duration: 0.2, stagger: 0.05 }, 0).from(words, { y: 20, duration: 0.6, stagger: 0.05 }, 0);
  } });</script>`;
  await open(page, `<h1 id="t" class="load:gs-split-words load:gs-glow">Three little words</h1>`, { head });
  const start = await page.evaluate(() => {
    const unit = gs.get("#t")[0];
    unit.pause(0);
    return { tweens: unit.getChildren().length, words: $("#t").children.length, hidden: css("#t > *", "opacity"), css: gs.css().includes("gs-glow") };
  });
  equal(start, { tweens: 2, words: 3, hidden: "0", css: true }, "both tweens made on the split words");
  const end = await page.evaluate(async () => {
    gs.get("#t")[0].play();
    await finish();
    return $("#t").innerHTML;
  });
  equal(end, "Three little words", "tidied away afterwards");
});

test("where an entrance starts from does not delay it", async (page) => {
  // The boxes sit just above the 88% line. Starting 300px lower or at a tenth of their size
  // must not push them past it.
  await open(
    page,
    `<div style="height:600px"></div>
     <div id="a" class="box gs-from-[y:300,opacity:0]" style="display:inline-block"></div>
     <div id="b" class="box gs-zoom-in-0.1" style="display:inline-block"></div>
     <div class="spacer"></div>`,
  );
  const got = await page.evaluate(async () => {
    await sleep(350);
    const marked = $("#a").hasAttribute("data-gs-enter");
    await finish();
    return { marked, a: css("#a", "opacity"), b: css("#b", "opacity"), left: $("#a").hasAttribute("data-gs-enter"), measuring: document.documentElement.hasAttribute("data-gs-measure") };
  });
  equal(got, { marked: true, a: "1", b: "1", left: false, measuring: false }, "both played without scrolling");
});

test("an ancestor that is still animating in does not throw its children's positions off", async (page) => {
  await open(
    page,
    `<div style="height:560px"></div>
     <div id="wrap" class="load:gs-from-[y:200,opacity:0] load:gs-duration-3"><div id="a" class="box gs-fade-up"></div></div>
     <div class="spacer"></div>`,
  );
  const got = await page.evaluate(async () => {
    await sleep(400);
    return { started: gs.get("#a").length ? gs.get("#a")[0].progress() > 0 : true };
  });
  assert(got.started, "the child played while its parent was still 200px low");
});

test("reduced motion keeps what is not motion: pins, class toggles and end states", async (page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(
    page,
    `<div class="screen"></div><section id="p" class="screen gs-pin"></section>
     <div id="t" class="box gs-toggle-[is-seen]"></div>
     <ul id="l" class="gs-to-[x:50] gs-stagger"><li id="li">one</li><li>two</li></ul>
     <section id="s" class="screen gs-timeline gs-pin"><h2 id="h" class="gs-fade-up">Step</h2></section>
     <div class="spacer"></div>`,
  );
  const got = await page.evaluate(async () => {
    await frames(3);
    $("#t").scrollIntoView({ block: "center" });
    await frames(4);
    return {
      pinned: $("#p").parentElement.className,
      toggled: $("#t").classList.contains("is-seen"),
      moved: num("#li", "x"),
      scenePinned: $("#s").parentElement.className,
      step: css("#h", "opacity"),
    };
  });
  equal(got, { pinned: "pin-spacer", toggled: true, moved: 50, scenePinned: "pin-spacer", step: "1" }, "kept");
});

test("masks leave room for descenders and tight tracking, and the slide clears that room", async (page) => {
  await open(
    page,
    `<h1 id="t" class="gs-split-chars gs-mask gs-slide-up" style="font-size:100px;line-height:0.8;letter-spacing:-0.06em;margin:60px">Joy</h1>
     <p id="l" class="gs-split-lines gs-mask gs-slide-up" style="font-size:40px;line-height:0.9;width:300px;margin:60px">gypsy joy jumping quickly by</p>`,
  );
  const got = await page.evaluate(() => {
    gs.get("#t")[0].pause(0);
    gs.get("#l")[0].pause(0);
    const height = $("#l").getBoundingClientRect().height;
    const masks = (id) => $$(id + " *").filter((node) => node.style.clipPath.startsWith("inset("));
    const charMask = masks("#t")[2];
    const lineMask = masks("#l")[0];
    const piece = charMask.firstElementChild;
    const hiddenBy = piece.getBoundingClientRect().top - (charMask.getBoundingClientRect().bottom + 30);
    const kerning = css("#t", "fontKerning");
    gs.get("#l")[0].progress(1);
    return {
      charClip: charMask.style.clipPath,
      lineClip: lineMask.style.clipPath,
      charBox: [getComputedStyle(charMask).paddingBottom, getComputedStyle(charMask).marginBottom],
      lines: masks("#l").length,
      heightSplit: height,
      hiddenBy,
      kerning,
    };
  });
  equal(got.charClip, "inset(-0.3em -0.16em)", "each letter's mask clips a little outside its box");
  equal(got.lineClip, "inset(-0.3em -0.16em)", "and so does each line's");
  equal(got.charBox, ["0px", "0px"], "with no padding or margin, so the layout cannot move");
  assert(got.lines >= 2, "several lines: " + got.lines);
  assert(got.hiddenBy >= -0.5, "at the start the letter sits fully below its mask, room included: " + got.hiddenBy);
  equal(got.kerning, "none", "kerning is off for letter splits, so letters do not shift when the split is undone");
  const after = await page.evaluate(async () => {
    const before = $("#l").getBoundingClientRect().height;
    gs.get("#t").forEach((timeline) => timeline.play());
    await finish();
    return { same: Math.abs($("#l").getBoundingClientRect().height - before) < 0.5, html: $("#t").innerHTML };
  });
  assert(after.same, "the paragraph is the same height split and plain");
  equal(after.html, "Joy", "and plain text at the end");
});

test("several elements can drive one click animation, and Escape closes it", async (page) => {
  await open(
    page,
    `<button id="open" class="toggle" aria-expanded="false">Menu</button>
     <div id="menu" class="box click:gs-fade click:gs-trigger-[.toggle] click:gs-duration-0.2"><button id="close" class="toggle">Close</button><a id="link" class="toggle" href="#x">Link</a></div>
     <div id="x"></div>`,
  );
  const state = () => page.evaluate(async () => {
    await finish();
    return [css("#menu", "visibility"), $("#open").getAttribute("aria-expanded"), $("#close").hasAttribute("aria-expanded")];
  });
  equal(await state(), ["hidden", "false", false], "closed");
  await page.click("#open");
  equal(await state(), ["visible", "true", false], "the first button opens it");
  await page.click("#close");
  equal(await state(), ["hidden", "false", false], "the second one closes it");
  await page.click("#open");
  await page.click("#link");
  equal(await state(), ["hidden", "false", false], "so does a link inside");
  await page.click("#open");
  await page.evaluate(() => finish());
  await page.keyboard.press("Escape");
  const escaped = await page.evaluate(async () => {
    await finish();
    return [css("#menu", "visibility"), $("#open").getAttribute("aria-expanded"), document.activeElement.id];
  });
  equal(escaped, ["hidden", "false", "open"], "Escape closes it and gives the focus back to the button");
});

test("inside a timeline, an element with its own scroll classes is not a step", async (page) => {
  await open(
    page,
    `<div class="screen"></div>
     <section id="s" class="screen gs-timeline gs-pin-200 gs-scrub-true gs-ease-none">
       <i id="bar" class="box gs-from-[scaleX:0] gs-ease-none gs-scrub-true gs-trigger-[#s] gs-start-[top_top] gs-end-[+=200%]"></i>
       <h2 id="a" class="gs-fade-up">A</h2><h2 id="b" class="gs-fade-up">B</h2>
     </section><div class="spacer"></div>`,
  );
  const got = await page.evaluate(async () => {
    const master = gs.get("#s")[0];
    const pin = master.scrollTrigger;
    const bar = gs.get("#bar")[0].scrollTrigger;
    await scrollToY(pin.start + (pin.end - pin.start) * 0.25);
    return {
      steps: master.getChildren(false, false, true).length,
      barRange: [bar.start - pin.start, bar.end - pin.end],
      bar: num("#bar", "scaleX"),
      a: Number(css("#a", "opacity")),
    };
  });
  equal(got.steps, 2, "only the two headings are steps");
  equal(got.barRange, [0, 0], "the bar runs over exactly the pin");
  near(got.bar, 0.25, 0.01, "a quarter full a quarter of the way in");
  near(got.a, 0.5, 0.05, "while the first step is half done");
});

test("a short page that cannot scroll still shows everything", async (page) => {
  await open(page, `<h1 id="a" class="gs-fade-up">Short</h1><p id="b" class="gs-fade-up gs-delay-0.1">page</p>`);
  const got = await page.evaluate(async () => {
    await finish();
    return [css("#a", "opacity"), css("#b", "opacity")];
  });
  equal(got, ["1", "1"], "both played");
});

test("images loading late do not leave triggers in the wrong place", async (page) => {
  await open(page, `<img id="img" alt="" style="display:block;width:100%"><div class="screen"></div><div id="a" class="box gs-fade-up"></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const trigger = ScrollTrigger.getAll()[0];
    const before = trigger.start;
    const img = $("#img");
    img.style.height = "600px";
    img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/%3E";
    await sleep(700);
    return { before, after: trigger.start };
  });
  near(got.after - got.before, 600, 2, "trigger follows the layout");
});

test("the script works from the end of the body too", async (page) => {
  const body = `<h1 id="a" class="gs-fade-up">Late script</h1>
    <script>window.gsConfig = { cdn: "/node_modules/gsap/dist/" };</script><script src="/dist/tweenwind.min.js"></script>`;
  await open(page, `<!doctype html><html><head></head><body>${body}</body></html>`);
  const got = await page.evaluate(async () => {
    await finish();
    return { opacity: css("#a", "opacity"), style: document.querySelectorAll("style[data-tweenwind]").length };
  });
  equal(got, { opacity: "1", style: 1 }, "runs, with one stylesheet");
});

test("a custom prefix changes the classes and the stylesheet", async (page) => {
  await open(page, `<div id="a" class="box x-fade-up"></div><div id="b" class="box gs-fade-up"></div>`, { config: { prefix: "x" } });
  const got = await page.evaluate(() => ({ a: gs.get("#a").length, b: gs.get("#b").length, css: gs.css().includes('[class^="x-fade"]') }));
  equal(got, { a: 1, b: 0, css: true }, "prefix");
});

test("nothing is left running after the elements go away", async (page) => {
  await open(page, `<div id="root"></div>`);
  const got = await page.evaluate(async () => {
    const make = () => {
      $("#root").innerHTML = `<h2 class="gs-split-chars">Hello there</h2><div class="gs-marquee" style="width:400px"><span>a</span><span>b</span></div>
        <div class="box gs-magnetic gs-tilt hover:gs-to-[scale:1.1]"></div><div class="box gs-spin"></div><section class="screen gs-pin"></section>
        <ul class="gs-stagger"><li>1</li><li>2</li></ul><span class="gs-count">500</span>`;
    };
    for (let i = 0; i < 5; i++) {
      make();
      await idle();
      $("#root").innerHTML = "";
      await frames(3);
    }
    await sleep(200);
    return { triggers: ScrollTrigger.getAll().length, tweens: gsap.globalTimeline.getChildren(true, true, true).length };
  });
  equal(got.triggers, 0, "no triggers left");
  assert(got.tweens <= 2, "no animations left running: " + got.tweens);
});

await run();
