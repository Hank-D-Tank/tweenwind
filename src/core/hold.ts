/**
 * Who is writing which inline style on an element right now, and what was there before anyone did.
 *
 * Several animations can share an element: a reveal and a hover, a scrub and a press. Each one
 * says which properties it is about to write (`hold`) and says when it is done (`release`). The
 * first to arrive notes what the author had written inline. The last to leave puts exactly that
 * back. In between nobody resets anything, so one animation ending never undoes what another
 * is still doing.
 *
 * GSAP's own undo is not enough for transforms. It folds the CSS `translate`, `rotate` and
 * `scale` properties (the ones Tailwind 4 writes) into one inline transform and sets them to
 * `none`. Left like that, a `:hover { scale: 1.1 }` in the page's CSS does nothing afterwards.
 * On a shape inside an SVG it writes the `transform` attribute instead, as a matrix.
 */

interface Held {
  /** The inline values as the author wrote them, one for each name in `names(prop)`. */
  base: string[];
  /** For a transform on an SVG shape: the attributes GSAP rewrites, as the author wrote them. */
  attrs?: Array<[string, string | null]>;
  holders: Set<object>;
}

interface Record {
  props: Map<string, Held>;
  /** The style attribute as the author typed it, and the same styles as the browser spells them. */
  attr: string | null;
  css: string;
}

const holds = new WeakMap<Element, Record>();
const names = (prop: string) => (prop === "transform" ? ["transform", "translate", "rotate", "scale", "transform-origin"] : [prop]);
const SHAPE_ATTRS = ["transform", "data-svg-origin"];
const isShape = (target: Element) => typeof SVGElement !== "undefined" && target instanceof SVGElement && !!target.ownerSVGElement;

export function hold(targets: Element[], props: string[], key: object) {
  for (const target of targets) {
    const style = (target as HTMLElement).style;
    if (!style) continue;
    let record = holds.get(target);
    if (!record) holds.set(target, (record = { props: new Map(), attr: target.getAttribute("style"), css: style.cssText }));
    for (const prop of props) {
      let held = record.props.get(prop);
      if (!held) {
        held = { base: names(prop).map((name) => style.getPropertyValue(name)), holders: new Set() };
        if (prop === "transform" && isShape(target)) held.attrs = SHAPE_ATTRS.map((name) => [name, target.getAttribute(name)]);
        record.props.set(prop, held);
      }
      held.holders.add(key);
    }
  }
}

export function release(targets: Element[], props: string[], key: object) {
  for (const target of targets) {
    const record = holds.get(target);
    if (!record) continue;
    const style = (target as HTMLElement).style;
    const free: Array<[string, Held]> = [];
    for (const prop of props) {
      const held = record.props.get(prop);
      if (!held || !held.holders.delete(key) || held.holders.size) continue;
      record.props.delete(prop);
      free.push([prop, held]);
    }
    const last = !record.props.size;
    if (last) holds.delete(target);
    const cache = (target as any)._gsap;
    // Nothing to hand back when GSAP never touched it.
    if (!free.length || !cache) continue;
    for (const [prop, held] of free) {
      names(prop).forEach((name, at) => {
        if (held.base[at]) style.setProperty(name, held.base[at]);
        else style.removeProperty(name);
      });
      for (const [name, value] of held.attrs || []) {
        if (value === null) target.removeAttribute(name);
        else target.setAttribute(name, value);
      }
      // GSAP keeps its own copy of an element's transform. Tell it to read the element again
      // next time, now that ours is gone. Done by hand and not with gsap.set, because a tween
      // made here, inside an animation's callback, would be kept by its context for good.
      if (prop === "transform") cache.uncache = 1;
    }
    // The same styles again, so the attribute can read exactly as it was typed, spaces and all.
    if (last && style.cssText === record.css) {
      if (record.attr === null) target.removeAttribute("style");
      else if (target.getAttribute("style") !== record.attr) target.setAttribute("style", record.attr);
    } else if (target.getAttribute("style") === "") {
      target.removeAttribute("style");
    }
  }
}
