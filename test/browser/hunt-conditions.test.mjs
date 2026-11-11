import { assert, equal, open, run, test } from "./harness.mjs";

const loads = async (page, body, head = "") => {
  page.setDefaultNavigationTimeout(6000);
  await open(page, body, { head });
};

// Awkward pages: hidden elements, right-to-left, scrolling containers, transformed parents.
// Found by an independent flaw hunt on 2026-11-10 and kept as regression tests.

test("split text inside a display:none ancestor loads fine", async (page) => {
  await loads(page, `<div style="display:none"><p class="gs-split-words gs-fade-up">a b c</p></div>`);
});

test("split text on an element hidden by a CSS class loads fine", async (page) => {
  await loads(page, `<p class="hid gs-split-words gs-fade-up">a b c</p>`, `<style>.hid{display:none}</style>`);
});

test("gs-pin inside a display:none ancestor loads fine", async (page) => {
  await loads(page, `<div style="display:none"><section class="gs-pin-100 gs-scrub-0">p</section></div><div class="spacer"></div>`);
});

test("gs-horizontal inside a display:none ancestor loads fine", async (page) => {
  await loads(page, `<div style="display:none"><section class="gs-horizontal"><div style="display:flex;width:300vw"><div style="width:100vw">1</div></div></section></div>`);
});

test("gs-scroll-to arrives when html has scroll-behavior: smooth", async (page) => {
  await open(page, `<a id="l" class="gs-scroll-to" href="#t">go</a><div class="spacer"></div><div id="t" class="box">t</div><div class="spacer"></div>`, { head: `<style>html{scroll-behavior:smooth}</style>` });
  const y = await page.evaluate(async () => { $("#l").click(); await sleep(4000); return { y: scrollY, want: $("#t").offsetTop }; });
  assert(Math.abs(y.y - y.want) < 5, JSON.stringify(y));
});

test("CSS translate, scale and rotate still work after a reveal, and nothing inline is left", async (page) => {
  await open(page, `<style>.t{scale:1.1}.t:hover{scale:1.4}</style><div id="a" class="box t gs-fade-up">a</div>`);
  await page.evaluate(() => finish());
  await page.hover("#a");
  await page.waitForTimeout(200);
  const got = await page.evaluate(() => ({ style: $("#a").getAttribute("style") || "", scale: css("#a", "scale") }));
  equal(got, { style: "", scale: "1.4" }, "no inline style left; hover scale applies");
});

test("gs-marquee moves in a right-to-left page", async (page) => {
  await open(page, `<div class="gs-marquee" id="m" style="overflow:hidden"><span style="padding:0 20px;white-space:nowrap">aaa aaa aaa</span><span style="padding:0 20px">bbb</span></div>`, { head: `<style>html{direction:rtl}</style>` });
  const got = await page.evaluate(async () => { await sleep(400); const f = () => $("#m").firstElementChild.getBoundingClientRect().left; const a = f(); await sleep(1000); return { a, b: f(), n: $$("#m > *").length }; });
  assert(got.a !== got.b, JSON.stringify(got));
});

test("gs-marquee in a right-to-left row makes a sensible number of copies", async (page) => {
  await open(page, `<div class="gs-marquee" id="m" dir="rtl" style="overflow:hidden"><span>aaa</span><span>bbb</span></div>`);
  const n = await page.evaluate(async () => { await sleep(800); return $$("#m > *").length; });
  assert(n < 200, "children: " + n);
});

test("gs-horizontal in a right-to-left page ends on its last panel", async (page) => {
  await open(page, `<div class="screen"></div><section class="gs-horizontal gs-scrub-0"><div style="display:flex;width:300vw"><div id="p1" class="screen" style="width:100vw">1</div><div id="p2" class="screen" style="width:100vw">2</div><div id="p3" class="screen" style="width:100vw">3</div></div></section><div class="spacer"></div>`, { head: `<style>html{direction:rtl}</style>` });
  const left = await page.evaluate(async () => { scrollTo(0, 3200); await sleep(1000); return Math.round($("#p3").getBoundingClientRect().left); });
  assert(left === 0, "at the end of the section the last panel should fill the screen, its left is " + left);
});

test("gs-pin holds inside a transformed ancestor", async (page) => {
  await open(page, `<div class="screen"></div><div style="transform:translateZ(0)"><section id="p" class="gs-pin-100 gs-scrub-0 screen">p</section></div><div class="spacer"></div>`);
  const tops = await page.evaluate(async () => { const r = []; for (const y of [900, 1100, 1500]) { await scrollToY(y); r.push(Math.round($("#p").getBoundingClientRect().top)); } return r; });
  equal(tops, [0, 0, 0], "pinned section top while pinned");
});

test("scrub works inside a scrolling div or app shell without any option", async (page) => {
  await open(page, `<div id="app" style="position:fixed;inset:0;overflow:auto"><div class="screen"></div><div id="b" class="box gs-to-[x:300] gs-scrub-0"></div><div style="height:150vh"></div></div>`);
  const x = await page.evaluate(async () => { $("#app").scrollTop = 900; await sleep(1200); return num("#b", "x"); });
  assert(x > 0, "x after scrolling the app div: " + x);
});

await run();
