import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import "../curve2/main.ts";
import { compileJsx } from "./jsx.ts";
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

test("reports a located error for input outside the supported subset", () => {
  const cases = [
    ['import {useState} from "react"; const App = () => <div/>;', "Only type imports and the default React import"],
    ['const App = () => <Other/>;', "Unknown local component Other"],
    ['const App = () => <div {...props}/>;', "JSX prop spreads"],
    ['const App = () => <button onClick={() => alert(1)}/>;', "Expected a literal or a bound string prop"],
    ['const App = () => <div dangerouslySetInnerHTML="raw"/>;', "Unsupported intrinsic prop dangerouslySetInnerHTML"],
    ['const App = () => <App/>;', "cannot call itself recursively"],
    ['const Card = ({title}: {title: string}) => <h1>{title}</h1>; const App = () => <Card/>;', "Missing prop title"],
    ['const Card = ({title}: {title: number}) => <h1>{title}</h1>;', "Only required string prop types"],
    ['const App = () => <p>{list.map(item => <b>{item}</b>)}</p>;', "Expected a literal or a bound string prop"],
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
