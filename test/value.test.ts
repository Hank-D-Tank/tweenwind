import { describe, expect, it } from "vitest";
import { camel, parseAny, parseObject, parseTime, splitPair, splitTop, unscore } from "../src/core/value";

describe("splitTop", () => {
  it("splits on commas outside brackets", () => {
    expect(splitTop("a:1,b:random(-5,5),c:[1,2],d:{e:1,f:2}", ",")).toEqual(["a:1", "b:random(-5,5)", "c:[1,2]", "d:{e:1,f:2}"]);
  });
  it("leaves quoted commas alone", () => {
    expect(splitTop("a:'x,y',b:2", ",")).toEqual(["a:'x,y'", "b:2"]);
  });
});

describe("parseAny", () => {
  it("reads numbers", () => {
    expect(parseAny("50")).toBe(50);
    expect(parseAny("-0.5")).toBe(-0.5);
    expect(parseAny(".25")).toBe(0.25);
    expect(parseAny("1e3")).toBe(1000);
  });
  it("keeps units and relative values as strings", () => {
    expect(parseAny("50%")).toBe("50%");
    expect(parseAny("-100vw")).toBe("-100vw");
    expect(parseAny("+=100")).toBe("+=100");
    expect(parseAny("#ff0000")).toBe("#ff0000");
  });
  it("reads booleans and null", () => {
    expect(parseAny("true")).toBe(true);
    expect(parseAny("false")).toBe(false);
    expect(parseAny("null")).toBe(null);
  });
  it("turns underscores into spaces", () => {
    expect(parseAny("inset(0_0_100%_0)")).toBe("inset(0 0 100% 0)");
    expect(parseAny("left_center")).toBe("left center");
    expect(parseAny("my\\_name")).toBe("my_name");
  });
  it("keeps quoted text as written", () => {
    expect(parseAny("'123'")).toBe("123");
    expect(parseAny("'a_b'")).toBe("a_b");
  });
  it("reads arrays and nested objects", () => {
    expect(parseAny("[0,100,50]")).toEqual([0, 100, 50]);
    expect(parseAny("{each:0.1,from:center}")).toEqual({ each: 0.1, from: "center" });
    expect(parseAny("{x:[0,100,0]}")).toEqual({ x: [0, 100, 0] });
  });
});

describe("parseObject", () => {
  it("reads the common case", () => {
    expect(parseObject("y:50,opacity:0")).toEqual({ y: 50, opacity: 0 });
  });
  it("keeps function-like values whole", () => {
    expect(parseObject("x:random(-100,100),ease:back.out(1.7)")).toEqual({ x: "random(-100,100)", ease: "back.out(1.7)" });
    expect(parseObject("clipPath:polygon(0_0,100%_0,100%_100%,0_100%)")).toEqual({
      clipPath: "polygon(0 0,100% 0,100% 100%,0 100%)",
    });
  });
  it("accepts kebab-case keys", () => {
    expect(parseObject("background-color:#111,transform-origin:left_top")).toEqual({
      backgroundColor: "#111",
      transformOrigin: "left top",
    });
  });
  it("keeps css variables as keys and values", () => {
    expect(parseObject("--glow:1,color:var(--accent)")).toEqual({ "--glow": 1, color: "var(--accent)" });
  });
  it("goes deep", () => {
    expect(parseObject("keyframes:{x:[0,100,0],ease:none},duration:2")).toEqual({
      keyframes: { x: [0, 100, 0], ease: "none" },
      duration: 2,
    });
  });
  it("ignores empty and broken parts", () => {
    expect(parseObject("y:50,,nonsense")).toEqual({ y: 50 });
  });
});

describe("parseTime", () => {
  it("counts in seconds like GSAP", () => {
    expect(parseTime("0.5")).toBe(0.5);
    expect(parseTime("2")).toBe(2);
    expect(parseTime("60")).toBe(60);
  });
  it("accepts explicit units", () => {
    expect(parseTime("500ms")).toBe(0.5);
    expect(parseTime("0.5s")).toBe(0.5);
    expect(parseTime("150s")).toBe(150);
  });
  it("reads big bare numbers as milliseconds", () => {
    expect(parseTime("500")).toBe(0.5);
    expect(parseTime("100")).toBe(0.1);
    expect(parseTime("1200")).toBe(1.2);
  });
  it("rejects nonsense", () => {
    expect(parseTime("fast")).toBeUndefined();
    expect(parseTime("")).toBeUndefined();
  });
});

describe("splitPair", () => {
  it("splits the short form", () => {
    expect(splitPair("y-50")).toEqual(["y", "50"]);
    expect(splitPair("opacity-0")).toEqual(["opacity", "0"]);
    expect(splitPair("scale-1.2")).toEqual(["scale", "1.2"]);
    expect(splitPair("x-50%")).toEqual(["x", "50%"]);
  });
  it("reads a second dash as a minus sign", () => {
    expect(splitPair("x--100")).toEqual(["x", "-100"]);
    expect(splitPair("rotate--45")).toEqual(["rotate", "-45"]);
  });
  it("handles kebab-case names", () => {
    expect(splitPair("background-color-red")).toEqual(["background-color", "red"]);
  });
  it("handles a bracketed value", () => {
    expect(splitPair("x-[-100%]")).toEqual(["x", "-100%"]);
    expect(splitPair("x-[random(-50,50)]")).toEqual(["x", "random(-50,50)"]);
  });
  it("returns null without a value", () => {
    expect(splitPair("opacity")).toBeNull();
  });
});

describe("helpers", () => {
  it("camel", () => {
    expect(camel("background-color")).toBe("backgroundColor");
    expect(camel("y")).toBe("y");
    expect(camel("--my-var")).toBe("--my-var");
  });
  it("unscore", () => {
    expect(unscore("top_80%")).toBe("top 80%");
  });
});
