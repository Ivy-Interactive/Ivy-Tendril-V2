#!/usr/bin/env bash
#
# Create empty placeholder sidecars so `cargo clippy`/`test`/`build` can touch the Tauri app crate.
#
# `tauri.conf.json` declares `externalBin: ["binaries/tendril", "binaries/opencode"]`, and
# `tauri-build`'s build script resolves and copies every one of them on *any* cargo invocation that
# compiles `tendril-app` — not just `tauri build`. A missing file aborts the build script with
# "resource path `binaries/tendril-<triple>` doesn't exist", which fails the whole workspace command
# before a single lint runs.
#
# CI never bundles or executes these, so it does not need the real thing: building the companion CLI
# and downloading ~150 MB of OpenCode to satisfy a lint would cost minutes per run. Empty files make
# the build script happy and nothing else reads them.
#
# Release is the opposite case and must NOT use this: `release-app.yml` builds the real `tendril`
# binary and runs `fetch-opencode-sidecar.sh`, because those files are what ships inside the
# installer. A stub reaching a bundle is the bug `binaries/.gitignore` was written to prevent.
#
# Usage:
#   stub-sidecars.sh [target-triple]      # defaults to the host triple
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)/src-tauri/binaries"

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  TARGET="$(rustc -vV | sed -n 's|host: ||p')"
fi

SUFFIX=""
case "$TARGET" in
  *windows*) SUFFIX=".exe" ;;
esac

mkdir -p "$BIN_DIR"
for name in tendril opencode; do
  path="$BIN_DIR/${name}-${TARGET}${SUFFIX}"
  # Never clobber a real sidecar a release step has already staged here.
  if [ -s "$path" ]; then
    echo "stub-sidecars: keeping existing $(basename "$path")"
    continue
  fi
  : > "$path"
  chmod +x "$path"
  echo "stub-sidecars: created $(basename "$path")"
done
