import { assert, equal, near, open, run, test } from "./harness.mjs";

/** A page script that makes a short image sequence in memory and answers /frames/NNN.png from it. */
const FRAME_ROUTE = async (page, count = 12) => {
  await page.route("**/frames/*.png", async (route) => {
    const index = Number(/(\d+)\.png/.exec(route.request().url())[1]);
    // A 1x1 PNG whose red channel encodes the frame number.
    const png = await page.evaluate((value) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 4;
      const context = canvas.getContext("2d");
      context.fillStyle = `rgb(${value * 20}, 0, 0)`;
      context.fillRect(0, 0, 4, 4);
      return canvas.toDataURL("image/png").split(",")[1];
    }, index);
    await route.fulfill({ body: Buffer.from(png, "base64"), contentType: "image/png" });
  });
  return count;
};

test("count runs up to the number in the text", async (page) => {
  await open(page, `<p><span id="a" class="gs-count">12,500</span> <span id="b" class="gs-count">$4.75m</span> <span id="c" class="gs-count-90">99%</span></p>`);
  const start = await page.evaluate(() => {
    ["#a", "#b", "#c"].forEach((id) => gs.get(id)[0].pause(0));
    return ["#a", "#b", "#c"].map((id) => $(id).textContent);
  });
  equal(start, ["0", "$0.00m", "90%"], "start values keep the format");
  const end = await page.evaluate(async () => {
    ["#a", "#b", "#c"].forEach((id) => gs.get(id)[0].play());
    await finish();
    return { text: ["#a", "#b", "#c"].map((id) => $(id).textContent), numeric: css("#a", "fontVariantNumeric") };
  });
  equal(end.text, ["12,500", "$4.75m", "99%"], "end values");
  equal(end.numeric, "tabular-nums", "digits keep one width");
});

test("marquee fills the row with copies and keeps moving", async (page) => {
  await open(page, `<div id="m" class="gs-marquee gs-marquee-200" style="width:900px;gap:40px"><span style="width:120px">one</span><span style="width:120px">two</span></div>`);
  const got = await page.evaluate(async () => {
    await frames(2);
    const items = $$("#m > *");
    const clones = $$("#m > [data-gs-clone]");
    const x1 = num("#m > :first-child", "x");
    await sleep(300);
    const x2 = num("#m > :first-child", "x");
    return {
      items: items.length,
      clones: clones.length,
      hidden: clones.every((clone) => clone.getAttribute("aria-hidden") === "true"),
      moved: x1 - x2,
      row: css("#m", "display") + "/" + css("#m", "overflowX"),
      width: items.reduce((sum, item) => sum + item.offsetWidth + 40, 0),
    };
  });
  equal(got.row, "flex/hidden", "laid out as a clipped row");
  assert(got.width >= 900 + 320, "copies cover the row plus one set: " + got.width);
  assert(got.hidden, "copies are hidden from screen readers");
  near(got.moved, 60, 25, "moves left at about 200px a second");
});

test("marquee to the right, paused on hover, rebuilt when its content changes", async (page) => {
  await open(page, `<div style="padding:40px"><div id="m" class="gs-marquee gs-marquee-right gs-marquee-pause" style="width:600px"><span style="width:150px">one</span><span style="width:150px">two</span></div></div>`);
  const right = await page.evaluate(async () => {
    const x1 = num("#m > :first-child", "x");
    await sleep(200);
    return num("#m > :first-child", "x") - x1;
  });
  assert(right > 5, "moves right: " + right);
  await page.hover("#m");
  const paused = await page.evaluate(async () => {
    await sleep(700);
    const x1 = num("#m > :first-child", "x");
    await sleep(200);
    return Math.abs(num("#m > :first-child", "x") - x1);
  });
  assert(paused < 1, "stops under the pointer: " + paused);
  const rebuilt = await page.evaluate(async () => {
    const before = $$("#m > *").length;
    const extra = document.createElement("span");
    extra.style.width = "150px";
    extra.textContent = "three";
    $("#m").insertBefore(extra, $("#m > [data-gs-clone]"));
    await sleep(300);
    return { before, after: $$("#m > *").length, originals: $$("#m > :not([data-gs-clone])").length };
  });
  equal(rebuilt.originals, 3, "new item counted as an original");
  assert(rebuilt.after > rebuilt.before, "copies rebuilt around it");
});

test("magnetic leans toward the pointer and springs back", async (page) => {
  await open(page, `<div style="padding:200px"><button id="a" class="gs-magnetic-0.5" style="width:200px;height:80px">Hi</button></div>`);
  await page.mouse.move(300, 240);
  await page.mouse.move(380, 250, { steps: 3 });
  const leaning = await page.evaluate(async () => {
    await finish();
    return { x: num("#a", "x"), y: num("#a", "y") };
  });
  near(leaning.x, 40, 3, "half the pointer's distance from the centre, x");
  near(leaning.y, 5, 3, "and y");
  await page.mouse.move(5, 5);
  const rest = await page.evaluate(async () => {
    await finish();
    return { x: num("#a", "x"), y: num("#a", "y") };
  });
  near(rest.x, 0, 0.5, "back to rest");
});

test("tilt turns toward the pointer", async (page) => {
  await open(page, `<div style="padding:200px"><div id="a" class="box gs-tilt-20" style="width:200px;height:200px"></div></div>`);
  await page.mouse.move(210, 210);
  await page.mouse.move(390, 300, { steps: 2 });
  const got = await page.evaluate(async () => {
    await finish();
    return { rx: num("#a", "rotationX"), ry: num("#a", "rotationY") };
  });
  near(got.ry, 18, 1.5, "turned toward the right edge");
  near(got.rx, 0, 1.5, "level top to bottom at mid height");
});

test("parallax drifts with the scroll and covers its frame", async (page) => {
  const img = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='teal'/%3E%3C/svg%3E`;
  await open(page, `<div class="screen"></div><div id="frame" style="width:400px;height:300px;overflow:hidden"><img id="a" class="gs-parallax-20 gs-scrub-true" src="${img}" style="width:100%;height:100%;display:block"></div><div id="b" class="box gs-parallax--10 gs-scrub-true"></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const trigger = gs.get("#a")[0].scrollTrigger;
    await scrollToY(trigger.start);
    const top = num("#a", "yPercent");
    await scrollToY((trigger.start + trigger.end) / 2);
    const mid = num("#a", "yPercent");
    await scrollToY(trigger.end);
    const bottom = num("#a", "yPercent");
    const rect = $("#a").getBoundingClientRect();
    const frame = $("#frame").getBoundingClientRect();
    return { top, mid, bottom, scale: num("#a", "scale"), triggerIsFrame: trigger.trigger === $("#frame"), covers: rect.top <= frame.top + 0.5 && rect.bottom >= frame.bottom - 0.5, b: gs.get("#b")[0].scrollTrigger.trigger === $("#b") };
  });
  near(got.top, -20, 0.5, "starts high");
  near(got.mid, 0, 0.5, "centred half way");
  near(got.bottom, 20, 0.5, "ends low");
  near(got.scale, 1.4, 0.001, "zoomed enough to cover");
  assert(got.triggerIsFrame, "an image is timed by its frame");
  assert(got.covers, "no gap at the end of its travel");
  assert(got.b, "other elements are timed by themselves");
});

test("frames draws the sequence on scroll", async (page) => {
  await FRAME_ROUTE(page);
  await open(page, `<div class="screen"></div><canvas id="a" class="gs-frames gs-scrub-true" data-gs-frames="/frames/[01-12].png" style="width:300px;height:200px"></canvas><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const pixel = () => $("#a").getContext("2d").getImageData(10, 10, 1, 1).data[0];
    const trigger = gs.get("#a")[0].scrollTrigger;
    $("#a").scrollIntoView();
    await sleep(500);
    await scrollToY(trigger.start);
    await frames(2);
    const first = pixel();
    await scrollToY(trigger.end);
    await frames(2);
    const last = pixel();
    await scrollToY(trigger.start + (trigger.end - trigger.start) * 0.5);
    await frames(2);
    return { first, last, mid: pixel(), size: [$("#a").width, $("#a").height], dpr: devicePixelRatio };
  });
  equal(got.first, 20, "first frame at the start");
  equal(got.last, 240, "last frame at the end");
  assert(got.mid === 120 || got.mid === 140, "a middle frame half way: " + got.mid);
  equal(got.size, [300 * got.dpr, 200 * got.dpr], "canvas sized for the screen");
});

test("frames makes its own canvas inside any element", async (page) => {
  await FRAME_ROUTE(page);
  await open(page, `<div id="a" class="gs-frames-[/frames/[01-06].png]" style="width:300px;height:200px"><p>caption</p></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    await sleep(400);
    const canvas = $("#a > canvas");
    const made = { canvas: !!canvas, position: css("#a", "position"), kept: $("#a > p").textContent };
    gs.revert();
    return { made, after: { canvas: !!$("#a > canvas"), position: $("#a").style.position } };
  });
  equal(got.made, { canvas: true, position: "relative", kept: "caption" }, "canvas added, content kept");
  equal(got.after, { canvas: false, position: "" }, "removed on revert");
});

test("scroll-to glides to its target and respects scroll-margin", async (page) => {
  await open(page, `<a id="go" href="#target" class="gs-scroll-to gs-duration-0.3">Go</a><div class="spacer"></div><h2 id="target" style="scroll-margin-top:80px">Target</h2><div class="spacer"></div>`);
  await page.click("#go");
  const got = await page.evaluate(async () => {
    await finish();
    await frames(2);
    return { top: $("#target").getBoundingClientRect().top, hash: location.hash };
  });
  near(got.top, 80, 2, "target sits below the margin");
  equal(got.hash, "#target", "address bar updated");
});

test("replay and reverse", async (page) => {
  await open(page, `<div class="spacer"></div><div id="a" class="box gs-fade-up gs-replay"></div><div id="b" class="box gs-fade-up gs-reverse"></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    $("#a").scrollIntoView({ block: "center" });
    await frames(3);
    await finish();
    const shown = [css("#a", "opacity"), css("#b", "opacity")];
    await scrollToY(0);
    await frames(2);
    await finish();
    const hidden = [css("#a", "opacity"), css("#b", "opacity")];
    $("#a").scrollIntoView({ block: "center" });
    await frames(3);
    await finish();
    return { shown, hidden, again: [css("#a", "opacity"), css("#b", "opacity")] };
  });
  equal(got, { shown: ["1", "1"], hidden: ["0", "0"], again: ["1", "1"] }, "plays each time");
});

test("scramble, type and draw end on the original content", async (page) => {
  await open(
    page,
    `<h2 id="s" class="gs-scramble">Scrambled headline</h2><p id="t" class="gs-type">Typed out.</p>
     <svg id="d" class="gs-draw" width="200" height="100" viewBox="0 0 200 100" fill="none" stroke="#000" stroke-width="4"><path id="path" d="M10 90 L190 10"/><circle cx="100" cy="50" r="20"/></svg>`,
  );
  const start = await page.evaluate(() => {
    ["#s", "#t", "#d"].forEach((id) => gs.get(id)[0].pause(0));
    gs.get("#s")[0].progress(0.3);
    return { typed: $("#t").textContent, dash: css("#path", "strokeDasharray"), scrambled: $("#s").textContent };
  });
  equal(start.typed, "", "typing starts empty");
  assert(start.dash !== "none", "stroke starts undrawn: " + start.dash);
  assert(start.scrambled !== "Scrambled headline" && start.scrambled.length > 0, "text is scrambled mid way: " + start.scrambled);
  const end = await page.evaluate(async () => {
    ["#s", "#t", "#d"].forEach((id) => gs.get(id)[0] && gs.get(id)[0].play());
    await finish();
    await finish();
    return { s: $("#s").textContent, t: $("#t").textContent, dash: $("#path").getAttribute("style") || "" };
  });
  equal(end.s, "Scrambled headline", "scramble settles");
  equal(end.t, "Typed out.", "typing completes");
  equal(end.dash, "", "stroke styles removed");
});

test("smooth scrolling wraps the content and removes itself on revert", async (page) => {
  await open(page, `<main id="content" class="gs-smooth"><div class="spacer"></div><div id="a" class="box gs-to-[x:300] gs-scrub"></div><div class="spacer"></div></main>`);
  const got = await page.evaluate(async () => {
    await frames(3);
    const smoother = ScrollSmoother.get();
    const made = { on: !!smoother, wrapper: $("#content").parentElement.className, scrub: gs.get("#a")[0].scrollTrigger.vars.scrub };
    gs.revert();
    await frames(2);
    return { made, off: !ScrollSmoother.get() };
  });
  equal(got.made, { on: true, wrapper: "ScrollSmoother-wrapper", scrub: true }, "smoother made, scrub no longer smoothed twice");
  assert(got.off, "smoother removed");
});

test("split text survives its content being replaced from outside", async (page) => {
  await open(page, `<h1 id="t" class="gs-split-words gs-fade-up gs-replay">First text here</h1>`);
  const got = await page.evaluate(async () => {
    await frames(2);
    const before = $("#t").children.length;
    $("#t").textContent = "Brand new words now showing";
    await frames(3);
    const during = { pieces: $("#t").children.length, text: $("#t").textContent, label: $("#t").getAttribute("aria-label") };
    gs.revert();
    return { before, during, after: $("#t").innerHTML };
  });
  equal(got.before, 3, "split at first");
  equal(got.during, { pieces: 5, text: "Brand new words now showing", label: "Brand new words now showing" }, "re-split on the new text");
  equal(got.after, "Brand new words now showing", "revert keeps the new text");
});

test("custom eases load CustomEase", async (page) => {
  await open(page, `<div id="a" class="box gs-to-[x:100] gs-ease-[0.7,0,0.3,1]"></div><div id="b" class="box gs-to-[x:100] gs-ease-[cubic-bezier(.7,0,.3,1)]"></div>`);
  const got = await page.evaluate(() => {
    const ease = gs.get("#a")[0].getChildren()[0].vars.ease;
    return { type: typeof ease, mid: typeof ease === "function" ? ease(0.5) : null, start: typeof ease === "function" ? ease(0.1) : null, same: ease === gs.get("#b")[0].getChildren()[0].vars.ease || typeof gs.get("#b")[0].getChildren()[0].vars.ease };
  });
  equal(got.type, "function", "ease became a function");
  near(got.mid, 0.5, 0.01, "symmetric curve passes through the middle");
  assert(got.start < 0.05, "slow start: " + got.start);
});

test("toggle adds a class while the element is in range", async (page) => {
  await open(page, `<div class="spacer"></div><div id="a" class="box gs-toggle-[is-seen] gs-start-center gs-end-[bottom_top]"></div><div class="spacer"></div>`);
  const got = await page.evaluate(async () => {
    const before = $("#a").classList.contains("is-seen");
    $("#a").scrollIntoView({ block: "start" });
    await frames(4);
    const during = $("#a").classList.contains("is-seen");
    await scrollToY(0);
    await frames(3);
    return { before, during, after: $("#a").classList.contains("is-seen"), tracked: ScrollTrigger.getAll().length };
  });
  equal(got, { before: false, during: true, after: false, tracked: 1 }, "class follows the scroll, and adding it does not rebuild anything");
});

/** Where each wheel of an odometer stands, in cells of its strip (a calm roll has the digits 0 to 9, so the cell is the digit). */
const WHEELS = `(id) => Array.from(document.querySelectorAll(id + " [data-gs-odometer] > span:not([data-d])")).map((wheel) => {
  const strip = wheel.lastElementChild;
  const moved = /translateY\\((-?[\\d.]+)%\\)/.exec(strip.style.transform);
  return Math.round(((moved ? -parseFloat(moved[1]) : 0) / 100) * strip.children.length * 100) / 100;
})`;
/** The digits an odometer shows right now, as text. */
const DIGITS = `(id) => Array.from(document.querySelectorAll(id + " [data-gs-odometer] > span:not([data-d])")).map((wheel) => {
  const strip = wheel.lastElementChild;
  const moved = /translateY\\((-?[\\d.]+)%\\)/.exec(strip.style.transform);
  return strip.children[Math.round(((moved ? -parseFloat(moved[1]) : 0) / 100) * strip.children.length)].dataset.d;
}).join("")`;

test("odometer rolls every digit in its own mask and ends as plain text", async (page) => {
  await open(page, `<p style="font-size:60px;line-height:0.9"><span id="o" class="gs-odometer gs-ease-none">2,600</span></p>`);
  const start = await page.evaluate((wheels) => {
    const read = eval(wheels);
    gs.get("#o")[0].pause(0);
    const holder = $("#o [data-gs-odometer]");
    const wheel = holder.querySelector("span");
    return {
      shown: read("#o"),
      wheels: holder.querySelectorAll(":scope > span:not([data-d])").length,
      comma: holder.children[1].dataset.d,
      text: [holder.textContent, $("#o").textContent],
      mask: wheel.style.clipPath,
      overflow: getComputedStyle(wheel).overflow,
      cells: wheel.lastElementChild.children.length,
      hidden: holder.getAttribute("aria-hidden"),
      spoken: holder.nextElementSibling.textContent,
      numeric: css("#o", "fontVariantNumeric"),
    };
  }, WHEELS);
  equal(start.shown, [0, 0, 0, 0], "every wheel starts on 0");
  equal([start.wheels, start.comma], [4, ","], "four wheels, with the comma between them");
  equal(start.text, ["", "2,600"], "the digits are drawn, not written: the element's text is the number at all times");
  const room = /^inset\(-(0(?:\.\d+)?)em -0\.3em\)$/.exec(start.mask);
  assert(room && Number(room[1]) > 0 && Number(room[1]) <= 0.1, "each wheel's mask hugs the row of digits, with only the room this font needs: " + start.mask);
  equal(start.overflow, "visible", "a clip-path, not overflow, so the wheel stays on the text baseline");
  equal(start.cells, 11, "0 to 9 and 0 again, so a wheel can pass 9 without a jump");
  equal([start.hidden, start.spoken], ["true", "2,600"], "screen readers get the number once");
  equal(start.numeric, "tabular-nums", "digits keep one width");

  // One calm roll: every wheel turns forward to its digit. The ones add two full turns and the
  // tens one, so the right side moves faster, the way a counter does, without a blur.
  const quarter = await page.evaluate((wheels) => {
    const read = eval(wheels);
    gs.get("#o")[0].progress(0.25);
    return read("#o");
  }, WHEELS);
  near(quarter[0], 0.5, 0.02, "thousands: a quarter of the way from 0 to 2");
  near(quarter[1], 1.5, 0.02, "hundreds: a quarter of the way from 0 to 6");
  near(quarter[2], 2.5, 0.02, "tens: a quarter of one full turn");
  near(quarter[3], 5, 0.02, "ones: a quarter of two full turns");
  const half = await page.evaluate((wheels) => {
    const read = eval(wheels);
    gs.get("#o")[0].progress(0.5);
    return read("#o");
  }, WHEELS);
  equal(half, [1, 3, 5, 0], "half way every wheel is half way along its own path");

  const end = await page.evaluate(async () => {
    const before = $("#o").getBoundingClientRect();
    gs.get("#o")[0].progress(0.9999);
    const rolled = $("#o").getBoundingClientRect();
    gs.get("#o")[0].play();
    await finish();
    const after = $("#o").getBoundingClientRect();
    return {
      html: $("#o").innerHTML,
      same: Math.abs(before.width - after.width) < 0.5 && Math.abs(before.height - after.height) < 0.5 && Math.abs(rolled.width - after.width) < 0.5,
      style: $("#o").getAttribute("style"),
    };
  });
  equal(end.html, "2,600", "plain text again when it is done");
  assert(end.same, "and the number takes the same room as wheels and as plain text, so nothing jumps");
  equal(end.style, null, "no inline style left on it");
});

test("odometer keeps the markup around the number, decimals and a start value", async (page) => {
  await open(
    page,
    `<p id="m" class="gs-odometer">Over <b>40</b>+ sites</p><p><span id="d" class="gs-odometer gs-ease-none">6.5K</span></p><p><span id="s" class="gs-odometer-90 gs-ease-none">100%</span></p>`,
  );
  const start = await page.evaluate((wheels) => {
    const read = eval(wheels);
    ["#m", "#d", "#s"].forEach((id) => gs.get(id)[0].pause(0));
    return {
      bold: !!$("#m b [data-gs-odometer]"),
      around: [$("#m").firstChild.nodeValue, $("#m").lastChild.nodeValue],
      decimal: read("#d"),
      dot: $("#d [data-gs-odometer]").children[1].dataset.d,
      unit: $("#d [data-gs-odometer]").parentNode.lastChild.nodeValue,
      oneItem: $("#d").childNodes.length,
      ltr: getComputedStyle($("#d [data-gs-odometer]")).direction,
      from: read("#s"),
    };
  }, WHEELS);
  assert(start.bold, "the wheels sit inside the <b>, where the number was");
  equal(start.around, ["Over ", "+ sites"], "the words around it are untouched");
  equal([start.decimal, start.dot, start.unit], [[0, 0], ".", "K"], "6.5 is two wheels with a plain dot, and the K stays");
  equal([start.oneItem, start.ltr], [1, "ltr"], "one wrapper stands in for the text, and its digits always run left to right");
  equal(start.from, [0, 9, 0], "gs-odometer-90 starts at 090");
  const end = await page.evaluate(async () => {
    ["#m", "#d", "#s"].forEach((id) => gs.get(id)[0].play());
    await finish();
    return [$("#m").innerHTML, $("#d").innerHTML, $("#s").innerHTML];
  });
  equal(end, ["Over <b>40</b>+ sites", "6.5K", "100%"], "all back exactly as written");
});

test("odometer follows the scrollbar with gs-scrub, and starts over when the page changes the number", async (page) => {
  await open(
    page,
    `<div class="screen"></div><p style="height:100px"><span id="o" class="gs-odometer gs-scrub-true gs-ease-none gs-start-[top_bottom] gs-end-[top_top]">80</span></p><div class="spacer"></div>`,
  );
  const half = await page.evaluate(async (wheels) => {
    const read = eval(wheels);
    const trigger = gs.get("#o")[0].scrollTrigger;
    await scrollToY((trigger.start + trigger.end) / 2);
    return read("#o");
  }, WHEELS);
  near(half[0] * 10 + half[1], 40, 1.2, "half way through the scroll it shows about 40");
  const changed = await page.evaluate(async (wheels) => {
    const read = eval(wheels);
    $("#o").textContent = "300";
    await idle();
    const trigger = gs.get("#o")[0].scrollTrigger;
    await scrollToY(trigger.end);
    return { wheels: read("#o"), spoken: $("#o [data-gs-odometer] + span").textContent };
  }, WHEELS);
  equal(changed, { wheels: [3, 0, 0], spoken: "300" }, "the new number gets its own three wheels");
});

test("odometer with stops moves to each number, rests, and moves on, one digit at a time", async (page) => {
  await open(
    page,
    `<p style="font-size:60px"><span id="o" class="gs-odometer-[27,64,100] gs-ease-none">100</span></p><p><span id="auto" class="gs-odometer-steps gs-ease-none">100</span> <span id="three" class="gs-odometer-steps-3">100</span></p>`,
  );
  const got = await page.evaluate(([wheels, digits]) => {
    const read = eval(wheels);
    const shown = eval(digits);
    const at = (id, progress, reader = shown) => {
      gs.get(id)[0].pause().progress(progress);
      return reader(id);
    };
    return {
      strips: $$("#o [data-gs-odometer] > span").map((wheel) => Array.from(wheel.lastElementChild.children, (cell) => cell.dataset.d).join("")),
      start: at("#o", 0),
      rolling: at("#o", 0.28 / 3, read),
      rests: [at("#o", 0.9 / 3), at("#o", 1.9 / 3), at("#o", 1)],
      held: [at("#o", 0.75 / 3, read), at("#o", 0.99 / 3, read)],
      autoRests: [0.9, 1.9, 2.9, 4].map((step) => at("#auto", step / 4)),
      durations: [gs.get("#o")[0].duration(), gs.get("#auto")[0].duration(), gs.get("#three")[0].duration()],
    };
  }, [WHEELS, DIGITS]);
  equal(got.strips, ["01", "0260", "0740"], "each wheel holds just the digits it will rest on");
  equal(got.start, "000", "it starts on 000");
  near(got.rolling[2], 0.5, 0.02, "the ones are half way from 0 to 7, one cell away");
  near(got.rolling[1], 0.41, 0.02, "the tens set off a breath later");
  equal(got.rolling[0], 0, "and the hundreds have nowhere to go yet");
  equal(got.rests, ["027", "064", "100"], "it rests on 027, then 064, and ends on 100");
  equal(got.held, [[0, 1, 1], [0, 1, 1]], "and holds still for the rest of each step");
  equal(got.autoRests, ["024", "053", "071", "100"], "gs-odometer-steps picks four stops that do not look machine-made");
  equal(got.durations, [2.7, 3.6, 2.7], "each stop takes 0.9 seconds unless gs-duration says otherwise");
  const end = await page.evaluate(async () => {
    // Reaching the end above already counts as finished, so it may have been tidied by now.
    gs.get("#o").forEach((timeline) => timeline.play());
    await finish();
    return $("#o").innerHTML;
  });
  equal(end, "100", "plain text again at the end");
});

test("with reduced motion an odometer is simply the number", async (page, { context }) => {
  const calm = await context.newPage();
  await calm.emulateMedia({ reducedMotion: "reduce" });
  await open(calm, `<p><span id="o" class="gs-odometer">1,250</span> <span id="l" class="load:gs-odometer">77</span></p>`);
  const got = await calm.evaluate(() => [$("#o").innerHTML, $("#l").innerHTML, $$("[data-gs-odometer]").length]);
  equal(got, ["1,250", "77", 0], "no wheels are built at all");
  await calm.close();
});

await run();
