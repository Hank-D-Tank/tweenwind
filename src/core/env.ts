import type { Config, Group, Preset, Spec, Vars } from "./types";

/** Everything the library knows about one element. */
export interface Entry {
  el: HTMLElement;
  spec: Spec;
  built: boolean;
  /** A gsap.context that holds every tween and trigger made for this element. */
  ctx: any;
  /** Runs a function inside the context, so what it creates is cleaned up with the element. */
  run: <T>(fn: () => T) => T;
  cleanups: Array<() => void>;
  /** The GSAP timelines made for this element, for `gs.get()`. */
  units: any[];
  /** The `gs-timeline` container that plays this element's base animation. */
  owner: Entry | null;
  /** Set on a container: its own timeline and what kind of scope it is. */
  scope?: "timeline" | "horizontal";
  /** Set on a `gs-horizontal` section: the animation its descendants measure against. */
  containerAnimation?: any;
  /** The horizontal section this element lives in, if any. */
  horizontal: Entry | null;
  /** The pinned ancestor this element lives in, if any. Its pin length shifts this element's positions. */
  pinnedBy: Entry | null;
  /** Called when the element's children change. */
  sync?: () => void;
  /** The content was replaced from outside (a framework re-rendered it). */
  foreign?: boolean;
  /** True when the element's text was split or rewritten, so outside changes to it need a rebuild. */
  split?: boolean;
  /** For text an effect rewrites itself: true when what is there now is not what the effect put there. */
  check?: () => boolean;
  /** The wrapper ScrollTrigger put around this element to pin it. */
  spacer?: Element | null;
  /** Set on a timeline container: its steps in the order they were added. */
  steps?: Element[];
  /** One-time entrances that have already played, and the classes they were built from. Kept across rebuilds. */
  seen?: WeakMap<Element, string>;
  /** Click animations that are open right now, by trigger. Kept across rebuilds, so an open menu stays open. */
  opened?: Set<string>;
  /** What scrolls this element: an element, or null for the window. Worked out before anything is built. */
  scroller?: Element | null;
}

export interface Env {
  gsap: any;
  plugins: Record<string, any>;
  config: Config;
  presets: Map<string, Preset>;
  entries: Map<Element, Entry>;
  /** True when the visitor asked for less motion and the config respects it. */
  reduced: () => boolean;
  /** Call after changing the DOM inside an element, so the observer does not react to it. */
  touch: (el: Element) => void;
  /** Queues an element and everything inside it to be read and animated. */
  collect: (root: Element) => void;
  /** Takes an element's animations off right now and forgets it. */
  drop: (entry: Entry) => void;
  /** True when the element has scroll or load classes of its own that animate it, so a parent's stagger leaves it alone. */
  selfAnimated: (el: Element) => boolean;
  /** What scrolls the children of an element, remembered for one pass over the page. */
  scrollers: Map<Element, Element | null>;
  warn: (message: string, ...rest: any[]) => void;
  ease: (value: any) => any;
}

export interface ScrollHints {
  scrub?: "default" | number | true;
  pin?: true | string;
  start?: string;
  end?: any;
  trigger?: Element | null;
  snap?: any;
  invalidate?: boolean;
}

export interface EffectResult {
  scroll?: ScrollHints;
  /** Pure decoration, skipped when the visitor asked for less motion. */
  decorative?: boolean;
  /** Ends exactly as the page looks without it, so it can be removed when done. */
  natural?: boolean;
  /** For an effect that rewrites the element's text: true when the page has put other text there. */
  changed?: () => boolean;
  cleanup?: () => void;
}

export interface EffectInput {
  env: Env;
  /** The entry whose context owns the tweens. */
  owner: Entry;
  /** The entry of the element being animated. */
  subject: Entry;
  group: Group;
  /** Resolved timing: defaults, then the preset, then the classes. */
  timing: Vars;
  /** Only what the classes said, to tell a default from a choice. */
  chosen: Vars;
  /** The timeline to add tweens to. */
  unit: any;
}

export type Effect = (input: EffectInput) => EffectResult | null;

export const number = (value: any, fallback: number): number =>
  typeof value === "number" && !Number.isNaN(value) ? value : fallback;

/** Direct children, without the copies a marquee adds. */
export function childrenOf(el: Element): HTMLElement[] {
  return Array.from(el.children).filter((child) => !child.hasAttribute("data-gs-clone")) as HTMLElement[];
}

/** Finds another element by selector: an ancestor first, then anywhere on the page. */
export function resolveRef(el: Element, selector: string): Element | null {
  if (selector === "parent") return el.parentElement;
  try {
    return el.closest(selector) || document.querySelector(selector);
  } catch {
    return null;
  }
}

/** Like resolveRef, but when no ancestor matches it returns every match on the page. */
export function resolveRefs(el: Element, selector: string): Element[] {
  if (selector === "parent") return el.parentElement ? [el.parentElement] : [];
  try {
    const near = el.closest(selector);
    return near ? [near] : Array.from(document.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/**
 * Takes animations out of a gsap.context. A context keeps everything created inside it, and
 * inside the callbacks of what it holds, until the whole context is reverted. For an element
 * that lives as long as the page, that list would only ever grow.
 */
export function forgetIn(ctx: any, parts: Set<any>) {
  const data = ctx && ctx.data;
  if (!Array.isArray(data)) return;
  for (let i = data.length; i--; ) if (parts.has(data[i])) data.splice(i, 1);
}

export function byDocument(a: Node, b: Node): number {
  return a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}
