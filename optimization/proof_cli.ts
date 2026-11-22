// `curve receipt`: recheck receipts that `curve <file> --receipt` wrote,
// or turn them into JUnit XML.

import { writeFileSync } from "node:fs";
import { junit, junitClean } from "./proof_junit.ts";
import { SUCCESS, verifyReceipt } from "./proof_receipt.ts";

export const RECEIPT_USAGE = `Curve verification receipts

  curve <file.curve> --verdict --receipt <r.json>            kernel-verify, record the evidence
  curve <file.curve> --check-only --receipt <r.json>         checker-only evidence
  curve <file.curve> [--verdict] -o <out.mjs> [--export <name>]... --receipt <r.json>
                                                             build, recording the bytes and exports
  curve receipt verify <r.json>...                           recheck bytes and toolchain; exit 1 unless
                                                             each records success and still matches
  curve receipt junit <r.json>... [-o <report.xml>]          JUnit XML: verified laws pass, checker-only
                                                             laws skip; exit 1 on a failure or error

Receipt results: verified, checker_only, rejected, skipped, infrastructure_failure.
`;

function say(fd: 1 | 2, text: string): void {
  (fd === 1 ? process.stdout : process.stderr).write(text);
}

export function receiptCli(args: readonly string[]): number {
  const [command, ...rest] = args;
  if (command === "verify" && rest.length > 0) {
    let ok = true;
    for (const path of rest) {
      try {
        const { receipt, problems } = verifyReceipt(path);
        const good = problems.length === 0 && SUCCESS.has(receipt.result);
        ok &&= good;
        say(good ? 1 : 2, `${good ? "OK" : "FAIL"} ${path}: ${receipt.result}`
          + problems.map((p) => `\n  ${p.kind}: ${p.path}`).join("") + "\n");
      } catch (e) {
        ok = false;
        say(2, `FAIL ${path}: ${e instanceof Error ? e.message : String(e)}\n`);
      }
    }
    return ok ? 0 : 1;
  }
  if (command === "junit") {
    const at = rest.indexOf("-o");
    const out = at < 0 ? undefined : rest[at + 1];
    const paths = at < 0 ? rest : rest.filter((_, i) => i !== at && i !== at + 1);
    if (paths.length === 0 || (at >= 0 && out === undefined)) {
      say(2, RECEIPT_USAGE);
      return 1;
    }
    const xml = junit(paths);
    if (out === undefined) say(1, xml);
    else writeFileSync(out, xml);
    return junitClean(xml) ? 0 : 1;
  }
  say(command === "--help" || command === undefined ? 1 : 2, RECEIPT_USAGE);
  return command === "--help" || command === undefined ? 0 : 1;
}
