import { ORIGIN, assert, equal, near, run, test } from "./harness.mjs";

/** The docs site is built with the library, so using it like a visitor is a good end-to-end check. */

const SITE = ORIGIN + "/";

async function visit(page, options = {}) {
  await page.goto(SITE, { waitUntil: "networkidle" });
  await page.evaluate(() => gs.ready);
  if (options.settle !== false) await page.waitForTimeout(2200);
}

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("site: loads clean and fits the window", async (page, { logs }) => {
  await visit(page);
  assert(await noSideScroll(page), "no sideways scrollbar on desktop");
  const got = await page.evaluate(() => ({
    title: document.querySelector(".hero-title").innerHTML,
    presets: document.querySelectorAll(".preset").length,
    examples: document.querySelectorAll(".pair").length,
    scripts: document.querySelectorAll('script[src*="gsap"]').length,
    codeScrollers: Array.from(document.querySelectorAll(".code, .editor")).filter((el) => el.scrollWidth > el.clientWidth + 1).length,
  }));
  equal(got.title, "GSAP animations, written as class names.", "the headline is plain text again after its reveal");
  equal(got.presets, 20, "preset cards");
  assert(got.examples >= 13, "examples built: " + got.examples);
  equal(got.codeScrollers, 0, "no code block scrolls sideways");
  const noise = logs.filter((entry) => entry.type === "error" || entry.type === "warning");
  equal(noise.map((entry) => entry.text.slice(0, 160)), [], "console is quiet");
});

test("site: only the plugins the page uses are loaded", async (page) => {
  await visit(page);
  const first = await page.evaluate(() => Array.from(document.scripts).map((script) => script.src.split("/").pop()).filter((name) => name.endsWith(".min.js")));
  for (const needed of ["gsap.min.js", "ScrollTrigger.min.js", "SplitText.min.js", "ScrollToPlugin.min.js"]) {
    assert(first.includes(needed), needed + " loaded: " + first.join(", "));
  }
  assert(!first.includes("ScrollSmoother.min.js"), "nothing asks for ScrollSmoother, so it is not fetched");
});

test("site: the playground runs what you type", async (page) => {
  await visit(page);
  const editor = page.locator(".editor");
  await editor.fill('<h3 id="typed" class="gs-to-[x:60] gs-duration-0.2">Typed in</h3>');
  await page.waitForTimeout(900);
  const got = await page.evaluate(() => ({
    text: document.querySelector("#typed") && document.querySelector("#typed").textContent,
    x: Number(gsap.getProperty("#typed", "x")),
  }));
  equal(got.text, "Typed in", "the result shows the new markup");
  near(got.x, 60, 0.5, "and the class on it ran");
  await page.click("[data-playground] .pane-bar button:has-text('Reset')");
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => document.querySelector("[data-playground] .stage").textContent.includes("Change a class")), "reset brings the starter back");
});

test("site: a preset card replays on click", async (page) => {
  await visit(page);
  await page.locator(".preset", { hasText: "gs-zoom-in" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1300);
  const card = page.locator(".preset", { hasText: "gs-zoom-in" });
  const settled = await card.evaluate((el) => getComputedStyle(el.querySelector(".preset-thing")).opacity);
  equal(settled, "1", "shown after its first run");
  await card.click();
  await page.waitForTimeout(120);
  const during = await card.evaluate((el) => Number(getComputedStyle(el.querySelector(".preset-thing")).opacity));
  assert(during < 1, "part way through again right after the click: " + during);
  await page.waitForTimeout(1200);
  equal(await card.evaluate((el) => getComputedStyle(el.querySelector(".preset-thing")).opacity), "1", "and finished again");
});

test("site: tabs, copy and the theme switch", async (page, { context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await visit(page);
  // The tabs fade in when they scroll into view, so go there first, like a reader would.
  await page.evaluate(() => document.querySelector("#start").scrollIntoView());
  await page.waitForTimeout(1200);
  await page.click("[data-tabs] button:has-text('npm')");
  assert((await page.textContent("[data-tabs] .code")).includes('import "tweenwind/auto";'), "npm tab shows the import");
  await page.click("[data-tabs] button:has-text('Script tag')");
  await page.click("[data-tabs] .pane-bar > button");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert(copied.includes('<script src="https://cdn.jsdelivr.net/npm/tweenwind"></script>'), "copied the real script tag: " + copied.slice(0, 80));
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click(".dm-theme-toggle");
  const after = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, cookie: document.cookie }));
  assert(after.theme !== before, "theme switched");
  assert(after.cookie.includes("dm_theme=" + after.theme), "and remembered in the shared cookie");
});

test("site: the menu example opens and closes", async (page) => {
  await visit(page);
  const button = page.locator("#menu-button");
  await button.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const closed = await page.evaluate(() => getComputedStyle(document.querySelector(".stage .menu")).visibility);
  await button.click();
  await page.waitForTimeout(900);
  const open = await page.evaluate(() => ({
    visibility: getComputedStyle(document.querySelector(".stage .menu")).visibility,
    links: Array.from(document.querySelectorAll(".stage .menu a")).map((link) => getComputedStyle(link).opacity),
    expanded: document.querySelector("#menu-button").getAttribute("aria-expanded"),
  }));
  await button.click();
  await page.waitForTimeout(900);
  const again = await page.evaluate(() => getComputedStyle(document.querySelector(".stage .menu")).visibility);
  equal(closed, "hidden", "starts closed");
  equal(open, { visibility: "visible", links: ["1", "1", "1"], expanded: "true" }, "opens with all three links");
  equal(again, "hidden", "closes again");
});

test("site: the scroll scenes do what their text says", async (page) => {
  await visit(page);
  const got = await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const go = async (y) => {
      window.scrollTo(0, y);
      await wait(900);
    };
    const scene = gs.get(".scene")[0].scrollTrigger;
    await go(scene.start + (scene.end - scene.start) * 0.99);
    const lines = Array.from(document.querySelectorAll(".scene-lines p")).map((line) => Number(getComputedStyle(line).opacity) > 0.9);
    const pinnedTop = Math.round(document.querySelector(".scene").getBoundingClientRect().top);

    const reel = gs.get(".reel")[0].scrollTrigger;
    await go(reel.end);
    const track = document.querySelector(".reel-track");
    const lastPanel = track.lastElementChild.getBoundingClientRect();
    await wait(900);
    const lastText = Number(getComputedStyle(track.lastElementChild.querySelector("h3")).opacity);

    const turn = gs.get(".turn")[0].scrollTrigger;
    const canvas = document.querySelector(".turn canvas");
    const pixel = () => Array.from(canvas.getContext("2d").getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data).join(",");
    await go(turn.start + 10);
    await wait(900);
    const first = pixel();
    await go(turn.start + (turn.end - turn.start) * 0.5);
    const middle = pixel();
    return { lines, pinnedTop, lastPanelLeft: Math.round(lastPanel.left), lastText, changed: first !== middle, drawn: first !== "0,0,0,0" };
  });
  equal(got.lines, [true, true, true], "all three lines are in by the end of the pinned scene");
  equal(got.pinnedTop, 0, "the scene is still pinned at that point");
  near(got.lastPanelLeft, 0, 2, "the sideways row ends with its last panel filling the screen");
  near(got.lastText, 1, 0.01, "and that panel's text has revealed");
  assert(got.drawn, "the canvas has an image");
  assert(got.changed, "and shows a different frame half way through");
});

test("site: fits a phone", async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page);
  assert(await noSideScroll(page), "no sideways scrollbar at 390px");
  const got = await page.evaluate(() => ({
    columns: getComputedStyle(document.querySelector(".presets")).gridTemplateColumns.split(" ").length,
    stacked: getComputedStyle(document.querySelector(".pair")).gridTemplateColumns.split(" ").length,
  }));
  equal(got, { columns: 2, stacked: 1 }, "cards in two columns, result above code");
});

test("site: with reduced motion the page is simply there", async (page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await visit(page, { settle: false });
  await page.waitForTimeout(400);
  const got = await page.evaluate(() => ({
    title: getComputedStyle(document.querySelector(".hero-title")).visibility,
    lede: getComputedStyle(document.querySelector(".hero-lede")).opacity,
    hidden: Array.from(document.querySelectorAll("main [data-gs-ready]")).filter((el) => {
      if (el.closest(".menu") || el.closest(".scene") || el.closest(".reel") || el.closest(".turn") || el.classList.contains("reading")) return false;
      const style = getComputedStyle(el);
      return style.visibility === "hidden" || style.opacity === "0";
    }).length,
    marquee: document.querySelectorAll(".marquee [data-gs-clone]").length,
  }));
  equal(got, { title: "visible", lede: "1", hidden: 0, marquee: 0 }, "everything visible at once, nothing looping");
});

await run();
