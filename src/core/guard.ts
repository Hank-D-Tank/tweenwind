/**
 * Pinning wraps the element in a spacer, so the element's parent changes. React (unlike most
 * frameworks) removes a node through the parent it remembers, and that call throws once the
 * node has moved. This puts a small catch on that one parent: when something tries to remove
 * or move a pinned child, the pin is undone first, and the call then goes through as normal.
 *
 * ScrollTrigger's own moves pass straight through. It only ever puts the element back in
 * front of its own spacer, which is easy to tell apart from a framework's call.
 */

const guards = new WeakMap<Node, Map<Node, () => void>>();
const METHODS = ["removeChild", "insertBefore", "appendChild", "replaceChild"] as const;

function watch(parent: Node): Map<Node, () => void> {
  let pinned = guards.get(parent);
  if (pinned) return pinned;
  pinned = new Map();
  guards.set(parent, pinned);
  const children = pinned;
  const node = parent as any;
  const proto = Node.prototype as any;

  /**
   * True when the child is one of ours and currently sits inside its spacer.
   * Anywhere else it is not our business: GSAP itself moves an element to <html> for an
   * instant to measure it when an ancestor is display:none, and puts it back through here.
   */
  const wrapped = (child: Node | null): child is Node => {
    if (!child || !children.has(child)) return false;
    const spacer = child.parentNode;
    return !!spacer && spacer !== parent && spacer.parentNode === parent;
  };
  const release = (child: Node) => {
    const undo = children.get(child);
    if (undo) undo();
  };

  node.removeChild = function (child: Node) {
    if (wrapped(child)) release(child);
    return proto.removeChild.call(this, child);
  };
  node.insertBefore = function (child: Node, before: Node | null) {
    if (wrapped(child) && before !== child.parentNode) release(child);
    // Something new goes in front of a pinned element: put it in front of the spacer instead.
    if (wrapped(before)) before = before.parentNode;
    return proto.insertBefore.call(this, child, before);
  };
  node.appendChild = function (child: Node) {
    if (wrapped(child)) release(child);
    return proto.appendChild.call(this, child);
  };
  node.replaceChild = function (child: Node, old: Node) {
    if (wrapped(old)) release(old);
    return proto.replaceChild.call(this, child, old);
  };
  return children;
}

/** Returns a function that removes the guard. `undo` must take the pin off synchronously. */
export function guardPin(el: Node, parent: Node, undo: () => void): () => void {
  const children = watch(parent);
  children.set(el, undo);
  return () => {
    children.delete(el);
    if (children.size) return;
    guards.delete(parent);
    for (const method of METHODS) delete (parent as any)[method];
  };
}
