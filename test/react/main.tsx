import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { gs } from "tweenwind/react";
import { gsap } from "gsap";
import { App } from "./App";

// The test helpers reach the library and GSAP through the window.
Object.assign(window, { gs, gsap });

const container = document.getElementById("root")!;
const tree = (
  <StrictMode>
    <App />
  </StrictMode>
);
if (container.hasChildNodes()) hydrateRoot(container, tree);
else createRoot(container).render(tree);
