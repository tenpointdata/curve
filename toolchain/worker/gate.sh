#!/bin/sh
# Run a product's Curve proof gate on the clean Linux worker.
#
#   gate.sh <manifest> <mirror-dir> <product-git-dir> <rev> [--offline] [-- <gate command>...]
#
# The product's files at <rev> (scripts/, proofs/, shared/curve/ by default,
# $GATE_PATHS to change) are exported into the container, the toolchain is
# installed there from the mirror, and the gate runs with CURVE_BIN set to the
# pinned launcher. --offline runs the container without a network and the
# mirror read-only, so the gate can only use pre-provisioned inputs.
# The default gate is Insight's: bun scripts/curve-proofs.ts.
set -eu
die() { printf 'gate: %s\n' "$*" >&2; exit 1; }
[ "$#" -ge 4 ] || die 'usage: gate.sh <manifest> <mirror-dir> <product-git-dir> <rev> [--offline] [-- <gate command>...]'
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
manifest=$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")
mirror=$(CDPATH= cd -- "$2" && pwd)
product=$3; rev=$4; shift 4
net=bridge; mount=rw
if [ "${1-}" = --offline ]; then net=none; mount=ro; shift; fi
if [ "${1-}" = -- ]; then shift; else set -- bun scripts/curve-proofs.ts; fi
image=${GATE_IMAGE:-curve-toolchain-worker}
# the image is built once (or pulled into place by the host); a rebuild is
# GATE_REBUILD=1, so an offline host never needs the registry
if [ -n "${GATE_REBUILD-}" ] || ! docker image inspect "$image" >/dev/null 2>&1; then
  docker build -q -t "$image" "$here" >/dev/null || die 'could not build the worker image'
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM
git -C "$product" archive --format=tar "$rev" ${GATE_PATHS:-scripts proofs shared/curve} > "$work/product.tar" \
  || die "could not export $rev from $product"
cp "$here/../curve-toolchain.sh" "$manifest" "$work/"
docker run --rm --network "$net" \
  -v "$mirror:/mirror:$mount" -v "$work:/in:ro" "$image" \
  sh -euc '
    sh /in/curve-toolchain.sh install "/in/$1" /mirror "$HOME/curve" ${2:+--offline}
    mkdir product && tar -xf /in/product.tar -C product && cd product
    shift 2
    PATH="$HOME/curve/bin:$PATH" CURVE_BIN="$HOME/curve/bin/curve" "$@"
  ' gate "$(basename -- "$manifest")" "$([ "$net" = none ] && echo 1)" "$@"
