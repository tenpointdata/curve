import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import "../curve2/main.ts";
import { compileJsx } from "./jsx.ts";
import { renderReact, viewWithProps, type ReactFactory } from "./react.ts";

const fragment = Symbol("fragment");
type Element = {
  tag: string | typeof fragment;
  props: Record<string, string | boolean | number> | null;
  children: (string | Element)[];
};
const createElement: ReactFactory<Element, typeof fragment> =
  (tag, props, ...children) => ({ tag, props, children });

async function withViews(source: string, use: (views: Readonly<Record<string, unknown>>) => void) {
  const directory = await mkdtemp(join(tmpdir(), "curve-jsx-list-"));
  try {
    const file = join(directory, "views.curve");
    await Bun.write(file, compileJsx(source, "list.tsx"));
    const views: Readonly<Record<string, unknown>> = (await import(pathToFileURL(file).href)).default;
    use(views);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function element(value: Element | string): Element {
  if (typeof value === "string") throw new Error("Expected a rendered element");
  return value;
}

test("encodes record props and preserves the requested keys when Curve maps and reorders them", async () => {
  await withViews(`
    interface Item { label: string; id: string; checked: boolean }
    const Entry = ({ label, checked }: { label: string; checked: boolean }) =>
      <li data-checked={checked}>{label}</li>;
    const List = ({ items }: {items: ReadonlyArray<Item>}) =>
      <ul>{items.map(item => <Entry key={item.id} label={item.label} checked={item.checked}/>)}</ul>;
    export const App = ({ items }: {items: readonly { id: string; checked: boolean; label: string }[]}) =>
      <List items={items}/>;
  `, (views) => {
    const a = { id: "a", label: "first", checked: true };
    const b = { id: "b", label: "second", checked: false };
    const render = (items: unknown[]) => element(renderReact(
      viewWithProps(views, "Component.App", { items }), createElement, fragment));
    const first = element(render([a, b]).children[0]);
    const swapped = element(render([b, a]).children[0]);
    expect(first.children.map(item => element(item).props?.key)).toEqual(["a", "b"]);
    expect(swapped.children.map(item => element(item).props?.key)).toEqual(["b", "a"]);
    expect(element(first.children[0]).children).toEqual([
      { tag: "li", props: { "data-checked": true }, children: ["first"] },
    ]);
    expect(element(render([]).children[0]).children).toEqual([]);
    expect(() => render([a, a])).toThrow("Duplicate Curve View list key a");
    expect(() => render([{ id: "a", label: "first" }])).toThrow("Prop items[0].checked requires a boolean");
    expect(() => render([{ ...a, id: 2 }])).toThrow("Prop items[0].id requires a string");
  });
});

test("accepts scalar lists and destructured record items with U32 keys", async () => {
  await withViews(`
    export const Numbers = ({ values }: {values: number[]}) =>
      values.map(value => <p key={value}>{value}</p>);
    export const Words = ({ values }: {values: string[]}) =>
      values.map(value => <p key={value}>{value}</p>);
    export const Records = ({ values }: {values: {id: number; label: string}[]}) =>
      values.map(({id, label: caption}) => { return <p key={id}>{caption}</p>; });
  `, (views) => {
    const render = (name: string, values: unknown[]) => element(renderReact(
      viewWithProps(views, "Component." + name, { values }), createElement, fragment));
    expect(element(render("Numbers", [0xffff_ffff]).children[0])).toEqual({
      tag: fragment, props: { key: "4294967295" }, children: [{
        tag: "p", props: {}, children: ["4294967295"],
      }],
    });
    expect(() => render("Numbers", [-1])).toThrow("Prop values[0] requires an unsigned 32-bit integer");
    expect(element(render("Words", ["curve"]).children[0]).props?.key).toBe("curve");
    expect(element(render("Records", [{ id: 17, label: "entry" }]).children[0])).toEqual({
      tag: fragment, props: { key: "17" }, children: [{ tag: "p", props: {}, children: ["entry"] }],
    });
  });
});

test("locates absent and invalid keys and unsupported map callbacks", () => {
  const cases = [
    ["items.map(item => <li>{item.id}</li>)", "Each mapped JSX element requires a key"],
    ['items.map(item => <li key="constant">{item.id}</li>)', "A list key must be the item"],
    ["items.map(item => <li key={item.done}>{item.id}</li>)", "A list key must be the item"],
    ["items.map(item => <li key={outside}>{item.id}</li>)", "A list key must be the item"],
    ["items.map((item, index) => <li key={index}>{item.id}</li>)", "exactly one item parameter"],
    ["items.map(item => <>{item.id}</>)", "must return one keyed JSX element"],
    ["items.map(item => { const id = item.id; return <li key={id}/>; })", "single JSX return"],
  ];
  for (const [expression, message] of cases) {
    const source = "const App = ({ items, outside }: {items: { id: string; done: boolean }[]; outside: string}) => " +
      expression + ";";
    expect(() => compileJsx(source, "bad-list.tsx")).toThrow(/bad-list\.tsx:1:\d+:/);
    expect(() => compileJsx(source, "bad-list.tsx")).toThrow(message);
  }
});
