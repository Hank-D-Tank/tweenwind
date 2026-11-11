import { assert, equal, near, open, run, test } from "./harness.mjs";

// The odometer under copying: a clone made mid-roll, and the text around a rolling number.
// From the third independent test round on 2026-11-10, kept as regression tests.

test("a copy of an odometer taken half way through its roll ends as plain text, like the original", async (page) => {
  await open(page, `<p style="font:40px Helvetica"><span id="o" class="load:gs-odometer load:gs-duration-3">1,500</span></p>`);
  const r = await page.evaluate(async () => {
    await sleep(500);
    const c = $("#o").cloneNode(true); c.id = "c"; $("#o").after(c);
    await idle(); await finish(); await sleep(300);
    return { c: $("#c").innerHTML.length > 20 ? "wheels left: " + $$("#c [data-gs-odometer]").length + " holders, shows " + $("#c").getBoundingClientRect().width : $("#c").innerHTML, o: $("#o").innerHTML };
  });
  equal(r, { c: "1,500", o: "1,500" }, "both plain");
});

test("selecting or copying text next to a rolling odometer does not include the wheel digits", async (page) => {
  await open(page, `<p id="p" style="font:40px Helvetica">Total <span id="o" class="load:gs-odometer load:gs-duration-4">1,500</span> dollars</p>`);
  const r = await page.evaluate(async () => {
    await sleep(300);
    const s = getSelection(); s.selectAllChildren($("#p"));
    return s.toString().replace(/\s+/g, " ");
  });
  equal(r, "Total 1,500 dollars", "copied text");
});

await run();
