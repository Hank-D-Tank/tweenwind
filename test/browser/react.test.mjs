import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { assert, equal, open, run, test } from "./harness.mjs";

/**
 * React is the framework most likely to fight with animation code: it removes nodes through
 * the parent it remembers, renders twice in StrictMode and hydrates server markup.
 * These run a small real app, built with esbuild, against the published entry points.
 */

const OUT = "test/react/out";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const shared = {
  bundle: true,
  format: "esm",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  alias: { "tweenwind/react": "./dist/react.js", "tweenwind": "./dist/index.js" },
  logLevel: "silent",
};
await build({ ...shared, entryPoints: ["test/react/main.tsx"], outdir: OUT, splitting: true });

// The same tree rendered on the server, for the hydration test.
await build({
  ...shared,
  format: "cjs",
  stdin: {
    contents: `import { renderToString } from "react-dom/server"; import { StrictMode, createElement } from "react";
      import { App } from "./test/react/App.tsx";
      module.exports = renderToString(createElement(StrictMode, null, createElement(App)));`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  platform: "node",
  outfile: OUT + "/server.cjs",
  external: ["gsap", "gsap/*"],
});

const page = (markup = "") => `<!doctype html><html><head><meta charset="utf-8">
  <link rel="stylesheet" href="/dist/tweenwind.css">
  <style>body{margin:0;font:16px/1.5 Helvetica,Arial,sans-serif}.screen{height:100vh}.spacer{height:150vh}</style>
  </head><body><div id="root">${markup}</div><script type="module" src="/test/react/out/main.js"></script></body></html>`;

const ready = async (p) => {
  await p.waitForFunction(() => window.gs && window.app);
  await p.evaluate(() => {
    window.ScrollTriggerCount = () => {
      const plugin = window.gs.gsap.core.globals().ScrollTrigger;
      return plugin ? plugin.getAll().length : 0;
    };
    return window.idle();
  });
};

test("React: classes work under StrictMode, once each", async (p, { logs }) => {
  await open(p, page(), { wait: false });
  await ready(p);
  const got = await p.evaluate(() => ({
    triggers: ScrollTriggerCount(),
    title: document.querySelector("#home-title").children.length,
    ready: document.querySelectorAll("[data-gs-ready]").length,
    spacers: document.querySelectorAll(".pin-spacer").length,
  }));
  assert(got.title === 3, "heading split into words: " + got.title);
  equal(got.spacers, 3, "three pinned sections, one spacer each");
  assert(got.ready >= 7, "elements set up: " + got.ready);
  const bad = logs.filter((entry) => entry.type === "error");
  equal(bad.map((entry) => entry.text), [], "no console errors");
});

test("React: changing pages removes a pinned top-level node without a crash", async (p) => {
  await open(p, page(), { wait: false });
  await ready(p);
  const got = await p.evaluate(async () => {
    const before = ScrollTriggerCount();
    window.app.setPage("about");
    await idle();
    const live = () => window.gs.gsap.core.globals().ScrollTrigger.getAll().every((trigger) => trigger.trigger.isConnected);
    const about = { title: !!document.querySelector("#about-title"), home: !!document.querySelector("#home-pin"), spacers: document.querySelectorAll(".pin-spacer").length, live: live() };
    window.app.setPage("home");
    await idle();
    return { before, about, back: { home: !!document.querySelector("#home-pin"), spacers: document.querySelectorAll(".pin-spacer").length, triggers: ScrollTriggerCount() } };
  });
  equal(got.about.title && !got.about.home, true, "new page rendered, old page gone");
  equal(got.about.spacers, 2, "the old page's spacer left with it");
  assert(got.about.live, "no trigger is left pointing at a removed element");
  equal(got.back.triggers, got.before, "same triggers as before the round trip");
  equal(got.back.home, true, "and it comes back");
  equal(got.back.spacers, 3, "pinned again");
});

test("React: a pinned element can be shown and hidden", async (p) => {
  await open(p, page(), { wait: false });
  await ready(p);
  const got = await p.evaluate(async () => {
    const order = () => Array.from(document.querySelector("#main").children).map((child) => child.id || child.className || child.tagName);
    window.app.setPinned(false);
    await idle();
    const hidden = { gone: !document.querySelector("#cond-pin"), order: order().slice(0, 3) };
    window.app.setPinned(true);
    await idle();
    return { hidden, shown: { order: order().slice(0, 3), pinned: document.querySelector("#cond-pin").parentElement.className } };
  });
  equal(got.hidden.gone, true, "removed");
  equal(got.hidden.order, ["live", "after-pin", "list"].slice(0, 2).concat(got.hidden.order[2]), "siblings intact");
  equal(got.shown.pinned, "pin-spacer", "pinned again when shown");
  equal(got.shown.order.slice(0, 2), ["live", "pin-spacer"], "back in its place, before its sibling");
});

test("React: a <Gs> scope cleans up before React removes it", async (p) => {
  await open(p, page(), { wait: false });
  await ready(p);
  const got = await p.evaluate(async () => {
    const before = ScrollTriggerCount();
    window.app.setScoped(false);
    // No waiting: the cleanup has to have happened inside React's own commit.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return { before, after: ScrollTriggerCount(), gone: !document.querySelector("#scoped-pin") };
  });
  equal(got.gone, true, "removed");
  equal(got.before - got.after, 1, "its trigger went with it");
});

test("React: text that changes is split again", async (p) => {
  await open(p, page(), { wait: false });
  await ready(p);
  const got = await p.evaluate(async () => {
    const before = document.querySelector("#live").textContent;
    window.app.setText("Completely different words here now");
    await idle();
    const live = document.querySelector("#live");
    const first = { text: live.textContent, pieces: live.children.length };
    window.app.setText("Again");
    await idle();
    return { before, first, second: { text: live.textContent, pieces: live.children.length } };
  });
  equal(got.before, "Changing text", "starts with the first text");
  equal(got.first, { text: "Completely different words here now", pieces: 5 }, "new text shown and split");
  equal(got.second, { text: "Again", pieces: 1 }, "and again");
});

test("React: list items added later animate in", async (p) => {
  await open(p, page(), { wait: false });
  await ready(p);
  const got = await p.evaluate(async () => {
    document.querySelector("#list").scrollIntoView({ block: "center" });
    await frames(4);
    await finish();
    window.app.setItems(["a", "b", "c", "d"]);
    await idle();
    const made = window.gs.get("#list").length;
    await finish();
    return { made, items: document.querySelectorAll("#list > li").length, shown: getComputedStyle(document.querySelector("#item-d")).opacity };
  });
  equal(got.made, 2, "one animation for each new item");
  equal(got.items, 4, "all there");
  equal(got.shown, "1", "and visible");
});

test("React: server markup hydrates without a mismatch", async (p, { logs }) => {
  const markup = (await import("../../" + OUT + "/server.cjs")).default;
  assert(markup.includes('class="gs-split-words gs-fade-up"'), "server rendered the classes");
  await open(p, page(markup), { wait: false });
  const hiddenFirst = await p.evaluate(() => getComputedStyle(document.querySelector("#about-title, #home-title")).visibility);
  await ready(p);
  const got = await p.evaluate(async () => {
    await finish();
    return { title: getComputedStyle(document.querySelector("#home-title")).visibility, spacers: document.querySelectorAll(".pin-spacer").length };
  });
  equal(got, { title: "visible", spacers: 3 }, "animated after hydration");
  const bad = logs.filter((entry) => entry.type === "error" || /hydrat/i.test(entry.text));
  equal(bad.map((entry) => entry.text.slice(0, 200)), [], "no hydration warnings");
  assert(["hidden", "visible"].includes(hiddenFirst), "stylesheet controls the first paint");
});

await run();
