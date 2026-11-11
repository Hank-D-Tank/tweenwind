# Tweenwind

GSAP animations, written as class names.

```html
<h1 class="gs-fade-up">Hello</h1>
```

Add a class and the element animates when it scrolls into view. Add a few more for pinned scenes,
split text, horizontal sections and timelines tied to the scrollbar. There is no JavaScript to write.

It is built on [GSAP](https://gsap.com) and its plugins, loads only the plugins your classes use,
and works in plain HTML, React, Next.js and anything else that renders HTML.

By [DiMaac](https://dimaac.com). Free, MIT licensed.

**Docs with live examples: [tweenwind.dimaac.com](https://tweenwind.dimaac.com)**

## Install

**A script tag.** Put it in the `<head>`, without `defer`. It loads GSAP for you.

```html
<script src="https://cdn.jsdelivr.net/npm/tweenwind"></script>
```

If the page already loads GSAP, put that script tag first and this one uses it instead of
fetching its own.

**npm.** Run it once, in the browser.

```bash
npm install tweenwind gsap
```

```js
import "tweenwind/auto";
import "tweenwind/css";
```

**React and Next.js.** Render `<Gs />` once, anywhere. Classes then work in every component,
server or client.

```jsx
// app/layout.jsx
import { Gs } from "tweenwind/react";
import "tweenwind/css";

export default function Layout({ children }) {
  return (
    <html lang="en">
      <body>
        <Gs />
        {children}
      </body>
    </html>
  );
}
```

## The idea in one minute

```html
<!-- A ready-made reveal. Plays once, when it scrolls into view. -->
<h2 class="gs-fade-up">Title</h2>

<!-- Your own values. Inside the brackets is what you would pass to gsap.from(). -->
<img class="gs-from-[scale:1.2,opacity:0] gs-duration-1.4 gs-ease-expo.out">

<!-- Children, one after another. -->
<ul class="gs-fade-up gs-stagger-0.1"><li>One</li><li>Two</li><li>Three</li></ul>

<!-- Split text. -->
<h1 class="gs-split-lines gs-mask gs-slide-up">Lines that rise into place</h1>

<!-- Tied to the scrollbar. -->
<div class="gs-to-[x:300,rotate:180] gs-scrub"></div>

<!-- A pinned scene. Every animated element inside is a step, in page order. -->
<section class="gs-timeline gs-pin-300 gs-scrub">
  <h2 class="gs-fade-up">First</h2>
  <h2 class="gs-fade-up">Then</h2>
  <h2 class="gs-fade-up gs-with">At the same time</h2>
</section>

<!-- On hover, press or click. It runs backwards when the moment ends. -->
<button class="hover:gs-to-[y:-4] press:gs-to-[scale:0.95]">Button</button>

<!-- Different on a phone. -->
<div class="gs-fade-up md:gs-fade-left max-md:gs-duration-0.4"></div>
```

A class is `gs-` + a name + an optional value. A value is a plain word or number (`gs-duration-1.2`)
or anything in brackets (`gs-ease-[back.out(1.7)]`). Class names cannot hold spaces, so write `_`
for a space: `gs-start-[top_80%]`.

The same words work in a `data-gs` attribute, without the prefix:

```html
<div data-gs="fade-up duration-1 hover:to-[scale:1.05]"></div>
```

## Classes

### What moves

| Class | What it does |
| --- | --- |
| `gs-fade` `gs-fade-up` `-down` `-left` `-right` | Fade in, with a direction |
| `gs-slide-up` `-down` `-left` `-right` | Slide in by its own size |
| `gs-zoom-in` `gs-zoom-out` `gs-pop` | Scale in |
| `gs-flip-up` `-down` `-left` `-right` | Turn in, in 3D |
| `gs-blur-in` `gs-rotate-in` | Blur or rotate in |
| `gs-reveal-up` `-down` `-left` `-right` | Wipe in with a clip path |
| `gs-float` `gs-spin` `gs-pulse` `gs-wiggle` | Loops, while on screen. Next to a reveal (`gs-fade-up gs-float`) the loop starts when the reveal is done |
| `gs-fade-up-80` | Any of the above with your own amount |
| `gs-from-[y:50,opacity:0]` | Start from these values, end as the page looks |
| `gs-to-[x:200,rotate:90]` | Start as the page looks, end on these values |
| `gs-from-y-50` `gs-to-x-200` | The short form, one value at a time |

### How long, how fast

| Class | What it does |
| --- | --- |
| `gs-duration-1.2` | Seconds. `500ms` and `500` also work |
| `gs-delay-0.3` | Wait before starting |
| `gs-ease-power3.out` | Any GSAP ease. `gs-ease-[0.7,0,0.3,1]` takes a cubic-bezier |
| `gs-repeat-2` `gs-repeat` | Repeat a number of times, or forever |
| `gs-yoyo` `gs-repeat-delay-0.5` | Back and forth, and a pause between repeats |

### Which elements

| Class | What it does |
| --- | --- |
| `gs-stagger-0.1` | Animate the children, this far apart. Each waits until it is on screen. A child with its own animation keeps it |
| `gs-stagger-center` | Start from the `center`, the `end`, the `edges` or at `random`. From the center or the edges the whole wave takes as long as from the start, so neighbours are twice as far apart |
| `gs-children` | Animate the children with the default gap |
| `gs-target-[.dot]` | Animate the elements inside that match |
| `gs-split-lines` `-words` `-chars` | Split the text |
| `gs-mask` | Clip each split piece, so it rises out of nowhere. The clip leaves room for descenders and tight line heights |

### When

| Class | What it does |
| --- | --- |
| (nothing) | When it scrolls into view, once |
| `gs-replay` | Again every time you scroll down to it. It resets once it is back below the screen |
| `gs-reverse` | Run backwards when you scroll back up past it |
| `gs-start-[top_70%]` | Where it begins. `gs-start-center` works too |
| `gs-trigger-[#hero]` | Let another element decide when |
| `click:gs-trigger-[.menu-button]` | Buttons that open and close it. Several may match, also ones added later |
| `click:gs-outside` | A click anywhere else closes it, and so does Escape |
| `load:` | As soon as the page is ready |
| `hover:` `press:` `focus:` `click:` | On that moment, and back when it ends |
| `group-hover:` | When the nearest `gs-group` is hovered |

Classes behind the same prefix belong together: `load:gs-fade-up load:gs-duration-2`. A plain
`gs-duration-2` times the scroll animation, and on localhost the console says so when there is none.

A reveal behind `hover:` is where the element rests. `hover:gs-fade` is see-through until the
pointer finds it, and `group-hover:gs-fade-up` is a caption that shows while its card is hovered.

### Scroll

| Class | What it does |
| --- | --- |
| `gs-scrub` | Follow the scrollbar, evenly unless you add an ease. `gs-scrub-1` sets the smoothing, `gs-scrub-0` removes it |
| `gs-pin` `gs-pin-300` | Hold the element for one screen of scrolling, or three |
| `gs-end-[bottom_top]` | Where it stops |
| `gs-snap` | Settle on the steps of a timeline or the panels of a row |
| `gs-toggle-[is-seen]` | Add a class of yours while it is in range |
| `gs-markers` | Show the start and end, for debugging |
| `gs-st-[pinSpacing:false]` | Any other ScrollTrigger option |

Content that scrolls inside a box of its own (an app shell with `overflow: auto`) is found by
itself. To name the box yourself: `gs-st-[scroller:#shell]`.

### Sequences

| Class | What it does |
| --- | --- |
| `gs-timeline` | Play every animated element inside as one sequence |
| `gs-with` | Start together with the step before |
| `gs-at-[-=0.3]` | A GSAP position: overlap, gap, time or label |
| `gs-label-[intro]` | Name a step, so others can use `gs-at-[intro]` |
| `click:gs-timeline` | A sequence opened by a click instead of the scroll |

A `gs-timeline` inside another one is a single step of it. A step that has scroll classes of its
own (`gs-scrub`, `gs-start-...`, `gs-pin`, `gs-trigger-...`) keeps them and runs by itself.

### Ready-made

| Class | What it does |
| --- | --- |
| `gs-parallax-20` | Drift against the scroll. Images are zoomed to cover their frame |
| `gs-horizontal` | Pin the section and slide its first child sideways |
| `gs-frames` | An image sequence on a canvas: `data-gs-frames="/img/f-[001-120].webp"` |
| `gs-marquee` | An endless row. Add `-right`, `-120` (px a second), `-pause` or `-scroll`, or several: `gs-marquee-right-120` |
| `gs-magnetic` `gs-tilt` | Lean toward the pointer, or turn in 3D |
| `gs-count` | Count up to the number in the text. Keeps its commas, decimals, units and the tags around it |
| `gs-odometer` | Roll every digit into place in its own mask, like a mileage counter. `gs-odometer-90` starts at 90 |
| `gs-odometer-steps` | The same wheels, but they stop and rest on the way: the loader you see on portfolio sites. `gs-odometer-[32,71,100]` picks the stops yourself |
| `gs-draw` `gs-scramble` `gs-type` | Draw SVG strokes, scramble text, type text |
| `gs-smooth` | Smooth scrolling, on the wrapper around your content |
| `gs-scroll-to` | A link that glides to its `#target` |

### Screen and motion

| Class | What it does |
| --- | --- |
| `sm:` `md:` `lg:` `xl:` `2xl:` | From that width up. Replaces the plain class |
| `max-md:` `min-[900px]:` `max-[900px]:` | Below a width, or your own width |
| `motion-safe:` `motion-reduce:` | By the visitor's motion setting |
| `pointer-fine:` `pointer-coarse:` | Mouse or touch |
| `gs-off` | No animation on this element |
| `gs-motion-ok` | Keep it even with reduced motion on |

## What it takes care of

- **No flash.** Elements that animate in are hidden before the first paint. If the script never
  arrives, a three second failsafe shows them (a menu that opens on a click stays closed).
- **Nothing left behind.** When a reveal finishes, the element goes back to plain HTML: no inline
  styles, no split spans. A hover that has ended hands the element back too. Only a
  `data-gs-ready` mark stays, which tells the stylesheet the element no longer waits.
- **Once means once.** A reveal that has played does not play again when the page is rebuilt around
  it: the window crossing a breakpoint, a list changing, `gs.refresh()`. New elements still animate.
- **Hidden things wait.** What sits in a closed tab, a `<dialog>` or a block that only exists on
  phones is set up when it is shown, and animates then.
- **Hover and reveal get along.** A hover, press or click waits until the element's reveal has
  landed, then plays from the finished look. One ending never undoes what another is still
  doing: a hover on a scrubbed element leaves the scrub alone.
- **Menus keep their state.** A click menu that is open stays open when the page is rebuilt
  around it, for example when a phone is turned.
- **Only what you use.** ScrollTrigger, SplitText and the other plugins are loaded the first time
  a class asks for them.
- **A changing page.** Elements added later animate. Removed ones are cleaned up. Classes that
  change rebuild their animation. A copy of an element starts clean, even if the original was
  half way through its reveal. Scroll positions are measured again when the page changes height.
- **Positions that make sense.** An element that starts 40px low is counted where it will end up.
  A line at the very bottom of the page still gets its turn. A scrubbed element in the first
  screen starts at its beginning. Right-to-left pages, pins inside transformed parents and
  `scroll-behavior: smooth` are handled.
- **Keyboard.** `press:` answers to Enter and Space. A `click:` on something that is not a button
  or a link becomes focusable and answers to Enter and Space as well. Escape closes a menu and
  hands the focus back to its button.
- **Within reach.** A reveal that has not played yet is see-through, not hidden: the Tab key and
  screen readers still get to it, and focusing it scrolls it into view, which plays it. A closed
  `click:` menu is the opposite: it and its steps are out of the page until it opens.
- **Copies.** A copy of an element (a cloned card, a list template) starts clean, also when the
  original was half way through counting, typing or rolling.
- **Text stays text.** While an odometer rolls, the element's text is still the number, so copying
  the sentence around it, or reading it from a script, gives what you wrote.
- **CSS transitions.** A `transition` on a property GSAP is animating makes it lag. It is switched
  off for just those properties, for just as long as the animation runs.
- **Less motion.** With reduced motion on, reveals and loops do not run and the page shows
  finished. A count or an odometer is simply the number. Scrubbed animations stay, without
  smoothing. Parallax, marquees and magnets are off.
- **React.** Animations start after hydration and are made once in strict mode. React can remove
  or reorder a pinned element without the usual `removeChild` error.
- **Typos.** On localhost, `gs-fad-up` logs `Did you mean "gs-fade-up"?`, and an ease GSAP does
  not know is named instead of quietly replaced.

## JavaScript, when you want it

```js
import gs from "tweenwind";

gs.config({ duration: 1, ease: "expo.out", distance: 60 });

// A class of your own: gs-swoop
gs.preset("swoop", { from: { autoAlpha: 0, y: 80, rotation: 6 } });

// Anything GSAP can do, as a class
gs.preset("glow", {
  build(timeline, targets) {
    timeline.from(targets, { opacity: 0, duration: 0.45, stagger: 0.045 });
  },
});

gs.start();                         // animate the page and keep watching it
const [timeline] = gs.get("#hero"); // the GSAP timeline behind an element
gs.refresh();                       // measure and rebuild everything
gs.revert(".card");                 // leave these alone from now on
gs.scan(".card");                   // and bring them back
gs.revert();                        // take everything off

document.addEventListener("gs:complete", (event) => console.log(event.target));
```

With the script tag, set options before it loads:

```html
<script>window.gsConfig = { duration: 1, start: "top 80%" };</script>
<script src="https://cdn.jsdelivr.net/npm/tweenwind"></script>
```

| Option | Default | What it is |
| --- | --- | --- |
| `prefix` | `"gs"` | The class prefix |
| `duration` | `0.8` | Default length in seconds |
| `ease` | `"power3.out"` | Default ease |
| `distance` | `40` | How far the directional reveals travel, in px |
| `start` | `"top 88%"` | Where an element must be to play |
| `scrub` | `0.6` | Scrub smoothing in seconds, or `true` for none |
| `stagger` | `0.08` | Default gap between children |
| `reducedMotion` | `true` | Respect the visitor's motion setting |
| `observe` | `true` | Watch the page for changes |
| `cleanup` | `true` | Put finished reveals back to plain HTML |
| `debug` | `false` | Markers on everything, and logs |
| `breakpoints` | Tailwind's | `{ sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 }` |

Already importing GSAP plugins yourself? Hand them over and they are not loaded twice:

```js
import { ScrollTrigger } from "gsap/ScrollTrigger";
gs.use({ ScrollTrigger });
```

## Good to know

- With `gs-smooth`, a header that is `position: fixed` goes outside the smooth wrapper, or it
  scrolls away with the content.
- `gs-pin` on its own holds the element for one screen. Add `gs-scrub` to drive an animation
  while it is held.
- Letters split with `gs-split-chars` have kerning switched off, so they do not shift when the
  split is undone at the end.
- A finished one-time timeline (`gs-timeline` without `gs-scrub`) is tidied away like a reveal.
- `gs-count` and `gs-odometer` read the first number in the text: `1,200`, `12,50,000`, `99.9`,
  `-40`. A dash that joins words (`COVID-19`) is not a minus sign.
- Every animated element gets its own ScrollTrigger, as it would by hand. Hundreds are fine.
  With several thousand on one page, GSAP itself needs a second or two to set them up.

## React

`<Gs />` turns the classes on for the whole page. Wrap a part in `<Gs>...</Gs>` if you want its
animations removed the instant React unmounts it. `useGs()` is the same switch as a hook.

Split text works on text. If a heading holds components with their own state or event handlers,
split a plain element inside it instead.

## GSAP and its licence

This package does not include GSAP. You install it next to this one, or the script-tag build
loads it from jsDelivr. GSAP is made by Webflow and is free under its own
[standard licence](https://gsap.com/standard-license). GSAP 3.13 or newer is needed.

## Working on it

```bash
git clone https://github.com/Hank-D-Tank/tweenwind.git
cd tweenwind
npm install
npm run build          # dist/ and the docs site's copy
npm test               # the parser
npm run test:browser   # everything else, in a real browser (uses the Chrome on your machine)
npm run docs           # the docs site on http://localhost:5262
```

## Licence

MIT
