import { Ledger } from "./ledger.ts";
import { digest, isDigest, nonnegative, requireText, type Role } from "./model.ts";

interface Trial {
  readonly id: string;
  readonly role: Role;
  readonly contract: string;
}

export interface MethodPlan {
  readonly parent: string;
  readonly proposed: string;
  readonly control: string;
  readonly hypothesis: string;
  readonly falsifier: string;
  readonly objective: string;
  readonly minimumGain: number;
  readonly trials: readonly Trial[];
}

interface Paths {
  readonly parent: string;
  readonly proposed: string;
  readonly control: string;
}

export function methodPlanId(plan: MethodPlan): string {
  const methods = [plan.parent, plan.proposed, plan.control];
  if (!methods.every(isDigest) || new Set(methods).size !== methods.length) {
    throw new Error("Pin three distinct methods, including a simple control");
  }
  requireText(plan.hypothesis, "method hypothesis");
  requireText(plan.falsifier, "method falsifier");
  requireText(plan.objective, "method comparison objective");
  if (!nonnegative(plan.minimumGain)) throw new Error("Declare a nonnegative minimum gain");
  if (!plan.trials.every(trial => isDigest(trial.contract) &&
      (trial.role === "development" || trial.role === "confirmation")) ||
      new Set(plan.trials.map(trial => trial.id)).size !== plan.trials.length ||
      new Set(plan.trials.map(trial => trial.contract)).size !== plan.trials.length ||
      !plan.trials.some(trial => trial.role === "development")) {
    throw new Error("Declare distinct task IDs/contracts and at least one development task");
  }
  plan.trials.forEach(trial => requireText(trial.id, "trial ID"));
  return digest(plan);
}

function trialResult(path: string, trial: Trial, method: string, objective: string) {
  const ledger = new Ledger(path);
  try {
    const metric = ledger.contract.objectives.find(item => item.id === objective);
    if (!metric || ledger.id !== trial.contract) throw new Error("Matched task contract or objective mismatch");
    const rows = ledger.rows("development");
    const budget = ledger.budget();
    if (!rows.length || rows.some(row => row.request.method !== method) ||
        ledger.pending("development").length || ledger.pending("confirmation").length ||
        ledger.rows("confirmation").length || !rows.some(row => row.request.candidate === ledger.contract.search.baseline) ||
        ledger.contract.budget.some(resource => budget[resource.id].spent > resource.limit)) {
      throw new Error("Trial needs a closed, fixed-method ledger within budget with its baseline evaluated");
    }
    const values = rows.flatMap(row => row.decision.objectives ? [row.decision.objectives[objective]] : []);
    const best = values.reduce<number | null>((current, value) =>
      current === null || (metric.direction === "min" ? value < current : value > current) ? value : current, null);
    return {
      best, eligible: values.length, evaluated: rows.length, budget, direction: metric.direction,
      unit: metric.unit, evidenceScope: digest(ledger.contract.evaluation.inputs),
      evidence: rows.map(row => row.receipt.evidence),
    };
  } finally {
    ledger.close();
  }
}

export function compareMethods(plan: MethodPlan, paths: Readonly<Record<string, Paths>>, role: Role) {
  const planId = methodPlanId(plan);
  const scopes = new Set<string>();
  const trials = plan.trials.filter(trial => role === "confirmation" || trial.role === "development").map(trial => {
    const path = paths[trial.id];
    if (!path) throw new Error("Missing ledgers for trial " + trial.id);
    const parent = trialResult(path.parent, trial, plan.parent, plan.objective);
    const proposed = trialResult(path.proposed, trial, plan.proposed, plan.objective);
    const control = trialResult(path.control, trial, plan.control, plan.objective);
    if (scopes.has(parent.evidenceScope)) throw new Error("Trials reuse the same evaluator input scope");
    scopes.add(parent.evidenceScope);
    const win = (against: typeof parent) => {
      if (proposed.best === null || against.best === null || proposed.eligible < against.eligible) return false;
      const gain = parent.direction === "min" ? against.best - proposed.best : proposed.best - against.best;
      return gain > 0 && gain >= plan.minimumGain;
    };
    return { id: trial.id, role: trial.role, parent, proposed, control, passed: win(parent) && win(control) };
  });
  const passed = trials.every(trial => trial.passed);
  return {
    plan: planId, objective: plan.objective, trials,
    result: !passed ? "rejected" :
      trials.some(trial => trial.role === "confirmation") ? "confirmation-criterion-met" : "provisional",
    retainedMethod: plan.parent,
  };
}
