# Curve handoff

**Last updated:** 2026-11-20 08:24 MST, by claude-code: Got the curve local-release delivery past its blocker. Earlier hand-offs are under Deltas and in `ej handoff log`.

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
- `paper/`, `media/upstream/`, `evals/` and the inherited changelog preserve upstream source material. Engineering-study receipts and artifacts live in their original run directories.

## Current state

2026-11-18. Cloned `tenpointdata/curve` at upstream base `9c586f09` and migrated the active CLI, source files, package tooling, documentation and installation to Curve. The Mac's `curve` and compatibility `bend` launchers resolve to the checkout.

The whitepaper workflow runs through `curve optimize`. Verified the repository gate, 136 linter checks, 37 formatter checks, 9 proof-cache checks, 6 optimization checks, the gate's Curve proofs, a native program, mixed legacy/current imports and source installation. TypeScript reported only the same three checker diagnostics reproduced at the upstream base. The optimization gate also passed the independent CurveTT verdict using pinned Lean 4.34.0 on the Mac. Cluster and hosted release checks are pending.

The synthetic truss replay recovered 80 decisions. The best feasible mass was 2.391350647 g among 33 passing designs, and the 47 failed designs received no ranking. Replay was idempotent, and a tampered receipt was rejected before import. Provisional frame summaries are verified against their own receipts and search contract and reported separately. Their qualification remains unestablished.

The local-release delivery of `e648eb94` now passes: its `bun` test suite runs in three steps (optimization with its preload, curve-lint, curve-cache), 151 of 151 tests passed, and build `77453dfec2fe4c45` (20261120.152353) is deployed and verified. The failed build `9635d4761b874240` had two causes: the suite ran as one `bun test` process, where curve-lint and the optimizer conflict, and one cache test took 6.5 s against Bun's 5 s default.

Composite owns the shared Curve policy and skill. The Mac's `~/.local/bin/curve` launcher uses the local checkout and both `bend` paths forward to it. The retired standalone installation is recoverable from Trash. The installed Composite MCP server can return the skill, and the local harness launch environments resolve both commands. No remote workers are configured.

## Triage

### Agents

- Add a live native evaluator adapter. Small integration after the evaluator's retry semantics are pinned. Done when an interrupted bounded run resumes from exact pending request and result identities without duplicate work or unaccounted spend.
- Run release checks. Medium. Done when authorized target environments pass their applicable release checks.

### Human

- GitHub Issues is disabled on the public remote, which rejected both follow-up filings with HTTP 410. Enable it if issues should be maintained there.

### Blocked

- Hosted ping requires a configured Curve registry and release service. Cluster gates require an authorized runner.

## Set up/run/test/deploy

- Install Bun. Run `bun curve2/main.ts guide` or `sh scripts/build.sh <install-directory>`, then use the resulting `bin/curve`. Python 3 is required for DARC archive commands. Native code generation uses Clang. Install Lean 4.34.0 for the independent CurveTT check with `curve optimization/gate.curve --verdict`.
- Run `curve optimization/gate.curve --check-only`, `bun test --preload ./curve2/main.ts optimization/optimization.test.ts`, `bun test tools/curve-lint`, `bun test tools/curve-cache/src/cache.test.ts` and `bun gates/repo.ts` with the pinned tokenizer. The local-release pipeline runs those three bun commands as one suite.
- Run `curve optimize --help` and follow [the optimization workflow](optimization/README.md). Keep private study inputs and ledgers in the study directories.
- The source installation is local. Hosted distribution requires its own configured service.

## Open work

GitHub rejected issue creation because Issues is disabled. The native evaluator integration and remaining acceptance checks are recorded in Triage pending an issue tracker.

## Known issues and gotchas

- Curve uses `.curve` for new sources and accepts legacy `.bend` imports. Keep paired LAWS and PROOF extensions aligned.
- The optimizer relies on trusted domain evaluators and the declared fidelity for its decisions. A passing provisional simulation has a separate scope from physical qualification.
- The source installer requires Bun and ignores working-directory Bun configuration and dotenv files. This checkout also retains pre-existing compiler and tooling files above 600 lines. New optimization modules are below that cap.
- Do not run the optimizer and curve-lint tests in one `bun test` process. curve-lint must patch curve2 before anything loads it, and `--preload ./curve2/main.ts` loads it first, so each group needs its own run.
- The cache test "a law whose fill is dropped is a TODO" has a 20 s timeout because it takes about 6.5 s. Other cache tests take up to 7 s on a busy Mac and can time out under load; rerun before treating a timeout as a regression.

## Decisions

- Keep the original published paper titles, license, benchmark records and source history as provenance.
- Use Curve proofs for gate aggregation and eligibility. Keep full-precision numeric checks, canonical receipt parsing and SQLite persistence on the host.
- Reuse archived study contracts and evidence while keeping provisional frame evidence and the synthetic benchmark in separate scopes.
- Use a source install as the verified packaging path. The local Bun standalone compiler produced a Mach-O that macOS rejected even for a minimal program.

## Deltas

<!-- composite:deltas · newest first; Composite rewrites this block on every merge (ej handoff merge / merge_handoff) -->
- **2026-11-20 08:24 MST** · claude-code · `ej/20261119-115321-750c57` `0d29806`→`9e8323e` (1 commit) · `h-7ec055` — Got the curve local-release delivery past its blocker. Build 9635d4761b874240 failed in the bun test step (16 pass, 38 fail, 2 errors) because the pipeline ran optimization, curve-lint and cache tests in one bun process: curve-lint must patch curve2 before anything loads it, and the optimizer's preload loads it first. Split the suite into three steps (optimization with --preload, curve-lint, cache) by re-registering the pipeline's test steps; added a 20 s timeout to one cache test that takes about 6.5 s. Retried the build (77453dfec2fe4c45, 20261120.152353, 151/151 tests), deployed it to local-release, and verified it. **Decided:** Split the pipeline's bun suite into three commands rather than adding a bunfig preload: the preload loads curve2 before curve-lint can patch it, so the groups cannot share a process. Kept the source changes to one test timeout and changed the pipeline config, not the repo's test layout.
- **2026-11-18 10:56 MST** · codex-mcp-client · `curve-web-next` `5d6a735`→`a470617` (1 commit) · `h-75fdd1` — Merged PR #4 after GitHub CI passed, then implemented keyed JSX array lowering and binary HTTP request and response streaming. Verified true duplex transport and disconnect handling with Bun 1.4.0, and DOM identity after React list reordering in Chrome. **Next:** Track streaming outbound HTTPS and additional React prop and child forms in the handoff while Issues is disabled. **Decided:** Use checked keyed view nodes and a generated prop schema for JavaScript arrays. Drive streaming continuations on host pulls with bounded byte chunks and cancellation. Preserve existing text handlers and make the runtime version boundary for verified duplex behavior explicit.
- **2026-11-18 10:45 MST** · codex-mcp-client · `curve-web-platform` `44ca9c4`→`efdad4f` (1 commit) · `h-09b516` — Merged web platform PR #2 after GitHub CI passed. The continuation adds typed conditional and multi-module JSX lowering and outbound HTTPS actions. Verified the installed CLI, real TLS requests, browser updates, and independent CurveTT checks. **Next:** The React subset still has room for list rendering and richer props. HTTP bodies currently use text. Issues remains disabled on the remote. **Decided:** Represent outbound work as checked actions and continuations, with Bun enforcing per-origin permissions, TLS trust and resource limits. Preserve the root JSX export ABI and existing pure HTTP handlers.
- **2026-11-18 10:41 MST** · codex-mcp-client · `curve-host-setup-review` at `efdad4f`, no commits · `h-7aa7ef` — Reconciled the verified Curve host setup and independent proof check with the published rebrand and web platform handoff for review. **Next:** Live evaluator integration and hosted or cluster acceptance remain in Triage. **Decided:** Base the documentation follow-up on current main so the existing rebrand and web platform history are preserved.
- _Older hand-offs, a line each; `ej handoff log` has them whole:_
- **2026-11-18 10:36 MST** · codex-mcp-client · `h-ce6e0a` — Merged the verified rebrand PR into tenpointdata/curve main and built the first web platform slice on a local feature branch. **Next:** Extend React lowering across modules and add effectful handlers and outbound HTTPS.
- **2026-11-18 10:36 MST** · codex-mcp-client · `h-a1d3b6` — Installed the Curve checkout launcher and Bend compatibility aliases, retired the old standalone compiler to Trash, and verified the shared Composite skill and agent PATH. **Next:** The live evaluator adapter and hosted or cluster release checks remain in Triage.
- **2026-11-18 10:19 MST** · codex-mcp-client · `h-02543b` — Rebranded the active Bend 2 checkout as Curve and implemented the whitepaper workflow as curve optimize. **Next:** Connect a native evaluator worker and run independent Lean and release acceptance.
<!-- /composite:deltas -->

## Updating this document

Orient and fork at the start, refresh Current state and triage at the end, then merge the delta.
