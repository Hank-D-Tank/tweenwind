import type { Config } from "./types";

export const GSAP_VERSION = "3.15.1";

export const DEFAULTS: Config = {
  prefix: "gs",
  duration: 0.8,
  ease: "power3.out",
  distance: 40,
  start: "top 88%",
  scrub: 0.6,
  stagger: 0.08,
  preset: "fade-up",
  reducedMotion: true,
  observe: true,
  cleanup: true,
  debug: false,
  breakpoints: { sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 },
  cdn: `https://cdn.jsdelivr.net/npm/gsap@${GSAP_VERSION}/dist/`,
};
