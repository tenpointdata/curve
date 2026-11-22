// The walkers Curve's ordered walk must reproduce, copied from Roca Insight
// at 9d591fb794 (server/src/db/migrations/resolve.ts), with the registry
// lookups generalized to an ordered adjacency map. The loop bodies, the
// queue discipline (`shift`) and the Set insertion order are unchanged.

import type { Graph, NodeId } from "./walk";

/**
 * Forward reachability as `collectDependents` walks it: roots are queued but
 * not answered, and a node is answered the first time an edge reaches it.
 */
export function insightForward(adj: Graph, roots: readonly NodeId[]): NodeId[] {
  const found = new Set<NodeId>();
  const queue = [...roots];
  while (queue.length > 0) {
    for (const next of adj.get(queue.shift()!) ?? []) {
      if (found.has(next)) continue;
      found.add(next);
      queue.push(next);
    }
  }
  return [...found];
}

/**
 * Reverse ancestry as `computePermanence` walks it from one anchor: the
 * anchor is seen before the walk starts, so it is never answered.
 */
export function insightAncestry(deps: Graph, anchor: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const seen = new Set<NodeId>([anchor]);
  const queue = [anchor];
  while (queue.length > 0) {
    for (const dep of deps.get(queue.shift()!) ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      out.push(dep);
      queue.push(dep);
    }
  }
  return out;
}

/**
 * The reversed adjacency `computePermanence` builds: sources in node order,
 * then each source's targets in edge order. Only nodes of `adj` get entries.
 */
export function insightReverse(adj: Graph): Map<NodeId, NodeId[]> {
  const rev = new Map<NodeId, NodeId[]>();
  for (const [src, targets] of adj) {
    for (const dst of targets) {
      const list = rev.get(dst) ?? [];
      list.push(src);
      rev.set(dst, list);
    }
  }
  return rev;
}
