import type { Preset } from "./types";

/** Classes that start hidden or moved without being a preset. */
const HIDDEN_UTILITIES = ["from", "split", "count", "odometer", "draw", "scramble", "type"];

/** Matches a class or `data-gs` word that starts with the given name, with or without `md:` in front. */
function starts(prefix: string, name: string): string[] {
  const cls = `${prefix}-${name}`;
  return [
    `[class^="${cls}"]`,
    `[class*=" ${cls}"]`,
    `[class*=":${cls}"]`,
    `[data-gs^="${name}"]`,
    `[data-gs*=" ${name}"]`,
    `[data-gs*=":${name}"]`,
  ];
}

function where(prefix: string, names: string[]): string {
  return `:where(${names.flatMap((name) => starts(prefix, name)).join(",")})`;
}

/** The names the stylesheet hides until the script has set the element up. */
export function hiddenNames(presets: Map<string, Preset>): string[] {
  const names = new Set(HIDDEN_UTILITIES);
  presets.forEach((preset, name) => {
    if (preset.entrance) names.add(name.split("-")[0]);
  });
  return Array.from(names);
}

/** What only a click opens (`click:gs-fade`, `data-gs="click:fade"`): closed until the script opens it. */
export function closedSelector(prefix: string, presets: Map<string, Preset>): string {
  return hiddenNames(presets)
    .flatMap((name) => [`[class*="click:${prefix}-${name}"]`, `[data-gs*="click:${name}"]`])
    .join(",");
}

/**
 * The stylesheet. It does two jobs.
 *
 * 1. Anything that is about to animate in stays hidden until the script has put it in its
 *    starting position, so there is no flash of the finished page. If the script never runs,
 *    a three second failsafe shows everything, except what only a click opens (a closed menu
 *    stays closed).
 * 2. The few layout rules the helpers need (a marquee is a row, a horizontal track is a row).
 *
 * Every rule sits in :where(), so it has no specificity and your own CSS always wins.
 */
export function buildCss(prefix: string, presets: Map<string, Preset>): string {
  const p = prefix;
  const names = hiddenNames(presets);
  const waiting = `${where(p, names)}:where(:not([data-gs-ready]))`;
  const closed = `:where(${closedSelector(p, presets)}):where(:not([data-gs-ready]))`;
  return [
    // The failsafe stops hiding, it does not force anything to show: a step inside a menu that
    // is still closed stays as hidden as the menu is.
    `@keyframes ${p}-failsafe{to{visibility:inherit}}`,
    // Not on paper: there nothing waits, which also covers what was never set up because it was hidden on screen.
    `@media not print{${waiting}{visibility:hidden;animation:${p}-failsafe 0s linear 3s forwards}}`,
    // If the script never runs, a menu that opens on a click stays closed. Showing it after
    // three seconds like everything else would lay a full-screen menu over the page for good.
    `@media not print{${closed}{animation:none}}`,
    `${where(p, ["horizontal"])}{overflow:hidden}`,
    `${where(p, ["horizontal"])}>:where(:first-child){display:flex;flex-wrap:nowrap;width:max-content}`,
    `${where(p, ["marquee"])}{display:flex;flex-wrap:nowrap;overflow:hidden}`,
    `${where(p, ["marquee"])}>:where(*){flex:none}`,
    `${where(p, ["count", "odometer"])}{font-variant-numeric:tabular-nums}`,
    // The digits on an odometer's wheels are drawn, not written, so copying the text around a
    // rolling number, or reading it from a script, gives the number and not every digit of every wheel.
    `[data-gs-odometer] [data-d]::before{content:attr(data-d)}`,
    // Letters split into their own boxes lose kerning and ligatures. Switching both off for the
    // whole heading means the text sits in the same place split or not, so nothing jumps at the end.
    `${where(p, ["split-chars"])}{font-kerning:none;font-variant-ligatures:none}`,
    `${where(p, ["frames"])}:where(canvas){display:block}`,
    // While scroll positions are measured, an entrance's starting offset is ignored,
    // so an element 40px below its place is still counted where it will end up.
    `[data-gs-measure] [data-gs-enter]{transform:none!important;translate:none!important;rotate:none!important;scale:none!important}`,
  ].join("\n");
}
