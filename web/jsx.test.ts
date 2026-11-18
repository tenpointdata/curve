import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import "../curve2/main.ts";
import { compileJsx, compileJsxFile } from "./jsx.ts";
import { renderReact, type ReactFactory } from "./react.ts";

const fragment = Symbol("fragment");

interface Element {
  tag: string | typeof fragment;
  props: Record<string, string | boolean | number> | null;
  children: (string | Element)[];
}

const createElement: ReactFactory<Element, typeof fragment> =
  (tag, props, ...children) => ({ tag, props, children });

test("lowers a TSX module through Curve's JS compiler and maps its constructors to React calls", async () => {
  const source = `
    import React from "react";
    interface Props { title: string; detail: string }
    const Header = ({ title, detail: label }: Props) =>
      <h1 title={title}>{title} &amp; {label}</h1>;

    export default function App() {
      return <>
        <Header detail="React" title="Curve"/>
        <input disabled size={24} aria-label={"🌙 \\u0007press"}/>
        <p>
          first line
          second line
        </p>
        {false}
        {null}
      </>;
    }
  `;
  const directory = await mkdtemp(join(tmpdir(), "curve-jsx-"));
  try {
    const file = join(directory, "ui.curve");
    await Bun.write(file, compileJsx(source, "ui.tsx"));
    const views: Record<string, () => unknown> = (await import(pathToFileURL(file).href)).default;
    expect(renderReact(views["Component.App"](), createElement, fragment)).toEqual({
      tag: fragment,
      props: null,
      children: [
        { tag: "h1", props: { title: "Curve" }, children: ["Curve", " & ", "React"] },
        { tag: "input", props: { disabled: true, size: 24, "aria-label": "🌙 \u0007press" }, children: [] },
        { tag: "p", props: {}, children: ["first line second line"] },
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("accepts JSX anonymous defaults, nested children, boolean expressions and numeric text", () => {
  const result = compileJsx("export default () => <div><em>{3}</em>{true}</div>;", "entry.jsx");
  expect(result).toContain("def Component.Default() -> View.Node:");
  expect(result).toContain('View.ViewElement{"em", [], [View.ViewText{"3"}]}');
});

test("links default and named JSX modules and executes both typed render branches", async () => {
  const directory = await mkdtemp(join(tmpdir(), "curve-jsx-"));
  const entry = join(directory, "app.tsx");
  try {
    await Bun.write(entry, `
      import Badge, { Count as Counter } from "./badge";
      import { Count as OtherCounter } from "./badge.tsx";
      export function App({ label, enabled, count }: { label: string; enabled: boolean; count: number }) {
        return <>
          {enabled && <strong>ready</strong>}
          <Badge title={label} active={enabled} size={count} />
          <Counter value={count}/>
          <OtherCounter value={0}/>
        </>;
      }
    `);
    await Bun.write(join(directory, "badge.tsx"), `
      export default function Status({ title, active, size }: { title: string; active: boolean; size: number }) {
        return active ? <input title={title} disabled={!active} size={size}/> : <em>{size}</em>;
      }
      const Marker = ({ value }: { value: number }) => <small>{value}</small>;
      export { Marker as Count };
    `);
    const generated = compileJsxFile(entry);
    expect(generated.match(/def Imported\d+\.Marker/g)).toHaveLength(1);
    expect(generated).toContain("def Component.App(+prop_0: String, +prop_1: Bool, +prop_2: U32)");
    const output = join(directory, "linked.curve");
    await Bun.write(output, generated);
    const views: { "Component.App": (name: string, active: boolean, size: number) => unknown } =
      (await import(pathToFileURL(output).href)).default;
    const enabled = renderReact(views["Component.App"]("demo", true, 17), createElement, fragment);
    const disabled = renderReact(views["Component.App"]("demo", false, 0xffff_ffff), createElement, fragment);
    expect(enabled).toEqual({
      tag: fragment, props: null, children: [
        { tag: "strong", props: {}, children: ["ready"] },
        { tag: "input", props: { title: "demo", disabled: false, size: 17 }, children: [] },
        { tag: "small", props: {}, children: ["17"] },
        { tag: "small", props: {}, children: ["0"] },
      ],
    });
    expect(disabled).toEqual({
      tag: fragment, props: null, children: [
        { tag: fragment, props: null, children: [] },
        { tag: "em", props: {}, children: ["4294967295"] },
        { tag: "small", props: {}, children: ["4294967295"] },
        { tag: "small", props: {}, children: ["0"] },
      ],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports the importing file and line for unresolved, ambiguous and cyclic JSX imports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "curve-jsx-"));
  const entry = join(directory, "app.tsx");
  try {
    await Bun.write(entry, 'import Card from "./card"; export const App = () => <Card/>;');
    expect(() => compileJsxFile(entry)).toThrow(/app\.tsx:1:\d+: Cannot resolve local JSX module/);
    await Bun.write(join(directory, "card.jsx"), 'export default () => <p/>;');
    await Bun.write(join(directory, "card.tsx"), 'export default () => <p/>;');
    expect(() => compileJsxFile(entry)).toThrow(/app\.tsx:1:\d+: Ambiguous JSX module/);
    await rm(join(directory, "card.jsx"));
    await Bun.write(join(directory, "card.tsx"), 'import { App } from "./app.tsx"; export default () => <App/>;');
    expect(() => compileJsxFile(entry)).toThrow(/card\.tsx:1:\d+: JSX module import cycle/);
    await Bun.write(join(directory, "card.tsx"), 'const Hidden = () => <p/>;');
    expect(() => compileJsxFile(entry)).toThrow(/app\.tsx:1:\d+: Unknown component export default/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports a located error for input outside the supported subset", () => {
  const cases = [
    ['import {useState} from "react"; const App = () => <div/>;', "Only type imports and the default React import"],
    ['const App = () => <Other/>;', "Unknown local component Other"],
    ['const App = () => <div {...props}/>;', "JSX prop spreads"],
    ['const App = () => <button onClick={() => alert(1)}/>;', "Expected a literal or a bound scalar prop"],
    ['const App = () => <div dangerouslySetInnerHTML="raw"/>;', "Unsupported intrinsic prop dangerouslySetInnerHTML"],
    ['const App = () => <App/>;', "cannot call itself recursively"],
    ['const Card = ({title}: {title: string}) => <h1>{title}</h1>; const App = () => <Card/>;', "Missing prop title"],
    ['const Card = ({title}: {title: object}) => <h1>{title}</h1>;', "Only required string, boolean and U32 number prop types"],
    ['const App = () => <p>{list.map(item => <b>{item}</b>)}</p>;', "Expected a literal or a bound scalar prop"],
    ['const App = ({label}) => label && <div/>;', "A JSX condition requires a boolean"],
    ['const App = () => <input size={4294967296}/>;', "Expected a literal or a bound scalar prop"],
    ['const Card = ({count}: {count: number}) => <p>{count}</p>; const App = () => <Card count="wrong"/>;', "Prop count on Card requires U32"],
  ];
  for (const [source, message] of cases) {
    expect(() => compileJsx(source, "subset.tsx")).toThrow(/subset\.tsx:\d+:\d+:/);
    expect(() => compileJsx(source, "subset.tsx")).toThrow(message);
  }
  expect(() => compileJsx("const A = () => <div>", "broken.tsx")).toThrow("broken.tsx");
});

test("the React adapter rejects unsupported data built directly in Curve", () => {
  expect(() => renderReact({ $: "Unknown" }, createElement, fragment)).toThrow("Unsupported Curve View node");
  expect(() => renderReact({
    $: "ViewElement",
    tag: "div",
    props: {
      $: "Con",
      head: { $: "ViewTextProp", name: "dangerouslySetInnerHTML", value: "<script/>" },
      tail: { $: "Nil" },
    },
    children: { $: "Nil" },
  }, createElement, fragment)).toThrow("Unsupported Curve View prop");
});
