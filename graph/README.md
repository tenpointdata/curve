# Ordered graph walks

`walk.curve` holds a breadth-first walk in Curve whose answer order matches a JavaScript `Set` filled by a queue walk. That is the order Roca Insight's migration resolver relies on. `collectDependents` walks forward reachability and `computePermanence` walks reverse ancestry (`server/src/db/migrations/resolve.ts`, copied at `9d591fb794` into `reference.ts`). The fixture keeps the contract general, so other walkers can reuse it.

| File | What it is |
|---|---|
| `walk.curve` | `walk`, over interned U32 ids in CSR arrays, and `walk_str`, over Curve Strings in Base's `Map` and `Set` |
| `walk.ts` | The typed host boundary: interning, CSR layout, root modes, module loading |
| `reference.ts` | Insight's walkers, with registry lookups generalized to an ordered adjacency map |
| `fixtures.ts` | Shaped graphs (repeats, cycles, disconnected, dangling, absent roots), seeded random graphs, the 100,000-edge envelopes, host-id edge cases |
| `walk.test.ts` | Order parity, the membership, uniqueness and completeness checks, host identity, and Insight's own functions when a checkout is present |
| `bench.ts` | Timing, heap and stack measurements under Bun and headless Chromium |

```bash
curve graph/walk.curve --verdict
bun test --preload ./curve2/main.ts ./graph/      # INSIGHT_ROOT overrides ~/Documents/Projects/roca-insight
bun --preload ./curve2/main.ts graph/bench.ts --runs 5 [--json out.json] [--probe]
```

## Contract

The walk answers nodes breadth first, in root order and then edge order. Each node is answered the first time an edge reaches it. Roots are queued but not answered, unless an edge reaches them. In `marked` mode, roots are seen first and never answered, which is the shape of an ancestry walk from one anchor. Repeated edges and repeated roots answer once, and cycles end. A dangling target is answered and expands to nothing. A root the graph never names reaches nothing. The loop counts down a Nat fuel of roots plus edges plus one, which always suffices; `done` reports whether the walk was cut short.

The tests check exact order against `reference.ts` on 14 shapes and 300 seeded random multigraphs, in both modes. They also check the answer set against an independent recursive reachability (completeness), check for no repeats (uniqueness), and check the 100,000-edge chain, fan-out and cyclic cases. With a Roca Insight checkout they compare against the real `collectDependents` order and `computePermanence` blockers on 100 seeded registries.

## Host identity encoding

**Intern ids on the host.** `toCsr` interns ids through a JavaScript `Map`, which compares strings by code unit, as `Set` does. All 24 edge-case ids in `HOST_IDS` keep their identities, including empty, NUL, lone and paired surrogates, U+DC00 sequences and NFC/NFD pairs.

Passing ids to Curve as Strings is not safe. The JavaScript target spells a non-scalar `Char` as U+DC00 followed by three code units (`char_new` and `char_len` in `curve2/comp.ts`). A host string that holds a lone U+DC00 is therefore read as a different string:

- `"\uDC00"` and `"\uDC00ab"` both decode to one `Char`.
- `"\uDC00\0ࠀ\0"` and `"\uDC00\u0001\0\0"` pack to the same code.

Base's `Map.set` then merges keys that `String.eq` keeps apart, so `Set.has` misses a key it was given. In the walk, three of the fixture ids are answered three times each. `walk.test.ts` pins this defect. Other lone surrogates (U+D800, U+DBFF, U+DE00, U+DFFF) round-trip correctly.

## Measurements

These are from an Apple M-series Mac, 2026-11-22, Bun 1.3.12 and Chromium headless shell 159.0.8154.6, taking the median of 5 runs. "csr+intern" includes interning and CSR layout. "csr walk" reuses a prebuilt CSR. Every row returned Insight's exact order.

| case (edges) | Bun insight | Bun csr+intern | Bun csr walk | Bun strings | Chromium insight | Chromium csr+intern | Chromium csr walk | Chromium strings |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 14 shapes (45) | 0.04 ms | 0.15 | 0.08 | 1.0 | <0.1 | 0.2 | <0.1 | 0.4 |
| random (600) | 0.09 | 0.20 | 0.08 | 2.7 | <0.1 | 0.1 | 0.1 | 1.2 |
| random (6,000) | 0.70 | 1.13 | 0.29 | 40 | 0.4 | 0.7 | 0.1 | 14 |
| chain (100,000) | 33 | 23 | 3.7 | 2,499 | 8.6 | 13.7 | 2.8 | 612 |
| fan-out (100,000) | 11 | 16 | 4.3 | 1,249 | **311** | 11.1 | 2.7 | 705 |
| cyclic (100,000) | 12 | 19 | 3.2 | 1,544 | 2.7 | 5.7 | 1.0 | 367 |

- **Memory.** In Chromium (`usedJSHeapSize`, with GC exposed), one 100,000-edge CSR walk grows the heap by 13 to 22 MB before collection. Most of that is short-lived state records, and retaining the answer costs 0.2 to 0.4 MB. Insight's walker grows the heap by 1.4 to 5.8 MB. The String walk grows it by 19 to 56 MB in Chromium and 38 to 79 MB in Bun. Bun's CSR rows read 0.0 MB growth on JSC's `heapSize()`, which does not resolve them.
- **Stack.** `--probe` recurses close to the engine's limit and reports the frames each walk needs beyond Insight's iterative walker on the same graph.
  - CSR walk: 12 to 14 frames under Bun and 14 to 24 under Chromium, flat from 1,000 to 100,000 edges. The portable runtime runs in bounded stack: tail calls compile to loops and other calls to a `$JMP` trampoline.
  - String walk: grows with key length, from 81 to 117 frames under Bun and 48 to 60 under Chromium between the 1,000-edge and 10,000-edge graphs. Base's `Map.bit.go` recurses once per character, so the depth tracks the key length, not the graph size.
  - One of 30 readings was skewed by a JIT tier change during bisection: Bun's 1,000-edge fan-out, which came out at -3,533.
- **Insight's own walker in Chromium.** V8's `Array.prototype.shift` is linear on a large queue, so the 100,000-edge fan-out takes 311 ms against 11 ms in Bun. Insight's walkers run under Bun today. A browser port should not copy the `shift` queue.

## What the measurements justify

- **Required now: none.** The interned CSR walk meets the envelope with Base's arrays and tail recursion. Including interning, it is between 0.7x and 1.6x of Insight's walker time under Bun and avoids V8's `shift` cliff.
- **Runtime: escape host strings at the JavaScript boundary** (open, in HANDOFF triage). Host strings with a lone U+DC00 would be encoded as the packed non-scalar `Char` of 0xDC00, and decoded on the way out. Until then, any Curve `String` that crosses from host code can break identity. A host can avoid the defect by interning ids.
- **Runtime: a JavaScript `Map.bit`** (open, in HANDOFF triage). `Map.bit` has a C intrinsic, but the JavaScript target runs Base's version. That version slices a native string once per character, which makes the String walk 300 to 700 times slower than CSR at 100,000 edges, and its stack grows with key length. It matters only for consumers that keep String keys inside Curve.

## Not covered

- **Cycle diagnostics.** The witness order of `resolveMigrationOrder`'s cycle error is a separate parity obligation. It needs Kahn's frontier with priority and id ordering, plus the sorted `id → [blockers]` lines. It is not a reachability walk and is not modeled here.
- **Laws.** None are stated. Membership, uniqueness and completeness are checked by differential tests, not proven. Stating them is the owner's call in a `LAWS.curve`.
- **Reverse adjacency.** `insightReverse` builds it on the host in Insight's order: sources in node order, then edges in edge order.
