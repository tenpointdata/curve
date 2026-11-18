import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assess, frontier } from "./evidence.ts";
import { Ledger } from "./ledger.ts";
import { compareMethods, type MethodPlan } from "./method.ts";
import { contractId, digest, type Contract, type Receipt, type Request } from "./model.ts";
import { prioritize, type Proposal } from "./schedule.ts";

const temporary = mkdtempSync(join(tmpdir(), "curve-study-"));
afterAll(() => rmSync(temporary, { recursive: true, force: true }));
const artifact = digest("baseline");
const method = digest("parent-method");
const contract: Contract = {
  schema: "curve.optimization/1", name: "Constraint test",
  search: { representation: "scalar", baseline: artifact, transformations: ["replace scalar"] },
  scenarios: [
    { id: "practice", role: "development", description: "Study condition" },
    { id: "reserved", role: "confirmation", description: "Independent condition" },
  ],
  objectives: [{ id: "cost", unit: "points", direction: "min" }],
  constraints: { confirmed: true, rules: [
    { kind: "bound", id: "response", scenario: "practice", confirmed: true, direction: "max",
      unit: "mm", limit: 2, uncertainty: "required" },
    { kind: "predicate", id: "intact", scenario: "practice", confirmed: true },
    { kind: "predicate", id: "reproduced", scenario: "reserved", confirmed: true },
  ] },
  evaluation: { evaluator: "sim/1", environment: "runtime/1", fidelity: "modeled", inputs: { scope: digest("practice") } },
  budget: [{ id: "attempts", limit: 2, unit: "count" }],
  authority: { sandbox: "simulation", confirmation: true },
};

function request(config = contract, changes: Partial<Request> = {}): Request {
  return {
    id: "baseline", contract: contractId(config), candidate: artifact, method, role: "development",
    question: "What is the cost?", prediction: "Cost is measurable", falsifier: "Evaluation fails",
    allowance: { attempts: 1 }, ...changes,
  };
}

function receipt(req = request(), config = contract, changes: Partial<Receipt> = {}): Receipt {
  return {
    request: req.id, contract: req.contract, candidate: req.candidate, method: req.method,
    role: req.role, ...config.evaluation, evidence: "receipt:" + req.id,
    measurements: { response: { unit: "mm", value: 1.5, uncertainty: 0.5 }, cost: { unit: "points", value: 9 } },
    predicates: { intact: true, reproduced: true }, status: "completed", spent: { attempts: 1 },
    ...changes,
  };
}

test("hard failure outranks unknown, stale and failed jobs cannot rank", () => {
  const req = request();
  expect(assess(contract, req, receipt()).eligible).toBe(true);
  const invalid = receipt(req, contract, {
    measurements: { response: { unit: "cm", value: 0 }, cost: { unit: "points", value: 0 } },
    predicates: { intact: false },
  });
  const mixed = assess(contract, req, invalid);
  expect(mixed.constraints.map(rule => rule.status)).toEqual(["unknown", "fail"]);
  expect([mixed.gate, mixed.eligible, mixed.objectives]).toEqual(["fail", false, null]);
  for (const patches of [{ fidelity: "surrogate" }, { status: "failed" } as const, { inputs: { scope: digest("other") } }]) {
    const decision = assess(contract, req, receipt(req, contract, patches));
    expect([decision.gate, decision.eligible]).toEqual(["unknown", false]);
  }
});

test("unconfirmed inventories, missing uncertainty and missing objectives have distinct outcomes", () => {
  const unconfirmed = { ...contract, constraints: { confirmed: false, rules: [] } };
  expect(assess(unconfirmed, request(unconfirmed), receipt(request(unconfirmed), unconfirmed)).gate)
    .toBe("unknown");
  const unconstrained = { ...unconfirmed, constraints: { confirmed: true, rules: [] } };
  expect(assess(unconstrained, request(unconstrained), receipt(request(unconstrained), unconstrained)).eligible)
    .toBe(true);
  const incomplete = receipt(request(), contract, { measurements: { response: { unit: "mm", value: 1 } } });
  expect(assess(contract, request(), incomplete).gate).toBe("unknown");
  const noObjective = receipt(request(), contract, { measurements: { response: { unit: "mm", value: 1, uncertainty: 0 } } });
  expect(assess(contract, request(), noObjective)).toMatchObject({ gate: "pass", eligible: false, objectives: null });
});

test("Pareto selection cannot retain a cheap unsafe or incomplete candidate", () => {
  const make = (id: string, cost: number, intact: boolean) => {
    const req = request(contract, { id });
    const rec = receipt(req, contract, { predicates: { intact } });
    const current = { ...rec, measurements: { ...rec.measurements, cost: { value: cost, unit: "points" } } };
    return { request: req, receipt: current, decision: assess(contract, req, current) };
  };
  const rows = [make("baseline", 10, true), make("cheaper", 5, true), make("unsafe", 0, false)];
  expect(frontier(contract, rows, "development").map(row => row.request.id)).toEqual(["cheaper"]);
});

test("reservations survive reopening and confirmation requires the frozen method and artifact", () => {
  const path = join(temporary, "resume.sqlite");
  const first = new Ledger(path, contract);
  first.reserve(request());
  first.close();
  const ledger = new Ledger(path);
  try {
    expect(ledger.pending("development")).toEqual([request()]);
    ledger.reserve(request());
    expect(ledger.budget().attempts).toEqual({ spent: 0, pending: 1, remaining: 1 });
    expect(() => ledger.reserve(request(contract, { id: "too-big", allowance: { attempts: 2 } }))).toThrow("budget");
    ledger.record(receipt());
    ledger.record(receipt());
    expect(() => ledger.record(receipt(request(), contract, { evidence: "changed" }))).toThrow("Terminal receipt");
    const holdout = request(contract, { id: "holdout", role: "confirmation", freeze: "chosen" });
    expect(() => ledger.reserve(holdout)).toThrow("frozen");
    ledger.freeze("chosen", artifact, method);
    expect(() => ledger.reserve({ ...holdout, method: digest("other") })).toThrow("frozen");
    ledger.reserve(holdout);
    ledger.record(receipt(holdout));
    expect(ledger.summary("development")).toMatchObject({ evaluated: 1, eligible: 1 });
    expect(ledger.summary("confirmation")).toMatchObject({ evaluated: 1, eligible: 1 });
    expect(ledger.budget().attempts).toEqual({ spent: 2, pending: 0, remaining: 0 });
  } finally {
    ledger.close();
  }
});

test("scheduler prioritizes informative measurements under resource and risk limits", () => {
  const make = (id: string, kind: Proposal["kind"], cost: number, risk: number, information: number): Proposal => ({
    request: request(contract, { id, allowance: { attempts: cost } }), kind, risk, information, benefit: 1,
  });
  const options = [make("expensive", "intervention", 3, 0, 9), make("risky", "control", 1, 5, 9),
    make("measure", "measurement", 1, 0, 4), make("intervene", "intervention", 1, 0, 0)];
  expect(prioritize(contract, options, { attempts: 2 }, "attempts", 1).map(item => item.request.id))
    .toEqual(["measure", "intervene"]);
});

test("method decisions compare pinned methods on matched tasks while keeping retention explicit", () => {
  const heldout = {
    ...contract, name: "Independent task",
    evaluation: { ...contract.evaluation, inputs: { scope: digest("heldout") } },
  };
  const plan: MethodPlan = {
    parent: method, proposed: digest("intervention"), control: digest("simple-control"),
    hypothesis: "Select promising tasks", falsifier: "No improvement against both controls",
    objective: "cost", minimumGain: 1,
    trials: [
      { id: "practice", role: "development", contract: contractId(contract) },
      { id: "holdout", role: "confirmation", contract: contractId(heldout) },
    ],
  };
  function trial(config: Contract, name: string, member: string, cost: number) {
    const path = join(temporary, name + ".sqlite");
    const ledger = new Ledger(path, config);
    try {
      const req = request(config, { method: member });
      ledger.reserve(req);
      const rec = receipt(req, config);
      ledger.record({ ...rec, measurements: { ...rec.measurements, cost: { value: cost, unit: "points" } } });
      return path;
    } finally {
      ledger.close();
    }
  }
  const paths = Object.fromEntries([["practice", contract], ["holdout", heldout]].map(([id, cfg]) => {
    const key = String(id);
    const config = cfg as Contract;
    return [key, {
      parent: trial(config, key + "-parent", plan.parent, 10),
      proposed: trial(config, key + "-proposed", plan.proposed, 8),
      control: trial(config, key + "-control", plan.control, 9),
    }];
  }));
  expect(compareMethods(plan, paths, "development")).toMatchObject({ result: "provisional", retainedMethod: method });
  expect(compareMethods(plan, paths, "confirmation")).toMatchObject({
    result: "confirmation-criterion-met", retainedMethod: method,
  });
  expect(compareMethods({ ...plan, minimumGain: 3 }, paths, "confirmation").result).toBe("rejected");
});
