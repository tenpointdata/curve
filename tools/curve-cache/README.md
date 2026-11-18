# curve-cache

`curve <file.curve> --check-only`, with a proof cache. A def whose check read
nothing that changed since a run where it passed is skipped. The output is
the CLI's, byte for byte, exit code included.

```sh
bun tools/curve-cache/src/cache.ts PROOF.curve
```

```
curve-cache <file.curve> [--cache <file.json>] [--curve <curve2 dir>] [--min-ms <ms>] [--stats]
```

- `--cache` (or `CURVE_CACHE`): the traces, one JSON file. Default:
  `$XDG_CACHE_HOME/curve-cache/traces.json` (`~/.cache/...`). One file serves
  every project: ten files that import the same library share its traces.
  A cache it cannot write is a warning: the verdict stands.
- `--curve` (or `CURVE_DIR`): the curve2 sources to run. Default: this repo's
  `curve2/`.
- `--min-ms`: only a check slower than this keeps a trace (0.2). A cheap
  check runs again faster than its trace would hash.
- `--stats`: how many defs were checked and skipped, on stderr.

## Disclaimer

curve-cache is a development tool, and it may have bugs: a skip is
curve-cache's judgment that nothing a check read has changed, not
Curve's. Use it to iterate fast on a large codebase whose proofs take
long to check. It does not count for a bounty: a submission is judged
by `curve <file.curve> --check-only` (and `--verdict`), with no cache.
Run that before you submit or merge. If the two ever disagree, the CLI
is right; please report it with the files and the cache.

It is not `curve` itself, and Curve stores nothing: the cache is this tool's.
Only `--check-only`: a run or a build needs each def's elaborated body, which
a skipped check does not make. `--verdict` (the kernel) still checks
everything.

## How

While a def is checked, proxies on `book.tlds`, `book.ctrs` and `book.tmps`
record what each name held when the check first touched it. Those three tables are
the only state the checker reads (curve2 holds no other mutable state), so
the check is a function of them and of the def. The trace keeps a hash of
each read, and the names the def's elaborated body refers to. On a later
run, `book_valid` asks at each def's own event whether every read hashes the
same now; if so the def is skipped, and the verdict gets the names it kept,
so a skipped def that calls `@unsafe` code still fails.

A def hashes by its lowered terms, spans dropped (a comment or a blank line
changes nothing); Base's defs hash by name, since no file can redeclare one.
A changed `curve.ts`, `main.ts`, `base.curve` or curve-cache starts the cache
over.

Whether a law is still opaque or already filled when a def reads it is part
of what the read finds. A fill becomes visible in load order, not along
imports, so a file can see the fill of a file it does not import: the trace
sees that like any other read. No rule about who sees which fill is needed,
and caching by file and imports (as a `.olean` does) would be wrong here.

## The seam

curve-cache patches curve2 as Bun loads it, as curve-lint does. Each edit must
match exactly once; if curve2 changed there, it stops with exit 2 (drift).

- `curve.ts`: `book_valid(book, done)` also takes a predicate of the entries
  to skip, and counts TODOs for skipped entries too (a law whose fill a
  later file dropped is a TODO at the law, which may be skipped).
- `main.ts`: `book_read` validates through a replaceable hook; `book_promises` reads the names kept for skipped defs
  (it reads `t.e`, which a skipped check does not make); `book_read`,
  `book_err`, `cli_verdict` and `term_refs` are exported.

It also stops if `Book` gains a field: the traces would not see it.

## Tests

```sh
cd tools/curve-cache && bun test
```

Each case runs a book through curve-cache (warm, then after a change, then
reverted) and through `curve --check-only`, and wants the same output.
