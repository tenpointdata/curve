import { nonnegative, type Contract, type Request } from "./model.ts";

export interface Proposal {
  readonly request: Request;
  readonly kind: "intervention" | "measurement" | "control";
  readonly benefit: number;
  readonly information: number;
  readonly risk: number;
}

export function prioritize(
  contract: Contract,
  proposals: readonly Proposal[],
  remaining: Request["allowance"],
  primaryResource: string,
  maxRisk: number,
): Proposal[] {
  if (!contract.budget.some(resource => resource.id === primaryResource) || !nonnegative(maxRisk)) {
    throw new Error("Declare a budget resource and a finite risk ceiling");
  }
  const scored = proposals.flatMap(proposal => {
    const { request, risk, benefit, information } = proposal;
    const cost = request.allowance[primaryResource];
    if (request.role !== "development" ||
        ![risk, benefit, information, cost].every(nonnegative) || cost <= 0 || risk > maxRisk ||
        contract.budget.some(resource => !nonnegative(request.allowance[resource.id]) ||
          request.allowance[resource.id] > remaining[resource.id])) return [];
    const score = benefit / cost + information / cost;
    if (!Number.isFinite(score)) return [];
    return [{ proposal, score }];
  });
  return scored.sort((a, b) => b.score - a.score || a.proposal.risk - b.proposal.risk ||
    a.proposal.request.id.localeCompare(b.proposal.request.id)).map(row => row.proposal);
}
