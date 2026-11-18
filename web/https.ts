import { methodName, packFields, record, unpackFields, type CurveList, type Field } from "./wire.ts";

export interface OutboundOptions {
  readonly allowedOrigins?: readonly string[];
  readonly ca?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

type Failure = "InvalidRequest" | "OriginDenied" | "TimedOut" | "Cancelled" | "ResponseTooLarge" | "TransportError";
type FetchResult =
  | { $: "Received"; status: number; headers: CurveList<Field>; body: string }
  | { $: "FetchFailed"; reason: { $: Failure } };

interface HttpsRequest {
  readonly url: URL;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string;
}

const transportHeaders = new Set(["connection", "content-length", "host", "transfer-encoding"]);

function parseHttpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Expected an HTTPS URL without credentials or a fragment");
  }
  return url;
}

function decodeRequest(raw: unknown): HttpsRequest {
  const request = record(raw, "Web.HttpsRequest");
  if (request.$ !== "HttpsRequest" || typeof request.url !== "string" || typeof request.body !== "string") {
    throw new Error("Expected Web.HttpsRequest");
  }
  const url = parseHttpsUrl(request.url);
  const method = methodName(request.method);
  const headers = new Headers(unpackFields(request.headers));
  for (const name of transportHeaders) {
    if (headers.has(name)) throw new Error("Host transport header is reserved");
  }
  if ((method === "GET" || method === "HEAD") && request.body !== "") {
    throw new Error("GET and HEAD cannot send a body");
  }
  return { url, method, headers, body: request.body };
}

function failure(reason: Failure): FetchResult {
  return { $: "FetchFailed", reason: { $: reason } };
}

async function readBody(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<string | null> {
  if (stream === null) return "";
  const reader = stream.getReader();
  const decode = new TextDecoder();
  const fragments: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        fragments.push(decode.decode());
        return fragments.join("");
      }
      bytes += value.byteLength;
      if (bytes > limit) {
        void reader.cancel().catch(() => {});
        return null;
      }
      fragments.push(decode.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
}

export function createHttpsClient(options: OutboundOptions = {}) {
  const origins = new Set((options.allowedOrigins ?? []).map(value => {
    const url = parseHttpsUrl(value);
    if (url.pathname !== "/" || url.search) throw new Error("Use an HTTPS origin without a path or query: " + value);
    return url.origin;
  }));
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxResponseBytes = options.maxResponseBytes ?? 1024 * 1024;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 0x7fff_ffff ||
      !Number.isInteger(maxResponseBytes) || maxResponseBytes < 0 || maxResponseBytes > 0x7fff_ffff) {
    throw new Error("Invalid outbound HTTPS timeout or response byte limit");
  }
  const tls = { rejectUnauthorized: true, ...(options.ca === undefined ? {} : { ca: options.ca }) };

  return async (value: unknown, signal: AbortSignal): Promise<FetchResult> => {
    let request: HttpsRequest;
    try {
      request = decodeRequest(value);
    } catch {
      return failure("InvalidRequest");
    }
    if (!origins.has(request.url.origin)) return failure("OriginDenied");
    if (signal.aborted) return failure("Cancelled");
    const deadline = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body === "" ? undefined : request.body,
        redirect: "manual",
        signal: AbortSignal.any([signal, deadline]),
        tls,
      });
      const body = await readBody(response.body, maxResponseBytes);
      if (body === null) return failure("ResponseTooLarge");
      return {
        $: "Received", status: response.status, headers: packFields(response.headers), body,
      };
    } catch {
      if (signal.aborted) return failure("Cancelled");
      if (deadline.aborted) return failure("TimedOut");
      return failure("TransportError");
    }
  };
}
