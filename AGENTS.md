# AGENTS

Curve is a dependently typed, affine language that checks in one linear
bidirectional pass and runs massively parallel on CPU threads and GPUs.
curve2/curve.ts is the upstream human-written parser, theory and checker.
Preserve its semantics when updating Curve integration and file identity.
curve2/comp.ts is the compiler and includes the C runtime (host and
device from one source), the C emitter and the JS emitter; base.curve is the
prelude; main.ts is the CLI. Every test is a Curve file that ends in the `#|`
lines its run must print, and the gates run on the mini cluster.

    curve2/curve.ts       the language: parser, theory, checker
    curve2/comp.ts       the compiler and the runtimes (C, Metal, CUDA, JS)
    curve2/main.ts       the CLI; imported, the .curve loader for bun and node
    curve2/safe.ts       --verdict and -o <out>.curvett: the elaborator from a
                        checked book to CurveTT text
    curve2/curvett.lean   CurveTT: the kernel, its claims (no checked def has type
                        Empty, live code halts) and their proofs; --verdict
                        builds its CLI once, with Lean v4.34.0
    curve2/base.curve     the base library
    curve2/effs/         IO effect sources per backend; related effects may share
    curve2/pack/         package.json, tsconfig.json, bun.lock
    curve2/docs/         the papers' Typst sources, the film, gen_pins.ts (the
                        record pins on this Mac), gen_charts.ts (the landing
                        page's and the film's numbers), gen_gifs.ts (the images)
    bench/runtime/      one dir per bench: main.curve and its twins (C, TS, Lean)
    bench/checker/      one dir per bench: main.curve and its rivals
    bench/*/_pin_/      the pins, one file per hardware: apple_m4 the gate's,
                        apple_m4_max the record
    tests/<ns>/         the tests by namespace, with their foreign .c/.js
    gates/test.ts       every test, one shard per live mini, PASS: n / n
    gates/perf.ts       the benches on 48 minis against the pins (--pin writes
                        the medians of three runs)
    gates/repo.ts       the allow list of files and the permanent ttok caps
                        (curve.ts 48k, comp.ts 66k, main.ts 16k, curvett.lean
                        64k, README 4k, GUIDE 8k); only Taelin changes them
    gates/ping.ts       the installer, the compiled curve, its daily version
                        check and a release, on a localhost hub
    gates/safe.ts       curve2's verdict against CurveTT's, per file, on the
                        minis: `tests` or `hub` (a Curve Hub store, $SAFE_HUB)
    gates/_run.ts       the four gates with --gate
    demos/              one dir per demo
    guide/              GUIDE.md
    paper/              upstream BendTT.pdf and BendRT.pdf
    media/              the film and the charts
    .github/            ISSUE_TEMPLATE/bug.yml, the bug report form, and
                        config.yml, for Curve's GitHub project
    $SITE_REPO          optional registry and release service checkout, used
                        by the hosted ping and chart-generation gates
    optimization/       constraint gate, evidence ledgers, scheduling and DARC adapters

## Curve language and optimization

Use `curve` from this checkout. On Ian's Mac, `curve` and the legacy `bend`
command resolve through `~/.local/bin`. Use the Composite Curve skill and
[HANDOFF.md](HANDOFF.md). On other hosts, resolve the checkout and CLI first.
Run `curve optimize --help` for constrained optimization and use the ledger
to keep feasibility, ranking and method comparison separate.

Curve branches and pull requests belong in `tenpointdata/curve`. Treat the
upstream Bend repository as read-only.

## Handoff policy

Any repository you work in must stay in a state where another agent (Claude, Codex, Gemini, Antigravity, or a human) can pick up the work cold, with no access to this conversation. Two things make that true, and you maintain both:

1. **`HANDOFF.md` at the repository root.** The single entry point for whoever comes next. It holds: what the project is and where its pieces live (code, data, services, deploy targets); the current state, under a dated stamp; how to set up, run, test and deploy; the open work, each item linked to its GitHub issue; a **triage** list ranking what to pick up next (lanes for agents, a human, and blocked; one issue per line with its size and what done looks like); known issues and gotchas; recent decisions and why; and this handoff policy itself, in full, so the instruction survives the handoff.
2. **GitHub issues for every open piece of work.** Anything unfinished, deferred, newly discovered, or decided against for now gets an issue with enough context to act on without this conversation: what, why, where in the code, and what done looks like. Close issues when the work lands and reference them from the commit or PR. The open-work list in `HANDOFF.md` points at issues; it never carries work that has no issue.

**When to update:** at the end of any session or turn that changed code, state, configuration, or plans, before the final commit or push. Refresh the current-state stamp, add or close issues, and record decisions made. If a repository has no `HANDOFF.md`, create it and the issues as your first act there. If it has no GitHub remote, say so in `HANDOFF.md` and keep an `## Open work` list there until one exists.

**Fork and merge (the standard form, with Zed Delta's workflow):** Composite keeps hand-offs in one standard form (sections: Handoff policy, What this is, Where things live, Current state, Triage, Set up/run/test/deploy, Open work, Known issues and gotchas, Decisions, Deltas, Updating this document). When you start work in a repository, after `orient`, call the eng-journal MCP tool `fork_handoff` with the working directory, what you set out to do and, when you take a triage item, `claim=#N`: it records your base commit and shows what was merged lately and who else is working there. When you finish, rewrite Current state to what is true now, then call `merge_handoff` with the fork's id, a summary, next steps, decisions and the issues you opened and closed. It writes the `## Deltas` block and a one-line stamp into `HANDOFF.md`, so do not prepend "Previous stamp:" chains or append history to Current state. If the fork left nothing to hand on, call `discard_handoff`. `get_handoff` says what a repository's file lacks against the form. Without those tools, the same commands are `uv run --project ~/Documents/Projects/composite ej handoff check|init|fork|merge|discard` (run from the repository).

**Triage:** when you start, take the top unclaimed item in the agents' lane unless you were given a task, and claim it (`fork_handoff` with `claim=#N`, or `ej handoff fork --claim N`) so no other agent takes it. When you finish, re-rank: drop what you closed, add what you found, move items between lanes when that changed (a human is needed, something blocks it). Keep it short: the next handful, not the whole backlog; the rest stays in Open work.

**Propagation:** every `HANDOFF.md` you create or update contains this policy, so an agent that reads only the repository learns to keep maintaining it. Also mirror it in the repository's `AGENTS.md` (read by Codex, Gemini CLI and others) and have the repository's `CLAUDE.md` import that file with `@AGENTS.md`.
