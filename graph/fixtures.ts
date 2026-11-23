// Synthetic graphs for the ordered walks: small shapes that pin each
// semantic edge (repeats, cycles, disconnected parts, dangling targets,
// absent roots), seeded random graphs, and the 100,000-edge envelopes.

import type { Graph, NodeId } from "./walk";

export type Case = { name: string; adj: Graph; roots: NodeId[] };

const g = (entries: [NodeId, NodeId[]][]): Graph => new Map(entries);

/** Hand-written cases, each named for what it pins. */
export const SHAPES: Case[] = [
  { name: "empty", adj: g([]), roots: [] },
  { name: "absent root", adj: g([["a", ["b"]]]), roots: ["zz"] },
  { name: "repeated edges", adj: g([["a", ["b", "b", "c", "b"]], ["b", ["c", "c"]], ["c", []]]), roots: ["a"] },
  { name: "repeated roots", adj: g([["a", ["b"]], ["b", ["a"]]]), roots: ["a", "a", "b"] },
  { name: "self loop", adj: g([["a", ["a"]]]), roots: ["a"] },
  { name: "two cycle", adj: g([["a", ["b"]], ["b", ["a"]]]), roots: ["a"] },
  { name: "cycle back to root", adj: g([["a", ["b"]], ["b", ["c"]], ["c", ["a", "d"]], ["d", []]]), roots: ["a"] },
  { name: "disconnected", adj: g([["a", ["b"]], ["b", []], ["x", ["y"]], ["y", ["x"]]]), roots: ["a"] },
  { name: "two components", adj: g([["a", ["b"]], ["b", []], ["x", ["y"]], ["y", ["x"]]]), roots: ["x", "a"] },
  { name: "dangling targets", adj: g([["a", ["ghost", "b"]], ["b", ["ghost", "other"]]]), roots: ["a"] },
  { name: "dangling root", adj: g([["a", ["ghost"]]]), roots: ["ghost", "a"] },
  { name: "diamond order", adj: g([["a", ["c", "b"]], ["b", ["d"]], ["c", ["d", "b"]], ["d", []]]), roots: ["a"] },
  { name: "edge order beats node order", adj: g([["r", ["z", "y", "x"]], ["x", ["w"]], ["y", ["w"]], ["z", []]]), roots: ["r"] },
  { name: "host edge ids", adj: g([["", ["\u{1F600}", "\uD83D", "\uDE00"]], ["\uD83D", ["\uDC00", "\uDC00ab"]], ["\uDC00", ["x\uDC00"]], ["x\uDC00", ["x\uDC00y", ""]]]), roots: [""] },
];

/** A deterministic 32-bit generator (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random multigraph with repeats, cycles, dangling targets and absent roots. */
export function randomCase(seed: number, nodes = 24, edges = 60): Case {
  const next = rng(seed);
  const pick = (k: number) => Math.floor(next() * k);
  const id = (i: number) => `n${i}`;
  const adj = new Map<NodeId, NodeId[]>();
  for (let i = 0; i < nodes; i++) adj.set(id(i), []);
  for (let e = 0; e < edges; e++) {
    // One in eight edges targets a node with no entry.
    const to = next() < 0.125 ? `dangling${pick(4)}` : id(pick(nodes));
    adj.get(id(pick(nodes)))!.push(to);
  }
  const roots = Array.from({ length: 1 + pick(3) }, () => (next() < 0.1 ? "absent" : id(pick(nodes))));
  return { name: `random ${seed}`, adj, roots };
}

/** The 100,000-edge envelopes: a chain, a fan-out from one root, and a
 * cycle with chords (every node also points 7 ahead). */
export function largeCases(edges = 100_000): Case[] {
  const id = (i: number) => `m${i}`;
  const chain = new Map<NodeId, NodeId[]>();
  for (let i = 0; i < edges; i++) chain.set(id(i), [id(i + 1)]);
  const fan = new Map<NodeId, NodeId[]>([[id(0), Array.from({ length: edges }, (_, i) => id(i + 1))]]);
  const n = edges / 2;
  const cyc = new Map<NodeId, NodeId[]>();
  for (let i = 0; i < n; i++) cyc.set(id(i), [id((i + 1) % n), id((i + 7) % n)]);
  return [
    { name: "chain", adj: chain, roots: [id(0)] },
    { name: "fan-out", adj: fan, roots: [id(0)] },
    { name: "cyclic", adj: cyc, roots: [id(0)] },
  ];
}

/** Host ids whose JavaScript identities a boundary must keep apart: the
 * empty string, NUL, lone and paired surrogates, and the U+DC00 sequences
 * the JavaScript target uses to pack non-scalar Chars. */
export const HOST_IDS: NodeId[] = [
  "", "\0", "a", "A", "a\0", "�", "\uD800", "\uDBFF", "\uDC00", "\uDFFF",
  "\uD83D", "\uDE00", "\u{1F600}", "\uDE00\uD83D", "\uDC00ab", "\uDC00abc",
  "\uDC00\u0000ࠀ\u0000", "\uDC00\u0001\u0000\u0000", "x\uDC00", "x\uDC00y",
  "é", "é", "migration_0001", "migration_0001 ",
];
