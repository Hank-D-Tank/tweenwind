import type { EffectResult, Entry, Env } from "./env";
import { byDocument, childrenOf, forgetIn, resolveRef, resolveRefs } from "./env";
import type { Group, PresetResult, Vars } from "./types";
import { animates } from "./parse";
import { resolvePreset } from "./presets";
import { EFFECTS } from "./effects";
import { BEHAVIORS } from "./behaviors";
import { guardPin } from "./guard";
import { hold, release } from "./hold";

/** Tween settings that may be written inside `from-[...]` or `to-[...]` next to the values. */
const TWEEN_KEYS = [
  "duration",
  "delay",
  "ease",
  "stagger",
  "repeat",
  "repeatDelay",
  "yoyo",
  "yoyoEase",
  "overwrite",
  "immediateRender",
  "lazy",
  "id",
  "startAt",
];
const TRANSFORMS =
  /^(x|y|z|xPercent|yPercent|scale|scaleX|scaleY|rotate|rotation|rotationX|rotationY|rotationZ|rotateX|rotateY|rotateZ|skewX|skewY|translateX|translateY|translateZ|transformPerspective|transformOrigin|perspective)$/;
const PIECE_STAGGER: Record<string, number> = { chars: 0.03, words: 0.06, lines: 0.1 };
const FOCUSABLE = "a[href],button,input,select,textarea,summary,[tabindex],[contenteditable]";
/** These turn Enter and Space into a click (or need the keys for typing) by themselves. */
const KEYED = "a[href],button,input,select,textarea,summary,[contenteditable]";

interface Part {
  from: Vars;
  to: Vars;
  timing: Vars;
}

interface Motion extends Part {
  /** Nothing moves the element away from how the page looks on its own. */
  natural: boolean;
  /** Properties to remove from the element when the tween ends. */
  clear: string[];
  /** Presets that add their own tweens instead of (or next to) from and to values. */
  builders: Array<(timeline: any, targets: Element[], timing: Vars) => void>;
  /** A loop that starts when the reveal before it has finished: `gs-fade-up gs-float`. */
  loop: Part | null;
}

export interface Built {
  unit: any;
  natural: boolean;
  loop: boolean;
  labels?: boolean;
  scroll?: EffectResult["scroll"];
  decorative?: boolean;
  /** Every element this animates and what it was built from, when that is more than one: a timeline's container and its steps. */
  subjects?: Map<Element, string>;
  /**
   * Set on a hover, press or click that only moves away from the natural state (a lift, say).
   * It writes nothing until it plays: call `engage` right before, and `rest` when it is back at
   * its start, and the element is handed back untouched in between.
   */
  engage?: () => void;
  rest?: () => void;
  /** Puts the element back to plain HTML. Only safe when `natural` is true. */
  finish: () => void;
}

/**
 * Elements with a one-time reveal that has not finished yet. A hover, press or click animation
 * on one of them waits until the reveal has landed, so the two never fight over a property and
 * the hover starts from the finished look, not from somewhere half way.
 */
const reveals = new WeakMap<Element, any>();

/**
 * The classes an entrance was built from. When the library has to rebuild an element for its own
 * reasons (the window crossed a breakpoint, a list changed, `gs.refresh()`), an entrance that
 * has already played with these same classes does not play again.
 */
const stamp = (entry: Entry, group: Group) => entry.spec.signature.split("|")[0] + "/" + group.key;
const played = (entry: Entry, subject: Element, mark: string) => !!entry.seen && entry.seen.get(subject) === mark;
/** True for a group that plays one time: on load, or the first time it scrolls into view. */
const oneTime = (group: Group) =>
  group.kind === "load" ||
  (group.kind === "view" && group.scrub === undefined && !group.pin && !group.toggleClass && !group.actions && group.play !== "replay" && group.play !== "reverse");

const STALE = ["opacity", "visibility", "transform", "translate", "rotate", "scale", "filter", "clip-path"];

/**
 * A copy of an element that was part way through a reveal (cloneNode, a list template) carries
 * the half-way styles with it. This wipes them, so the copy starts clean like any new element.
 */
export function wipe(el: Element) {
  el.removeAttribute("data-gs-enter");
  const style = (el as HTMLElement).style;
  if (!style) return;
  for (const name of STALE) style.removeProperty(name);
  if (el.getAttribute("style") === "") el.removeAttribute("style");
}

interface UnitOptions {
  paused: boolean;
  /** Animate exactly these instead of working the targets out. */
  targets?: Element[];
  /** Timeline-wide defaults that sit under the element's own classes. */
  defaults?: Vars;
  /** Leave the stagger out. The caller spaces the units itself. */
  plain?: boolean;
  /** Where the start and complete events are sent. */
  eventTarget?: Element;
  /**
   * A step of a timeline that something other than the scroll opens (a click, a hover, the page
   * load). Until it opens, what it hides is out of the page altogether, as a closed menu should be.
   */
  sealed?: boolean;
}

const interactive = (group: Group) => group.kind !== "view" && group.kind !== "load";
const some = (vars: Vars) => Object.keys(vars).length > 0;

function openClip(value: string): string | null {
  if (/^inset\(/.test(value)) return "inset(0% 0% 0% 0%)";
  const circle = /^circle\(.*?(\sat\s.*)?\)$/.exec(value);
  return circle ? `circle(150%${circle[1] || " at 50% 50%"})` : null;
}

/** Works out the start values, the end values and the timing for a group. */
function resolveMotion(env: Env, group: Group, defaults?: Vars, sealed = false): Motion {
  const { config, presets } = env;
  const from: Vars = {};
  const to: Vars = {};
  const preset: Vars = {};
  const inline: Vars = {};
  const builders: Motion["builders"] = [];
  const loops: PresetResult[] = [];
  let builtNatural = true;

  let list = group.presets;
  const bare = !list.length && !group.from && !group.to && !group.effect;
  if (bare && (group.staggered || group.children || group.split || group.targetSel)) {
    list = [{ name: config.preset, arg: undefined }];
  }
  for (const item of list) {
    const found = presets.get(item.name);
    if (!found) continue;
    const result = resolvePreset(found, item.arg, config);
    if (!found.entrance && result.vars && result.vars.repeat === -1) {
      loops.push(result);
      continue;
    }
    Object.assign(from, result.from);
    Object.assign(to, result.to);
    Object.assign(preset, result.vars);
    if (result.build) {
      builders.push(result.build);
      builtNatural = builtNatural && !!result.natural;
    }
  }
  Object.assign(from, group.from);
  Object.assign(to, group.to);

  // A hover on the element itself cannot begin while the element is out of the pointer's reach.
  // So what would hide it completely (autoAlpha) only makes it see-through: `hover:gs-fade`
  // rests invisible and fades in under the pointer, instead of never being found.
  //
  // A reveal that waits for the scroll has to stay within reach too. Someone moving through the
  // page with the Tab key or a screen reader gets to an element before the scrollbar does, and
  // what is `visibility: hidden` is not there for them at all: Tab skips it, a screen reader
  // never reads it. So until it plays it is only see-through. Focusing it scrolls it into view,
  // and that plays it. (A step of a menu that opens on a click is the opposite case: closed
  // means out of reach, so those keep autoAlpha.)
  const reachable = group.kind === "view" && !sealed;
  if (reachable || (interactive(group) && !group.viaGroup && !group.triggerSel)) {
    for (const side of [from, to]) {
      if (!("autoAlpha" in side)) continue;
      side.opacity = side.autoAlpha;
      delete side.autoAlpha;
    }
  }

  // A loop next to a reveal waits for the reveal: `gs-fade-up gs-float` fades up once, then floats.
  // A loop on its own is the main animation, so `gs-duration` and friends tune it.
  let loop: Part | null = null;
  if (loops.length) {
    const parts: Part = { from: {}, to: {}, timing: {} };
    for (const result of loops) {
      Object.assign(parts.from, result.from);
      Object.assign(parts.to, result.to);
      Object.assign(parts.timing, result.vars);
    }
    if (some(from) || some(to) || builders.length) {
      parts.timing.ease = env.ease(parts.timing.ease);
      loop = parts;
    } else {
      Object.assign(from, parts.from);
      Object.assign(to, parts.to);
      Object.assign(preset, parts.timing);
    }
  }

  for (const side of [from, to]) {
    for (const key of TWEEN_KEYS) {
      if (key in side) {
        inline[key] = side[key];
        delete side[key];
      }
    }
  }

  const natural = !some(to) && builtNatural;
  const clear: string[] = [];
  const px = (value: any) => (typeof value === "number" ? value + "px" : value);
  if ("blur" in from) {
    from.filter = `blur(${px(from.blur)})`;
    delete from.blur;
    if (!("filter" in to) && !("blur" in to)) {
      to.filter = "blur(0px)";
      clear.push("filter");
    }
  }
  if ("blur" in to) {
    to.filter = `blur(${px(to.blur)})`;
    delete to.blur;
    if (!("filter" in from)) from.filter = "blur(0px)";
  }
  if (typeof from.clipPath === "string" && !("clipPath" in to)) {
    const open = openClip(from.clipPath);
    if (open) {
      to.clipPath = open;
      clear.push("clipPath");
    }
  }

  // Tied to the scrollbar, a move follows it evenly unless an ease class says otherwise. With the
  // usual ease-out it would run ahead: most of the way there in the first third of the scroll.
  const tied = group.scrub !== undefined && !group.timeline;
  const base = interactive(group) ? { duration: 0.35, ease: "power2.out" } : { duration: config.duration, ease: tied ? "none" : config.ease };
  const timing: Vars = { ...base, ...defaults, ...preset, ...inline, ...group.vars };
  timing.ease = env.ease(timing.ease);
  return { from, to, timing, natural, clear, builders, loop };
}

function targetsOf(env: Env, el: HTMLElement, group: Group): Element[] {
  if (group.targetSel) {
    try {
      const selector = /^\s*[>+~]/.test(group.targetSel) ? ":scope " + group.targetSel : group.targetSel;
      return Array.from(el.querySelectorAll(selector));
    } catch {
      return [];
    }
  }
  // A child with animation classes of its own keeps them. Two reveals on one element would
  // each take the other's hidden start for the finished look, and it would never show.
  return group.children || group.staggered ? childrenOf(el).filter((child) => !env.selfAnimated(child)) : [el];
}

function resolveStagger(env: Env, group: Group, timing: Vars, count: number, pieces?: string): any {
  let stagger = timing.stagger;
  if (stagger === undefined && count > 1) stagger = pieces ? PIECE_STAGGER[pieces] : env.config.stagger;
  if (group.staggerFrom && stagger !== undefined) {
    stagger = typeof stagger === "object" ? { ...stagger, from: group.staggerFrom } : { each: stagger, from: group.staggerFrom };
  }
  return stagger;
}

function pick(source: Vars, keys: string[]): Vars {
  const out: Vars = {};
  for (const key of keys) out[key] = source[key];
  return out;
}

/** How much room a text mask gets around its piece, in em. Enough for descenders, accents and tight tracking. */
const MASK_Y = 0.3;
const MASK_X = 0.16;

/**
 * A mask clips at the edge of the line box. With a line-height under 1, or negative letter
 * spacing, parts of the letters sit outside that box and would be cut off. So the mask clips
 * a little outside its box instead. A clip-path with negative insets does that without
 * changing the size of anything, where padding and margins would.
 */
function roomy(masks: HTMLElement[]) {
  for (const mask of masks) {
    mask.style.overflow = "visible";
    mask.style.clipPath = `inset(-${MASK_Y}em -${MASK_X}em)`;
  }
}

/**
 * With room in the mask, "100%" has to mean the piece's own size plus that room, or its edge
 * would peek in. Every size is read here in one go, before any tween writes a style, so the
 * browser lays the text out once for the element and not once for each piece.
 */
function clearMask(vars: Vars, pieces: Element[]): Vars {
  const axes = (
    [
      ["yPercent", "offsetHeight", MASK_Y],
      ["xPercent", "offsetWidth", MASK_X],
    ] as const
  ).filter(([key]) => typeof vars[key] === "number" && vars[key]);
  if (!axes.length || !pieces.length) return vars;
  const out: Vars = { ...vars };
  const fontSize = parseFloat(getComputedStyle(pieces[0]).fontSize) || 16;
  for (const [key, size, room] of axes) {
    const value = vars[key];
    const factors = pieces.map((piece) => 1 + (room * fontSize) / ((piece as HTMLElement)[size] || 1));
    out[key] = (index: number) => value * (factors[index] || 1);
  }
  return out;
}

/** Adds the tweens for one motion to a timeline. Values only on one side tween to or from the natural state. */
function fill(unit: any, targets: Element[], motion: Motion, timing: Vars, masked = false) {
  const clear = motion.clear;
  const from = masked ? clearMask(motion.from, targets) : motion.from;
  const to = masked ? clearMask(motion.to, targets) : motion.to;
  const fromKeys = Object.keys(from);
  const toKeys = Object.keys(to);
  const both = fromKeys.filter((key) => key in to);
  const onlyFrom = fromKeys.filter((key) => !(key in to));
  const onlyTo = toKeys.filter((key) => !(key in from));
  if (onlyFrom.length) unit.from(targets, { ...pick(from, onlyFrom), ...timing }, 0);
  if (both.length) {
    const end: Vars = { ...pick(to, both), ...timing };
    const cleared = clear.filter((key) => both.includes(key));
    if (cleared.length) end.clearProps = cleared.join(",");
    unit.fromTo(targets, pick(from, both), end, 0);
  }
  if (onlyTo.length) unit.to(targets, { ...pick(to, onlyTo), ...timing }, 0);
  for (const build of motion.builders) build(unit, targets, timing);

  const loop = motion.loop;
  if (loop) {
    const at = unit.duration();
    // immediateRender off: the loop's own start values must not show while the reveal runs.
    if (some(loop.from) && some(loop.to)) unit.fromTo(targets, loop.from, { ...loop.to, ...loop.timing, immediateRender: false }, at);
    else if (some(loop.to)) unit.to(targets, { ...loop.to, ...loop.timing }, at);
    else if (some(loop.from)) unit.from(targets, { ...loop.from, ...loop.timing, immediateRender: false }, at);
  }
}

/** The CSS properties a motion writes to. */
function cssProps(motion: Motion): string[] {
  const props = new Set<string>();
  const keys = [...Object.keys(motion.from), ...Object.keys(motion.to)];
  if (motion.loop) keys.push(...Object.keys(motion.loop.from), ...Object.keys(motion.loop.to));
  for (const key of keys) {
    if (TRANSFORMS.test(key)) props.add("transform");
    else if (key === "autoAlpha") props.add("opacity").add("visibility");
    else if (key === "keyframes") props.add("transform").add("opacity");
    else props.add(key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()));
  }
  return Array.from(props);
}

/**
 * A CSS transition on a property GSAP is animating makes every frame chase the last one, which
 * looks like lag. This switches the transition off for just those properties and hands back
 * a function that restores it.
 */
function calm(targets: Element[], props: string[]): () => void {
  if (!props.length) return () => {};
  const saved: Array<[HTMLElement, string]> = [];
  const off = props.map((prop) => `${prop} 0s`).join(", ");
  for (const target of targets) {
    const style = (target as HTMLElement).style;
    if (!style) continue;
    const computed = getComputedStyle(target);
    if (!computed.transitionDuration.split(",").some((duration) => parseFloat(duration) > 0)) continue;
    saved.push([target as HTMLElement, style.transition]);
    style.transition = `${computed.transition}, ${off}`;
  }
  return () => saved.forEach(([target, value]) => (target.style.transition = value));
}

function emit(target: Element, name: string, group: Group) {
  target.dispatchEvent(new CustomEvent("gs:" + name, { bubbles: true, detail: { trigger: group.key } }));
}

/**
 * Builds the animation for one group on one element as a small timeline.
 * `owner` is the entry that cleans it up: the element itself, or the timeline it is a step of.
 */
export function makeUnit(env: Env, owner: Entry, subject: Entry, group: Group, options: UnitOptions): Built | null {
  const { gsap } = env;
  const el = subject.el;
  const motion = resolveMotion(env, group, options.defaults, options.sealed);
  const eventTarget = options.eventTarget || el;
  let unit: any;
  owner.run(() => {
    unit = gsap.timeline({
      paused: options.paused,
      data: { kind: group.kind },
      onStart: () => emit(eventTarget, "start", group),
      onComplete: () => emit(eventTarget, "complete", group),
    });
  });

  let restore = () => {};
  let foreignUndo = () => {};
  /** This unit's name in the list of who is holding which inline style (see hold.ts). */
  const key = {};
  let held: { targets: Element[]; props: string[] } | null = null;
  const letGo = () => {
    if (held) release(held.targets, held.props, key);
  };
  let split: any = null;
  let effect: EffectResult | null = null;
  let natural = motion.natural;
  /** Writes nothing until it plays: a hover, press or click that only moves away from the natural state. */
  let lazy = false;

  // An entrance ends where the page puts the element, so the offset it starts from must not
  // count when scroll positions are measured. Marked elements have their transform ignored
  // by the stylesheet for the instant ScrollTrigger measures.
  let marked: Element[] = [];
  const mark = (targets: Element[]) => {
    if (!motion.natural || interactive(group)) return;
    marked = targets;
    for (const target of targets) target.setAttribute("data-gs-enter", "");
  };

  if (group.effect) {
    const make = EFFECTS[group.effect.name];
    effect = make ? make({ env, owner, subject, group, timing: motion.timing, chosen: group.vars, unit }) : null;
    if (!effect) {
      unit.kill();
      return null;
    }
    natural = !!effect.natural;
    if (effect.changed) subject.check = effect.changed;
    // `gs-count gs-fade-up`: a number that counts while it fades in.
    if (some(motion.from) || some(motion.to) || motion.builders.length) {
      if (effect.scroll) {
        env.warn(`${group.effect.name} cannot share an element with another animation. Put one of them on a wrapper.`, el);
      } else {
        const timing = { ...motion.timing };
        delete timing.stagger;
        const props = cssProps(motion);
        restore = calm([el], props);
        held = { targets: [el], props };
        hold([el], props, key);
        owner.run(() => fill(unit, [el], motion, timing));
        mark([el]);
        natural = natural && motion.natural;
      }
    }
  } else if (group.split && !options.targets) {
    const types = group.split;
    const finest = types.includes("chars") ? "chars" : types.includes("words") ? "words" : "lines";
    const coarsest = types.includes("lines") ? "lines" : types.includes("words") ? "words" : "chars";
    const wanted = new Set(types);
    if (finest === "chars") wanted.add("words");
    let first = true;
    subject.split = true;
    const label = el.getAttribute("aria-label");
    foreignUndo = () => {
      // The text was replaced under us. Keep the new text, drop the label we put on the old one.
      if (label === null) el.removeAttribute("aria-label");
      else el.setAttribute("aria-label", label);
    };
    // Made outside the context on purpose: the cleanup below decides how to undo it.
    // `overwrite: false` because an earlier split is always undone here, never by SplitText.
    split = env.plugins.SplitText.create(el, {
      overwrite: false,
      type: Array.from(wanted).join(","),
      mask: group.mask ? coarsest : undefined,
      autoSplit: types.includes("lines"),
      onSplit: (self: any) => {
        const pieces = self[finest] as Element[];
        const progress = first ? 0 : unit.progress();
        const timing = { ...motion.timing };
        const stagger = options.plain ? undefined : resolveStagger(env, group, timing, pieces.length, finest);
        if (stagger === undefined) delete timing.stagger;
        else timing.stagger = stagger;
        if (group.mask) roomy(self.masks);
        owner.run(() => {
          unit.clear();
          fill(unit, pieces, motion, timing, !!group.mask);
          if (!first) unit.progress(progress);
        });
        mark(pieces);
        first = false;
        env.touch(el);
      },
    });
    env.touch(el);
  } else {
    const targets = options.targets || targetsOf(env, el, group);
    if (!targets.length) {
      unit.kill();
      return null;
    }
    const timing = { ...motion.timing };
    const stagger = options.plain ? undefined : resolveStagger(env, group, timing, targets.length);
    if (stagger === undefined) delete timing.stagger;
    else timing.stagger = stagger;
    const props = cssProps(motion);
    restore = calm(targets, props);
    held = { targets, props };
    lazy = interactive(group) && !some(motion.from) && !motion.builders.length && !motion.loop;
    if (!lazy) hold(targets, props, key);
    owner.run(() => fill(unit, targets, motion, timing));
    mark(targets);
  }

  const undo = () => {
    restore();
    restore = () => {};
    for (const target of marked) target.removeAttribute("data-gs-enter");
    marked = [];
    if (split) {
      if (subject.foreign) {
        split.kill();
        foreignUndo();
      } else {
        split.revert();
      }
      split = null;
      env.touch(el);
    }
    if (effect && effect.cleanup) effect.cleanup();
    if (effect && effect.changed) subject.check = undefined;
    effect = null;
    subject.split = false;
    letGo();
    if (el.getAttribute("style") === "") el.removeAttribute("style");
  };
  owner.cleanups.push(undo);
  subject.units.push(unit);

  return {
    unit,
    natural,
    loop: unit.totalDuration() > 1e6,
    scroll: effect ? effect.scroll : undefined,
    decorative: effect ? effect.decorative : undefined,
    engage: lazy ? () => hold(held!.targets, held!.props, key) : undefined,
    rest: lazy
      ? () => {
          letGo();
          // Next time it starts from how the element looks then, not from what it remembered.
          unit.invalidate();
        }
      : undefined,
    finish: () => {
      const parts = new Set<any>([unit]);
      for (const part of unit.getChildren(true, true, true)) {
        parts.add(part);
        // The hidden helper tween GSAP makes for a "from" is kept by the context as well.
        if (part._startAt) parts.add(part._startAt);
      }
      unit.revert();
      undo();
      subject.units = subject.units.filter((other) => other !== unit);
      // Let go of everything that still points at the element, so a removed list item can be freed.
      const at = owner.cleanups.indexOf(undo);
      if (at >= 0) owner.cleanups.splice(at, 1);
      forgetIn(owner.ctx, parts);
    },
  };
}

/**
 * A one-time reveal. While it has not finished, the element is listed in `reveals`, so hovers
 * wait for it. When it is done nothing is left behind: the element is plain HTML again.
 */
function tidyWhenDone(env: Env, entry: Entry, built: Built, eventTarget: Element, group: Group): () => void {
  if (!built.natural || built.loop) return () => {};
  const unit = built.unit;
  const subjects = built.subjects || new Map([[eventTarget, stamp(entry, group)]]);
  const landed = () => subjects.forEach((_mark, subject) => reveals.get(subject) === unit && reveals.delete(subject));
  /** Lands it and forgets it, so nothing here keeps pointing at the element. */
  const settle = () => {
    landed();
    const at = entry.cleanups.indexOf(landed);
    if (at >= 0) entry.cleanups.splice(at, 1);
  };
  subjects.forEach((_mark, subject) => reveals.set(subject, unit));
  entry.cleanups.push(landed);
  unit.eventCallback("onComplete", () => {
    emit(eventTarget, "complete", group);
    settle();
    const seen = (entry.seen = entry.seen || new WeakMap());
    subjects.forEach((mark, subject) => seen.set(subject, mark));
    if (!env.config.cleanup) return;
    // A plain timer, not a delayed call: this runs inside the animation's own callback, and
    // GSAP would file a delayed call made here under the element for good.
    setTimeout(() => {
      if (entry.built && entry.units.includes(unit)) built.finish();
    }, 0);
  });
  return settle;
}

/**
 * Turns a class value into a ScrollTrigger position.
 *
 * Scrubbed positions are clamped to what the page can scroll to, so an element in the first
 * screen starts at the beginning of its animation and one near the bottom can still finish.
 */
function scrollPosition(env: Env, value: any, sideways: boolean, clamp = false): any {
  if (typeof value !== "string") return value;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  if (sideways) return value.replace(/\btop\b/g, "left").replace(/\bbottom\b/g, "right");
  if (!clamp || /^[+-]=|^clamp\(|max/.test(value)) return value;
  const [major, minor] = String(env.gsap.version || "3.12").split(".").map(Number);
  return major > 3 || (major === 3 && minor >= 12) ? `clamp(${value})` : value;
}

/**
 * A footer line 40px from the bottom never gets its top to 88% of the screen, so it would
 * wait forever. When a start is out of reach, it becomes "the page reached the bottom".
 */
function withinReach(env: Env, vars: Vars) {
  const ScrollTrigger = env.plugins.ScrollTrigger;
  let busy = false;
  vars.onRefresh = (self: any) => {
    const max = ScrollTrigger.maxScroll(self.scroller);
    if (busy || self.start < max) return;
    busy = true;
    self.setPositions(max - 1, Math.max(self.end, max));
    busy = false;
  };
}

/**
 * A scrubbed element inside a pinned section is on screen for the whole pin, but its measured
 * range ends when the section would have scrolled away. This stretches the range by the pin's
 * length, so the animation runs for as long as the element can be seen.
 */
function throughPin(env: Env, vars: Vars, pinned: Element) {
  const ScrollTrigger = env.plugins.ScrollTrigger;
  let busy = false;
  vars.onRefresh = (self: any) => {
    if (busy) return;
    const pin = ScrollTrigger.getAll().find((trigger: any) => trigger.pin === pinned);
    // A pin at the very top of the page starts a hair before zero, hence the one pixel of slack.
    if (!pin || self.start > pin.start + 1 || self.end < pin.start) return;
    busy = true;
    self.setPositions(self.start, self.end + (pin.end - pin.start));
    busy = false;
  };
}

/** True when the element has a vertical scrollbar of its own that can actually move. */
function scrolls(node: Element): boolean {
  const overflow = getComputedStyle(node).overflowY;
  if (overflow !== "auto" && overflow !== "scroll" && overflow !== "overlay") return false;
  if (node.scrollHeight <= node.clientHeight + 1) return false;
  // Reveals waiting a little below their place make a box look taller than it is (a row that
  // only scrolls sideways, say). Look again with those offsets switched off.
  if (!node.querySelector("[data-gs-enter]")) return true;
  const root = document.documentElement;
  const measuring = root.hasAttribute("data-gs-measure");
  root.setAttribute("data-gs-measure", "");
  const real = node.scrollHeight > node.clientHeight + 1;
  if (!measuring) root.removeAttribute("data-gs-measure");
  return real;
}

/**
 * The page usually scrolls the window. In an app shell it is often a div (or the body) that
 * scrolls instead, and then nothing would ever trigger. This finds that element, or null for
 * the window. Siblings share the answer through `cache`, so a long list asks once.
 */
export function findScroller(el: Element, cache?: Map<Element, Element | null>): Element | null {
  const visited: Element[] = [];
  let found: Element | null | undefined;
  for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    if (cache && cache.has(node)) {
      found = cache.get(node);
      break;
    }
    visited.push(node);
    if (scrolls(node)) {
      found = node;
      break;
    }
  }
  if (found === undefined) {
    found = null;
    const root = document.documentElement;
    const body = document.body;
    if (body && root.scrollHeight <= window.innerHeight + 1 && body.scrollHeight > body.clientHeight + 1) {
      const overflow = getComputedStyle(body).overflowY;
      if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") found = body;
    }
  }
  if (cache) for (const node of visited) cache.set(node, found);
  return found;
}

/** True when an ancestor makes `position: fixed` behave like `absolute`, which breaks a normal pin. */
function boxedIn(el: Element): boolean {
  for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (
      style.transform !== "none" ||
      style.filter !== "none" ||
      style.perspective !== "none" ||
      style.willChange.includes("transform") ||
      /paint|layout|strict|content/.test(style.contain) ||
      (style.backdropFilter && style.backdropFilter !== "none")
    ) {
      return true;
    }
  }
  return false;
}

/** Connects an animation (or just a pin or a class toggle) to the scroll position. */
function wireView(env: Env, entry: Entry, group: Group, built: Built | null, reduce: boolean) {
  const { config } = env;
  const ScrollTrigger = env.plugins.ScrollTrigger;
  const el = entry.el;
  const unit = built ? built.unit : null;
  const hint = (built && built.scroll) || {};
  const setting = group.scrub !== undefined ? group.scrub : hint.scrub;
  const scrubbing = setting !== undefined;
  const container = entry.horizontal && entry.horizontal.containerAnimation;
  const sideways = !!container && container !== unit;
  const smoothed = !!(env.plugins.ScrollSmoother && env.plugins.ScrollSmoother.get());
  let pin = group.pin !== undefined ? group.pin : hint.pin;
  if (pin && sideways) {
    env.warn("pin does not work inside a horizontal section", el);
    pin = undefined;
  }

  let animation = unit;
  if (reduce) {
    // Less motion: decoration and loops do not run, one-shots jump to the end,
    // and what the scrollbar drives stays, because the visitor is the one moving it.
    if (built && (built.decorative || (built.loop && !scrubbing))) {
      built.finish();
      return;
    }
    if (!scrubbing && unit) {
      // What ends as the page is written (a count, an odometer, typed text) is simply left as written.
      if (built!.natural) built!.finish();
      else unit.progress(1);
      animation = null;
    }
  }
  // A pin or a class toggle is not motion, so those are kept either way.
  if (!ScrollTrigger || (!animation && !pin && !group.toggleClass)) return;

  const trigger = (group.triggerSel && resolveRef(el, group.triggerSel)) || hint.trigger || el;
  const vars: Vars = { trigger, markers: !!group.markers || config.debug };
  if (animation) vars.animation = animation;
  if (sideways) vars.containerAnimation = container;
  // Inside a pinned section, positions after the pin starts are pushed down by the pin's length.
  // Not when the pinned section itself is the trigger: ScrollTrigger already knows where that is.
  else if (entry.pinnedBy && entry.pinnedBy.built && trigger !== entry.pinnedBy.el && entry.pinnedBy.el.contains(trigger)) {
    vars.pinnedContainer = entry.pinnedBy.el;
  }
  if (!sideways && !smoothed) {
    const scroller = trigger === el && entry.scroller !== undefined ? entry.scroller : findScroller(trigger, env.scrollers);
    if (scroller) vars.scroller = scroller;
  }
  const at = (value: any, clamp = false) => scrollPosition(env, value, sideways, clamp);
  const pinLength = typeof pin === "string" ? pin : undefined;
  let once = false;

  if (scrubbing) {
    vars.scrub = setting === "default" ? (reduce || smoothed ? true : config.scrub) : setting;
    vars.start = at(group.start || hint.start || (pin ? "top top" : "top bottom"), true);
    vars.end = at(group.end || pinLength || hint.end || (pin ? "+=100%" : "bottom top"), true);
    if (vars.pinnedContainer && !pin && !group.end) throughPin(env, vars, vars.pinnedContainer);
  } else {
    vars.start = at(group.start || (pin ? "top top" : config.start));
    if (pin) vars.end = at(group.end || pinLength || "+=100%");
    else if (group.end) vars.end = at(group.end);
    if (animation) {
      if (group.actions) vars.toggleActions = group.actions;
      else if (built!.loop) vars.toggleActions = "play pause resume pause";
      else if (group.play === "replay") vars.toggleActions = "play none none reset";
      else if (group.play === "reverse") vars.toggleActions = "play none none reverse";
      else if (pin || group.toggleClass) vars.toggleActions = "play none none none";
      else once = vars.once = true;
    }
    if (!pin && !sideways) withinReach(env, vars);
  }
  // Rebuilt after it already played: leave it as the plain element it has become.
  if (once && built && built.natural && !built.labels && played(entry, el, stamp(entry, group))) {
    built.finish();
    return;
  }
  if (pin) {
    vars.pin = el;
    vars.anticipatePin = 1;
    if (!smoothed && !vars.scroller && boxedIn(el)) vars.pinType = "transform";
  }
  if (group.toggleClass) vars.toggleClass = { targets: el, className: group.toggleClass };
  if (hint.invalidate) vars.invalidateOnRefresh = true;
  if (group.snap !== undefined && scrubbing) {
    if (group.snap === true) {
      if (hint.snap) vars.snap = hint.snap;
      else if (built && built.labels) vars.snap = { snapTo: "labels", duration: { min: 0.2, max: 0.6 }, ease: "power1.inOut" };
    } else {
      vars.snap = group.snap;
    }
  }
  Object.assign(vars, group.st);

  const parent = el.parentNode;
  if (vars.pin || !animation) measureEarlier(ScrollTrigger);
  entry.run(() => ScrollTrigger.create(vars));
  if (vars.pin) {
    const wrap = el.parentElement;
    entry.spacer = wrap && wrap.classList.contains("pin-spacer") ? wrap : null;
    if (parent) entry.cleanups.push(guardPin(el, parent, () => env.drop(entry)));
  }
  if (once && built && animation) tidyWhenDone(env, entry, built, el, group);
}

/**
 * GSAP measures a trigger that drives a timeline 10 ms after it is made, and one without a
 * timeline (a pin, the watcher of a staggered child) at once. So inside one build pass a new
 * trigger can be measured before an earlier pin has made its room on the page, and take itself
 * for on screen when it is thousands of pixels further down. Measuring the earlier ones first,
 * in order, puts the page in its real shape.
 *
 * One at a time matters too. When the page opens half way down (a reload, the Back button), a
 * reveal that is already scrolled past plays, tidies itself away and takes itself off
 * ScrollTrigger's list. If that happens inside GSAP's own catch-up loop (a new pin measuring
 * everything before it), GSAP reads past the end of the list and throws, with every pin above
 * still taken apart.
 */
function measureEarlier(ScrollTrigger: any) {
  for (const earlier of ScrollTrigger.getAll()) {
    if (!earlier.end && earlier.enabled !== false) earlier.refresh(0, 1);
  }
}

/**
 * Staggered children that are not tied to the scrollbar. Each child waits for its own turn to
 * come into view, and the ones that arrive together are spaced out. A grid animates row by row.
 */
function wireBatch(env: Env, entry: Entry, group: Group) {
  const { gsap, config } = env;
  const ScrollTrigger = env.plugins.ScrollTrigger;
  if (!ScrollTrigger) return;
  const el = entry.el;
  const motion = resolveMotion(env, group);
  const stagger = resolveStagger(env, group, motion.timing, 2);
  const container = entry.horizontal && entry.horizontal.containerAnimation;
  const made = new Map<Element, { built: Built; trigger: any; settle: () => void }>();
  const mark = stamp(entry, group);
  const again = group.play === "replay" || group.play === "reverse";
  let queue: Element[] = [];
  let waiting = false;

  const release = () => {
    waiting = false;
    const list = queue.filter((child) => child.isConnected && made.has(child)).sort(byDocument);
    queue = [];
    const delayOf = typeof stagger === "object" ? gsap.utils.distribute(stagger) : (index: number) => index * (stagger || 0);
    list.forEach((child, index) => {
      made.get(child)!.built.unit.delay(Math.max(0, delayOf(index, child, list))).restart(true);
    });
  };

  const arrive = (child: Element) => {
    queue.push(child);
    if (!waiting) {
      waiting = true;
      Promise.resolve().then(release);
    }
  };

  const add = (child: HTMLElement) => {
    if (made.has(child) || env.selfAnimated(child)) return;
    if (!again && motion.natural && played(entry, child, mark)) return;
    // Only this function marks a child, so a mark on a new one means it is a copy made mid-reveal.
    if (child.hasAttribute("data-gs-enter")) wipe(child);
    const built = makeUnit(env, entry, entry, group, { paused: true, targets: [child], plain: true, eventTarget: child });
    if (!built) return;
    const vars: Vars = {
      trigger: child,
      start: scrollPosition(env, group.start || config.start, !!container),
      markers: !!group.markers || config.debug,
      onEnter: () => arrive(child),
    };
    if (container) vars.containerAnimation = container;
    else withinReach(env, vars);
    if (!container && entry.pinnedBy && entry.pinnedBy.built) vars.pinnedContainer = entry.pinnedBy.el;
    if (!container) {
      const scroller = findScroller(child, env.scrollers);
      if (scroller) vars.scroller = scroller;
    }
    if (group.play === "replay") vars.onLeaveBack = () => built.unit.pause(0);
    else if (group.play === "reverse") vars.onLeaveBack = () => built.unit.reverse();
    else vars.once = true;
    Object.assign(vars, group.st);
    let trigger: any;
    entry.run(() => (trigger = ScrollTrigger.create(vars)));
    made.set(child, { built, trigger, settle: vars.once ? tidyWhenDone(env, entry, built, child, group) : () => {} });
  };


  measureEarlier(ScrollTrigger);
  childrenOf(el).forEach(add);
  entry.sync = () => {
    if (!entry.built) return;
    // Children that left take their trigger with them, so a list that keeps changing does not pile them up.
    made.forEach((item, child) => {
      if (child.parentElement === el) return;
      item.trigger.kill();
      item.settle();
      item.built.finish();
      forgetIn(entry.ctx, new Set([item.trigger]));
      made.delete(child);
    });
    childrenOf(el).forEach(add);
    // A sort or a filter moves the items without changing the height of the page, so nothing
    // else would measure them again. The ones that are now on screen get their turn.
    made.forEach((item) => item.trigger.enabled && item.trigger.refresh());
  };
}

function batches(group: Group): boolean {
  return (
    group.kind === "view" &&
    !!(group.children || group.staggered) &&
    !group.targetSel &&
    !group.split &&
    !group.effect &&
    !group.triggerSel &&
    !group.actions &&
    !group.pin &&
    group.scrub === undefined
  );
}

function listen(entry: Entry, target: EventTarget, type: string, handler: (event: any) => void) {
  target.addEventListener(type, handler);
  entry.cleanups.push(() => target.removeEventListener(type, handler));
}

/**
 * Plays on hover, click, focus or press and runs backwards when it ends.
 *
 * The listeners sit on the document and ask, at the moment of the event, which elements are
 * the triggers. So a trigger named with `gs-trigger-[...]` may be added later or replaced.
 */
function wireEvent(env: Env, entry: Entry, group: Group, built: Built, reduce: boolean) {
  const el = entry.el;
  const unit = built.unit;
  const selector = !group.viaGroup && group.triggerSel ? group.triggerSel : null;
  let fixed: Element[] = [el];
  if (group.viaGroup) {
    const near = el.closest(`.${env.config.prefix}-group,[data-gs~="group"]`);
    if (!near) {
      env.warn(`group-${group.kind} needs an ancestor with the ${env.config.prefix}-group class`, el);
      return;
    }
    fixed = [near];
  }
  if (reduce) {
    if (built.loop) {
      built.finish();
      return;
    }
    unit.timeScale(1000);
  }

  // Usually the element itself. With gs-trigger it is the nearest ancestor that matches, or,
  // when no ancestor does, every element on the page that matches: an open button, a close
  // button and the links inside a menu can all drive the same animation.
  const sources = (): Element[] => (selector ? resolveRefs(el, selector) : fixed);
  const hit = (node: any): Element | undefined => (node instanceof Node ? sources().find((source) => source.contains(node)) : undefined);
  /**
   * Listens on the triggers. When they are fixed, the listener sits on them and costs nothing
   * anywhere else. With a selector it sits on the document and asks, at the moment of the event,
   * which elements match, so a trigger may be added later or replaced.
   */
  const on = (type: string, handler: (event: any, source: Element) => void) => {
    if (!selector) {
      for (const source of fixed) listen(entry, source, type, (event) => handler(event, source));
      return;
    }
    listen(entry, document, type, (event) => {
      const source = hit(event.target);
      if (source) handler(event, source);
    });
  };
  /** True when the pointer or the focus came from, or is going to, somewhere outside the trigger. */
  const crossing = (event: any, source: Element) => !(event.relatedTarget instanceof Node && source.contains(event.relatedTarget));
  const labelled = () => sources().filter((source) => source.hasAttribute("aria-expanded"));
  let announced = false;
  const announce = (open: boolean) => {
    announced = announced || open;
    labelled().forEach((source) => source.setAttribute("aria-expanded", String(open)));
    // Remembered on the element, so it is still open after a rebuild (see the end of this function).
    const opened = (entry.opened = entry.opened || new Set());
    if (open) opened.add(group.key);
    else opened.delete(group.key);
  };
  // A reveal that has not landed yet owns the element. Remember that the visitor asked, and
  // start as soon as it is done. Leaving before that just forgets the request.
  let wanted = false;
  const attempt = () => {
    if (!wanted) return;
    if (reveals.has(el)) {
      env.gsap.delayedCall(0.1, attempt);
      return;
    }
    wanted = false;
    if (built.engage) built.engage();
    unit.play();
  };
  entry.cleanups.push(() => (wanted = false));
  const isOpen = () => wanted || (built.loop ? !unit.paused() : unit.progress() > 0 && !unit.reversed());
  const play = () => {
    if (wanted) return;
    wanted = true;
    attempt();
  };
  const back = () => {
    wanted = false;
    if (built.loop) {
      unit.pause();
      return;
    }
    unit.reverse();
    // Sent back before it had moved at all (in and out within one frame): it will never
    // "arrive back", so hand the element back now.
    if (built.rest && !unit.totalTime()) built.rest();
  };
  const toggle = () => {
    const open = isOpen();
    if (open) back();
    else play();
    announce(!open);
  };
  const activates = (event: KeyboardEvent) => event.key === "Enter" || event.key === " ";

  // At rest the element is handed back exactly as written, so the page's own CSS (a :hover
  // transform, say) keeps working between hovers.
  if (built.rest && !built.loop) unit.eventCallback("onReverseComplete", built.rest);
  if (selector && !sources().length) {
    env.warn(`nothing matches ${env.config.prefix}-trigger-[${selector}] yet. The ${group.kind} animation starts working when it does.`, el);
  }

  switch (group.kind) {
    case "hover":
      on("pointerover", (event, source) => event.pointerType !== "touch" && crossing(event, source) && play());
      on("pointerout", (event, source) => event.pointerType !== "touch" && crossing(event, source) && back());
      break;
    case "focus":
      on("focusin", (event, source) => crossing(event, source) && play());
      on("focusout", (event, source) => crossing(event, source) && back());
      break;
    case "press": {
      let down = false;
      const release = () => {
        if (!down) return;
        down = false;
        back();
      };
      const press = () => {
        down = true;
        play();
      };
      on("pointerdown", press);
      on("pointerout", (event, source) => crossing(event, source) && release());
      // A focused button pressed with Enter or Space should feel the same as one pressed with a finger.
      on("keydown", (event) => activates(event) && !event.repeat && press());
      on("focusout", release);
      // Letting go counts wherever it happens, not only over the element.
      listen(entry, window, "pointerup", release);
      listen(entry, window, "pointercancel", release);
      listen(entry, window, "keyup", (event: KeyboardEvent) => activates(event) && release());
      break;
    }
    case "click": {
      // Something that is not a link or a button cannot be reached with the keyboard.
      // Make it a button, so it can.
      const borrowed = new Map<Element, [string | null, string | null]>();
      for (const source of sources()) {
        if (source.matches(FOCUSABLE)) continue;
        borrowed.set(source, [source.getAttribute("tabindex"), source.getAttribute("role")]);
        source.setAttribute("tabindex", "0");
        if (!source.hasAttribute("role")) source.setAttribute("role", "button");
      }
      entry.cleanups.push(() =>
        borrowed.forEach(([tabindex, role], source) => {
          if (tabindex === null) source.removeAttribute("tabindex");
          if (role === null) source.removeAttribute("role");
        }),
      );
      const close = () => {
        back();
        announce(false);
      };
      on("click", toggle);
      on("keydown", (event, source) => {
        // A real button or link turns Enter and Space into a click by itself. Anything else needs this.
        if (!activates(event) || event.target !== source || source.matches(KEYED)) return;
        event.preventDefault();
        toggle();
      });
      // `gs-outside`: a click anywhere else closes it, the way a dropdown does.
      if (group.outside) {
        listen(entry, document, "click", (event: MouseEvent) => {
          if (!isOpen()) return;
          // The path as it was when the click happened: a button that removed itself in its own
          // handler still counts as inside.
          const path = event.composedPath();
          if (path.includes(el) || sources().some((source) => path.includes(source))) return;
          close();
        });
      }
      // A menu or a dialog opened by a button closes on Escape and hands the focus back.
      if (group.outside || selector || labelled().length) {
        listen(entry, document, "keydown", (event: KeyboardEvent) => {
          if (event.key !== "Escape" || !isOpen() || !(group.outside || labelled().length)) return;
          close();
          const first = labelled()[0] as HTMLElement | undefined;
          if (first) first.focus();
        });
      }
      break;
    }
  }
  // Rebuilt or removed while open: do not leave a button saying it is still expanded.
  entry.cleanups.push(() => {
    if (announced) labelled().forEach((source) => source.setAttribute("aria-expanded", "false"));
  });
  // Rebuilt while it was open (the window crossed a breakpoint, a phone was turned): it stays open.
  if (group.kind === "click" && entry.opened && entry.opened.has(group.key)) {
    if (built.engage) built.engage();
    unit.progress(1);
    announce(true);
  }
}

function wire(env: Env, entry: Entry, group: Group, built: Built, reduce: boolean) {
  if (group.kind === "view") {
    wireView(env, entry, group, built, reduce);
  } else if (group.kind === "load") {
    if (reduce) {
      if (built.loop || built.natural) built.finish();
      else built.unit.progress(1);
      return;
    }
    if (built.natural && !built.loop && !built.labels && played(entry, entry.el, stamp(entry, group))) {
      built.finish();
      return;
    }
    tidyWhenDone(env, entry, built, entry.el, group);
    built.unit.play();
  } else {
    wireEvent(env, entry, group, built, reduce);
  }
}

/** True when the reduced motion setting means this group should simply not run. */
function skipped(group: Group, reduce: boolean, natural: boolean): boolean {
  return reduce && natural && !interactive(group) && group.scrub === undefined && !group.effect;
}

function buildGroup(env: Env, entry: Entry, group: Group, reduce: boolean) {
  if (!animates(group)) {
    if (group.kind === "view" && (group.pin || group.toggleClass)) wireView(env, entry, group, null, reduce);
    return;
  }
  const motion = resolveMotion(env, group);
  if (batches(group)) {
    if (!reduce) {
      wireBatch(env, entry, group);
    } else if (!motion.natural) {
      // Less motion: no reveal, but children that end somewhere else still have to get there.
      const settled = makeUnit(env, entry, entry, group, { paused: true });
      if (settled) settled.unit.progress(1);
    }
    return;
  }
  if (skipped(group, reduce, motion.natural && !motion.loop)) return;
  const built = makeUnit(env, entry, entry, group, { paused: true });
  if (built) wire(env, entry, group, built, reduce);
}

/**
 * A `gs-timeline` container: its own animation first, then every step inside it, in page order.
 * A timeline inside another timeline is one of its steps; `host` is then the outer container,
 * which owns the cleanup, and nothing is wired here.
 */
function buildTimeline(env: Env, entry: Entry, group: Group, reduce: boolean, host: Entry | null, once = oneTime(group), sealed = group.kind !== "view"): Built {
  const { gsap } = env;
  const home = host || entry;
  const vars = group.vars;
  const defaults: Vars = {};
  if (vars.duration !== undefined) defaults.duration = vars.duration;
  if (vars.ease !== undefined) defaults.ease = vars.ease;

  let master: any;
  home.run(() => {
    master = gsap.timeline({
      paused: !host,
      data: { kind: group.kind },
      delay: vars.delay || 0,
      repeat: vars.repeat || 0,
      repeatDelay: vars.repeatDelay || 0,
      yoyo: !!vars.yoyo,
      onStart: () => emit(entry.el, "start", group),
      onComplete: () => emit(entry.el, "complete", group),
    });
  });
  entry.scope = "timeline";
  entry.units.push(master);

  const builts: Built[] = [];
  const settled = reduce && (group.kind === "load" || (group.kind === "view" && group.scrub === undefined));
  const subjects = new Map<Element, string>();
  const base = stamp(entry, group);
  let skippedSteps = 0;
  const add = (subject: Entry, stepGroup: Group, index: number) => {
    const nested = !!stepGroup.timeline && subject !== entry;
    const mark = subject === entry ? base : stamp(subject, stepGroup) + "@" + base;
    // A step that already made its entrance stays as it is. Only what is new plays.
    if (once && !nested && played(home, subject.el, mark)) {
      skippedSteps++;
      return;
    }
    const built = nested
      ? buildTimeline(env, subject, stepGroup, reduce, home, once, sealed)
      : makeUnit(env, home, subject, stepGroup, { paused: false, defaults, sealed });
    if (!built) return;
    // Less motion, and the timeline is about to jump to its end: a step that ends as the page
    // is written does not need to be there at all.
    if (settled && built.natural) {
      built.finish();
      return;
    }
    builts.push(built);
    if (built.subjects) built.subjects.forEach((value, key) => subjects.set(key, value));
    else subjects.set(subject.el, mark);
    home.run(() => {
      master.add(built.unit, stepGroup.at !== undefined ? stepGroup.at : undefined);
      const time = built.unit.startTime();
      master.addLabel("step-" + index, time);
      if (stepGroup.label) master.addLabel(stepGroup.label, time);
    });
  };

  let index = 0;
  const own = { ...group, timeline: false, vars: { ...defaults, ...(vars.stagger !== undefined ? { stagger: vars.stagger } : {}) } };
  if (animates(own)) add(entry, own, index++);

  const steps: Entry[] = [];
  env.entries.forEach((other) => {
    if (other.owner === entry) steps.push(other);
  });
  steps.sort((a, b) => byDocument(a.el, b.el));
  entry.steps = steps.map((step) => step.el);
  for (const step of steps) {
    const stepGroup = step.spec.groups.view;
    if (!stepGroup || stepGroup.off) continue;
    add(step, stepGroup, index++);
    step.el.setAttribute("data-gs-ready", "");
  }
  home.run(() => master.addLabel("end", master.duration()));

  const built: Built = {
    unit: master,
    natural: builts.every((step) => step.natural),
    loop: master.totalDuration() > 1e6,
    labels: true,
    subjects,
    finish: () => {
      builts.forEach((step) => step.finish());
      master.kill();
      entry.units = entry.units.filter((other) => other !== master);
    },
  };
  if (host) return built;
  if (!builts.length && skippedSteps) {
    // Every step has already played. There is nothing to wait for.
    built.finish();
    return built;
  }
  wire(env, entry, group, built, reduce);
  return built;
}

/** Builds everything an element's classes ask for. */
export function buildEntry(env: Env, entry: Entry) {
  const { el, spec } = entry;
  entry.built = true;
  el.setAttribute("data-gs-ready", "");
  if (spec.off) return;

  const reduce = env.reduced() && !spec.motionOk && !spec.motionManual;
  for (const [name, behavior] of BEHAVIORS) {
    if (name === "smooth" && spec.behaviors[name]) behavior(env, entry, spec.behaviors[name], reduce);
  }

  for (const key in spec.groups) {
    const group = spec.groups[key];
    if (group.off) continue;
    // Its timeline, or the one it is a step of, plays the base group.
    if (group.kind === "view" && entry.owner) continue;
    if (group.timeline) buildTimeline(env, entry, group, reduce, null);
    else buildGroup(env, entry, group, reduce);
  }

  for (const [name, behavior] of BEHAVIORS) {
    if (name !== "smooth" && spec.behaviors[name]) behavior(env, entry, spec.behaviors[name], reduce);
  }
}

/** Undoes everything `buildEntry` did, leaving the element as it was written. */
export function destroyEntry(entry: Entry) {
  if (!entry.built) return;
  entry.built = false;
  const el = entry.el;
  const gone = !el.isConnected;
  const spacer = entry.spacer;
  // Something put in the pinned element's place (replaceWith) sits inside the spacer.
  // Move it out first, or it would be thrown away with the spacer.
  if (spacer && spacer.isConnected) {
    for (const node of Array.from(spacer.childNodes)) if (node !== el) spacer.before(node);
  }
  try {
    entry.ctx.revert();
  } catch {
    // A node GSAP wanted to restore is already gone. Nothing left to undo there.
  }
  for (const cleanup of entry.cleanups.splice(0).reverse()) {
    try {
      cleanup();
    } catch {
      // Same as above: cleaning up something the page already removed.
    }
  }
  // Undoing a pin puts the element back where its spacer was. If the page had removed the
  // element (el.remove()), that would bring it back from the dead.
  if (gone && el.isConnected) el.remove();
  if (el.getAttribute("style") === "") el.removeAttribute("style");
  entry.units = [];
  entry.sync = undefined;
  entry.scope = undefined;
  entry.containerAnimation = undefined;
  entry.spacer = null;
  entry.steps = undefined;
  entry.split = false;
  entry.check = undefined;
  entry.foreign = false;
}
