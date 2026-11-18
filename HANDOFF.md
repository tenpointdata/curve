# Curve handoff

**Last updated:** 2026-11-18 10:41 MST, by codex-mcp-client: Reconciled the verified Curve host setup and independent proof check with the published rebrand and web platform handoff for review. Earlier hand-offs are under Deltas and in `ej handoff log`.

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

2026-11-18. Rebrand PR [#1](https://github.com/tenpointdata/curve/pull/1) merged into `tenpointdata/curve` main at `41be44fb`. Web platform PR [#2](https://github.com/tenpointdata/curve/pull/2) merged at `efdad4f0`. It adds Bun-backed HTTP and HTTPS serving, typed Curve request handlers, and declarative JSX/TSX lowering to checked Curve views. React drives browser state and renders the generated views. Verified TLS trust over loopback, the source installation, and mounting and updating the React demo in Chrome. The independent CurveTT kernel checked both example modules. All 13 web and optimization tests, 136 linter tests and 9 cache tests passed.

2026-11-18. Cloned `tenpointdata/curve` at upstream base `9c586f09` and migrated the active CLI, source files, package tooling, documentation and installation to Curve. The Mac's `curve` and compatibility `bend` launchers resolve to the checkout.

The whitepaper workflow runs through `curve optimize`. Verified the repository gate, 136 linter checks, 37 formatter checks, 9 proof-cache checks, 6 optimization checks, the gate's Curve proofs, a native program, mixed legacy/current imports and source installation. TypeScript reported only the same three checker diagnostics reproduced at the upstream base. The optimization gate passed the independent CurveTT verdict on macOS with Lean 4.34.0. Cluster and hosted release checks are pending.

The synthetic truss replay recovered 80 decisions. The best feasible mass was 2.391350647 g among 33 passing designs, and the 47 failed designs received no ranking. Replay was idempotent, and a tampered receipt was rejected before import. Provisional frame summaries are verified against their own receipts and search contract and reported separately. Their qualification remains unestablished.

Composite manages the shared Curve policy and skill. The verified macOS `curve` and `bend` launchers use the Curve checkout. Composite’s local harness environments resolved both commands, and its MCP server returned the shared skill.

## Triage

### Agents

- Extend the JSX frontend to additional modules and control-flow expressions. Done when representative components lower with accurate semantics and located errors for unsupported constructs.
- Add standard outbound HTTPS and an effectful request handler contract. Done when verified TLS fetch and asynchronous handler integration work without exposing transport details to pure handlers.
- Add a live native evaluator adapter. Small integration after the evaluator's retry semantics are pinned. Done when an interrupted bounded run resumes from exact pending request and result identities without duplicate work or unaccounted spend.
- Run release checks. Medium. Done when authorized target environments pass their applicable release checks.

### Human

- GitHub Issues is disabled on the public remote, which rejected both follow-up filings with HTTP 410. Enable it if issues should be maintained there.

### Blocked

- Hosted ping requires a configured Curve registry and release service. Cluster gates require an authorized runner.

## Set up/run/test/deploy

- Install Bun. Run `bun curve2/main.ts guide` or `sh scripts/build.sh <install-directory>`, then use the resulting `bin/curve`. Python 3 is required for DARC archive commands. Native code generation uses Clang. Install Lean 4.34.0 and run `curve optimization/gate.curve --verdict` to reproduce the independent gate check.
- Run `curve optimization/gate.curve --check-only`, `bun test --preload ./curve2/main.ts optimization/optimization.test.ts` and `bun gates/repo.ts` with the pinned tokenizer.
- Run `curve web --help` and follow the [web guide](web/README.md). Use `bun test --preload ./curve2/main.ts web/` for the web suite.
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

- Use Bun for routing and TLS. Keep Curve responsible for typed application logic and generated view data. React owns interactive state and browser rendering through a small adapter.
- Keep the original published paper titles, license, benchmark records and source history as provenance.
- Use Curve proofs for gate aggregation and eligibility. Keep full-precision numeric checks, canonical receipt parsing and SQLite persistence on the host.
- Reuse archived study contracts and evidence while keeping provisional frame evidence and the synthetic benchmark in separate scopes.
- Use a source install as the verified packaging path. The local Bun standalone compiler produced a Mach-O that macOS rejected even for a minimal program.

## Deltas

<!-- composite:deltas · newest first; Composite rewrites this block on every merge (ej handoff merge / merge_handoff) -->
- **2026-11-18 10:41 MST** · codex-mcp-client · `curve-host-setup-review` at `efdad4f`, no commits · `h-7aa7ef` — Reconciled the verified Curve host setup and independent proof check with the published rebrand and web platform handoff for review. **Next:** Live evaluator integration and hosted or cluster acceptance remain in Triage. **Decided:** Base the documentation follow-up on current main so the existing rebrand and web platform history are preserved.
- **2026-11-18 10:36 MST** · codex-mcp-client · `main` at `8bfd0dd`, no commits · `h-ce6e0a` — Merged the verified rebrand PR into tenpointdata/curve main and built the first web platform slice on a local feature branch. Verified typed HTTP routing, HTTPS certificate trust, parser-to-Curve lowering and a real React interaction in Chrome. **Next:** Extend React lowering across modules and add effectful handlers and outbound HTTPS. Follow-ups are tracked in handoff while GitHub Issues is disabled. **Decided:** Use Bun for transport and routing, Curve for checked application logic and view data, and React for browser state and rendering. Keep all publishing in tenpointdata/curve and preserve the primary checkout's concurrent edits.
- **2026-11-18 10:36 MST** · codex-mcp-client · `main` `9c586f0`→`8bfd0dd` (1 commit) · `h-a1d3b6` — Installed the Curve checkout launcher and Bend compatibility aliases, retired the old standalone compiler to Trash, and verified the shared Composite skill and agent PATH. Installed Lean 4.34.0 and passed the independent CurveTT verdict through both command names. **Next:** The live evaluator adapter and hosted or cluster release checks remain in Triage. **Decided:** Use one checkout-backed launcher across local harnesses and one Composite-managed skill. Keep the standalone Bend files in Trash for rollback and resolve Lean by the compiler’s pinned version.
- **2026-11-18 10:19 MST** · codex-mcp-client · `main` at `9c586f0`, no commits · `h-02543b` — Rebranded the active Bend 2 checkout as Curve and implemented the whitepaper workflow as curve optimize. Verified legacy/current loading, source installation, native compilation, tool suites, the constraint laws and historical synthetic and provisional frame evidence. **Next:** Connect a native evaluator worker and run independent Lean and release acceptance. GitHub rejected follow-up filings with HTTP 410 because Issues is disabled. **Decided:** Kept upstream papers and benchmark records as provenance. Stored experiment reservations and receipts in SQLite. Kept engineering-study archives in their original folders and did not use provisional frame data to qualify a candidate.
<!-- /composite:deltas -->

## Updating this document

Orient and fork at the start, refresh Current state and triage at the end, then merge the delta.
