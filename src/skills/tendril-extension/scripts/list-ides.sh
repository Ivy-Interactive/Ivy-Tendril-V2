#!/usr/bin/env bash
# Report which VS Code-family IDEs are present and whether each can take the
# extension at its declared engines.vscode floor.
#
# Usage:
#   list-ides.sh [--all] [--home <dir>]
#
#   --all         also list registry entries that are not installed
#   --home <dir>  search <dir> instead of $HOME (same as TENDRIL_IDE_HOME)

set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ide-registry.sh"

show_all=0
while [ $# -gt 0 ]; do
  case "$1" in
    --all) show_all=1; shift ;;
    --home) TENDRIL_IDE_HOME="$2"; export TENDRIL_IDE_HOME; shift 2 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "error: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

ext_dir="$(tendril_extension_dir)"
floor="$(tendril_engine_floor "$ext_dir")"
slug="$(tendril_extension_slug "$ext_dir")"

echo "Extension : $ext_dir"
echo "Manifest  : $slug (engines.vscode floor $floor)"
echo "Home      : $(tendril_ide_home)"
echo

printf '%-20s %-24s %-9s %-9s %s\n' "ID" "IDE" "VERSION" "ENGINE" "EXTENSIONS DIR"
for id in $(tendril_ide_ids); do
  if tendril_ide_installed "$id"; then
    state="present"
  elif [ "$show_all" -eq 1 ]; then
    state="absent"
  else
    continue
  fi

  dir="$(tendril_ide_extensions_dir "$id")"
  version="$(tendril_ide_version "$id" 2>/dev/null || echo '?')"

  if [ "$state" = "absent" ]; then
    engine="-"
  elif [ "$version" = "?" ]; then
    engine="?"
  elif tendril_semver_gte "$version" "$floor"; then
    engine="ok"
  else
    engine="TOO OLD"
  fi

  cli="$(tendril_ide_cli "$id" 2>/dev/null || true)"
  suffix=""
  [ -d "$dir" ] || suffix="$suffix (missing)"
  [ -n "$cli" ] || suffix="$suffix (no cli)"

  printf '%-20s %-24s %-9s %-9s %s%s\n' \
    "$id" "$(tendril_ide_display "$id")" "$version" "$engine" "$dir" "$suffix"
done

extra="$(tendril_ide_discover)"
if [ -n "$extra" ]; then
  echo
  echo "Unrecognised VS Code-family extensions directories (usable via --extensions-dir):"
  printf '%s\n' "$extra" | sed 's/^/  /'
fi

echo
echo "VERSION is the upstream Code OSS version the IDE reports; '?' means it could"
echo "not be read offline, in which case prefer the symlink install method."
