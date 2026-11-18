import { parse } from "@babel/parser";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import type {
  ArrowFunctionExpression, Expression, FunctionDeclaration, JSXAttribute, JSXElement,
  JSXFragment, JSXText, Node, Pattern, Statement, TSType,
  TSTypeElement,
} from "@babel/types";
import { isViewProp, isViewTag } from "./react.ts";

type ScalarKind = "text" | "bool" | "number";
type PropBinding = { name: string; kind: ScalarKind };
type Component = {
  curveName: string;
  props: Map<string, PropBinding>;
  expression: Expression;
  dependencies: Set<Component>;
};

type Scalar = { kind: ScalarKind; curve: string };
type CompiledModule = { definitions: string[]; exports: ReadonlyMap<string, Component> };
type LoadModule = (specifier: string, from: string, node: Node) => CompiledModule;

const componentName = /^[A-Z][A-Za-z0-9_]*$/;
const curveType: Record<ScalarKind, string> = { text: "String", bool: "Bool", number: "U32" };
const propType: Partial<Record<TSType["type"], ScalarKind>> = {
  TSStringKeyword: "text", TSBooleanKeyword: "bool", TSNumberKeyword: "number",
};

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

function compileModule(source: string, filename: string, namespace: string, load?: LoadModule): CompiledModule {
  const tree = parseSource(source, filename);
  const components = new Map<string, Component>();
  const imported = new Map<string, Component>();
  const types = new Map<string, TSType | TSTypeElement[]>();

  function fail(node: Node, message: string): never {
    return failAt(filename, node, message);
  }

  function checkPropsType(annotation: TSType, field: Node, seen: Set<string>): TSTypeElement[] {
    if (annotation.type === "TSTypeLiteral") return annotation.members;
    if (annotation.type === "TSTypeReference" && annotation.typeName.type === "Identifier"
      && !annotation.typeParameters) {
      const name = annotation.typeName.name;
      const declared = types.get(name);
      if (declared && !seen.has(name)) {
        return Array.isArray(declared) ? declared : checkPropsType(declared, field, new Set([...seen, name]));
      }
    }
    return fail(field, "Props need a local object type with required fields");
  }

  function bindProps(parameter: Pattern): Map<string, PropBinding> {
    if (parameter.type !== "ObjectPattern") {
      return fail(parameter, "Use a destructured prop parameter, for example { title }");
    }
    const fields = new Map<string, PropBinding>();
    const used = new Set<string>();
    const annotation = parameter.typeAnnotation;
    let declared: Map<string, ScalarKind> | undefined;
    if (annotation?.type === "TSTypeAnnotation") {
      const members = checkPropsType(annotation.typeAnnotation, annotation, new Set());
      declared = new Map(members.map((member) => {
        if (member.type !== "TSPropertySignature" || member.optional || member.computed
          || member.key.type !== "Identifier" || !member.typeAnnotation) {
          return fail(member, "Only required string, boolean and U32 number prop types are supported");
        }
        const kind = propType[member.typeAnnotation.typeAnnotation.type];
        if (!kind) return fail(member, "Only required string, boolean and U32 number prop types are supported");
        return [member.key.name, kind];
      }));
      if (declared.size !== members.length) return fail(annotation, "Duplicate prop type");
    } else if (annotation) {
      return fail(annotation, "Use TypeScript string, boolean or U32 number prop types");
    }

    for (const property of parameter.properties) {
      if (property.type !== "ObjectProperty" || property.computed
        || property.key.type !== "Identifier" || property.value.type !== "Identifier"
        || fields.has(property.key.name) || used.has(property.value.name)) {
        return fail(property, "Expected a distinct prop binding without a default or rest");
      }
      if (declared && !declared.has(property.key.name)) {
        return fail(property, "Prop is missing from its TypeScript type");
      }
      used.add(property.value.name);
      fields.set(property.key.name, {
        name: property.value.name,
        kind: declared?.get(property.key.name) ?? "text",
      });
    }
    if (declared && declared.size !== fields.size) {
      return fail(parameter, "Destructure every declared prop to preserve the component's arguments");
    }
    return fields;
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
    const props = parameter ? bindProps(parameter) : new Map<string, PropBinding>();
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
      expression.type !== "ConditionalExpression" && expression.type !== "LogicalExpression") {
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

  function scalar(expression: Node, component: Component): Scalar {
    if (expression.type === "StringLiteral") return { kind: "text", curve: literal(expression.value) };
    if (expression.type === "BooleanLiteral") return { kind: "bool", curve: expression.value ? "True{}" : "False{}" };
    if (expression.type === "NumericLiteral" && Number.isInteger(expression.value) && expression.value <= 0xffff_ffff) {
      return { kind: "number", curve: String(expression.value) };
    }
    if (expression.type === "Identifier") {
      const values = [...component.props.values()];
      const index = values.findIndex(prop => prop.name === expression.name);
      if (index >= 0) return { kind: values[index].kind, curve: "prop_" + index };
    }
    if (expression.type === "UnaryExpression" && expression.operator === "!") {
      return { kind: "bool", curve: "Bool.not(" + condition(expression.argument, component) + ")" };
    }
    return fail(expression, "Expected a literal or a bound scalar prop");
  }

  function condition(expression: Node, component: Component): string {
    const test = scalar(expression, component);
    return test.kind === "bool" ? test.curve : fail(expression, "A JSX condition requires a boolean");
  }

  function attributes(element: JSXElement, component: Component): Map<string, { attribute: JSXAttribute; value: Scalar }> {
    const result = new Map<string, { attribute: JSXAttribute; value: Scalar }>();
    for (const attribute of element.openingElement.attributes) {
      if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier") {
        return fail(attribute, "JSX prop spreads and qualified prop names are unsupported");
      }
      const name = attribute.name.name;
      if (result.has(name)) return fail(attribute, "Duplicate JSX prop " + name);
      const expression = attribute.value?.type === "JSXExpressionContainer"
        ? attribute.value.expression
        : attribute.value;
      const value = expression ? scalar(expression, component) : { kind: "bool", curve: "True{}" } as const;
      result.set(name, { attribute, value });
    }
    return result;
  }

  function text(value: string): string { return "View.ViewText{" + value + "}"; }
  function fragment(children: string[]): string { return "View.ViewFragment{[" + children.join(", ") + "]}"; }

  function choice(test: Node, yes: Node, no: Node | null, component: Component): string {
    const testCode = condition(test, component);
    const yesCode = child(yes, component)[0] ?? fragment([]);
    const noCode = no ? child(no, component)[0] ?? fragment([]) : fragment([]);
    return "View.choose(" + testCode + ", yes => " + yesCode + ", no => " + noCode + ")";
  }

  function child(node: Node, component: Component): string[] {
    if (node.type === "JSXText") {
      const value = jsxText(node);
      return value ? [text(literal(value))] : [];
    }
    if (node.type === "JSXExpressionContainer") return child(node.expression, component);
    if (node.type === "JSXEmptyExpression" || node.type === "NullLiteral" || node.type === "BooleanLiteral") return [];
    if (node.type === "JSXElement") return [element(node, component)];
    if (node.type === "JSXFragment") return [jsxFragment(node, component)];
    if (node.type === "ConditionalExpression") return [choice(node.test, node.consequent, node.alternate, component)];
    if (node.type === "LogicalExpression" && node.operator === "&&") {
      return [choice(node.left, node.right, null, component)];
    }
    const value = scalar(node, component);
    if (value.kind === "bool") return [];
    if (value.kind === "number") {
      return [text(node.type === "NumericLiteral" ? literal(value.curve) : "U32.show(" + value.curve + ")")];
    }
    return [text(value.curve)];
  }

  function jsxFragment(node: JSXFragment, component: Component): string {
    return fragment(node.children.flatMap((item) => child(item, component)));
  }

  function element(node: JSXElement, component: Component): string {
    const { name } = node.openingElement;
    if (name.type !== "JSXIdentifier") return fail(name, "Use a plain element or local component name");
    const props = attributes(node, component);
    if (componentName.test(name.name)) {
      const called = components.get(name.name) ?? imported.get(name.name);
      if (!called) return fail(name, "Unknown local component " + name.name);
      if (node.children.flatMap((item) => child(item, component)).length > 0) {
        return fail(node, "Local components take named props without JSX children");
      }
      for (const [key, { attribute, value }] of props) {
        const binding = called.props.get(key);
        if (!binding) return fail(attribute, "Unknown prop " + key + " on " + name.name);
        if (value.kind !== binding.kind) {
          return fail(attribute, "Prop " + key + " on " + name.name + " requires " + curveType[binding.kind]);
        }
      }
      const args = [...called.props.keys()].map((key) =>
        props.get(key)?.value.curve ?? fail(name, "Missing prop " + key + " for " + name.name));
      if (components.get(name.name) === called) component.dependencies.add(called);
      return called.curveName + "(" + args.join(", ") + ")";
    }
    if (!isViewTag(name.name)) return fail(name, "Unsupported intrinsic element " + name.name);
    const loweredProps = [...props].map(([key, { attribute, value }]) => {
      if (!isViewProp(key)) return fail(attribute, "Unsupported intrinsic prop " + key);
      const constructor = value.kind === "text" ? "ViewTextProp" : value.kind === "bool" ? "ViewBoolProp" : "ViewNumberProp";
      return "View." + constructor + "{" + literal(key) + ", " + value.curve + "}";
    });
    const children = node.children.flatMap((item) => child(item, component));
    return "View.ViewElement{" + literal(name.name) + ", [" + loweredProps.join(", ") + "], [" + children.join(", ") + "]}";
  }

  const definitions = [...components.values()].map((component) => {
    const params = [...component.props.values()].map(({ kind }, index) => "+prop_" + index + ": " + curveType[kind]);
    const body = child(component.expression, component)[0] ?? fragment([]);
    return `def ${component.curveName}(${params.join(", ")}) -> View.Node:\n  ${body}`;
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

function renderSource(definitions: string[]): string {
  return "# Generated by curve web jsx\nimport Base\nimport View\n\n" + definitions.join("\n\n") + "\n";
}

export function compileJsx(source: string, filename: string): string {
  return renderSource(compileModule(source, filename, "Component").definitions);
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
  let serial = 0;
  function load(specifier: string, from: string, node: Node): CompiledModule {
    const file = resolveComponent(specifier, from, node);
    const cached = seen.get(file);
    if (cached) return cached;
    if (active.has(file)) return failAt(from, node, "JSX module import cycle through " + specifier);
    active.add(file);
    try {
      const module = compileModule(readFileSync(file, "utf8"), file, "Imported" + ++serial, load);
      seen.set(file, module);
      return module;
    } finally {
      active.delete(file);
    }
  }
  const entry = compileModule(readFileSync(root, "utf8"), root, "Component", load);
  return renderSource([...seen.values(), entry].flatMap(module => module.definitions));
}
