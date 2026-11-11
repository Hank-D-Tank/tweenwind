import { createElement, useEffect, useLayoutEffect, useRef } from "react";
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { gs } from "./index";
import type { Config } from "./core/types";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type GsProps<T extends ElementType> = {
  /** The wrapper element when there are children. Defaults to a `div` that does not affect layout. */
  as?: T;
  /** Library defaults, read once on first mount. */
  config?: Partial<Config>;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children">;

/**
 * Turns the classes on. Render it once, anywhere, and every `gs-*` class on the page works,
 * including on pages you navigate to later.
 *
 *     <Gs />
 *
 * Give it children and it also takes their animations off before React removes them:
 *
 *     <Gs><section className="gs-pin">...</section></Gs>
 */
export function Gs<T extends ElementType = "div">({ as, config, children, ...rest }: GsProps<T>) {
  const ref = useRef<HTMLElement | null>(null);

  useIsoLayoutEffect(() => {
    if (config) gs.config(config);
    gs.start();
    const root = ref.current;
    if (!root) return;
    gs.scan(root);
    return () => gs.revert(root);
  }, []);

  if (children === undefined || children === null) return null;
  const wrapper = as || "div";
  const style = as ? (rest as any).style : { display: "contents", ...(rest as any).style };
  return createElement(wrapper, { ...rest, style, ref }, children);
}

/** The same switch as `<Gs />`, as a hook. Returns the library for manual control. */
export function useGs(config?: Partial<Config>) {
  useIsoLayoutEffect(() => {
    if (config) gs.config(config);
    gs.start();
  }, []);
  return gs;
}

export { gs };
export default Gs;
