import type { CallExpression, Identifier, JSXElement, Node, ObjectPattern } from "@babel/types";
import type { ListItem, PropType } from "./view_props.ts";

export type Value = { type: PropType; curve: string };
type Fail = (node: Node, message: string) => never;
type ItemParameter = Identifier | ObjectPattern;

export function bindingName(node: Node): string | undefined {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed &&
    node.object.type === "Identifier" && node.property.type === "Identifier") {
    return node.object.name + "." + node.property.name;
  }
}

export function isMapCall(node: Node): node is CallExpression {
  return node.type === "CallExpression" && node.callee.type === "MemberExpression" &&
    !node.callee.computed && node.callee.property.type === "Identifier" && node.callee.property.name === "map";
}

export function listCallback(node: CallExpression, fail: Fail): { parameter: ItemParameter; root: JSXElement } {
  const callback = node.arguments[0];
  if (node.arguments.length !== 1 || callback?.type !== "ArrowFunctionExpression" ||
    callback.async || callback.typeParameters || callback.params.length !== 1) {
    return fail(callback ?? node, "List rendering requires one synchronous arrow callback with exactly one item parameter");
  }
  const parameter = callback.params[0];
  if (parameter.type !== "ObjectPattern" && parameter.type !== "Identifier") {
    return fail(parameter, "Use an item identifier or destructure its record fields");
  }
  const body = callback.body;
  let returned: Node = body;
  if (body.type === "BlockStatement") {
    const [line] = body.body;
    if (body.directives.length || body.body.length !== 1 || line?.type !== "ReturnStatement" || !line.argument) {
      return fail(body, "A list callback block must contain a single JSX return");
    }
    returned = line.argument;
  }
  if (returned.type !== "JSXElement") return fail(returned, "A list callback must return one keyed JSX element");
  return { parameter, root: returned };
}

export function bindItem(parameter: ItemParameter, item: ListItem, variable: string,
  inherited: ReadonlyMap<string, Value>, fail: Fail): { values: Map<string, Value>; keys: Set<string> } {
  const values = new Map(inherited);
  const keys = new Set<string>();
  function shadow(name: string): void {
    for (const inheritedName of values.keys()) {
      if (inheritedName === name || inheritedName.startsWith(name + ".")) values.delete(inheritedName);
    }
  }
  function add(name: string, value: Value): void {
    values.set(name, value);
    if (value.type === "text" || value.type === "number") keys.add(name);
  }

  if (typeof item === "string") {
    if (parameter.type !== "Identifier") return fail(parameter, "Use an identifier for the scalar list item");
    shadow(parameter.name);
    add(parameter.name, { type: item, curve: variable });
  } else {
    const fields = new Map(item.fields.map(({ name, type }, index) => [
      name, { type, curve: item.tag + ".field_" + index + "(" + variable + ")" },
    ]));
    if (parameter.type === "Identifier") {
      shadow(parameter.name);
      for (const [name, value] of fields) add(parameter.name + "." + name, value);
    } else {
      const used = new Set<string>();
      for (const property of parameter.properties) {
        if (property.type !== "ObjectProperty" || property.computed || property.key.type !== "Identifier" ||
          property.value.type !== "Identifier" || used.has(property.value.name)) {
          return fail(property, "Destructure declared list fields without defaults or rest");
        }
        const field = fields.get(property.key.name);
        if (!field) return fail(property, "Unknown list record field " + property.key.name);
        const local = property.value.name;
        used.add(local);
        shadow(local);
        add(local, field);
      }
    }
  }
  return { values, keys };
}

export function keySource(root: JSXElement, keys: ReadonlySet<string>, fail: Fail): string {
  const props = root.openingElement.attributes.filter(attribute =>
    attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier" && attribute.name.name === "key");
  const [key] = props;
  if (!key) return fail(root.openingElement, "Each mapped JSX element requires a key");
  if (props.length > 1) return fail(props[1], "Duplicate JSX prop key");
  if (key.type !== "JSXAttribute" || key.value?.type !== "JSXExpressionContainer") {
    return fail(key, "A list key must be the item or one of its string or U32 fields");
  }
  const source = bindingName(key.value.expression);
  if (!source || !keys.has(source)) {
    return fail(key, "A list key must be the item or one of its string or U32 fields");
  }
  return source;
}
