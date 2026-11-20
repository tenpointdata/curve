import { record, type CurveList } from "./wire.ts";

export type ScalarKind = "text" | "bool" | "number";
export type RowField = { name: string; type: ScalarKind };
export type RowLayout = { tag: string; fields: readonly RowField[] };
export type ListItem = "text" | "number" | RowLayout;
export type PropType = ScalarKind | { item: ListItem };
export type PropLayout = { name: string; type: PropType };

type ViewModule = Readonly<Record<string, unknown>>;
const layouts = new WeakMap<ViewModule, Map<string, PropLayout[]>>();

function scalarKind(value: unknown): value is ScalarKind {
  return value === "text" || value === "bool" || value === "number";
}

function parseType(value: unknown): PropType {
  if (scalarKind(value)) return value;
  const { item } = record(value, "a generated list prop type");
  if (item === "text" || item === "number") return { item };
  const { tag, fields } = record(item, "a generated row type");
  if (typeof tag !== "string" || !/^JsxRow[1-9][0-9]*$/.test(tag) || !Array.isArray(fields)) {
    throw new TypeError("Invalid generated row layout");
  }
  return { item: { tag, fields: fields.map((value: unknown) => {
    const { name, type } = record(value, "a generated row field");
    if (typeof name !== "string" || !scalarKind(type)) throw new TypeError("Invalid generated row field");
    return { name, type };
  }) } };
}

function readLayout(module: ViewModule, name: string): PropLayout[] {
  let byName = layouts.get(module);
  if (!byName) {
    byName = new Map();
    layouts.set(module, byName);
  }
  const found = byName.get(name);
  if (found) return found;
  const schema = module[name + ".Props"];
  if (typeof schema !== "function") throw new TypeError("Missing generated prop layout for " + name);
  const encoded: unknown = schema();
  if (typeof encoded !== "string") throw new TypeError("Invalid generated prop layout for " + name);
  const parsed: unknown = JSON.parse(encoded);
  if (!Array.isArray(parsed)) throw new TypeError("Invalid generated prop layout for " + name);
  const layout = parsed.map((value: unknown) => {
    const { name, type } = record(value, "a generated prop");
    if (typeof name !== "string") throw new TypeError("Invalid generated prop name");
    return { name, type: parseType(type) };
  });
  byName.set(name, layout);
  return layout;
}

function encodeScalar(value: unknown, type: ScalarKind, place: string): string | boolean | number {
  if (type === "text" && typeof value === "string") return value;
  if (type === "bool" && typeof value === "boolean") return value;
  if (type === "number" && typeof value === "number" && Number.isInteger(value)
    && value >= 0 && value <= 0xffff_ffff) return value;
  const expected = type === "text" ? "a string" : type === "bool" ? "a boolean" : "an unsigned 32-bit integer";
  throw new TypeError(place + " requires " + expected);
}

function encodeItem(value: unknown, type: ListItem, place: string): unknown {
  if (typeof type === "string") return encodeScalar(value, type, place);
  const row = record(value, place + " record");
  const fields = type.fields.map(({ name, type }, index) => [
    "field_" + index,
    encodeScalar(Object.hasOwn(row, name) ? row[name] : undefined, type, place + "." + name),
  ]);
  return { $: type.tag, ...Object.fromEntries(fields) };
}

function encode(value: unknown, type: PropType, place: string): unknown {
  if (typeof type === "string") return encodeScalar(value, type, place);
  if (!Array.isArray(value)) throw new TypeError(place + " requires an array");
  let list: CurveList<unknown> = { $: "Nil" };
  for (let index = value.length - 1; index >= 0; index--) {
    const item: unknown = value[index];
    list = { $: "Con", head: encodeItem(item, type.item, place + "[" + index + "]"), tail: list };
  }
  return list;
}

export function viewWithProps(module: ViewModule, name: string, props: Readonly<Record<string, unknown>>): unknown {
  const view = module[name];
  if (typeof view !== "function") throw new TypeError("Unknown generated view " + name);
  const args = readLayout(module, name).map(({ name, type }) =>
    encode(Object.hasOwn(props, name) ? props[name] : undefined, type, "Prop " + name));
  return view(...args);
}
