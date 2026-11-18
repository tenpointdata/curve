// Each case: a book on disk, run through curve-cache (warm, after a change)
// and through `curve --check-only`; the outputs must be equal byte for byte.

import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "cache.ts");
const CURVE2 = path.join(HERE, "..", "..", "..", "curve2");
const MAIN = path.join(CURVE2, "main.ts");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "curve-cache-"));

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

type Files = Record<string, string>;

let n = 0;
function book(files: Files): { dir: string; cache: string } {
  const dir = path.join(TMP, "b" + String(n++));
  for (const [f, s] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), s);
  }
  return { dir, cache: path.join(dir, ".cache.json") };
}

function run(cmd: string[], dir: string): string {
  const p = spawnSync("bun", cmd, { cwd: dir, encoding: "utf8", env: { ...process.env, CURVE_NO_TELEMETRY: "1" } });
  return "exit " + String(p.status) + "\n" + p.stdout + p.stderr;
}

function cached(b: { dir: string; cache: string }, entry: string, stats = false): string {
  // every check keeps a trace, so the skips are what the cases test
  return run([TOOL, entry, "--cache", b.cache, "--curve", CURVE2, "--min-ms", "0", ...(stats ? ["--stats"] : [])], b.dir);
}

function plain(b: { dir: string }, entry: string): string {
  return run([MAIN, entry, "--check-only"], b.dir);
}

// a run on a warm cache: it skips, and prints what curve prints
function warm(b: { dir: string }, entry: string): void {
  const out = cached(b as never, entry, true);
  expect(out).toMatch(/skipped [1-9]\d*/);
  expect(out.replace(/curve-cache: .*\n/, "")).toBe(plain(b, entry));
}

// warm the cache on the book, apply each change in turn, and compare
function same(files: Files, entry: string, changes: Array<[string, string, string]>): void {
  const b = book(files);
  expect(cached(b, entry)).toBe(plain(b, entry));
  warm(b, entry);
  for (const [f, from, to] of changes) {
    const at = path.join(b.dir, f);
    const src = fs.readFileSync(at, "utf8");
    expect(src.includes(from)).toBe(true);
    fs.writeFileSync(at, src.replace(from, to));
    expect(cached(b, entry)).toBe(plain(b, entry));
    fs.writeFileSync(at, src);
    expect(cached(b, entry)).toBe(plain(b, entry));
  }
}

const LIB = "import Base\n\n" + Array.from({ length: 40 }, (_, i) =>
  `def p${i}() -> {U32.to_nat(${1000 + i}) == ${1000 + i}n : Nat}:\n  {==}\n`).join("\n");

const client = (j: number) =>
  `import Base\nimport ./lib.curve as Lib\n\ndef mine() -> {Lib.p${j} == Lib.p${j} : {U32.to_nat(${1000 + j}) == ${1000 + j}n : Nat}}:\n  {==}\n`;

test("a library checked once serves every client", () => {
  const b = book({ "lib.curve": LIB, "a.curve": client(0), "b.curve": client(1) });
  expect(cached(b, "a.curve")).toBe(plain(b, "a.curve"));
  warm(b, "b.curve");
});

test("an edit to a library def rechecks it and what read it", () => {
  same({ "lib.curve": LIB, "a.curve": client(3) }, "a.curve", [
    ["lib.curve", "U32.to_nat(1003) == 1003n", "U32.to_nat(1003) == 1004n"],
    ["lib.curve", "U32.to_nat(1007) == 1007n", "U32.to_nat(1007) == 1008n"],
    ["a.curve", "{==}", "?h"],
  ]);
});

// a fill is seen in load order: T never imports C, main's import order
// decides whether T sees C's fill
test("a fill made by a file the reader does not import", () => {
  same({
    "T0.curve": "import Base\n\nlaw L: Nat\n",
    "C.curve": "import Base\nimport ./T0.curve as T0\n\ndef T0.L():\n  4n\n",
    "T.curve": "import Base\nimport ./T0.curve as T0\n\ndef p() -> {T0.L == 4n : Nat}:\n  {==}\n",
    "main.curve": "import Base\nimport ./T0.curve as T0\nimport ./C.curve as C\nimport ./T.curve as T\n\ndef main() -> Nat:\n  0n\n",
  }, "main.curve", [
    ["main.curve", "import ./C.curve as C\nimport ./T.curve as T\n", "import ./T.curve as T\nimport ./C.curve as C\n"],
    ["C.curve", "4n", "5n"],
  ]);
});

// dropping a fill makes its law a TODO at the law, which is skipped
test("a law whose fill is dropped is a TODO", () => {
  same({
    "LAWS.curve": "import Base\n\nlaw k: Nat\n\nlaw k_is: {k == 5n : Nat}\n",
    "PROOF.curve": "import Base\nimport ./LAWS.curve as Laws\n\ndef Laws.k():\n  5n\n\ndef Laws.k_is():\n  {==}\n",
  }, "PROOF.curve", [
    ["PROOF.curve", "def Laws.k_is():\n  {==}\n", ""],
    ["PROOF.curve", "  5n\n", "  6n\n"],
  ]);
});

// the verdict reads what a checked body names: a skipped def keeps it
test("a skipped def that calls Base's @unsafe Array.fork still fails", () => {
  const src = fs.readFileSync(path.join(CURVE2, "..", "tests", "run", "array_fork_unshare.curve"), "utf8");
  const b = book({ "m.curve": src });
  const want = plain(b, "m.curve");
  expect(want).toContain("rely on unsafe or foreign code");
  expect(cached(b, "m.curve")).toBe(want);
  warm(b, "m.curve");
});

test("a skipped def that calls an @unsafe template's instance still fails", () => {
  const src = fs.readFileSync(path.join(CURVE2, "..", "tests", "comptime", "unsafe.curve"), "utf8");
  const b = book({ "m.curve": src });
  const want = plain(b, "m.curve");
  expect(cached(b, "m.curve")).toBe(want);
  warm(b, "m.curve");
});

// an instance is named by the order it was minted in: a skipped def mints
// none, so c's instance takes the name a's had
test("a skipped def's instance name does not follow it", () => {
  same({
    "m.curve": "import Base\n\n@unsafe\ndef u(n: Nat) -> Nat:\n  n\n\ndef app(~f: Nat -> Nat, x: Nat) -> Nat:\n  f(x)\n\n"
      + "def a() -> Nat:\n  app(~(n => 1n+n), 1n)\n\ndef c() -> Nat:\n  app(~(n => u(n)), 2n)\n",
  }, "m.curve", [["m.curve", "2n)", "3n)"]]);
});

test("a cache it cannot write warns, and the verdict stands", () => {
  const b = book({ "m.curve": "import Base\n\ndef p() -> {1n == 1n : Nat}:\n  {==}\n" });
  const out = run([TOOL, "m.curve", "--cache", "/dev/null/traces.json", "--curve", CURVE2, "--min-ms", "0"], b.dir);
  expect(out.replace(/curve-cache: cannot write .*\n/, "")).toBe(plain(b, "m.curve"));
});

test("a curve2 that changed where the seam patches stops with drift", () => {
  const dir = path.join(TMP, "drift");
  fs.cpSync(CURVE2, dir, { recursive: true, filter: (s) => !/node_modules|[\\/]docs\b/.test(s) });
  const at = path.join(dir, "main.ts");
  fs.writeFileSync(at, fs.readFileSync(at, "utf8").replace("    Curve.book_valid(book, base?.order.length ?? 0);\n", "    Curve.book_valid(book);\n"));
  const b = book({ "m.curve": "import Base\n\ndef p() -> {1n == 1n : Nat}:\n  {==}\n" });
  const out = run([TOOL, "m.curve", "--cache", b.cache, "--curve", dir], b.dir);
  expect(out).toStartWith("exit 2\n");
  expect(out).toContain("drift");
});
