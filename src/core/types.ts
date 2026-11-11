export type Vars = Record<string, any>;

export type TriggerKind = "view" | "load" | "hover" | "click" | "focus" | "press";

export interface Config {
  /** Class prefix. `gs` gives `gs-fade-up`. */
  prefix: string;
  /** Default tween length in seconds. */
  duration: number;
  /** Default ease. */
  ease: string;
  /** How far the directional presets travel, in px. */
  distance: number;
  /** Where an element's top must be in the viewport for it to play. */
  start: string;
  /** Scrub smoothing in seconds. `true` locks the animation to the scrollbar. */
  scrub: number | true;
  /** Default gap between staggered children, in seconds. */
  stagger: number;
  /** The animation used when a class only says what to animate (`gs-stagger`, `gs-split-words`). */
  preset: string;
  /** Respect the visitor's reduced motion setting. */
  reducedMotion: boolean;
  /** Watch the page for added, removed and changed elements. */
  observe: boolean;
  /** Put one-shot entrances back to plain HTML once they finish. */
  cleanup: boolean;
  /** Log what each class became and warn about classes that are not recognised. */
  debug: boolean;
  /** Tailwind-style breakpoints in px for `md:` and `max-md:`. */
  breakpoints: Record<string, number>;
  /** Where the script-tag build loads GSAP from. */
  cdn: string;
}

export interface PresetResult {
  from?: Vars;
  to?: Vars;
  /** Timing defaults for this preset: duration, ease, repeat, yoyo, stagger. */
  vars?: Vars;
  /**
   * For what from and to cannot say: add any tweens you like to the timeline.
   * `targets` are the elements the classes picked: the element, its children or its split text.
   */
  build?: (timeline: any, targets: Element[], timing: Vars) => void;
  /** With `build`: true when it only animates back to how the page looks, so it can be tidied away after. */
  natural?: boolean;
}

export type PresetDef = PresetResult | ((arg: any, config: Config) => PresetResult);

export interface Preset {
  def: PresetDef;
  /** Starts hidden or moved, so it is hidden before the script runs. */
  entrance: boolean;
  /** Only takes a number after its name, so `fade-up-big` is reported instead of ignored. */
  numeric?: boolean;
}

export interface Group {
  key: string;
  kind: TriggerKind;
  /** Triggered by the nearest `gs-group` ancestor instead of the element. */
  viaGroup: boolean;
  from?: Vars;
  to?: Vars;
  presets: Array<{ name: string; arg: any }>;
  vars: Vars;
  staggerFrom?: string;
  /** A stagger class was used, so the children are the targets unless something else says so. */
  staggered?: boolean;
  children?: boolean;
  targetSel?: string;
  split?: string[];
  mask?: boolean;
  scrub?: number | true | "default";
  pin?: true | string;
  start?: string;
  end?: string;
  play?: "once" | "replay" | "reverse";
  actions?: string;
  markers?: boolean;
  triggerSel?: string;
  toggleClass?: string;
  snap?: any;
  st?: Vars;
  timeline?: boolean;
  at?: string | number;
  label?: string;
  effect?: { name: string; arg: any };
  /** On a click animation: a click anywhere else closes it. */
  outside?: boolean;
  off?: boolean;
}

export interface Spec {
  groups: Record<string, Group>;
  behaviors: Record<string, any>;
  off: boolean;
  isGroup: boolean;
  motionOk: boolean;
  /** The author wrote `motion-safe:` or `motion-reduce:` classes, so they decide. */
  motionManual: boolean;
  /** Every media query the classes mention, matched or not. */
  media: string[];
  plugins: string[];
  unknown: string[];
  /** Plain timing classes with nothing to time, because the animation sits behind a prefix. */
  stray: string[];
  signature: string;
  empty: boolean;
  /** The base group reacts to scrolling, so it needs ScrollTrigger unless a timeline owns it. */
  scroll: boolean;
}

export type PluginName =
  | "ScrollTrigger"
  | "SplitText"
  | "ScrollSmoother"
  | "ScrollToPlugin"
  | "DrawSVGPlugin"
  | "ScrambleTextPlugin"
  | "TextPlugin"
  | "CustomEase";

export interface Loader {
  gsap(config: Config): Promise<any>;
  plugin(name: PluginName, config: Config, gsap: any): Promise<any>;
}
