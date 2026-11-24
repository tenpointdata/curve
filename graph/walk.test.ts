// Parity of graph/walk.curve's ordered walks with Roca Insight's walkers.
// Run: bun test --preload ./curve2/main.ts graph/

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { HOST_IDS, SHAPES, largeCases, randomCase, type Case } from "./fixtures";
import { insightAncestry, insightForward, insightReverse } from "./reference";
import { loadWalk, toCsr, walkCsr, walkGraph, walkStrings, type Graph, type NodeId, type RootMode } from "./walk";

const mod = await loadWalk();
const RANDOM = Array.from({ length: 300 }, (_, i) => randomCase(i + 1));
const CASES: Case[] = [...SHAPES, ...RANDOM];

/** Reachability by a different method (recursive DFS) for the set checks. */
function reachable(adj: Graph, roots: readonly NodeId[], mode: RootMode): Set<NodeId> {
  const seen = new Set<NodeId>();
  const visit = (u: NodeId): void => {
    for (const v of adj.get(u) ?? []) {
      if (seen.has(v)) continue;
      seen.add(v);
      visit(v);
    }
  };
  for (const r of roots) visit(r);
  if (mode === "marked") for (const r of roots) seen.delete(r);
  return seen;
}

/** Membership, uniqueness and completeness, independent of order. */
function expectSound(order: NodeId[], adj: Graph, roots: readonly NodeId[], mode: RootMode): void {
  expect(new Set(order).size).toBe(order.length);
  expect(new Set(order)).toEqual(reachable(adj, roots, mode));
}

/** The ancestry graph and anchor for a case: its reversed edges, first root. */
function ancestry(c: Case): { deps: Graph; anchor: NodeId } {
  return { deps: insightReverse(c.adj), anchor: c.roots[0] ?? "absent" };
}

describe("interned CSR walk", () => {
  test.each(CASES.map((c) => [c.name, c] as const))("forward order of %s", (_, c) => {
    const r = walkGraph(mod, c.adj, c.roots, "forward");
    expect(r.done).toBe(true);
    expect(r.order).toEqual(insightForward(c.adj, c.roots));
    expectSound(r.order, c.adj, c.roots, "forward");
  });

  test.each(CASES.map((c) => [c.name, c] as const))("ancestry order of %s", (_, c) => {
    const { deps, anchor } = ancestry(c);
    const r = walkGraph(mod, deps, [anchor], "marked");
    expect(r.done).toBe(true);
    expect(r.order).toEqual(insightAncestry(deps, anchor));
    expectSound(r.order, deps, [anchor], "marked");
  });

  test("one CSR serves many walks", () => {
    const c = randomCase(9001, 64, 200);
    const csr = toCsr(c.adj);
    for (const root of c.adj.keys()) {
      expect(walkCsr(mod, csr, [root], "forward").order).toEqual(insightForward(c.adj, [root]));
    }
  });

  test.each(largeCases().map((c) => [c.name, c] as const))("100,000-edge %s is stack safe and exact", (_, c) => {
    const r = walkGraph(mod, c.adj, c.roots, "forward");
    expect(r.done).toBe(true);
    expect(r.order).toEqual(insightForward(c.adj, c.roots));
  });

  test("fuel short of the bound reports an unfinished walk", () => {
    const c = largeCases(64)[0];
    const csr = toCsr(c.adj);
    const n = csr.ids.length;
    const w = mod.walk(csr.off, csr.dst, new Array<number>(128).fill(0), new Array<number>(128).fill(0),
      { $: "Con", head: 0, tail: { $: "Nil" } }, false, 10);
    expect(n).toBe(65);
    expect(w.head).toBeLessThan(w.tail);
  });
});

describe("host identity encoding", () => {
  const star: Graph = new Map([["root", [...HOST_IDS, ...HOST_IDS]], ...HOST_IDS.map((id) => [id, [id]] as [NodeId, NodeId[]])]);

  test("fixture ids are distinct JavaScript strings", () => {
    expect(new Set(HOST_IDS).size).toBe(HOST_IDS.length);
  });

  test("interning keeps every JavaScript identity", () => {
    const r = walkGraph(mod, star, ["root"], "forward");
    expect(r.order).toEqual(HOST_IDS);
    expect(r.order).toEqual(insightForward(star, ["root"]));
  });

  // The JavaScript target spells a non-scalar Char as U+DC00 and three code
  // units, so a host string holding a lone U+DC00 is not read back as itself:
  // Base's Map.set merges keys that String.eq, which compares host strings,
  // keeps apart, and Set.has then misses a key it was given. The walk loses
  // uniqueness: each id below is answered three times. This pins the defect;
  // when the runtime escapes host strings the expected list becomes empty.
  test("Curve Strings in Base's Set repeat U+DC00 ids (known defect)", () => {
    const r = walkStrings(mod, star, ["root"], "forward");
    expect(new Set(r.order)).toEqual(new Set(HOST_IDS));
    const repeated = [...new Set(r.order.filter((id, i) => r.order.indexOf(id) !== i))];
    expect(repeated).toEqual(["\uDC00ab", "\uDC00\u0001\u0000\u0000", "x\uDC00y"]);
  });

  test("Curve Strings agree on ids without a lone U+DC00", () => {
    for (const c of CASES.filter((c) => !c.name.startsWith("host"))) {
      expect(walkStrings(mod, c.adj, c.roots, "forward").order).toEqual(insightForward(c.adj, c.roots));
      const { deps, anchor } = ancestry(c);
      expect(walkStrings(mod, deps, [anchor], "marked").order).toEqual(insightAncestry(deps, anchor));
    }
  });
});

// The production walkers themselves, when a Roca Insight checkout is present.
const INSIGHT = process.env.INSIGHT_ROOT ?? join(process.env.HOME ?? "", "Documents/Projects/roca-insight");
const RESOLVE = join(INSIGHT, "server/src/db/migrations/resolve.ts");

describe.skipIf(!existsSync(RESOLVE))("Roca Insight migration walkers", async () => {
  type Migration = { id: string; priority: "schema"; dependencies: string[]; reversible: boolean };
  type Resolve = {
    collectDependents(registry: readonly Migration[], roots: readonly string[]): Set<string>;
    computePermanence(registry: readonly Migration[]): Map<string, { permanent: boolean; blockedBy: string[] }>;
  };
  const resolve: Resolve = await import(RESOLVE);

  /** A registry whose dependency edges are a random case's edges reversed,
   * less dangling targets (a registry names every migration). */
  function registry(seed: number): Migration[] {
    const c = randomCase(seed, 20, 50);
    const ids = [...c.adj.keys()].map((id) => `m_${id}`);
    const deps = new Map<string, string[]>(ids.map((id) => [id, []]));
    for (const [src, targets] of c.adj) {
      for (const t of targets) {
        if (!c.adj.has(t) || t === src) continue;
        const list = deps.get(`m_${t}`)!;
        if (!list.includes(`m_${src}`)) list.push(`m_${src}`);
      }
    }
    return ids.map((id, i) => ({ id, priority: "schema", dependencies: deps.get(id)!, reversible: i % 3 !== 0 }));
  }

  /** dependency -> dependents, in registry order, as buildDependents makes it. */
  function dependents(reg: readonly Migration[]): Graph {
    const adj = new Map<NodeId, NodeId[]>(reg.map((m) => [m.id, []]));
    for (const m of reg) for (const d of m.dependencies) adj.get(d)!.push(m.id);
    return adj;
  }

  test("collectDependents order", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const reg = registry(seed);
      const adj = dependents(reg);
      for (const roots of [[reg[0].id], [reg[3].id, reg[1].id], ["m_absent"]]) {
        expect(walkGraph(mod, adj, roots, "forward").order).toEqual([...resolve.collectDependents(reg, roots)]);
      }
    }
  });

  test("computePermanence blockers", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const reg = registry(seed);
      const deps = insightReverse(dependents(reg));
      const csr = toCsr(deps, reg.map((m) => m.id));
      const blockers = new Map<string, string[]>(reg.map((m) => [m.id, []]));
      for (const anchor of reg.filter((m) => !m.reversible)) {
        blockers.get(anchor.id)!.push(anchor.id);
        for (const id of walkCsr(mod, csr, [anchor.id], "marked").order) blockers.get(id)!.push(anchor.id);
      }
      const expected = resolve.computePermanence(reg);
      for (const m of reg) {
        const b = [...new Set(blockers.get(m.id))].sort();
        expect({ permanent: b.length > 0, blockedBy: b }).toEqual(expected.get(m.id)!);
      }
    }
  });
});
