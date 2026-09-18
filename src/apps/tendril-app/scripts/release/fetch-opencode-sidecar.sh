#!/usr/bin/env bash
#
# Download the OpenCode CLI and drop it in as a Tauri sidecar.
#
# Tendril used to launch `ivy-agent`, a rebranded OpenCode that nothing in this repo built or
# shipped: `resolve_ivy_agent_binary` searched the PATH for a binary a user had to install
# themselves, and every `opencode`/`ivy`/`openaiproxy`/`proxy` agent failed on a clean machine.
# Bundling upstream OpenCode removes the install step and the version skew both at once.
#
# The name matters. Tauri resolves an `externalBin` entry by target triple -
# `binary-name-<triple>{.exe}` (tauri-utils `config.rs`) - and strips the suffix back off when it
# stages the bundle, so `binaries/opencode-aarch64-apple-darwin` ships as `opencode` next to the
# app executable. That is exactly where `resolve_opencode_binary` looks first, and where
# `own_cli_dir` already puts every agent process's PATH.
#
# Usage:
#   fetch-opencode-sidecar.sh [target-triple]      # defaults to the host triple
#   OPENCODE_VERSION=v1.18.31 fetch-opencode-sidecar.sh x86_64-unknown-linux-gnu
#
set -euo pipefail

# Pinned so a release is reproducible and so a bad upstream build cannot land in a Tendril
# installer without someone bumping this line. `latest` is accepted for a manual try-out.
OPENCODE_VERSION="${OPENCODE_VERSION:-v1.18.31}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)/src-tauri/binaries"

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  TARGET="$(rustc -vV | sed -n 's|host: ||p')"
fi

# Rust target triple -> upstream asset. Upstream also publishes `-baseline` (pre-AVX2 x64) and
# `-musl` builds; the plain glibc/modern ones match what Tauri targets.
case "$TARGET" in
  aarch64-apple-darwin)        ASSET="opencode-darwin-arm64.zip" ;;
  x86_64-apple-darwin)         ASSET="opencode-darwin-x64.zip" ;;
  aarch64-pc-windows-msvc)     ASSET="opencode-windows-arm64.zip" ;;
  x86_64-pc-windows-msvc)      ASSET="opencode-windows-x64.zip" ;;
  aarch64-unknown-linux-gnu)   ASSET="opencode-linux-arm64.tar.gz" ;;
  x86_64-unknown-linux-gnu)    ASSET="opencode-linux-x64.tar.gz" ;;
  aarch64-unknown-linux-musl)  ASSET="opencode-linux-arm64-musl.tar.gz" ;;
  x86_64-unknown-linux-musl)   ASSET="opencode-linux-x64-musl.tar.gz" ;;
  *)
    echo "fetch-opencode-sidecar: no OpenCode release asset for target '$TARGET'." >&2
    echo "Add a case here if upstream has started publishing one." >&2
    exit 1
    ;;
esac

case "$TARGET" in
  *windows*) EXE=".exe" ;;
  *)         EXE="" ;;
esac

DEST="$BIN_DIR/opencode-${TARGET}${EXE}"

if [ -f "$DEST" ] && [ -z "${OPENCODE_FORCE:-}" ]; then
  echo "fetch-opencode-sidecar: $DEST already present (set OPENCODE_FORCE=1 to re-download)."
  exit 0
fi

if [ "$OPENCODE_VERSION" = "latest" ]; then
  URL="https://github.com/sst/opencode/releases/latest/download/$ASSET"
else
  URL="https://github.com/sst/opencode/releases/download/$OPENCODE_VERSION/$ASSET"
fi

WORK="$(mktemp -d)"
# Keep a failed or interrupted download from leaving a half-written sidecar behind: everything
# lands in the temp dir and only a complete extract is moved into place.
trap 'rm -rf "$WORK"' EXIT

echo "fetch-opencode-sidecar: $OPENCODE_VERSION $ASSET -> $DEST"
curl --fail --location --silent --show-error --retry 3 --retry-delay 2 -o "$WORK/$ASSET" "$URL"

mkdir -p "$BIN_DIR" "$WORK/x"
case "$ASSET" in
  # Windows CI runs these steps under Git Bash, which ships no `unzip`, so try the three extractors
  # in order of availability rather than assuming one. `7z` is on the GitHub Windows image, and the
  # system `tar` there is bsdtar, which reads zips.
  *.zip)
    if command -v unzip >/dev/null 2>&1; then
      unzip -q -o "$WORK/$ASSET" -d "$WORK/x"
    elif command -v 7z >/dev/null 2>&1; then
      7z x -y -o"$WORK/x" "$WORK/$ASSET" >/dev/null
    elif tar -xf "$WORK/$ASSET" -C "$WORK/x" 2>/dev/null; then
      :
    else
      echo "fetch-opencode-sidecar: need unzip, 7z or a zip-capable tar to extract $ASSET" >&2
      exit 1
    fi
    ;;
  *.tar.gz) tar -xzf "$WORK/$ASSET" -C "$WORK/x" ;;
esac

# Every published archive is a single bare `opencode`/`opencode.exe` at the root, but find it
# rather than assume it, so a future upstream layout change fails here and not in the bundler.
BIN="$(find "$WORK/x" -type f \( -name opencode -o -name opencode.exe \) -print -quit)"
if [ -z "$BIN" ]; then
  echo "fetch-opencode-sidecar: no opencode binary inside $ASSET" >&2
  exit 1
fi

mv "$BIN" "$DEST"
chmod +x "$DEST"
echo "fetch-opencode-sidecar: wrote $DEST ($(du -h "$DEST" | cut -f1))"
