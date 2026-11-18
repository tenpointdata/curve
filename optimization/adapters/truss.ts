import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readArchive } from "./archive.ts";
import { Ledger } from "../ledger.ts";
import { digest, type Constraint, type Contract, type Measurement } from "../model.ts";

const FIDELITY = "synthetic-linear-truss";

interface Archive {
  readonly source: string;
  readonly contract: {
    readonly runtime: unknown;
    readonly physics: {
      readonly loads_N: readonly unknown[];
      readonly stress_limit_MPa: number;
      readonly displacement_limit_mm: number;
      readonly max_relative_residual: number;
    };
    readonly code_sha256: string;
    readonly policy_sha256: string;
    readonly algorithm: string;
    readonly ordering: string;
    readonly budget: number;
  };
  readonly rows: readonly {
    readonly number: number;
    readonly artifact: string;
    readonly parent: string | null;
    readonly evidence: string;
    readonly measurements: Readonly<Record<string, Measurement>>;
    readonly errors: readonly string[];
    readonly fidelity: string | null;
    readonly cases: readonly { case: number; relative_residual: number }[];
  }[];
}

// These are definitive geometry/conditioning rejections in the frozen synthetic adapter.
const invalidTopology = new Set([
  "Loaded interface disconnected", "Disconnected material", "Singular or ill-conditioned structure",
]);

export function replayTruss(directory: string, database: string) {
  const archive = readArchive<Archive>("truss", directory);
  const { physics, budget, runtime, ...versions } = archive.contract;
  const scenarios = [
    { id: "topology", description: "Connectivity and conditioning screen", role: "development" as const },
    ...physics.loads_N.map((load, index) => ({
      id: "case_" + index, description: "Archived synthetic load " + JSON.stringify(load),
      role: "development" as const,
    })),
  ];
  const rules: Constraint[] = [
    { id: "solvable", kind: "predicate", scenario: "topology", confirmed: true },
    ...scenarios.slice(1).flatMap(scenario => [
      { metric: "stress", unit: "MPa", limit: physics.stress_limit_MPa },
      { metric: "displacement", unit: "mm", limit: physics.displacement_limit_mm },
      { metric: "buckling", unit: "ratio", limit: 1 },
      { metric: "equilibrium", unit: "ratio", limit: physics.max_relative_residual },
    ].map(({ metric, unit, limit }): Constraint => ({
      id: scenario.id + "/" + metric, scenario: scenario.id,
      kind: "bound", unit, limit, direction: "max", confirmed: true, uncertainty: "required",
    }))),
  ];
  const contract: Contract = {
    schema: "curve.optimization/1", name: "Whitepaper synthetic truss replay",
    search: { baseline: archive.rows[0].artifact, representation: "Archived member index set",
      transformations: ["Toggle one synthetic member"] },
    scenarios, constraints: { confirmed: true, rules },
    objectives: [
      { id: "mass_g", direction: "min", unit: "g" },
      { id: "cost", direction: "min", unit: "synthetic" },
    ],
    evaluation: {
      evaluator: versions.code_sha256, environment: digest(runtime),
      fidelity: FIDELITY, inputs: { archivedContract: archive.source },
    },
    budget: [{ id: "designs", unit: "unique evaluated designs", limit: budget }],
    authority: { sandbox: "Recorded synthetic benchmark", confirmation: false },
  };
  const ledger = new Ledger(database, contract);
  try {
    const method = digest({ algorithm: versions.algorithm, ordering: versions.ordering, policy: versions.policy_sha256 });
    for (const row of archive.rows) {
      const id = String(row.number).padStart(6, "0");
      const evidence = pathToFileURL(resolve(directory, "receipts", id + ".json")).href + "#sha256=" + row.evidence;
      const knownRejection = row.errors.length > 0 && row.errors.every(error => invalidTopology.has(error));
      const measurements = { ...row.measurements };
      for (const item of row.cases) {
        measurements["case_" + item.case + "/equilibrium"] = {
          value: item.relative_residual, unit: "ratio", uncertainty: 0,
        };
      }
      ledger.reserve({
        id, contract: ledger.id, candidate: row.artifact, ...(row.parent ? { parent: row.parent } : {}),
        method, role: "development", allowance: { designs: 1 },
        question: "Do the archived member changes improve the feasible synthetic tradeoff?",
        prediction: "The recorded proposal ordering can yield a lower-mass or lower-cost member set.",
        falsifier: "The candidate violates a constraint or fails to improve the feasible objectives.",
      });
      ledger.record({
        request: id, contract: ledger.id, candidate: row.artifact, method, role: "development",
        ...contract.evaluation, fidelity: knownRejection ? FIDELITY : row.fidelity ?? "unavailable",
        evidence, measurements,
        predicates: knownRejection ? { solvable: false } : row.errors.length === 0 ? { solvable: true } : {},
        status: row.errors.length === 0 || knownRejection ? "completed" : "failed",
        spent: { designs: 1 },
      });
    }
    return ledger.summary("development");
  } finally {
    ledger.close();
  }
}
