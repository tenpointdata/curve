# Curve toolchain for product CI

A product that commits Curve-emitted modules (Insight's `scripts/curve-proofs.ts`, for example) needs the exact
compiler that produced them and the CurveTT kernel that judged them. This directory pins both and installs them on
release hosts without trusting anything that was not pinned.

    manifests/<name>.toolchain   an immutable manifest: one file per toolchain, never edited
    curve-toolchain.sh           mirror, install and verify (POSIX sh: curl, tar, unzip, zstd, sha256sum or shasum)
    worker/Dockerfile            the clean Linux worker (Debian slim by digest and the four tools above)
    worker/gate.sh               runs a product's proof gate on that worker, optionally with no network

## The manifest

`curve-toolchain 1` on the first line, then one record per line:

| Record | Pins |
| --- | --- |
| `source curve <commit> tree <tree> archive sha256:<d>` | Curve's commit, its git tree, and the bytes of `git archive --format=tar <commit>` |
| `version curve\|bun\|lean <v>` | what each tool must report |
| `file curvett.lean sha256:<d>` | the kernel source the elaborator targets |
| `fetch bun\|lean <platform> sha256:<d> <url>` | the upstream release archive per platform |
| `built curvett <platform> sha256:<d>` | the kernel binary Lean must produce from that source on that platform (`unpinned` until it has been built once) |

Platforms are `darwin-arm64`, `darwin-x64`, `linux-arm64` and `linux-x64` (`curve-toolchain.sh platform`). A product
names the toolchain it was generated with by the manifest's file name and its sha256.

## Use

    M=toolchain/manifests/curve-2.0.40-a9173723-lean-4.34.0.toolchain
    sh toolchain/curve-toolchain.sh mirror  $M <mirror> --source <curve-git-checkout> --platform linux-x64
    sh toolchain/curve-toolchain.sh install $M <mirror> <prefix> --offline
    CURVE_BIN=<prefix>/bin/curve <prefix>/bin/bun scripts/curve-proofs.ts

- **mirror** fills a content-addressed directory: every input is stored as `sha256/<digest>`, so a CI cache, bucket
  or shared volume can hold it without renaming or rewriting anything. Downloads resume; only bytes that match the
  manifest get their digest's name. The Curve source comes from a git checkout that has the commit (the commit
  may not be on a public remote); its tree id and archive digest are both checked.
- **install** refuses a prefix that exists, builds in `<prefix>.part.<pid>` and renames it into place only when every
  input, the reported versions, `curvett.lean` and the built kernel match the manifest. `--offline` forbids any
  download. Lean is used only to build the kernel and is not kept.
- **verify** re-hashes an installed prefix against the sums written at install and rejects missing, changed or
  extra files. `<prefix>/bin/curve` runs it before every command and runs Curve with the pinned Bun and
  `CURVETT=<prefix>/libexec/curvett`, so `--verdict` never builds or reads a kernel from `~/.curve`.

Every failure names the input, the digest it had and the digest the manifest pins.

## The clean Linux worker

    sh toolchain/worker/gate.sh $M <mirror> <insight-checkout> <rev>            # may fill the mirror
    sh toolchain/worker/gate.sh $M <mirror> <insight-checkout> <rev> --offline  # no network, mirror read-only

The worker exports `scripts/`, `proofs/` and `shared/curve/` at `<rev>` (`GATE_PATHS` changes the list), installs
the toolchain in a fresh container and runs `bun scripts/curve-proofs.ts`, which rebuilds every proved module and
compares it byte for byte with the committed one. Pass `-- <command>` to run a different gate.

## Ownership

The Curve repository (`tenpointdata/curve`) owns the manifests, the script and the worker. A product owns which
manifest it pins and the modules it commits. A manifest is the unit of release: it is reviewed like code and,
once merged, never edited.

## Upgrade

1. Pick the Curve commit (it must contain the product's required features) and the Bun and Lean releases.
2. Copy the newest manifest to a new file name, update `source`, `version`, `file` and `fetch` records (the GitHub
   release API lists each asset's `digest`), and set every `built curvett` record to `unpinned`.
3. Run `mirror`, then `install` on each platform. Install stops with the kernel's digest; record it in the
   manifest. Build twice on each platform to confirm the kernel is reproducible before pinning it.
4. In the product, regenerate the modules with the new toolchain (`bun run generate:curve`), run its gate on
   the worker with `--offline`, and change its pin to the new manifest in the same commit as the regenerated
   modules.

## Rollback

Manifests are never deleted or edited, and mirrors are content addressed, so the previous toolchain stays
installable. Point the product back at the previous manifest, revert the regenerated modules in the same commit,
and install the old manifest into a new prefix. Switch hosts between prefixes by changing `CURVE_BIN`; keep the
old prefix until the rollback has passed the gate.

## Limitations

- A kernel digest is pinned only for platforms where it has been built. Install refuses an unpinned platform and
  prints the digest it built, which a reviewer can add in a new manifest.
- Debian packages in the worker image are not pinned; they only fetch and unpack inputs whose bytes are checked.
- The shell launcher hashes the installed tree (about 100 MB, mostly Bun) before each run.
