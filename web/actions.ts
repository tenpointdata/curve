import { createHttpsClient, type OutboundOptions } from "./https.ts";
import { record, type CurveRequest } from "./wire.ts";

export type Handle = (id: number, request: CurveRequest, signal: AbortSignal) => Promise<unknown>;
type Handler = (id: number, request: CurveRequest) => unknown;
type Resume = (action: unknown, result: unknown) => unknown;

const MAX_FETCHES = 4;

export function createHandler(app: Readonly<Record<string, unknown>>, options?: OutboundOptions): Handle {
  if (typeof app.handle === "function" && app.handle_action === undefined) {
    const handle = app.handle as Handler;
    return async (id, request) => handle(id, request);
  }
  if (typeof app.handle_action !== "function" || typeof app["Web:resume"] !== "function" || app.handle !== undefined) {
    throw new Error("Export either handle(U32, Web.Request) -> Web.Response or handle_action(U32, Web.Request) -> Web.Action");
  }
  const handle = app.handle_action as Handler;
  const resume = app["Web:resume"] as Resume;
  const fetchHttps = createHttpsClient(options);
  return async (id, request, signal) => {
    let action = record(handle(id, request), "Web.Action");
    for (let completed = 0; action.$ === "FetchHttps"; completed++) {
      if (completed === MAX_FETCHES) throw new Error("Outbound HTTPS request limit reached");
      const result = await fetchHttps(action.request, signal);
      action = record(resume(action, result), "Web.Action");
    }
    if (action.$ !== "Send") throw new Error("Expected a final Web.Action");
    return action.response;
  };
}
