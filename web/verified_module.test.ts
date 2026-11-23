import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const cli = join(import.meta.dir, "../curve2/main.ts");
const decoder = new TextDecoder();

test("verifies the whole source book and emits only the requested JS exports", async () => {
  const dir = mkdtempSync(join(tmpdir(), "curve-module-test-"));
  try {
    const library = join(dir, "math.curve");
    const source = join(dir, "PROOF.curve");
    const output = join(dir, "math.mjs");
    const kernel = join(dir, "kernel");
    writeFileSync(library, "import Base\ndef add1(n: Nat) -> Nat:\n  (1n + n : Nat)\n");
    writeFileSync(source, "import Base\nimport ./math.curve as Math\n"
      + "def add2(n: Nat) -> Nat:\n  Math.add1(Math.add1(n))\n"
      + "def private() -> Nat:\n  3n\n");
    // CI exercises CLI plumbing without a Lean toolchain. A real kernel can
    // replace the test double by setting CURVETT.
    writeFileSync(kernel, "#!/bin/sh\ntest -s \"$1\" || exit 2\necho ALL PROOFS CHECK\n", { mode: 0o700 });
    function run(file: string, args: string[], curvett = process.env.CURVETT ?? kernel) {
      return Bun.spawnSync([process.execPath, cli, file, ...args], {
        env: { ...process.env, CURVE_NO_TELEMETRY: "1", CURVETT: curvett },
      });
    }

    const selected = ["--verdict", "-o", output, "--export", "add2", "--export", "math:add1"];
    const emitted = run(source, selected);
    expect(decoder.decode(emitted.stdout)).toContain("ALL PROOFS CHECK");
    expect(emitted.exitCode).toBe(0);
    const result: unknown = (await import(pathToFileURL(output).href)).default;
    if (typeof result !== "object" || result === null
      || !("add2" in result) || typeof result.add2 !== "function"
      || !("math:add1" in result) || typeof result["math:add1"] !== "function") {
      throw new Error("Expected the selected Curve functions");
    }
    expect(Object.keys(result)).toEqual(["add2", "math:add1"]);
    expect(result.add2(40)).toBe(42);
    expect(result["math:add1"](41)).toBe(42);
    expect(readFileSync(output, "utf8")).not.toContain("$private");
    const previous = readFileSync(output);

    const rejectedKernel = join(dir, "reject");
    writeFileSync(rejectedKernel, "#!/bin/sh\nprintf 'SOME PROOFS FAIL\\nrejected\\n'\nexit 1\n", { mode: 0o700 });
    const rejected = run(source, selected, rejectedKernel);
    expect(rejected.exitCode).toBe(1);
    expect(decoder.decode(rejected.stderr)).toContain("rejected");
    expect(readFileSync(output)).toEqual(previous);

    const absent = join(dir, "absent.mjs");
    const unsafe = join(import.meta.dir, "../tests/import/unsafe_unused.curve");
    const denied = run(unsafe, ["--verdict", "-o", absent, "--export", "keep"]);
    expect(denied.exitCode).toBe(1);
    expect(decoder.decode(denied.stderr)).toContain("@unsafe");
    expect(existsSync(absent)).toBe(false);

    const unknown = run(source, ["-o", output, "--export", "missing"]);
    expect(unknown.exitCode).toBe(1);
    expect(decoder.decode(unknown.stderr)).toContain("Not a module export: missing");
    expect(readFileSync(output)).toEqual(previous);

    const badSource = join(dir, "bad.curve");
    writeFileSync(badSource, "import Base\ndef broken() -> Nat:\n  True{}\n");
    expect(run(badSource, ["--verdict", "-o", output]).exitCode).toBe(1);
    expect(readFileSync(output)).toEqual(previous);

    const badExtension = run(source, ["--verdict", "-o", join(dir, "out.js")]);
    expect(badExtension.exitCode).toBe(1);
    expect(decoder.decode(badExtension.stderr)).toContain("single .mjs output");

    expect(run(unsafe, ["-o", absent]).exitCode).toBe(0);
    const old: unknown = (await import(pathToFileURL(absent).href)).default;
    if (typeof old !== "object" || old === null || !("keep" in old) || typeof old.keep !== "function") {
      throw new Error("Expected the existing permissive module export");
    }
    expect(old.keep(42)).toBe(42);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
