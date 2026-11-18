#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then
  echo 'Usage: scripts/build.sh <output-directory>' >&2
  exit 2
fi

source_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$1"
output_root=$(CDPATH= cd -- "$1" && pwd)
if [ "$source_root" = "$output_root" ]; then
  echo 'Choose an installation directory other than the source root.' >&2
  exit 2
fi
mkdir -p "$output_root/bin" "$output_root/curve2" "$output_root/optimization/adapters" "$output_root/guide" "$output_root/web"

cd "$source_root"
cp curve2/*.ts curve2/base.curve curve2/curvett.lean "$output_root/curve2/"
cp -R curve2/effs "$output_root/curve2/"
for source in optimization/*.ts; do
  case "$source" in *.test.ts) continue ;; esac
  cp "$source" "$output_root/optimization/"
done
cp optimization/gate.curve "$output_root/optimization/"
cp optimization/adapters/*.ts optimization/adapters/read_archive.py "$output_root/optimization/adapters/"
for source in web/*.ts; do
  case "$source" in *.test.ts) continue ;; esac
  cp "$source" "$output_root/web/"
done
cp web/*.curve web/package.json web/bun.lock web/README.md "$output_root/web/"
cp guide/*.md "$output_root/guide/"
cp LICENSE "$output_root/"
cat > "$output_root/bin/curve" <<'LAUNCHER'
#!/bin/sh
set -eu
curve_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec bun --config=/dev/null --no-env-file "$curve_root/curve2/main.ts" "$@"
LAUNCHER
chmod +x "$output_root/bin/curve"
