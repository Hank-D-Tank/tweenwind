import { ORIGIN, assert, equal, near, run, test } from "./harness.mjs";

/**
 * The example portfolio is a whole site made with nothing but class names, so it is the closest
 * thing to a real project the library has. These tests use it the way a visitor would.
 */

const URL = ORIGIN + "/examples/portfolio/";

async function visit(page, { settle = 5900 } = {}) {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate(() => gs.ready);
  await page.evaluate(() => document.fonts.ready);
  if (settle) await page.waitForTimeout(settle);
}

/** Scrolls the way a wheel does, in steps, and lets smoothing catch up. */
async function scrollTo(page, y, pause = 1500) {
  const from = await page.evaluate(() => window.scrollY);
  for (let step = 1; step <= 10; step++) {
    await page.evaluate((to) => window.scrollTo(0, to), from + ((y - from) * step) / 10);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(pause);
}

const topOf = (page, selector) => page.evaluate((s) => Math.round(document.querySelector(s).getBoundingClientRect().top + window.scrollY), selector);

test("portfolio: loads without errors, warnings or a sideways scrollbar", async (page, { logs }) => {
  await visit(page);
  const got = await page.evaluate(() => ({
    wide: document.documentElement.scrollWidth > window.innerWidth + 1,
    smooth: !!(window.ScrollSmoother && ScrollSmoother.get()),
    ownScripts: Array.from(document.scripts).filter((script) => !/gsap/i.test(script.src) || script.src.includes("tweenwind")).length,
    inline: Array.from(document.scripts).filter((script) => !script.src).length,
  }));
  equal(got.wide, false, "no sideways scroll");
  equal(got.smooth, true, "smooth scrolling is on");
  equal(got.ownScripts, 1, "the only script the page asks for is the library");
  equal(got.inline, 0, "and it has no inline JavaScript");
  equal(logs.filter((entry) => entry.type === "error" || entry.type === "warning").map((entry) => entry.text.slice(0, 160)), [], "console is quiet");
});

test("portfolio: the loader covers the page, rolls to 100 in three stops and lifts away", async (page) => {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  const early = await page.evaluate(() => {
    const loader = document.querySelector(".loader").getBoundingClientRect();
    return { covers: loader.top <= 0 && loader.bottom >= window.innerHeight, name: getComputedStyle(document.querySelector(".hero-name")).visibility };
  });
  equal(early, { covers: true, name: "hidden" }, "black screen first, and the name is hidden behind it");
  await page.evaluate(() => gs.ready);
  const counting = await page.evaluate(async () => {
    // The loader is an odometer: every digit is a wheel in its own mask. Read what the wheels show.
    const wheels = () => Array.from(document.querySelectorAll(".loader-count [data-gs-odometer] > span:not([data-d])"));
    const shown = () =>
      wheels()
        .map((wheel) => {
          const strip = wheel.lastElementChild;
          const moved = /translateY\((-?[\d.]+)%\)/.exec(strip.style.transform);
          const at = ((moved ? -parseFloat(moved[1]) : 0) / 100) * strip.children.length;
          // Between two digits it shows neither: mark it as moving.
          return Math.abs(at - Math.round(at)) < 0.02 ? strip.children[Math.round(at)].dataset.d : "~";
        })
        .join("");
    const first = wheels()[0];
    const frames = [];
    const end = performance.now() + 2850;
    while (performance.now() < end) {
      frames.push(shown());
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    // How many frames in a row it stood still on each number.
    const rests = {};
    let run = 0;
    frames.forEach((value, index) => {
      run = value === frames[index - 1] ? run + 1 : 1;
      if (!value.includes("~")) rests[value] = Math.max(rests[value] || 0, run);
    });
    const box = document.querySelector(".loader-count");
    return {
      wheels: wheels().length,
      masked: first ? first.style.clipPath : "",
      rests,
      moving: frames.filter((value) => value.includes("~")).length,
      last: shown(),
      spoken: box.querySelector("[data-gs-odometer] + span").textContent,
      hiddenFromReaders: box.querySelector("[data-gs-odometer]").getAttribute("aria-hidden"),
    };
  });
  equal(counting.wheels, 3, "one wheel for each digit of 100");
  assert(counting.masked.startsWith("inset("), "each wheel sits in its own mask: " + counting.masked);
  assert(counting.rests["032"] >= 10 && counting.rests["071"] >= 10, "it stops and rests on 032, then on 071: " + JSON.stringify(counting.rests));
  assert(counting.moving >= 30, "and rolls in between: " + counting.moving + " frames in motion");
  equal(counting.last, "100", "and ends on 100");
  equal([counting.spoken, counting.hiddenFromReaders], ["100", "true"], "screen readers get the number once, not the wheels");
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => ({
    gone: document.querySelector(".loader").getBoundingClientRect().bottom <= 1,
    name: document.querySelector(".hero-name").innerHTML,
    nav: getComputedStyle(document.querySelector(".nav")).opacity,
    lede: document.querySelector(".hero-lede").children.length,
  }));
  equal(after, { gone: true, name: "Joydeb Roy", nav: "1", lede: 0 }, "loader off screen, name revealed and back to plain text");
});

test("portfolio: masked letters are never cut while they reveal", async (page) => {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate(() => gs.ready);
  await page.evaluate(() => document.fonts.ready);
  const got = await page.evaluate(async () => {
    const name = document.querySelector(".hero-name");
    const unit = gs.get(name)[0];
    unit.pause();
    unit.progress(0.9999);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const masks = Array.from(name.querySelectorAll("*")).filter((node) => node.style.clipPath.startsWith("inset("));
    // Each letter's ink (measured with a range) has to sit inside its mask's clip box.
    let worst = 0;
    for (const mask of masks) {
      const box = mask.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(mask);
      const ink = range.getBoundingClientRect();
      const room = 0.16 * parseFloat(getComputedStyle(mask).fontSize);
      worst = Math.max(worst, box.left - room - ink.left, ink.right - (box.right + room));
    }
    const first = masks[0] ? getComputedStyle(masks[0]) : null;
    const splitLeft = masks.map((mask) => mask.firstElementChild.getBoundingClientRect().left);
    unit.progress(1);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const plainLeft = [];
    const text = name.firstChild;
    for (let i = 0; i < text.length; i++) {
      if (!text.data[i].trim()) continue;
      const range = document.createRange();
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      plainLeft.push(range.getBoundingClientRect().left);
    }
    const shift = Math.max(...splitLeft.map((left, index) => Math.abs(left - plainLeft[index])));
    return { masks: masks.length, worst, clip: masks[0] ? masks[0].style.clipPath : "", shift, html: name.innerHTML };
  });
  equal(got.masks, 9, "one mask per letter");
  assert(got.worst <= 0.5, "no letter reaches past its mask sideways: " + got.worst);
  equal(got.clip, "inset(-0.3em -0.16em)", "the mask has room around the letter for descenders and tight tracking");
  assert(got.shift < 0.6, "letters do not move when the split is undone: " + got.shift);
  equal(got.html, "Joydeb Roy", "plain text at the end");
});

test("portfolio: nav links glide to their sections", async (page) => {
  await visit(page);
  for (const id of ["work", "contact", "top"]) {
    await page.click(`.nav a[href="#${id}"]`);
    await page.waitForTimeout(2300);
    // A section may ask for room under the fixed nav (scroll-margin-top), and the glide gives it
    const got = await page.evaluate((id) => {
      const el = document.getElementById(id);
      return { top: Math.round(el.getBoundingClientRect().top), room: Math.round(parseFloat(getComputedStyle(el).scrollMarginTop) || 0) };
    }, id);
    near(got.top, got.room, 3, `#${id} lands at the top of the screen, with the room it asks for`);
  }
});

test("portfolio: the statement fills in as it is read and the numbers count", async (page) => {
  await visit(page);
  const top = await topOf(page, ".statement-text");
  await scrollTo(page, top - 760, 900);
  const before = await page.evaluate(() => {
    const words = Array.from(document.querySelectorAll(".statement-text > *"));
    return { words: words.length, last: Number(getComputedStyle(words[words.length - 1]).opacity) };
  });
  assert(before.words > 20, "split into words: " + before.words);
  near(before.last, 0.12, 0.03, "the last word is still faint");
  await scrollTo(page, top + 500, 2600);
  const after = await page.evaluate(() => ({
    faint: Array.from(document.querySelectorAll(".statement-text > *")).filter((word) => Number(getComputedStyle(word).opacity) < 0.99).length,
    stats: Array.from(document.querySelectorAll(".stats strong")).map((item) => item.textContent.trim()),
  }));
  equal(after.faint, 0, "every word is solid once it has scrolled past");
  equal(after.stats, ["40+", "6.5K", "2,600"], "numbers end exactly as written");
});

test("portfolio: project pictures reveal, drift and zoom on hover", async (page) => {
  await visit(page);
  const top = await topOf(page, ".project .project-media");
  await scrollTo(page, top - 300, 2200);
  const shown = await page.evaluate(() => {
    const media = document.querySelector(".project .project-media");
    const img = media.querySelector("img");
    const box = media.getBoundingClientRect();
    const inner = img.getBoundingClientRect();
    return {
      clip: getComputedStyle(media).clipPath,
      inline: media.style.clipPath,
      covers: inner.top <= box.top + 1 && inner.bottom >= box.bottom - 1 && inner.left <= box.left + 1 && inner.right >= box.right - 1,
      title: document.querySelector(".project .project-title").innerHTML,
    };
  });
  equal(shown.clip, "none", "the wipe is finished and removed");
  equal(shown.inline, "", "with no clip-path left on the element");
  assert(shown.covers, "the drifting image always covers its frame");
  equal(shown.title, "Zoom transition", "the title is plain text again");
  await page.hover(".project .project-media");
  await page.waitForTimeout(1100);
  near(await page.evaluate(() => Number(gsap.getProperty(".project .project-zoom", "scale"))), 1.04, 0.005, "zoomed in under the pointer");
  await page.mouse.move(5, 300);
  await page.waitForTimeout(1100);
  near(await page.evaluate(() => Number(gsap.getProperty(".project .project-zoom", "scale"))), 1, 0.005, "and back");
});

test("portfolio: the archive slides sideways and hands over to the pinned process scene", async (page) => {
  await visit(page);
  const got = await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const go = async (y) => {
      window.scrollTo(0, y);
      await wait(1500);
    };
    const archive = gs.get(".archive")[0].scrollTrigger;
    const process = gs.get(".process")[0].scrollTrigger;
    const track = document.querySelector(".archive-track");
    await go(archive.start + 2);
    const startX = Number(gsap.getProperty(track, "x"));
    await go(archive.end - 2);
    const more = document.querySelector(".archive-more").getBoundingClientRect();
    const endX = Number(gsap.getProperty(track, "x"));
    const tiles = document.querySelectorAll(".tile .tile-media");
    const lastTile = getComputedStyle(tiles[tiles.length - 1]).clipPath;

    await go(process.start + (process.end - process.start) * 0.5);
    const mid = {
      top: Math.round(document.querySelector(".process").getBoundingClientRect().top),
      bar: Number(gsap.getProperty(".process-bar i", "scaleX")),
      first: Number(getComputedStyle(document.querySelector(".step:nth-child(1) p")).opacity),
      last: Number(getComputedStyle(document.querySelector(".step:nth-child(3) p")).opacity),
    };
    await go(process.end - 2);
    const end = {
      bar: Number(gsap.getProperty(".process-bar i", "scaleX")),
      last: Number(getComputedStyle(document.querySelector(".step:nth-child(3) p")).opacity),
    };
    return {
      startX,
      endX,
      overflow: track.scrollWidth - window.innerWidth,
      moreRight: Math.round(more.right),
      lastTile,
      order: archive.end <= process.start,
      mid,
      end,
      contactAfter: document.querySelector(".contact").getBoundingClientRect().top > 0,
    };
  });
  near(got.startX, 0, 4, "the row starts at rest");
  near(got.endX, -got.overflow, 4, "and ends having moved by exactly its overflow");
  assert(got.moreRight <= 1441, "the last item is fully on screen at the end: " + got.moreRight);
  equal(got.lastTile, "none", "tiles revealed as they slid in");
  assert(got.order, "the pinned process scene starts after the archive ends");
  equal(got.mid.top, 0, "the process section is pinned");
  near(got.mid.bar, 0.5, 0.03, "its bar is half full half way through the pin");
  near(got.mid.first, 1, 0.01, "step one is in");
  assert(got.mid.last < 0.5, "step three is not in yet: " + got.mid.last);
  near(got.end.bar, 1, 0.01, "bar full at the end");
  near(got.end.last, 1, 0.02, "step three in at the end");
  assert(got.contactAfter, "the footer has not come up over the pinned scene");
});

test("portfolio: the footer reveals and the mail button leans to the pointer", async (page) => {
  await visit(page);
  await scrollTo(page, await page.evaluate(() => document.documentElement.scrollHeight), 2600);
  const got = await page.evaluate(() => ({
    title: document.querySelector(".contact-title").innerHTML,
    links: Array.from(document.querySelectorAll(".contact-links li")).map((item) => getComputedStyle(item).opacity),
    glow: Number(getComputedStyle(document.querySelector(".contact-glow")).opacity),
    fits: document.querySelector(".contact-title").getBoundingClientRect().right <= window.innerWidth,
  }));
  equal(got.title, "Let’s build it", "title is plain text after its reveal");
  equal(got.links, ["1", "1", "1"], "links in");
  near(got.glow, 1, 0.02, "glow fully up at the bottom of the page");
  assert(got.fits, "the big title fits the screen");
  const box = await page.locator(".contact-mail").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 10, { steps: 4 });
  await page.waitForTimeout(700);
  near(await page.evaluate(() => Number(gsap.getProperty(".contact-mail", "x"))), 14, 5, "it follows the pointer");
});

test("portfolio: on a phone the menu opens, closes on a link and on Escape", async (page, { context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page);
  const layout = await page.evaluate(() => ({
    wide: document.documentElement.scrollWidth > window.innerWidth + 1,
    toggle: getComputedStyle(document.querySelector(".nav-toggle")).display,
    links: getComputedStyle(document.querySelector(".nav-links")).display,
    menu: getComputedStyle(document.querySelector("#menu")).visibility,
    nameFits: document.querySelector(".hero-name").getBoundingClientRect().right <= window.innerWidth + 1,
  }));
  equal(layout, { wide: false, toggle: "block", links: "none", menu: "hidden", nameFits: true }, "phone layout");

  await page.click(".nav-toggle");
  await page.waitForTimeout(1300);
  const open = await page.evaluate(() => ({
    menu: getComputedStyle(document.querySelector("#menu")).visibility,
    links: Array.from(document.querySelectorAll(".menu-links a")).map((link) => getComputedStyle(link).opacity),
    expanded: document.querySelector(".nav-toggle").getAttribute("aria-expanded"),
  }));
  equal(open, { menu: "visible", links: ["1", "1", "1", "1"], expanded: "true" }, "menu open with its links");

  await page.click('.menu-links a[href="#contact"]');
  await page.waitForTimeout(2600);
  const afterLink = await page.evaluate(() => ({
    menu: getComputedStyle(document.querySelector("#menu")).visibility,
    expanded: document.querySelector(".nav-toggle").getAttribute("aria-expanded"),
    contactTop: Math.round(document.querySelector("#contact").getBoundingClientRect().top),
  }));
  equal(afterLink.menu, "hidden", "a link closes the menu");
  equal(afterLink.expanded, "false", "and the button says so");
  near(afterLink.contactTop, 0, 4, "and the page went to that section");

  await page.click(".nav-toggle");
  await page.waitForTimeout(900);
  await page.keyboard.press("Escape");
  // It closes by playing its opening backwards, so how long that takes depends on how far it had opened
  await page
    .waitForFunction(() => getComputedStyle(document.querySelector("#menu")).visibility === "hidden", null, { timeout: 5000 })
    .catch(() => {});
  const afterEscape = await page.evaluate(() => ({
    menu: getComputedStyle(document.querySelector("#menu")).visibility,
    focus: document.activeElement.className,
  }));
  equal(afterEscape.menu, "hidden", "Escape closes it");
  assert(afterEscape.focus.includes("nav-toggle"), "focus goes back to the button: " + afterEscape.focus);
});

test("portfolio: with reduced motion the page is simply there", async (page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await visit(page, { settle: 600 });
  const got = await page.evaluate(() => ({
    loaderGone: document.querySelector(".loader").getBoundingClientRect().bottom <= 1,
    count: document.querySelector(".loader-count").textContent.trim(),
    name: getComputedStyle(document.querySelector(".hero-name")).visibility,
    nav: getComputedStyle(document.querySelector(".nav")).opacity,
    smooth: !!(window.ScrollSmoother && ScrollSmoother.get()),
    marquee: document.querySelectorAll(".band-row [data-gs-clone]").length,
    hidden: Array.from(document.querySelectorAll("main [data-gs-ready]")).filter((el) => {
      if (el.closest(".process") || el.closest("#menu") || el.classList.contains("statement-text") || el.classList.contains("reel-frame") || el.classList.contains("contact-glow")) return false;
      const style = getComputedStyle(el);
      return style.visibility === "hidden" || style.opacity === "0";
    }).length,
  }));
  equal(got, { loaderGone: true, count: "100", name: "visible", nav: "1", smooth: false, marquee: 0, hidden: 0 }, "no waiting, no motion, nothing hidden");
});

test("portfolio: without JavaScript everything can still be read", async (page, { context }) => {
  const browser = context.browser();
  const plain = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1200, height: 800 } });
  const still = await plain.newPage();
  await still.goto(URL, { waitUntil: "load" });
  const hidden = await still.locator(".loader").evaluate((el) => getComputedStyle(el).display).catch(() => "?");
  const name = await still.locator(".hero-name").evaluate((el) => getComputedStyle(el).visibility);
  const title = await still.locator(".project-title").first().evaluate((el) => getComputedStyle(el).visibility);
  await plain.close();
  equal({ hidden, name, title }, { hidden: "none", name: "visible", title: "visible" }, "no loader, text visible");
});

test("portfolio: it stays light", async (page) => {
  const sizes = [];
  page.on("response", async (response) => {
    try {
      const url = response.url();
      if (!url.startsWith(ORIGIN)) return;
      sizes.push({ url: url.replace(ORIGIN, ""), bytes: (await response.body()).length });
    } catch {}
  });
  await visit(page, { settle: 1000 });
  await scrollTo(page, await page.evaluate(() => document.documentElement.scrollHeight), 800);
  const total = sizes.reduce((sum, item) => sum + item.bytes, 0);
  const images = sizes.filter((item) => /\.(webp|jpg|png|mp4)$/.test(item.url)).reduce((sum, item) => sum + item.bytes, 0);
  assert(total < 900 * 1024, `everything from this server is under 900 kB, got ${(total / 1024).toFixed(0)} kB`);
  assert(images < 400 * 1024, `images under 400 kB, got ${(images / 1024).toFixed(0)} kB`);
});

await run();
