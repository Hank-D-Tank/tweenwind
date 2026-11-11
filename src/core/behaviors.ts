import type { Entry, Env } from "./env";
import { childrenOf, forgetIn, number, resolveRef } from "./env";
import type { Vars } from "./types";

type Behavior = (env: Env, entry: Entry, options: Vars, reduce: boolean) => void;

const TRANSFORM_PROPS = ["transform", "translate", "rotate", "scale"];

/**
 * `html { scroll-behavior: smooth }` makes the browser ease every scroll position a script sets,
 * so a glide of our own would crawl. The CSS one is switched off for as long as we are gliding.
 */
let smoothCss: string | null = null;
/**
 * The wrapper ScrollSmoother made the last time, taken out of the page again when smooth
 * scrolling went. It is put back for the next time, because GSAP remembers every wrapper it
 * has ever seen, and a fresh one for each switch would never be let go.
 */
let spareWrapper: HTMLElement | null = null;
function calmScroll() {
  const root = document.documentElement;
  if (smoothCss !== null || getComputedStyle(root).scrollBehavior !== "smooth") return;
  smoothCss = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
}
function freeScroll() {
  if (smoothCss === null) return;
  document.documentElement.style.scrollBehavior = smoothCss;
  if (document.documentElement.getAttribute("style") === "") document.documentElement.removeAttribute("style");
  smoothCss = null;
}

function listen(entry: Entry, target: EventTarget, type: string, handler: (event: any) => void, options?: AddEventListenerOptions) {
  target.addEventListener(type, handler, options);
  entry.cleanups.push(() => target.removeEventListener(type, handler, options));
}

/**
 * An endless row. The children are copied until they fill the width, then every item
 * moves left by exactly one set, which lands each copy where the original started.
 */
const marquee: Behavior = (env, entry, options, reduce) => {
  if (reduce) return;
  const { gsap } = env;
  const el = entry.el;
  const speed = Math.abs(number(options.speed, 80)) || 80;
  const base = options.direction === "right" || number(options.speed, 1) < 0 ? -1 : 1;
  let rate = base;
  let tween: any = null;
  let clones: Element[] = [];
  let width = 0;
  let timer: any = 0;
  let visible = true;
  let hovering = false;
  let gliding: any = null;

  const clear = () => {
    if (gliding) gliding.kill();
    if (tween) tween.revert();
    gliding = tween = null;
    if (clones.length) {
      clones.forEach((clone) => clone.remove());
      clones = [];
      env.touch(el);
    }
  };

  const build = () => {
    clear();
    const items = childrenOf(el);
    width = el.clientWidth;
    if (!items.length || !width) return;
    const css = getComputedStyle(el);
    const gap = parseFloat(css.columnGap) || 0;
    // Left and right edges of the whole set, whichever way the row runs.
    const left = Math.min(...items.map((item) => item.offsetLeft));
    const right = Math.max(...items.map((item) => item.offsetLeft + item.offsetWidth));
    const set = right - left + gap;
    if (set < 1) return;
    // In a right-to-left page the copies line up to the left, so the row travels right.
    const flow = css.direction === "rtl" ? 1 : -1;
    // Enough copies to fill the width. The cap is only there so a broken layout cannot flood the page.
    const copies = Math.min(Math.ceil(width / set), 200);
    for (let copy = 0; copy < copies; copy++) {
      for (const item of items) {
        const clone = item.cloneNode(true) as Element;
        clone.setAttribute("aria-hidden", "true");
        clone.setAttribute("data-gs-clone", "");
        clone.removeAttribute("id");
        clone.querySelectorAll("[id]").forEach((inner) => inner.removeAttribute("id"));
        el.appendChild(clone);
        clones.push(clone);
      }
    }
    env.touch(el);
    // Classes on the items (a hover, say) should work on the copies too.
    clones.forEach(env.collect);
    entry.run(() => {
      tween = gsap.to(el.children, { x: flow * set, duration: set / speed, ease: "none", repeat: -1 });
      // Start far from zero so it can also run backwards without hitting the start.
      tween.totalTime(tween.duration() * 1000);
      tween.timeScale(hovering ? 0 : rate);
      tween.paused(!visible);
    });
  };

  const rebuildSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (entry.built && el.isConnected) build();
    }, 120);
  };

  // Speed changes are eased. Each one replaces the last, so only one ever exists.
  const glide = (to: number, duration: number) => {
    if (!tween) return;
    const replaced = gliding;
    gliding = gsap.to(tween, { timeScale: to, duration, overwrite: true, ease: "power2.out" });
    // Scrolling makes one of these on every tick. The one it replaces is let go of entirely.
    if (replaced) forgetIn(entry.ctx, new Set([replaced]));
  };

  build();
  entry.sync = rebuildSoon;

  if (typeof ResizeObserver === "function") {
    const sizes = new ResizeObserver(() => {
      if (el.clientWidth !== width) rebuildSoon();
    });
    sizes.observe(el);
    entry.cleanups.push(() => sizes.disconnect());
  }
  if (typeof IntersectionObserver === "function") {
    const seen = new IntersectionObserver((records) => {
      visible = records[records.length - 1].isIntersecting;
      if (tween) tween.paused(!visible);
    });
    seen.observe(el);
    entry.cleanups.push(() => seen.disconnect());
  }
  if (document.fonts && document.fonts.status !== "loaded") document.fonts.ready.then(rebuildSoon);

  if (options.pause) {
    listen(entry, el, "pointerenter", (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      hovering = true;
      glide(0, 0.5);
    });
    listen(entry, el, "pointerleave", () => {
      hovering = false;
      glide(rate, 0.5);
    });
  }

  if (options.scroll && env.plugins.ScrollTrigger) {
    let settle: any;
    entry.run(() => {
      settle = gsap.delayedCall(0.15, () => !hovering && glide(rate, 0.8)).pause();
      env.plugins.ScrollTrigger.create({
        start: 0,
        end: "max",
        onUpdate: (self: any) => {
          const velocity = self.getVelocity();
          if (!tween || hovering || !velocity) return;
          rate = base * (velocity < 0 ? -1 : 1);
          glide(rate * (1 + Math.min(Math.abs(velocity) / 400, 6)), 0.2);
          settle.restart(true);
        },
      });
    });
  }

  entry.cleanups.push(() => {
    clearTimeout(timer);
    clear();
  });
};

/** The element leans toward the pointer and springs back when it leaves. */
const magnetic: Behavior = (env, entry, options, reduce) => {
  if (reduce) return;
  const { gsap } = env;
  const el = entry.el;
  const strength = number(options.strength, 0.35);
  const inline = TRANSFORM_PROPS.map((name) => el.style.getPropertyValue(name));
  listen(entry, el, "pointermove", (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const box = el.getBoundingClientRect();
    const x = Number(gsap.getProperty(el, "x")) || 0;
    const y = Number(gsap.getProperty(el, "y")) || 0;
    gsap.to(el, {
      x: (event.clientX - (box.left - x + box.width / 2)) * strength,
      y: (event.clientY - (box.top - y + box.height / 2)) * strength,
      duration: 0.45,
      ease: "power3.out",
      overwrite: "auto",
    });
  });
  listen(entry, el, "pointerleave", () => {
    gsap.to(el, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1, 0.4)", overwrite: "auto" });
  });
  entry.cleanups.push(() => {
    gsap.killTweensOf(el, "x,y");
    if (!(el as any)._gsap) return;
    // Hand the element back as it was written, with no transform of ours left on it.
    gsap.set(el, { clearProps: "transform" });
    TRANSFORM_PROPS.forEach((name, index) => (inline[index] ? el.style.setProperty(name, inline[index]) : el.style.removeProperty(name)));
    if (el.getAttribute("style") === "") el.removeAttribute("style");
  });
};

/** The element tilts in 3D to face the pointer. */
const tilt: Behavior = (env, entry, options, reduce) => {
  if (reduce) return;
  const { gsap } = env;
  const el = entry.el;
  const max = number(options.max, 10);
  let xTo: any;
  let yTo: any;
  entry.run(() => {
    gsap.set(el, { transformPerspective: 900 });
    xTo = gsap.quickTo(el, "rotationX", { duration: 0.5, ease: "power3.out" });
    yTo = gsap.quickTo(el, "rotationY", { duration: 0.5, ease: "power3.out" });
  });
  listen(entry, el, "pointermove", (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const box = el.getBoundingClientRect();
    xTo(-((event.clientY - box.top) / box.height - 0.5) * 2 * max);
    yTo(((event.clientX - box.left) / box.width - 0.5) * 2 * max);
  });
  listen(entry, el, "pointerleave", () => {
    xTo(0);
    yTo(0);
  });
};

/** Smooth scrolling for the page, with the element as the scrolling content. */
const smooth: Behavior = (env, entry, options, reduce) => {
  const Smoother = env.plugins.ScrollSmoother;
  if (reduce || !Smoother) return;
  const el = entry.el;
  if (el === document.body || el === document.documentElement) {
    env.warn("smooth goes on a wrapper inside <body>, not on <body> itself", el);
    return;
  }
  if (Smoother.get()) return;
  const parent = el.parentElement;
  let wrapper = parent && parent !== document.body && parent.id === "smooth-wrapper" ? parent : undefined;
  let smoother: any;
  // ScrollSmoother gives the body a fixed height and restyles the wrapper, and leaves both that
  // way when it goes. Note what was written there, to put it back.
  const body = document.body;
  const bodyHeight = body.style.height;
  const existed = !!wrapper || !!document.getElementById("smooth-wrapper");
  if (!existed && spareWrapper) {
    el.before(spareWrapper);
    spareWrapper.appendChild(el);
    wrapper = spareWrapper;
  }
  const styles: Array<[Element, string | null]> = [[el, el.getAttribute("style")]];
  if (wrapper) styles.push([wrapper, wrapper.getAttribute("style")]);
  entry.run(() => {
    smoother = Smoother.create({ content: el, wrapper, smooth: number(options.amount, 1), effects: true });
  });
  // Without a wrapper of yours, ScrollSmoother makes one around the content.
  const made: HTMLElement | null = existed ? null : smoother.wrapper();
  const handBack = () => {
    // Not if smooth scrolling was switched on again in the meantime.
    if (Smoother.get()) return;
    body.style.height = bodyHeight;
    if (body.getAttribute("style") === "") body.removeAttribute("style");
    for (const [node, style] of styles) {
      if (style === null) node.removeAttribute("style");
      else node.setAttribute("style", style);
    }
    if (made && made.parentNode && made !== el && made.contains(el)) {
      made.replaceWith(...Array.from(made.childNodes));
      spareWrapper = made;
    }
  };
  entry.cleanups.push(() => {
    if (!smoother) return;
    smoother.kill();
    handBack();
  });
};

function top(target: any, offset: number): number {
  if (typeof target === "number") return target;
  const found = resolveRef(document.body, target);
  return found ? found.getBoundingClientRect().top + window.scrollY - offset : 0;
}

/** A link that glides to its target instead of jumping. */
const scrollTo: Behavior = (env, entry, options, reduce) => {
  const { gsap } = env;
  const el = entry.el;
  listen(entry, el, "click", (event: MouseEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
    let target = options.target !== undefined ? options.target : el.getAttribute("href");
    if (target === null || target === "") return;
    if (target === "top" || target === "#") target = 0;
    let offset = 0;
    if (typeof target === "string") {
      if (target !== "max") {
        const found = target[0] === "#" || target[0] === "." ? resolveRef(document.body, target) : null;
        if (!found) return;
        offset = parseFloat(getComputedStyle(found).scrollMarginTop) || 0;
      }
    }
    if (reduce) {
      // No glide, but a class on a button still has to get the visitor there.
      if (!el.hasAttribute("href")) window.scrollTo(0, target === "max" ? document.documentElement.scrollHeight : top(target, offset));
      return;
    }
    event.preventDefault();
    const timing = (entry.spec.groups.view && entry.spec.groups.view.vars) || {};
    const smoother = env.plugins.ScrollSmoother && env.plugins.ScrollSmoother.get();
    if (smoother && typeof target === "string" && target !== "max") {
      smoother.scrollTo(target, true, `top ${offset}px`);
    } else {
      // An earlier glide is replaced first (and frees the CSS), then this one calms it again.
      gsap.to(window, {
        scrollTo: { y: target, offsetY: offset, autoKill: true, onAutoKill: freeScroll },
        duration: number(timing.duration, 1),
        ease: env.ease(timing.ease || "power3.inOut"),
        overwrite: true,
        onComplete: freeScroll,
        onInterrupt: freeScroll,
      });
      calmScroll();
    }
    if (typeof target === "string" && target[0] === "#" && history.replaceState) history.replaceState(null, "", target);
  });
};

/** The order matters: smooth scrolling has to exist before anything reads scroll positions. */
export const BEHAVIORS: Array<[string, Behavior]> = [
  ["smooth", smooth],
  ["marquee", marquee],
  ["magnetic", magnetic],
  ["tilt", tilt],
  ["scrollTo", scrollTo],
];
