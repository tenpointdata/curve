import { parse } from "@babel/parser";
import type {
  ArrowFunctionExpression, Expression, FunctionDeclaration, JSXAttribute, JSXElement,
  JSXFragment, JSXText, Node, Pattern, Statement, TSType,
  TSTypeElement,
} from "@babel/types";
import { isViewProp, isViewTag } from "./react.ts";

type Component = {
  name: string;
  props: Map<string, string>;
  expression: Expression;
  dependencies: Set<string>;
};

type Scalar = { kind: "text" | "bool" | "number"; curve: string };

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

export function compileJsx(source: string, filename: string): string {
  const tree = parseSource(source, filename);
  const components = new Map<string, Component>();
  const types = new Map<string, TSType | TSTypeElement[]>();

  function fail(node: Node, message: string): never {
    const location = node.loc?.start ?? { line: 1, column: 0 };
    throw new SyntaxError(`${filename}:${location.line}:${location.column + 1}: ${message}`);
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
    return fail(field, "Props need a local object type with required string fields");
  }

  function bindProps(parameter: Pattern): Map<string, string> {
    if (parameter.type !== "ObjectPattern") {
      return fail(parameter, "Use a destructured prop parameter, for example { title }");
    }
    const fields = new Map<string, string>();
    const annotation = parameter.typeAnnotation;
    let declared: Set<string> | undefined;
    if (annotation?.type === "TSTypeAnnotation") {
      const members = checkPropsType(annotation.typeAnnotation, annotation, new Set());
      declared = new Set(members.map((member) => {
        if (member.type !== "TSPropertySignature" || member.optional || member.computed
          || member.key.type !== "Identifier" || member.typeAnnotation?.typeAnnotation.type !== "TSStringKeyword") {
          return fail(member, "Only required string prop types are supported");
        }
        return member.key.name;
      }));
    } else if (annotation) {
      return fail(annotation, "Use TypeScript string prop types");
    }

    for (const property of parameter.properties) {
      if (property.type !== "ObjectProperty" || property.computed
        || property.key.type !== "Identifier" || property.value.type !== "Identifier"
        || fields.has(property.key.name) || [...fields.values()].includes(property.value.name)) {
        return fail(property, "Expected a distinct prop binding without a default or rest");
      }
      if (declared && !declared.has(property.key.name)) {
        return fail(property, "Prop is missing from its TypeScript type");
      }
      fields.set(property.key.name, property.value.name);
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
    const props = parameter ? bindProps(parameter) : new Map<string, string>();
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
    if (expression.type !== "JSXElement" && expression.type !== "JSXFragment" && expression.type !== "NullLiteral") {
      return fail(expression, "A component must return JSX or null");
    }
    components.set(name, { name, props, expression, dependencies: new Set() });
  }

  const statements = tree.program.body.map((statement) =>
    statement.type === "ExportNamedDeclaration" && statement.declaration ? statement.declaration : statement);
  const defaultExports: Node[] = [];
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
      case "ImportDeclaration":
        if (statement.importKind === "type") return;
        if (statement.specifiers.length > 0 && statement.source.value === "react"
          && statement.specifiers.every((specifier) => specifier.type === "ImportDefaultSpecifier"
            || (specifier.type === "ImportSpecifier" && specifier.importKind === "type"))) return;
        return fail(statement, "Only type imports and the default React import are supported");
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
          defaultExports.push(statement.declaration);
          return;
        }
        if (statement.declaration.type === "FunctionDeclaration") {
          return register(statement.declaration.id?.name ?? "Default", statement.declaration);
        }
        if (statement.declaration.type === "ArrowFunctionExpression") {
          return register("Default", statement.declaration);
        }
        return fail(statement, "Export a component as the default");
      case "ExportNamedDeclaration":
        if (statement.exportKind === "type" && !statement.source) return;
        return fail(statement, "Export components at their declaration");
      default:
        return fail(statement, "This statement is outside the declarative JSX subset");
    }
  }

  if (tree.program.directives.length) {
    fail(tree.program.directives[0], "JS and React directives are outside the declarative JSX subset");
  }
  statements.forEach(declaration);
  for (const item of defaultExports) {
    if (item.type !== "Identifier" || !components.has(item.name)) fail(item, "Unknown default component");
  }
  if (!components.size) fail(tree.program, "No JSX components found");

  function propVariable(component: Component, name: string): string | undefined {
    const index = [...component.props.values()].indexOf(name);
    return index < 0 ? undefined : "prop_" + index;
  }

  function scalar(expression: Node, component: Component): Scalar {
    if (expression.type === "StringLiteral") return { kind: "text", curve: literal(expression.value) };
    if (expression.type === "BooleanLiteral") return { kind: "bool", curve: expression.value ? "True{}" : "False{}" };
    if (expression.type === "NumericLiteral" && Number.isInteger(expression.value) && expression.value <= 0xffff_ffff) {
      return { kind: "number", curve: String(expression.value) };
    }
    if (expression.type === "Identifier") {
      const variable = propVariable(component, expression.name);
      if (variable !== undefined) return { kind: "text", curve: variable };
    }
    return fail(expression, "Expected a literal or a bound string prop");
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

  function child(node: Node, component: Component): string[] {
    if (node.type === "JSXText") {
      const value = jsxText(node);
      return value ? [text(literal(value))] : [];
    }
    if (node.type === "JSXExpressionContainer") return child(node.expression, component);
    if (node.type === "JSXEmptyExpression" || node.type === "NullLiteral" || node.type === "BooleanLiteral") return [];
    if (node.type === "JSXElement") return [element(node, component)];
    if (node.type === "JSXFragment") return [jsxFragment(node, component)];
    const value = scalar(node, component);
    if (value.kind === "number") return [text(literal(value.curve))];
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
      const called = components.get(name.name);
      if (!called) return fail(name, "Unknown local component " + name.name);
      if (node.children.flatMap((item) => child(item, component)).length > 0) {
        return fail(node, "Local components take named string props without JSX children");
      }
      for (const [key, { attribute, value }] of props) {
        if (!called.props.has(key) || value.kind !== "text") {
          return fail(attribute, "Expected a string prop declared by " + name.name);
        }
      }
      const args = [...called.props.keys()].map((key) =>
        props.get(key)?.value.curve ?? fail(name, "Missing prop " + key + " for " + name.name));
      component.dependencies.add(called.name);
      return "Component." + called.name + "(" + args.join(", ") + ")";
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

  const defs = [...components.values()].map((component) => {
    const params = [...component.props.values()].map((_, index) => "+prop_" + index + ": String");
    const body = child(component.expression, component)[0] ?? fragment([]);
    return `def Component.${component.name}(${params.join(", ")}) -> View.Node:\n  ${body}`;
  });
  const active = new Set<string>();
  const complete = new Set<string>();
  function acyclic(component: Component): void {
    if (complete.has(component.name)) return;
    if (active.has(component.name)) fail(component.expression, "A JSX component cannot call itself recursively");
    active.add(component.name);
    component.dependencies.forEach((name) => acyclic(components.get(name)!));
    active.delete(component.name);
    complete.add(component.name);
  }
  components.forEach(acyclic);
  return "# Generated by curve web jsx\nimport Base\nimport View\n\n" + defs.join("\n\n") + "\n";
}
