import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "./server.ts";

const root = mkdtempSync(join(tmpdir(), "curve-web-"));
const publicDirectory = join(root, "public");
mkdirSync(publicDirectory);
writeFileSync(join(publicDirectory, "index.html"), "<h1>Curve public assets</h1>");
writeFileSync(join(publicDirectory, ".hidden"), "private");
const outside = join(root, "outside.txt");
writeFileSync(outside, "outside");
symlinkSync(outside, join(publicDirectory, "linked.txt"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const { default: app } = await import(resolve(import.meta.dirname, "../demos/web_http/server.curve"));
const { default: outboundApp } = await import(resolve(import.meta.dirname, "../demos/web_http/client.curve"));

function generatedTls() {
  const directory = mkdtempSync(join(root, "tls-"));
  const cert = join(directory, "server.pem");
  const key = join(directory, "server-key.pem");
  const generated = Bun.spawnSync([
    "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", key, "-out", cert,
  ]);
  if (generated.exitCode !== 0) throw new Error(generated.stderr.toString());
  return { cert, key };
}

test("typed routes handle method and URL parameters, HEAD, request body and assets", async () => {
  const server = startServer(app, { port: 0, publicDirectory, maxBodyBytes: 1024 });
  try {
    const hello = await fetch(new URL("/api/hello/Ada%20Lovelace", server.url));
    expect(hello.status).toBe(200);
    expect(await hello.text()).toBe("Hello, Ada Lovelace");

    const health = await fetch(new URL("/api/health", server.url));
    expect(await health.json()).toEqual({ status: "ok" });
    const head = await fetch(new URL("/api/health", server.url), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    const echo = await fetch(new URL("/api/echo", server.url), { method: "POST", body: "Hello 🌍" });
    expect(await echo.text()).toBe("Hello 🌍");
    const wrongMethod = await fetch(new URL("/api/echo", server.url));
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");
    const oversized = await fetch(new URL("/api/echo", server.url), { method: "POST", body: "x".repeat(1025) });
    expect(oversized.status).toBe(413);

    const page = await fetch(server.url);
    expect(await page.text()).toContain("Curve public assets");
    for (const path of ["/missing", "/linked.txt", "/.hidden", "/%2e%2e/outside.txt"]) {
      expect((await fetch(new URL(path, server.url))).status).toBe(404);
    }
  } finally {
    await server.stop(true);
  }
});

test("Bun terminates HTTPS with a caller-supplied trusted certificate", async () => {
  const { cert, key } = generatedTls();
  const server = startServer(app, { port: 0, tls: { cert, key } });
  try {
    expect(server.url.protocol).toBe("https:");
    await expect(fetch(new URL("/api/health", server.url))).rejects.toThrow();
    const response = await fetch(new URL("/api/health", server.url), {
      tls: { ca: await Bun.file(cert).text() },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  } finally {
    await server.stop(true);
  }
});

test("ambiguous path patterns and malformed module exports fail startup", () => {
  const route = (pattern: string) => ({
    $: "Route", method: { $: "Get" }, pattern, handler: 0,
  });
  expect(() => startServer({})).toThrow("Export routes");
  expect(() => startServer({
    routes: () => ({
      $: "Con", head: route("/model/:id"),
      tail: { $: "Con", head: route("/model/:name"), tail: { $: "Nil" } },
    }),
    handle: () => null,
  })).toThrow("Ambiguous route patterns");
});


test("a Curve action resumes with an HTTPS result and refuses disallowed origins", async () => {
  const { cert, key } = generatedTls();
  const hits: string[] = [];
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    tls: { cert: Bun.file(cert), key: Bun.file(key) },
    async fetch(request) {
      const { pathname } = new URL(request.url);
      hits.push(pathname);
      if (pathname === "/redirect") return Response.redirect(new URL("/target", request.url), 302);
      if (pathname === "/echo") {
        return new Response(request.method + " " + request.headers.get("content-type") + " " + await request.text());
      }
      if (pathname === "/large") return new Response("🌍".repeat(300));
      if (pathname === "/slow") {
        await Bun.sleep(800);
        return new Response("late");
      }
      return new Response("from TLS 🌍", { status: 202 });
    },
  });
  let trusted: ReturnType<typeof startServer> | undefined;
  let defaultTrust: ReturnType<typeof startServer> | undefined;
  try {
    const ca = await Bun.file(cert).text();
    const allowedOrigins = [upstream.url.origin];
    trusted = startServer(outboundApp, { port: 0, outbound: {
      allowedOrigins, ca, maxResponseBytes: 512, timeoutMs: 300,
    } });
    defaultTrust = startServer(outboundApp, { port: 0, outbound: { allowedOrigins } });

    const request = (server: ReturnType<typeof startServer>, target: URL | string) => {
      const url = new URL("/api/fetch", server.url);
      url.searchParams.set("url", String(target));
      return fetch(url, { redirect: "manual" });
    };
    const denied = await request(trusted, "https://127.0.0.1:1/check");
    expect(denied.status).toBe(403);
    const invalid = await request(trusted, "http://127.0.0.1:1/check");
    expect(invalid.status).toBe(400);
    expect(hits).toEqual([]);

    const untrusted = await request(defaultTrust, new URL("/untrusted", upstream.url));
    expect([untrusted.status, await untrusted.text()]).toEqual([502, "HTTPS transport failed"]);
    const ok = await request(trusted, new URL("/ok", upstream.url));
    expect([ok.status, await ok.text()]).toEqual([202, "from TLS 🌍"]);
    const submit = new URL("/api/send", trusted.url);
    submit.searchParams.set("url", new URL("/echo", upstream.url).href);
    const echoed = await fetch(submit, { method: "POST", body: "Curve 🌍" });
    expect([echoed.status, await echoed.text()]).toEqual([200, "POST text/plain Curve 🌍"]);
    expect((await request(trusted, new URL("/redirect", upstream.url))).status).toBe(302);
    const large = await request(trusted, new URL("/large", upstream.url));
    expect([large.status, await large.text()]).toEqual([502, "HTTPS response exceeded its byte limit"]);
    const slow = await request(trusted, new URL("/slow", upstream.url));
    expect([slow.status, await slow.text()]).toEqual([504, "HTTPS request timed out"]);
    expect(hits).toEqual(["/ok", "/echo", "/redirect", "/large", "/slow"]);
  } finally {
    await trusted?.stop(true);
    await defaultTrust?.stop(true);
    await upstream.stop(true);
  }
});
