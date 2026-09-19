#!/usr/bin/env bash
# Shared registry + detection helpers for VS Code-family IDEs.
#
# This file is meant to be sourced, not executed:
#   . "$(dirname "$0")/ide-registry.sh"
#
# Written for bash 3.2 (the /bin/bash shipped with macOS): no associative
# arrays, no ${var,,}, no mapfile.
#
# Environment overrides (all optional, all honoured by every caller):
#   TENDRIL_IDE_HOME        base directory searched instead of $HOME.
#                           Use this to point the whole toolchain at a temp
#                           directory so nothing under the real $HOME is
#                           touched. Example:
#                             TENDRIL_IDE_HOME=/tmp/fake-home install-extension.sh --ide vscode
#   TENDRIL_EXTENSIONS_DIR  explicit extensions directory; skips detection
#                           entirely (still validated/created as needed).
#   TENDRIL_EXTENSION_DIR   explicit path to src/extensions/vscode.
#   TENDRIL_IDE             default value for --ide.

set -euo pipefail

# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------
# id | display name | data folder (relative to home) | cli candidates (comma) | macOS .app names (comma, "-" for none)
#
# Detection never trusts this table blindly: an entry only counts as
# "installed" when its extensions directory, CLI or app bundle actually
# exists on this machine. A wrong guess therefore degrades to "not
# installed" rather than to a bogus install, and tendril_ide_discover finds
# the real directory anyway.
#
# Verified on this machine (macOS): vscode, antigravity-ide, antigravity.
# The rest come from each product's published data-folder/CLI names and are
# unverified here; see references/ide-matrix.md.
TENDRIL_IDE_REGISTRY='
vscode|Visual Studio Code|.vscode|code|Visual Studio Code.app
vscode-insiders|VS Code Insiders|.vscode-insiders|code-insiders|Visual Studio Code - Insiders.app
vscode-exploration|VS Code Exploration|.vscode-exploration|code-exploration|Visual Studio Code - Exploration.app
vscodium|VSCodium|.vscode-oss|codium,vscodium|VSCodium.app
vscodium-insiders|VSCodium Insiders|.vscode-oss-insiders|codium-insiders|VSCodium - Insiders.app
cursor|Cursor|.cursor|cursor|Cursor.app
windsurf|Windsurf|.windsurf|windsurf|Windsurf.app
windsurf-next|Windsurf Next|.windsurf-next|windsurf-next|Windsurf - Next.app
antigravity-ide|Antigravity IDE|.antigravity-ide|antigravity-ide|Antigravity IDE.app
antigravity|Antigravity (legacy)|.antigravity|antigravity|-
trae|Trae|.trae|trae|Trae.app
trae-cn|Trae CN|.trae-cn|trae-cn|Trae CN.app
positron|Positron|.positron|positron|Positron.app
kiro|Kiro|.kiro|kiro|Kiro.app
void|Void|.void-editor|void|Void.app
openvscode-server|OpenVSCode Server|.openvscode-server|openvscode-server|-
code-server|code-server|.local/share/code-server|code-server|-
'

tendril_ide_home() {
  printf '%s\n' "${TENDRIL_IDE_HOME:-$HOME}"
}

tendril_ide_ids() {
  printf '%s\n' "$TENDRIL_IDE_REGISTRY" | while IFS='|' read -r id _rest; do
    [ -n "${id:-}" ] || continue
    printf '%s\n' "$id"
  done
}

# tendril_ide_row <id> -> the raw registry line, or empty + status 1
tendril_ide_row() {
  local want="$1" line id
  printf '%s\n' "$TENDRIL_IDE_REGISTRY" | while IFS= read -r line; do
    [ -n "${line:-}" ] || continue
    id="${line%%|*}"
    if [ "$id" = "$want" ]; then
      printf '%s\n' "$line"
      break
    fi
  done | grep . || return 1
}

# tendril_ide_field <id> <1-based field index>
tendril_ide_field() {
  local row
  row="$(tendril_ide_row "$1")" || return 1
  printf '%s\n' "$row" | cut -d'|' -f"$2"
}

tendril_ide_display() { tendril_ide_field "$1" 2; }
tendril_ide_data_folder() { tendril_ide_field "$1" 3; }

# Extensions directory for an id. TENDRIL_EXTENSIONS_DIR wins over everything.
tendril_ide_extensions_dir() {
  local id="$1" folder
  if [ -n "${TENDRIL_EXTENSIONS_DIR:-}" ]; then
    printf '%s\n' "$TENDRIL_EXTENSIONS_DIR"
    return 0
  fi
  folder="$(tendril_ide_data_folder "$id")" || return 1
  printf '%s/%s/extensions\n' "$(tendril_ide_home)" "$folder"
}

# First CLI for an id that actually exists, or empty + status 1.
# Looks on PATH first, then in the well-known per-product locations.
tendril_ide_cli() {
  local id="$1" home candidates cli app apps folder found
  home="$(tendril_ide_home)"
  candidates="$(tendril_ide_field "$id" 4 || true)"
  apps="$(tendril_ide_field "$id" 5 || true)"
  folder="$(tendril_ide_data_folder "$id" || true)"
  found=''

  # 1. PATH
  for cli in $(printf '%s' "$candidates" | tr ',' ' '); do
    [ -n "$cli" ] || continue
    if command -v "$cli" >/dev/null 2>&1; then
      command -v "$cli"
      return 0
    fi
  done

  # 2. Per-user install laid down next to the data folder.
  #    Antigravity IDE does exactly this:
  #      ~/.antigravity-ide/antigravity-ide/bin/antigravity-ide
  for cli in $(printf '%s' "$candidates" | tr ',' ' '); do
    [ -n "$cli" ] || continue
    found="$home/$folder/$cli/bin/$cli"
    if [ -x "$found" ]; then
      printf '%s\n' "$found"
      return 0
    fi
  done

  # 3. macOS app bundles (system-wide and per-user Applications).
  for app in $(printf '%s' "$apps" | tr ',' '\n'); do
    [ -n "$app" ] && [ "$app" != "-" ] || continue
    for cli in $(printf '%s' "$candidates" | tr ',' ' '); do
      [ -n "$cli" ] || continue
      for prefix in "/Applications" "$home/Applications"; do
        found="$prefix/$app/Contents/Resources/app/bin/$cli"
        if [ -x "$found" ]; then
          printf '%s\n' "$found"
          return 0
        fi
      done
    done
  done

  # 4. Common Linux prefixes. NOT tested: this machine is macOS.
  for cli in $(printf '%s' "$candidates" | tr ',' ' '); do
    [ -n "$cli" ] || continue
    for found in "/usr/share/$cli/bin/$cli" "/opt/$cli/bin/$cli" "/usr/lib/$cli/bin/$cli"; do
      if [ -x "$found" ]; then
        printf '%s\n' "$found"
        return 0
      fi
    done
  done

  return 1
}

# macOS app bundle path for an id, or empty + status 1.
#
# Requires Contents/Resources/app/product.json, which only a Code OSS build
# has. /Applications/Antigravity.app, for instance, is an electron-builder
# app.asar bundle that merely shares a name with Antigravity IDE; without
# this check it would be mistaken for the IDE and report a product version
# (2.12.2) where an engines.vscode comparison expects a Code OSS version.
tendril_ide_app_path() {
  local id="$1" home app prefix
  home="$(tendril_ide_home)"
  for app in $(tendril_ide_field "$id" 5 2>/dev/null | tr ',' '\n'); do
    [ -n "$app" ] && [ "$app" != "-" ] || continue
    for prefix in "/Applications" "$home/Applications"; do
      if [ -f "$prefix/$app/Contents/Resources/app/product.json" ]; then
        printf '%s\n' "$prefix/$app"
        return 0
      fi
    done
  done
  return 1
}

# Upstream Code OSS version an IDE reports for engines.vscode matching.
# Reads the app bundle's package.json (cheap, offline, exact). Falls back to
# `<cli> --version`, whose first line is the *product* version for some forks
# and therefore only a hint. Prints empty + status 1 when unknown.
tendril_ide_version() {
  local id="$1" app pkg cli v
  if app="$(tendril_ide_app_path "$id" 2>/dev/null)"; then
    pkg="$app/Contents/Resources/app/package.json"
    if [ -f "$pkg" ]; then
      v="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$pkg" | head -n 1)"
      if [ -n "$v" ]; then
        printf '%s\n' "$v"
        return 0
      fi
    fi
  fi
  if cli="$(tendril_ide_cli "$id" 2>/dev/null)"; then
    v="$("$cli" --version 2>/dev/null | head -n 1 | tr -d '\r')"
    case "$v" in
      [0-9]*.[0-9]*.[0-9]*) printf '%s\n' "$v"; return 0 ;;
    esac
  fi
  return 1
}

# An IDE counts as installed when we can find its extensions dir, its CLI or
# its app bundle. Presence of the extensions dir is the signal that matters
# for the symlink method, so it is checked first.
tendril_ide_installed() {
  local id="$1" dir
  dir="$(tendril_ide_extensions_dir "$id" 2>/dev/null || true)"
  [ -n "$dir" ] && [ -d "$dir" ] && return 0
  tendril_ide_cli "$id" >/dev/null 2>&1 && return 0
  tendril_ide_app_path "$id" >/dev/null 2>&1 && return 0
  return 1
}

tendril_ide_detected() {
  local id
  for id in $(tendril_ide_ids); do
    tendril_ide_installed "$id" && printf '%s\n' "$id"
  done
  return 0
}

# Any *other* VS Code-family extensions directory under the home dir that the
# registry does not know about. A directory qualifies when it is named
# "extensions" and holds an extensions.json state file, which is how every
# VS Code fork records its installed set.
tendril_ide_discover() {
  local home dir known id
  home="$(tendril_ide_home)"
  known="$(for id in $(tendril_ide_ids); do tendril_ide_extensions_dir "$id" 2>/dev/null; done)"
  for dir in "$home"/.*/extensions "$home"/.local/share/*/extensions; do
    [ -d "$dir" ] || continue
    [ -f "$dir/extensions.json" ] || continue
    printf '%s\n' "$known" | grep -qxF "$dir" && continue
    printf '%s\n' "$dir"
  done
  return 0
}

# tendril_ide_resolve <id-or-comma-list> -> first id in the list that is
# installed. With no argument, resolves to the sole detected IDE, or fails
# telling the caller to disambiguate.
tendril_ide_resolve() {
  local wanted="${1:-}" id count detected
  if [ -n "$wanted" ]; then
    for id in $(printf '%s' "$wanted" | tr ',' ' '); do
      if ! tendril_ide_row "$id" >/dev/null 2>&1; then
        echo "error: unknown IDE id '$id'." >&2
        echo "       Known ids: $(tendril_ide_ids | tr '\n' ' ')" >&2
        echo "       For an IDE not in that list, pass --extensions-dir <path>." >&2
        return 1
      fi
      if tendril_ide_installed "$id"; then
        printf '%s\n' "$id"
        return 0
      fi
    done
    echo "error: none of these IDEs is installed: $wanted" >&2
    for id in $(printf '%s' "$wanted" | tr ',' ' '); do
      echo "       $id ($(tendril_ide_display "$id")): expected extensions dir $(tendril_ide_extensions_dir "$id")" >&2
    done
    echo "       Detected on this machine: $(tendril_ide_detected | tr '\n' ' ')" >&2
    echo "       Run list-ides.sh to see the full picture, or pass --extensions-dir <path>." >&2
    return 1
  fi

  detected="$(tendril_ide_detected)"
  count="$(printf '%s\n' "$detected" | grep -c . || true)"
  if [ "$count" -eq 0 ]; then
    echo "error: no VS Code-family IDE detected under $(tendril_ide_home)." >&2
    echo "       Pass --ide <id> or --extensions-dir <path>, or set TENDRIL_IDE_HOME." >&2
    return 1
  fi
  if [ "$count" -gt 1 ]; then
    echo "error: several IDEs detected; choose one with --ide, or use --all." >&2
    printf '%s\n' "$detected" | sed 's/^/       /' >&2
    return 1
  fi
  printf '%s\n' "$detected"
}

# ---------------------------------------------------------------------------
# Extension directory + manifest
# ---------------------------------------------------------------------------

# Locate src/extensions/vscode by walking up from this script. Works whether
# the skill is used in-repo or copied into a plugin directory alongside the
# extension.
tendril_extension_dir() {
  local here candidate
  if [ -n "${TENDRIL_EXTENSION_DIR:-}" ]; then
    printf '%s\n' "$TENDRIL_EXTENSION_DIR"
    return 0
  fi
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  while [ "$here" != "/" ]; do
    for candidate in "$here/src/extensions/vscode" "$here/extensions/vscode"; do
      if [ -f "$candidate/package.json" ]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    done
    here="$(dirname "$here")"
  done
  echo "error: could not locate src/extensions/vscode. Set TENDRIL_EXTENSION_DIR." >&2
  return 1
}

# Read a top-level string field out of the extension manifest.
tendril_manifest_field() {
  local ext_dir="$1" key="$2"
  node -e '
    const pkg = require(process.argv[1] + "/package.json");
    const value = process.argv[2].split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), pkg);
    if (value == null) process.exit(1);
    process.stdout.write(String(value));
  ' "$ext_dir" "$key"
}

# <publisher>.<name>-<version>, the directory name every VS Code fork expects.
tendril_extension_slug() {
  local ext_dir="$1"
  node -e '
    const pkg = require(process.argv[1] + "/package.json");
    for (const k of ["publisher", "name", "version"]) {
      if (!pkg[k]) { console.error(`error: package.json is missing "${k}"`); process.exit(1); }
    }
    process.stdout.write(`${pkg.publisher}.${pkg.name}-${pkg.version}`);
  ' "$ext_dir"
}

# Lowest version satisfying engines.vscode (e.g. "^1.90.0" -> "1.90.0").
tendril_engine_floor() {
  local ext_dir="$1"
  node -e '
    const pkg = require(process.argv[1] + "/package.json");
    const raw = (pkg.engines && pkg.engines.vscode) || "";
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
    if (!m) { console.error(`error: cannot parse engines.vscode "${raw}"`); process.exit(1); }
    process.stdout.write(`${m[1]}.${m[2]}.${m[3]}`);
  ' "$ext_dir"
}

# ---------------------------------------------------------------------------
# extensions.json
# ---------------------------------------------------------------------------
# Every VS Code fork keeps an <extensions dir>/extensions.json index of what is
# installed, and treats it as authoritative. Verified on VS Code 1.137.0 and
# Antigravity IDE 1.107.0: a directory (or symlink) that is not listed there is
# ignored outright; the folder is only rescanned when extensions.json is
# absent. So dropping in a symlink is necessary but not sufficient - the index
# has to name it too.
#
# The index is edited in place rather than deleted, because deleting it would
# discard the metadata (pinned, source, application scope) of every other
# installed extension.

# tendril_extensions_json_add <extensions dir> <slug> <qualified id> <version>
tendril_extensions_json_add() {
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const [dir, slug, id, version] = process.argv.slice(1);
    const file = path.join(dir, "extensions.json");

    let entries = [];
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (Array.isArray(parsed)) entries = parsed;
        else console.error(`    warning: ${file} is not an array; rewriting it`);
      } catch (err) {
        console.error(`    warning: ${file} is unreadable (${err.message}); rewriting it`);
      }
    } else {
      // No index yet: the IDE will rescan and write one itself, but seeding it
      // keeps behaviour identical either way.
    }

    const location = path.join(dir, slug);
    const entry = {
      identifier: { id },
      version,
      location: { $mid: 1, path: location, scheme: "file" },
      relativeLocation: slug,
    };

    const idx = entries.findIndex(
      (e) => e && e.identifier && String(e.identifier.id).toLowerCase() === id.toLowerCase()
    );
    if (idx >= 0) {
      // Keep whatever metadata the IDE had recorded; only re-point it.
      entries[idx] = { ...entries[idx], ...entry };
      console.log(`    extensions.json: updated ${id}`);
    } else {
      entries.push(entry);
      console.log(`    extensions.json: registered ${id}`);
    }

    const tmp = `${file}.tendril-tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entries));
    fs.renameSync(tmp, file);
  ' "$1" "$2" "$3" "$4"
}

# tendril_extensions_json_remove <extensions dir> <qualified id>
tendril_extensions_json_remove() {
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const [dir, id] = process.argv.slice(1);
    const file = path.join(dir, "extensions.json");

    // node -e evaluates at top level, where `return` is illegal, so the body
    // lives in a function.
    const main = () => {
      if (!fs.existsSync(file)) return;

      let entries;
      try {
        entries = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (err) {
        console.error(`    warning: ${file} is unreadable (${err.message}); left alone`);
        return;
      }
      if (!Array.isArray(entries)) return;

      const kept = entries.filter(
        (e) => !(e && e.identifier && String(e.identifier.id).toLowerCase() === id.toLowerCase())
      );
      if (kept.length === entries.length) return;

      const tmp = `${file}.tendril-tmp`;
      fs.writeFileSync(tmp, JSON.stringify(kept));
      fs.renameSync(tmp, file);
      console.log(`    extensions.json: deregistered ${id}`);
    };
    main();
  ' "$1" "$2"
}

# tendril_extensions_json_has <extensions dir> <qualified id> -> status 0 when listed
tendril_extensions_json_has() {
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const [dir, id] = process.argv.slice(1);
    const file = path.join(dir, "extensions.json");
    if (!fs.existsSync(file)) process.exit(1);
    try {
      const entries = JSON.parse(fs.readFileSync(file, "utf8"));
      const found = Array.isArray(entries) && entries.some(
        (e) => e && e.identifier && String(e.identifier.id).toLowerCase() === id.toLowerCase()
      );
      process.exit(found ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' "$1" "$2"
}

# tendril_semver_gte <a> <b> -> 0 when a >= b
tendril_semver_gte() {
  node -e '
    const parse = (s) => String(s).split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
    const [a, b] = [parse(process.argv[1]), parse(process.argv[2])];
    for (let i = 0; i < 3; i++) {
      if (a[i] > b[i]) process.exit(0);
      if (a[i] < b[i]) process.exit(1);
    }
    process.exit(0);
  ' "$1" "$2"
}
