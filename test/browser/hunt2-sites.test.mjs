import { assert, equal, near, run, test } from "./harness.mjs";

// Found by building real pages: details, sorted lists, smooth scrolling switched on and off, rebuilds after a reveal.
// From the second independent test round on 2026-11-10, kept as regression tests.

test("a reveal inside a closed <details> waits until the details is opened", async (page) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.route("**/case.html", (r) => r.fulfill({ contentType: "text/html", body: "" }));
  const { open } = await import("./harness.mjs");
  await open(page, `<div style="height:300px"></div><details id="d"><summary>Q</summary><p id="p" class="gs-fade-up">Answer</p></details><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    await finish(); await frames(3);
    const closedOpacity = css("#p", "opacity");
    const style = $("#p").getAttribute("style");
    $("#d").open = true; await frames(2);
    const justOpened = Number(css("#p", "opacity"));
    return { closedOpacity, style, justOpened };
  });
  assert(got.justOpened < 0.9, "the answer should be fading in right after opening, was " + JSON.stringify(got));
});

test("re-sorting a staggered list lets the rows now on screen play", async (page) => {
  const { open } = await import("./harness.mjs");
  await open(page, `<ul id="l" class="gs-stagger-0.05 gs-fade-up" style="list-style:none;margin:0;padding:0">${Array.from({length:14},(_, i)=>`<li id="r${i}" style="height:100px">Row ${i}</li>`).join("")}</ul>`);
  const got = await page.evaluate(async () => {
    await finish();
    const l = $("#l");
    l.insertBefore(l.lastElementChild, l.firstElementChild);
    await frames(4); await finish(); await frames(3);
    const r = $("#r13").getBoundingClientRect();
    return { top: r.top, opacity: css("#r13", "opacity") };
  });
  assert(got.top >= 0 && got.top < 600, "row is on screen " + JSON.stringify(got));
  equal(got.opacity, "1", "row that was moved into view plays");
});

test("a played hover-element is not left displaced after crossing an md: breakpoint and back", async (page) => {
  const { open } = await import("./harness.mjs");
  await open(page, `<a id="cta" href="#" class="gs-fade-up md:gs-fade-left hover:gs-to-[y:-4]" style="display:inline-block;margin:20px">Buy</a><div class="spacer"></div>`);
  await page.evaluate(() => finish());
  const log = [];
  for (const w of [600, 1200]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(700);
    log.push([w, await page.evaluate(() => [num("#cta", "x"), num("#cta", "y"), css("#cta", "opacity"), $("#cta").getAttribute("style")])]);
  }
  const last = log[1][1];
  equal(last[0], 0, "x back to its natural place, log " + JSON.stringify(log));
});

test("gs.refresh() leaves a played reveal+hover element displaced by its start offset", async (page) => {
  const { open } = await import("./harness.mjs");
  await open(page, `<a id="cta" href="#" class="gs-fade-up hover:gs-to-[y:-4]" style="display:inline-block;margin:20px">Buy</a><div class="spacer"></div>`);
  await page.evaluate(() => finish());
  const before = await page.evaluate(() => num("#cta", "y"));
  await page.evaluate(async () => { gs.refresh(); await frames(5); await finish(); });
  const after = await page.evaluate(() => [num("#cta", "y"), $("#cta").getAttribute("style")]);
  equal(before, 0, "natural before");
  equal(after[0], 0, "still natural after refresh, style " + after[1]);
});

test("removing gs-smooth hands the page back (no stale body height, wrapper styles) and re-adding does not grow the page", async (page) => {
  const { open } = await import("./harness.mjs");
  await open(page, `<div id="w" class="gs-smooth"><p class="gs-fade-up" style="margin:0;padding:40px">a</p><div style="height:2000px"></div><p class="gs-fade-up">end</p></div>`);
  const out = await page.evaluate(async () => {
    const r = { H0: document.documentElement.scrollHeight };
    $("#w").classList.remove("gs-smooth"); await frames(8); await sleep(300);
    r.bodyStyle = document.body.getAttribute("style"); r.wrapStyle = $("#w").getAttribute("style"); r.H1 = document.documentElement.scrollHeight;
    $("#w").classList.add("gs-smooth"); await frames(8); await sleep(300);
    r.H2 = document.documentElement.scrollHeight;
    return r;
  });
  equal(out.bodyStyle, null, "body style attribute after removing gs-smooth: " + JSON.stringify(out));
  equal(out.H2, out.H0, "page height after toggling off and on: " + JSON.stringify(out));
});
test("switching gs-smooth on does not nest an extra pin spacer around gs-horizontal (page grows by a screen)", async (page) => {
  const { open } = await import("./harness.mjs");
  await open(page, `<div id="w"><div style="height:200px"></div><section id="h" class="gs-horizontal"><div style="display:flex;width:max-content"><div style="width:90vw;height:100vh">1</div><div style="width:90vw;height:100vh">2</div></div></section><div style="height:2000px"></div></div>`);
  const out = await page.evaluate(async () => {
    const before = [document.documentElement.scrollHeight, $$(".pin-spacer").length];
    $("#w").classList.add("gs-smooth"); await frames(8); await sleep(300);
    return { before, after: [document.documentElement.scrollHeight, $$(".pin-spacer").length] };
  });
  equal(out.after, out.before, "height and spacer count unchanged");
});
await run();
