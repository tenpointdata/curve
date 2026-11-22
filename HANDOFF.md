# Curve handoff

**Last updated:** 2026-11-21 21:30 MST, by codex-mcp-client: Added verified ESM emission with explicit export selection in the local Curve branch. Earlier hand-offs are under Deltas and in `ej handoff log`.

## Handoff policy

Any repository you work in must stay in a state where another agent (Claude, Codex, Gemini, Antigravity, or a human) can pick up the work cold, with no access to this conversation. Two things make that true, and you maintain both:

1. **`HANDOFF.md` at the repository root.** The single entry point for whoever comes next. It holds: what the project is and where its pieces live (code, data, services, deploy targets); the current state, under a dated stamp; how to set up, run, test and deploy; the open work, each item linked to its GitHub issue; a **triage** list ranking what to pick up next (lanes for agents, a human, and blocked; one issue per line with its size and what done looks like); known issues and gotchas; recent decisions and why; and this handoff policy itself, in full, so the instruction survives the handoff.
2. **GitHub issues for every open piece of work.** Anything unfinished, deferred, newly discovered, or decided against for now gets an issue with enough context to act on without this conversation: what, why, where in the code, and what done looks like. Close issues when the work lands and reference them from the commit or PR. The open-work list in `HANDOFF.md` points at issues; it never carries work that has no issue.

**When to update:** at the end of any session or turn that changed code, state, configuration, or plans, before the final commit or push. Refresh the current-state stamp, add or close issues, and record decisions made. If a repository has no `HANDOFF.md`, create it and the issues as your first act there. If it has no GitHub remote, say so in `HANDOFF.md` and keep an `## Open work` list there until one exists.

**Fork and merge (the standard form, with Zed Delta's workflow):** Composite keeps hand-offs in one standard form (sections: Handoff policy, What this is, Where things live, Current state, Triage, Set up/run/test/deploy, Open work, Known issues and gotchas, Decisions, Deltas, Updating this document). When you start work in a repository, after `orient`, call the eng-journal MCP tool `fork_handoff` with the working directory, what you set out to do and, when you take a triage item, `claim=#N`: it records your base commit and shows what was merged lately and who else is working there. When you finish, rewrite Current state to what is true now, then call `merge_handoff` with the fork's id, a summary, next steps, decisions and the issues you opened and closed. It writes the `## Deltas` block and a one-line stamp into `HANDOFF.md`, so do not prepend "Previous stamp:" chains or append history to Current state. If the fork left nothing to hand on, call `discard_handoff`. `get_handoff` says what a repository's file lacks against the form. Without those tools, the same commands are `uv run --project ~/Documents/Projects/composite ej handoff check|init|fork|merge|discard` (run from the repository).

**Triage:** when you start, take the top unclaimed item in the agents' lane unless you were given a task, and claim it (`fork_handoff` with `claim=#N`, or `ej handoff fork --claim N`) so no other agent takes it. When you finish, re-rank: drop what you closed, add what you found, move items between lanes when that changed (a human is needed, something blocks it). Keep it short: the next handful, not the whole backlog; the rest stays in Open work.

**Propagation:** every `HANDOFF.md` you create or update contains this policy, so an agent that reads only the repository learns to keep maintaining it. Also mirror it in the repository's `AGENTS.md` (read by Codex, Gemini CLI and others) and have the repository's `CLAUDE.md` import that file with `@AGENTS.md`.

## What this is

Curve is Ten Point Data's fork of Bend 2, a dependently typed language for proofs and parallel programs. It is also the host for an evidence-driven optimization workflow from the Ten Point Data whitepaper.

## Where things live

- `curve2/` contains the compiler, base library, emitters, CLI and CurveTT kernel.
- `tools/`, `guide/`, `demos/` and `tests/` contain the editor tools, reference and verification programs.
- `optimization/` contains the whitepaper contracts, Curve gate laws, SQLite ledger, experiment scheduling, method comparison and read-only DARC archive adapters.
- `web/` contains HTTP contracts, Bun server integration, JSX lowering and the React adapter. `demos/web_http/` and `demos/web_react/` exercise their public entry points.
- `paper/`, `media/upstream/`, `evals/` and the inherited changelog preserve upstream source material. Engineering-study receipts and artifacts live in their original run directories.

## Current state

2026-11-21. Main is `7327675e` after [PR #8](https://github.com/tenpointdata/curve/pull/8). The local verified-module candidate lets `--verdict -o module.mjs` check and emit the same book. Repeatable `--export` selects the reachable public definitions. CLI regressions passed with CurveTT and the test double. Insight's event-form proof entry emitted four functions in 9,166 bytes. Its 15 laws and targeted Bun and Vite parity checks passed locally under [roca-insight#6233](https://github.com/tenpointdata/roca-insight/issues/6233).

2026-11-18. React and outbound HTTPS PR [#4](https://github.com/tenpointdata/curve/pull/4) passed the GitHub repository gate and merged into `tenpointdata/curve` main at `a4706173`. Main includes inbound HTTP and HTTPS, verified outbound HTTPS actions, relative JSX imports and typed conditional JSX rendering.

2026-11-20. The release integration includes the keyed React and binary streaming commit `699a1865`. It adds checked, keyed `.map()` lowering for scalar and record array props, plus a prop bridge for ordinary JavaScript data. The streaming handler receives request metadata and reads or writes binary chunks under host backpressure. It distinguishes clean completion, a failed body and a peer disconnect.

All 26 web and optimization tests passed on Bun 1.4.0. The source-installed CLI transferred a binary response chunk while its client still had an open upload. Loopback tests verified chunk bounds, byte validation and cancellation, and the kernel verified both demo programs. Chrome reversed the React list while retaining the original DOM nodes. Bun 1.3.12 buffered the small upload in the duplex probe and still handled completed binary transfers.

2026-11-18. Cloned `tenpointdata/curve` at upstream base `9c586f09` and migrated the active CLI, source files, package tooling, documentation and installation to Curve. The Mac's `curve` and compatibility `bend` launchers resolve to the checkout.

The whitepaper workflow runs through `curve optimize`. Verified the repository gate, 136 linter checks, 37 formatter checks, 9 proof-cache checks, 6 optimization checks, the gate's Curve proofs, a native program, mixed legacy/current imports and source installation. The optimization gate also passed the independent CurveTT verdict with Lean 4.34.0. TypeScript reported only the same three checker diagnostics reproduced at the upstream base. The cluster and hosted release gates are pending.

Composite manages the shared Curve policy and skill. The Mac's `curve` and `bend` launchers use the primary checkout, and the local harness environments resolve both names. Composite local-release build `a0fdf5e46ddd47e9` passed 151 tests and deployed as `d8b5cc3c21f54885` from `e648eb94` before this integration. That checkout and the packaged release need the newer source to expose the web features.

The earlier 20-second cache test timeout was insufficient on a busy build host. The cache suite uses a two-minute per-case limit and passed all nine cases there.

The synthetic truss replay recovered 80 decisions. The best feasible mass was 2.391350647 g among 33 passing designs, and the 47 failed designs received no ranking. Replay was idempotent, and a tampered receipt was rejected before import. Provisional frame summaries are verified against their own receipts and search contract and reported separately. Their qualification remains unestablished.

## Triage

### Agents

- Qualify stack-safe non-tail recursion in JS modules. A 20,000-binding Insight fold overflowed in Bun; the product bounds individual calls. Done when a 100,000-item fold agrees with its iterative oracle in Bun and a browser, with existing closure and tail-call coverage passing.
- Generate typed host declarations for selected Curve exports. Done when a Bun and Vite consumer typechecks against the exported signatures and constructor shapes from the same build.
- Expand JSX beyond scalar-field records and single-element list items. Done when the added prop and child forms have checked lowering and verified browser behavior.
- Add streaming outbound HTTPS. Done when approved origins and TLS trust apply to bounded response streams and client cancellation reaches the upstream connection.
- Add a live native evaluator adapter. Small integration after the evaluator's retry semantics are pinned. Done when an interrupted bounded run resumes from exact pending request and result identities without duplicate work or unaccounted spend.
- Run independent verification and release checks. Medium. Done when authorized target environments pass their applicable release checks.

### Human

- GitHub Issues is disabled on the public remote, which rejected both follow-up filings with HTTP 410. Enable it if issues should be maintained there.

### Blocked

- Hosted ping requires a configured Curve registry and release service. Cluster gates require an authorized runner.

## Set up/run/test/deploy

- Install Bun. Run `bun curve2/main.ts guide` or `sh scripts/build.sh <install-directory>`, then use the resulting `bin/curve`. Python 3 is required for DARC archive commands. Native code generation uses Clang.
- Run `curve optimization/gate.curve --check-only`, `bun test --preload ./curve2/main.ts optimization/optimization.test.ts` and `bun gates/repo.ts` with the pinned tokenizer. For the independent gate check, install Lean 4.34.0 and run `curve optimization/gate.curve --verdict`.
- Run `bun test tools/curve-lint` and `bun test tools/curve-cache/src/cache.test.ts` in separate processes from the optimizer. The linter patches Curve as Bun loads it, while the optimizer preloads the standard Curve loader. Cache integration cases allow two minutes because each runs multiple compiler processes and their runtime varies with load.
- Run `curve web --help` and follow the [web guide](web/README.md). Install the locked web dependencies with `bun install --cwd web --frozen-lockfile`, then run `bun test --preload ./curve2/main.ts web/` using Bun 1.4.0 for the duplex acceptance test.
- Run `curve optimize --help` and follow [the optimization workflow](optimization/README.md). Keep private study inputs and ledgers in the study directories.
- Publish Curve branches and open pull requests only in [tenpointdata/curve](https://github.com/tenpointdata/curve). The Bend parent is a read-only source for this fork.
- Hosted distribution requires a configured Curve service.

## Open work

GitHub rejected issue creation because Issues is disabled. The web follow-ups, native evaluator integration and remaining acceptance checks are recorded in Triage pending an issue tracker.

## Known issues and gotchas

- Curve uses `.curve` for new sources and accepts legacy `.bend` imports. Keep paired LAWS and PROOF extensions aligned.
- The optimizer relies on trusted domain evaluators and the declared fidelity for its decisions. A passing provisional simulation has a separate scope from physical qualification.
- The source installer requires Bun and ignores working-directory Bun configuration and dotenv files. This checkout also retains pre-existing compiler and tooling files above 600 lines. New optimization modules are below that cap.

## Decisions

- Verify the full book before any verified module write, including imports outside the selected JS exports. Keep existing default JS module exports for other consumers.
- Use keyed React fragments to retain DOM identity across list reorders. Run response continuations only when the host pulls a chunk and release the request reader on cancellation.
- Represent outbound requests and continuations as checked Curve actions interpreted by the Bun host. Keep URL authority, trust roots and resource limits in host configuration.
- Use Bun for routing and TLS. Keep Curve responsible for typed application logic and generated view data. React owns interactive state and browser rendering through a small adapter.
- Keep the original published paper titles, license, benchmark records and source history as provenance.
- Use Curve proofs for gate aggregation and eligibility. Keep full-precision numeric checks, canonical receipt parsing and SQLite persistence on the host.
- Reuse archived study contracts and evidence while keeping provisional frame evidence and the synthetic benchmark in separate scopes.
- Use a source install as the verified packaging path. The local Bun standalone compiler produced a Mach-O that macOS rejected even for a minimal program.

## Deltas

<!-- composite:deltas · newest first; Composite rewrites this block on every merge (ej handoff merge / merge_handoff) -->
- **2026-11-21 21:30 MST** · codex-mcp-client · `local-release` at `7327675`, no commits · `h-f8cd33` — Added verified ESM emission with explicit export selection in the local Curve branch. Verified passing and rejected modules, output preservation, existing unverified emission, and generation from Insight's event-form PROOF.curve with CurveTT. **Next:** Qualify compiler distribution for the Insight reliability gate, then investigate stack-safe non-tail JS and generated host declarations. Curve GitHub Issues returned 410; Insight adoption is tracked in roca-insight#6233. **Decided:** Verify the full program including imports before writing selected exports from the same book. Keep existing unverified emit and loader behavior.
- **2026-11-20 15:34 MST** · codex-mcp-client · `main` at `e648eb9`, no commits · `h-fc1881` — Combined the verified keyed JSX and duplex streaming feature with the gate-loader, targeted cache timeout and host proof documentation ahead of a source merge. Verified the current optimization gate through independent Lean 4.34.0. **Next:** Merge the tested replacement after repository CI. Build and deliver exactly the merged source to local-release; shell launchers use the primary checkout. Keep the existing hosted and cluster gates open. **Decided:** Keep optimizer and linter tests in their own Bun processes because curve-lint patches the compiler as Bun loads it. Preserve the verified 20-second timeout for the slow cache test, and verify full-duplex transport on Bun 1.4.0.
- **2026-11-20 08:24 MST** · claude-code · `ej/20261119-115321-750c57` `0d29806`→`9e8323e` (1 commit) · `h-7ec055` — Got the curve local-release delivery past its blocker. Build 9635d4761b874240 failed in the bun test step (16 pass, 38 fail, 2 errors) because the pipeline ran optimization, curve-lint and cache tests in one bun process: curve-lint must patch curve2 before anything loads it, and the optimizer's preload loads it first. Split the suite into three steps (optimization with --preload, curve-lint, cache) by re-registering the pipeline's test steps; added a 20 s timeout to one cache test that takes about 6.5 s. Retried the build (77453dfec2fe4c45, 20261120.152353, 151/151 tests), deployed it to local-release, and verified it. **Decided:** Split the pipeline's bun suite into three commands rather than adding a bunfig preload: the preload loads curve2 before curve-lint can patch it, so the groups cannot share a process. Kept the source changes to one test timeout and changed the pipeline config, not the repo's test layout.
- **2026-11-18 10:56 MST** · codex-mcp-client · `curve-web-next` `5d6a735`→`a470617` (1 commit) · `h-75fdd1` — Merged PR #4 after GitHub CI passed, then implemented keyed JSX array lowering and binary HTTP request and response streaming. Verified true duplex transport and disconnect handling with Bun 1.4.0, and DOM identity after React list reordering in Chrome. **Next:** Track streaming outbound HTTPS and additional React prop and child forms in the handoff while Issues is disabled. **Decided:** Use checked keyed view nodes and a generated prop schema for JavaScript arrays. Drive streaming continuations on host pulls with bounded byte chunks and cancellation. Preserve existing text handlers and make the runtime version boundary for verified duplex behavior explicit.
- **2026-11-18 10:45 MST** · codex-mcp-client · `curve-web-platform` `44ca9c4`→`efdad4f` (1 commit) · `h-09b516` — Merged web platform PR #2 after GitHub CI passed. The continuation adds typed conditional and multi-module JSX lowering and outbound HTTPS actions. Verified the installed CLI, real TLS requests, browser updates, and independent CurveTT checks. **Next:** The React subset still has room for list rendering and richer props. HTTP bodies currently use text. Issues remains disabled on the remote. **Decided:** Represent outbound work as checked actions and continuations, with Bun enforcing per-origin permissions, TLS trust and resource limits. Preserve the root JSX export ABI and existing pure HTTP handlers.
- **2026-11-18 10:41 MST** · codex-mcp-client · `curve-host-setup-review` at `efdad4f`, no commits · `h-7aa7ef` — Reconciled the verified Curve host setup and independent proof check with the published rebrand and web platform handoff for review. **Next:** Live evaluator integration and hosted or cluster acceptance remain in Triage. **Decided:** Base the documentation follow-up on current main so the existing rebrand and web platform history are preserved.
- **2026-11-18 10:36 MST** · codex-mcp-client · `main` at `8bfd0dd`, no commits · `h-ce6e0a` — Merged the verified rebrand PR into tenpointdata/curve main and built the first web platform slice on a local feature branch. Verified typed HTTP routing, HTTPS certificate trust, parser-to-Curve lowering and a real React interaction in Chrome. **Next:** Extend React lowering across modules and add effectful handlers and outbound HTTPS. Follow-ups are tracked in handoff while GitHub Issues is disabled. **Decided:** Use Bun for transport and routing, Curve for checked application logic and view data, and React for browser state and rendering. Keep all publishing in tenpointdata/curve and preserve the primary checkout's concurrent edits.
- _Older hand-offs, a line each; `ej handoff log` has them whole:_
- **2026-11-18 10:36 MST** · codex-mcp-client · `h-a1d3b6` — Installed the Curve checkout launcher and Bend compatibility aliases, retired the old standalone compiler to Trash, and verified the shared Composite skill and agent PATH. **Next:** The live evaluator adapter and hosted or cluster release checks remain in Triage.
- **2026-11-18 10:19 MST** · codex-mcp-client · `h-02543b` — Rebranded the active Bend 2 checkout as Curve and implemented the whitepaper workflow as curve optimize. **Next:** Connect a native evaluator worker and run independent Lean and release acceptance.
<!-- /composite:deltas -->

## Updating this document

Orient and fork at the start, refresh Current state and triage at the end, then merge the delta.
