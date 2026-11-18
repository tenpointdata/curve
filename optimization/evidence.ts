import { canonical, nonnegative, type Constraint, type Contract, type GateStatus,
  type Measurement, type Receipt, type Request, type Role } from "./model.ts";

interface NativeGate {
  readonly $: "GatePass" | "GateFail" | "GateUnknown";
}

interface GateModule {
  verdict(hasFailure: boolean, complete: boolean): NativeGate;
  rankable(gate: NativeGate, objectivesComplete: boolean): boolean;
}

// Resolved beside this file, not through curve2: importing curve2 here would
// load it unpatched into any process that also runs curve-lint.
const { default: { verdict, rankable } } = await import(
  new URL("./gate.curve", import.meta.url).href
) as { default: GateModule };

export interface Outcome {
  readonly id: string;
  readonly status: GateStatus;
  readonly reason: string;
}

export interface Decision {
  readonly gate: GateStatus;
  readonly constraints: readonly Outcome[];
  readonly eligible: boolean;
  readonly objectives: Readonly<Record<string, number>> | null;
  readonly reasons: readonly string[];
}

function validMeasurement(measurement: Measurement | undefined, unit: string): measurement is Measurement {
  return measurement !== undefined && measurement !== null &&
    measurement.unit === unit && typeof measurement.value === "number" &&
    Number.isFinite(measurement.value) &&
    (measurement.uncertainty === undefined || nonnegative(measurement.uncertainty));
}

function outcome(rule: Constraint, receipt: Receipt, issue: string | undefined): Outcome {
  const result = (status: GateStatus, reason: string) => ({ id: rule.id, status, reason });
  if (!rule.confirmed) return result("unknown", "requirement unconfirmed");
  if (issue) return result("unknown", issue);
  if (rule.kind === "predicate") {
    const value = receipt.predicates[rule.id];
    if (typeof value !== "boolean") return result("unknown", "predicate result missing");
    return value ? result("pass", "predicate satisfied") : result("fail", "predicate violated");
  }
  const measured = receipt.measurements[rule.id];
  if (!validMeasurement(measured, rule.unit)) {
    return result("unknown", "measurement missing, invalid or in different units");
  }
  if (rule.uncertainty === "required" && measured.uncertainty === undefined) {
    return result("unknown", "uncertainty allowance missing");
  }
  const uncertainty = measured.uncertainty ?? 0;
  const worst = rule.direction === "max" ? measured.value + uncertainty : measured.value - uncertainty;
  if (!Number.isFinite(worst)) return result("unknown", "conservative response overflow");
  const violated = rule.direction === "max" ? worst > rule.limit : worst < rule.limit;
  return violated ? result("fail", "conservative bound violated") : result("pass", "conservative bound met");
}

function bindingIssue(contract: Contract, request: Request, receipt: Receipt): string | undefined {
  if (receipt.request !== request.id || receipt.contract !== request.contract ||
      receipt.candidate !== request.candidate || receipt.method !== request.method ||
      receipt.role !== request.role || receipt.evaluator !== contract.evaluation.evaluator ||
      receipt.environment !== contract.evaluation.environment ||
      canonical(receipt.inputs) !== canonical(contract.evaluation.inputs) ||
      receipt.fidelity !== contract.evaluation.fidelity) return "evidence identity or fidelity mismatch";
  if (receipt.status !== "completed") return "evaluation " + receipt.status;
  if (typeof receipt.evidence !== "string" || !receipt.evidence.trim()) return "evidence reference missing";
}

export function assess(contract: Contract, request: Request, receipt: Receipt): Decision {
  const scenarios = new Set(contract.scenarios.filter(s => s.role === request.role).map(s => s.id));
  const issue = bindingIssue(contract, request, receipt);
  const constraints = contract.constraints.rules.filter(rule => scenarios.has(rule.scenario))
    .map(rule => outcome(rule, receipt, issue));
  const gate = verdict(constraints.some(item => item.status === "fail"),
    !issue && scenarios.size > 0 && contract.constraints.confirmed &&
      constraints.every(item => item.status === "pass"));
  const missing = contract.objectives.filter(item => !validMeasurement(receipt.measurements[item.id], item.unit));
  const eligible = rankable(gate, !issue && missing.length === 0);
  return {
    gate: gate.$ === "GatePass" ? "pass" : gate.$ === "GateFail" ? "fail" : "unknown",
    constraints,
    eligible,
    objectives: eligible
      ? Object.fromEntries(contract.objectives.map(item => [item.id, receipt.measurements[item.id].value]))
      : null,
    reasons: [
      ...(issue ? [issue] : []),
      ...(contract.constraints.confirmed ? [] : ["constraint inventory unconfirmed"]),
      ...constraints.filter(item => item.status !== "pass").map(item => item.id + ": " + item.reason),
      ...missing.map(item => item.id + ": objective unavailable"),
    ],
  };
}

export interface Assessed {
  readonly request: Request;
  readonly receipt: Receipt;
  readonly decision: Decision;
}

export function frontier<T extends Assessed>(contract: Contract, rows: readonly T[], role: Role): T[] {
  const eligible = rows.filter(row => row.request.role === role && row.decision.objectives !== null);
  return eligible.filter(row => !eligible.some(other => {
    const deltas = contract.objectives.map(metric => {
      const a = row.decision.objectives![metric.id];
      const b = other.decision.objectives![metric.id];
      return metric.direction === "min" ? a - b : b - a;
    });
    return deltas.every(delta => delta >= 0) && deltas.some(delta => delta > 0);
  }));
}
