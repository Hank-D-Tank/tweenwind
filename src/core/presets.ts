import type { Config, Preset, PresetDef, PresetResult } from "./types";

const number = (arg: any, fallback: number): number => (typeof arg === "number" && !Number.isNaN(arg) ? arg : fallback);

const flip = (axis: "rotationX" | "rotationY", sign: number, origin: string): PresetDef => (arg) => ({
  from: { autoAlpha: 0, [axis]: sign * number(arg, 80), transformPerspective: 1000, transformOrigin: origin },
});

const reveal = (inset: string): PresetDef => () => ({
  from: { clipPath: inset },
  vars: { ease: "power3.inOut", duration: 1 },
});

/** Entrances: they start hidden or moved and end as the element looks in your CSS. */
const ENTRANCES: Record<string, PresetDef> = {
  fade: { from: { autoAlpha: 0 } },
  "fade-in": { from: { autoAlpha: 0 } },
  "fade-up": (arg, c) => ({ from: { autoAlpha: 0, y: number(arg, c.distance) } }),
  "fade-down": (arg, c) => ({ from: { autoAlpha: 0, y: -number(arg, c.distance) } }),
  "fade-left": (arg, c) => ({ from: { autoAlpha: 0, x: number(arg, c.distance) } }),
  "fade-right": (arg, c) => ({ from: { autoAlpha: 0, x: -number(arg, c.distance) } }),

  "slide-up": (arg) => ({ from: { yPercent: number(arg, 100) } }),
  "slide-down": (arg) => ({ from: { yPercent: -number(arg, 100) } }),
  "slide-left": (arg) => ({ from: { xPercent: number(arg, 100) } }),
  "slide-right": (arg) => ({ from: { xPercent: -number(arg, 100) } }),

  "zoom-in": (arg) => ({ from: { autoAlpha: 0, scale: number(arg, 0.85) } }),
  "zoom-out": (arg) => ({ from: { autoAlpha: 0, scale: number(arg, 1.15) } }),
  pop: (arg) => ({ from: { autoAlpha: 0, scale: number(arg, 0.6) }, vars: { ease: "back.out(1.7)" } }),

  "flip-up": flip("rotationX", -1, "50% 100%"),
  "flip-down": flip("rotationX", 1, "50% 0%"),
  "flip-left": flip("rotationY", -1, "50% 50%"),
  "flip-right": flip("rotationY", 1, "50% 50%"),

  "blur-in": (arg) => ({ from: { autoAlpha: 0, blur: number(arg, 12) } }),
  "rotate-in": (arg) => ({ from: { autoAlpha: 0, rotation: number(arg, -8), scale: 0.94 } }),

  "reveal-up": reveal("inset(100% 0% 0% 0%)"),
  "reveal-down": reveal("inset(0% 0% 100% 0%)"),
  "reveal-left": reveal("inset(0% 0% 0% 100%)"),
  "reveal-right": reveal("inset(0% 100% 0% 0%)"),
};

/** Loops: they run for as long as the element is on screen. */
const LOOPS: Record<string, PresetDef> = {
  float: (arg) => ({
    to: { y: -number(arg, 12) },
    vars: { duration: 2, ease: "sine.inOut", repeat: -1, yoyo: true },
  }),
  spin: (arg) => ({
    to: { rotation: number(arg, 360) },
    vars: { duration: 8, ease: "none", repeat: -1 },
  }),
  pulse: (arg) => ({
    to: { scale: number(arg, 1.06) },
    vars: { duration: 0.9, ease: "sine.inOut", repeat: -1, yoyo: true },
  }),
  wiggle: (arg) => ({
    from: { rotation: -number(arg, 4) },
    to: { rotation: number(arg, 4) },
    vars: { duration: 0.18, ease: "sine.inOut", repeat: -1, yoyo: true },
  }),
};

export function builtinPresets(): Map<string, Preset> {
  const map = new Map<string, Preset>();
  for (const name in ENTRANCES) map.set(name, { def: ENTRANCES[name], entrance: true, numeric: true });
  for (const name in LOOPS) map.set(name, { def: LOOPS[name], entrance: false, numeric: true });
  return map;
}

export function resolvePreset(preset: Preset, arg: any, config: Config): PresetResult {
  return typeof preset.def === "function" ? preset.def(arg, config) : preset.def;
}

/** The first word of each entrance name. The stylesheet hides these before the script runs. */
export function entranceFamilies(presets: Map<string, Preset>): string[] {
  const families = new Set<string>();
  presets.forEach((preset, name) => {
    if (preset.entrance) families.add(name);
  });
  return Array.from(families);
}
