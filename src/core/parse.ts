import type { Config, Group, Preset, Spec, TriggerKind, Vars } from "./types";
import { camel, parseAny, parseObject, parseTime, splitPair, unscore } from "./value";

export interface ParseContext {
  config: Config;
  presets: Map<string, Preset>;
  /** Tells whether a media query matches right now. */
  media: (query: string) => boolean;
}

interface Value {
  /** The text after the name, with the outer brackets removed. `null` when the class is just the name. */
  raw: string | null;
  bracket: boolean;
}

type Handler = (group: Group, value: Value, spec: Spec, cx: ParseContext) => void | false;

const TRIGGERS: TriggerKind[] = ["load", "hover", "click", "focus", "press"];
const STAGGER_ORIGINS = ["start", "center", "end", "edges", "random"];
const SPLIT_TYPES = ["chars", "words", "lines"];
const TIMING = ["duration", "delay", "ease", "repeat", "repeat-delay", "yoyo"];
const EFFECT_PLUGINS: Record<string, string[]> = {
  draw: ["DrawSVGPlugin"],
  scramble: ["ScrambleTextPlugin"],
  type: ["TextPlugin"],
};

const text = (value: Value): string => unscore(value.raw || "");

function number(value: Value): number | undefined {
  if (value.raw === null || value.raw === "") return undefined;
  const parsed = Number(value.raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** A distance for `pan`: px as a plain number, or a number with px, vw, vh or % (of the element). */
const isLength = (value: unknown): boolean =>
  (typeof value === "number" && !Number.isNaN(value)) || (typeof value === "string" && /^-?(?:\d+\.?\d*|\.\d+)(?:px|vw|vh|%)$/.test(value));

function need(spec: Spec, ...plugins: string[]) {
  for (const plugin of plugins) if (!spec.plugins.includes(plugin)) spec.plugins.push(plugin);
}

/** `from-[y:50,opacity:0]`, `from-y-50` and `from-x-[-100%]` all end up in the same object. */
function mergeVars(group: Group, side: "from" | "to", value: Value): void | false {
  if (value.raw === null || value.raw === "") return false;
  let vars: Vars;
  if (value.bracket) {
    vars = parseObject(value.raw);
  } else {
    const pair = splitPair(value.raw);
    if (!pair) return false;
    vars = { [camel(pair[0])]: parseAny(pair[1]) };
  }
  if (!Object.keys(vars).length) return false;
  group[side] = Object.assign(group[side] || {}, vars);
}

const time = (key: string): Handler => (group, value) => {
  const seconds = value.raw === null ? undefined : parseTime(value.raw);
  if (seconds === undefined) return false;
  group.vars[key] = seconds;
};

const effect = (name: string): Handler => (group, value, spec) => {
  group.effect = { name, arg: value.raw === null ? undefined : parseAny(value.raw) };
  need(spec, ...(EFFECT_PLUGINS[name] || []));
};

const behavior = (name: string, read: (value: Value, current: Vars) => void | false): Handler => (_group, value, spec) => {
  const current = (spec.behaviors[name] = spec.behaviors[name] || {});
  return read(value, current);
};

export const UTILITIES: Record<string, Handler> = {
  from: (group, value) => mergeVars(group, "from", value),
  to: (group, value) => mergeVars(group, "to", value),

  duration: time("duration"),
  delay: time("delay"),
  "repeat-delay": time("repeatDelay"),
  ease: (group, value, spec) => {
    if (!value.raw) return false;
    group.vars.ease = text(value);
    if (isCustomEase(group.vars.ease)) need(spec, "CustomEase");
  },
  repeat: (group, value) => {
    const count = value.raw === null || value.raw === "infinite" ? -1 : number(value);
    if (count === undefined) return false;
    group.vars.repeat = count;
  },
  yoyo: (group) => {
    group.vars.yoyo = true;
  },
  stagger: (group, value) => {
    group.staggered = true;
    if (value.raw === null) return;
    if (value.bracket && value.raw.includes(":")) {
      group.vars.stagger = parseObject(value.raw);
      return;
    }
    const origin = value.raw.replace(/^from-/, "");
    if (STAGGER_ORIGINS.includes(origin)) {
      group.staggerFrom = origin;
      return;
    }
    const seconds = parseTime(value.raw);
    if (seconds === undefined) return false;
    group.vars.stagger = seconds;
  },

  children: (group) => {
    group.children = true;
  },
  target: (group, value) => {
    if (!value.raw) return false;
    group.targetSel = text(value);
  },
  split: (group, value, spec) => {
    const types = (value.raw || "words").split(",").map((part) => part.trim());
    if (types.some((type) => !SPLIT_TYPES.includes(type))) return false;
    group.split = Array.from(new Set([...(group.split || []), ...types]));
    need(spec, "SplitText");
  },
  mask: (group) => {
    group.mask = true;
  },

  scrub: (group, value) => {
    if (value.raw === null) {
      group.scrub = "default";
      return;
    }
    if (value.raw === "true") {
      group.scrub = true;
      return;
    }
    const seconds = parseTime(value.raw);
    if (seconds === undefined) return false;
    group.scrub = seconds === 0 ? true : seconds;
  },
  pin: (group, value) => {
    if (value.raw === null) {
      group.pin = true;
      return;
    }
    const amount = number(value);
    group.pin = amount === undefined ? text(value) : `+=${amount}%`;
  },
  start: (group, value) => {
    if (!value.raw) return false;
    group.start = position(text(value), "top");
  },
  end: (group, value) => {
    if (!value.raw) return false;
    group.end = position(text(value), "bottom");
  },
  once: (group) => {
    group.play = "once";
  },
  replay: (group) => {
    group.play = "replay";
  },
  reverse: (group) => {
    group.play = "reverse";
  },
  actions: (group, value) => {
    if (!value.raw) return false;
    group.actions = text(value);
  },
  markers: (group) => {
    group.markers = true;
  },
  trigger: (group, value) => {
    if (!value.raw) return false;
    group.triggerSel = text(value);
  },
  toggle: (group, value) => {
    if (!value.raw) return false;
    group.toggleClass = text(value);
  },
  outside: (group) => {
    group.outside = true;
  },
  snap: (group, value) => {
    group.snap = value.raw === null ? true : parseAny(value.raw);
  },
  st: (group, value) => {
    if (!value.raw) return false;
    group.st = Object.assign(group.st || {}, parseObject(value.raw));
  },

  timeline: (group) => {
    group.timeline = true;
  },
  at: (group, value) => {
    if (!value.raw) return false;
    group.at = parseAny(value.raw);
  },
  with: (group) => {
    group.at = "<";
  },
  label: (group, value) => {
    if (!value.raw) return false;
    group.label = text(value);
  },

  parallax: effect("parallax"),
  horizontal: effect("horizontal"),
  frames: (group, value) => {
    group.effect = { name: "frames", arg: value.raw === null ? undefined : text(value) };
  },
  count: effect("count"),
  odometer: (group, value) => {
    // A start value (`odometer-90`), stops to rest on (`odometer-[27,64,100]`), or `odometer-steps`
    // and `odometer-steps-3` for stops picked for you.
    let arg: any;
    if (value.raw !== null) {
      const steps = /^steps(?:-(\d+))?$/.exec(value.raw);
      if (steps) {
        arg = { steps: steps[1] ? Number(steps[1]) : 4 };
      } else if (value.raw.includes(",")) {
        const stops = value.raw.split(",").map((part) => Number(part.trim()));
        if (stops.some((stop) => Number.isNaN(stop))) return false;
        arg = { stops };
      } else {
        arg = number(value);
        if (arg === undefined) return false;
      }
    }
    group.effect = { name: "odometer", arg };
  },
  draw: effect("draw"),
  scramble: (group, value, spec) => {
    group.effect = { name: "scramble", arg: value.raw === null ? undefined : text(value) };
    need(spec, "ScrambleTextPlugin");
  },
  type: effect("type"),

  marquee: behavior("marquee", (value, current) => {
    if (value.raw === null) return;
    const speed = Number(value.raw);
    if (!Number.isNaN(speed)) {
      current.speed = speed;
      return;
    }
    // Several in one class: `marquee-right-120` or `marquee-pause-scroll`.
    const parts = value.raw.split("-");
    const seen: Vars = {};
    for (const part of parts) {
      if (part === "left" || part === "right") seen.direction = part;
      else if (part === "pause" || part === "scroll") seen[part] = true;
      else if (part !== "" && !Number.isNaN(Number(part))) seen.speed = Number(part);
      else return false;
    }
    Object.assign(current, seen);
  }),
  magnetic: behavior("magnetic", (value, current) => {
    const strength = number(value);
    if (strength !== undefined) current.strength = strength;
  }),
  tilt: behavior("tilt", (value, current) => {
    const degrees = number(value);
    if (degrees !== undefined) current.max = degrees;
  }),
  // `pan` (30px both ways), `pan-80`, `pan-x-15vw`, `pan-y--40`, or `pan-[x:15vw,y:20,duration:1.4]`.
  pan: behavior("pan", (value, current) => {
    if (value.raw === null) {
      current.x = current.y = 30;
      return;
    }
    if (value.bracket) {
      const vars = parseObject(value.raw);
      for (const key of Object.keys(vars)) {
        if (key === "x" || key === "y") {
          if (!isLength(vars[key])) return false;
          current[key] = vars[key];
        } else if (key === "duration" && typeof vars[key] === "number") current.duration = vars[key];
        else return false;
      }
      return;
    }
    const match = /^(?:([xy])-)?(.+)$/.exec(value.raw)!;
    const amount = parseAny(match[2]);
    if (!isLength(amount)) return false;
    if (match[1]) current[match[1]] = amount;
    else current.x = current.y = amount;
  }),
  smooth: (_group, value, spec) => {
    const amount = number(value);
    spec.behaviors.smooth = { amount: amount === undefined ? 1 : amount };
    need(spec, "ScrollTrigger", "ScrollSmoother");
  },
  "scroll-to": (_group, value, spec) => {
    spec.behaviors.scrollTo = { target: value.raw === null ? undefined : parseAny(value.raw) };
    need(spec, "ScrollToPlugin");
  },

  off: (group, _value, spec) => {
    group.off = true;
    if (group.key === "view") spec.off = true;
  },
  group: (_group, _value, spec) => {
    spec.isGroup = true;
  },
  "motion-ok": (_group, _value, spec) => {
    spec.motionOk = true;
  },
};

/** One word like `center` or `80%` means "when my top (or bottom) reaches that point". */
function position(value: string, edge: string): string {
  return /\s/.test(value) || /^[+-]=/.test(value) || /^\d+(\.\d+)?$/.test(value) ? value : `${edge} ${value}`;
}

function newGroup(key: string, kind: TriggerKind, viaGroup: boolean): Group {
  return { key, kind, viaGroup, presets: [], vars: {} };
}

function variantQuery(name: string, config: Config): string | null {
  const points = config.breakpoints;
  if (name in points) return `(min-width: ${points[name]}px)`;
  if (name.startsWith("max-") && name.slice(4) in points) return `(max-width: ${points[name.slice(4)] - 0.02}px)`;
  let match = /^min-\[(.+)\]$/.exec(name);
  if (match) return `(min-width: ${match[1]})`;
  match = /^max-\[(.+)\]$/.exec(name);
  if (match) return `(max-width: ${match[1]})`;
  switch (name) {
    case "portrait":
    case "landscape":
      return `(orientation: ${name})`;
    case "motion-safe":
      return "(prefers-reduced-motion: no-preference)";
    case "motion-reduce":
      return "(prefers-reduced-motion: reduce)";
    case "pointer-fine":
      return "(pointer: fine)";
    case "pointer-coarse":
      return "(pointer: coarse)";
    case "dark":
    case "light":
      return `(prefers-color-scheme: ${name})`;
  }
  return null;
}

/** How specific a media prefix is. Wider breakpoints rank higher, so they are applied last. */
function variantRank(name: string, config: Config): number {
  if (name in config.breakpoints) return config.breakpoints[name];
  const match = /^min-\[([\d.]+)px\]$/.exec(name);
  return match ? Number(match[1]) || 1 : 1;
}

/** True for `md`, `max-lg`, `hover`, `group-click` and the other prefixes a class may carry. */
export function knownVariant(name: string, config: Config): boolean {
  const trigger = name.startsWith("group-") ? name.slice(6) : name;
  return (TRIGGERS as string[]).includes(trigger) || variantQuery(name, config) !== null;
}

/** Pulls the `md:hover:` part off a token. Returns null when the token is not one of ours. */
export function splitToken(token: string, prefix: string | null): { variants: string[]; body: string } | null {
  const match = /^((?:[^:\[\]\s]+(?:\[[^\]]*\])?:)*)(.*)$/.exec(token);
  if (!match) return null;
  let body = match[2];
  if (prefix !== null) {
    if (!body.startsWith(prefix + "-")) return null;
    body = body.slice(prefix.length + 1);
  }
  if (!body) return null;
  const variants = match[1] ? match[1].slice(0, -1).split(":") : [];
  return { variants, body };
}

/** Reads the class list (and `data-gs`) into a description of what to animate, when and how. */
export function parseTokens(classTokens: string[], dataTokens: string[], cx: ParseContext): Spec {
  const { config, presets } = cx;
  const spec: Spec = {
    groups: {},
    behaviors: {},
    off: false,
    isGroup: false,
    motionOk: false,
    motionManual: false,
    media: [],
    plugins: [],
    unknown: [],
    stray: [],
    signature: "",
    empty: true,
    scroll: false,
  };
  const names = sortedNames(presets);
  const used: string[] = [];
  const active: Array<{ token: string; body: string; kind: TriggerKind; viaGroup: boolean; rank: number }> = [];
  const ranks = new Map<Group, number[]>();
  const timed = new Map<Group, string[]>();

  // First pass: which classes apply right now, and how specific is each one?
  const sift = (token: string, prefix: string | null) => {
    const parts = splitToken(token, prefix);
    if (!parts) return;
    spec.empty = false;
    used.push(token);

    let kind: TriggerKind = "view";
    let viaGroup = false;
    let matches = true;
    let rank = 0;
    for (const variant of parts.variants) {
      const trigger = variant.startsWith("group-") ? variant.slice(6) : variant;
      if ((TRIGGERS as string[]).includes(trigger)) {
        kind = trigger as TriggerKind;
        viaGroup = trigger !== variant;
        continue;
      }
      const query = variantQuery(variant, config);
      if (query === null) {
        spec.unknown.push(token);
        return;
      }
      if (variant === "motion-safe" || variant === "motion-reduce") spec.motionManual = true;
      if (!spec.media.includes(query)) spec.media.push(query);
      if (!cx.media(query)) matches = false;
      rank = Math.max(rank, variantRank(variant, config));
    }
    if (matches) active.push({ token, body: parts.body, kind, viaGroup, rank });
  };
  for (const token of classTokens) sift(token, config.prefix);
  for (const token of dataTokens) sift(token, null);

  // Second pass, plain classes first and wider breakpoints last, so `md:` beats the base class
  // and `lg:` beats `md:` whatever order they were typed in.
  active.sort((a, b) => a.rank - b.rank);
  for (const { token, body, kind, viaGroup, rank } of active) {
    const name = names.find((candidate) => body === candidate || body.startsWith(candidate + "-"));
    if (!name) {
      spec.unknown.push(token);
      continue;
    }
    const rest = body.length > name.length ? body.slice(name.length + 1) : null;
    const bracket = !!rest && rest.length > 1 && rest[0] === "[" && rest[rest.length - 1] === "]";
    const value: Value = { raw: bracket ? rest!.slice(1, -1) : rest, bracket };

    const key = (viaGroup ? "group-" : "") + kind;
    const group = (spec.groups[key] = spec.groups[key] || newGroup(key, kind, viaGroup));

    if (name in UTILITIES) {
      if (UTILITIES[name](group, value, spec, cx) === false) spec.unknown.push(token);
      else if (TIMING.includes(name)) timed.set(group, [...(timed.get(group) || []), token]);
      continue;
    }
    const arg = value.raw === null ? undefined : parseAny(value.raw);
    if (arg !== undefined && typeof arg !== "number" && presets.get(name)!.numeric) {
      spec.unknown.push(token);
      continue;
    }
    group.presets.push({ name, arg });
    ranks.set(group, [...(ranks.get(group) || []), rank]);
  }

  // A preset behind a breakpoint replaces the plain one: `gs-fade-up md:gs-fade-left`
  // fades left on desktop, it does not do both.
  ranks.forEach((list, group) => {
    const top = Math.max(...list);
    group.presets = group.presets.filter((_preset, index) => list[index] === top);
  });

  const view = spec.groups.view;
  spec.scroll = !!view && !view.off && (animates(view) || !!view.pin || !!view.toggleClass || !!view.timeline);
  // `load:gs-fade-up gs-duration-2`: the plain class is for a scroll animation, and there is none.
  if (view && !view.off && !spec.scroll && view.at === undefined && !Object.keys(spec.behaviors).length) {
    const elsewhere = Object.keys(spec.groups).some((key) => key !== "view" && animates(spec.groups[key]));
    if (elsewhere) spec.stray = timed.get(view) || [];
  }
  if (spec.behaviors.marquee && spec.behaviors.marquee.scroll) need(spec, "ScrollTrigger");
  spec.signature = used.join(" ") + "|" + spec.media.map((query) => (cx.media(query) ? 1 : 0)).join("");
  return spec;
}

/** True when the group describes something that moves, not only when or where. */
export function animates(group: Group): boolean {
  return !!(
    group.from ||
    group.to ||
    group.presets.length ||
    group.effect ||
    group.children ||
    group.staggered ||
    group.split ||
    group.targetSel
  );
}

/** An SVG path or four cubic-bezier numbers, which need the CustomEase plugin. */
export function isCustomEase(ease: string): boolean {
  return /^M[\d\s.,-]/i.test(ease) || /^(cubic-bezier\()?\s*-?[\d.]+(\s*,\s*-?[\d.]+){3}\s*\)?$/.test(ease);
}

let cachedFor: Map<string, Preset> | null = null;
let cachedSize = -1;
let cachedNames: string[] = [];

/** Longest first, so `fade-up` wins over `fade` and `stagger` over `st`. */
function sortedNames(presets: Map<string, Preset>): string[] {
  if (cachedFor !== presets || cachedSize !== presets.size) {
    cachedNames = [...Object.keys(UTILITIES), ...presets.keys()].sort((a, b) => b.length - a.length);
    cachedFor = presets;
    cachedSize = presets.size;
  }
  return cachedNames;
}

/** Every name a class may start with, for "did you mean" hints. */
export function knownNames(presets: Map<string, Preset>): string[] {
  return sortedNames(presets);
}
