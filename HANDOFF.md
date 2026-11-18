# Curve handoff

**Last updated:** 2026-11-18 10:19 MST, by codex-mcp-client: Rebranded the active Bend 2 checkout as Curve and implemented the whitepaper workflow as curve optimize. Earlier hand-offs are under Deltas and in `ej handoff log`.

## Handoff policy

Any repository you work in must stay in a state where another agent (Claude, Codex, Gemini, Antigravity, or a human) can pick up the work cold, with no access to this conversation. Two things make that true, and you maintain both:

1. **`HANDOFF.md` at the repository root.** The single entry point for whoever comes next. It holds: what the project is and where its pieces live (code, data, services, deploy targets); the current state, under a dated stamp; how to set up, run, test and deploy; the open work, each item linked to its GitHub issue; a **triage** list ranking what to pick up next (lanes for agents, a human, and blocked; one issue per line with its size and what done looks like); known issues and gotchas; recent decisions and why; and this handoff policy itself, in full, so the instruction survives the handoff.
2. **GitHub issues for every open piece of work.** Anything unfinished, deferred, newly discovered, or decided against for now gets an issue with enough context to act on without this conversation: what, why, where in the code, and what done looks like. Close issues when the work lands and reference them from the commit or PR. The open-work list in `HANDOFF.md` points at issues; it never carries work that has no issue.

**When to update:** at the end of any session or turn that changed code, state, configuration, or plans, before the final commit or push. Refresh the current-state stamp, add or close issues, and record decisions made. If a repository has no `HANDOFF.md`, create it and the issues as your first act there. If it has no GitHub remote, say so in `HANDOFF.md` and keep an `## Open work` list there until one exists.

**Fork and merge (the standard form, with Zed Delta's workflow):** Composite keeps hand-offs in one standard form (sections: Handoff policy, What this is, Where things live, Current state, Triage, Set up/run/test/deploy, Open work, Known issues and gotchas, Decisions, Deltas, Updating this document). When you start work in a repository, after `orient`, call the eng-journal MCP tool `fork_handoff` with the working directory, what you set out to do and, when you take a triage item, `claim=#N`: it records your base commit and shows what was merged lately and who else is working there. When you finish, rewrite Current state to what is true now, then call `merge_handoff` with the fork's id, a summary, next steps, decisions and the issues you opened and closed. It writes the `## Deltas

<!-- composite:deltas · newest first; Composite rewrites this block on every merge (ej handoff merge / merge_handoff) -->
- **2026-11-18 10:19 MST** · codex-mcp-client · `main` at `9c586f0`, no commits · `h-02543b` — Rebranded the active Bend 2 checkout as Curve and implemented the whitepaper workflow as curve optimize. Verified legacy/current loading, source installation, native compilation, tool suites, the constraint laws and historical synthetic and provisional frame evidence. **Next:** Connect a native evaluator worker and run independent Lean and release acceptance. GitHub rejected follow-up filings with HTTP 410 because Issues is disabled. **Decided:** Kept upstream papers and benchmark records as provenance. Stored experiment reservations and receipts in SQLite. Kept engineering-study archives in their original folders and did not use provisional frame data to qualify a candidate.
<!-- /composite:deltas -->

## Updating this document

Orient and fork at the start, refresh Current state and triage at the end, then merge the delta.
