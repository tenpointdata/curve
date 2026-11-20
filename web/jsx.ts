import { parse } from "@babel/parser";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import type {
  ArrowFunctionExpression, CallExpression, Expression, FunctionDeclaration, JSXAttribute, JSXElement,
  JSXFragment, JSXText, Node, Statement, TSType,
  TSTypeElement,
} from "@babel/types";
import { bindItem, bindingName, isMapCall, keySource, listCallback, type Value } from "./jsx_lists.ts";
import { bindProps, itemCurve, propCurve, rowDefinitions, type PropBinding, type Rows } from "./jsx_props.ts";
import { isViewProp, isViewTag } from "./react.ts";
import type { ScalarKind } from "./view_props.ts";

type Component = {
  curveName: string;
  props: Map<string, PropBinding>;
  expression: Expression;
  dependencies: Set<Component>;
};

type Scalar = { kind: ScalarKind; curve: string };
type Scope = { component: Component; values: ReadonlyMap<string, Value> };
type CompiledModule = { definitions: string[]; exports: ReadonlyMap<string, Component> };
type LoadModule = (specifier: string, from: string, node: Node) => CompiledModule;

const componentName = /^[A-Z][A-Za-z0-9_]*$/;

function literal(text: string): string {
  const escaped = text.replace(/["\\\u0000-\u001f\u007f-\u009f\ud800-\udfff]/gu, (character) => {
    if (character === '"' || character === "\\") return "\\" + character;
    return "\\u{" + character.codePointAt(0)!.toString(16) + "}";
  });
  return '"' + escaped + '"';
}

// JSX removes the indent at line boundaries and separates surviving lines.
function jsxText(node: JSXText): string {
  const lines = node.value.split(/\r\n|\n|\r/);
  const last = lines.reduce((end, line, index) => /[^ \t]/.test(line) ? index : end, -1);
  return lines.map((line, index) => {
    let text = line.replace(/\t/g, " ");
    if (index > 0) text = text.replace(/^ +/, "");
    if (index < lines.length - 1) text = text.replace(/ +$/, "");
    return text && index < last ? text + " " : text;
  }).join("");
}

function parseSource(source: string, filename: string) {
  try {
    return parse(source, { sourceType: "module", sourceFilename: filename, plugins: ["jsx", "typescript"] });
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SyntaxError(filename + ": " + error.message, { cause: error });
    }
    throw error;
  }
}

function failAt(filename: string, node: Node, message: string): never {
  const location = node.loc?.start ?? { line: 1, column: 0 };
  throw new SyntaxError(`${filename}:${location.line}:${location.column + 1}: ${message}`);
}

function compileModule(source: string, filename: string, namespace: string, rows: Rows, load?: LoadModule): CompiledModule {
  const tree = parseSource(source, filename);
  const components = new Map<string, Component>();
  const imported = new Map<string, Component>();
  const types = new Map<string, TSType | TSTypeElement[]>();

  function fail(node: Node, message: string): never {
    return failAt(filename, node, message);
  }

  function register(name: string, fn: FunctionDeclaration | ArrowFunctionExpression): void {
    if (!componentName.test(name) || components.has(name)) {
      return fail(fn, "Expected a distinct PascalCase component name");
    }
    if (fn.async || ("generator" in fn && fn.generator) || fn.typeParameters || fn.params.length > 1) {
      return fail(fn, "Use a synchronous component with zero or one prop parameter");
    }
    const parameter = fn.params[0];
    if (parameter && parameter.type !== "ObjectPattern") {
      return fail(parameter, "Use a destructured prop parameter, for example { title }");
    }
    const props = parameter ? bindProps(parameter, types, rows, fail) : new Map<string, PropBinding>();
    let expression: Expression;
    if (fn.body.type === "BlockStatement") {
      const [returned] = fn.body.body;
      if (fn.body.directives.length || fn.body.body.length !== 1 || returned?.type !== "ReturnStatement"
        || !returned.argument) {
        return fail(fn.body, "A component body must contain only a JSX return");
      }
      expression = returned.argument;
    } else {
      expression = fn.body;
    }
    if (expression.type !== "JSXElement" && expression.type !== "JSXFragment" && expression.type !== "NullLiteral" &&
      expression.type !== "ConditionalExpression" && expression.type !== "LogicalExpression" && !isMapCall(expression)) {
      return fail(expression, "A component must return JSX or null");
    }
    components.set(name, { curveName: namespace + "." + name, props, expression, dependencies: new Set() });
  }

  const statements = tree.program.body.map((statement) =>
    statement.type === "ExportNamedDeclaration" && statement.declaration ? statement.declaration : statement);
  const exportNames = new Map<string, { local: string; node: Node }>();
  for (const statement of statements) {
    if (statement.type === "TSTypeAliasDeclaration") types.set(statement.id.name, statement.typeAnnotation);
    if (statement.type === "TSInterfaceDeclaration") {
      if (statement.extends?.length || statement.typeParameters) {
        fail(statement, "Only plain local interfaces are supported");
      }
      types.set(statement.id.name, statement.body.body);
    }
  }

  function declaration(statement: Statement): void {
    switch (statement.type) {
      case "TSTypeAliasDeclaration":
        if (statement.typeParameters) fail(statement, "Use a non-generic local props type");
        return;
      case "TSInterfaceDeclaration":
        return;
      case "ImportDeclaration": {
        if (statement.importKind === "type") return;
        const runtime = statement.specifiers.filter(specifier =>
          specifier.type !== "ImportSpecifier" || specifier.importKind !== "type");
        if (statement.specifiers.length > 0 && runtime.length === 0) return;
        if (statement.specifiers.length > 0 && statement.source.value === "react"
          && runtime.every(specifier => specifier.type === "ImportDefaultSpecifier")) return;
        if (!load || runtime.length === 0 || !/^\.\.?\//.test(statement.source.value)) {
          return fail(statement, "Only type imports and the default React import are supported here; file compilation also supports local JSX components");
        }
        const dependency = load(statement.source.value, filename, statement.source);
        for (const specifier of runtime) {
          if (specifier.type === "ImportNamespaceSpecifier") return fail(specifier, "Use a named or default JSX component import");
          const name = specifier.type === "ImportDefaultSpecifier" ? "default"
            : specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
          const truth = dependency.exports.get(name);
          if (!truth) return fail(specifier, "Unknown component export " + name + " from " + statement.source.value);
          imported.set(specifier.local.name, truth);
        }
        return;
      }
      case "FunctionDeclaration":
        if (!statement.id) return fail(statement, "Use a named component declaration");
        return register(statement.id.name, statement);
      case "VariableDeclaration":
        if (statement.kind !== "const") return fail(statement, "Declare arrow components with const");
        for (const item of statement.declarations) {
          if (item.id.type !== "Identifier" || item.init?.type !== "ArrowFunctionExpression") {
            return fail(item, "Expected a named arrow component");
          }
          register(item.id.name, item.init);
        }
        return;
      case "ExportDefaultDeclaration":
        if (statement.declaration.type === "Identifier") {
          exportNames.set("default", { local: statement.declaration.name, node: statement.declaration });
          return;
        }
        if (statement.declaration.type === "FunctionDeclaration") {
          const local = statement.declaration.id?.name ?? "Default";
          register(local, statement.declaration);
          exportNames.set("default", { local, node: statement.declaration });
          return;
        }
        if (statement.declaration.type === "ArrowFunctionExpression") {
          register("Default", statement.declaration);
          exportNames.set("default", { local: "Default", node: statement.declaration });
          return;
        }
        return fail(statement, "Export a component as the default");
      case "ExportNamedDeclaration": {
        if (statement.exportKind === "type" && !statement.source) return;
        if (statement.source) return fail(statement, "Re-exporting another module is outside the JSX subset");
        for (const specifier of statement.specifiers) {
          if (specifier.type !== "ExportSpecifier") return fail(specifier, "Export a named component");
          if (specifier.exportKind === "type") continue;
          const name = specifier.exported.type === "Identifier" ? specifier.exported.name : specifier.exported.value;
          exportNames.set(name, { local: specifier.local.name, node: specifier });
        }
        return;
      }
      default:
        return fail(statement, "This statement is outside the declarative JSX subset");
    }
  }

  if (tree.program.directives.length) {
    fail(tree.program.directives[0], "JS and React directives are outside the declarative JSX subset");
  }
  statements.forEach(declaration);
  for (const statement of tree.program.body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declared = statement.declaration;
    if (declared?.type === "FunctionDeclaration" && declared.id) {
      exportNames.set(declared.id.name, { local: declared.id.name, node: declared.id });
    } else if (declared?.type === "VariableDeclaration") {
      for (const item of declared.declarations) {
        if (item.id.type === "Identifier") exportNames.set(item.id.name, { local: item.id.name, node: item.id });
      }
    }
  }
  if (!components.size) fail(tree.program, "No JSX components found");
  const exports = new Map<string, Component>();
  for (const [name, { local, node }] of exportNames) {
    const target = components.get(local) ?? imported.get(local);
    if (!target) return fail(node, name === "default" ? "Unknown default component" : "Unknown component export " + name);
    exports.set(name, target);
  }

  function binding(expression: Node, scope: Scope): Value | undefined {
    const name = bindingName(expression);
    return name === undefined ? undefined : scope.values.get(name);
  }

  function scalar(expression: Node, scope: Scope): Scalar {
    if (expression.type === "StringLiteral") return { kind: "text", curve: literal(expression.value) };
    if (expression.type === "BooleanLiteral") return { kind: "bool", curve: expression.value ? "True{}" : "False{}" };
    if (expression.type === "NumericLiteral" && Number.isInteger(expression.value) && expression.value <= 0xffff_ffff) {
      return { kind: "number", curve: String(expression.value) };
    }
    const bound = binding(expression, scope);
    if (bound && typeof bound.type === "string") return { kind: bound.type, curve: bound.curve };
    if (expression.type === "UnaryExpression" && expression.operator === "!") {
      return { kind: "bool", curve: "Bool.not(" + condition(expression.argument, scope) + ")" };
    }
    return fail(expression, "Expected a literal or a bound scalar prop");
  }

  function condition(expression: Node, scope: Scope): string {
    const test = scalar(expression, scope);
    return test.kind === "bool" ? test.curve : fail(expression, "A JSX condition requires a boolean");
  }

  function argument(expression: Node, scope: Scope): Value {
    const known = binding(expression, scope);
    if (known) return known;
    const { kind, curve } = scalar(expression, scope);
    return { type: kind, curve };
  }

  function attributes(element: JSXElement, scope: Scope, omitKey: boolean) {
    const result = new Map<string, { attribute: JSXAttribute; value: Value }>();
    for (const attribute of element.openingElement.attributes) {
      if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier") {
        return fail(attribute, "JSX prop spreads and qualified prop names are unsupported");
      }
      const name = attribute.name.name;
      if (omitKey && name === "key") continue;
      if (result.has(name)) return fail(attribute, "Duplicate JSX prop " + name);
      const expression = attribute.value?.type === "JSXExpressionContainer"
        ? attribute.value.expression
        : attribute.value;
      const value = expression ? argument(expression, scope) : { type: "bool", curve: "True{}" } as const;
      result.set(name, { attribute, value });
    }
    return result;
  }

  function text(value: string): string { return "View.ViewText{" + value + "}"; }
  function fragment(children: string[]): string { return "View.ViewFragment{[" + children.join(", ") + "]}"; }

  function choice(test: Node, yes: Node, no: Node | null, scope: Scope): string {
    const testCode = condition(test, scope);
    const yesCode = child(yes, scope)[0] ?? fragment([]);
    const noCode = no ? child(no, scope)[0] ?? fragment([]) : fragment([]);
    return "View.choose(" + testCode + ", yes => " + yesCode + ", no => " + noCode + ")";
  }

  let itemSerial = 0;
  function list(node: CallExpression, scope: Scope): string {
    const receiver = node.callee;
    if (receiver.type !== "MemberExpression" || receiver.object.type !== "Identifier") {
      return fail(node, "Map a typed list prop by its binding name");
    }
    const source = scope.values.get(receiver.object.name);
    if (!source || typeof source.type === "string") return fail(receiver.object, "Map a typed list prop");
    const { parameter, root } = listCallback(node, fail);
    const variable = "row_" + ++itemSerial;
    const { values, keys } = bindItem(parameter, source.type.item, variable, scope.values, fail);
    const keyName = keySource(root, keys, fail);
    const key = values.get(keyName)!;
    const keyCode = key.type === "number" ? "U32.show(" + key.curve + ")" : key.curve;
    const view = element(root, { ...scope, values }, true);
    return "View.ViewList{View.map(~" + itemCurve(source.type.item) +
      ", ~(+" + variable + " => View.ViewKeyed{" + keyCode + ", " + view + "}), " + source.curve + ")}";
  }

  function child(node: Node, scope: Scope): string[] {
    if (node.type === "JSXText") {
      const value = jsxText(node);
      return value ? [text(literal(value))] : [];
    }
    if (node.type === "JSXExpressionContainer") return child(node.expression, scope);
    if (node.type === "JSXEmptyExpression" || node.type === "NullLiteral" || node.type === "BooleanLiteral") return [];
    if (node.type === "JSXElement") return [element(node, scope)];
    if (node.type === "JSXFragment") return [jsxFragment(node, scope)];
    if (isMapCall(node)) return [list(node, scope)];
    if (node.type === "ConditionalExpression") return [choice(node.test, node.consequent, node.alternate, scope)];
    if (node.type === "LogicalExpression" && node.operator === "&&") {
      return [choice(node.left, node.right, null, scope)];
    }
    const value = scalar(node, scope);
    if (value.kind === "bool") return [];
    if (value.kind === "number") {
      return [text(node.type === "NumericLiteral" ? literal(value.curve) : "U32.show(" + value.curve + ")")];
    }
    return [text(value.curve)];
  }

  function jsxFragment(node: JSXFragment, scope: Scope): string {
    return fragment(node.children.flatMap((item) => child(item, scope)));
  }

  function element(node: JSXElement, scope: Scope, omitKey = false): string {
    const { name } = node.openingElement;
    if (name.type !== "JSXIdentifier") return fail(name, "Use a plain element or local component name");
    const props = attributes(node, scope, omitKey);
    if (componentName.test(name.name)) {
      const called = components.get(name.name) ?? imported.get(name.name);
      if (!called) return fail(name, "Unknown local component " + name.name);
      if (node.children.flatMap((item) => child(item, scope)).length > 0) {
        return fail(node, "Local components take named props without JSX children");
      }
      for (const [key, { attribute, value }] of props) {
        const binding = called.props.get(key);
        if (!binding) return fail(attribute, "Unknown prop " + key + " on " + name.name);
        if (propCurve(value.type) !== propCurve(binding.type)) {
          return fail(attribute, "Prop " + key + " on " + name.name + " requires " + propCurve(binding.type));
        }
      }
      const args = [...called.props.keys()].map((key) =>
        props.get(key)?.value.curve ?? fail(name, "Missing prop " + key + " for " + name.name));
      if (components.get(name.name) === called) scope.component.dependencies.add(called);
      return called.curveName + "(" + args.join(", ") + ")";
    }
    if (!isViewTag(name.name)) return fail(name, "Unsupported intrinsic element " + name.name);
    const loweredProps = [...props].map(([key, { attribute, value }]) => {
      if (!isViewProp(key)) return fail(attribute, "Unsupported intrinsic prop " + key);
      if (typeof value.type !== "string") return fail(attribute, "Intrinsic JSX props require scalar values");
      const constructor = value.type === "text" ? "ViewTextProp" : value.type === "bool" ? "ViewBoolProp" : "ViewNumberProp";
      return "View." + constructor + "{" + literal(key) + ", " + value.curve + "}";
    });
    const children = node.children.flatMap((item) => child(item, scope));
    return "View.ViewElement{" + literal(name.name) + ", [" + loweredProps.join(", ") + "], [" + children.join(", ") + "]}";
  }

  const definitions = [...components.values()].flatMap((component) => {
    const props = [...component.props];
    const values = new Map(props.map(([, { name, type }], index) => [
      name, { type, curve: "prop_" + index },
    ]));
    const params = props.map(([, { type }], index) => "+prop_" + index + ": " + propCurve(type));
    const body = child(component.expression, { component, values })[0] ?? fragment([]);
    const view = `def ${component.curveName}(${params.join(", ")}) -> View.Node:\n  ${body}`;
    if (namespace !== "Component") return [view];
    const layout = props.map(([name, { type }]) => ({ name, type }));
    return [view, `def ${component.curveName}.Props() -> String:\n  ${literal(JSON.stringify(layout))}`];
  });
  const active = new Set<Component>();
  const complete = new Set<Component>();
  function acyclic(component: Component): void {
    if (complete.has(component)) return;
    if (active.has(component)) fail(component.expression, "A JSX component cannot call itself recursively");
    active.add(component);
    component.dependencies.forEach(acyclic);
    active.delete(component);
    complete.add(component);
  }
  components.forEach(acyclic);
  return { definitions, exports };
}

function renderSource(rows: Rows, definitions: string[]): string {
  return "# Generated by curve web jsx\nimport Base\nimport View\n\n" +
    [...rowDefinitions(rows), ...definitions].join("\n\n") + "\n";
}

export function compileJsx(source: string, filename: string): string {
  const rows: Rows = new Map();
  return renderSource(rows, compileModule(source, filename, "Component", rows).definitions);
}

function resolveComponent(specifier: string, from: string, node: Node): string {
  const path = resolve(dirname(from), specifier);
  const extension = extname(path);
  const candidates = extension === ".jsx" || extension === ".tsx" ? [path]
    : !extension ? [path + ".tsx", path + ".jsx"] : [];
  const files = candidates.filter(candidate => statSync(candidate, { throwIfNoEntry: false })?.isFile());
  if (files.length !== 1) {
    return failAt(from, node, files.length > 1 ? "Ambiguous JSX module " + specifier
      : "Cannot resolve local JSX module " + specifier);
  }
  const file = realpathSync(files[0]);
  if (!/\.(jsx|tsx)$/.test(file)) return failAt(from, node, "Local JSX module must resolve to a .jsx or .tsx file");
  return file;
}

export function compileJsxFile(filename: string): string {
  const root = realpathSync(filename);
  const seen = new Map<string, CompiledModule>();
  const active = new Set([root]);
  const rows: Rows = new Map();
  let serial = 0;
  function load(specifier: string, from: string, node: Node): CompiledModule {
    const file = resolveComponent(specifier, from, node);
    const cached = seen.get(file);
    if (cached) return cached;
    if (active.has(file)) return failAt(from, node, "JSX module import cycle through " + specifier);
    active.add(file);
    try {
      const module = compileModule(readFileSync(file, "utf8"), file, "Imported" + ++serial, rows, load);
      seen.set(file, module);
      return module;
    } finally {
      active.delete(file);
    }
  }
  const entry = compileModule(readFileSync(root, "utf8"), root, "Component", rows, load);
  return renderSource(rows, [...seen.values(), entry].flatMap(module => module.definitions));
}
