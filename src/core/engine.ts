import type { Config, Loader, PluginName, Preset, PresetDef, Spec } from "./types";
import { DEFAULTS } from "./config";
import { builtinPresets } from "./presets";
import { animates, isCustomEase, knownNames, knownVariant, parseTokens, splitToken } from "./parse";
import { buildCss, closedSelector } from "./css";
import { buildEntry, destroyEntry, findScroller, wipe } from "./build";
import type { Entry, Env } from "./env";
import { byDocument } from "./env";

declare const __VERSION__: string;

export interface Tweenwind {
  /** The library version. */
  readonly version: string;
  /** The GSAP instance in use, once it has loaded. */
  readonly gsap: any;
  /** Resolves when the first pass over the page is done. */
  readonly ready: Promise<void>;
  /** Reads or changes the defaults. Call it before `start()`. */
  config(options?: Partial<Config>): Config;
  /** Animates the page and keeps watching it for changes. Safe to call more than once. */
  start(): Promise<void>;
  /** Checks an element (or everything a selector matches) and what is inside it right now. Use it when `observe` is off, or to bring back something you reverted. */
  scan(root?: Element | Document | string | null): Promise<void>;
  /** Rebuilds every animation and recalculates scroll positions. Entrances that already played stay as they are. */
  refresh(): Promise<void>;
  /**
   * Removes the animations inside an element (or everything a selector matches) and leaves it alone until you `scan` it again.
   * With no argument, removes everything and stops watching.
   */
  revert(root?: Element | string | null): void;
  /** Adds your own class: `gs.preset("swoop", { from: { y: 80, rotate: 6, autoAlpha: 0 } })` gives `gs-swoop`. */
  preset(name: string, def: PresetDef, options?: { entrance?: boolean }): void;
  /** Hands over GSAP plugins you already imported, so they are not loaded again. */
  use(plugins: Partial<Record<PluginName, any>>): void;
  /** The GSAP timelines made for an element, to play, pause or seek them yourself. */
  get(target: Element | string): any[];
  /** The stylesheet as text, for when you want to inline it in your HTML head. */
  css(): string;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

export function createEngine(loader: Loader): Tweenwind {
  const config: Config = { ...DEFAULTS, breakpoints: { ...DEFAULTS.breakpoints } };
  const presets: Map<string, Preset> = builtinPresets();
  const entries = new Map<Element, Entry>();
  const dirty = new Set<Element>();
  const forced = new Set<Element>();
  const asleep = new Map<Element, Entry>();
  const queries = new Map<string, MediaQueryList>();
  const eases = new Map<string, any>();
  const plugins: Record<string, any> = {};
  const loads = new Map<string, Promise<void>>();
  const failed = new Set<string>();
  const warned = new Set<string>();
  const idle: Array<() => void> = [];

  let gsap: any = null;
  let observer: MutationObserver | null = null;
  let sizes: ResizeObserver | null = null;
  let boxes: ResizeObserver | null = null;
  let motion: MediaQueryList | null = null;
  let style: HTMLStyleElement | null = null;
  /** Elements handed back with `gs.revert(el)`. They are left alone until `gs.scan` asks for them again. */
  let ignored = new WeakSet<Element>();
  let started = false;
  let scheduled = false;
  let busy = false;
  let measured = 0;
  let watching = false;
  let timer: any = 0;
  let poll: any = 0;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => (resolveReady = resolve));

  const dev = () => {
    if (config.debug) return true;
    const host = location.hostname;
    return location.protocol === "file:" || host === "localhost" || host === "[::1]" || /^(127|0)\./.test(host) || /\.(local|test)$/.test(host);
  };

  const warn = (message: string, ...rest: any[]) => {
    if (dev()) console.warn("[tweenwind] " + message, ...rest);
  };

  const media = (query: string): boolean => {
    let list = queries.get(query);
    if (!list) {
      list = window.matchMedia(query);
      queries.set(query, list);
      list.addEventListener("change", () => {
        entries.forEach((entry) => {
          if (entry.spec.media.includes(query)) dirty.add(entry.el);
        });
        schedule();
      });
    }
    return list.matches;
  };

  const ease = (value: any): any => {
    if (typeof value !== "string") return value;
    if (isCustomEase(value)) {
      const CustomEase = plugins.CustomEase;
      if (!CustomEase) return config.ease;
      let made = eases.get(value);
      if (!made) {
        made = CustomEase.create("gs-" + eases.size, value.replace(/^cubic-bezier\(|\)$/g, ""));
        eases.set(value, made);
      }
      return made;
    }
    // GSAP quietly falls back when it does not know an ease. Say so, with the class to look at.
    if (gsap && value !== config.ease && !gsap.parseEase(value)) {
      if (!warned.has("ease " + value)) {
        warned.add("ease " + value);
        warn(`"${config.prefix}-ease-${value}" is not an ease GSAP knows, so ${config.ease} is used. Try power2.out, expo.inOut, back.out(1.7) or elastic.out.`);
      }
      return config.ease;
    }
    return value;
  };

  const selector = () => `[class*="${config.prefix}-"],[data-gs]`;

  const selfAnimated = (el: Element): boolean => {
    if (ignored.has(el) || !el.matches(selector())) return false;
    const entry = entries.get(el);
    const spec = entry && !dirty.has(el) ? entry.spec : read(el);
    if (spec.off) return false;
    // A reveal on scroll, or one on load: either way the element already has its own entrance.
    return [spec.groups.view, spec.groups.load].some((group) => !!group && !group.off && animates(group));
  };

  const env: Env = {
    gsap: null,
    plugins,
    config,
    presets,
    entries,
    reduced: () => config.reducedMotion && !!motion && motion.matches,
    touch,
    collect,
    drop,
    selfAnimated,
    scrollers: new Map(),
    warn,
    ease,
  };

  function read(el: Element): Spec {
    const raw = typeof el.className === "string" ? el.className : el.getAttribute("class") || "";
    const mark = config.prefix + "-";
    const data = el.getAttribute("data-gs");
    const classTokens = raw.includes(mark) ? raw.split(/\s+/).filter((token) => token.includes(mark)) : [];
    return parseTokens(classTokens, data ? data.split(/\s+/).filter(Boolean) : [], { config, presets, media });
  }

  /** The element and everything inside it that carries our classes. */
  function ours(root: Element | Document): Element[] {
    const list: Element[] = [];
    if ((root as Element).matches && (root as Element).matches(selector())) list.push(root as Element);
    root.querySelectorAll(selector()).forEach((el) => list.push(el));
    return list;
  }

  function collect(root: Element | Document) {
    for (const el of ours(root)) if (!ignored.has(el)) dirty.add(el);
  }

  /** Drops the pending mutation records that our own DOM changes inside `el` produced. */
  function touch(el: Element) {
    if (!observer) return;
    const records = observer.takeRecords();
    if (records.length) handle(records.filter((record) => record.target !== el && !el.contains(record.target)));
  }

  function handle(records: MutationRecord[]) {
    // To measure an element inside a display:none ancestor, GSAP moves it to <html> for an
    // instant and puts it straight back. That is its own business, not a change to the page.
    const root = document.documentElement;
    const bounced = new Set<Node>();
    for (const record of records) {
      if (record.type !== "childList" || (record.target !== root && !bounced.has(record.target))) continue;
      record.addedNodes.forEach((node) => {
        if (node.parentNode !== record.target) bounced.add(node);
      });
    }
    const all = (nodes: NodeList) => {
      for (let i = 0; i < nodes.length; i++) if (!bounced.has(nodes[i])) return false;
      return true;
    };

    let removed = false;
    for (const record of records) {
      const target = record.target as Element;
      if (record.type === "attributes") {
        if (record.attributeName === "dir") {
          // The page switched reading direction. A marquee and a sideways section run the other way now.
          entries.forEach((entry) => {
            if ((entry.spec.behaviors.marquee || isHorizontal(entry.spec)) && target.contains(entry.el)) requeue(entry);
          });
        } else if (!ignored.has(target)) {
          dirty.add(target);
        }
        continue;
      }
      if (bounced.size && (bounced.has(target) || (all(record.addedNodes) && all(record.removedNodes)))) continue;
      if (record.removedNodes.length) removed = true;
      record.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        for (const el of ours(node as Element)) {
          if (ignored.has(el)) continue;
          dirty.add(el);
          const entry = entries.get(el);
          if (entry && entry.built) relocated(entry);
        }
      });
      // Someone else changed the inside of an element we manage.
      for (let node: Element | null = target; node; node = node.parentElement) {
        const entry = entries.get(node);
        if (!entry || !entry.built) continue;
        if (entry.split || (entry.check && entry.check())) {
          entry.foreign = true;
          forced.add(node);
          dirty.add(node);
        } else if (node === target && entry.sync) {
          entry.sync();
        }
        break;
      }
    }
    if (removed || dirty.size) schedule();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      flush();
    });
  }

  function drop(entry: Entry) {
    rouse(entry.el);
    destroyEntry(entry);
    if (entries.get(entry.el) === entry) entries.delete(entry.el);
  }

  /**
   * A pinned element found outside its spacer is set up again. If that keeps happening to the
   * same element (something keeps taking the pin apart, as an error inside GSAP once did), it is
   * left alone after a few tries: a page that misses one pin is better than a page that hangs.
   */
  const unpins = new WeakMap<Element, { since: number; count: number }>();
  function unpinned(entry: Entry) {
    const now = Date.now();
    let record = unpins.get(entry.el);
    if (!record || now - record.since > 2000) unpins.set(entry.el, (record = { since: now, count: 0 }));
    if (++record.count > 6) {
      if (record.count === 7) console.warn("[tweenwind] this pinned element keeps being taken out of its place, so it is left alone", entry.el);
      return;
    }
    requeue(entry);
  }

  function requeue(entry: Entry | null) {
    if (entry && entry.el.isConnected) {
      forced.add(entry.el);
      dirty.add(entry.el);
    }
  }

  const timelineOf = (spec: Spec | undefined) => {
    if (!spec || spec.off) return undefined;
    for (const key in spec.groups) if (spec.groups[key].timeline && !spec.groups[key].off) return spec.groups[key];
    return undefined;
  };
  /** Inside a timeline, an element with scroll classes of its own keeps them and is not a step. */
  const standsAlone = (group: Spec["groups"][string]) =>
    group.scrub !== undefined || !!group.pin || !!group.start || !!group.end || !!group.triggerSel || !!group.play || !!group.actions || !!group.toggleClass;
  /** True when the base animation is a step of the timeline around it. A timeline inside a timeline is one too. */
  const isStep = (spec: Spec) => {
    const view = spec.groups.view;
    return !spec.off && !!view && !view.off && (animates(view) || !!view.timeline) && !standsAlone(view);
  };
  const isHorizontal = (spec: Spec | undefined) =>
    !!spec && !spec.off && !!spec.groups.view && !!spec.groups.view.effect && spec.groups.view.effect.name === "horizontal";
  const pins = (spec: Spec | undefined) => !!spec && !spec.off && !!spec.groups.view && !spec.groups.view.off && !!spec.groups.view.pin;

  const known = (el: Element) => (entries.get(el) ? entries.get(el)!.spec : undefined);
  function timelineAbove(el: Element, specOf: (el: Element) => Spec | undefined = known): Element | null {
    for (let node = el.parentElement; node; node = node.parentElement) if (timelineOf(specOf(node))) return node;
    return null;
  }

  /**
   * A tracked element that turns up as "added" was moved. The timeline it is a step of may have
   * changed, or its place in the order, or the page took it out of the spacer it was pinned in.
   */
  function relocated(entry: Entry) {
    const el = entry.el;
    if (entry.spacer && el.parentNode !== entry.spacer) return unpinned(entry);
    const container = isStep(entry.spec) ? timelineAbove(el) : null;
    const owner = container ? entries.get(container) || null : null;
    if (owner !== entry.owner) {
      requeue(entry.owner);
      requeue(entry);
      return;
    }
    const steps = owner && owner.steps;
    if (!steps) return;
    for (let i = 1; i < steps.length; i++) {
      if (byDocument(steps[i - 1], steps[i]) > 0) return requeue(owner);
    }
  }

  // --- Hidden elements ---------------------------------------------------------------------
  // What depends on where an element sits (anything tied to scrolling, a marquee) cannot be set
  // up while the element is display:none. It waits, and is set up the moment it is shown: a tab
  // panel, a closed dialog, a block that only exists on phones.

  // checkVisibility also knows about content the browser skips without display:none, like the
  // inside of a closed <details>.
  const hasBox = (el: Element) =>
    (typeof (el as any).checkVisibility === "function" ? (el as any).checkVisibility() : el.getClientRects().length > 0) ||
    getComputedStyle(el).display === "contents";
  const needsBox = (entry: Entry) => !entry.owner && (entry.spec.scroll || !!entry.spec.behaviors.marquee);

  function sleep(entry: Entry) {
    if (asleep.has(entry.el)) return;
    asleep.set(entry.el, entry);
    if (typeof ResizeObserver === "function") {
      boxes = boxes || new ResizeObserver(wake);
      boxes.observe(entry.el);
    }
    // The observer says nothing for an inline element or one with no size, so look now and then too.
    if (!poll) poll = setInterval(wake, 300);
  }

  function rouse(el: Element) {
    if (!asleep.delete(el)) return;
    if (boxes) boxes.unobserve(el);
    if (!asleep.size) {
      clearInterval(poll);
      poll = 0;
    }
  }

  function wake() {
    asleep.forEach((entry, el) => {
      if (el.isConnected && !hasBox(el)) return;
      rouse(el);
      requeue(entry);
    });
    if (dirty.size) schedule();
  }

  function loadPlugin(name: string): Promise<void> {
    let pending = loads.get(name);
    if (!pending) {
      const globals = gsap.core && gsap.core.globals ? gsap.core.globals() : {};
      const existing = globals[name];
      pending = (existing ? Promise.resolve(existing) : loader.plugin(name as PluginName, config, gsap)).then(
        (plugin) => adopt(name, plugin),
        (error) => {
          failed.add(name);
          console.error(`[tweenwind] could not load ${name}. Elements that need it are shown without animation.`, error);
        },
      );
      loads.set(name, pending);
    }
    return pending;
  }

  function adopt(name: string, plugin: any) {
    if (!plugin) {
      failed.add(name);
      return;
    }
    failed.delete(name);
    plugins[name] = plugin;
    if (gsap) gsap.registerPlugin(plugin);
    if (name === "ScrollTrigger" && gsap) watchLayout(plugin);
  }

  /** Scroll positions go stale when the page changes height: late images, fonts, opened panels. */
  function watchLayout(ScrollTrigger: any) {
    const root = document.documentElement;
    const height = () => root.scrollHeight;
    if (!watching) {
      watching = true;
      ScrollTrigger.config({ ignoreMobileResize: true });
      const done = () => root.removeAttribute("data-gs-measure");
      // While it measures, the stylesheet ignores where entrances start from (see css.ts).
      ScrollTrigger.addEventListener("refreshInit", () => {
        root.setAttribute("data-gs-measure", "");
        Promise.resolve().then(done);
      });
      ScrollTrigger.addEventListener("refresh", () => {
        done();
        measured = height();
      });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => started && measured && height() !== measured && ScrollTrigger.refresh());
    }
    if (sizes || typeof ResizeObserver !== "function" || !document.body) return;
    sizes = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!started || !measured || height() === measured) return;
        // Nothing on the page is tied to scrolling any more: note the new height and leave it there.
        if (ScrollTrigger.getAll().length) ScrollTrigger.refresh(true);
        else measured = height();
      }, 200);
    });
    sizes.observe(document.body);
  }

  /** Explains a class that could not be read, with the closest real name when there is one. */
  function hint(el: Element, tokens: string[]) {
    if (!dev()) return;
    const names = knownNames(presets);
    const p = config.prefix;
    for (const token of tokens) {
      if (warned.has(token)) continue;
      warned.add(token);
      // A word from `data-gs` is written without the prefix, so its hints are too
      const classy = splitToken(token, p);
      const parts = classy || splitToken(token, null);
      const shown = (name: string) => (classy ? `${p}-${name}` : name);
      const body = parts ? parts.body : token;
      const variant = parts ? parts.variants.find((name) => !knownVariant(name, config)) : undefined;
      if (variant) {
        console.warn(`[tweenwind] "${variant}:" in "${token}" is not a prefix I know. Try md:, max-md:, hover:, click:, focus:, press: or load:.`, el);
        continue;
      }
      const name = names.find((candidate) => body === candidate || body.startsWith(candidate + "-"));
      if (name && !presets.has(name)) {
        console.warn(`[tweenwind] "${token}" has a value I cannot read. Check the docs for ${shown(name)}.`, el);
        continue;
      }
      // Closest real name: the word as typed, then without a stray "-in", then without its last part.
      const word = body.replace(/-?\[.*$/, "");
      let best = "";
      let score = 3;
      for (const part of [word, word.replace("-in", ""), word.replace(/-[^-]*$/, "")]) {
        for (const candidate of names) {
          const d = distance(part, candidate);
          if (d < score) {
            score = d;
            best = candidate;
          }
        }
        if (best) break;
      }
      console.warn(`[tweenwind] "${token}" is not a class I know.${best ? ` Did you mean "${shown(best)}"?` : ""}`, el);
    }
  }

  /** `load:gs-fade-up gs-duration-2`: says which prefix the plain timing class was probably meant for. */
  function stray(el: Element, spec: Spec) {
    if (!dev()) return;
    const key = Object.keys(spec.groups).find((name) => name !== "view" && animates(spec.groups[name]));
    for (const token of spec.stray) {
      if (warned.has("stray " + token + key)) continue;
      warned.add("stray " + token + key);
      console.warn(`[tweenwind] "${token}" has nothing to time here: the animation on this element is behind "${key}:". Write "${key}:${token}".`, el);
    }
  }

  function settle() {
    if (busy || scheduled) return;
    resolveReady();
    idle.splice(0).forEach((resolve) => resolve());
  }

  const whenIdle = () => (busy || scheduled ? new Promise<void>((resolve) => idle.push(resolve)) : Promise.resolve());

  function flush() {
    if (!gsap || busy) return;

    // 1. Forget what left the page.
    entries.forEach((entry, el) => {
      if (el.isConnected) return;
      const owner = entry.owner;
      drop(entry);
      requeue(owner);
    });

    // 2. Read the classes of everything that is new or changed.
    const batch = new Map<Element, Spec>();
    dirty.forEach((el) => {
      if (!el.isConnected || ignored.has(el)) return;
      const spec = read(el);
      const entry = entries.get(el);
      if (spec.unknown.length) hint(el, spec.unknown);
      if (spec.stray.length) stray(el, spec);
      if (spec.empty) {
        if (entry) {
          const owner = entry.owner;
          const wasScope = entry.scope;
          const wasSmooth = entry.built && !!entry.spec.behaviors.smooth;
          drop(entry);
          requeue(owner);
          if (wasScope) el.querySelectorAll(selector()).forEach((inner) => requeue(entries.get(inner) || null));
          // Everything on the page was measured through the smooth scroller. Without it, measure again.
          if (wasSmooth) entries.forEach((other) => requeue(other));
        }
        return;
      }
      if (entry && entry.built && entry.spec.signature === spec.signature && !forced.has(el)) return;
      batch.set(el, spec);
    });
    dirty.clear();
    forced.clear();
    if (!batch.size) return settle();

    // 3. A timeline and its steps are built together. So is a horizontal section and its content,
    //    and a section whose pin just came or went, because that moves everything inside it.
    const specOf = (el: Element) => batch.get(el) || known(el);
    const queue = Array.from(batch.keys());
    for (let i = 0; i < queue.length; i++) {
      const el = queue[i];
      const old = entries.get(el);
      const spec = batch.get(el)!;
      const pinChanged = pins(spec) !== (!!old && old.built && pins(old.spec));
      // Smooth scrolling coming or going changes how everything on the page is measured and pinned.
      if (!!spec.behaviors.smooth !== !!(old && old.built && old.spec.behaviors.smooth)) {
        entries.forEach((_entry, tracked) => {
          if (batch.has(tracked) || ignored.has(tracked) || !tracked.isConnected) return;
          const trackedSpec = read(tracked);
          if (trackedSpec.empty) return;
          batch.set(tracked, trackedSpec);
          queue.push(tracked);
        });
      }
      if (timelineOf(spec) || isHorizontal(spec) || pinChanged || (old && old.scope)) {
        el.querySelectorAll(selector()).forEach((inner) => {
          if (batch.has(inner) || ignored.has(inner)) return;
          const innerSpec = read(inner);
          if (innerSpec.empty) return;
          batch.set(inner, innerSpec);
          queue.push(inner);
        });
      }
      const container = timelineAbove(el, specOf);
      if (container && !batch.has(container)) {
        batch.set(container, read(container));
        queue.push(container);
      }
    }

    // 4. Load the plugins this batch needs. If any are missing, come back when they arrive.
    const needed = new Set<string>();
    batch.forEach((spec, el) => {
      spec.plugins.forEach((name) => needed.add(name));
      if (!spec.scroll) return;
      const container = timelineAbove(el, specOf);
      const outer = container ? timelineOf(specOf(container)) : undefined;
      if (!outer || outer.kind === "view" || timelineOf(spec)) needed.add("ScrollTrigger");
    });
    const missing = Array.from(needed).filter((name) => !plugins[name] && !failed.has(name));
    if (missing.length) {
      busy = true;
      batch.forEach((_spec, el) => {
        dirty.add(el);
        forced.add(el);
      });
      Promise.all(missing.map(loadPlugin)).then(() => {
        busy = false;
        flush();
      });
      return;
    }

    // 5. Take the old animations off, top of the page first, then note who plays what.
    const ordered = Array.from(batch.keys()).sort(byDocument);
    for (const el of ordered) {
      let entry = entries.get(el);
      if (entry) {
        destroyEntry(entry);
      } else {
        entry = { el: el as HTMLElement, built: false, cleanups: [], units: [], owner: null, horizontal: null, pinnedBy: null } as unknown as Entry;
        entries.set(el, entry);
        // New to us but already marked: a copy of an element that was part way through a reveal.
        if (el.hasAttribute("data-gs-enter")) wipe(el);
        if (el.hasAttribute("data-gs-ready")) {
          el.removeAttribute("data-gs-ready");
          el.querySelectorAll("[data-gs-enter]").forEach((piece) => {
            for (let node: Element | null = piece; node && node !== el; node = node.parentElement) if (entries.has(node)) return;
            wipe(piece);
          });
        }
      }
      const current = entry;
      current.spec = batch.get(el)!;
      current.ctx = gsap.context(() => {});
      current.run = (fn) => current.ctx.add(fn);
      current.cleanups = [];
      current.units = [];
    }
    for (const el of ordered) {
      const entry = entries.get(el)!;
      const container = isStep(entry.spec) ? timelineAbove(el, specOf) : null;
      entry.owner = container ? entries.get(container) || null : null;
      entry.horizontal = null;
      entry.pinnedBy = null;
      for (let node = el.parentElement; node; node = node.parentElement) {
        const above = specOf(node);
        if (!above || above.off) continue;
        if (isHorizontal(above)) {
          entry.horizontal = entries.get(node) || null;
          break;
        }
        if (pins(above)) {
          entry.pinnedBy = entries.get(node) || null;
          break;
        }
      }
    }

    // 6. Build, top of the page first, so scroll positions add up. Boxes are all read before
    //    anything is built, because building writes styles and reading after that is slow.
    const boxless = new Set<Element>();
    env.scrollers.clear();
    for (const el of ordered) {
      const entry = entries.get(el)!;
      if (needsBox(entry) && !hasBox(el)) boxless.add(el);
      // What scrolls it is asked once for each parent, here, and not again for every element later.
      entry.scroller = entry.spec.scroll ? findScroller(el, env.scrollers) : undefined;
      if (entry.spec.scroll && el.firstElementChild) findScroller(el.firstElementChild, env.scrollers);
    }
    let scrolls = false;
    for (const el of ordered) {
      const entry = entries.get(el)!;
      const blocked = entry.spec.plugins.some((name) => failed.has(name)) || (entry.spec.scroll && failed.has("ScrollTrigger"));
      if (blocked) {
        entry.built = true;
        el.setAttribute("data-gs-ready", "");
        continue;
      }
      if (boxless.has(el)) {
        sleep(entry);
        continue;
      }
      rouse(el);
      try {
        buildEntry(env, entry);
        scrolls = scrolls || entry.spec.scroll;
      } catch (error) {
        console.error("[tweenwind] could not animate this element", el, error);
        el.setAttribute("data-gs-ready", "");
      }
    }
    if (config.debug) console.log(`[tweenwind] built ${ordered.length} element(s)`, ordered);

    // 7. New triggers may sit above old ones. Put them in page order and measure again.
    const ScrollTrigger = plugins.ScrollTrigger;
    if (ScrollTrigger && scrolls) {
      ScrollTrigger.sort();
      ScrollTrigger.refresh();
    }
    if (dirty.size) schedule();
    else settle();
  }

  function injectCss() {
    if (typeof document === "undefined") return;
    if (!style) {
      style = document.createElement("style");
      style.setAttribute("data-tweenwind", "");
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = buildCss(config.prefix, presets);
  }

  function showAll() {
    // Everything is shown as written, except what only a click opens: with nothing to open it,
    // a menu stays closed instead of lying over the page.
    const closed = closedSelector(config.prefix, presets);
    document.querySelectorAll(selector()).forEach((el) => el.matches(closed) || el.setAttribute("data-gs-ready", ""));
  }

  function onPrint() {
    entries.forEach((entry) => {
      for (const unit of entry.units) {
        const kind = unit.data && unit.data.kind;
        const scrubbed = unit.scrollTrigger && unit.scrollTrigger.vars.scrub;
        if ((kind === "view" || kind === "load") && !scrubbed && unit.totalDuration() < 1e6) unit.progress(1);
      }
    });
  }

  function onMotion() {
    entries.forEach((entry) => requeue(entry));
    schedule();
  }

  function start(): Promise<void> {
    if (typeof window === "undefined") return Promise.resolve();
    if (started) return ready;
    // Two copies on one page (a script tag and a bundle, say) would animate everything twice.
    const page = window as any;
    if (page.__tweenwind && page.__tweenwind !== api) {
      console.warn("[tweenwind] is on this page twice. The second copy is standing down, remove one of them.");
      return page.__tweenwind.ready;
    }
    page.__tweenwind = api;
    started = true;
    injectCss();
    motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    motion.addEventListener("change", onMotion);
    window.addEventListener("beforeprint", onPrint);

    const core = loader.gsap(config);
    const begin = () => {
      core.then(
        (instance) => {
          if (!started) return;
          gsap = env.gsap = instance;
          for (const name in plugins) gsap.registerPlugin(plugins[name]);
          if (plugins.ScrollTrigger) watchLayout(plugins.ScrollTrigger);
          if (config.observe && typeof MutationObserver === "function") {
            observer = new MutationObserver(handle);
            observer.observe(document.documentElement, {
              subtree: true,
              childList: true,
              attributes: true,
              attributeFilter: ["class", "data-gs", "dir"],
            });
          }
          collect(document);
          flush();
        },
        (error) => {
          console.error("[tweenwind] GSAP could not be loaded, so the page is shown without animation.", error);
          showAll();
          resolveReady();
        },
      );
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", begin, { once: true });
    else begin();
    return ready;
  }

  /** The elements an argument stands for: an element, or everything a selector matches. */
  function resolve(root: Element | Document | string): Array<Element | Document> {
    if (typeof root !== "string") return [root];
    try {
      return Array.from(document.querySelectorAll(root));
    } catch {
      warn(`"${root}" is not a selector the browser understands`);
      return [];
    }
  }

  const api: Tweenwind = {
    version: typeof __VERSION__ === "string" ? __VERSION__ : "dev",
    get gsap() {
      return gsap;
    },
    ready,
    config(options) {
      if (options) {
        const { breakpoints, ...rest } = options;
        Object.assign(config, rest);
        if (breakpoints) Object.assign(config.breakpoints, breakpoints);
        if (style) injectCss();
      }
      return config;
    },
    start,
    scan(root) {
      if (typeof window === "undefined") return Promise.resolve();
      if (!started) return start();
      for (const node of resolve(root || document)) {
        // Asking for it by name brings back what `revert` set aside. A scan of the whole page does not.
        if (root) for (const el of ours(node)) ignored.delete(el);
        collect(node);
      }
      flush();
      return whenIdle();
    },
    refresh() {
      if (!started) return start();
      entries.forEach((entry) => requeue(entry));
      collect(document);
      flush();
      return whenIdle().then(() => {
        if (plugins.ScrollTrigger) plugins.ScrollTrigger.refresh();
      });
    },
    revert(root) {
      if (typeof window === "undefined") return;
      if (root) {
        for (const node of resolve(root) as Element[]) {
          // Bottom of the page first, so inner elements are restored before the things that wrap them.
          const inside = Array.from(entries.values()).filter((entry) => node === entry.el || node.contains(entry.el));
          const owners = new Set<Entry>();
          for (const entry of inside) if (entry.owner && !inside.includes(entry.owner)) owners.add(entry.owner);
          inside.sort((a, b) => byDocument(b.el, a.el)).forEach(drop);
          for (const el of ours(node)) {
            ignored.add(el);
            dirty.delete(el);
          }
          // A step taken out of a timeline: the timeline carries on without it.
          owners.forEach(requeue);
        }
        if (dirty.size) flush();
        return;
      }
      Array.from(entries.values())
        .sort((a, b) => byDocument(b.el, a.el))
        .forEach(drop);
      dirty.clear();
      forced.clear();
      asleep.clear();
      ignored = new WeakSet();
      if (observer) observer.disconnect();
      if (sizes) sizes.disconnect();
      if (boxes) boxes.disconnect();
      if (motion) motion.removeEventListener("change", onMotion);
      window.removeEventListener("beforeprint", onPrint);
      clearTimeout(timer);
      clearInterval(poll);
      poll = 0;
      observer = sizes = boxes = motion = null;
      started = false;
      // Without the script nothing may stay hidden, now or for elements added later.
      if (style) style.remove();
      style = null;
      document.querySelectorAll("[data-gs-ready]").forEach((el) => el.removeAttribute("data-gs-ready"));
      if ((window as any).__tweenwind === api) delete (window as any).__tweenwind;
    },
    preset(name, def, options) {
      const entrance = options && options.entrance !== undefined ? options.entrance : typeof def === "function" || !!def.from || !!def.build;
      presets.set(name, { def, entrance });
      if (style) injectCss();
      if (started && gsap) {
        entries.forEach((entry) => requeue(entry));
        collect(document);
        schedule();
      }
    },
    use(map) {
      for (const name in map) adopt(name, (map as Record<string, any>)[name]);
    },
    get(target) {
      const el = typeof target === "string" ? document.querySelector(target) : target;
      const entry = el ? entries.get(el) : undefined;
      return entry ? entry.units.slice() : [];
    },
    css: () => buildCss(config.prefix, presets),
  };
  return api;
}
