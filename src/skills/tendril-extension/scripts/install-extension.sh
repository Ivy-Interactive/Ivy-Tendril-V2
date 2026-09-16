#!/usr/bin/env bash
# Install the Ivy Tendril extension into any VS Code-family IDE.
#
# Usage:
#   install-extension.sh [options]
#
# Options:
#   --ide <id[,id...]>     target IDE; a comma list means "first one installed
#                          wins". Defaults to $TENDRIL_IDE, or to the sole
#                          detected IDE. Run list-ides.sh for the ids.
#   --all                  install into every detected IDE
#   --extensions-dir <p>   install into <p> directly, skipping detection.
#                          Use this to target an IDE the registry does not
#                          know, or a temp directory when testing.
#   --home <dir>           search <dir> instead of $HOME (= TENDRIL_IDE_HOME)
#   --method symlink|vsix  symlink (default) or install a packaged VSIX
#                          through the IDE CLI
#   --vsix <path>          use this VSIX instead of building one; implies
#                          --method vsix
#   --user-data-dir <p>    passed to the IDE CLI for the vsix method. Defaults
#                          to a sibling of --extensions-dir when that is
#                          overridden, so a test run never touches the real
#                          profile.
#   --no-build             do not run pnpm install / pnpm run build
#   --dry-run              print what would happen and exit
#   -h, --help             this message
#
# Why symlink is the default: a symlinked directory is picked up by the
# extension host without going through the CLI's engines.vscode validator,
# which is what makes the extension usable on an IDE whose Code OSS version
# is older than the newest VS Code. See SKILL.md.

set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ide-registry.sh"

usage() { sed -n '2,31p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

ide="${TENDRIL_IDE:-}"
all=0
method="symlink"
vsix=""
user_data_dir=""
do_build=1
dry_run=0
ext_dir_override="${TENDRIL_EXTENSIONS_DIR:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --ide) ide="$2"; shift 2 ;;
    --all) all=1; shift ;;
    --extensions-dir) ext_dir_override="$2"; shift 2 ;;
    --home) TENDRIL_IDE_HOME="$2"; export TENDRIL_IDE_HOME; shift 2 ;;
    --method) method="$2"; shift 2 ;;
    --vsix) vsix="$2"; method="vsix"; shift 2 ;;
    --user-data-dir) user_data_dir="$2"; shift 2 ;;
    --no-build) do_build=0; shift ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument '$1' (see --help)" >&2; exit 2 ;;
  esac
done

case "$method" in
  symlink|vsix) ;;
  *) echo "error: --method must be 'symlink' or 'vsix', got '$method'" >&2; exit 2 ;;
esac

EXTENSION_DIR="$(tendril_extension_dir)"
SLUG="$(tendril_extension_slug "$EXTENSION_DIR")"
FLOOR="$(tendril_engine_floor "$EXTENSION_DIR")"
VERSION="$(tendril_manifest_field "$EXTENSION_DIR" version)"
QUALIFIED="$(tendril_manifest_field "$EXTENSION_DIR" publisher).$(tendril_manifest_field "$EXTENSION_DIR" name)"

# When the target directory is not where the IDE would look by default, every
# CLI invocation has to be told about it explicitly, otherwise a test run
# reports on (or worse, writes to) the developer's real profile.
sandboxed=0
if [ -n "$ext_dir_override" ] || [ "$(tendril_ide_home)" != "$HOME" ]; then
  sandboxed=1
fi

# ---------------------------------------------------------------------------
# Work out the target list: each entry is "<label>|<extensions dir>|<id-or-->"
# ---------------------------------------------------------------------------
targets=""

if [ -n "$ext_dir_override" ]; then
  if [ "$all" -eq 1 ]; then
    echo "error: --all and --extensions-dir are mutually exclusive." >&2
    exit 2
  fi
  label="$ext_dir_override"
  id_for_cli="-"
  if [ -n "$ide" ]; then
    id_for_cli="$(printf '%s' "$ide" | cut -d',' -f1)"
    tendril_ide_row "$id_for_cli" >/dev/null 2>&1 || {
      echo "error: unknown IDE id '$id_for_cli'." >&2
      exit 2
    }
    label="$(tendril_ide_display "$id_for_cli") @ $ext_dir_override"
  fi
  targets="$label|$ext_dir_override|$id_for_cli"
elif [ "$all" -eq 1 ]; then
  detected="$(tendril_ide_detected)"
  if [ -z "$detected" ]; then
    echo "error: no VS Code-family IDE detected under $(tendril_ide_home)." >&2
    echo "       Pass --extensions-dir <path> to target one explicitly." >&2
    exit 1
  fi
  for id in $detected; do
    targets="$targets
$(tendril_ide_display "$id")|$(tendril_ide_extensions_dir "$id")|$id"
  done
else
  id="$(tendril_ide_resolve "$ide")"
  targets="$(tendril_ide_display "$id")|$(tendril_ide_extensions_dir "$id")|$id"
fi

echo "==> Extension : $EXTENSION_DIR"
echo "==> Manifest  : $SLUG (engines.vscode >= $FLOOR)"
echo "==> Method    : $method"
printf '%s\n' "$targets" | grep . | while IFS='|' read -r label dir _id; do
  echo "==> Target    : $label -> $dir/$SLUG"
done

if [ "$dry_run" -eq 1 ]; then
  echo "==> --dry-run: nothing written."
  exit 0
fi

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
if [ "$do_build" -eq 1 ]; then
  echo "==> Building extension bundle..."
  if ! (cd "$EXTENSION_DIR" && pnpm install); then
    if [ -d "$EXTENSION_DIR/node_modules" ]; then
      echo "    warning: 'pnpm install' failed (offline?); using the existing node_modules."
    else
      echo "error: 'pnpm install' failed and there is no node_modules to fall back on." >&2
      echo "       Installing the devDependencies needs network access." >&2
      exit 1
    fi
  fi
  (cd "$EXTENSION_DIR" && pnpm run build)
fi

MAIN="$EXTENSION_DIR/$(tendril_manifest_field "$EXTENSION_DIR" main | sed 's|^\./||')"
if [ ! -f "$MAIN" ]; then
  echo "error: bundle missing at $MAIN. Drop --no-build, or run 'pnpm run build'." >&2
  exit 1
fi

if [ "$method" = "vsix" ] && [ -z "$vsix" ]; then
  vsix_out="$EXTENSION_DIR/$SLUG.vsix"
  echo "==> Packaging VSIX..."
  "$(dirname "${BASH_SOURCE[0]}")/package-vsix.sh" --out "$vsix_out" --no-build
  vsix="$vsix_out"
fi

if [ "$method" = "vsix" ] && [ ! -f "$vsix" ]; then
  echo "error: VSIX not found at $vsix" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------
install_symlink() {
  local dir="$1" target
  target="$dir/$SLUG"
  mkdir -p "$dir"
  if [ -L "$target" ]; then
    echo "    replacing existing link $target"
    rm "$target"
  elif [ -e "$target" ]; then
    echo "    removing existing directory $target"
    rm -rf "$target"
  fi
  ln -s "$EXTENSION_DIR" "$target"
  echo "    linked $target -> $EXTENSION_DIR"
  # The link alone is invisible to the IDE when extensions.json already exists.
  tendril_extensions_json_add "$dir" "$SLUG" "$QUALIFIED" "$VERSION"
}

install_vsix() {
  local dir="$1" id="$2" cli udd version
  if [ "$id" = "-" ]; then
    echo "error: the vsix method needs an IDE CLI; pass --ide together with" >&2
    echo "       --extensions-dir, or use --method symlink." >&2
    return 1
  fi
  if ! cli="$(tendril_ide_cli "$id")"; then
    echo "error: no CLI found for $(tendril_ide_display "$id")." >&2
    echo "       Install its shell command, or use --method symlink." >&2
    return 1
  fi

  # Refuse before the IDE does, with an actionable message. This is the exact
  # failure the Antigravity note in SKILL.md describes:
  #   Unable to install extension '<id>' as it is not compatible with the IDE '<version>'.
  if version="$(tendril_ide_version "$id" 2>/dev/null)"; then
    if ! tendril_semver_gte "$version" "$FLOOR"; then
      echo "error: $(tendril_ide_display "$id") runs Code OSS $version but the manifest" >&2
      echo "       requires >= $FLOOR, so its CLI validator will reject this VSIX." >&2
      echo "       Use --method symlink, or lower engines.vscode if the APIs allow it." >&2
      return 1
    fi
  else
    echo "    warning: could not read the IDE version; the CLI may still reject the VSIX."
  fi

  udd="$user_data_dir"
  if [ -z "$udd" ] && [ "$sandboxed" -eq 1 ]; then
    # Not the default location, so keep the profile out of the real one too.
    udd="$(dirname "$dir")/user-data"
  fi

  set -- --install-extension "$vsix" --force
  if [ "$sandboxed" -eq 1 ]; then
    set -- --extensions-dir "$dir" "$@"
  fi
  if [ -n "$udd" ]; then
    mkdir -p "$udd"
    set -- --user-data-dir "$udd" "$@"
  fi
  mkdir -p "$dir"
  echo "    $cli $*"
  "$cli" "$@"
}

failed=0
while IFS='|' read -r label dir id; do
  [ -n "${label:-}" ] || continue
  echo "==> Installing into $label"
  ok=1
  if [ "$method" = "symlink" ]; then
    install_symlink "$dir" || ok=0
  else
    install_vsix "$dir" "$id" || ok=0
  fi
  if [ "$ok" -eq 0 ]; then
    failed=1
    continue
  fi

  if [ "$id" != "-" ] && cli="$(tendril_ide_cli "$id" 2>/dev/null)"; then
    listargs=""
    [ "$sandboxed" -eq 1 ] && listargs="--extensions-dir $dir"
    # shellcheck disable=SC2086
    if "$cli" $listargs --list-extensions 2>/dev/null | grep -q "^$QUALIFIED$"; then
      echo "    verified: $label lists the extension"
    else
      echo "    warning: $label did not list the extension yet; reload the window"
    fi
  elif tendril_extensions_json_has "$dir" "$QUALIFIED"; then
    echo "    verified: $QUALIFIED is registered in $dir/extensions.json"
  fi
done <<EOF
$(printf '%s\n' "$targets" | grep .)
EOF

if [ "$failed" -ne 0 ]; then
  echo "==> One or more installs failed." >&2
  exit 1
fi

echo "==> Done. Reload the IDE window (Cmd+Shift+P -> 'Developer: Reload Window')."
