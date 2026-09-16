#!/usr/bin/env bash
# Build a .vsix that installs across the VS Code family.
#
# Usage:
#   package-vsix.sh [options]
#
# Options:
#   --out <path>   write the VSIX here (default: <extension>/<slug>.vsix)
#   --no-build     skip pnpm install / pnpm run build
#   --skip-checks  skip the manifest compatibility checks
#   -h, --help     this message
#
# The manifest is validated first (see check-manifest.ts), because a VSIX that
# names a contribution point or an API proposal the target IDE will not accept
# packages cleanly and then fails at install or activation time.
#
# Publishing is deliberately not automated here: `vsce publish` and `ovsx
# publish` both need network access and a token.

set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ide-registry.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
usage() { sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

out=""
do_build=1
skip_checks=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    --no-build) do_build=0; shift ;;
    --skip-checks) skip_checks=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument '$1' (see --help)" >&2; exit 2 ;;
  esac
done

EXTENSION_DIR="$(tendril_extension_dir)"
SLUG="$(tendril_extension_slug "$EXTENSION_DIR")"
[ -n "$out" ] || out="$EXTENSION_DIR/$SLUG.vsix"

echo "==> Packaging $SLUG from $EXTENSION_DIR"

if [ "$skip_checks" -eq 0 ]; then
  if command -v pnpm >/dev/null 2>&1; then
    pnpm tsx "$SCRIPT_DIR/check-manifest.ts"
  else
    node --experimental-strip-types "$SCRIPT_DIR/check-manifest.ts"
  fi
fi

if [ "$do_build" -eq 1 ]; then
  if ! (cd "$EXTENSION_DIR" && pnpm install); then
    if [ -d "$EXTENSION_DIR/node_modules" ]; then
      echo "    warning: 'pnpm install' failed (offline?); using the existing node_modules."
    else
      echo "error: 'pnpm install' failed and there is no node_modules to fall back on." >&2
      exit 1
    fi
  fi
  (cd "$EXTENSION_DIR" && pnpm run build)
fi

# Prefer the workspace-local vsce so packaging works with no network.
VSCE="$EXTENSION_DIR/node_modules/.bin/vsce"
if [ ! -x "$VSCE" ]; then
  if command -v vsce >/dev/null 2>&1; then
    VSCE="$(command -v vsce)"
  else
    echo "error: @vscode/vsce not found." >&2
    echo "       It is a devDependency of the extension: run 'pnpm install' in" >&2
    echo "       $EXTENSION_DIR. Fetching it needs network access." >&2
    exit 1
  fi
fi

mkdir -p "$(dirname "$out")"
(cd "$EXTENSION_DIR" && "$VSCE" package --no-dependencies --out "$out")

echo "==> VSIX: $out"
echo "==> Install it with:"
echo "      $SCRIPT_DIR/install-extension.sh --ide <id> --vsix $out"
echo "    or symlink instead when the target IDE's Code OSS version is older"
echo "    than the manifest floor ($(tendril_engine_floor "$EXTENSION_DIR"))."
