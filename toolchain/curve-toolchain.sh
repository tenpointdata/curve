#!/bin/sh
# Mirror, install and verify a Curve toolchain named by a manifest.
#
#   curve-toolchain.sh mirror  <manifest> <mirror-dir> [--source <git-dir>] [--platform <p>]...
#   curve-toolchain.sh install <manifest> <mirror-dir> <prefix> [--offline]
#   curve-toolchain.sh verify  <prefix>
#   curve-toolchain.sh platform
#
# Every fixed input is stored in the mirror under its own digest
# (<mirror-dir>/sha256/<hex>), so a cache never renames or rewrites an input.
# install accepts an input only when its bytes match the manifest, and only a
# kernel whose build matches the manifest's digest for the platform.
set -eu

die() { printf 'curve-toolchain: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

sha256() {
  if have sha256sum; then sha256sum "$1" | cut -d' ' -f1
  elif have shasum; then shasum -a 256 "$1" | cut -d' ' -f1
  else die 'needs sha256sum or shasum'; fi
}

platform() {
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) die "unsupported OS $(uname -s)" ;; esac
  case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) die "unsupported CPU $(uname -m)" ;; esac
  printf '%s-%s\n' "$os" "$arch"
}

# field <manifest> <kind> <name> [<platform>] -> the rest of the matching record
record() {
  awk -v k="$2" -v n="$3" -v p="${4-}" '
    $1 == k && $2 == n && (p == "" || $3 == p) { $1 = ""; $2 = ""; if (p != "") $3 = ""; sub(/^ +/, ""); print; found = 1; exit }
    END { if (!found) exit 1 }' "$1" || die "$1 has no '$2 $3${4:+ $4}' record"
}

check_manifest() {
  [ -f "$1" ] || die "no manifest at $1"
  [ "$(head -n 1 "$1")" = 'curve-toolchain 1' ] || die "$1 is not a curve-toolchain 1 manifest"
}

# fetch_input <mirror> <sha256:hex> <url|-> <label> [offline] -> path of the verified input
fetch_input() {
  want=${2#sha256:}
  dest="$1/sha256/$want"
  if [ ! -f "$dest" ]; then
    [ "$3" != - ] || die "$4 ($2) is not in the mirror $1; run mirror with --source"
    [ "${5-}" != offline ] || die "$4 ($2) is not in the mirror $1 and --offline forbids a download"
    have curl || die 'needs curl to fill the mirror'
    mkdir -p "$1/sha256"
    # a partial download resumes on the next mirror run; only verified bytes
    # ever get the digest's name
    part="$dest.part"
    printf 'Downloading %s\n' "$3" >&2
    tries=0
    until curl -fsSL --retry 5 --retry-all-errors -C - -o "$part" "$3"; do
      tries=$((tries + 1))
      [ "$tries" -lt 20 ] || die "could not download $4 from $3; run mirror again to resume"
      sleep 5
    done
    got=$(sha256 "$part")
    [ "$got" = "$want" ] || { rm -f "$part"; die "$4 from $3 has sha256 $got, but the manifest pins $want"; }
    mv "$part" "$dest"
  fi
  got=$(sha256 "$dest")
  [ "$got" = "$want" ] || die "$4 in the mirror ($dest) has sha256 $got, but the manifest pins $want; it was altered or truncated, so remove it and mirror again"
  printf '%s\n' "$dest"
}

cmd_mirror() {
  manifest=$1; mirror=$2; shift 2
  check_manifest "$manifest"
  source_dir=''; platforms=''
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --source) source_dir=$2; shift 2 ;;
      --platform) platforms="$platforms $2"; shift 2 ;;
      *) die "unknown mirror option $1" ;;
    esac
  done
  [ -n "$platforms" ] || platforms=$(platform)
  mkdir -p "$mirror/sha256"
  set -- $(record "$manifest" source curve)
  commit=$1; tree=$3; archive=$5
  if [ -n "$source_dir" ] && [ ! -f "$mirror/sha256/${archive#sha256:}" ]; then
    got_tree=$(git -C "$source_dir" rev-parse "$commit^{tree}") || die "$source_dir does not have Curve commit $commit"
    [ "$got_tree" = "$tree" ] || die "commit $commit has tree $got_tree, but the manifest pins $tree"
    part="$mirror/sha256/curve.part.$$"
    git -C "$source_dir" archive --format=tar "$commit" > "$part"
    got=$(sha256 "$part")
    [ "sha256:$got" = "$archive" ] || { rm -f "$part"; die "git archive of $commit has sha256 $got, but the manifest pins ${archive#sha256:}"; }
    mv "$part" "$mirror/sha256/$got"
  fi
  fetch_input "$mirror" "$archive" - "Curve source $commit" >/dev/null
  for p in $platforms; do
    for tool in bun lean; do
      set -- $(record "$manifest" fetch "$tool" "$p")
      fetch_input "$mirror" "$1" "$2" "$tool for $p" >/dev/null
    done
  done
  printf 'Mirror %s holds the inputs of %s for%s\n' "$mirror" "$manifest" "$platforms"
}

cmd_install() {
  manifest=$1; mirror=$2; prefix=$3; mode=${4-}
  [ -z "$mode" ] || [ "$mode" = --offline ] || die "unknown install option $mode"
  [ "$mode" = --offline ] && mode=offline
  check_manifest "$manifest"
  have tar && have unzip && have zstd || die 'needs tar, unzip and zstd'
  p=$(platform)
  [ ! -e "$prefix" ] || die "$prefix exists; install into a new directory and switch to it when verified"
  stage="$prefix.part.$$"
  trap 'rm -rf "$stage"' EXIT INT TERM
  mkdir -p "$stage/bin" "$stage/libexec" "$stage/work"

  set -- $(record "$manifest" source curve)
  commit=$1; archive=$5
  src=$(fetch_input "$mirror" "$archive" - "Curve source $commit" "$mode")
  mkdir "$stage/work/src"
  tar -xf "$src" -C "$stage/work/src"

  set -- $(record "$manifest" fetch bun "$p")
  zip=$(fetch_input "$mirror" "$1" "$2" "bun for $p" "$mode")
  unzip -q "$zip" -d "$stage/work/bun"
  cp "$stage/work/bun"/bun-*/bun "$stage/bin/bun"
  chmod 755 "$stage/bin/bun"
  want_bun=$(record "$manifest" version bun)
  got_bun=$("$stage/bin/bun" --version)
  [ "$got_bun" = "$want_bun" ] || die "bun reports $got_bun, but the manifest pins $want_bun"

  sh "$stage/work/src/scripts/build.sh" "$stage/curve"
  want_curve=$(record "$manifest" version curve)
  got_curve=$(grep -m 1 '^const VERSION = ' "$stage/curve/curve2/main.ts" | cut -d'"' -f2)
  [ "$got_curve" = "$want_curve" ] || die "Curve source is version $got_curve, but the manifest pins $want_curve"
  want_lean_src=$(record "$manifest" file curvett.lean)
  got=$(sha256 "$stage/curve/curve2/curvett.lean")
  [ "sha256:$got" = "$want_lean_src" ] || die "curvett.lean has sha256 $got, but the manifest pins ${want_lean_src#sha256:}"

  set -- $(record "$manifest" fetch lean "$p")
  lean_archive=$(fetch_input "$mirror" "$1" "$2" "Lean for $p" "$mode")
  mkdir "$stage/work/lean"
  zstd -dc "$lean_archive" | tar -xf - -C "$stage/work/lean"
  lean_bin=$(printf '%s\n' "$stage"/work/lean/lean-*/bin)
  want_lean=$(record "$manifest" version lean)
  "$lean_bin/lean" --version | grep -q "^Lean (version $want_lean," || die "the Lean archive is not Lean $want_lean"
  # the build kernel_bin in curve2/safe.ts makes, with the pinned compiler
  ( cd "$stage/work" && cp "$stage/curve/curve2/curvett.lean" curvett.lean &&
    "$lean_bin/lean" -c curvett.c curvett.lean &&
    "$lean_bin/leanc" -O3 -DNDEBUG curvett.c -o curvett ) || die 'Lean could not build the CurveTT kernel'
  got=$(sha256 "$stage/work/curvett")
  want=$(record "$manifest" built curvett "$p")
  [ "$want" = unpinned ] && die "the manifest pins no kernel for $p; the build has sha256:$got"
  [ "sha256:$got" = "$want" ] || die "the CurveTT kernel built for $p has sha256 $got, but the manifest pins ${want#sha256:}"
  mv "$stage/work/curvett" "$stage/libexec/curvett"
  rm -rf "$stage/work"

  cat > "$stage/bin/curve" <<'LAUNCHER'
#!/bin/sh
# The pinned Curve: its own Bun, sources and CurveTT kernel, checked before each run.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
"$root/bin/curve-toolchain" verify "$root" >/dev/null
CURVETT="$root/libexec/curvett"
export CURVETT
exec "$root/bin/bun" --config=/dev/null --no-env-file "$root/curve/curve2/main.ts" "$@"
LAUNCHER
  chmod 755 "$stage/bin/curve"
  cp "$0" "$stage/bin/curve-toolchain"
  chmod 755 "$stage/bin/curve-toolchain"
  cp "$manifest" "$stage/toolchain.manifest"
  printf '%s\n' "$p" > "$stage/toolchain.platform"
  ( cd "$stage" && find bin curve libexec toolchain.manifest toolchain.platform -type f | LC_ALL=C sort |
    while IFS= read -r f; do printf '%s  %s\n' "$(sha256 "$f")" "$f"; done ) > "$stage/toolchain.sums"
  cmd_verify "$stage" >/dev/null
  mv "$stage" "$prefix"
  trap - EXIT INT TERM
  printf 'Installed %s for %s at %s\n' "$(sha256 "$manifest" | cut -c1-16)" "$p" "$prefix"
}

# verify <prefix>: every installed file has the bytes recorded at install, and
# no file was added
cmd_verify() {
  root=$1
  [ -f "$root/toolchain.sums" ] || die "$root is not a Curve toolchain"
  [ "$(cat "$root/toolchain.platform")" = "$(platform)" ] || die "$root was installed for $(cat "$root/toolchain.platform"), not $(platform)"
  ( cd "$root" && while IFS= read -r line; do
      want=${line%%  *}; f=${line#*  }
      [ -f "$f" ] || die "$root/$f is missing"
      got=$(sha256 "$f")
      [ "$got" = "$want" ] || die "$root/$f has sha256 $got, but the toolchain installed $want; reinstall it"
    done < toolchain.sums
    listed=$(cut -d' ' -f3- toolchain.sums)
    found=$(find bin curve libexec toolchain.manifest toolchain.platform -type f | LC_ALL=C sort)
    [ "$listed" = "$found" ] || die "$root has files the toolchain did not install" )
  printf 'Verified %s\n' "$root"
}

case "${1-}" in
  mirror) [ "$#" -ge 3 ] || die 'usage: mirror <manifest> <mirror-dir> [--source <git-dir>] [--platform <p>]...'; shift; cmd_mirror "$@" ;;
  install) [ "$#" -ge 4 ] && [ "$#" -le 5 ] || die 'usage: install <manifest> <mirror-dir> <prefix> [--offline]'; shift; cmd_install "$@" ;;
  verify) [ "$#" -eq 2 ] || die 'usage: verify <prefix>'; cmd_verify "$2" ;;
  platform) platform ;;
  *) sed -n '2,7s/^# \{0,1\}//p' "$0" >&2; exit 2 ;;
esac
