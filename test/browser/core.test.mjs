import { assert, equal, html, near, open, run, test } from "./harness.mjs";

test("hides entrances before the script runs, shows everything else", async (page) => {
  // The library script is held back, so only the early stylesheet has run.
  await page.route("**/held.js", () => {});
  const body = `<h1 id="a" class="gs-fade-up">A</h1><p id="b">plain</p><div id="c" class="logs-panel">not ours</div>
    <div id="d" class="gs-pin">pin only</div><div id="e" class="md:gs-zoom-in">variant</div><div id="f" data-gs="fade-up">data</div>`;
  const head = `<style>${(await import("../../scripts/css.mjs").then((m) => m.buildCss()))}</style><script src="/held.js" async></script>`;
  await open(page, body, { head, script: "", wait: false, waitUntil: "domcontentloaded" });
  const seen = await page.evaluate(() => ["a", "b", "c", "d", "e", "f"].map((id) => getComputedStyle(document.getElementById(id)).visibility));
  equal(seen, ["hidden", "visible", "visible", "visible", "hidden", "hidden"], "visibility");
});

test("the failsafe shows hidden elements when the script never arrives", async (page) => {
  const css = await import("../../scripts/css.mjs").then((m) => m.buildCss());
  await open(page, `<h1 id="a" class="gs-fade-up">A</h1>`, { head: `<style>${css}</style>`, script: "", wait: false });
  equal(await page.evaluate(() => getComputedStyle(document.getElementById("a")).visibility), "hidden", "before");
  await page.waitForTimeout(3300);
  equal(await page.evaluate(() => getComputedStyle(document.getElementById("a")).visibility), "visible", "after 3s");
});

test("fade-up starts hidden and low, ends as plain HTML", async (page) => {
  await open(page, `<h1 id="a" class="gs-fade-up">Hello</h1>`);
  const start = await page.evaluate(() => {
    const unit = gs.get("#a")[0];
    unit.pause(0);
    return { opacity: css("#a", "opacity"), y: num("#a", "y"), ready: $("#a").hasAttribute("data-gs-ready"), duration: unit.duration() };
  });
  equal(start.opacity, "0", "opacity at start");
  near(start.y, 40, 0.01, "y at start");
  assert(start.ready, "marked ready");
  near(start.duration, 0.8, 0.001, "default duration");
  const end = await page.evaluate(async () => {
    gs.get("#a")[0].play();
    await finish();
    return { opacity: css("#a", "opacity"), style: $("#a").getAttribute("style") || "", units: gs.get("#a").length };
  });
  equal(end.opacity, "1", "opacity at end");
  equal(end.style, "", "no inline styles left behind");
  equal(end.units, 0, "timeline released");
});

test("waits below the fold and plays when scrolled into view", async (page) => {
  await open(page, `<div class="spacer"></div><div id="a" class="box gs-fade-up"></div><div class="spacer"></div>`);
  equal(await page.evaluate(() => css("#a", "opacity")), "0", "hidden while below the fold");
  const after = await page.evaluate(async () => {
    $("#a").scrollIntoView({ block: "center" });
    await frames(3);
    await finish();
    return css("#a", "opacity");
  });
  equal(after, "1", "visible after scrolling to it");
});

test("timing classes reach the tween", async (page) => {
  await open(page, `<div id="a" class="box gs-fade-up gs-duration-1.5 gs-delay-250 gs-ease-power1.in"></div>`);
  const got = await page.evaluate(() => {
    const tween = gs.get("#a")[0].getChildren()[0];
    return { duration: tween.duration(), delay: tween.delay(), ease: gsap.parseEase("power1.in") === tween.vars.ease || tween.vars.ease };
  });
  near(got.duration, 1.5, 0.001, "duration");
  near(got.delay, 0.25, 0.001, "delay");
  equal(got.ease, "power1.in", "ease");
});

test("from and to animate to and from the natural state", async (page) => {
  await open(page, `<div id="a" class="box gs-to-[x:120,rotate:90]"></div><div id="b" class="box gs-from-[opacity:0] gs-to-x-80"></div>`);
  const got = await page.evaluate(async () => {
    await finish();
    return { ax: num("#a", "x"), ar: num("#a", "rotation"), bx: num("#b", "x"), bo: css("#b", "opacity") };
  });
  near(got.ax, 120, 0.01, "a.x");
  near(got.ar, 90, 0.01, "a.rotation");
  near(got.bx, 80, 0.01, "b.x");
  equal(got.bo, "1", "b.opacity");
});

test("settings inside the brackets behave like GSAP vars", async (page) => {
  await open(page, `<div id="a" class="box gs-to-[x:100,duration:2,ease:none,repeat:1,yoyo:true]"></div>`);
  const got = await page.evaluate(() => {
    const tween = gs.get("#a")[0].getChildren()[0];
    return { duration: tween.duration(), repeat: tween.repeat(), yoyo: tween.yoyo(), hasX: "x" in tween.vars, hasDuration: tween.vars.duration };
  });
  equal(got, { duration: 2, repeat: 1, yoyo: true, hasX: true, hasDuration: 2 }, "tween");
});

test("staggered children animate as they arrive, a row at a time", async (page) => {
  const cards = Array.from({ length: 9 }, (_, i) => `<div class="box" id="c${i}"></div>`).join("");
  await open(
    page,
    `<div id="grid" class="gs-fade-up gs-stagger-0.1" style="display:grid;grid-template-columns:repeat(3,100px);gap:20px;row-gap:700px">${cards}</div><div class="spacer"></div>`,
  );
  const first = await page.evaluate(async () => {
    await frames(2);
    const units = gs.get("#grid");
    return { count: units.length, delays: units.slice(0, 3).map((unit) => unit.delay()), far: css("#c6", "opacity"), farActive: units[6].isActive() };
  });
  equal(first.count, 9, "one timeline per child");
  equal(first.delays, [0, 0.1, 0.2], "first row is staggered");
  equal(first.far, "0", "third row still hidden");
  equal(first.farActive, false, "third row not started");
  const later = await page.evaluate(async () => {
    $("#c6").scrollIntoView({ block: "center" });
    await frames(4);
    await finish();
    return { far: css("#c6", "opacity"), style: $("#c6").getAttribute("style") || "" };
  });
  equal(later, { far: "1", style: "" }, "third row after scroll");
});

test("children added later join in", async (page) => {
  await open(page, `<div id="list" class="gs-stagger"><div class="box"></div></div>`);
  const got = await page.evaluate(async () => {
    await finish();
    const extra = document.createElement("div");
    extra.className = "box";
    extra.id = "late";
    $("#list").appendChild(extra);
    await frames(3);
    const hiddenFirst = gs.get("#list").length;
    await finish();
    return { hiddenFirst, opacity: css("#late", "opacity") };
  });
  equal(got.hiddenFirst, 1, "a timeline for the new child");
  equal(got.opacity, "1", "new child finished");
});

test("split text animates words, then puts the heading back", async (page) => {
  await open(page, `<h1 id="t" class="gs-split-words gs-fade-up">Animate with class names</h1>`);
  const during = await page.evaluate(() => {
    gs.get("#t")[0].pause(0);
    return { pieces: $("#t").children.length, label: $("#t").getAttribute("aria-label"), stagger: gs.get("#t")[0].getChildren()[0].vars.stagger };
  });
  equal(during.pieces, 4, "one element per word");
  equal(during.label, "Animate with class names", "accessible label while split");
  near(during.stagger, 0.06, 0.0001, "word stagger");
  const after = await page.evaluate(async () => {
    gs.get("#t")[0].play();
    await finish();
    return { html: $("#t").innerHTML, label: $("#t").getAttribute("aria-label") };
  });
  equal(after, { html: "Animate with class names", label: null }, "restored");
});

test("split lines with a mask wraps each line", async (page) => {
  await open(page, `<p id="t" class="gs-split-lines gs-mask gs-slide-up" style="width:200px;font-size:20px">One two three four five six seven eight nine ten eleven twelve</p>`);
  const got = await page.evaluate(() => {
    gs.get("#t")[0].pause(0);
    const masks = $$("#t > *");
    return { masks: masks.length, clip: masks[0].style.clipPath, inner: masks[0].firstElementChild ? num("#t > * > *", "yPercent") : null };
  });
  assert(got.masks >= 3, "several lines, got " + got.masks);
  equal(got.clip, "inset(-0.3em -0.16em)", "mask clips, with a little room for descenders");
  assert(got.inner > 100 && got.inner < 140, "line starts below its mask, room included: " + got.inner);
});

test("scrub follows the scrollbar", async (page) => {
  await open(page, `<div class="screen"></div><div id="a" class="box gs-to-[x:400] gs-scrub-true gs-ease-none"></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const trigger = gs.get("#a")[0].scrollTrigger;
    const mid = (trigger.start + trigger.end) / 2;
    await scrollToY(trigger.start);
    const a = num("#a", "x");
    await scrollToY(mid);
    const b = num("#a", "x");
    await scrollToY(trigger.end);
    const c = num("#a", "x");
    await scrollToY(mid);
    return { a, b, c, back: num("#a", "x") };
  });
  near(got.a, 0, 1, "at start");
  near(got.b, 200, 2, "half way");
  near(got.c, 400, 1, "at end");
  near(got.back, 200, 2, "scrolling back");
});

test("pin holds the element for its distance", async (page) => {
  await open(page, `<div class="screen"></div><div id="a" class="screen gs-pin-150" style="background:#ddd"></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const trigger = ScrollTrigger.getAll().find((item) => item.pin === $("#a"));
    const spacer = $("#a").parentElement.className;
    await scrollToY(trigger.start + 300);
    const top = $("#a").getBoundingClientRect().top;
    return { spacer, length: trigger.end - trigger.start, top };
  });
  equal(got.spacer, "pin-spacer", "wrapped in a spacer");
  near(got.length, 1200, 2, "150% of an 800px screen");
  near(got.top, 0, 1, "stays at the top while pinned");
});

test("a timeline plays its steps in page order", async (page) => {
  await open(
    page,
    `<section id="s" class="gs-timeline gs-duration-0.5">
       <h2 id="a" class="gs-fade-up">A</h2>
       <div><h2 id="b" class="gs-fade-up">B</h2></div>
       <h2 id="c" class="gs-fade-up gs-with">C</h2>
       <h2 id="d" class="gs-fade-up gs-at-[+=1] gs-duration-2 gs-label-[last]">D</h2>
     </section>`,
  );
  const got = await page.evaluate(() => {
    const master = gs.get("#s")[0];
    master.pause(0);
    const steps = master.getChildren(false, false, true);
    return {
      starts: steps.map((step) => step.startTime()),
      durations: steps.map((step) => step.duration()),
      labels: master.labels,
      own: ["#a", "#b", "#c", "#d"].map((id) => gs.get(id).length),
      hidden: ["#a", "#b", "#c", "#d"].map((id) => css(id, "opacity")),
      triggers: ScrollTrigger.getAll().length,
    };
  });
  equal(got.starts, [0, 0.5, 0.5, 2], "start times");
  equal(got.durations, [0.5, 0.5, 0.5, 2], "container duration is the default, a step can override it");
  equal(got.labels.last, 2, "label at its step");
  equal(got.own, [1, 1, 1, 1], "each step can be reached with gs.get");
  equal(got.hidden, ["0", "0", "0", "0"], "all steps wait at their start");
  equal(got.triggers, 1, "one trigger for the whole scene");
});

test("a pinned scrubbed timeline is tied to scroll", async (page) => {
  await open(
    page,
    `<div class="screen"></div>
     <section id="s" class="screen gs-timeline gs-pin-200 gs-scrub-true">
       <h2 id="a" class="gs-fade-up gs-ease-none">A</h2><h2 id="b" class="gs-fade-up gs-ease-none">B</h2>
     </section><div class="spacer"></div>`,
  );
  const got = await page.evaluate(async () => {
    const trigger = gs.get("#s")[0].scrollTrigger;
    await scrollToY(trigger.start + (trigger.end - trigger.start) * 0.25);
    const quarter = { a: Number(css("#a", "opacity")), b: Number(css("#b", "opacity")) };
    await scrollToY(trigger.end);
    return { quarter, end: { a: css("#a", "opacity"), b: css("#b", "opacity") }, length: trigger.end - trigger.start };
  });
  near(got.quarter.a, 0.5, 0.05, "first step half done at a quarter");
  near(got.quarter.b, 0, 0.01, "second step not started");
  equal(got.end, { a: "1", b: "1" }, "done at the end");
  near(got.length, 1600, 2, "200% of the screen");
});


test("a horizontal section slides its track and reveals what is inside", async (page) => {
  const panel = (id) => `<div style="width:1000px;height:400px;flex:none"><p id="${id}" class="gs-fade-up">Panel</p></div>`;
  await open(
    page,
    `<div class="screen"></div>
     <section id="h" class="screen gs-horizontal gs-scrub-true"><div id="track">${panel("p1")}${panel("p2")}${panel("p3")}${panel("p4")}</div></section>
     <div class="spacer"></div>`,
  );
  const got = await page.evaluate(async () => {
    const trigger = gs.get("#h")[0].scrollTrigger;
    const flow = { display: css("#track", "display"), overflow: css("#h", "overflowX") };
    await scrollToY(trigger.start);
    const before = { x: num("#track", "x"), p4: css("#p4", "opacity") };
    await scrollToY(trigger.end);
    await finish();
    return { flow, before, length: trigger.end - trigger.start, x: num("#track", "x"), p4: css("#p4", "opacity"), spacer: $("#h").parentElement.className };
  });
  equal(got.flow, { display: "flex", overflow: "hidden" }, "the stylesheet lays the track out as a row");
  near(got.before.x, 0, 1, "track at rest");
  equal(got.before.p4, "0", "last panel's text waits off screen");
  near(got.length, 2800, 2, "scroll length equals the overflow (4000 - 1200)");
  near(got.x, -2800, 2, "track fully slid");
  equal(got.p4, "1", "last panel's text revealed by the sideways movement");
  equal(got.spacer, "pin-spacer", "section is pinned");
});

test("hover plays forward and back", async (page) => {
  await open(page, `<div style="padding:100px"><div id="a" class="box hover:gs-to-[scale:1.5] hover:gs-duration-0.2"></div></div>`);
  await page.hover("#a");
  const on = await page.evaluate(async () => {
    await finish();
    return num("#a", "scale");
  });
  near(on, 1.5, 0.01, "scaled while hovered");
  await page.mouse.move(5, 5);
  const off = await page.evaluate(async () => {
    await finish();
    return num("#a", "scale");
  });
  near(off, 1, 0.01, "back to normal");
});

test("group-hover reacts to the ancestor", async (page) => {
  await open(page, `<div id="card" class="gs-group" style="padding:60px;width:300px"><div id="a" class="box group-hover:gs-to-[y:-20]"></div></div>`);
  await page.hover("#card", { position: { x: 10, y: 10 } });
  const on = await page.evaluate(async () => {
    await finish();
    return num("#a", "y");
  });
  near(on, -20, 0.01, "moved when the card is hovered");
});

test("click toggles, with another element as the button", async (page) => {
  await open(page, `<button id="btn" aria-expanded="false">Menu</button><div id="menu" class="box click:gs-fade-down click:gs-trigger-[#btn]"></div>`);
  const closed = await page.evaluate(() => ({ visibility: css("#menu", "visibility"), opacity: css("#menu", "opacity") }));
  equal(closed, { visibility: "hidden", opacity: "0" }, "starts closed");
  await page.click("#btn");
  const open1 = await page.evaluate(async () => {
    await finish();
    return { visibility: css("#menu", "visibility"), opacity: css("#menu", "opacity"), expanded: $("#btn").getAttribute("aria-expanded") };
  });
  equal(open1, { visibility: "visible", opacity: "1", expanded: "true" }, "open after a click");
  await page.click("#btn");
  const closed2 = await page.evaluate(async () => {
    await finish();
    return { visibility: css("#menu", "visibility"), expanded: $("#btn").getAttribute("aria-expanded") };
  });
  equal(closed2, { visibility: "hidden", expanded: "false" }, "closed after another");
});

test("press and focus", async (page) => {
  await open(page, `<button id="a" class="press:gs-to-[scale:0.9] focus:gs-to-[y:-4]" style="margin:80px">Go</button>`);
  await page.mouse.move(100, 95);
  await page.mouse.down();
  const down = await page.evaluate(async () => {
    await finish();
    return { scale: num("#a", "scale"), y: num("#a", "y") };
  });
  near(down.scale, 0.9, 0.01, "pressed");
  near(down.y, -4, 0.01, "focused by the click");
  await page.mouse.up();
  const up = await page.evaluate(async () => {
    await finish();
    return num("#a", "scale");
  });
  near(up, 1, 0.01, "released");
});

test("load plays at once without ScrollTrigger", async (page) => {
  await open(page, `<div class="spacer"></div><div id="a" class="box load:gs-fade-up"></div>`);
  const got = await page.evaluate(async () => {
    await finish();
    return { opacity: css("#a", "opacity"), trigger: typeof window.ScrollTrigger };
  });
  equal(got, { opacity: "1", trigger: "undefined" }, "played below the fold, plugin never loaded");
});

test("breakpoint classes switch when the window crosses them", async (page) => {
  await open(page, `<div id="a" class="box gs-to-[x:50] md:gs-to-[x:300] max-md:gs-duration-2"></div>`);
  const wide = await page.evaluate(async () => {
    await finish();
    return num("#a", "x");
  });
  near(wide, 300, 0.01, "desktop value");
  await page.setViewportSize({ width: 600, height: 800 });
  const narrow = await page.evaluate(async () => {
    await frames(4);
    const duration = gs.get("#a")[0].getChildren()[0].duration();
    await finish();
    return { x: num("#a", "x"), duration };
  });
  near(narrow.x, 50, 0.01, "mobile value after resize");
  equal(narrow.duration, 2, "max-md class now applies");
});

test("off switches an element's animations off at a breakpoint", async (page) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await open(page, `<div id="a" class="box gs-fade-up max-md:gs-off"></div>`);
  const got = await page.evaluate(() => ({ opacity: css("#a", "opacity"), units: gs.get("#a").length, ready: $("#a").hasAttribute("data-gs-ready") }));
  equal(got, { opacity: "1", units: 0, ready: true }, "plain on mobile");
});

test("reduced motion: entrances are skipped, end states apply, scrub stays", async (page, { context }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(
    page,
    `<h1 id="a" class="gs-fade-up">A</h1><h1 id="s" class="gs-split-words">Split me</h1><div id="b" class="box gs-to-[x:100]"></div>
     <div id="c" class="box gs-spin"></div><div id="m" class="gs-marquee"><span>one</span><span>two</span></div>
     <div class="screen"></div><div id="d" class="box gs-to-[x:400] gs-scrub"></div>
     <div id="p" class="box gs-parallax"></div><div id="keep" class="box gs-fade-up gs-motion-ok"></div>
     <div id="alt" class="box motion-safe:gs-fade-up motion-reduce:gs-fade"></div><div class="spacer"></div>`,
  );
  const got = await page.evaluate(async () => {
    await frames(3);
    const keep = gs.get("#keep")[0];
    const alt = gs.get("#alt")[0];
    return {
      a: css("#a", "opacity"),
      aUnits: gs.get("#a").length,
      split: $("#s").children.length,
      bx: num("#b", "x"),
      spin: gs.get("#c").length,
      clones: $$("#m [data-gs-clone]").length,
      scrub: gs.get("#d")[0].scrollTrigger.vars.scrub,
      parallax: gs.get("#p").length,
      keep: !!keep && keep.duration() > 0.5,
      alt: alt ? Object.keys(alt.getChildren()[0].vars).includes("y") : null,
    };
  });
  equal(got.a, "1", "entrance shown at once");
  equal(got.aUnits, 0, "no timeline made for it");
  equal(got.split, 0, "text is not split");
  near(got.bx, 100, 0.01, "to-tween jumps to its end");
  equal(got.spin, 0, "loops do not run");
  equal(got.clones, 0, "marquee stays still");
  equal(got.scrub, true, "scrub stays, without smoothing");
  equal(got.parallax, 0, "parallax is skipped");
  equal(got.keep, true, "motion-ok keeps the animation");
  equal(got.alt, false, "motion-reduce picks the gentler class");
});

test("elements added after load animate, removed ones are forgotten", async (page) => {
  await open(page, `<div id="root"></div>`);
  const got = await page.evaluate(async () => {
    $("#root").innerHTML = `<div id="a" class="box gs-fade-up"></div><div id="b" class="box gs-to-[x:300] gs-scrub"></div>`;
    await idle();
    const added = { a: gs.get("#a").length, triggers: ScrollTrigger.getAll().length, ready: $("#a").hasAttribute("data-gs-ready") };
    $("#root").innerHTML = "";
    await frames(3);
    return { added, after: ScrollTrigger.getAll().length };
  });
  equal(got.added, { a: 1, triggers: 2, ready: true }, "built when inserted");
  equal(got.after, 0, "triggers removed with the elements");
});

test("changing the class rebuilds the animation", async (page) => {
  await open(page, `<div id="a" class="box gs-to-[x:100]"></div>`);
  const got = await page.evaluate(async () => {
    await finish();
    const first = num("#a", "x");
    $("#a").className = "box gs-to-[y:60]";
    await frames(3);
    await finish();
    const second = { x: num("#a", "x"), y: num("#a", "y") };
    $("#a").className = "box";
    await frames(3);
    return { first, second, style: $("#a").getAttribute("style") || "", units: gs.get("#a").length };
  });
  near(got.first, 100, 0.01, "first animation");
  equal(got.second, { x: 0, y: 60 }, "old one undone, new one played");
  equal(got.style, "", "clean once the class is gone");
  equal(got.units, 0, "forgotten");
});

test("data-gs works without the prefix", async (page) => {
  await open(page, `<div id="a" class="box" data-gs="to-[x:140] duration-0.3 hover:to-[scale:1.2]"></div>`);
  const got = await page.evaluate(async () => {
    const units = gs.get("#a").length;
    await finish();
    return { units, x: num("#a", "x") };
  });
  equal(got, { units: 2, x: 140 }, "data attribute");
});

test("custom presets and config", async (page) => {
  await open(page, `<div id="a" class="box gs-swoop"></div><div id="b" class="box gs-fade-up"></div>`, {
    config: { duration: 0.4, distance: 90 },
    head: `<script>gs.preset("swoop", { from: { autoAlpha: 0, y: 80, rotation: 6 }, vars: { ease: "expo.out" } });</script>`,
  });
  const got = await page.evaluate(() => {
    const a = gs.get("#a")[0];
    const b = gs.get("#b")[0];
    a.pause(0);
    b.pause(0);
    return { ay: num("#a", "y"), ar: num("#a", "rotation"), by: num("#b", "y"), duration: b.duration(), hidden: gs.css().includes("gs-swoop") };
  });
  equal(got, { ay: 80, ar: 6, by: 90, duration: 0.4, hidden: true }, "preset and config");
});

test("unknown classes get a helpful warning", async (page, { logs }) => {
  await open(
    page,
    `<div class="box gs-fad-up"></div><div class="box tablet:gs-fade-up"></div><div class="box gs-duration-fast"></div>
     <div class="box gs-fade-in-up"></div><div class="box gs-paralax"></div>`,
  );
  const text = logs.map((entry) => entry.text).join("\n");
  assert(text.includes('"gs-fade-in-up" is not a class I know. Did you mean "gs-fade-up"'), "fixes a stray -in: " + text);
  assert(text.includes('Did you mean "gs-parallax"'), "fixes a typo in a helper: " + text);
  assert(text.includes('Did you mean "gs-fade-up"'), "suggests the right class: " + text);
  assert(text.includes('"tablet:"'), "names the bad prefix");
  assert(text.includes("has a value I cannot read"), "flags the bad value");
});

test("revert puts the whole page back", async (page) => {
  const body = `<h1 id="t" class="gs-split-chars gs-fade-up">Hello</h1><div class="screen"></div><div id="p" class="screen gs-pin"></div>
     <div id="m" class="gs-marquee"><span>one</span><span>two</span></div><div id="a" class="box gs-to-[x:100] gs-scrub"></div><div class="spacer"></div>`;
  await open(page, body);
  const got = await page.evaluate(async () => {
    await frames(3);
    const before = { spacers: $$(".pin-spacer").length, clones: $$("[data-gs-clone]").length, triggers: ScrollTrigger.getAll().length };
    gs.revert();
    await frames(2);
    return {
      before,
      spacers: $$(".pin-spacer").length,
      clones: $$("[data-gs-clone]").length,
      triggers: ScrollTrigger.getAll().length,
      title: $("#t").innerHTML,
      styles: ["#t", "#p", "#a"].map((id) => $(id).getAttribute("style") || ""),
    };
  });
  assert(got.before.spacers === 1 && got.before.clones > 0 && got.before.triggers >= 3, "things were built: " + JSON.stringify(got.before));
  equal({ spacers: got.spacers, clones: got.clones, triggers: got.triggers }, { spacers: 0, clones: 0, triggers: 0 }, "all removed");
  equal(got.title, "Hello", "text restored");
  equal(got.styles, ["", "", ""], "inline styles restored");
});

test("a framework can remove or reorder a pinned element without errors", async (page) => {
  await open(page, `<div class="screen"></div><main id="main"><section id="p" class="screen gs-pin"></section><p id="after">after</p></main><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    await frames(2);
    const main = $("#main");
    const pinned = $("#p");
    const wrapped = pinned.parentElement !== main;
    // What React does: insert a sibling before the node it remembers, then remove that node through the parent it remembers.
    const extra = document.createElement("p");
    extra.id = "extra";
    main.insertBefore(extra, pinned);
    const stillPinned = pinned.parentElement.className === "pin-spacer";
    const order = Array.from(main.children).map((child) => child.id || child.className);
    main.removeChild(pinned);
    await frames(3);
    return { wrapped, stillPinned, order, left: Array.from(main.children).map((child) => child.id || child.className), triggers: ScrollTrigger.getAll().length, patched: Object.keys(main).length };
  });
  assert(got.wrapped, "pin wrapped the element");
  assert(got.stillPinned, "inserting a sibling does not undo the pin");
  equal(got.order, ["extra", "pin-spacer", "after"], "sibling lands in front of the spacer");
  equal(got.left, ["extra", "after"], "removed cleanly, spacer gone too");
  equal(got.triggers, 0, "trigger cleaned up");
  equal(got.patched, 0, "parent is left untouched afterwards");
});

test("printing shows everything", async (page) => {
  await open(page, `<div class="spacer"></div><div id="a" class="box gs-fade-up"></div><ul id="l" class="gs-stagger"><li>a</li><li id="li">b</li></ul>`);
  const got = await page.evaluate(() => {
    const before = [css("#a", "opacity"), css("#li", "opacity")];
    window.dispatchEvent(new Event("beforeprint"));
    return { before, after: [css("#a", "opacity"), css("#li", "opacity")] };
  });
  equal(got, { before: ["0", "0"], after: ["1", "1"] }, "print");
});

test("CSS transitions are parked while GSAP animates the same property", async (page) => {
  await open(page, `<div id="a" class="box gs-fade-up" style="transition: all 0.3s ease, color 1s"></div>`);
  const read = `(() => { const style = getComputedStyle($("#a")); const names = style.transitionProperty.split(", "); const times = style.transitionDuration.split(", "); return Object.fromEntries(names.map((name, i) => [name, times[i % times.length]])); })()`;
  const got = await page.evaluate(async (read) => {
    gs.get("#a")[0].pause(0);
    const during = eval(read);
    gs.get("#a")[0].play();
    await finish();
    return { during, after: eval(read), inline: $("#a").style.transition };
  }, read);
  // A scroll reveal waits see-through (opacity), not hidden (visibility), so the keyboard can reach it
  equal(got.during, { all: "0.3s", color: "1s", transform: "0s", opacity: "0s" }, "only the animated properties are switched off");
  equal(got.after, { all: "0.3s", color: "1s" }, "restored afterwards");
});

test("events fire on the element", async (page) => {
  await open(page, `<div id="a" class="box gs-fade-up"></div>`, { head: `<script>window.seen = []; document.addEventListener("gs:start", (e) => seen.push("start:" + e.target.id)); document.addEventListener("gs:complete", (e) => seen.push("complete:" + e.target.id + ":" + e.detail.trigger));</script>` });
  const got = await page.evaluate(async () => {
    await finish();
    return window.seen;
  });
  equal(got, ["start:a", "complete:a:view"], "events");
});


await run();
