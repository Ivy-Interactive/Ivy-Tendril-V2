#!/usr/bin/env bash
# Remove the Ivy Tendril extension from a VS Code-family IDE.
#
# Usage:
#   uninstall-extension.sh [options]
#
# Options:
#   --ide <id[,id...]>     target IDE (first installed one wins)
#   --all                  remove from every detected IDE
#   --extensions-dir <p>   operate on <p> directly, skipping detection
#   --home <dir>           search <dir> instead of $HOME (= TENDRIL_IDE_HOME)
#   --all-versions         also remove other installed versions of the
#                          extension, not just the version in package.json
#   --dry-run              print what would be removed and exit
#   -h, --help             this message
#
# Symlinks and real directories are both handled: a symlink is unlinked (never
# followed, so the repo checkout is safe), a real install directory is deleted.

set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ide-registry.sh"

usage() { sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

ide="${TENDRIL_IDE:-}"
all=0
all_versions=0
dry_run=0
ext_dir_override="${TENDRIL_EXTENSIONS_DIR:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --ide) ide="$2"; shift 2 ;;
    --all) all=1; shift ;;
    --all-versions) all_versions=1; shift ;;
    --extensions-dir) ext_dir_override="$2"; shift 2 ;;
    --home) TENDRIL_IDE_HOME="$2"; export TENDRIL_IDE_HOME; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument '$1' (see --help)" >&2; exit 2 ;;
  esac
done

EXTENSION_DIR="$(tendril_extension_dir)"
SLUG="$(tendril_extension_slug "$EXTENSION_DIR")"
QUALIFIED="$(tendril_manifest_field "$EXTENSION_DIR" publisher).$(tendril_manifest_field "$EXTENSION_DIR" name)"

targets=""
if [ -n "$ext_dir_override" ]; then
  targets="$ext_dir_override|$ext_dir_override"
elif [ "$all" -eq 1 ]; then
  for id in $(tendril_ide_detected); do
    targets="$targets
$(tendril_ide_display "$id")|$(tendril_ide_extensions_dir "$id")"
  done
else
  id="$(tendril_ide_resolve "$ide")"
  targets="$(tendril_ide_display "$id")|$(tendril_ide_extensions_dir "$id")"
fi

removed=0
while IFS='|' read -r label dir; do
  [ -n "${label:-}" ] || continue
  if [ ! -d "$dir" ]; then
    echo "==> $label: no extensions directory at $dir"
    continue
  fi

  if [ "$all_versions" -eq 1 ]; then
    matches="$(find "$dir" -maxdepth 1 \( -type d -o -type l \) -name "$QUALIFIED-*" 2>/dev/null || true)"
  else
    matches=""
    [ -e "$dir/$SLUG" ] || [ -L "$dir/$SLUG" ] && matches="$dir/$SLUG"
  fi

  indexed=0
  tendril_extensions_json_has "$dir" "$QUALIFIED" && indexed=1

  if [ -z "$matches" ] && [ "$indexed" -eq 0 ]; then
    echo "==> $label: $QUALIFIED is not installed in $dir"
    continue
  fi

  printf '%s\n' "$matches" | while IFS= read -r match; do
    [ -n "$match" ] || continue
    if [ "$dry_run" -eq 1 ]; then
      echo "==> $label: would remove $match"
    elif [ -L "$match" ]; then
      # rm on the link itself, never rm -rf through it, or the checkout goes too.
      rm "$match"
      echo "==> $label: unlinked $match"
    else
      rm -rf "$match"
      echo "==> $label: removed $match"
    fi
  done

  # Deregister even when the directory was already gone, otherwise the index
  # keeps a dangling entry and the IDE logs a missing-extension warning.
  if [ "$indexed" -eq 1 ]; then
    [ -n "$matches" ] || echo "==> $label: directory already gone, cleaning the index"
    if [ "$dry_run" -eq 1 ]; then
      echo "==> $label: would deregister $QUALIFIED from extensions.json"
    else
      tendril_extensions_json_remove "$dir" "$QUALIFIED"
    fi
  fi
  removed=1
done <<EOF
$(printf '%s\n' "$targets" | grep .)
EOF

if [ "$removed" -eq 0 ]; then
  echo "==> Nothing to remove."
fi
echo "==> Reload the IDE window to drop the extension host copy."
