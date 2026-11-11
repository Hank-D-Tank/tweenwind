import { gsap } from "gsap";
import { createEngine } from "./core/engine";
import type { Loader, PluginName } from "./core/types";

/**
 * Plugins are imported only when a class on the page asks for them,
 * so a page that just fades things in never downloads SplitText.
 */
const PLUGINS: Record<PluginName, () => Promise<any>> = {
  ScrollTrigger: () => import("gsap/ScrollTrigger").then((module) => module.ScrollTrigger),
  SplitText: () => import("gsap/SplitText").then((module) => module.SplitText),
  ScrollSmoother: () => import("gsap/ScrollSmoother").then((module) => module.ScrollSmoother),
  ScrollToPlugin: () => import("gsap/ScrollToPlugin").then((module) => module.ScrollToPlugin),
  DrawSVGPlugin: () => import("gsap/DrawSVGPlugin").then((module) => module.DrawSVGPlugin),
  ScrambleTextPlugin: () => import("gsap/ScrambleTextPlugin").then((module) => module.ScrambleTextPlugin),
  TextPlugin: () => import("gsap/TextPlugin").then((module) => module.TextPlugin),
  CustomEase: () => import("gsap/CustomEase").then((module) => module.CustomEase),
};

const loader: Loader = {
  gsap: () => Promise.resolve(gsap),
  plugin: (name) => PLUGINS[name](),
};

export const gs = createEngine(loader);
export default gs;

export type { Tweenwind } from "./core/engine";
export type { Config, PluginName, PresetDef, PresetResult } from "./core/types";
