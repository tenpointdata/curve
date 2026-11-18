# Curve

Curve is a dependently typed language for writing laws, checking proofs and
running parallel programs. It is Ten Point Data's fork of Bend 2. Curve also
includes a constrained optimization toolkit for evaluating candidate changes
against explicit requirements and tracking the evidence behind each decision.

## Get started

With Bun installed, run Curve from a checkout on macOS or Linux.

```sh
git clone https://github.com/tenpointdata/curve.git
cd curve
bun curve2/main.ts --version
bun curve2/main.ts guide
bun curve2/main.ts demos/proof_numerics/PROOF.curve --check-only
```

Install the source-based command with `sh scripts/build.sh /path/to/curve-install`.
Add that directory's `bin` to PATH, keeping the rest of the install alongside
it. Native compilation also needs Clang. See the [language guide](guide/GUIDE.md)
for GPU, toolchain and proof-kernel requirements.

```python
import Base

law add_zero:
  for x: Nat
  {Nat.add(x, 0n) == x : Nat}

def add_zero(x):
  match x:
    case 0n:
      {==}
    case 1n+xp:
      %add_zero(xp) : {1n+Nat.add(xp, 0n) == 1n+_ : Nat}
      {==}
```

Use `.curve` for new sources. The loader also accepts inherited `.bend` files
and imports. For a project that pairs a `LAWS` file with `PROOF`, keep both at
the same extension during migration.

## Web applications

Use `curve web serve` to run typed Curve routes over HTTP or HTTPS with Bun.
Use `curve web jsx` to compile supported React components to checked Curve
source, then bundle them with an HTML entry. See the [web guide](web/README.md).

## Constrained optimization

```sh
curve optimize --help
curve optimize replay-truss /path/to/darc-harness/runs/neural truss.sqlite
curve optimize report truss.sqlite
curve optimize history truss.sqlite
```

The optimizer records requirements, artifact and method identities, cumulative
resource use, and evidence. Only candidates with passing hard constraints and
complete objectives enter the Pareto frontier. The method comparison uses
separate matched runs. The DARC readers use Python 3 to verify archived
receipts. For the provisional frame study,
`curve optimize inspect-darc <run-directory>` lists the recorded gate failures
and missing evidence. See the [optimization guide](optimization/README.md) for
the data contract and worker workflow.

## Reference

- [Language guide](guide/GUIDE.md), [effects](guide/EFFECTS.md) and [shaders](guide/SHADERS.md)
- [Base library](curve2/base.curve) and [demos](demos/)
- [Formatter language server](tools/curve-fmt-lsp/), [proof cache](tools/curve-cache/) and [linter](tools/curve-lint/)
- [Issues](https://github.com/tenpointdata/curve/issues)

Curve publishes packages and checks for updates only against explicitly
configured services. Set `CURVE_HUB` for registry operations and
`CURVE_ORIGIN` for login and releases when a service is available.

## Upstream

Curve preserves the history and [Apache 2.0 license](LICENSE) of
[Bend 2](https://github.com/bendlang/bend), created by Victor Taelin and the
Higher Order Company team. The upstream research remains available as
[BendTT](paper/BendTT.pdf) and [BendRT](paper/BendRT.pdf), alongside the
[inherited changelog](CHANGELOG.md).
