import { record, unpackList } from "./wire.ts";
export { viewWithProps } from "./view_props.ts";

export type ReactFactory<Node, Fragment> = (
  tag: string | Fragment,
  props: Record<string, string | boolean | number> | null,
  ...children: (string | Node)[]
) => Node;

export function isViewTag(tag: string): boolean {
  return /^[a-z][a-zA-Z0-9-]*$/.test(tag);
}

export function isViewProp(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)
    && !/^(on|style$|ref$|srcdoc$|dangerouslysetinnerhtml$)/i.test(name);
}

function attribute(value: unknown): [string, string | boolean | number] {
  const prop = record(value, "Curve View constructor");
  if (typeof prop.name !== "string" || !isViewProp(prop.name)) {
    throw new TypeError("Unsupported Curve View prop");
  }
  if (
    (prop.$ === "ViewTextProp" && typeof prop.value === "string") ||
    (prop.$ === "ViewBoolProp" && typeof prop.value === "boolean") ||
    (prop.$ === "ViewNumberProp" && typeof prop.value === "number"
      && Number.isInteger(prop.value) && prop.value >= 0 && prop.value <= 0xffff_ffff)
  ) {
    return [prop.name, prop.value];
  }
  throw new TypeError("Unsupported Curve View prop value");
}

export function renderReact<Node, Fragment>(
  view: unknown,
  createElement: ReactFactory<Node, Fragment>,
  fragment: Fragment,
): string | Node {
  function render(value: unknown): string | Node {
    const node = record(value, "Curve View constructor");
    if (node.$ === "ViewText" && typeof node.value === "string") return node.value;
    if (node.$ === "ViewFragment") return createElement(fragment, null, ...unpackList(node.children, render));
    if (node.$ === "ViewList") {
      const keys = new Set<string>();
      const children = unpackList(node.children, entry => {
        const item = record(entry, "a keyed Curve View list item");
        if (item.$ !== "ViewKeyed" || typeof item.key !== "string") {
          throw new TypeError("A Curve View list item requires a key");
        }
        if (keys.has(item.key)) throw new TypeError("Duplicate Curve View list key " + item.key);
        keys.add(item.key);
        return createElement(fragment, { key: item.key }, render(item.child));
      });
      return createElement(fragment, null, ...children);
    }
    if (node.$ === "ViewElement" && typeof node.tag === "string" && isViewTag(node.tag)) {
      return createElement(node.tag, Object.fromEntries(unpackList(node.props, attribute)), ...unpackList(node.children, render));
    }
    throw new TypeError("Unsupported Curve View node");
  }
  return render(view);
}
