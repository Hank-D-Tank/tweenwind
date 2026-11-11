import { assert, equal, near, open, run, test } from "./harness.mjs";

// What happens over the life of a page: a reveal plays once, hidden things wait until they are
// shown, menus close the way people expect, and an element handed back stays handed back.

/** Records every gs:start from now on, by element id, in window.__starts. */
const WATCH = `(() => {
  window.__starts = [];
  document.addEventListener("gs:start", (event) => window.__starts.push(event.target.id));
})()`;

test("a reveal that has played stays played when the window crosses a breakpoint", async (page) => {
  await open(page, `<div id="a" class="box gs-fade-up md:gs-duration-0.4"></div><div class="spacer"></div>`);
  const before = await page.evaluate(async (watch) => {
    await finish();
    eval(watch);
    return { style: $("#a").getAttribute("style"), timelines: gs.get("#a").length };
  }, WATCH);
  equal(before, { style: null, timelines: 0 }, "played and tidied away");
  await page.setViewportSize({ width: 600, height: 800 });
  const after = await page.evaluate(async () => {
    await idle();
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      seen.add(css("#a", "opacity"));
      await frames(2);
    }
    return { starts: window.__starts, opacities: Array.from(seen), style: $("#a").getAttribute("style"), visibility: css("#a", "visibility") };
  });
  equal(after, { starts: [], opacities: ["1"], style: null, visibility: "visible" }, "rebuilt for the new width, without fading in a second time");
});

test("gs.refresh() does not replay what already played, and what has not played yet still does", async (page) => {
  await open(page, `<div id="a" class="box gs-fade-up"></div><div class="spacer"></div><div id="b" class="box gs-fade-up"></div><div class="spacer"></div>`);
  const got = await page.evaluate(async (watch) => {
    await finish();
    eval(watch);
    await gs.refresh();
    await frames(4);
    const early = { a: css("#a", "opacity"), b: css("#b", "opacity"), starts: window.__starts.slice() };
    $("#b").scrollIntoView();
    await frames(4);
    await finish();
    return { early, starts: window.__starts, b: css("#b", "opacity") };
  }, WATCH);
  equal(got.early, { a: "1", b: "0", starts: [] }, "the first one stays as it is, the second still waits below the fold");
  equal([got.starts, got.b], [["b"], "1"], "and plays when it is reached");
});

test("in a list that has already revealed, only a new item animates", async (page) => {
  await open(page, `<ul id="l" class="gs-fade-up gs-stagger-0.1"><li id="one">1</li><li id="two">2</li></ul><div class="spacer"></div>`);
  const got = await page.evaluate(async (watch) => {
    await finish();
    eval(watch);
    const item = document.createElement("li");
    item.id = "three";
    item.textContent = "3";
    $("#l").append(item);
    await idle();
    await frames(3);
    const during = { one: css("#one", "opacity"), three: Number(css("#three", "opacity")) };
    await finish();
    const added = { starts: window.__starts.slice(), end: css("#three", "opacity") };
    window.__starts.length = 0;
    await gs.refresh();
    await frames(4);
    return { during, added, again: window.__starts.slice(), all: $$("#l li").map((li) => getComputedStyle(li).opacity + "|" + (li.getAttribute("style") || "")) };
  }, WATCH);
  equal(got.during.one, "1", "the old items do not move");
  assert(got.during.three < 1, "the new one fades in: " + got.during.three);
  equal(got.added, { starts: ["three"], end: "1" }, "one start, for the new item only");
  equal([got.again, got.all], [[], ["1|", "1|", "1|"]], "and a rebuild of the whole list replays none of them");
});

test("a step added to a timeline that already played animates by itself", async (page) => {
  await open(page, `<section id="t" class="gs-timeline"><h2 id="a" class="gs-fade-up">A</h2><h2 id="b" class="gs-fade-up">B</h2></section><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    await finish();
    await sleep(100);
    const step = document.createElement("h2");
    step.id = "c";
    step.className = "gs-fade-up";
    step.textContent = "C";
    $("#t").append(step);
    await idle();
    await frames(3);
    const during = { a: css("#a", "opacity"), b: css("#b", "opacity"), c: Number(css("#c", "opacity")) };
    await finish();
    await sleep(100);
    return { during, end: ["#a", "#b", "#c"].map((id) => css(id, "opacity") + "|" + ($(id).getAttribute("style") || "")) };
  });
  equal([got.during.a, got.during.b], ["1", "1"], "the steps that already played stay put");
  assert(got.during.c < 1, "the new step fades in: " + got.during.c);
  equal(got.end, ["1|", "1|", "1|"], "and all three end as plain elements");
});

test("taking the class off and putting it back, or the element out and back in, plays the reveal again", async (page) => {
  await open(page, `<div id="host"><div id="a" class="box gs-fade-up"></div><div id="b" class="box gs-fade-up"></div></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    await finish();
    $("#a").classList.remove("gs-fade-up");
    const b = $("#b");
    b.remove();
    await idle();
    $("#a").classList.add("gs-fade-up");
    $("#host").append(b);
    await idle();
    await frames(3);
    const during = [Number(css("#a", "opacity")), Number(css("#b", "opacity"))];
    await finish();
    return { during, end: [css("#a", "opacity"), css("#b", "opacity")] };
  });
  assert(got.during[0] < 1 && got.during[1] < 1, "both fade in again: " + got.during);
  equal(got.end, ["1", "1"], "and end visible");
});

test("what sits in a closed tab waits, and animates when the tab is opened", async (page) => {
  await open(
    page,
    `<div id="tab" style="display:none"><h2 id="h" class="gs-fade-up">Title</h2><p id="s" class="gs-split-words gs-fade-up">a few words here</p></div><div class="spacer"></div>`,
  );
  const before = await page.evaluate(() => ({ ready: $$("[data-gs-ready]").length, timelines: gs.get("#h").length + gs.get("#s").length, triggers: ScrollTrigger.getAll().length }));
  equal(before, { ready: 0, timelines: 0, triggers: 0 }, "nothing is set up while it is hidden");
  const shown = await page.evaluate(async () => {
    $("#tab").style.display = "block";
    await frames(3);
    const early = { opacity: Number(css("#h", "opacity")), words: $("#s").children.length };
    await finish();
    await sleep(100);
    return { early, end: [css("#h", "opacity") + "|" + ($("#h").getAttribute("style") || ""), $("#s").innerHTML] };
  });
  assert(shown.early.opacity < 1, "the heading starts its reveal as the tab opens: " + shown.early.opacity);
  equal(shown.early.words, 4, "and the paragraph is split, now that it can be measured");
  equal(shown.end, ["1|", "a few words here"], "both end as plain elements");
});

test("an inline element that was hidden is found too, a moment later", async (page) => {
  await open(page, `<p>Text <span id="w" style="display:none"><b id="i" class="gs-fade-up">inline</b></span></p><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const before = $("#i").hasAttribute("data-gs-ready");
    $("#w").style.display = "inline";
    // An inline box has no size to observe, so this one is picked up by the slower look-around.
    await sleep(700);
    const built = $("#i").hasAttribute("data-gs-ready");
    await finish();
    return { before, built, end: css("#i", "opacity") + "|" + css("#i", "visibility") };
  });
  equal(got, { before: false, built: true, end: "1|visible" }, "set up after it was shown, and visible at the end");
});

test("the content of a dialog animates when the dialog opens", async (page) => {
  await open(page, `<dialog id="d"><h2 id="h" class="gs-fade-up">Hello</h2><ul id="l" class="gs-fade-up gs-stagger-0.1"><li>one</li><li>two</li></ul></dialog><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const before = $$("[data-gs-ready]").length;
    $("#d").showModal();
    await frames(3);
    const early = Number(css("#h", "opacity"));
    await finish();
    await finish();
    return { before, early, end: [css("#h", "opacity"), ...$$("#l li").map((li) => getComputedStyle(li).opacity)] };
  });
  equal(got.before, 0, "nothing set up while the dialog is closed");
  assert(got.early < 1, "the heading reveals as it opens: " + got.early);
  equal(got.end, ["1", "1", "1"], "everything ends visible");
});

test("a pinned scene and a marquee inside a hidden block start working when the block is shown", async (page) => {
  await open(
    page,
    `<div id="w" style="display:none">
       <div id="m" class="gs-marquee" style="width:600px"><span style="padding:0 30px">one</span><span style="padding:0 30px">two</span></div>
       <section id="p" class="gs-timeline gs-pin-100 gs-scrub-true gs-ease-none screen"><div id="a" class="box gs-to-[x:200]"></div></section>
     </div><div class="spacer"></div>`,
  );
  const before = await page.evaluate(() => ({ spacers: $$(".pin-spacer").length, clones: $$("[data-gs-clone]").length }));
  equal(before, { spacers: 0, clones: 0 }, "no pin and no copies while hidden");
  const got = await page.evaluate(async () => {
    $("#w").style.display = "block";
    await idle();
    await frames(3);
    const pin = ScrollTrigger.getAll().find((trigger) => trigger.pin);
    const first = $("#m").firstElementChild.getBoundingClientRect().left;
    await sleep(300);
    const moved = $("#m").firstElementChild.getBoundingClientRect().left !== first;
    await scrollToY((pin.start + pin.end) / 2);
    await sleep(200);
    return { spacers: $$(".pin-spacer").length, clones: $$("[data-gs-clone]").length, top: Math.round($("#p").getBoundingClientRect().top), x: num("#a", "x"), moved };
  });
  equal([got.spacers, got.top], [1, 0], "the section is pinned");
  near(got.x, 100, 3, "its animation is half way at half the pin");
  assert(got.clones >= 2 && got.moved, "the marquee has its copies and is moving: " + JSON.stringify(got));
});

test("gs-outside closes a click animation on a click elsewhere, not on a click inside it, and Escape closes it too", async (page) => {
  await open(
    page,
    `<button id="b" aria-expanded="false">Menu</button>
     <div id="m" class="box click:gs-to-[x:200] click:gs-trigger-[#b] click:gs-outside click:gs-duration-0.1"><a id="in" href="#in">in</a></div>
     <p id="else" style="margin-top:200px">elsewhere</p>`,
  );
  const state = () => page.evaluate(() => [Math.round(num("#m", "x")), $("#b").getAttribute("aria-expanded")]);
  await page.click("#b");
  await page.waitForTimeout(300);
  equal(await state(), [200, "true"], "open");
  await page.click("#in");
  await page.waitForTimeout(300);
  equal(await state(), [200, "true"], "a click inside leaves it open");
  await page.click("#else");
  await page.waitForTimeout(300);
  equal(await state(), [0, "false"], "a click elsewhere closes it");
  await page.click("#b");
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  equal(await state(), [0, "false"], "and so does Escape");
  equal(await page.evaluate(() => document.activeElement.id), "b", "which hands the focus back to the button");
});

test("a click animation on something that is not a button can be reached and used with the keyboard", async (page) => {
  await open(page, `<div id="c" class="box click:gs-to-[x:100] click:gs-duration-0.1"></div><button id="real" class="click:gs-to-[x:50]">real</button>`);
  const attrs = () => page.evaluate(() => [$("#c").getAttribute("tabindex"), $("#c").getAttribute("role"), $("#real").getAttribute("tabindex"), $("#real").getAttribute("role")]);
  equal(await attrs(), ["0", "button", null, null], "the div becomes a button for the keyboard, the real button is left alone");
  await page.focus("#c");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  equal(await page.evaluate(() => Math.round(num("#c", "x"))), 100, "Enter opens it");
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  equal(await page.evaluate(() => Math.round(num("#c", "x"))), 0, "Space closes it");
  await page.evaluate(() => gs.revert("#c"));
  equal((await attrs()).slice(0, 2), [null, null], "and the borrowed attributes go when the animation does");
});

test("an element handed back with gs.revert stays handed back until it is scanned by name", async (page) => {
  await open(page, `<div id="a" class="box gs-to-[x:100] gs-scrub-true"></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const built = gs.get("#a").length;
    gs.revert("#a");
    await gs.scan();
    const afterPageScan = gs.get("#a").length;
    $("#a").classList.add("gs-ease-none");
    await idle();
    const afterClassChange = gs.get("#a").length;
    await gs.scan("#a");
    return { built, afterPageScan, afterClassChange, afterNamedScan: gs.get("#a").length };
  });
  equal(got, { built: 1, afterPageScan: 0, afterClassChange: 0, afterNamedScan: 1 }, "only gs.scan('#a') brings it back");
});

test("a reveal behind hover: rests see-through, not hidden, so the pointer can still find it", async (page) => {
  await open(page, `<div style="padding:60px"><div id="a" class="box hover:gs-fade-up hover:gs-duration-0.15"></div></div>`);
  const rest = await page.evaluate(() => [css("#a", "opacity"), css("#a", "visibility")]);
  equal(rest, ["0", "visible"], "invisible at rest, but still there for the pointer");
  await page.hover("#a");
  await page.waitForTimeout(500);
  equal(await page.evaluate(() => css("#a", "opacity")), "1", "it fades in under the pointer");
  await page.mouse.move(700, 600);
  await page.waitForTimeout(500);
  equal(await page.evaluate(() => css("#a", "opacity")), "0", "and out again when the pointer leaves");
});

test("a click animation on a div that already has a tabindex answers to Enter and Space too", async (page) => {
  await open(page, `<div id="c" tabindex="0" class="box click:gs-to-[x:100] click:gs-duration-0.1"></div>`);
  await page.focus("#c");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  equal(await page.evaluate(() => Math.round(num("#c", "x"))), 100, "Enter opens it");
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  equal(await page.evaluate(() => [Math.round(num("#c", "x")), $("#c").getAttribute("tabindex"), $("#c").getAttribute("role")]), [0, "0", null], "Space closes it, and the author's own attributes are left as they were");
});

test("a plain timing class next to an animation behind a prefix is named in the console", async (page, { logs }) => {
  await open(page, `<div id="a" class="box load:gs-fade-up gs-duration-3"></div><div id="b" class="box gs-scroll-to gs-duration-2"></div><ul class="gs-stagger"><li class="gs-delay-1">x</li></ul>`);
  const warnings = logs.filter((entry) => entry.type === "warning").map((entry) => entry.text);
  equal(warnings.filter((text) => text.includes("nothing to time")).length, 1, "one warning, for the load: element only: " + JSON.stringify(warnings));
  assert(warnings.some((text) => text.includes('"gs-duration-3"') && text.includes('"load:gs-duration-3"')), "it says what to write instead: " + JSON.stringify(warnings));
  equal(await page.evaluate(() => gs.get("#a").map((timeline) => timeline.duration())), [0.8], "and the animation keeps its default length");
});

test("smooth scrolling switched off and on again reuses one wrapper and hands the page back each time", async (page) => {
  await open(page, `<div id="w" class="gs-smooth"><div class="box gs-fade-up"></div><div class="spacer"></div><div class="box gs-fade-up"></div></div>`);
  const got = await page.evaluate(async () => {
    // No wrapper was written in the page, so ScrollSmoother made one around the content.
    const first = $("#w").parentElement;
    first.__first = true;
    const off = [];
    const on = [];
    for (let i = 0; i < 4; i++) {
      $("#w").classList.remove("gs-smooth");
      await idle();
      await sleep(350);
      off.push([$("#w").parentElement === document.body, first.isConnected, document.body.getAttribute("style"), $("#w").getAttribute("style")]);
      $("#w").classList.add("gs-smooth");
      await idle();
      on.push([$("#w").parentElement.__first === true, !!ScrollSmoother.get()]);
    }
    return { wrapped: first !== document.body, off, on };
  });
  assert(got.wrapped, "the content was wrapped to begin with");
  equal(got.off, Array(4).fill([true, false, null, null]), "off: the content is back in the body, the wrapper is gone, no body height, no styles on the content");
  equal(got.on, Array(4).fill([true, true]), "on: the same wrapper comes back each time, so nothing piles up");
});

test("an ease GSAP does not know is named in the console instead of quietly replaced", async (page, { logs }) => {
  await open(page, `<div id="a" class="box gs-fade-up gs-ease-bouncy.out"></div><div id="b" class="box gs-fade-up gs-ease-[back.out(1.7)]"></div>`);
  const warnings = logs.filter((entry) => entry.type === "warning").map((entry) => entry.text);
  assert(warnings.some((text) => text.includes("gs-ease-bouncy.out") && text.includes("not an ease")), "the bad ease is named: " + JSON.stringify(warnings));
  equal(warnings.filter((text) => text.includes("not an ease")).length, 1, "and it is the only one reported, the real ease is fine");
  equal(await page.evaluate(async () => (await finish(), css("#a", "opacity"))), "1", "and the element still animates, with the default ease");
});

await run();
