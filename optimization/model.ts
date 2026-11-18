import { createHash } from "node:crypto";

export type Role = "development" | "confirmation";
export type Direction = "min" | "max";
export type GateStatus = "pass" | "fail" | "unknown";
export type Digests = Readonly<Record<string, string>>;

export interface Resource {
  readonly id: string;
  readonly unit: string;
  readonly limit: number;
}

export interface Objective {
  readonly id: string;
  readonly unit: string;
  readonly direction: Direction;
}

interface BoundBase extends Objective {
  readonly scenario: string;
  readonly limit: number;
  readonly confirmed: boolean;
}

export type Constraint =
  | (BoundBase & { readonly kind: "bound"; readonly uncertainty: "required" | "exact" })
  | {
    readonly kind: "predicate";
    readonly id: string;
    readonly scenario: string;
    readonly confirmed: boolean;
  };

export interface Contract {
  readonly schema: "curve.optimization/1";
  readonly name: string;
  readonly search: {
    readonly representation: string;
    readonly transformations: readonly string[];
    readonly baseline: string;
  };
  readonly scenarios: readonly { readonly id: string; readonly description: string; readonly role: Role }[];
  readonly objectives: readonly Objective[];
  readonly constraints: {
    readonly confirmed: boolean;
    readonly rules: readonly Constraint[];
  };
  readonly evaluation: {
    readonly evaluator: string;
    readonly environment: string;
    readonly inputs: Digests;
    readonly fidelity: string;
  };
  readonly budget: readonly Resource[];
  readonly authority: {
    readonly sandbox: string;
    readonly confirmation: boolean;
  };
}

export interface Request {
  readonly id: string;
  readonly contract: string;
  readonly candidate: string;
  readonly parent?: string;
  readonly method: string;
  readonly role: Role;
  readonly freeze?: string;
  readonly question: string;
  readonly prediction: string;
  readonly falsifier: string;
  readonly allowance: Readonly<Record<string, number>>;
}

export interface Measurement {
  readonly value: number;
  readonly unit: string;
  readonly uncertainty?: number;
}

export interface Receipt {
  readonly request: string;
  readonly contract: string;
  readonly candidate: string;
  readonly method: string;
  readonly role: Role;
  readonly evaluator: string;
  readonly environment: string;
  readonly inputs: Digests;
  readonly fidelity: string;
  readonly evidence: string;
  readonly status: "completed" | "failed" | "interrupted";
  readonly measurements: Readonly<Record<string, Measurement>>;
  readonly predicates: Readonly<Record<string, boolean>>;
  readonly spent: Readonly<Record<string, number>>;
}

export function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonical).join(",") + "]";
  }
  if (typeof value === "object" && value !== null) {
    const fields = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return "{" + fields.map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  }
  throw new Error("Expected finite JSON data");
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function digest(value: unknown): string {
  return sha256(canonical(value));
}

export function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function requireText(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Missing " + field);
  }
}

export function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function unique(values: readonly string[], what: string): void {
  values.forEach(value => requireText(value, what));
  if (new Set(values).size !== values.length) throw new Error("Duplicate " + what);
}

function requireDigests(values: Digests, field: string): void {
  unique(Object.keys(values), field);
  if (!Object.values(values).every(isDigest)) throw new Error("Invalid " + field + " digest");
}

function validMetric(metric: Objective): void {
  requireText(metric.unit, metric.id + " unit");
  if (metric.direction !== "min" && metric.direction !== "max") {
    throw new Error("Invalid direction for " + metric.id);
  }
}

export function contractId(contract: Contract): string {
  if (contract.schema !== "curve.optimization/1") throw new Error("Unsupported contract schema");
  requireText(contract.name, "contract name");
  requireText(contract.search.representation, "search representation");
  if (!isDigest(contract.search.baseline)) throw new Error("Invalid baseline artifact digest");
  if (!contract.search.transformations.length) throw new Error("Declare allowed transformations");
  unique(contract.search.transformations, "permitted transformation");
  unique(contract.scenarios.map(item => item.id), "scenario");
  unique(contract.constraints.rules.map(item => item.id), "constraint");
  unique(contract.objectives.map(item => item.id), "objective");
  unique(contract.budget.map(item => item.id), "resource");
  if (contract.scenarios.length === 0 || contract.objectives.length === 0 || contract.budget.length === 0) {
    throw new Error("Declare scenarios, objectives and a cumulative budget");
  }
  for (const scenario of contract.scenarios) {
    requireText(scenario.description, scenario.id + " description");
    if (!["development", "confirmation"].includes(scenario.role)) {
      throw new Error("Invalid scenario role");
    }
  }
  for (const role of ["development", ...(contract.authority.confirmation ? ["confirmation"] : [])]) {
    const scenarios = contract.scenarios.filter(item => item.role === role);
    if (!scenarios.length) throw new Error("Declare " + role + " scenarios");
    if (contract.constraints.rules.length && scenarios.some(scenario =>
      !contract.constraints.rules.some(rule => rule.scenario === scenario.id))) {
      throw new Error("Scenario without constraints in " + role);
    }
  }
  if (typeof contract.authority.confirmation !== "boolean" ||
      typeof contract.constraints.confirmed !== "boolean") {
    throw new Error("Declare confirmation authority and inventory status");
  }
  for (const rule of contract.constraints.rules) {
    if (!contract.scenarios.some(scenario => scenario.id === rule.scenario)) {
      throw new Error("Unknown scenario for " + rule.id);
    }
    if (typeof rule.confirmed !== "boolean") throw new Error("Missing confirmation for " + rule.id);
    if (rule.kind === "bound") {
      validMetric(rule);
      if (!Number.isFinite(rule.limit) || !["required", "exact"].includes(rule.uncertainty)) {
        throw new Error("Invalid bound for " + rule.id);
      }
    } else if (rule.kind !== "predicate") {
      throw new Error("Unknown constraint kind");
    }
  }
  contract.objectives.forEach(validMetric);
  for (const resource of contract.budget) {
    requireText(resource.unit, resource.id + " unit");
    if (!Number.isSafeInteger(resource.limit) || resource.limit < 0) throw new Error("Invalid budget for " + resource.id);
  }
  requireText(contract.evaluation.evaluator, "evaluator");
  requireText(contract.evaluation.environment, "environment");
  requireText(contract.evaluation.fidelity, "fidelity");
  requireDigests(contract.evaluation.inputs, "evaluator input");
  requireText(contract.authority.sandbox, "authorized sandbox");
  return digest(contract);
}

export function validateResources(resources: Contract["budget"], usage: Request["allowance"]): void {
  if (Object.keys(usage).length !== resources.length ||
      resources.some(resource => !Object.hasOwn(usage, resource.id) || (!Number.isSafeInteger(usage[resource.id]) || usage[resource.id] < 0))) {
    throw new Error("Provide nonnegative integer usage for each budget resource");
  }
}
