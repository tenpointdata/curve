// JUnit XML from Curve receipts: one testsuite per receipt, one testcase
// per law, per selected export and per artifact. The XML is deterministic:
// no clocks or host names, receipts in the order given, cases in receipt
// order. Only an independently verified law passes; a checker-only law is
// skipped, so a ledger that retires tests on JUnit passes credits only
// kernel-checked evidence. Artifacts are rehashed against the disk.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { bytesProblem, parseReceipt, type Receipt, type Result } from "./proof_receipt.ts";

type Status =
  | { readonly kind: "pass" }
  | { readonly kind: "skipped" | "failure" | "error"; readonly message: string; readonly text?: string };

interface Case {
  readonly name: string;
  readonly status: Status;
}

interface Suite {
  readonly name: string;
  readonly properties: ReadonlyArray<readonly [string, string]>;
  readonly cases: readonly Case[];
}

const LAW_STATUS: Record<Result, Status> = {
  verified: { kind: "pass" },
  checker_only: { kind: "skipped", message: "checker-only: not independently verified by CurveTT" },
  skipped: { kind: "skipped", message: "skipped: not evaluated" },
  rejected: { kind: "failure", message: "rejected" },
  infrastructure_failure: { kind: "error", message: "infrastructure failure" },
};

function lawStatus(r: Receipt, result: Result): Status {
  const s = LAW_STATUS[result];
  return s.kind === "pass" || r.reason === undefined ? s : { ...s, text: r.reason };
}

function suiteOf(path: string): Suite {
  let r: Receipt;
  try {
    if (!existsSync(path)) throw new Error("no receipt: the run did not complete");
    r = parseReceipt(readFileSync(path, "utf8"));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { name: path, properties: [], cases: [{ name: "receipt", status: { kind: "error", message } }] };
  }
  const base = dirname(resolve(path));
  const cases: Case[] = [];
  // a suite with no laws still says how its check ended
  cases.push({ name: "result", status: lawStatus(r, r.result) });
  for (const law of r.laws) cases.push({ name: "law:" + law.name, status: lawStatus(r, law.result) });
  const offered = new Set(r.artifacts.flatMap((a) => a.exports ?? []));
  for (const name of r.selected_exports) {
    cases.push({ name: "export:" + name, status: offered.has(name) ? { kind: "pass" }
      : { kind: "failure", message: "selected export not in a verified module" } });
  }
  for (const a of r.artifacts) {
    const p = bytesProblem(base, a);
    cases.push({ name: "artifact:" + a.path, status: p === null ? { kind: "pass" }
      : p.kind === "missing" ? { kind: "error", message: "artifact missing" }
      : { kind: "failure", message: "artifact mismatch: bytes differ from sha256 " + a.sha256 } });
  }
  return {
    name: r.entry.path,
    properties: [
      ["schema", r.schema], ["mode", r.mode], ["result", r.result], ["curve", r.toolchain.curve],
      ["toolchain_sha256", r.toolchain.sources_sha256], ["entry_sha256", r.entry.sha256],
      ...r.checks.map((c) => ["check." + c.engine, c.outcome] as const),
    ],
    cases,
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;")
    // XML 1.0 forbids most control characters
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

function count(cases: readonly Case[], kind: Status["kind"]): number {
  return cases.filter((c) => c.status.kind === kind).length;
}

function caseXml(suite: string, c: Case): string {
  const open = `    <testcase classname="${esc(suite)}" name="${esc(c.name)}"`;
  if (c.status.kind === "pass") return open + "/>";
  const body = c.status.text === undefined ? "" : esc(c.status.text);
  const tag = c.status.kind;
  return `${open}>\n      <${tag} message="${esc(c.status.message)}"${body === "" ? "/>" : `>${body}</${tag}>`}\n    </testcase>`;
}

function totals(cases: readonly Case[]): string {
  return `tests="${cases.length}" failures="${count(cases, "failure")}" errors="${count(cases, "error")}" skipped="${count(cases, "skipped")}"`;
}

export function junit(paths: readonly string[]): string {
  const suites = paths.map(suiteOf);
  const all = suites.flatMap((s) => s.cases);
  const body = suites.map((s) => [
    `  <testsuite name="${esc(s.name)}" ${totals(s.cases)}>`,
    ...(s.properties.length === 0 ? [] : ["    <properties>",
      ...s.properties.map(([k, v]) => `      <property name="${esc(k)}" value="${esc(v)}"/>`),
      "    </properties>"]),
    ...s.cases.map((c) => caseXml(s.name, c)),
    "  </testsuite>",
  ].join("\n"));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="curve" ${totals(all)}>\n${body.join("\n")}\n</testsuites>\n`;
}

// whether every case passed or was skipped for want of the kernel
export function junitClean(xml: string): boolean {
  return !/<(failure|error) /.test(xml);
}
