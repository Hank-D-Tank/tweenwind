import { describe, expect, it } from "vitest";
import { animates, isCustomEase, parseTokens, splitToken } from "../src/core/parse";
import { builtinPresets } from "../src/core/presets";
import { DEFAULTS } from "../src/core/config";

const presets = builtinPresets();

function parse(classes: string, matching: string[] = [], data = "") {
  return parseTokens(classes.split(/\s+/).filter(Boolean), data.split(/\s+/).filter(Boolean), {
    config: DEFAULTS,
    presets,
    media: (query) => matching.includes(query),
  });
}

describe("splitToken", () => {
  it("ignores classes that are not ours", () => {
    expect(splitToken("flex", "gs")).toBeNull();
    expect(splitToken("tags-list", "gs")).toBeNull();
    expect(splitToken("gs", "gs")).toBeNull();
    expect(splitToken("gs-", "gs")).toBeNull();
  });
  it("reads variants", () => {
    expect(splitToken("gs-fade-up", "gs")).toEqual({ variants: [], body: "fade-up" });
    expect(splitToken("md:hover:gs-to-[scale:1.1]", "gs")).toEqual({ variants: ["md", "hover"], body: "to-[scale:1.1]" });
    expect(splitToken("min-[900px]:gs-fade", "gs")).toEqual({ variants: ["min-[900px]"], body: "fade" });
  });
  it("does not mistake the colon in a value for a variant", () => {
    expect(splitToken("gs-from-[y:50,opacity:0]", "gs")).toEqual({ variants: [], body: "from-[y:50,opacity:0]" });
    expect(splitToken("from-[y:50]", null)).toEqual({ variants: [], body: "from-[y:50]" });
    expect(splitToken("hover:to-[scale:1.1]", null)).toEqual({ variants: ["hover"], body: "to-[scale:1.1]" });
  });
});

describe("presets", () => {
  it("picks the longest name", () => {
    expect(parse("gs-fade-up").groups.view.presets).toEqual([{ name: "fade-up", arg: undefined }]);
    expect(parse("gs-fade").groups.view.presets).toEqual([{ name: "fade", arg: undefined }]);
  });
  it("takes an amount", () => {
    expect(parse("gs-fade-up-100").groups.view.presets).toEqual([{ name: "fade-up", arg: 100 }]);
    expect(parse("gs-zoom-in-0.5").groups.view.presets).toEqual([{ name: "zoom-in", arg: 0.5 }]);
  });
  it("only takes a number", () => {
    expect(parse("gs-fade-up-big").unknown).toEqual(["gs-fade-up-big"]);
    expect(parse("gs-fade-in-up").unknown).toEqual(["gs-fade-in-up"]);
    expect(parse("gs-fade-in").groups.view.presets).toEqual([{ name: "fade-in", arg: undefined }]);
  });
  it("asks for ScrollTrigger", () => {
    expect(parse("gs-fade-up").scroll).toBe(true);
  });
});

describe("from and to", () => {
  it("reads the bracket form", () => {
    const view = parse("gs-from-[y:50,opacity:0] gs-to-[x:100]").groups.view;
    expect(view.from).toEqual({ y: 50, opacity: 0 });
    expect(view.to).toEqual({ x: 100 });
  });
  it("reads the short form and merges it", () => {
    const view = parse("gs-from-y-50 gs-from-opacity-0 gs-from-x--100 gs-from-rotate-[-10]").groups.view;
    expect(view.from).toEqual({ y: 50, opacity: 0, x: -100, rotate: -10 });
  });
  it("flags a class with no value", () => {
    expect(parse("gs-from").unknown).toEqual(["gs-from"]);
    expect(parse("gs-from-opacity").unknown).toEqual(["gs-from-opacity"]);
  });
});

describe("timing", () => {
  it("reads duration, delay and ease", () => {
    const vars = parse("gs-duration-1.2 gs-delay-200 gs-ease-power2.inOut").groups.view.vars;
    expect(vars).toEqual({ duration: 1.2, delay: 0.2, ease: "power2.inOut" });
  });
  it("reads eases with arguments", () => {
    expect(parse("gs-ease-back.out(1.7)").groups.view.vars.ease).toBe("back.out(1.7)");
    expect(parse("gs-ease-[elastic.out(1,0.3)]").groups.view.vars.ease).toBe("elastic.out(1,0.3)");
  });
  it("spots custom eases", () => {
    expect(isCustomEase("0.25,0.1,0.25,1")).toBe(true);
    expect(isCustomEase("cubic-bezier(.25,.1,.25,1)")).toBe(true);
    expect(isCustomEase("M0,0 C0.5,0 0.5,1 1,1")).toBe(true);
    expect(isCustomEase("power2.out")).toBe(false);
    expect(parse("gs-ease-[0.25,0.1,0.25,1]").plugins).toContain("CustomEase");
  });
  it("reads repeat and yoyo", () => {
    expect(parse("gs-repeat gs-yoyo").groups.view.vars).toEqual({ repeat: -1, yoyo: true });
    expect(parse("gs-repeat-infinite").groups.view.vars.repeat).toBe(-1);
    expect(parse("gs-repeat-2 gs-repeat-delay-0.5").groups.view.vars).toEqual({ repeat: 2, repeatDelay: 0.5 });
  });
});

describe("targets", () => {
  it("stagger marks the children", () => {
    const view = parse("gs-fade-up gs-stagger-0.1").groups.view;
    expect(view.staggered).toBe(true);
    expect(view.vars.stagger).toBe(0.1);
  });
  it("stagger reads an origin and an object", () => {
    expect(parse("gs-stagger-0.1 gs-stagger-center").groups.view.staggerFrom).toBe("center");
    expect(parse("gs-stagger-from-end").groups.view.staggerFrom).toBe("end");
    expect(parse("gs-stagger-[each:0.1,from:edges]").groups.view.vars.stagger).toEqual({ each: 0.1, from: "edges" });
  });
  it("split asks for SplitText", () => {
    const spec = parse("gs-split-lines gs-split-chars gs-mask");
    expect(spec.groups.view.split).toEqual(["lines", "chars"]);
    expect(spec.groups.view.mask).toBe(true);
    expect(spec.plugins).toContain("SplitText");
    expect(parse("gs-split").groups.view.split).toEqual(["words"]);
    expect(parse("gs-split-[lines,words]").groups.view.split).toEqual(["lines", "words"]);
    expect(parse("gs-split-letters").unknown).toHaveLength(1);
  });
  it("target takes a selector with spaces", () => {
    expect(parse("gs-target-[.card_>_img]").groups.view.targetSel).toBe(".card > img");
  });
});

describe("scroll", () => {
  it("reads scrub", () => {
    expect(parse("gs-scrub").groups.view.scrub).toBe("default");
    expect(parse("gs-scrub-1").groups.view.scrub).toBe(1);
    expect(parse("gs-scrub-0").groups.view.scrub).toBe(true);
    expect(parse("gs-scrub-true").groups.view.scrub).toBe(true);
  });
  it("reads pin", () => {
    expect(parse("gs-pin").groups.view.pin).toBe(true);
    expect(parse("gs-pin-300").groups.view.pin).toBe("+=300%");
    expect(parse("gs-pin-[+=1500]").groups.view.pin).toBe("+=1500");
  });
  it("fills in the edge for one-word positions", () => {
    expect(parse("gs-start-center").groups.view.start).toBe("top center");
    expect(parse("gs-start-80%").groups.view.start).toBe("top 80%");
    expect(parse("gs-start-[top_top]").groups.view.start).toBe("top top");
    expect(parse("gs-end-top").groups.view.end).toBe("bottom top");
    expect(parse("gs-end-[+=200%]").groups.view.end).toBe("+=200%");
  });
  it("reads how it plays", () => {
    expect(parse("gs-replay").groups.view.play).toBe("replay");
    expect(parse("gs-reverse").groups.view.play).toBe("reverse");
    expect(parse("gs-actions-[play_pause_resume_reset]").groups.view.actions).toBe("play pause resume reset");
  });
  it("passes ScrollTrigger options through", () => {
    expect(parse("gs-st-[pinSpacing:false,anticipatePin:1]").groups.view.st).toEqual({ pinSpacing: false, anticipatePin: 1 });
  });
  it("a pin alone still needs ScrollTrigger", () => {
    expect(parse("gs-pin").scroll).toBe(true);
    expect(parse("gs-toggle-[is-active]").scroll).toBe(true);
  });
});

describe("timelines", () => {
  it("reads the container and its steps", () => {
    expect(parse("gs-timeline gs-pin gs-scrub").groups.view.timeline).toBe(true);
    expect(parse("gs-fade-up gs-at-[<0.2]").groups.view.at).toBe("<0.2");
    expect(parse("gs-fade-up gs-at-1.5").groups.view.at).toBe(1.5);
    expect(parse("gs-fade-up gs-at-[-=0.3]").groups.view.at).toBe("-=0.3");
    expect(parse("gs-fade-up gs-with").groups.view.at).toBe("<");
    expect(parse("gs-label-[intro]").groups.view.label).toBe("intro");
  });
});

describe("variants", () => {
  it("puts trigger variants in their own group", () => {
    const spec = parse("gs-fade-up hover:gs-to-[scale:1.05] hover:gs-duration-0.2 click:gs-to-rotate-180");
    expect(Object.keys(spec.groups).sort()).toEqual(["click", "hover", "view"]);
    expect(spec.groups.hover.to).toEqual({ scale: 1.05 });
    expect(spec.groups.hover.vars).toEqual({ duration: 0.2 });
    expect(spec.groups.view.vars).toEqual({});
    expect(spec.groups.click.to).toEqual({ rotate: 180 });
  });
  it("reads group triggers", () => {
    const spec = parse("group-hover:gs-to-[scale:1.1]");
    expect(spec.groups["group-hover"].viaGroup).toBe(true);
    expect(spec.groups["group-hover"].kind).toBe("hover");
    expect(parse("gs-group").isGroup).toBe(true);
  });
  it("load does not need ScrollTrigger", () => {
    const spec = parse("load:gs-fade-up");
    expect(spec.groups.load.presets).toHaveLength(1);
    expect(spec.scroll).toBe(false);
  });
  it("skips classes whose breakpoint does not match", () => {
    const small = parse("gs-fade-up md:gs-from-[x:-100]");
    expect(small.groups.view.from).toBeUndefined();
    expect(small.media).toEqual(["(min-width: 768px)"]);
    const wide = parse("gs-fade-up md:gs-from-[x:-100]", ["(min-width: 768px)"]);
    expect(wide.groups.view.from).toEqual({ x: -100 });
    expect(wide.signature).not.toBe(small.signature);
  });
  it("a preset behind a breakpoint replaces the plain one", () => {
    const names = (classes: string, matching: string[] = []) => parse(classes, matching).groups.view.presets.map((preset) => preset.name);
    const md = "(min-width: 768px)";
    const lg = "(min-width: 1024px)";
    expect(names("gs-fade-up md:gs-fade-left")).toEqual(["fade-up"]);
    expect(names("gs-fade-up md:gs-fade-left", [md])).toEqual(["fade-left"]);
    expect(names("lg:gs-zoom-in gs-fade-up md:gs-fade-left", [md, lg])).toEqual(["zoom-in"]);
    expect(names("gs-fade-up gs-blur-in")).toEqual(["fade-up", "blur-in"]);
    expect(names("gs-flip-up motion-reduce:gs-fade", ["(prefers-reduced-motion: reduce)"])).toEqual(["fade"]);
  });
  it("wider breakpoints win whatever the order", () => {
    const md = "(min-width: 768px)";
    const lg = "(min-width: 1024px)";
    expect(parse("lg:gs-duration-3 gs-duration-1 md:gs-duration-2", [md, lg]).groups.view.vars.duration).toBe(3);
    expect(parse("md:gs-duration-2 gs-duration-1", [md]).groups.view.vars.duration).toBe(2);
    expect(parse("md:gs-duration-2 gs-duration-1").groups.view.vars.duration).toBe(1);
    expect(parse("md:gs-from-[x:100] gs-from-[y:50,x:10]", [md]).groups.view.from).toEqual({ y: 50, x: 100 });
  });
  it("supports max, arbitrary and stacked variants", () => {
    expect(parse("max-md:gs-off").media).toEqual(["(max-width: 767.98px)"]);
    expect(parse("max-md:gs-off", ["(max-width: 767.98px)"]).off).toBe(true);
    expect(parse("min-[900px]:gs-fade").media).toEqual(["(min-width: 900px)"]);
    const spec = parse("lg:hover:gs-to-[y:-4]", ["(min-width: 1024px)"]);
    expect(spec.groups.hover.to).toEqual({ y: -4 });
  });
  it("notes when the author handles reduced motion", () => {
    expect(parse("motion-safe:gs-fade-up motion-reduce:gs-fade").motionManual).toBe(true);
    expect(parse("gs-fade-up").motionManual).toBe(false);
    expect(parse("gs-fade-up gs-motion-ok").motionOk).toBe(true);
  });
  it("flags unknown variants and classes", () => {
    expect(parse("tablet:gs-fade-up").unknown).toEqual(["tablet:gs-fade-up"]);
    expect(parse("gs-fad-up").unknown).toEqual(["gs-fad-up"]);
    expect(parse("gs-fad-up").empty).toBe(false);
  });
});

describe("effects and behaviours", () => {
  it("reads effects", () => {
    expect(parse("gs-parallax").groups.view.effect).toEqual({ name: "parallax", arg: undefined });
    expect(parse("gs-parallax-30").groups.view.effect).toEqual({ name: "parallax", arg: 30 });
    expect(parse("gs-parallax--30").groups.view.effect).toEqual({ name: "parallax", arg: -30 });
    expect(parse("gs-horizontal").groups.view.effect!.name).toBe("horizontal");
    expect(parse("gs-count").groups.view.effect!.name).toBe("count");
    expect(parse("gs-draw").plugins).toContain("DrawSVGPlugin");
    expect(parse("gs-scramble").plugins).toContain("ScrambleTextPlugin");
    expect(parse("gs-type").plugins).toContain("TextPlugin");
  });
  it("reads a frame pattern", () => {
    expect(parse("gs-frames-[/seq/f-[001-120].webp]").groups.view.effect).toEqual({ name: "frames", arg: "/seq/f-[001-120].webp" });
  });
  it("reads behaviours", () => {
    expect(parse("gs-marquee gs-marquee-right gs-marquee-120 gs-marquee-pause").behaviors.marquee).toEqual({
      direction: "right",
      speed: 120,
      pause: true,
    });
    expect(parse("gs-magnetic-0.5").behaviors.magnetic).toEqual({ strength: 0.5 });
    expect(parse("gs-tilt").behaviors.tilt).toEqual({});
  });
  it("reads several marquee options from one class", () => {
    expect(parse("gs-marquee-right-300").behaviors.marquee).toEqual({ direction: "right", speed: 300 });
    expect(parse("gs-marquee-pause-scroll-90").behaviors.marquee).toEqual({ pause: true, scroll: true, speed: 90 });
    expect(parse("gs-marquee--80").behaviors.marquee).toEqual({ speed: -80 });
    expect(parse("gs-marquee-scroll").plugins).toContain("ScrollTrigger");
  });
  it("reads a pan: amount, axis, units and the bracket form", () => {
    expect(parse("gs-pan").behaviors.pan).toEqual({ x: 30, y: 30 });
    expect(parse("gs-pan-80").behaviors.pan).toEqual({ x: 80, y: 80 });
    expect(parse("gs-pan-x-15vw").behaviors.pan).toEqual({ x: "15vw" });
    expect(parse("gs-pan-y--40").behaviors.pan).toEqual({ y: -40 });
    expect(parse("gs-pan-x-10% gs-pan-y-20").behaviors.pan).toEqual({ x: "10%", y: 20 });
    expect(parse("gs-pan-[x:15vw,y:2vh,duration:1.4]").behaviors.pan).toEqual({ x: "15vw", y: "2vh", duration: 1.4 });
  });
  it("reports a pan it cannot read", () => {
    expect(parse("gs-pan-x-wide").unknown).toEqual(["gs-pan-x-wide"]);
    expect(parse("gs-pan-15em").unknown).toEqual(["gs-pan-15em"]);
    expect(parse("gs-pan-[x:15vw,speed:2]").unknown).toEqual(["gs-pan-[x:15vw,speed:2]"]);
  });
  it("reports a marquee option it does not know, instead of ignoring it", () => {
    const spec = parse("gs-marquee-right-fast");
    expect(spec.unknown).toEqual(["gs-marquee-right-fast"]);
    expect(spec.behaviors.marquee).toEqual({});
  });
  it("reads an odometer and its start value", () => {
    expect(parse("gs-odometer").groups.view.effect).toEqual({ name: "odometer", arg: undefined });
    expect(parse("gs-odometer-90").groups.view.effect).toEqual({ name: "odometer", arg: 90 });
    expect(parse("load:gs-odometer").groups.load.effect).toEqual({ name: "odometer", arg: undefined });
    expect(animates(parse("gs-odometer").groups.view)).toBe(true);
  });
  it("reads odometer stops, given or picked for you", () => {
    expect(parse("gs-odometer-[27,64,100]").groups.view.effect).toEqual({ name: "odometer", arg: { stops: [27, 64, 100] } });
    expect(parse("gs-odometer-steps").groups.view.effect).toEqual({ name: "odometer", arg: { steps: 4 } });
    expect(parse("gs-odometer-steps-3").groups.view.effect).toEqual({ name: "odometer", arg: { steps: 3 } });
    expect(parse("gs-odometer-fast").unknown).toEqual(["gs-odometer-fast"]);
    expect(parse("gs-odometer-[27,x]").unknown).toEqual(["gs-odometer-[27,x]"]);
  });
  it("reads gs-outside on the click animation it belongs to", () => {
    const spec = parse("click:gs-to-[x:100] click:gs-outside click:gs-trigger-[.open]");
    expect(spec.groups.click.outside).toBe(true);
    expect(spec.groups.click.triggerSel).toBe(".open");
    expect(spec.groups.view).toBeUndefined();
  });
  it("reads the other behaviours", () => {
    expect(parse("gs-smooth-1.5").behaviors.smooth).toEqual({ amount: 1.5 });
    expect(parse("gs-smooth").plugins).toEqual(["ScrollTrigger", "ScrollSmoother"]);
    expect(parse("gs-scroll-to").behaviors.scrollTo).toEqual({ target: undefined });
  });
});

describe("data attribute", () => {
  it("reads the same words without the prefix", () => {
    const spec = parse("", [], "fade-up duration-1 hover:to-[scale:1.1] stagger-0.1");
    expect(spec.groups.view.presets).toEqual([{ name: "fade-up", arg: undefined }]);
    expect(spec.groups.view.vars).toEqual({ duration: 1, stagger: 0.1 });
    expect(spec.groups.hover.to).toEqual({ scale: 1.1 });
  });
});

describe("animates", () => {
  it("is false for when-and-where classes alone", () => {
    expect(animates(parse("gs-pin gs-scrub").groups.view)).toBe(false);
    expect(animates(parse("gs-stagger").groups.view)).toBe(true);
    expect(animates(parse("gs-split-words").groups.view)).toBe(true);
  });
});

describe("empty", () => {
  it("is empty without our classes", () => {
    expect(parse("flex items-center logs-panel").empty).toBe(true);
  });
});
