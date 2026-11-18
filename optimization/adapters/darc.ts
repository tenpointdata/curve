import { resolve } from "node:path";
import { readArchive } from "./archive.ts";

interface Evaluation {
  readonly gates: Readonly<Record<string, boolean | null>>;
  readonly mass_g: number | null;
  readonly cost_usd: number | null;
  readonly selection_eligible: boolean;
  readonly assumed_contract_passed: boolean;
  readonly violations: readonly string[];
}

interface NativeSummary {
  readonly schema: string;
  readonly contract_sha256: string;
  readonly scope: string;
  readonly status: string;
  readonly physical_qualification: string;
  readonly evaluated: number;
  readonly selection_eligible: boolean;
  readonly refinement_passed?: boolean;
  readonly records: readonly {
    readonly number: number;
    readonly status: string;
    readonly contract_sha256: string;
    readonly parameter_sha256: string;
    readonly selection_eligible: boolean;
    readonly evaluation?: Evaluation;
  }[];
}

interface FrameArchive {
  readonly summary: NativeSummary;
  readonly summaryHash: string;
  readonly searchHash: string;
  readonly gates: readonly string[];
  readonly receipts: Readonly<Record<string, string>>;
}

export function inspectDarc(directory: string) {
  const path = resolve(directory, "summary.json");
  const { summary, summaryHash, searchHash, gates, receipts } = readArchive<FrameArchive>("frame", directory);
  if (!Array.isArray(gates) || gates.length === 0) {
    throw new Error("DARC search contract is missing its gate inventory");
  }
  const candidates = summary.records.map(row => {
    const measured = row.evaluation;
    const failed = gates.filter(gate => measured?.gates?.[gate] === false);
    const missing = gates.filter(gate => typeof measured?.gates?.[gate] !== "boolean");
    const folder = String(row.number).padStart(6, "0");
    return {
      evidence: resolve(directory, "search", "candidates", folder, "receipt.json"),
      receiptSha256: receipts[row.number],
      number: row.number, artifact: row.parameter_sha256, status: row.status,
      assumedContractPassed: measured?.assumed_contract_passed ?? false,
      eligibleInSource: row.selection_eligible && measured?.selection_eligible === true,
      failed, missing, reasons: measured?.violations ?? [],
      measuredMassG: measured?.mass_g ?? null, modeledCostUsd: measured?.cost_usd ?? null,
    };
  });
  return {
    evidence: path, sha256: summaryHash, searchContractSha256: searchHash, scope: summary.scope,
    nativeContract: summary.contract_sha256, status: summary.status, evaluated: summary.evaluated,
    selectionEligibleInSource: summary.selection_eligible, refinementPassed: summary.refinement_passed ?? null,
    physicalQualification: summary.physical_qualification, candidates,
  };
}
