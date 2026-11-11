import { assert, equal, near, open, run, test } from "./harness.mjs";

// Found by reading the source: numbers in text, click-outside, marquees, scrolling rows, memory, and what a hover may not undo.
// From the second independent test round on 2026-11-10, kept as regression tests.

test("gs-count keeps a comma that follows the number (Since 1999, we)", async (page) => {
  await open(page, `<div class="spacer"></div><p id="a" class="gs-count gs-scrub-true gs-ease-none" style="margin:0">Since 1999, we grew</p><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const t = $("#a").getBoundingClientRect().top + scrollY;
    const tr = gs.get("#a")[0].scrollTrigger;
    await scrollToY(tr.end + 5);
    await frames(3);
    return $("#a").textContent;
  });
  equal(got, "Since 1999, we grew", "text as written once the count is done");
});

test("gs-count does not overwrite a number the page updated in place before it plays", async (page) => {
  await open(page, `<div class="spacer"></div><p id="a" class="gs-count" style="margin:0">100</p><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    $("#a").firstChild.nodeValue = "999"; // what React does for a single text child
    await frames(3);
    await scrollToY($("#a").getBoundingClientRect().top + scrollY - 300);
    await finish();
    await frames(5);
    return $("#a").textContent;
  });
  equal(got, "999", "shows the new number");
});

test("click:gs-outside does not close when the click lands on something the page removes", async (page) => {
  await open(page, `<button id="b" aria-expanded="false">open</button>
    <div id="m" class="click:gs-fade-down click:gs-trigger-[#b] click:gs-outside" style="width:100px;height:100px;background:#ccc"><button id="x">remove me</button><button id="y">other</button></div>`);
  const got = await page.evaluate(async () => {
    $("#x").addEventListener("click", () => $("#x").remove());
    $("#b").click();
    await finish();
    const opened = $("#b").getAttribute("aria-expanded");
    $("#x").click();
    await frames(2);
    return { opened, after: $("#b").getAttribute("aria-expanded") };
  });
  equal(got, { opened: "true", after: "true" }, "menu stays open on a click inside it");
});

test("gs-marquee fills the row for a very small item on a wide row", async (page) => {
  await page.setViewportSize({ width: 3000, height: 600 });
  await open(page, `<div id="m" class="gs-marquee" style="width:3000px"><span style="width:40px;display:block">*</span></div>`);
  const got = await page.evaluate(async () => {
    await sleep(500);
    const m = $("#m").getBoundingClientRect();
    const right = Math.max(...Array.from($("#m").children).map((c) => c.getBoundingClientRect().right));
    const left = Math.min(...Array.from($("#m").children).map((c) => c.getBoundingClientRect().left));
    return { n: $("#m").children.length, right, left, W: m.right };
  });
  assert(got.right >= got.W - 1, "content reaches the right edge: " + JSON.stringify(got));
});

test("gs-marquee keeps running the right way when dir flips to rtl after load", async (page) => {
  await open(page, `<div id="m" class="gs-marquee-100" style="width:600px"><span style="width:200px;display:block">A</span><span style="width:200px;display:block">B</span></div>`);
  const got = await page.evaluate(async () => {
    document.documentElement.dir = "rtl";
    await sleep(1500);
    const m = $("#m").getBoundingClientRect();
    const kids = Array.from($("#m").children).map((c) => c.getBoundingClientRect());
    const gaps = [];
    for (let x = m.left; x < m.right; x += 5) if (!kids.some((r) => r.left <= x && r.right > x)) gaps.push(x);
    return { gaps: gaps.length };
  });
  equal(got.gaps, 0, "no empty stretch in the row");
});

test("gs-marquee in a page that is rtl from the start has no gaps", async (page) => {
  await open(page, `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><script>window.gsConfig={cdn:"/node_modules/gsap/dist/"}</script><script src="/dist/tweenwind.js"></script></head><body style="margin:0"><div id="m" class="gs-marquee-100" style="width:600px"><span style="width:200px;display:block">A</span><span style="width:200px;display:block">B</span></div></body></html>`);
  const got = await page.evaluate(async () => {
    await sleep(1500);
    const m = $("#m").getBoundingClientRect();
    const kids = Array.from($("#m").children).map((c) => c.getBoundingClientRect());
    let gaps = 0;
    for (let x = m.left; x < m.right; x += 5) if (!kids.some((r) => r.left <= x && r.right > x)) gaps++;
    return { gaps };
  });
  equal(got.gaps, 0, "no gaps");
});

test("a reveal inside an overflow-x:auto row far below the fold waits for the page to scroll to it", async (page) => {
  await open(
    page,
    `<div style="height:1500px"></div><div id="row" style="overflow-x:auto;height:100px;width:300px;white-space:nowrap"><div id="c1" class="gs-fade-up" style="display:inline-block;width:200px;height:100px">1</div><div id="c2" class="gs-fade-up" style="display:inline-block;width:200px;height:100px">2</div></div><div style="height:1500px"></div>`,
  );
  const got = await page.evaluate(async () => {
    await sleep(400);
    await finish();
    return { c1: css("#c1", "opacity"), c2: css("#c2", "opacity"), scrollY: scrollY };
  });
  equal(got, { c1: "0", c2: "0", scrollY: 0 }, "nothing has revealed while the row is still off screen");
});

test("removed children of a gs-stagger list are released", async (page, { context }) => {
  await open(page, `<ul id="l" class="gs-stagger gs-fade-up" style="margin:0;padding:0"><li>seed</li></ul>`);
  await page.evaluate(async () => {
    window.refs = [];
    for (let i = 0; i < 40; i++) {
      const li = document.createElement("li");
      li.textContent = "item" + i;
      $("#l").appendChild(li);
      window.refs.push(new WeakRef(li));
      await frames(2);
      await finish();
      $("#l").removeChild(li);
      await frames(2);
    }
  });
  const cdp = await context.newCDPSession(page);
  for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage");
  const alive = await page.evaluate(() => window.refs.filter((r) => r.deref()).length);
  assert(alive < 5, "removed list items still referenced after gc: " + alive + " of 40");
});

test("a load: animation on a child of a gs-stagger parent leaves no inline style behind", async (page) => {
  await open(page, `<ul id="l" class="gs-stagger gs-fade-up"><li id="a" class="load:gs-fade-down">a</li><li id="b">b</li></ul>`);
  const got = await page.evaluate(async () => {
    await finish();
    await finish();
    return $("#a").getAttribute("style");
  });
  equal(got, null, "style attribute after everything has finished");
});

test("gs.revert() hands a gs-horizontal track back without inline transform styles", async (page) => {
  await open(page, `<section id="hz" class="gs-horizontal"><div id="track"><div style="width:100vw;flex:none">1</div><div style="width:100vw;flex:none">2</div></div></section><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    await sleep(200);
    gs.revert();
    await sleep(200);
    return { track: $("#track").getAttribute("style"), section: $("#hz").getAttribute("style") };
  });
  equal(got, { track: null, section: null }, "no inline styles left after revert");
});

test("gs.revert() leaves no empty style attribute on a pinned section", async (page) => {
  await open(page, `<section id="pin" class="screen gs-pin"><i>p</i></section><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    await sleep(200);
    gs.revert();
    await sleep(200);
    return $("#pin").getAttribute("style");
  });
  equal(got, null, "style attribute after revert");
});

test("a hover that ends does not undo where gs-parallax put the element", async (page) => {
  await open(page, `<div style="height:100px"></div><div id="a" class="box gs-parallax-50 hover:gs-to-[rotate:10]" style="margin:0"></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    await scrollToY(300);
    await frames(3);
    const before = num("#a", "yPercent");
    $("#a").dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await finish();
    $("#a").dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" }));
    await finish();
    await frames(3);
    return { before, after: num("#a", "yPercent") };
  });
  equal(got.after, got.before, "scroll position did not change, so neither should the parallax offset");
});

test("parallax alone keeps its offset", async (page) => {
  await open(page, `<div style="height:100px"></div><div id="a" class="box gs-parallax-50" style="margin:0"></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    await scrollToY(300);
    await frames(3);
    const before = num("#a", "yPercent");
    await finish();
    await frames(3);
    return { before, after: num("#a", "yPercent") };
  });
  equal(got.after, got.before, "stable");
});

test("card with gs-fade-up and a to-only hover ends a hover back where it was (not 40px lower)", async (page) => {
  await open(page, `<div id="a" class="box gs-fade-up hover:gs-to-[scale:1.1]" style="margin:50px"></div>`);
  const got = await page.evaluate(async () => {
    await finish();
    const settled = css("#a", "transform");
    $("#a").dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await finish();
    $("#a").dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" }));
    await finish();
    return { settled, after: css("#a", "transform"), style: $("#a").getAttribute("style") };
  });
  equal(got, { settled: "none", after: "none", style: "margin:50px" }, "same as before the hover");
});

test("a hover that ends does not reset what gs-scrub moved", async (page) => {
  await open(page, `<div style="height:100px"></div><div id="a" class="box gs-to-[x:300] gs-scrub-true gs-ease-none hover:gs-to-[scale:1.1]" style="margin:0"></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const tr = gs.get("#a")[0].scrollTrigger;
    await scrollToY((tr.start + tr.end) / 2);
    await frames(3);
    const before = num("#a", "x");
    $("#a").dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await finish();
    $("#a").dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" }));
    await finish();
    await frames(3);
    return { before, after: num("#a", "x") };
  });
  equal(got.after, got.before, "x at the same scroll position");
});

await run();
