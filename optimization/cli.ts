import { readFileSync, writeFileSync } from "node:fs";
import { inspectDarc } from "./adapters/darc.ts";
import { replayTruss } from "./adapters/truss.ts";
import { Ledger } from "./ledger.ts";
import { compareMethods, methodPlanId, type MethodPlan } from "./method.ts";
import { type Contract, type Receipt, type Request, type Role } from "./model.ts";
import { prioritize, type Proposal } from "./schedule.ts";

export const USAGE = `Curve constrained optimization

  curve optimize init <ledger.sqlite> <contract.json>
  curve optimize schedule <ledger.sqlite> <proposals.json> <budget-resource> <max-risk>
  curve optimize reserve <ledger.sqlite> <request.json>
  curve optimize record <ledger.sqlite> <receipt.json>
  curve optimize freeze <ledger.sqlite> <freeze-id> <artifact-sha256> <method-sha256>
  curve optimize report <ledger.sqlite> [development|confirmation]
  curve optimize history <ledger.sqlite> [development|confirmation]
  curve optimize replay-truss <archive-directory> <ledger.sqlite>
  curve optimize inspect-darc <provisional-run-directory>
  curve optimize freeze-method <plan.json> <pinned-plan.json>
  curve optimize compare-methods <pinned-plan.json> <ledger-paths.json> [development|confirmation]
`;

function json<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function role(value?: string): Role {
  if (value === undefined || value === "development") return "development";
  if (value === "confirmation") return value;
  throw new Error("Evidence role must be development or confirmation");
}

function use<T>(path: string, action: (ledger: Ledger) => T, contract?: Contract): T {
  const ledger = new Ledger(path, contract);
  try {
    return action(ledger);
  } finally {
    ledger.close();
  }
}

export function optimize(args: string[]): void {
  const [command, first, second, third, fourth] = args;
  const sizes: Readonly<Record<string, readonly number[]>> = {
    init: [3], schedule: [5], reserve: [3], record: [3], freeze: [5],
    report: [2, 3], history: [2, 3], "replay-truss": [3], "inspect-darc": [2],
    "freeze-method": [3], "compare-methods": [3, 4],
  };
  if (!command || command === "--help") {
    console.log(USAGE.trimEnd());
    return;
  }
  if (!Object.hasOwn(sizes, command) || !sizes[command].includes(args.length)) throw new Error(USAGE.trimEnd());
  let result: unknown;
  switch (command) {
    case "init":
      result = use(first, ledger => ledger.summary("development"), json(second));
      break;
    case "schedule":
      result = use(first, ledger => prioritize(ledger.contract, json<Proposal[]>(second).filter(
        proposal => proposal.request.contract === ledger.id && !ledger.hasRequest(proposal.request.id)),
        Object.fromEntries(Object.entries(ledger.budget()).map(([id, state]) => [id, state.remaining])),
        third, Number(fourth)));
      break;
    case "reserve":
      result = use(first, ledger => {
        const request = json<Request>(second);
        ledger.reserve(request);
        return { request: request.id, budget: ledger.budget() };
      });
      break;
    case "record":
      result = use(first, ledger => {
        const receipt = json<Receipt>(second);
        ledger.record(receipt);
        return ledger.rows(receipt.role).find(row => row.request.id === receipt.request)?.decision;
      });
      break;
    case "freeze":
      result = use(first, ledger => {
        ledger.freeze(second, third, fourth);
        return { freeze: second, candidate: third, method: fourth };
      });
      break;
    case "report":
      result = use(first, ledger => ledger.summary(role(second)));
      break;
    case "history":
      result = use(first, ledger => ledger.rows(role(second)).map(row => ({
        id: row.request.id, candidate: row.request.candidate, method: row.request.method,
        evidence: row.receipt.evidence, ...row.decision,
      })));
      break;
    case "replay-truss":
      result = replayTruss(first, second);
      break;
    case "inspect-darc":
      result = inspectDarc(first);
      break;
    case "freeze-method": {
      const plan = json<MethodPlan>(first);
      const id = methodPlanId(plan);
      writeFileSync(second, JSON.stringify({ id, plan }, null, 2) + "\n", { flag: "wx" });
      result = { plan: id, file: second };
      break;
    }
    case "compare-methods": {
      const pinned = json<{ id: string; plan: MethodPlan }>(first);
      if (methodPlanId(pinned.plan) !== pinned.id) throw new Error("Method plan digest mismatch");
      result = compareMethods(pinned.plan, json(second), role(third));
      break;
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
  try {
    optimize(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
