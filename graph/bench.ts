// The performance envelope of graph/walk.curve's ordered walks against Roca
// Insight's walker, under Bun and headless Chromium.
//
//   bun --preload ./curve2/main.ts graph/bench.ts [--runs 7] [--json out.json] [--probe]
//
// It times representative small flows and the 100,000-edge chain, fan-out
// and cyclic cases; reads the heap growth across one call (before any
// collection) and what the answer retains after one; checks each answer
// against the reference; and measures the stack each walk needs at three
// sizes. Chromium runs the same code bundled with the ES module
// `curve graph/walk.curve -o` writes; set CHROMIUM to pick the binary.

import { insightForward } from "./reference";
import { SHAPES, largeCases, randomCase, type Case } from "./fixtures";
import { toCsr, walkCsr, walkStrings, type WalkModule } from "./walk";

export type Impl = "insight" | "curve csr+intern" | "curve csr walk" | "curve strings";

export type Row = {
  env: string;
  case: string;
  edges: number;
  impl: Impl;
  medianMs: number;
  minMs: number;
  heapMb: number;
  growthMb: number;
  exact: boolean;
};

export type StackProbe = { env: string; maxDepth: number; need: Record<string, number> };

export type Host = { env: string; now(): number; heap(): number; gc(): void };

function edgeCount(c: Case): number {
  let n = 0;
  for (const t of c.adj.values()) n += t.length;
  return n;
}

/** Small flows: Insight-sized registries and the hand-written shapes. */
export function smallCases(): Case[] {
  return [
    { name: "shapes (14 graphs)", adj: new Map(SHAPES.flatMap((s) => [...s.adj].map(([k, v]) => [`${s.name}/${k}`, v.map((t) => `${s.name}/${t}`)]))), roots: SHAPES.flatMap((s) => s.roots.map((r) => `${s.name}/${r}`)) },
    randomCase(7, 300, 600),
    randomCase(8, 2000, 6000),
  ];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

const MB = 1024 * 1024;

/** Time one implementation: `runs` measured calls after one warm-up, and the
 * heap still held by the answer (measured after a full collection). */
function measure(host: Host, run: () => string[], expected: string[], runs: number): Omit<Row, "env" | "case" | "edges" | "impl"> {
  let answer = run();
  const exact = answer.length === expected.length && answer.every((id, i) => id === expected[i]);
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    answer = [];
    host.gc();
    const t0 = host.now();
    answer = run();
    times.push(host.now() - t0);
  }
  answer = [];
  host.gc();
  const before = host.heap();
  answer = run();
  const growthMb = (host.heap() - before) / MB;
  host.gc();
  const heapMb = (host.heap() - before) / MB;
  return { medianMs: median(times), minMs: Math.min(...times), heapMb, growthMb, exact: exact && answer.length === expected.length };
}

export function runBench(mod: WalkModule, host: Host, runs: number): Row[] {
  const rows: Row[] = [];
  for (const c of [...smallCases(), ...largeCases()]) {
    const expected = insightForward(c.adj, c.roots);
    const csr = toCsr(c.adj);
    const impls: [Impl, () => string[]][] = [
      ["insight", () => insightForward(c.adj, c.roots)],
      ["curve csr+intern", () => walkCsr(mod, toCsr(c.adj), c.roots, "forward").order],
      ["curve csr walk", () => walkCsr(mod, csr, c.roots, "forward").order],
      ["curve strings", () => walkStrings(mod, c.adj, c.roots, "forward").order],
    ];
    for (const [impl, run] of impls) {
      rows.push({ env: host.env, case: c.name, edges: edgeCount(c), impl, ...measure(host, run, expected, runs) });
    }
  }
  return rows;
}

/** The frames of stack each Curve walk needs beyond Insight's iterative
 * walker on the same graph, at 1,000, 10,000 and 100,000 edges (the String
 * walk only to 10,000: it takes seconds). A walk recurses to depth `d` and
 * runs there; its depth is the deepest `d` it survives. A bounded walk needs
 * the same at every size. Measuring against a walker run the same way cancels
 * the probe's own frames, which differ by engine and JIT tier. */
export function stackProbe(mod: WalkModule, env: string): StackProbe {
  const at = (depth: number, f: () => void): boolean => {
    const go = (k: number): boolean => {
      // Not a tail call: JavaScriptCore runs proper tail calls in place.
      if (k > 0) return go(k - 1) === true;
      try { f(); return true; } catch (e) { if (e instanceof RangeError) return false; throw e; }
    };
    try { return go(depth); } catch (e) { if (e instanceof RangeError) return false; throw e; }
  };
  const deepest = (f: () => void): number => {
    let lo = 0;
    let hi = 1 << 22;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (at(mid, f)) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  // Bring the probe and every walker to a steady JIT tier first, and take
  // the median of three bisections: a tier change mid-bisection skews one.
  const warm = largeCases(1_000)[2];
  const warmCsr = toCsr(warm.adj);
  for (let i = 0; i < 3; i++) {
    deepest(() => { insightForward(warm.adj, warm.roots); });
    deepest(() => { walkCsr(mod, warmCsr, warm.roots, "forward"); });
    deepest(() => { walkStrings(mod, warm.adj, warm.roots, "forward"); });
  }
  const steady = (f: () => void): number => median([deepest(f), deepest(f), deepest(f)]);
  const need: Record<string, number> = {};
  let maxDepth = 0;
  for (const edges of [1_000, 10_000, 100_000]) {
    for (const c of largeCases(edges)) {
      const csr = toCsr(c.adj);
      const base = () => { insightForward(c.adj, c.roots); };
      const runs: [string, () => void][] = [["csr", () => { walkCsr(mod, csr, c.roots, "forward"); }]];
      // The String walk takes seconds per call past 10,000 edges.
      if (edges <= 10_000) runs.push(["strings", () => { walkStrings(mod, c.adj, c.roots, "forward"); }]);
      for (const f of [base, ...runs.map((r) => r[1])]) { f(); f(); }
      const d0 = steady(base);
      maxDepth = Math.max(maxDepth, d0);
      for (const [impl, f] of runs) need[`${c.name} ${edges} ${impl}`] = d0 - steady(f);
    }
  }
  return { env, maxDepth, need };
}

export function table(rows: Row[]): string {
  const head = "| env | case | edges | impl | median ms | min ms | growth MB | retained MB | exact |\n|---|---|---:|---|---:|---:|---:|---:|---|";
  return [head, ...rows.map((r) => `| ${r.env} | ${r.case} | ${r.edges} | ${r.impl} | ${r.medianMs.toFixed(2)} | ${r.minMs.toFixed(2)} | ${r.growthMb.toFixed(1)} | ${r.heapMb.toFixed(1)} | ${r.exact ? "yes" : "NO"} |`)].join("\n");
}

// The page Chromium loads: the bundle sets window.__out when it is done.
const PAGE = `<!doctype html><meta charset="utf-8"><body><script src="bench.js"></script></body>`;

const ENTRY = (bench: string, walk: string, runs: number, probe: boolean) => `
import { runBench, stackProbe } from ${JSON.stringify(bench)};
import mod from ${JSON.stringify(walk)};
const gcf = globalThis.gc;
const host = {
  env: "chromium " + (navigator.userAgent.match(/Chrome\\/([\\d.]+)/)?.[1] ?? "?"),
  now: () => performance.now(),
  heap: () => performance.memory.usedJSHeapSize,
  gc: () => { if (gcf) gcf(); },
};
let out;
try {
  out = { rows: ${probe} ? [] : runBench(mod, host, ${runs}), probe: stackProbe(mod, host.env), gc: typeof gcf === "function" };
} catch (e) { out = { error: String(e && e.stack || e) }; }
const pre = document.createElement("pre");
pre.id = "out";
pre.textContent = JSON.stringify(out);
document.body.append(pre);
`;

type PageOut = { rows: Row[]; probe: StackProbe; gc: boolean } | { error: string };

async function chromium(runs: number, probe: boolean): Promise<PageOut> {
  const { mkdtempSync, writeFileSync, readdirSync, existsSync } = await import("node:fs");
  const { tmpdir, homedir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "curve-walk-"));
  const here = new URL(".", import.meta.url).pathname;
  const mjs = join(dir, "walk.mjs");
  const built = Bun.spawnSync(["curve", join(here, "walk.curve"), "-o", mjs], { stderr: "pipe" });
  if (built.exitCode !== 0) throw new Error(`curve -o failed: ${built.stderr}`);
  writeFileSync(join(dir, "entry.js"), ENTRY(join(here, "bench.ts"), mjs, runs, probe));
  const bundle = await Bun.build({ entrypoints: [join(dir, "entry.js")], target: "browser", outdir: dir, naming: "bench.js" });
  if (!bundle.success) throw new Error(bundle.logs.join("\n"));
  writeFileSync(join(dir, "index.html"), PAGE);
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  const shell = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop() : undefined;
  const bin = process.env.CHROMIUM ?? (shell ? join(cache, shell, "chrome-headless-shell-mac-arm64/chrome-headless-shell") : "chromium");
  const run = Bun.spawnSync([bin, "--headless", "--disable-gpu", "--no-sandbox", "--allow-file-access-from-files",
    "--enable-precise-memory-info", "--js-flags=--expose-gc", "--virtual-time-budget=600000", "--timeout=600000",
    "--dump-dom", `file://${join(dir, "index.html")}`], { stdout: "pipe", stderr: "pipe" });
  const dom = run.stdout.toString();
  const m = dom.match(/<pre id="out">([^]*?)<\/pre>/);
  if (!m) throw new Error(`no result from ${bin}: ${run.stderr.toString().slice(-2000)}`);
  const text = m[1].replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return JSON.parse(text);
}

if (import.meta.main) {
  const { loadWalk } = await import("./walk");
  const { writeFileSync } = await import("node:fs");
  const jsc = await import("bun:jsc");
  const args = process.argv.slice(2);
  const runs = Number(args[args.indexOf("--runs") + 1]) || 7;
  const json = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;
  const mod = await loadWalk();
  const host: Host = {
    env: `bun ${Bun.version}`,
    now: () => Bun.nanoseconds() / 1e6,
    heap: () => jsc.heapSize(),
    gc: () => Bun.gc(true),
  };
  const probeOnly = args.includes("--probe");
  const rows = probeOnly ? [] : runBench(mod, host, runs);
  const probes = [stackProbe(mod, host.env)];
  const page = await chromium(runs, probeOnly);
  if ("error" in page) throw new Error(`chromium: ${page.error}`);
  rows.push(...page.rows);
  probes.push(page.probe);
  if (rows.length) console.log(table(rows));
  console.log();
  for (const p of probes) console.log(`${p.env}: max depth ${p.maxDepth}; frames each walk needs beyond Insight's:`, p.need);
  if (!page.gc) console.log("chromium: gc was not exposed; retained heap is approximate");
  if (json) writeFileSync(json, JSON.stringify({ rows, probes }, null, 2));
}
