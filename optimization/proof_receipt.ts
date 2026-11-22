// Verification and module-build receipts: what one `curve <file> --receipt`
// run checked, with which engine, and the exact bytes it wrote. The CLI
// (curve2/main.ts) fills a Trace as it goes; receiptOf turns it into a
// versioned, deterministic Receipt (no clocks, sorted, paths relative to the
// receipt) and verifyReceipt rechecks its bytes later.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import * as Curve from "../curve2/curve.ts";
import { LEAN_VERSION } from "../curve2/safe.ts";

export const RECEIPT_SCHEMA = "curve.receipt/1";

// verified: the CurveTT kernel independently checked it. checker_only:
// curve2's checker accepted it and no independent check ran or completed.
// rejected: a check refused it. skipped: never evaluated (a law the checker
// did not reach). infrastructure_failure: a tool, not the proof, failed.
export type Result = "verified" | "checker_only" | "rejected" | "skipped" | "infrastructure_failure";
export type Engine = "curve-checker" | "curvett";
export type Mode = "check" | "verdict" | "build" | "verified_build";
export type Outcome = "pass" | "fail" | "skipped" | "error";
export type ArtifactKind = "module" | "script" | "c" | "curvett" | "binary";

export interface FileDigest {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface Check {
  readonly engine: Engine;
  readonly outcome: Outcome;
  readonly detail?: string;
}

export interface LawReceipt {
  readonly name: string;
  readonly result: Result;
}

export interface Artifact extends FileDigest {
  readonly kind: ArtifactKind;
  readonly exports?: readonly string[];
}

export interface Toolchain {
  readonly curve: string;
  readonly runtime: string;
  readonly sources_sha256: string;
  readonly kernel: { readonly lean: string; readonly source_sha256: string };
}

export interface Receipt {
  readonly schema: typeof RECEIPT_SCHEMA;
  readonly toolchain: Toolchain;
  readonly mode: Mode;
  readonly entry: FileDigest;
  readonly sources: readonly FileDigest[];
  readonly selected_exports: readonly string[];
  readonly checks: readonly Check[];
  readonly result: Result;
  readonly reason?: string;
  readonly laws: readonly LawReceipt[];
  readonly artifacts: readonly Artifact[];
}

// what the CLI saw: stage is where it got to, and error what stopped it
export interface Trace {
  readonly version: string;
  readonly file: string;
  readonly mode: Mode;
  readonly select: readonly string[];
  readonly seen: ReadonlyMap<string, string | null>;
  readonly outs: string[];
  stage: "check" | "promises" | "kernel" | "emit" | "done";
  book?: Curve.Book;
  rejected?: unknown;     // curve2's reason, when its check failed
  promises?: ReadonlyArray<readonly [string, readonly string[]]>;
  kernel?: string | null; // the kernel's why; null when it passed
  error?: unknown;
}

export const SUCCESS: ReadonlySet<Result> = new Set(["verified", "checker_only"]);

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// a path's real form when it exists (macOS /var is /private/var)
function real(file: string): string {
  const full = resolve(file);
  return existsSync(full) ? realpathSync(full) : full;
}

function rel(base: string, file: string): string {
  return relative(real(base), real(file)).split(sep).join("/");
}

function fileDigest(base: string, file: string): FileDigest {
  const bytes = readFileSync(file);
  return { path: rel(base, file), sha256: sha256(bytes), bytes: bytes.length };
}

// the compiler's own sources (TypeScript, Base, kernel, effects): one digest
export function toolchain(version: string): Toolchain {
  const dir = Curve.CURVE_DIR;
  const files = readdirSync(dir).filter((f) => /\.(ts|curve|lean)$/.test(f))
    .concat(existsSync(join(dir, "effs")) ? readdirSync(join(dir, "effs")).map((f) => "effs/" + f) : [])
    .sort();
  const lines = files.map((f) => f + "\0" + sha256(readFileSync(join(dir, f))) + "\n").join("");
  const lean = join(dir, "curvett.lean");
  return {
    curve: version,
    runtime: typeof Bun === "undefined" ? "node " + process.version : "bun " + Bun.version,
    sources_sha256: sha256(lines),
    kernel: { lean: LEAN_VERSION, source_sha256: existsSync(lean) ? sha256(readFileSync(lean)) : "" },
  };
}

export function artifactKind(out: string): ArtifactKind {
  const ext = extname(out);
  return ext === ".mjs" ? "module" : ext === ".js" || ext === ".cjs" ? "script"
    : ext === ".c" ? "c" : ext === ".curvett" || ext === ".bendtt" ? "curvett" : "binary";
}

// the keys of a .mjs module's `export default {...}` (comp.ts js_lib)
export function moduleExports(text: string): string[] {
  const at = text.lastIndexOf("\nexport default {\n");
  if (at < 0) return [];
  const keys: string[] = [];
  for (const line of text.slice(at).split("\n")) {
    const m = /^ {2}(\[?)("(?:[^"\\]|\\.)*")\]?: run_lib\(/.exec(line);
    if (m !== null) keys.push(JSON.parse(m[2]) as string);
  }
  return keys.sort();
}

function message(e: unknown): string {
  const err = e as Curve.Err | null;
  const text = err?.$ === "Err" ? Curve.err_show(err)
    : e instanceof AggregateError ? e.errors.map(message).join("\n")
    : e instanceof Error ? e.message : String(e);
  return text.trim().split("\n").slice(0, 12).join("\n");
}

// the defs a checker failure names (Err.def), as name_key spells them
function blamed(e: unknown, out = new Set<string>()): Set<string> {
  if (e instanceof AggregateError) e.errors.forEach((x) => blamed(x, out));
  const err = e as Curve.Err | null;
  if (err?.$ === "Err" && err.def !== undefined) out.add(Curve.name_key(err.def));
  return out;
}

function lawKeys(book: Curve.Book | undefined): string[] {
  if (book === undefined) return [];
  return [...new Set(book.order)].filter((k) => {
    const t = book.tlds[k];
    return t?.$ === "Def" && t.l === true && t.b !== true;
  }).map(Curve.name_key).sort();
}

interface Verdict {
  readonly checks: Check[];
  readonly result: Result;
  readonly reason?: string;
  readonly law: (name: string) => Result;
}

function verdictOf(t: Trace): Verdict {
  const kernelSkipped: Check = { engine: "curvett", outcome: "skipped" };
  const infra = t.error !== undefined;
  // an entry that cannot be read was never checked
  if (t.rejected !== undefined && !existsSync(t.file)) {
    return {
      checks: [{ engine: "curve-checker", outcome: "error", detail: message(t.rejected) }, kernelSkipped],
      result: "infrastructure_failure", reason: message(t.rejected), law: () => "skipped",
    };
  }
  if (t.rejected !== undefined) {
    const named = blamed(t.rejected);
    return {
      checks: [{ engine: "curve-checker", outcome: "fail", detail: message(t.rejected) }, kernelSkipped],
      result: "rejected", reason: message(t.rejected),
      law: (n) => named.has(n) ? "rejected" : "skipped",
    };
  }
  // a failure after the checker returned a book is not the checker's
  if (infra && t.stage === "check" && t.book === undefined) {
    return {
      checks: [{ engine: "curve-checker", outcome: "error", detail: message(t.error) }, kernelSkipped],
      result: "infrastructure_failure", reason: message(t.error), law: () => "skipped",
    };
  }
  if (t.promises !== undefined && t.promises.length > 0) {
    const bad = new Set(t.promises.flatMap(([, ks]) => ks.map(Curve.name_key)));
    const detail = t.promises.map(([on, ks]) => "depends on " + on + ": "
      + ks.map(Curve.name_key).join(", ")).join("\n");
    return {
      checks: [{ engine: "curve-checker", outcome: "fail", detail }, kernelSkipped],
      result: "rejected", reason: detail, law: (n) => bad.has(n) ? "rejected" : "checker_only",
    };
  }
  const checker: Check = { engine: "curve-checker", outcome: "pass" };
  if (infra && t.stage === "kernel") {
    return {
      checks: [checker, { engine: "curvett", outcome: "error", detail: message(t.error) }],
      result: "infrastructure_failure", reason: message(t.error), law: () => "checker_only",
    };
  }
  // a kernel failure, or a def outside CurveTT's scope: the CLI says FAIL
  if (typeof t.kernel === "string") {
    return {
      checks: [checker, { engine: "curvett", outcome: "fail", detail: message(t.kernel) }],
      result: "rejected", reason: message(t.kernel), law: () => "checker_only",
    };
  }
  const kernel: Check = t.kernel === null ? { engine: "curvett", outcome: "pass" } : kernelSkipped;
  const proven: Result = t.kernel === null ? "verified" : "checker_only";
  if (infra) {
    return { checks: [checker, kernel], result: "infrastructure_failure", reason: message(t.error), law: () => proven };
  }
  return { checks: [checker, kernel], result: proven, law: () => proven };
}

// receiptOf builds the receipt for a trace, its paths relative to base
export function receiptOf(t: Trace, base: string): Receipt {
  const v = verdictOf(t);
  const success = SUCCESS.has(v.result);
  const artifacts: Artifact[] = t.outs.filter((o) => existsSync(o)).map((out) => {
    const kind = artifactKind(out);
    const exports = kind === "module" ? moduleExports(readFileSync(out, "utf8")) : undefined;
    return { ...fileDigest(base, out), kind, ...(exports === undefined ? {} : { exports }) };
  });
  const offered = new Set(artifacts.flatMap((a) => a.exports ?? []));
  const missing = t.select.filter((name) => !offered.has(name));
  const entry = real(t.file);
  const sources = [...new Set([...t.seen.keys()].map(real))]
    .filter((f) => f !== Curve.BASE_CURVE && f !== entry && existsSync(f))
    .map((f) => fileDigest(base, f)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const result: Result = success && missing.length > 0 ? "rejected" : v.result;
  const reason = success && missing.length > 0
    ? "selected exports missing from the built modules: " + missing.join(", ") : v.reason;
  return {
    schema: RECEIPT_SCHEMA,
    toolchain: toolchain(t.version),
    mode: t.mode,
    entry: existsSync(entry) ? fileDigest(base, entry) : { path: rel(base, entry), sha256: "", bytes: 0 },
    sources,
    selected_exports: [...t.select].sort(),
    checks: v.checks,
    result,
    ...(reason === undefined ? {} : { reason }),
    laws: lawKeys(t.book).map((name) => ({ name, result: v.law(name) })),
    // a failed run vouches for no bytes: only a successful one lists them
    artifacts: SUCCESS.has(result) ? artifacts : [],
  };
}

export function receiptText(r: Receipt): string {
  return JSON.stringify(r, null, 2) + "\n";
}

// writeReceipt writes it whole (a temporary file renamed into place) and
// says whether it records success
export function writeReceipt(t: Trace, out: string): boolean {
  const target = resolve(out);
  const r = receiptOf(t, dirname(target));
  const tmp = target + ".tmp-" + process.pid;
  writeFileSync(tmp, receiptText(r));
  try {
    renameSync(tmp, target);
  } finally {
    rmSync(tmp, { force: true });
  }
  return SUCCESS.has(r.result);
}

export function parseReceipt(text: string): Receipt {
  const r = JSON.parse(text) as Partial<Receipt>;
  if (r.schema !== RECEIPT_SCHEMA) throw new Error("not a " + RECEIPT_SCHEMA + " receipt");
  if (!Array.isArray(r.laws) || !Array.isArray(r.artifacts) || !Array.isArray(r.checks)
    || typeof r.result !== "string" || r.entry === undefined || r.toolchain === undefined) {
    throw new Error("malformed " + RECEIPT_SCHEMA + " receipt");
  }
  return r as Receipt;
}

export type Problem = { readonly path: string; readonly kind: "missing" | "mismatch" };

// bytesProblem rechecks one recorded file against the disk
export function bytesProblem(base: string, d: FileDigest): Problem | null {
  const file = resolve(base, d.path);
  if (!existsSync(file)) return { path: d.path, kind: "missing" };
  return sha256(readFileSync(file)) === d.sha256 ? null : { path: d.path, kind: "mismatch" };
}

// verifyReceipt rechecks the entry, its sources and artifacts, and the
// toolchain identity, against what is on disk now
export function verifyReceipt(path: string): { receipt: Receipt; problems: Problem[] } {
  const receipt = parseReceipt(readFileSync(path, "utf8"));
  const base = dirname(resolve(path));
  const problems = [receipt.entry, ...receipt.sources, ...receipt.artifacts]
    .map((d) => bytesProblem(base, d)).filter((p): p is Problem => p !== null);
  if (toolchain(receipt.toolchain.curve).sources_sha256 !== receipt.toolchain.sources_sha256) {
    problems.push({ path: "toolchain", kind: "mismatch" });
  }
  return { receipt, problems };
}
