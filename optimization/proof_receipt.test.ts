// Receipts through the real CLI: every case spawns `curve` on a copy of the
// optimization gate's laws, as Insight and Composite do.

import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseReceipt, type Receipt } from "./proof_receipt.ts";

const ROOT = join(import.meta.dir, "..");
const MAIN = join(ROOT, "curve2", "main.ts");
const temporary = mkdtempSync(join(tmpdir(), "curve-receipt-"));
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

interface Run { readonly status: number; readonly stdout: string; readonly stderr: string }

function curve(args: readonly string[], env: Record<string, string> = {}): Run {
  const got = spawnSync("bun", [MAIN, ...args], {
    encoding: "utf8", env: { ...process.env, CURVE_NO_TELEMETRY: "1", ...env },
  });
  return { status: got.status ?? -1, stdout: got.stdout, stderr: got.stderr };
}

let n = 0;
function study(mutate?: (text: string) => string): { dir: string; gate: string } {
  const dir = join(temporary, String(n++));
  mkdirSync(dir, { recursive: true });
  const gate = join(dir, "gate.curve");
  copyFileSync(join(import.meta.dir, "gate.curve"), gate);
  if (mutate) writeFileSync(gate, mutate(readFileSync(gate, "utf8")));
  return { dir, gate };
}

function receipt(path: string): Receipt {
  return parseReceipt(readFileSync(path, "utf8"));
}

// a law that now claims rankable(gate, False{}) is True{}
const MUTANT = (text: string) => text.replace("{rankable(gate, False{}) == False{} : Bool}",
  "{rankable(gate, False{}) == True{} : Bool}");
const LAWS = ["failed_evidence_blocks_ranking", "missing_evidence_blocks_ranking", "missing_objectives_block_ranking"];

// the kernel is built from Lean 4.34.0 on first use; without it the
// independent pass cannot run here (the missing-kernel case still does)
const KERNEL = !curve([join(import.meta.dir, "gate.curve"), "--verdict"]).stderr.includes("CurveTT infrastructure");

test.skipIf(!KERNEL)("a verified module build records its laws, exports and bytes", () => {
  const { dir, gate } = study();
  const out = join(dir, "gate.mjs");
  const r = join(dir, "r.json");
  const run = curve([gate, "--verdict", "-o", out, "--export", "verdict", "--export", "rankable", "--receipt", r]);
  expect(run).toMatchObject({ status: 0, stdout: "ALL PROOFS CHECK\n" });
  const got = receipt(r);
  expect(got.result).toBe("verified");
  expect(got.mode).toBe("verified_build");
  expect(got.checks.map((c) => c.outcome)).toEqual(["pass", "pass"]);
  expect(got.laws).toEqual(LAWS.map((name) => ({ name, result: "verified" })));
  expect(got.sources).toEqual([]);
  expect(got.artifacts).toHaveLength(1);
  expect(got.artifacts[0]).toMatchObject({ path: "gate.mjs", kind: "module", bytes: readFileSync(out).length });
  // --export restricts the module to the selected definitions
  expect(got.artifacts[0].exports).toEqual(["rankable", "verdict"]);
  expect(curve(["receipt", "verify", r]).status).toBe(0);
  const xml = curve(["receipt", "junit", r]);
  expect(xml.status).toBe(0);
  expect(xml.stdout).toContain('tests="7" failures="0" errors="0" skipped="0"');
  // the same inputs give the same receipt and report, byte for byte
  const again = join(dir, "again.json");
  curve([gate, "--verdict", "-o", out, "--export", "verdict", "--export", "rankable", "--receipt", again]);
  expect(readFileSync(again, "utf8")).toBe(readFileSync(r, "utf8"));
  expect(curve(["receipt", "junit", r]).stdout).toBe(xml.stdout);
});

test("a checker-only build passes the checker but credits no law in JUnit", () => {
  const { dir, gate } = study();
  const r = join(dir, "r.json");
  expect(curve([gate, "-o", join(dir, "gate.mjs"), "--receipt", r]).status).toBe(0);
  const got = receipt(r);
  expect(got.result).toBe("checker_only");
  expect(got.checks).toEqual([{ engine: "curve-checker", outcome: "pass" }, { engine: "curvett", outcome: "skipped" }]);
  expect(got.laws.every((law) => law.result === "checker_only")).toBe(true);
  const xml = curve(["receipt", "junit", r]);
  expect(xml.status).toBe(0);
  expect(xml.stdout).toContain('skipped="4"');
  expect(xml.stdout).toContain("checker-only: not independently verified by CurveTT");
});

test("a mutated law is rejected and its build leaves no successful receipt", () => {
  const { dir, gate } = study(MUTANT);
  const out = join(dir, "gate.mjs");
  writeFileSync(out, "stale module from an earlier build\n");
  const r = join(dir, "r.json");
  writeFileSync(r, "stale receipt\n");
  const run = curve([gate, "--verdict", "-o", out, "--receipt", r]);
  expect(run.status).toBe(1);
  expect(run.stderr).toStartWith("SOME PROOFS FAIL\n");
  const got = receipt(r);
  expect(got.result).toBe("rejected");
  expect(got.artifacts).toEqual([]);
  expect(got.checks.map((c) => c.outcome)).toEqual(["fail", "skipped"]);
  expect(got.laws.find((law) => law.name === "missing_objectives_block_ranking")?.result).toBe("rejected");
  expect(got.laws.filter((law) => law.result === "verified")).toEqual([]);
  expect(readFileSync(out, "utf8")).toBe("stale module from an earlier build\n");
  expect(curve(["receipt", "verify", r]).status).toBe(1);
  const xml = curve(["receipt", "junit", r]);
  expect(xml.status).toBe(1);
  expect(xml.stdout).toContain('name="law:missing_objectives_block_ranking">\n      <failure message="rejected"');
});

test("a missing kernel is an infrastructure failure, not a rejection", () => {
  const { dir, gate } = study();
  const out = join(dir, "gate.mjs");
  const r = join(dir, "r.json");
  const run = curve([gate, "--verdict", "-o", out, "--receipt", r], { CURVETT: join(dir, "no-kernel") });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain("no-kernel");
  const got = receipt(r);
  expect(got.result).toBe("infrastructure_failure");
  expect(got.checks.map((c) => c.outcome)).toEqual(["pass", "error"]);
  expect(got.laws.every((law) => law.result === "checker_only")).toBe(true);
  expect(got.artifacts).toEqual([]);
  expect(existsSync(out)).toBe(false);
  const xml = curve(["receipt", "junit", r]);
  expect(xml.status).toBe(1);
  expect(xml.stdout).toContain('<error message="infrastructure failure"');
});

test("changed artifact bytes fail verification and JUnit", () => {
  const { dir, gate } = study();
  const out = join(dir, "gate.mjs");
  const r = join(dir, "r.json");
  expect(curve([gate, "-o", out, "--receipt", r]).status).toBe(0);
  writeFileSync(out, readFileSync(out, "utf8") + "// tampered\n");
  const verify = curve(["receipt", "verify", r]);
  expect(verify.status).toBe(1);
  expect(verify.stderr).toContain("mismatch: gate.mjs");
  const report = join(dir, "report.xml");
  expect(curve(["receipt", "junit", r, "-o", report]).status).toBe(1);
  expect(readFileSync(report, "utf8")).toContain('name="artifact:gate.mjs">\n      <failure message="artifact mismatch');
});

test("a selected export the module lacks rejects the build", () => {
  const { dir, gate } = study();
  const r = join(dir, "r.json");
  expect(curve([gate, "-o", join(dir, "gate.mjs"), "--export", "absent", "--receipt", r]).status).toBe(1);
  const got = receipt(r);
  expect(got.result).toBe("rejected");
  expect(got.reason).toContain("absent");
  expect(got.artifacts).toEqual([]);
});

test("a run that wrote no receipt reports an error in JUnit", () => {
  const xml = curve(["receipt", "junit", join(temporary, "never.json")]);
  expect(xml.status).toBe(1);
  expect(xml.stdout).toContain('name="receipt">\n      <error message="no receipt: the run did not complete"');
});

test("human output and exit codes are unchanged without --receipt", () => {
  const { dir, gate } = study();
  expect(curve([gate, "--check-only"])).toMatchObject({ status: 0,
    stdout: "ALL PROOFS CHECK\nUse --verdict for mathematical validity.\n", stderr: "" });
  expect(curve([study(MUTANT).gate, "--check-only"]).status).toBe(1);
  expect(curve([gate, "--check-only", "-o", join(dir, "x.mjs")]).status).toBe(1);
  expect(curve([gate, "--export", "verdict", "-o", join(dir, "x.c")]).status).toBe(1);
  expect(curve([gate, "--receipt", join(dir, "r.json")]).status).toBe(1);
  expect(existsSync(join(dir, "x.mjs"))).toBe(false);
});

test("a receipt path never replaces a source or an output, and bad paths fail cleanly", () => {
  const { dir, gate } = study();
  const source = readFileSync(gate, "utf8");
  expect(curve([gate, "--check-only", "--receipt", gate]).status).toBe(1);
  expect(readFileSync(gate, "utf8")).toBe(source);
  const out = join(dir, "out.json");
  expect(curve([gate, "-o", out, "--receipt", out]).status).toBe(1);
  expect(existsSync(out)).toBe(false);
  expect(curve([join(dir, "page.html"), "-o", join(dir, "site"), "--receipt", join(dir, "r.json")]).status).toBe(1);
  const unwritable = curve([gate, "--check-only", "--receipt", join(dir, "absent", "r.json")]);
  expect(unwritable.status).toBe(1);
  expect(unwritable.stderr).toContain("curve: cannot write receipt");
});

test("an entry that cannot be read is an infrastructure failure", () => {
  const { dir } = study();
  const r = join(dir, "r.json");
  expect(curve([join(dir, "missing.curve"), "--check-only", "--receipt", r]).status).toBe(1);
  const got = receipt(r);
  expect(got.result).toBe("infrastructure_failure");
  expect(got.checks[0]).toMatchObject({ engine: "curve-checker", outcome: "error" });
});

test("a guarded module and its declarations are both recorded", () => {
  const { dir, gate } = study();
  const r = join(dir, "r.json");
  const run = curve([gate, "-o", join(dir, "gate.mjs"), "-o", join(dir, "gate.d.mts"),
    "--export", "verdict", "--receipt", r]);
  expect(run.status).toBe(0);
  const got = receipt(r);
  expect(got.result).toBe("checker_only");
  expect(got.artifacts.map((a) => [a.path, a.kind, a.exports])).toEqual([
    ["gate.mjs", "module", ["verdict"]], ["gate.d.mts", "declarations", undefined]]);
  expect(curve(["receipt", "verify", r]).status).toBe(0);
});
