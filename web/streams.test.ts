import { expect, test } from "bun:test";
import { request as httpRequest } from "node:http";
import { resolve } from "node:path";
import { BODY_CHUNK_BYTES, RequestBytes, unpackBytes } from "./bytes.ts";
import { startServer } from "./server.ts";
import { createStreamingHandler } from "./streams.ts";
import { type CurveRequestHead } from "./wire.ts";

const { default: app } = await import(resolve(import.meta.dirname, "../demos/web_http/stream.curve"));

test("a Curve HTTP app reads and writes binary bodies across multiple chunks", async () => {
  const server = startServer(app, { port: 0, maxBodyBytes: 64 * 1024 });
  try {
    const upload = Uint8Array.from({ length: BODY_CHUNK_BYTES * 2 + 97 }, (_, index) => index % 256);
    const response = await fetch(new URL("/binary/echo", server.url), { method: "POST", body: upload });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(upload))).toBe(true);

    const readBeforeReply = await fetch(new URL("/binary/first", server.url), {
      method: "POST", body: Uint8Array.of(255, 0, 10, 128),
    });
    expect(new Uint8Array(await readBeforeReply.arrayBuffer())).toEqual(Uint8Array.of(255, 0, 10, 128));
    const example = await fetch(new URL("/binary/example", server.url));
    expect(new Uint8Array(await example.arrayBuffer())).toEqual(Uint8Array.of(0, 255, 13, 10));
    const head = await fetch(new URL("/binary/example", server.url), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.arrayBuffer()).toHaveProperty("byteLength", 0);
    const oversized = await fetch(new URL("/binary/echo", server.url), {
      method: "POST", body: new Uint8Array(64 * 1024 + 1),
    });
    expect(oversized.status).toBe(413);
  } finally {
    await server.stop(true);
  }
});

const [bunMajor, bunMinor] = Bun.version.split(".").map(Number);
const verifiedDuplexRuntime = bunMajor > 1 || (bunMajor === 1 && bunMinor >= 4);

test.skipIf(!verifiedDuplexRuntime)("client receives binary output before ending its chunked upload", async () => {
  const server = startServer(app, { port: 0 });
  const connection = httpRequest(new URL("/binary/echo", server.url), {
    method: "POST", headers: { "Transfer-Encoding": "chunked", Connection: "close" },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const payload = Buffer.from([255, 0, 1, 128]);
    const tail = Buffer.from([2, 0, 3]);
    const output = await new Promise<Buffer>((done, fail) => {
      const pieces: Buffer[] = [];
      let received = 0;
      timer = setTimeout(() => fail(new Error("no HTTP streaming progress before upload finished")), 3000);
      connection.on("error", fail);
      connection.on("response", response => {
        expect(response.statusCode).toBe(200);
        response.on("error", fail);
        response.on("data", (chunk: Buffer) => {
          pieces.push(chunk);
          received += chunk.length;
          if (connection.writableEnded || received < payload.length) return;
          if (!Buffer.concat(pieces).equals(payload)) return fail(new Error("unexpected bytes before upload finished"));
          connection.end(tail);
        });
        response.on("end", () => done(Buffer.concat(pieces)));
      });
      connection.write(payload);
    });
    expect(connection.writableEnded).toBe(true);
    expect(output).toEqual(Buffer.concat([payload, tail]));
  } finally {
    clearTimeout(timer);
    connection.destroy();
    await server.stop(true);
  }
});

test.skipIf(!verifiedDuplexRuntime)("a client disconnect stops an active binary HTTP exchange", async () => {
  const server = startServer(app, { port: 0 });
  const connection = httpRequest(new URL("/binary/echo", server.url), {
    method: "POST", headers: { "Transfer-Encoding": "chunked" },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const first = await new Promise<Buffer>((done, fail) => {
      timer = setTimeout(() => fail(new Error("no response before disconnect")), 3000);
      connection.on("error", error => { if (!connection.destroyed) fail(error); });
      connection.on("response", response => {
        response.on("error", () => {});
        response.once("data", (chunk: Buffer) => {
          connection.destroy();
          done(chunk);
        });
      });
      connection.write(Buffer.from([1, 0, 255]));
    });
    expect(first).toEqual(Buffer.from([1, 0, 255]));
    expect(connection.writableEnded).toBe(false);
    const deadline = Date.now() + 2000;
    while (server.pendingRequests !== 0 && Date.now() < deadline) await Bun.sleep(10);
    expect(server.pendingRequests).toBe(0);
  } finally {
    clearTimeout(timer);
    connection.destroy();
    await server.stop(true);
  }
});

test("the request cursor enforces its byte limit and releases native readers", async () => {
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(16)); },
    cancel() { cancelled = true; },
  });
  const input = new RequestBytes(source, 8);
  expect(await input.read()).toEqual({ $: "BodyTooLarge" });
  expect(cancelled).toBe(true);
  expect(source.locked).toBe(false);
});

test("cancelling before a read delivers one typed failure", async () => {
  const input = new RequestBytes(new ReadableStream<Uint8Array>(), 8);
  await input.cancel();
  expect(await input.read()).toEqual({ $: "BodyFailed" });
  await expect(input.read()).rejects.toThrow("already ended");
});

test("response continuations run on pull and cancellation releases the request", async () => {
  let advances = 0;
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const input = new Request("http://localhost/", { method: "POST", body: source });
  const bytes = { $: "Con", head: 42, tail: { $: "Nil" } };
  const dispatch = createStreamingHandler({
    handle_stream: () => ({
      $: "StreamReply", status: 200, headers: { $: "Nil" }, body: { $: "BodyWrite", bytes },
    }),
    "Web:stream_resume": () => { throw Error("unexpected pre-reply read"); },
    "Web:resume_body": () => { throw Error("unexpected upload read"); },
    "Web:advance_body": () => {
      advances++;
      return { $: "BodyWrite", bytes };
    },
  }, 1024);
  const head: CurveRequestHead = {
    $: "RequestHead", method: "POST", path: "/", params: { $: "Nil" }, query: { $: "Nil" }, headers: { $: "Nil" },
  };
  const response = await dispatch(0, head, input);
  const reader = response.body!.getReader();
  expect(advances).toBe(0);
  expect((await reader.read()).value).toEqual(Uint8Array.of(42));
  expect(advances).toBe(0);
  expect((await reader.read()).value).toEqual(Uint8Array.of(42));
  expect(advances).toBe(1);
  await reader.cancel();
  expect(advances).toBe(1);
  expect(cancelled).toBe(true);
});

test("an aborted response stream reports failure after previously delivered bytes", async () => {
  const bytes = { $: "Con", head: 42, tail: { $: "Nil" } };
  const dispatch = createStreamingHandler({
    handle_stream: () => ({
      $: "StreamReply", status: 200, headers: { $: "Nil" }, body: { $: "BodyWrite", bytes },
    }),
    "Web:stream_resume": () => { throw Error("unexpected pre-reply read"); },
    "Web:resume_body": () => { throw Error("unexpected upload read"); },
    "Web:advance_body": () => ({ $: "BodyAbort" }),
  }, 1024);
  const head: CurveRequestHead = {
    $: "RequestHead", method: "GET", path: "/", params: { $: "Nil" }, query: { $: "Nil" }, headers: { $: "Nil" },
  };
  const response = await dispatch(0, head, new Request("http://localhost/"));
  const reader = response.body!.getReader();
  expect((await reader.read()).value).toEqual(Uint8Array.of(42));
  await expect(reader.read()).rejects.toThrow("Curve aborted the HTTP response body");
});

test("rejects invalid bytes and oversized, empty or circular output chunks", () => {
  const nil = { $: "Nil" };
  expect(() => unpackBytes({ $: "Con", head: 256, tail: nil })).toThrow("between 0 and 255");
  expect(() => unpackBytes(nil)).toThrow("chunks must contain");
  const cycle: { $: string; head: number; tail?: unknown } = { $: "Con", head: 0 };
  cycle.tail = cycle;
  expect(() => unpackBytes(cycle)).toThrow("chunks must contain");
});
