import { createHandler, type Handle } from "./actions.ts";
import { type OutboundOptions } from "./https.ts";
import { serveAssets } from "./assets.ts";
import { methodName, packFields, record, toResponse, unpackList } from "./wire.ts";

const routeSegment = /^(?:[a-zA-Z0-9._~-]+|:[a-zA-Z_][a-zA-Z_0-9]*)$/;

export interface ServerOptions {
  readonly hostname?: string;
  readonly port?: number;
  readonly publicDirectory?: string;
  readonly maxBodyBytes?: number;
  readonly tls?: { readonly cert: string; readonly key: string };
  readonly outbound?: OutboundOptions;
  readonly onError?: (error: Error) => void;
}

interface Route {
  readonly method: string;
  readonly pattern: string;
  readonly handler: number;
}

function readRoute(value: unknown): Route {
  const route = record(value, "Web.Route");
  if (route.$ !== "Route" || typeof route.pattern !== "string" ||
      !route.pattern.startsWith("/") ||
      typeof route.handler !== "number" || !Number.isInteger(route.handler) ||
      route.handler < 0 || route.handler > 0xffffffff) {
    throw new Error("Expected Web.Route with a method, /path pattern and U32 handler ID");
  }
  const segments = route.pattern === "/" ? [] : route.pattern.slice(1).split("/");
  const parameters = segments.filter(segment => segment.startsWith(":"));
  if (segments.some(segment => !routeSegment.test(segment) || segment === "." || segment === "..") ||
      new Set(parameters).size !== parameters.length) {
    throw new Error("Invalid route pattern " + route.pattern);
  }
  return { method: methodName(route.method), pattern: route.pattern, handler: route.handler };
}

function appRoutes(value: unknown, handle: Handle) {
  const groups = new Map<string, Map<string, number>>();
  const shapes = new Map<string, string>();
  for (const { method, pattern, handler } of unpackList(value, readRoute)) {
    const shape = pattern.replace(/:[a-zA-Z_][a-zA-Z_0-9]*/g, ":");
    const existing = shapes.get(shape);
    if (existing && existing !== pattern) throw new Error("Ambiguous route patterns " + existing + " and " + pattern);
    shapes.set(shape, pattern);
    const group = groups.get(pattern) ?? new Map<string, number>();
    if (group.has(method)) throw new Error("Duplicate route " + method + " " + pattern);
    group.set(method, handler);
    groups.set(pattern, group);
  }
  return Object.fromEntries(Array.from(groups, ([pattern, group]) => [pattern, async (request: Bun.BunRequest) => {
    const method = request.method;
    const handler = group.get(method) ?? (method === "HEAD" ? group.get("GET") : undefined);
    if (handler === undefined) {
      const allow = new Set(group.keys());
      if (allow.has("GET")) allow.add("HEAD");
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: [...allow].join(", ") } });
    }
    const url = new URL(request.url);
    const result = await handle(handler, {
      $: "Request", method, path: url.pathname,
      params: packFields(Object.entries(request.params)),
      query: packFields(url.searchParams),
      headers: packFields(request.headers),
      body: await request.text(),
    }, request.signal);
    return toResponse(result, method);
  }]));
}

export function startServer(module: unknown, options: ServerOptions = {}) {
  const app = record(module, "Curve web module");
  if (typeof app.routes !== "function") throw new Error("Export routes() -> List<&2, Web.Route>");
  const handle = createHandler(app, options.outbound);
  const routes = appRoutes(app.routes(), handle);
  const fetch = serveAssets(options.publicDirectory);
  const tls = options.tls ? { cert: Bun.file(options.tls.cert), key: Bun.file(options.tls.key) } : undefined;
  return Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 3000,
    maxRequestBodySize: options.maxBodyBytes ?? 1024 * 1024,
    ...(tls ? { tls } : {}),
    routes,
    fetch,
    error(error) {
      options.onError?.(error);
      return new Response("Internal Server Error", { status: 500 });
    },
  });
}
