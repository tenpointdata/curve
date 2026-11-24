// The typed host boundary of graph/walk.curve's ordered walks. It interns
// host node ids to U32s (a JavaScript Map compares string keys exactly, by
// code unit, so every host equivalence survives), lays the edges out as CSR
// arrays, runs the Curve walk and maps the answer back. The module itself is
// passed in: `import Walk from "./walk.curve"` under the Curve loader, or the
// ES module `curve graph/walk.curve -o walk.mjs` writes, in a browser.

export type NodeId = string;

/** An ordered adjacency: node order is insertion order, edges keep theirs. A
 * target with no entry is a dangling node. */
export type Graph = ReadonlyMap<NodeId, readonly NodeId[]>;

export type CurveList<T> = { $: "Nil" } | { $: "Con"; head: T; tail: CurveList<T> };

export type CurveWalk = {
  $: "Walk";
  off: number[];
  dst: number[];
  seen: number[];
  q: number[];
  head: number;
  tail: number;
};

export type CurveEntry = { $: "Entry"; node: string; targets: CurveList<string> };

export type CurveWalked = { $: "Walked"; done: boolean; order: CurveList<string> };

/** The exports of graph/walk.curve this boundary calls. */
export interface WalkModule {
  walk(off: number[], dst: number[], seen: number[], q: number[],
    roots: CurveList<number>, mark: boolean, fuel: number): CurveWalk;
  walk_str(es: CurveList<CurveEntry>, roots: CurveList<string>, mark: boolean,
    fuel: number): CurveWalked;
}

/** What the walk does with its roots: `forward` queues them unseen, as
 * `collectDependents` does; `marked` sees them first, as an ancestry walk
 * from an anchor does. */
export type RootMode = "forward" | "marked";

export function toCurveList<T>(xs: readonly T[]): CurveList<T> {
  let list: CurveList<T> = { $: "Nil" };
  for (let i = xs.length - 1; i >= 0; i--) list = { $: "Con", head: xs[i], tail: list };
  return list;
}

export function fromCurveList<T>(list: CurveList<T>): T[] {
  const out: T[] = [];
  for (let at = list; at.$ === "Con"; at = at.tail) out.push(at.head);
  return out;
}

/** The smallest power of two holding n slots, as Base's arrays need. */
export function pow2(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/** A graph with interned ids: node i is ids[i]; edges are CSR. */
export type Csr = {
  ids: NodeId[];
  index: Map<NodeId, number>;
  off: number[];
  dst: number[];
  edges: number;
};

/** Intern every node and target in first-appearance order and lay out CSR.
 * Throws past the U32 id range rather than wrapping. */
export function toCsr(adj: Graph, extra: readonly NodeId[] = []): Csr {
  const index = new Map<NodeId, number>();
  const ids: NodeId[] = [];
  const intern = (id: NodeId): number => {
    const known = index.get(id);
    if (known !== undefined) return known;
    ids.push(id);
    index.set(id, ids.length - 1);
    return ids.length - 1;
  };
  for (const id of adj.keys()) intern(id);
  for (const targets of adj.values()) for (const t of targets) intern(t);
  for (const id of extra) intern(id);
  let edges = 0;
  for (const targets of adj.values()) edges += targets.length;
  if (ids.length >= 2 ** 31 || edges >= 2 ** 31) throw new RangeError("graph past the U32 walk range");
  const off = new Array<number>(pow2(ids.length + 1)).fill(edges);
  const dst = new Array<number>(pow2(edges)).fill(0);
  let at = 0;
  for (let u = 0; u < ids.length; u++) {
    off[u] = at;
    for (const t of adj.get(ids[u]) ?? []) dst[at++] = index.get(t)!;
  }
  off[ids.length] = at;
  return { ids, index, off, dst, edges };
}

export type WalkResult = { order: NodeId[]; done: boolean };

/** The ordered walk over interned ids. `csr` may be reused across walks; the
 * walk allocates its own seen and queue arrays. */
export function walkCsr(mod: WalkModule, csr: Csr, roots: readonly NodeId[], mode: RootMode): WalkResult {
  const n = csr.ids.length;
  const rootIds = roots.map((r) => csr.index.get(r));
  // A root the graph never names reaches nothing: drop it before interning.
  const known = rootIds.filter((r): r is number => r !== undefined);
  const seen = new Array<number>(pow2(n)).fill(0);
  const q = new Array<number>(pow2(known.length + n)).fill(0);
  const fuel = known.length + csr.edges + 1;
  const w = mod.walk(csr.off, csr.dst, seen, q, toCurveList(known), mode === "marked", fuel);
  const order: NodeId[] = [];
  for (let i = known.length; i < w.tail; i++) order.push(csr.ids[w.q[i]]);
  return { order, done: w.head === w.tail };
}

export function walkGraph(mod: WalkModule, adj: Graph, roots: readonly NodeId[], mode: RootMode): WalkResult {
  return walkCsr(mod, toCsr(adj), roots, mode);
}

/** The same walk over Curve Strings in Base's Map and Set, no interning.
 * Not equivalence-safe for every host string: see README. */
export function walkStrings(mod: WalkModule, adj: Graph, roots: readonly NodeId[], mode: RootMode): WalkResult {
  const entries: CurveEntry[] = [];
  let edges = 0;
  for (const [node, targets] of adj) {
    entries.push({ $: "Entry", node, targets: toCurveList(targets) });
    edges += targets.length;
  }
  const r = mod.walk_str(toCurveList(entries), toCurveList(roots), mode === "marked", roots.length + edges + 1);
  return { order: fromCurveList(r.order), done: r.done };
}

function isWalkModule(mod: unknown): mod is WalkModule {
  if (typeof mod !== "object" || mod === null) return false;
  return typeof Reflect.get(mod, "walk") === "function" && typeof Reflect.get(mod, "walk_str") === "function";
}

/** Load the walk module from a .curve path (under the Curve loader) or the
 * .mjs `curve graph/walk.curve -o` writes, checking its exports. */
export async function loadWalk(path: string = new URL("./walk.curve", import.meta.url).pathname): Promise<WalkModule> {
  const loaded: { default?: unknown } = await import(path);
  if (!isWalkModule(loaded.default)) throw new TypeError(`${path} does not export walk and walk_str`);
  return loaded.default;
}
