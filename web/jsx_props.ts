import type { Node, Pattern, TSType, TSTypeElement } from "@babel/types";
import type { ListItem, PropType, RowField, RowLayout, ScalarKind } from "./view_props.ts";

export type PropBinding = { name: string; type: PropType };
export type LocalTypes = ReadonlyMap<string, TSType | TSTypeElement[]>;
export type Rows = Map<string, RowLayout>;
type Fail = (node: Node, message: string) => never;

const scalarCurve: Record<ScalarKind, string> = { text: "String", bool: "Bool", number: "U32" };
const scalarKind: Partial<Record<TSType["type"], ScalarKind>> = {
  TSStringKeyword: "text", TSBooleanKeyword: "bool", TSNumberKeyword: "number",
};

export function itemCurve(item: ListItem): string {
  return typeof item === "string" ? scalarCurve[item] : item.tag;
}

export function propCurve(type: PropType): string {
  return typeof type === "string" ? scalarCurve[type] : "List<&2, " + itemCurve(type.item) + ">";
}

function members(type: TSType, types: LocalTypes, fail: Fail, seen = new Set<string>()): TSTypeElement[] {
  if (type.type === "TSTypeLiteral") return type.members;
  if (type.type === "TSTypeReference" && type.typeName.type === "Identifier" && !type.typeParameters) {
    const name = type.typeName.name;
    const declared = types.get(name);
    if (declared && !seen.has(name)) {
      return Array.isArray(declared) ? declared : members(declared, types, fail, new Set([...seen, name]));
    }
  }
  return fail(type, "Props and list items need local object types with required fields");
}

function property(member: TSTypeElement, fail: Fail): [string, TSType] {
  if (member.type !== "TSPropertySignature" || member.optional || member.computed ||
    member.key.type !== "Identifier" || !member.typeAnnotation) {
    return fail(member, "Only required string, boolean and U32 number prop types and supported arrays are accepted");
  }
  return [member.key.name, member.typeAnnotation.typeAnnotation];
}

function rowType(item: TSType, types: LocalTypes, rows: Rows, fail: Fail): RowLayout {
  const fields: RowField[] = members(item, types, fail).map((member) => {
    const [name, type] = property(member, fail);
    const kind = scalarKind[type.type];
    if (!kind) return fail(type, "List record fields require string, boolean or U32 number types");
    return { name, type: kind };
  });
  if (!fields.length || new Set(fields.map(field => field.name)).size !== fields.length) {
    return fail(item, "List record fields must be nonempty and distinct");
  }
  fields.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const key = JSON.stringify(fields);
  const known = rows.get(key);
  if (known) return known;
  const layout = { tag: "JsxRow" + (rows.size + 1), fields };
  rows.set(key, layout);
  return layout;
}

function propType(type: TSType, types: LocalTypes, rows: Rows, fail: Fail): PropType {
  const scalar = scalarKind[type.type];
  if (scalar) return scalar;
  const plain = type.type === "TSTypeOperator" && type.operator === "readonly" ? type.typeAnnotation : type;
  const item = plain.type === "TSArrayType" ? plain.elementType
    : plain.type === "TSTypeReference" && plain.typeName.type === "Identifier" &&
      (plain.typeName.name === "Array" || plain.typeName.name === "ReadonlyArray") &&
      plain.typeParameters?.params.length === 1 ? plain.typeParameters.params[0] : undefined;
  if (!item) return fail(type, "Only required string, boolean and U32 number prop types and supported arrays are accepted");
  if (item.type === "TSStringKeyword") return { item: "text" };
  if (item.type === "TSNumberKeyword") return { item: "number" };
  return { item: rowType(item, types, rows, fail) };
}

export function bindProps(parameter: Pattern, types: LocalTypes, rows: Rows, fail: Fail): Map<string, PropBinding> {
  if (parameter.type !== "ObjectPattern") {
    return fail(parameter, "Use a destructured prop parameter, for example { title }");
  }
  const fields = new Map<string, PropBinding>();
  const used = new Set<string>();
  const annotation = parameter.typeAnnotation;
  let declared: Map<string, PropType> | undefined;
  if (annotation?.type === "TSTypeAnnotation") {
    const all = members(annotation.typeAnnotation, types, fail);
    declared = new Map(all.map(member => {
      const [name, type] = property(member, fail);
      return [name, propType(type, types, rows, fail)];
    }));
    if (declared.size !== all.length) return fail(annotation, "Duplicate prop type");
  } else if (annotation) {
    return fail(annotation, "Use TypeScript prop types");
  }
  for (const property of parameter.properties) {
    if (property.type !== "ObjectProperty" || property.computed || property.key.type !== "Identifier" ||
      property.value.type !== "Identifier" || fields.has(property.key.name) || used.has(property.value.name)) {
      return fail(property, "Expected a distinct prop binding without a default or rest");
    }
    if (declared && !declared.has(property.key.name)) return fail(property, "Prop is missing from its TypeScript type");
    used.add(property.value.name);
    fields.set(property.key.name, { name: property.value.name, type: declared?.get(property.key.name) ?? "text" });
  }
  if (declared && declared.size !== fields.size) {
    return fail(parameter, "Destructure every declared prop to preserve the component's arguments");
  }
  return fields;
}

export function rowDefinitions(rows: Rows): string[] {
  return [...rows.values()].flatMap(({ tag, fields }) => [
    "type " + tag + " is Data:\n  " + tag + "{" +
      fields.map((field, index) => "field_" + index + ": " + scalarCurve[field.type]).join(", ") + "}",
    ...fields.map((field, index) =>
      "def " + tag + ".field_" + index + "(row: " + tag + ") -> " + scalarCurve[field.type] +
      ":\n  match row:\n    case " + tag + "{" +
      fields.map((_, fieldIndex) => fieldIndex === index ? "value" : "_").join(", ") + "}:\n      value"),
  ]);
}
