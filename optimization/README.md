# Curve constrained optimization

The contract and workflow follow Ten Point Data's *AI Enabled Constrained
Optimization*. An agent or heuristic proposes work. A domain evaluator measures
the final artifact and produces a receipt. Curve checks the evidence and records
the decision. An evaluator can be a software test suite, an existing solver, or
a measurement process.

| Contract field | What to declare |
| --- | --- |
| `search` | Representation, permitted transformations and the baseline artifact SHA-256 |
| `scenarios` | Unique scenario IDs, descriptions and development or confirmation roles |
| `objectives` | ID, unit and `min` or `max` direction for each comparable candidate-level measurement |
| `constraints` | An explicit `confirmed` inventory and scenario-specific `bound` or `predicate` rules |
| `evaluation` | Evaluator and environment versions, input SHA-256s and required fidelity |
| `budget` | Named cumulative caps in integer units such as attempts, milliseconds or microdollars |
| `authority` | The permitted sandbox and whether solution confirmation is authorized |

The JSON schema identifier is `curve.optimization/1`. See the
[typed field definitions](model.ts) and [working contract examples](optimization.test.ts).
A bound specifies a unit, limit, direction and uncertainty rule. For `direction:
"max"` the conservative value is measurement plus uncertainty. For `"min"` it
is measurement minus uncertainty. A predicate needs an explicit Boolean from the
evaluator. Use distinct constraint IDs for distinct scenarios. A confirmed
empty inventory is reserved for deliberately unconstrained studies.

Curve's [gate laws](gate.curve) check that failure, missing required evidence and
missing objectives cannot qualify a candidate for ranking. Host-side adapters
still determine measurement provenance, unit validity and uncertainty.
A hard failure takes precedence over unknown outcomes. Complete feasible
candidates with measured objectives enter a Pareto frontier with no implicit
weights. Use objective measurements already aggregated over the required
scenarios by the named evaluator.

## Run a solution loop

1. Run `curve optimize init <ledger.sqlite> <contract.json>`. Save the reported
   contract digest. Evaluate the baseline before claiming improvement.
2. Supply a JSON array of proposals to `curve optimize schedule`. Each proposal
   has a request, a `kind` of `intervention`, `measurement` or `control`, and
   nonnegative `benefit`, `information` and `risk` estimates on comparable
   scales. Curve filters risks, prior request IDs and resource availability,
   then ranks by (benefit + information) per unit of the selected resource.
3. Run `curve optimize reserve <ledger.sqlite> <request.json>` before starting
   the external evaluation. Include the exact candidate and method SHA-256s,
   parent when applicable, the question, prediction, falsifier and allowance
   for every budget resource. Use development for normal experiments.
4. Run `curve optimize record <ledger.sqlite> <receipt.json>` with the
   evaluator's outcome, inputs, fidelity, artifact and method, measurements,
   predicates, evidence reference and actual spend. Failed and interrupted
   attempts still spend budget. Pending reservations survive restarts.
   Reconcile the worker's evidence against the pending request ID before
   launching a retry. A different attempt gets its own ID.
5. Use `report` for baseline, frontier, budget and pending IDs. Use `history`
   for constraint outcomes and evidence links. For independent solution
   confirmation, `freeze` pins an eligible development frontier artifact and
   method. The confirmation request must reference that freeze ID and supply
   results for the reserved scenario role. Keep reserved data with the
   evaluator. Update the contract and open a new ledger after changes to
   limits, workloads or evaluator dependencies.

Curve stores immutable requests and terminal receipts in SQLite. A duplicate
with identical content is idempotent. An overrun is recorded at actual spend
and stops new reservations once a cap is exceeded. The ledger pins the contract
and counts spend across both evidence roles. The caller supplies worker dispatch,
sandboxing and permissions for access to reserved data.

## Compare search methods

Prepare a JSON plan using the [method plan type](method.ts). Pin the exact
retained, proposed and simple control methods, the hypothesis and falsifier,
the objective and minimum gain, and task contracts split by evidence role.
Use `curve optimize freeze-method <plan.json> <pinned-plan.json>` before running
the declared comparison. Each task uses three ledgers with the same contract,
evaluator inputs and resource caps. The proposed method must strictly improve
the chosen best feasible objective over both comparators at the declared
minimum gain, with no reduction in eligible count on any task. Use task-scoped
input fingerprints and scope task independence outside the ledger.

Pass `compare-methods` a JSON object keyed by trial ID. Each value has
`parent`, `proposed` and `control` ledger paths. The default view uses
development tasks. Request `confirmation` after collecting the reserved
trials. The report gives per-task best feasible quality, yield and actual
resource use. A successful comparison leaves method retention explicit.
Deployment and any claim of operational qualification require their own
evidence and authority.

## DARC study

```sh
curve optimize replay-truss /path/to/darc-harness/runs/neural truss.sqlite
curve optimize history truss.sqlite
curve optimize inspect-darc /path/to/darc-harness/runs/provisional-v10-curvature
```

The Python reader verifies the original receipt chain, candidate ancestry,
contract, method identity and attempt count before import. Curve recomputes the
gate from the archived measurements and declared synthetic model. The expected
replay is 80 tried, 33 passing, 47 failing and 2.391350647 g best observed
feasible mass. No solver calls are needed to replay or resume this import.

The provisional frame command verifies the original study summary, candidate
receipts and search-contract fingerprint before reporting the gate inventory. It displays measured mass and modeled cost as diagnostic evidence,
along with source eligibility, failed or missing gates, and qualification
status. It leaves the source archive intact. Use a worker that calls the
existing CAD, mesh, FEA and physical evaluators when running new frame
experiments. Keep those outputs and the ledger outside this repository.

## Verification

```sh
curve optimization/gate.curve --check-only
bun test --preload ./curve2/main.ts optimization/optimization.test.ts
bun test optimization/proof_receipt.test.ts
```

## Verification and build receipts

`--receipt <r.json>` records what one run checked and the exact bytes it
wrote, as a `curve.receipt/1` JSON document ([types](proof_receipt.ts)). It
combines with `--check-only`, `--verdict` and `-o`; `--verdict -o <out>` builds
only after the kernel passes. `--export <name>` (repeatable) selects module
exports that a `.mjs` output must carry. Without `--receipt` the CLI prints and
exits as before.

```sh
curve PROOF.curve --verdict -o laws.mjs --export rank --receipt laws.receipt.json
curve receipt verify laws.receipt.json
curve receipt junit laws.receipt.json -o "$COMPOSITE_TEST_REPORT_DIR/curve.xml"
```

A receipt holds the toolchain identity (Curve version, runtime, a digest of the
compiler, Base, kernel and effect sources, the Lean version and kernel digest),
the entry and imported sources with SHA-256s, the mode, selected exports, each
engine's outcome, the overall result, one result per law and each artifact's
SHA-256, size, kind and module exports. It holds no timestamps, and paths are
relative to the receipt, so the same inputs give the same bytes.

| Result | Meaning | JUnit |
| --- | --- | --- |
| `verified` | the CurveTT kernel independently checked it | pass |
| `checker_only` | curve2's checker accepted it; no independent check ran or completed | skipped |
| `rejected` | the checker, the trust scan or the kernel refused it, or a selected export is missing | failure |
| `skipped` | not evaluated: a law the checker did not reach | skipped |
| `infrastructure_failure` | a tool failed (no kernel, a crash, an emit error), not the proof | error |

Only `verified` and `checker_only` are successes, and only they list
artifacts: a rejected or failed build vouches for no bytes, and the CLI removes
the old receipt before it starts. `curve receipt verify` rehashes the entry,
sources, artifacts and toolchain and exits 1 on any mismatch or unsuccessful
result. `curve receipt junit` writes one testsuite per receipt with a case for
the result, each law, each selected export and each artifact (rehashed), and an
error case for a receipt that is missing. A kernel rejection is not attributed
to individual laws, so they stay `checker_only` while the suite is `rejected`.
A definition outside CurveTT's scope is also `rejected`, as the CLI reports
FAIL. An entry file that cannot be read is an `infrastructure_failure`; a
missing import is a rejection of the program. The receipt path must be its own
`.json` file, and `--receipt` does not apply to page bundles.
