import { createEngine } from "./core/engine";
import type { Tweenwind } from "./core/engine";
import type { Config, Loader } from "./core/types";

/**
 * The script-tag build. It uses the GSAP already on the page, or loads it from the CDN,
 * and fetches a plugin the first time a class needs it.
 */

const scripts = new Map<string, Promise<void>>();

function script(url: string): Promise<void> {
  let pending = scripts.get(url);
  if (!pending) {
    pending = new Promise<void>((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = url;
      tag.async = true;
      tag.onload = () => resolve();
      tag.onerror = () => reject(new Error("Failed to load " + url));
      document.head.appendChild(tag);
    });
    scripts.set(url, pending);
  }
  return pending;
}

const scope = window as any;

/** Plugins must match the core, so they come from the same version the page already has. */
function base(config: Config, gsap?: any): string {
  const version = gsap && gsap.version;
  return version ? config.cdn.replace(/gsap@[^/]+/, "gsap@" + version) : config.cdn;
}

const loader: Loader = {
  gsap: (config) => (scope.gsap ? Promise.resolve(scope.gsap) : script(config.cdn + "gsap.min.js").then(() => scope.gsap)),
  plugin: (name, config, gsap) =>
    scope[name] ? Promise.resolve(scope[name]) : script(base(config, gsap) + name + ".min.js").then(() => scope[name]),
};

// The same script on the page twice: the first copy stays in charge, and `window.gs` keeps pointing at it.
const first: Tweenwind | null = scope.gs && typeof scope.gs.scan === "function" ? scope.gs : null;
if (first) console.warn("[tweenwind] is on this page twice. The first copy stays in charge, remove the other script tag.");

const gs = first || createEngine(loader);
if (!first) {
  const { auto, ...options } = scope.gsConfig || {};
  gs.config(options);
  // A getter, so a second copy of the script (even an older version) cannot take `window.gs` over.
  Object.defineProperty(scope, "gs", { get: () => gs, set: () => {}, configurable: true });
  // start() adds the stylesheet straight away and waits for the page by itself. With the script
  // tag in the <head> (no `defer`), everything that animates in is hidden before the first paint.
  if (auto !== false) gs.start();
}

export default gs;
