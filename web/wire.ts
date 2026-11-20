const methods = new Map([
  ["Get", "GET"], ["Head", "HEAD"], ["Post", "POST"], ["Put", "PUT"],
  ["Patch", "PATCH"], ["Delete", "DELETE"], ["Options", "OPTIONS"],
]);

type Value = Readonly<Record<string, unknown>>;

export type CurveList<T> = { $: "Nil" } | { $: "Con"; head: T; tail: CurveList<T> };
export type Field = { $: "Field"; key: string; value: string };

export interface CurveRequestHead {
  readonly $: "RequestHead";
  readonly method: string;
  readonly path: string;
  readonly params: CurveList<Field>;
  readonly query: CurveList<Field>;
  readonly headers: CurveList<Field>;
}

export interface CurveRequest extends Omit<CurveRequestHead, "$"> {
  readonly $: "Request";
  readonly body: string;
}

export function record(value: unknown, what: string): Value {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected " + what);
  return value as Value;
}

export function methodName(value: unknown): string {
  const method = record(value, "Web.Method").$;
  const name = typeof method === "string" ? methods.get(method) : undefined;
  if (!name) throw new Error("Expected Web.Method");
  return name;
}

export function unpackList<T>(value: unknown, decode: (item: unknown) => T): T[] {
  const items: T[] = [];
  const seen = new Set<Value>();
  let node = record(value, "Curve list");
  while (node.$ === "Con" && !seen.has(node)) {
    seen.add(node);
    items.push(decode(node.head));
    node = record(node.tail, "Curve list tail");
  }
  if (node.$ !== "Nil") throw new Error("Invalid Curve list");
  return items;
}

export function packFields(entries: Iterable<readonly [string, string]>): CurveList<Field> {
  return Array.from(entries).reduceRight<CurveList<Field>>(
    (tail, [key, value]) => ({ $: "Con", head: { $: "Field", key, value }, tail }),
    { $: "Nil" },
  );
}

function fieldEntry(value: unknown): [string, string] {
  const field = record(value, "Web.Field");
  if (field.$ !== "Field" || typeof field.key !== "string" || typeof field.value !== "string") {
    throw new Error("Expected Web.Field");
  }
  return [field.key, field.value];
}

export function unpackFields(value: unknown): [string, string][] {
  return unpackList(value, fieldEntry);
}

export function responseInit(result: Value, invalidStatus: string): { status: number; headers: [string, string][] } {
  const { status } = result;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 200 || status > 599) {
    throw new Error(invalidStatus);
  }
  return { status, headers: unpackFields(result.headers) };
}

export function responseHasBody(method: string, status: number): boolean {
  return method !== "HEAD" && status !== 204 && status !== 205 && status !== 304;
}

export function toResponse(value: unknown, method: string): Response {
  const result = record(value, "Web.Response");
  const invalidResponse = "Expected Web.Response with a final HTTP status and text body";
  if (result.$ !== "Response" || typeof result.body !== "string") throw new Error(invalidResponse);
  const init = responseInit(result, invalidResponse);
  return new Response(responseHasBody(method, init.status) ? result.body : null, init);
}
