import type { Vars } from "./types";

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const OPEN = "([{";
const CLOSE = ")]}";

/** Splits on a separator, but never inside (), [], {} or quotes. */
export function splitTop(input: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let last = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (OPEN.includes(ch)) {
      depth++;
    } else if (CLOSE.includes(ch)) {
      depth--;
    } else if (ch === separator && depth === 0) {
      parts.push(input.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(input.slice(last));
  return parts;
}

/** Index of the first separator that is not inside brackets or quotes, or -1. */
export function indexTop(input: string, separator: string): number {
  let depth = 0;
  let quote = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (OPEN.includes(ch)) {
      depth++;
    } else if (CLOSE.includes(ch)) {
      depth--;
    } else if (ch === separator && depth === 0) {
      return i;
    }
  }
  return -1;
}

/** Class names cannot hold spaces, so `_` stands for one. `\_` keeps a real underscore. */
export function unscore(text: string): string {
  return text.replace(/\\_/g, "\u0000").replace(/_/g, " ").replace(/\u0000/g, "_");
}

export function camel(name: string): string {
  return name.includes("-") && !name.startsWith("--") ? name.replace(/-+([a-z0-9])/gi, (_, c) => c.toUpperCase()) : name;
}

/** `50` becomes a number, `true` a boolean, `{a:1}` an object, `[1,2]` an array, anything else a string. */
export function parseAny(input: string): any {
  const text = input.trim();
  if (text === "") return "";
  if (NUMBER.test(text)) return Number(text);
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  const first = text[0];
  const last = text[text.length - 1];
  if ((first === "'" && last === "'") || (first === '"' && last === '"')) return text.slice(1, -1);
  if (first === "{" && last === "}") return parseObject(text.slice(1, -1));
  if (first === "[" && last === "]") {
    const inner = text.slice(1, -1).trim();
    return inner === "" ? [] : splitTop(inner, ",").map(parseAny);
  }
  return unscore(text);
}

/** `y:50,opacity:0` becomes `{ y: 50, opacity: 0 }`. Keys may be kebab-case. */
export function parseObject(input: string): Vars {
  const out: Vars = {};
  for (const part of splitTop(input, ",")) {
    if (part.trim() === "") continue;
    const at = indexTop(part, ":");
    if (at < 1) continue;
    out[camel(part.slice(0, at).trim())] = parseAny(part.slice(at + 1));
  }
  return out;
}

/**
 * Seconds, the way GSAP counts. `0.5`, `0.5s` and `500ms` all mean half a second,
 * and a bare number of 100 or more is read as milliseconds, so `duration-500` works too.
 */
export function parseTime(input: string): number | undefined {
  const text = input.trim().toLowerCase();
  let match = /^([+-]?(?:\d+\.?\d*|\.\d+))ms$/.exec(text);
  if (match) return Number(match[1]) / 1000;
  match = /^([+-]?(?:\d+\.?\d*|\.\d+))s?$/.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  return !text.endsWith("s") && Math.abs(value) >= 100 ? value / 1000 : value;
}

/** Splits the short form `y-50`, `x--100`, `background-color-red` or `x-[-100%]` into a name and a value. */
export function splitPair(input: string): [string, string] | null {
  let match = /^(.+?)-\[(.*)\]$/.exec(input);
  if (match) return [match[1], match[2]];
  match = /^(.+?)-(-?[^-]+)$/.exec(input);
  return match ? [match[1], match[2]] : null;
}
