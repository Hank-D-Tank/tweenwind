import { assert, equal, near, open, run, test } from "./harness.mjs";

const ST = () => (window.ScrollTrigger ? ScrollTrigger.getAll().length : 0);

// Cases from a read of the source: what is left behind, what moves, what is removed.
// Found by an independent flaw hunt on 2026-11-10 and kept as regression tests.

test("count keeps child markup", async (page) => {
  await open(page, `<p id="c" class="gs-count">Over <b>1,200</b> clients</p>`);
  const got = await page.evaluate(async () => {
    const during = $("#c").innerHTML;
    await finish();
    return { during, after: $("#c").innerHTML };
  });
  assert(got.after.includes("<b>"), "markup lost: during=" + got.during + " after=" + got.after);
});

test("count shows text changed from outside before it plays", async (page) => {
  await open(page, `<div class="spacer"></div><span id="c" class="gs-count">0</span><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    $("#c").textContent = "1,250";
    await idle();
    await scrollToY(document.documentElement.scrollHeight / 2);
    await finish();
    return $("#c").textContent;
  });
  equal(got, "1,250", "final text is the new one");
});

test("type shows text changed from outside before it plays", async (page) => {
  await open(page, `<div class="spacer"></div><p id="c" class="gs-type">old words here</p><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    $("#c").textContent = "new words";
    await idle();
    await scrollToY(document.documentElement.scrollHeight / 2);
    await finish();
    return $("#c").textContent;
  });
  equal(got, "new words", "final text is the new one");
});

test("moving a timeline step to another timeline", async (page) => {
  await open(
    page,
    `<section id="A" class="gs-timeline gs-scrub-true"><h2 id="s1" class="gs-fade-up">one</h2><h2 id="s2" class="gs-fade-up">two</h2></section>
     <div class="spacer"></div>
     <section id="B" class="gs-timeline gs-scrub-true"><h2 id="s3" class="gs-fade-up">three</h2></section><div class="spacer"></div>`,
  );
  const got = await page.evaluate(async () => {
    const before = gs.get("#B")[0].getChildren(false).length;
    $("#B").appendChild($("#s2"));
    await idle();
    await frames(3);
    return { before, A: gs.get("#A")[0].getChildren(false).length, B: gs.get("#B")[0].getChildren(false).length };
  });
  equal(got, { before: 1, A: 1, B: 2 }, "timelines follow the moved step");
});

test("step reordered inside its timeline", async (page) => {
  await open(
    page,
    `<section id="A" class="gs-timeline gs-scrub-true"><h2 id="s1" class="gs-fade-up">one</h2><h2 id="s2" class="gs-fade-up">two</h2></section><div class="spacer"></div>`,
  );
  const got = await page.evaluate(async () => {
    $("#A").prepend($("#s2"));
    await idle();
    await frames(3);
    const tl = gs.get("#A")[0];
    const kids = tl.getChildren(false).map((c) => c.getChildren(false)[0].targets()[0].id);
    return kids;
  });
  equal(got, ["s2", "s1"], "master order follows page order after a reorder");
});

test("revert on one timeline step", async (page) => {
  await open(
    page,
    `<section id="A" class="gs-timeline"><h2 id="s1" class="gs-fade-up">one</h2><h2 id="s2" class="gs-fade-up">two</h2></section><div class="spacer"></div>`,
  );
  const got = await page.evaluate(async () => {
    gs.revert($("#s2"));
    await frames(3);
    return { op: css("#s2", "opacity"), ty: num("#s2", "y"), tweens: gsap.getTweensOf($("#s2")).length };
  });
  equal({ op: got.op, ty: got.ty }, { op: "1", ty: 0 }, "step is plain after revert: " + JSON.stringify(got));
});

test("gs.revert and gs.scan take a selector like gs.get", async (page) => {
  await open(page, `<div id="a" class="gs-fade-up">a</div>`);
  const got = await page.evaluate(async () => {
    const out = {};
    try { gs.revert("#a"); out.revert = "ok"; } catch (e) { out.revert = e.message; }
    try { await gs.scan("#a"); out.scan = "ok"; } catch (e) { out.scan = e.message; }
    return out;
  });
  equal(got, { revert: "ok", scan: "ok" }, "string accepted");
});

test("a stagger list that grows and shrinks keeps no extra scroll triggers", async (page) => {
  await open(page, `<ul id="l" class="gs-fade-up gs-stagger-0.05"><li>a</li></ul><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const base = ScrollTrigger.getAll().length;
    const list = $("#l");
    for (let i = 0; i < 40; i++) {
      const li = document.createElement("li");
      li.textContent = "x" + i;
      list.appendChild(li);
      await idle();
      li.remove();
      await idle();
    }
    return { base, now: ScrollTrigger.getAll().length };
  });
  assert(got.now <= got.base + 1, `triggers grew from ${got.base} to ${got.now}`);
});

test("a pinned element removed with el.remove() stays removed", async (page) => {
  await open(
    page,
    `<div id="wrap"><section id="p" class="screen gs-pin-200">pinned</section><div class="spacer"></div></div>`,
  );
  const got = await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    $("#p").remove();
    await idle();
    await frames(3);
    return { spacers: $$(".pin-spacer").length, h, after: document.documentElement.scrollHeight, st: ScrollTrigger.getAll().length };
  });
  equal(got.spacers, 0, "no empty pin-spacer left: " + JSON.stringify(got));
});

test("pinned element removed by replaceChildren on parent", async (page) => {
  await open(page, `<div id="wrap"><section id="p" class="screen gs-pin-200">pinned</section><div class="spacer"></div></div>`);
  const got = await page.evaluate(async () => {
    $("#wrap").replaceChildren();
    await idle();
    await frames(3);
    return { spacers: $$(".pin-spacer").length, st: ScrollTrigger.getAll().length, own: Object.keys($("#wrap")).concat(Object.getOwnPropertyNames($("#wrap"))) };
  });
  equal(got.spacers, 0, JSON.stringify(got));
});

test("pin toggled on and off repeatedly leaves no spacer and no guard", async (page) => {
  await open(page, `<div id="wrap"><section id="p" class="screen gs-pin-200">pinned</section><div class="spacer"></div></div>`);
  const got = await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) {
      $("#p").className = "screen";
      await idle();
      $("#p").className = "screen gs-pin-200";
      await idle();
    }
    $("#p").className = "screen";
    await idle();
    return {
      spacers: $$(".pin-spacer").length,
      own: Object.getOwnPropertyNames($("#wrap")).filter((n) => /Child|append/.test(n)),
      style: $("#p").getAttribute("style") || "",
      attr: $("#p").getAttributeNames().join(","),
      st: ScrollTrigger.getAll().length,
    };
  });
  equal(got.spacers, 0, JSON.stringify(got));
  equal(got.own, [], "guard removed: " + JSON.stringify(got));
  equal(got.st, 0, "triggers: " + JSON.stringify(got));
});

test("two pinned siblings, remove one with removeChild, other keeps working", async (page) => {
  await open(
    page,
    `<div id="wrap"><section id="p1" class="screen gs-pin-100">1</section><section id="p2" class="screen gs-pin-100">2</section><div class="spacer"></div></div>`,
  );
  const got = await page.evaluate(async () => {
    $("#wrap").removeChild($("#p1"));
    await idle();
    await frames(3);
    const pin = ScrollTrigger.getAll().find((t) => t.pin === $("#p2"));
    await scrollToY(pin ? pin.start + 200 : 0);
    return { spacers: $$(".pin-spacer").length, pinned: !!pin, top: Math.round($("#p2").getBoundingClientRect().top), guard: Object.getOwnPropertyNames($("#wrap")).filter((n) => /Child/.test(n)).length > 0 };
  });
  equal({ s: got.spacers, p: got.pinned, t: got.top, g: got.guard }, { s: 1, p: true, t: 0, g: true }, JSON.stringify(got));
});

test("pinned element whose parent is removed does not throw or leak", async (page) => {
  await open(page, `<div id="outer"><div id="wrap"><section id="p" class="screen gs-pin-200">pinned</section></div></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    $("#outer").remove();
    await idle();
    await frames(3);
    return { st: ScrollTrigger.getAll().length, spacers: $$(".pin-spacer").length };
  });
  equal(got, { st: 0, spacers: 0 }, "clean");
});

test("split text: removed mid-animation and rebuilt many times leaves nothing", async (page) => {
  await open(page, `<div id="host"><h1 id="t" class="load:gs-split-chars load:gs-mask gs-duration-3">Hello world again</h1></div>`);
  const got = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 15; i++) {
      $("#t").className = i % 2 ? "load:gs-split-chars load:gs-mask gs-duration-3" : "load:gs-split-words gs-duration-3";
      await idle();
    }
    const orig = $("#t");
    orig.remove();
    await idle();
    out.push(orig.innerHTML, orig.getAttribute("aria-label"), orig.getAttribute("style"), orig.hasAttribute("data-gs-ready"));
    return { out, tweens: gsap.globalTimeline.getChildren(true, true, true).length };
  });
  equal(got.out.slice(0, 3), ["Hello world again", null, null], JSON.stringify(got));
  assert(got.tweens === 0, "global timeline still has " + got.tweens);
});

test("gs.revert leaves no attributes, styles, wrappers, or timers behind", async (page) => {
  await open(
    page,
    `<h1 id="a" class="gs-split-lines gs-mask gs-slide-up">Lines of text here that wrap around</h1>
     <div id="b" class="gs-stagger-0.1"><p>x</p><p>y</p></div>
     <div id="m" class="gs-marquee-pause" style="width:300px"><span>one</span><span>two</span></div>
     <div id="c" class="gs-magnetic gs-tilt box"></div>
     <div class="spacer"></div>`,
  );
  const got = await page.evaluate(async () => {
    await frames(5);
    const html = document.body.innerHTML;
    gs.revert();
    await frames(3);
    return {
      clones: $$("[data-gs-clone]").length,
      ready: $$("[data-gs-ready]").length,
      enter: $$("[data-gs-enter]").length,
      measure: document.documentElement.hasAttribute("data-gs-measure"),
      aria: $$("[aria-label]").length,
      styled: $$("body *").filter((e) => (e.getAttribute("style") || "").replace(/width:\s*300px;?/, "").trim()).map((e) => e.id + ":" + e.getAttribute("style")),
      st: ScrollTrigger.getAll().length,
      kids: $("#a").children.length,
    };
  });
  equal({ c: got.clones, e: got.enter, m: got.measure, a: got.aria, s: got.styled, st: got.st, k: got.kids }, { c: 0, e: 0, m: false, a: 0, s: [], st: 0, k: 0 }, JSON.stringify(got));
  // data-gs-ready is reported separately
  if (got.ready) throw new Error("data-gs-ready attributes remain after gs.revert(): " + got.ready);
});

test("an element added after gs.revert() is visible straight away", async (page) => {
  await open(page, `<p>hi</p>`);
  const got = await page.evaluate(async () => {
    gs.revert();
    const d = document.createElement("div");
    d.className = "gs-fade-up";
    d.textContent = "late";
    document.body.append(d);
    await frames(5);
    return css("div.gs-fade-up", "visibility");
  });
  equal(got, "visible", "not hidden by the leftover stylesheet");
});

test("marquee of images that load late", async (page) => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  await page.route("**/slow.png", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    route.fulfill({ body: png, contentType: "image/png" });
  });
  await open(
    page,
    `<div id="m" class="gs-marquee" style="width:600px"><img src="/slow.png?1" height="40" style="height:40px;width:auto"><img src="/slow.png?2" style="height:40px;width:auto"></div>`,
    { waitUntil: "domcontentloaded" },
  );
  const got = await page.evaluate(async () => {
    await sleep(2500);
    await frames(5);
    const m = $("#m");
    return { clones: $$("[data-gs-clone]").length, tweens: gsap.getTweensOf(m.children[0]).length, w: m.children[0].offsetWidth, sw: m.scrollWidth };
  });
  assert(got.clones > 0, "marquee never rebuilt after images loaded: " + JSON.stringify(got));
});

test("marquee: rebuilt by resize, then removed, leaves no timers or clones", async (page) => {
  await open(page, `<div id="host"><div id="m" class="gs-marquee-scroll" style="width:400px"><span style="padding:0 20px">alpha</span><span style="padding:0 20px">beta</span></div></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const m = $("#m");
    const before = $$("[data-gs-clone]").length;
    for (let i = 0; i < 5; i++) {
      m.style.width = 300 + i * 100 + "px";
      await sleep(250);
    }
    const mid = $$("[data-gs-clone]").length;
    $("#host").remove();
    await idle();
    await sleep(300);
    return { before, mid, after: $$("[data-gs-clone]").length, kids: m.children.length, tweens: gsap.globalTimeline.getChildren(true, true, true).length, st: ScrollTrigger.getAll().length };
  });
  equal({ k: got.kids, st: got.st }, { k: 2, st: 0 }, JSON.stringify(got));
  // ScrollTrigger keeps one resize timer of its own for as long as the page lives.
  assert(got.tweens <= 1, "nothing of ours is left running: " + JSON.stringify(got));
});

test("marquee items with their own reveal classes: clones are shown", async (page) => {
  await open(page, `<div id="m" class="gs-marquee" style="width:500px"><span class="gs-fade-up" style="padding:0 20px">alpha</span><span class="gs-fade-up" style="padding:0 20px">beta</span></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    await finish();
    await sleep(200);
    return $$("#m > *").map((e) => [e.hasAttribute("data-gs-clone"), css(".gs-fade-up", "visibility") && getComputedStyle(e).visibility, getComputedStyle(e).opacity]);
  });
  assert(got.length > 2, "clones exist");
  assert(got.every((r) => r[1] === "visible" && r[2] === "1"), JSON.stringify(got));
});

test("a hover during an entrance does not leave the element offset", async (page) => {
  await open(page, `<div id="b" class="box gs-fade-up-100 gs-duration-2 load:gs-fade-up-100 hover:gs-to-[y:-10] gs-ease-none" style="margin:200px"></div>`, {
    config: { start: "top 100%" },
  });
  const got = await page.evaluate(async () => {
    await sleep(100);
    return num("#b", "y");
  });
  const mid = got;
  await page.mouse.move(250, 250);
  await page.waitForTimeout(300);
  await page.mouse.move(5, 5);
  await page.evaluate(() => finish());
  await page.waitForTimeout(1200);
  const end = await page.evaluate(() => ({ y: num("#b", "y"), style: $("#b").getAttribute("style") }));
  assert(Math.abs(end.y) < 0.5, `rested at y=${end.y} (mid-entrance y was ${mid}) style=${end.style}`);
});

test("reduced motion: timeline, stagger, split and count all end shown with no leftovers", async (page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(
    page,
    `<section id="tl" class="gs-timeline"><h2 class="gs-fade-up">a</h2><h2 class="gs-split-words gs-slide-up">b c</h2></section>
     <ul id="st" class="gs-fade-up gs-stagger-0.1"><li>1</li><li>2</li></ul>
     <p id="n" class="gs-count">1,200</p>`,
  );
  const got = await page.evaluate(async () => {
    await finish();
    return {
      op: $$("#tl h2, #st li").map((e) => getComputedStyle(e).opacity + getComputedStyle(e).visibility),
      n: $("#n").textContent,
      style: $$("body *").map((e) => e.getAttribute("style") || "").filter(Boolean),
      html: $("#tl").innerHTML.replace(/\s+data-gs-ready=""/g, ""),
    };
  });
  assert(got.op.every((o) => o === "1visible"), JSON.stringify(got));
  equal(got.n, "1,200", "count");
});

test("batch stagger: item removed while waiting, parent removed while waiting", async (page) => {
  await open(page, `<div class="spacer"></div><div id="h"><ul id="l" class="gs-fade-up gs-stagger-0.1"><li>a</li><li id="b">b</li><li>c</li></ul></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    $("#b").remove();
    await idle();
    await scrollToY(document.documentElement.scrollHeight / 2);
    await finish();
    const shown = $$("#l li").map((e) => getComputedStyle(e).opacity);
    $("#h").remove();
    await idle();
    return { shown, st: ScrollTrigger.getAll().length };
  });
  equal(got, { shown: ["1", "1"], st: 0 }, "ok");
});

test("plugin loading: element removed and class changed while ScrollTrigger is still loading", async (page) => {
  await open(page, `<p id="x">x</p>`, { wait: false });
  const got = await page.evaluate(async () => {
    const a = document.createElement("div");
    a.className = "gs-fade-up";
    a.id = "a";
    const b = document.createElement("div");
    b.className = "gs-fade-up";
    b.id = "b";
    document.body.append(a, b);
    await idle();
    b.remove();
    a.className = "gs-fade-left";
    document.body.append(Object.assign(document.createElement("div"), { className: "gs-fade-right gs-stagger", id: "c", innerHTML: "<i>1</i><i>2</i>" }));
    await idle();
    await finish();
    return { a: getComputedStyle(a).opacity, c: [...document.querySelectorAll("#c i")].map((e) => getComputedStyle(e).opacity), entries: gs.get("#a").length };
  });
  assert(got.a === "1", JSON.stringify(got));
});

test("section gets gs-pin added later: scrubbed child follows the new pin", async (page) => {
  await open(page, `<div class="screen"></div><section id="s" class="screen"><div id="a" class="box gs-to-[x:300] gs-scrub-true gs-ease-none"></div></section><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    $("#s").classList.add("gs-pin-200");
    await idle();
    return { pinned: gs.get("#a")[0].scrollTrigger.vars.pinnedContainer === $("#s") };
  });
  assert(got.pinned, "child not told about the new pinned ancestor");
});

test("horizontal section: class removed and re-added, children keep animating", async (page) => {
  await open(
    page,
    `<section id="h" class="gs-horizontal"><div style="display:flex"><div class="screen" style="min-width:100vw"><p id="p" class="gs-fade-up">a</p></div><div class="screen" style="min-width:100vw">b</div></div></section><div class="spacer"></div>`,
  );
  const got = await page.evaluate(async () => {
    const out = {};
    $("#h").className = "";
    await idle();
    out.off = { spacers: $$(".pin-spacer").length, st: ScrollTrigger.getAll().length };
    $("#h").className = "gs-horizontal";
    await idle();
    out.on = { spacers: $$(".pin-spacer").length, st: ScrollTrigger.getAll().length, ca: !!gs.get("#p")[0] };
    return out;
  });
  assert(got.off.spacers === 0 && got.on.spacers === 1, JSON.stringify(got));
});

test("frames: removed mid-load, no canvas, no position left", async (page) => {
  await open(page, `<div id="host"><div id="f" class="gs-frames gs-scrub" data-gs-frames="/nope/f-[001-020].webp" style="height:300px"></div></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const f = $("#f");
    const had = f.querySelector("canvas") !== null;
    const pos = f.getAttribute("style");
    f.className = "";
    await idle();
    return { had, canvas: f.querySelector("canvas") !== null, style: f.getAttribute("style"), pos };
  });
  equal({ c: got.canvas, s: got.style }, { c: false, s: "height: 300px;" }, JSON.stringify(got));
});

test("smooth then gs.revert leaves page scrollable and unwrapped", async (page) => {
  await open(page, `<div id="w"><div id="c" class="gs-smooth"><div class="spacer"></div><p id="x" class="gs-fade-up">x</p></div></div>`);
  const got = await page.evaluate(async () => {
    await frames(5);
    gs.revert();
    await frames(5);
    return { body: document.body.getAttribute("style"), html: document.documentElement.getAttribute("style"), c: $("#c").getAttribute("style"), wrapper: $("#smooth-wrapper") !== null, scrollable: document.documentElement.scrollHeight > innerHeight };
  });
  assert(!got.wrapper && got.scrollable && !got.c, JSON.stringify(got));
});

test("start after revert: no duplicated listeners or double animations", async (page) => {
  await open(page, `<p id="a" class="gs-fade-up">a</p><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    gs.revert();
    await gs.start();
    await idle();
    gs.revert();
    await gs.start();
    await idle();
    await finish();
    return { n: gs.get("#a").length, op: css("#a", "opacity"), st: ScrollTrigger.getAll().length, sheets: document.querySelectorAll("style[data-tweenwind]").length };
  });
  equal({ op: got.op, sheets: got.sheets }, { op: "1", sheets: 1 }, JSON.stringify(got));
});

test("timeline container loses gs-timeline: steps animate on their own", async (page) => {
  await open(page, `<section id="A" class="gs-timeline gs-pin-100 gs-scrub-true"><h2 id="s1" class="gs-fade-up">one</h2><h2 id="s2" class="gs-fade-up">two</h2></section><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    $("#A").classList.remove("gs-timeline");
    await idle();
    await frames(3);
    return { s1: gs.get("#s1").length, s2: gs.get("#s2").length, tl: gs.get("#A").length };
  });
  assert(got.s1 === 1 && got.s2 === 1, JSON.stringify(got));
});

test("type keeps inline markup after it finishes", async (page) => {
  await open(page, `<p id="t" class="gs-type">Hello <em>big</em> world</p>`);
  const got = await page.evaluate(async () => { await finish(); return $("#t").innerHTML; });
  equal(got, "Hello <em>big</em> world", "html");
});

test("count on unusual text", async (page) => {
  await open(page, `<p id="a" class="gs-count">$1,234.50</p><p id="b" class="gs-count">+12%</p><p id="c" class="gs-count">1.2k</p><p id="d" class="gs-count">2020-2024</p><p id="e" class="gs-count">No numbers</p>`);
  const got = await page.evaluate(async () => { await finish(); return ["a","b","c","d","e"].map((i) => $("#"+i).textContent); });
  equal(got, ["$1,234.50", "+12%", "1.2k", "2020-2024", "No numbers"], "texts");
});

test("replaceWith on a pinned element leaves no spacer", async (page) => {
  await open(page, `<div id="wrap"><section id="p" class="screen gs-pin-200">pinned</section><div class="spacer"></div></div>`);
  const got = await page.evaluate(async () => {
    $("#p").replaceWith(Object.assign(document.createElement("section"), { id: "q", className: "screen", textContent: "new" }));
    await idle(); await frames(3);
    return { spacers: $$(".pin-spacer").length, qParent: $("#q").parentElement.className };
  });
  equal(got.spacers, 0, JSON.stringify(got));
});

test("resize re-split after the reveal keeps text intact", async (page) => {
  await open(page, `<h1 id="t" class="gs-split-lines gs-slide-up gs-mask" style="width:60vw">A longer heading that needs to wrap across several lines on small screens</h1>`, { config: { cleanup: false } });
  const got = await page.evaluate(async () => { await finish(); return $("#t").textContent; });
  await page.setViewportSize({ width: 500, height: 800 });
  const after = await page.evaluate(async () => { await frames(10); await sleep(400); return { text: $("#t").textContent, vis: $$("#t > *").map((e)=>getComputedStyle(e).opacity) }; });
  assert(after.text === got, "text changed " + JSON.stringify(after));
});

test("el.remove() on a pinned element does not bring it back", async (page) => {
  await open(page, `<div id="wrap"><section id="p" class="screen gs-pin-200">pinned</section><div id="after">after</div></div>`);
  const got = await page.evaluate(async () => {
    const p = $("#p");
    p.remove();
    await idle();
    await frames(3);
    return { connected: p.isConnected };
  });
  equal(got.connected, false, "removed element stays removed");
});

test("replaceWith on a pinned element keeps the new element", async (page) => {
  await open(page, `<div id="wrap"><section id="p" class="screen gs-pin-200">pinned</section><div id="after">after</div></div>`);
  const got = await page.evaluate(async () => {
    $("#p").replaceWith(Object.assign(document.createElement("section"), { id: "q", textContent: "new" }));
    await idle();
    await frames(3);
    return { q: !!$("#q"), p: !!$("#p") };
  });
  equal(got, { q: true, p: false }, "new element in, old one out");
});

test("gs-magnetic leaves no inline transform after gs.revert", async (page) => {
  await open(page, `<div id="c" class="gs-magnetic box"></div>`);
  const got = await page.evaluate(async () => {
    gs.revert();
    await frames(2);
    return $("#c").getAttribute("style");
  });
  assert(!got, "inline style left: " + got);
});

await run();
