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
  const cert = join(root, "server.pem");
  const key = join(root, "server-key.pem");
  const generated = Bun.spawnSync([
    "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", key, "-out", cert,
  ]);
  if (generated.exitCode !== 0) throw new Error(generated.stderr.toString());

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
