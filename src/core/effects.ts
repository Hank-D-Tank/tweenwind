import type { Effect, EffectInput } from "./env";
import { number } from "./env";
import { hold, release } from "./hold";

/** Moves the element a little against the scroll. On images it also zooms in so no edge shows. */
const parallax: Effect = ({ owner, subject, group, unit }) => {
  const el = subject.el;
  const amount = number(group.effect!.arg, 20);
  const media = el.matches("img,video,picture,canvas,svg");
  const cover = media ? { scale: 1 + (Math.abs(amount) * 2) / 100 } : {};
  const key = {};
  hold([el], ["transform"], key);
  owner.run(() => {
    unit.fromTo(el, { yPercent: -amount, ...cover }, { yPercent: amount, ...cover, ease: "none", duration: 1 }, 0);
  });
  return {
    decorative: true,
    scroll: { scrub: "default", start: "top bottom", end: "bottom top", trigger: media ? el.parentElement : el },
    cleanup: () => release([el], ["transform"], key),
  };
};

/** Pins the section and slides its first child sideways for as long as it overflows. */
const horizontal: Effect = ({ env, owner, subject, group, unit }) => {
  const el = subject.el;
  let track: Element | null = el.firstElementChild;
  if (group.targetSel) {
    try {
      track = el.querySelector(group.targetSel);
    } catch {
      track = null;
    }
  }
  if (!track) {
    env.warn("horizontal needs a child element to slide", el);
    return null;
  }
  const row = track as HTMLElement;
  const distance = () => Math.max(0, row.scrollWidth - el.clientWidth);
  // In a right-to-left page the row starts on the right, so it slides the other way.
  const side = getComputedStyle(el).direction === "rtl" ? 1 : -1;
  const key = {};
  hold([row], ["transform"], key);
  owner.run(() => {
    unit.to(row, { x: () => side * distance(), ease: "none", duration: 1 }, 0);
  });
  subject.scope = "horizontal";
  subject.containerAnimation = unit;
  const panels = row.children.length;
  return {
    scroll: {
      scrub: "default",
      pin: true,
      start: "top top",
      end: () => "+=" + distance(),
      invalidate: true,
      snap: panels > 1 ? 1 / (panels - 1) : undefined,
    },
    cleanup: () => {
      subject.scope = undefined;
      subject.containerAnimation = undefined;
      release([row], ["transform"], key);
    },
  };
};

/** `/img/frame-[001-120].webp` becomes the 120 file names. A comma list works too. */
export function expandFrames(pattern: string): string[] {
  const match = /\[(\d+)-(\d+)\]/.exec(pattern);
  if (!match) {
    return pattern
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean);
  }
  const first = Number(match[1]);
  const last = Number(match[2]);
  const width = match[1].length;
  const step = first <= last ? 1 : -1;
  const urls: string[] = [];
  for (let i = first; i !== last + step; i += step) {
    urls.push(pattern.replace(match[0], String(i).padStart(width, "0")));
  }
  return urls;
}

/** Plays an image sequence on a canvas. On scroll by default, like a video you scrub by hand. */
const frames: Effect = ({ env, owner, subject, group, unit }) => {
  const el = subject.el;
  const pattern = group.effect!.arg || el.getAttribute("data-gs-frames") || el.getAttribute("data-frames") || "";
  const urls = expandFrames(pattern);
  if (!urls.length) {
    env.warn('frames needs a pattern, for example data-gs-frames="img/frame-[001-120].webp"', el);
    return null;
  }

  let canvas: HTMLCanvasElement;
  let added = false;
  let oldPosition: string | null = null;
  if (el instanceof HTMLCanvasElement) {
    canvas = el;
  } else {
    canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    if (getComputedStyle(el).position === "static") {
      oldPosition = el.style.position;
      el.style.position = "relative";
    }
    el.prepend(canvas);
    env.touch(el);
    added = true;
  }

  const context = canvas.getContext("2d");
  const contain = (el.getAttribute("data-gs-fit") || "cover") === "contain";
  const images: HTMLImageElement[] = [];
  const loaded: boolean[] = [];
  let current = 0;
  let drawn = -1;
  let stopped = false;

  const nearest = (index: number): number => {
    for (let offset = 0; offset < urls.length; offset++) {
      if (loaded[index - offset]) return index - offset;
      if (loaded[index + offset]) return index + offset;
    }
    return -1;
  };

  const draw = () => {
    if (!context) return;
    const index = nearest(Math.round(current));
    if (index < 0 || index === drawn) return;
    const image = images[index];
    const cw = canvas.width;
    const ch = canvas.height;
    const scale = (contain ? Math.min : Math.max)(cw / image.naturalWidth, ch / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    context.clearRect(0, 0, cw, ch);
    context.drawImage(image, (cw - w) / 2, (ch - h) / 2, w, h);
    drawn = index;
  };

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * ratio);
    const h = Math.round(canvas.clientHeight * ratio);
    if (w && h && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
      drawn = -1;
    }
    draw();
  };

  const load = (index: number) =>
    new Promise<void>((resolve) => {
      if (stopped || images[index]) return resolve();
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        loaded[index] = true;
        if (!stopped && nearest(Math.round(current)) === index) {
          drawn = -1;
          draw();
        }
        resolve();
      };
      image.onerror = () => resolve();
      image.src = urls[index];
      images[index] = image;
    });

  // The first frame right away, the rest a few at a time once the canvas is near the screen.
  let next = 1;
  const worker = async () => {
    while (!stopped && next < urls.length) await load(next++);
  };
  const loadRest = () => {
    for (let i = 0; i < 6; i++) worker();
  };
  load(0);
  let near: IntersectionObserver | null = null;
  if (typeof IntersectionObserver === "function") {
    near = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) {
          near!.disconnect();
          near = null;
          loadRest();
        }
      },
      { rootMargin: "150% 0px" },
    );
    near.observe(canvas);
  } else {
    loadRest();
  }

  const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  sizes && sizes.observe(canvas);
  resize();

  // GSAP calls a function property as a getter and a setter. Drawing from the setter means every
  // change of frame reaches the canvas, including the silent seeks a replay or a reset does.
  const state = {
    frame: (value?: number) => {
      if (value !== undefined) {
        current = value;
        draw();
      }
      return current;
    },
  };
  owner.run(() => {
    unit.to(state, { frame: urls.length - 1, ease: "none", duration: 1, snap: "frame" }, 0);
  });

  return {
    scroll: { scrub: "default" },
    cleanup: () => {
      stopped = true;
      near && near.disconnect();
      sizes && sizes.disconnect();
      if (added) {
        canvas.remove();
        if (oldPosition !== null) el.style.position = oldPosition;
        env.touch(el);
      }
    },
  };
};

/**
 * The text effects rewrite what is inside the element. A copy made half way through (cloneNode,
 * a list template) would carry the half-way text, and end on the wrong words or the wrong
 * number. So the element holds its real content in an attribute for as long as an effect is
 * on it, and one that arrives already holding one starts again from that.
 */
function ownContent(env: EffectInput["env"], el: Element): () => void {
  const real = el.getAttribute("data-gs-plain");
  if (real !== null) {
    el.innerHTML = real;
    env.touch(el);
    env.collect(el);
  }
  el.setAttribute("data-gs-plain", el.innerHTML);
  return () => el.removeAttribute("data-gs-plain");
}

/** A number as people write it: 1200, 1,200, 12,50,000 or 99.9. Commas only count between digits. */
const NUMBER = /\d+(?:,\d{2,3})*(?:\.\d+)?/;

interface Found {
  node: Text;
  /** Where the number starts and ends in the text, its minus sign included. */
  start: number;
  end: number;
  negative: boolean;
  /** The digits as written, without the sign. */
  digits: string;
}

function numberIn(node: Text): Found | null {
  const match = NUMBER.exec(node.data);
  if (!match) return null;
  const at = match.index;
  const text = node.data;
  // A dash right before the digits is a minus sign, unless it joins two words: -40, but not COVID-19.
  const dash = at > 0 && (text[at - 1] === "-" || text[at - 1] === "−");
  const negative = dash && (at < 2 || !/[\w)]/.test(text[at - 2]));
  return { node, start: negative ? at - 1 : at, end: at + match[0].length, negative, digits: match[0] };
}

/** The first piece of text inside the element that holds a number. The markup around it is left alone. */
function findNumber(el: Element): Found | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const found = numberIn(node);
    if (found) return found;
  }
  return null;
}

/** Reads how a number was written and writes others the same way, so 12,50,000 keeps its Indian grouping. */
function numberFormat(digits: string) {
  const [whole, fraction = ""] = digits.split(".");
  const groups = whole.split(",").map((part) => part.length).reverse();
  const grouped = groups.length > 1;
  const first = groups[0];
  const rest = groups.length > 2 ? groups[1] : first;
  return {
    value: parseFloat(digits.replace(/,/g, "")),
    write(value: number): string {
      const [int, dec] = Math.abs(value).toFixed(fraction.length).split(".");
      let out = int;
      if (grouped && int.length > first) {
        out = int.slice(-first);
        for (let stop = int.length - first; stop > 0; stop -= rest) out = int.slice(Math.max(0, stop - rest), stop) + "," + out;
      }
      return out + (dec ? "." + dec : "");
    },
  };
}

/** Counts up to the number already written in the element. Keeps its commas, decimals and units. */
const count: Effect = ({ env, owner, subject, group, timing, chosen, unit }) => {
  const el = subject.el;
  const disown = ownContent(env, el);
  const found = findNumber(el);
  if (!found) {
    disown();
    env.warn("count found no number to count to", el);
    return null;
  }
  const node = found.node;
  const from = number(group.effect!.arg, 0);
  let original = "";
  let before = "";
  let after = "";
  let to = 0;
  let format = numberFormat("0");
  const adopt = (hit: Found) => {
    original = node.data;
    before = original.slice(0, hit.start);
    after = original.slice(hit.end);
    format = numberFormat(hit.digits);
    to = hit.negative ? -format.value : format.value;
  };
  adopt(found);

  // Only the text of that one node changes, so tags around the number stay, and the observer
  // has nothing to report on every tick. If the page replaces the text, the count starts over.
  let progress = 0;
  let shown = "";
  const write = () => {
    const value = from + (to - from) * progress;
    const text = format.write(value);
    shown = before + (value < 0 && /[1-9]/.test(text) ? "-" : "") + text + after;
    node.data = shown;
  };
  write();
  subject.split = true;
  // A function property is both getter and setter to GSAP, so silent seeks update the text too.
  const state = {
    progress: (value?: number) => {
      if (value !== undefined) {
        // The page wrote a new number into this same piece of text since our last frame. Count to that one.
        if (node.data !== shown) {
          const hit = numberIn(node);
          if (hit) adopt(hit);
        }
        progress = value;
        write();
      }
      return progress;
    },
  };

  owner.run(() => {
    unit.to(
      state,
      {
        progress: 1,
        duration: number(chosen.duration, 1.6),
        ease: chosen.ease || "power2.out",
        delay: timing.delay || 0,
      },
      0,
    );
  });
  return {
    natural: true,
    cleanup: () => {
      disown();
      // Only while the text is still ours. If the page has written something else, that stays.
      if (node.isConnected && node.data === shown) node.data = original;
    },
  };
};

/** The room a digit's mask leaves above and below when the font cannot be measured, in em. */
const WHEEL_ROOM = 0.15;

/**
 * How far the digits of this font reach outside their line, in em. With a normal line height
 * that is nothing, and the mask can hug the row of digits, so a digit appears exactly at its
 * edge. Only a very tight line height needs a little room, or the tops would be cut off.
 */
function wheelRoom(el: Element): number {
  const style = getComputedStyle(el);
  const size = parseFloat(style.fontSize) || 16;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return WHEEL_ROOM;
  context.font = `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;
  const ink = context.measureText("0123456789");
  if (ink.fontBoundingBoxAscent === undefined) return WHEEL_ROOM;
  const content = ink.fontBoundingBoxAscent + ink.fontBoundingBoxDescent;
  const line = parseFloat(style.lineHeight) || content;
  const baseline = (line - content) / 2 + ink.fontBoundingBoxAscent;
  const over = Math.max(0, ink.actualBoundingBoxAscent - baseline, baseline + ink.actualBoundingBoxDescent - line);
  return Math.min(0.4, Math.round((over / size + 0.03) * 1000) / 1000);
}
/** In steps: the share of each step spent rolling (the rest is the pause), and how much later each wheel to the left sets off. */
const ROLL = 0.56;
const LAG = 0.05;

/**
 * Rolls every digit into place like a mileage counter. Each digit is a wheel in its own mask.
 *
 * On its own it is one calm roll: every wheel turns forward to its digit, the ones a couple of
 * turns more than the tens, so it reads as counting without the blur of a real count.
 * With stops (`gs-odometer-steps`, `gs-odometer-[27,64,100]`) it moves to a number, rests,
 * moves to the next, each wheel sliding exactly one digit up: the loader you see on
 * portfolio sites.
 */
const odometer: Effect = ({ env, owner, subject, group, timing, chosen, unit }) => {
  const el = subject.el;
  const disown = ownContent(env, el);
  const found = findNumber(el);
  if (!found) {
    disown();
    env.warn("odometer found no number to roll to", el);
    return null;
  }
  const node = found.node;
  const written = found.digits;
  const digitsAt = found.end - written.length;
  const before = node.data.slice(0, digitsAt);
  const after = node.data.slice(found.end);
  // Everything is counted in the smallest unit shown, so 6.5 is 65 steps of one tenth.
  const scale = Math.pow(10, (written.split(".")[1] || "").length);
  const units = (value: number) => Math.round(Math.abs(value) * scale);
  const end = units(parseFloat(written.replace(/,/g, "")));

  const arg = group.effect!.arg;
  const stepped = !!arg && typeof arg === "object";
  let stops: number[];
  if (stepped && arg.stops) {
    stops = [0, ...arg.stops.map(units)];
  } else if (stepped) {
    // Near an even split, a little off each time, so the stops do not look machine-made.
    const parts = Math.max(2, Math.min(12, arg.steps));
    stops = [0];
    for (let i = 1; i < parts; i++) stops.push(Math.round(end * (i / parts + (((i * 37) % 11) - 5) / 100)));
  } else {
    stops = [units(number(arg, 0))];
  }
  if (stops[stops.length - 1] !== end || stops.length < 2) stops.push(end);
  const segments = stops.length - 1;

  const room = wheelRoom(node.parentElement || el);
  const holder = document.createElement("span");
  holder.setAttribute("aria-hidden", "true");
  holder.setAttribute("data-gs-odometer", "");
  // A number reads left to right in every language. Without this, a right-to-left page would lay the wheels out backwards.
  holder.style.cssText = "white-space:nowrap;direction:ltr;unicode-bidi:isolate";
  const strips: HTMLElement[] = [];
  /** For every wheel: where it stands at each stop, in cells of its strip. */
  const marks: number[][] = [];
  const wheels = written.replace(/\D/g, "").length;
  const digitOf = (value: number, size: number) => Math.floor(value / size) % 10;
  for (const char of written) {
    if (char < "0" || char > "9") {
      // Like the digits, the comma and the dot are drawn by the stylesheet, so the wheels hold no text at all.
      const mark = document.createElement("span");
      mark.setAttribute("data-d", char);
      holder.appendChild(mark);
      continue;
    }
    const fromRight = wheels - 1 - strips.length;
    const size = Math.pow(10, fromRight);
    let cells: number[];
    const list: number[] = [];
    if (stepped) {
      // In steps a wheel holds only the digits it will rest on, one under the other, so every
      // change is one clean move of a single cell: 0, then 3, then 7, then 0.
      cells = [];
      for (const stop of stops) {
        const digit = digitOf(stop, size);
        if (cells[cells.length - 1] !== digit) cells.push(digit);
        list.push(cells.length - 1);
      }
    } else {
      // In one calm roll a wheel turns forward to its digit. The ones may add two full turns
      // and the tens one, never more than a real count would have made. 0 to 9 and 0 again,
      // so it can pass 9 without a jump.
      cells = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
      const a = stops[0];
      const b = stops[1];
      const up = b >= a;
      const step = up ? (digitOf(b, size) - digitOf(a, size) + 10) % 10 : -((digitOf(a, size) - digitOf(b, size) + 10) % 10);
      const spare = Math.max(0, 2 - fromRight);
      const turns = Math.min(spare, Math.max(0, Math.floor((Math.abs(b - a) / size - Math.abs(step)) / 10 + 1e-9)));
      list.push(digitOf(a, size), digitOf(a, size) + step + (up ? 10 : -10) * turns);
    }
    marks.push(list);
    const wheel = document.createElement("span");
    // A clip-path, not overflow, so the wheel still sits on the text baseline.
    wheel.style.cssText = `display:inline-block;position:relative;clip-path:inset(-${room}em -0.3em)`;
    // The digit it ends on gives the wheel its width, so the finished number sits exactly where plain text would.
    const sizer = document.createElement("span");
    sizer.style.visibility = "hidden";
    sizer.setAttribute("data-d", char);
    const strip = document.createElement("span");
    strip.style.cssText = `position:absolute;left:0;top:-${room}em;width:100%;will-change:transform`;
    for (const digit of cells) {
      const cell = document.createElement("span");
      cell.style.cssText = `display:flex;justify-content:center;padding:${room}em 0`;
      cell.setAttribute("data-d", String(digit));
      strip.appendChild(cell);
    }
    wheel.append(sizer, strip);
    holder.appendChild(wheel);
    strips.push(strip);
  }
  // Screen readers get the finished number once, not the wheels.
  const spoken = document.createElement("span");
  spoken.setAttribute("data-gs-sr", "");
  spoken.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap";
  spoken.textContent = written;
  // One wrapper stands where the text stood, so a flex or grid parent still sees a single item.
  const shell = document.createElement("span");
  shell.append(before, holder, spoken, after);
  node.replaceWith(shell);
  env.touch(el);
  subject.split = true;

  const ease = env.gsap.parseEase(env.ease(chosen.ease || (stepped ? "expo.inOut" : "power2.inOut"))) || ((value: number) => value);
  let position = 0;
  const render = () => {
    const k = Math.min(segments - 1, Math.max(0, Math.floor(position)));
    const within = position - k;
    strips.forEach((strip, index) => {
      const fromRight = strips.length - 1 - index;
      // In steps: roll, then rest. The wheels to the left set off a breath later.
      const local = stepped ? Math.min(1, Math.max(0, (within - Math.min(0.4, LAG * fromRight)) / ROLL)) : within;
      let at = marks[index][k] + (marks[index][k + 1] - marks[index][k]) * ease(local);
      // The calm roll goes round and round its ten digits.
      if (!stepped) at = ((at % 10) + 10) % 10;
      strip.style.transform = `translateY(${(-at / strip.children.length) * 100}%)`;
    });
  };
  render();
  const state = {
    value: (value?: number) => {
      if (value !== undefined) {
        position = value;
        render();
      }
      return position;
    },
  };

  owner.run(() => {
    unit.to(
      state,
      {
        value: segments,
        // The ease is applied wheel by wheel above, so the tween itself runs evenly.
        duration: number(chosen.duration, stepped ? segments * 0.9 : 2),
        ease: "none",
        delay: timing.delay || 0,
      },
      0,
    );
  });
  return {
    natural: true,
    cleanup: () => {
      disown();
      if (shell.parentNode) shell.parentNode.replaceChild(node, shell);
      env.touch(el);
    },
  };
};

/** Draws SVG strokes from nothing to their full length. */
const draw: Effect = ({ owner, subject, timing, chosen, unit }) => {
  const el = subject.el as Element;
  const shapes =
    el.tagName.toLowerCase() === "svg"
      ? Array.from(el.querySelectorAll("path,line,polyline,polygon,rect,circle,ellipse"))
      : [el];
  if (!shapes.length) return null;
  owner.run(() => {
    unit.from(
      shapes,
      {
        drawSVG: 0,
        duration: number(chosen.duration, 1.4),
        ease: chosen.ease || "power2.inOut",
        delay: timing.delay || 0,
        stagger: chosen.stagger !== undefined ? chosen.stagger : shapes.length > 1 ? 0.12 : 0,
      },
      0,
    );
  });
  return { natural: true };
};

/**
 * Scramble and type rewrite the element's text themselves, so a change to it cannot be told
 * apart by who made it. What can be told is whether the text is what the effect left there.
 * Before it has played that is known exactly, and if the page has put other words there, the
 * effect starts over with them. At the end the original markup is only put back if the text
 * is still ours.
 */
function ownText(el: HTMLElement, unit: any, env: EffectInput["env"], expected: () => string) {
  const disown = ownContent(env, el);
  const html = el.innerHTML;
  const words = el.textContent || "";
  let fresh: string | null = null;
  return {
    changed: () => {
      if (unit.totalProgress() > 0 || el.textContent === expected()) return false;
      fresh = el.innerHTML;
      return true;
    },
    cleanup: () => {
      disown();
      if (fresh !== null) el.innerHTML = fresh;
      else if (el.textContent === words && el.innerHTML !== html) el.innerHTML = html;
      env.touch(el);
    },
  };
}

/** Shuffles the letters, then settles on the real text. */
const scramble: Effect = ({ env, owner, subject, group, timing, chosen, unit }) => {
  const el = subject.el;
  // First, because a copy of a half-scrambled element is put right in here.
  const text = ownText(el, unit, env, () => original);
  const original = el.textContent || "";
  owner.run(() => {
    unit.to(
      el,
      {
        scrambleText: { text: original, chars: group.effect!.arg || "upperAndLowerCase", revealDelay: 0.15, speed: 0.5 },
        duration: number(chosen.duration, 1.2),
        ease: "none",
        delay: timing.delay || 0,
      },
      0,
    );
  });
  return { natural: true, ...text };
};

/** Types the text out. The number is letters per second. */
const type: Effect = ({ env, owner, subject, group, timing, chosen, unit }) => {
  const el = subject.el;
  // First, because a copy of a half-typed element is put right in here.
  const text = ownText(el, unit, env, () => "");
  const length = (el.textContent || "").length;
  if (!length) {
    text.cleanup();
    return null;
  }
  owner.run(() => {
    unit.from(
      el,
      {
        text: "",
        duration: number(chosen.duration, length / number(group.effect!.arg, 30)),
        ease: "none",
        delay: timing.delay || 0,
      },
      0,
    );
  });
  env.touch(el);
  return { natural: true, ...text };
};

export const EFFECTS: Record<string, Effect> = { parallax, horizontal, frames, count, odometer, draw, scramble, type };
