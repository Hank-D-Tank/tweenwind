/* The docs page's own script. It builds the examples from the <template> tags in the HTML,
   so each example is written once: the same markup is shown as code and run in the result box.
   Every animation on the page comes from the classes; nothing here calls GSAP. */

const PHOTOS = ["dunes", "alpine", "pool", "shallows", "red-room", "tree"];

const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Removes the indentation the HTML file gives a template. */
function dedent(text) {
  const lines = text.replace(/^\s*\n/, "").replace(/\s+$/, "").split("\n");
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^ */)[0].length));
  return lines.map((line) => line.slice(indent)).join("\n");
}

/** Makes the gs- classes stand out and lets the rest of the markup sit back. */
function highlight(code, lang) {
  let out = escapeHtml(code);
  if (lang === "text") return out;
  const classes = (value) =>
    value.replace(/(^|[\s"])((?:[\w\-\[\]().%]+:)*gs-[^\s"]*)/g, (_, before, token) => `${before}<span class="t-gs">${token}</span>`);
  out = out.replace(/&lt;!--[\s\S]*?--&gt;/g, (comment) => `<span class="t-mute">${comment}</span>`);
  if (lang === "js") out = out.replace(/(^|\s)(\/\/[^\n]*)/g, (_, before, comment) => `${before}<span class="t-mute">${comment}</span>`);
  out = out.replace(/\b(class|className)=("[^"]*")/g, (_, name, value) => `${name}=${classes(value)}`);
  out = out.replace(/\bdata-gs="([^"]*)"/g, (_, value) => `data-gs="<span class="t-gs">${value}</span>"`);
  out = out.replace(/(&lt;\/?)([A-Za-z][\w.-]*)/g, (_, open, tag) => `${open}<span class="t-tag">${tag}</span>`);
  return out;
}

function element(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function copyButton(getText) {
  const button = element("button", "", "Copy");
  button.type = "button";
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getText());
      button.textContent = "Copied";
    } catch {
      button.textContent = "Press Ctrl+C";
    }
    setTimeout(() => (button.textContent = "Copy"), 1400);
  });
  return button;
}

function codePane(code, lang, label, note) {
  const pane = element("div", "pane");
  const bar = element("div", "pane-bar", `<span>${label}</span>`);
  bar.appendChild(copyButton(() => code));
  const pre = element("pre", "code", `<code>${highlight(code, lang)}</code>`);
  pane.append(bar, pre);
  if (note) pane.appendChild(element("p", "code-note", note));
  return pane;
}

/**
 * Puts fresh markup in a result box. The library sees the new elements and animates them.
 *
 * A result box is a small page of its own: when it is on screen, what lands in it plays at once.
 * On a real page a reveal waits until its element has climbed to 88% of the window, so a box that
 * sits low on the screen, like the first one here, would stay half empty until you scroll.
 */
function play(stage, html) {
  stage.innerHTML = "";
  requestAnimationFrame(() => {
    stage.innerHTML = html;
    startNow(stage);
  });
}

const onScreen = (box) => box.getBoundingClientRect().bottom > 0 && box.getBoundingClientRect().top < window.innerHeight;

/** Sets up what is in a box that is on screen so that it starts as soon as it shows at all. */
function startNow(stage) {
  const library = window.gs;
  if (!library || !library.gsap || !onScreen(stage)) return;
  const usual = library.config().start;
  library.config({ start: "top bottom" });
  library.scan(stage);
  library.config({ start: usual });
}

/** What each result box shows, so the ones on screen when the page opens can start at once too. */
const boxes = new Map();

/** The text of a raw <script type="text/..."> block, as it was typed. */
const source = (block) => dedent(block.textContent.replace(/<\\\/script>/g, "</script>"));

/** <div class="ex"><script type="text/html">…</script></div> becomes a result box next to its code. */
function buildExamples() {
  document.querySelectorAll(".ex").forEach((host) => {
    const live = host.querySelector('script[type="text/html"]:not([data-code])');
    const shown = host.querySelector('script[type="text/html"][data-code]') || live;
    const html = source(live);
    const code = source(shown);
    const pair = element("div", "pair");
    if (host.dataset.layout) pair.dataset.layout = host.dataset.layout;

    const result = element("div", "pane");
    const bar = element("div", "pane-bar", `<span>${host.dataset.label || "Result"}</span>`);
    const replay = element("button", "", "Replay");
    replay.type = "button";
    bar.appendChild(replay);
    const stage = element("div", "stage");
    if (host.dataset.height) stage.style.minHeight = host.dataset.height + "px";
    stage.innerHTML = html;
    replay.addEventListener("click", () => play(stage, html));
    boxes.set(stage, () => html);
    result.append(bar, stage);

    pair.append(result, codePane(code, host.dataset.lang || "html", "HTML", host.dataset.note));
    host.replaceChildren(pair);
  });
}

/** The box at the top of the page: type HTML on one side, watch it on the other. */
function buildPlayground() {
  const host = document.querySelector("[data-playground]");
  if (!host) return;
  const start = source(host.querySelector('script[type="text/html"]'));
  const pair = element("div", "pair");

  const edit = element("div", "pane");
  const editBar = element("div", "pane-bar", "<span>Edit this HTML</span>");
  const reset = element("button", "", "Reset");
  reset.type = "button";
  editBar.appendChild(reset);
  const editor = element("textarea", "editor");
  editor.value = start;
  editor.spellcheck = false;
  editor.setAttribute("aria-label", "HTML to animate");
  editor.setAttribute("autocapitalize", "off");
  editor.setAttribute("autocomplete", "off");
  edit.append(editBar, editor);

  const result = element("div", "pane");
  const resultBar = element("div", "pane-bar", "<span>Result</span>");
  const replay = element("button", "", "Replay");
  replay.type = "button";
  resultBar.appendChild(replay);
  const stage = element("div", "stage");
  stage.innerHTML = start;
  result.append(resultBar, stage);

  boxes.set(stage, () => editor.value);

  // The box grows with what is typed in it. A fixed height would hide the last lines behind a
  // scrollbar nobody sees, and catch the mouse wheel on the way down the page.
  const fit = () => {
    editor.style.minHeight = "";
    const floor = parseFloat(getComputedStyle(editor).minHeight) || 0;
    // Measured at no height at all, so the answer is the text's own height
    editor.style.flex = "none";
    editor.style.height = "0px";
    const need = editor.scrollHeight;
    editor.style.flex = "";
    editor.style.height = "";
    editor.style.minHeight = `${Math.max(floor, need)}px`;
  };
  // Only a new width can change how the text wraps (its own growing must not call this again)
  let wide = 0;
  new ResizeObserver(() => {
    if (edit.clientWidth === wide) return;
    wide = edit.clientWidth;
    fit();
  }).observe(edit);
  if (document.fonts) document.fonts.ready.then(fit);

  let timer = 0;
  editor.addEventListener("input", () => {
    fit();
    clearTimeout(timer);
    timer = setTimeout(() => play(stage, editor.value), 350);
  });
  // Tab types two spaces instead of leaving the box. Escape lets keyboard users move on.
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Escape") editor.blur();
    if (event.key !== "Tab" || event.shiftKey) return;
    event.preventDefault();
    editor.setRangeText("  ", editor.selectionStart, editor.selectionEnd, "end");
  });
  replay.addEventListener("click", () => play(stage, editor.value));
  reset.addEventListener("click", () => {
    editor.value = start;
    fit();
    play(stage, start);
  });

  pair.append(edit, result);
  host.replaceChildren(pair);
}

/** One small card per preset. Click a card to see it again. */
function buildPresets() {
  document.querySelectorAll("[data-presets]").forEach((host) => {
    host.dataset.presets.split(",").forEach((name, index) => {
      const cls = "gs-" + name.trim();
      const card = element("button", "preset");
      card.type = "button";
      card.setAttribute("aria-label", `Replay ${cls}`);
      const stage = element("div", "preset-stage");
      const thing = () => {
        const node = element("div", "preset-thing " + cls);
        node.style.backgroundImage = `url(assets/${PHOTOS[index % PHOTOS.length]}.webp)`;
        return node;
      };
      stage.appendChild(thing());
      card.append(stage, element("span", "preset-name", cls));
      card.addEventListener("click", () => stage.replaceChildren(thing()));
      host.appendChild(card);
    });
  });
}

/** Tabs inside a pane: [data-tab] buttons show the [data-panel] with the same name. */
function buildTabs() {
  document.querySelectorAll("[data-tabs]").forEach((host) => {
    const panels = Array.from(host.querySelectorAll("script[data-panel]"));
    const pane = element("div", "pane");
    const bar = element("div", "pane-bar");
    const tabs = element("div", "tabs");
    tabs.setAttribute("role", "tablist");
    const body = element("div");
    let current = "";
    const copy = copyButton(() => current);
    const show = (panel, button) => {
      tabs.querySelectorAll("button").forEach((other) => other.setAttribute("aria-selected", String(other === button)));
      current = source(panel);
      body.replaceChildren(element("pre", "code", `<code>${highlight(current, panel.dataset.lang || "html")}</code>`));
      if (panel.dataset.note) body.appendChild(element("p", "code-note", panel.dataset.note));
    };
    panels.forEach((panel, index) => {
      const button = element("button", "", panel.dataset.panel);
      button.type = "button";
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => show(panel, button));
      tabs.appendChild(button);
      if (index === 0) show(panel, button);
    });
    bar.append(tabs, copy);
    pane.append(bar, body);
    host.replaceChildren(pane);
  });
}

/** Static code blocks: <pre class="code" data-lang="js"> written straight in the HTML. */
function paintCode() {
  document.querySelectorAll("pre.code[data-lang]").forEach((pre) => {
    const code = dedent(pre.textContent);
    pre.innerHTML = `<code>${highlight(code, pre.dataset.lang)}</code>`;
  });
}

/** In the class tables, a class name never breaks in the middle. Only the gaps between names wrap. */
function tidyTables() {
  document.querySelectorAll(".ref th").forEach((cell) => {
    cell.innerHTML = cell.textContent
      .trim()
      .split(/\s+/)
      .map((name) => `<span>${escapeHtml(name)}</span>`)
      .join(" ");
  });
}

/** The sun and moon button. The choice is kept in the same cookie the other DiMaac sites use. */
function wireTheme() {
  const button = document.querySelector(".dm-theme-toggle");
  if (!button) return;
  const root = document.documentElement;
  button.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.setAttribute("data-theme-switching", "");
    root.dataset.theme = next;
    root.style.colorScheme = next;
    const host = location.hostname;
    const domain = host === "dimaac.com" || host.endsWith(".dimaac.com") ? "; domain=.dimaac.com" : "";
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `dm_theme=${next}; path=/; max-age=31536000; samesite=lax${domain}${secure}`;
    requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute("data-theme-switching")));
  });
}

function wireNav() {
  const bar = document.querySelector(".site-nav-bar");
  if (!bar) return;
  const update = () => bar.classList.toggle("is-stuck", window.scrollY > 8);
  update();
  window.addEventListener("scroll", update, { passive: true });
}

buildPlayground();
buildExamples();
buildPresets();
buildTabs();
paintCode();
tidyTables();
wireTheme();
wireNav();
// Once the library is up: the boxes that are on screen as the page opens start at once too
if (window.gs) window.gs.start().then(() => boxes.forEach((html, stage) => onScreen(stage) && play(stage, html())));
