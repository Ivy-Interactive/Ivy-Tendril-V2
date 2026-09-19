#!/usr/bin/env bash
# End-to-end test of the VS Code-family install tooling for the Ivy Tendril
# extension.
#
# Everything runs against a throwaway home directory and a throwaway extensions
# directory, so no real IDE and nothing under the developer's $HOME is touched.
#
# Usage:
#   src/scripts/test-extension-install.sh [--vsix]
#
#   --vsix   also exercise the VSIX build + CLI install path. Requires an IDE
#            CLI and the extension's node_modules; skipped by default because
#            it is slower.
#
# Exits 0 on success, 1 on any failure.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
skill_scripts="$repo_root/src/skills/tendril-extension/scripts"
extension_dir="$repo_root/src/extensions/vscode"

with_vsix=0
[ "${1:-}" = "--vsix" ] && with_vsix=1

failed=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failed=1; }

fake_home="$(mktemp -d)/home"
cleanup() { rm -rf "$(dirname "$fake_home")"; }
trap cleanup EXIT

echo "==> Testing extension install tooling"
echo "    repo      : $repo_root"
echo "    fake home : $fake_home"

# A synthetic family: two IDEs the registry knows, and one it does not. Each
# starts with a populated extensions.json, which is the state a real
# installation is always in and the case a bare `ln -s` gets wrong.
seed_index() {
  mkdir -p "$1"
  cat > "$1/extensions.json" <<'JSON'
[{"identifier":{"id":"someone.other"},"version":"1.0.0","location":{"$mid":1,"path":"/tmp/someone.other-1.0.0","scheme":"file"},"relativeLocation":"someone.other-1.0.0"}]
JSON
}
seed_index "$fake_home/.vscode/extensions"
seed_index "$fake_home/.cursor/extensions"
seed_index "$fake_home/.someide/extensions"

slug="$(cd "$repo_root" && node -e '
  const p = require("./src/extensions/vscode/package.json");
  process.stdout.write(`${p.publisher}.${p.name}-${p.version}`);
')"
qualified="${slug%-*}"

# --- 1. manifest -------------------------------------------------------------
echo "--- Step 1: manifest ---"
if pnpm tsx "$skill_scripts/check-manifest.ts" >/dev/null 2>&1; then
  pass "manifest is valid and consistent with the engine floor"
else
  pnpm tsx "$skill_scripts/check-manifest.ts" || true
  fail "check-manifest.ts rejected src/extensions/vscode/package.json"
fi

# --- 2. build ----------------------------------------------------------------
echo "--- Step 2: bundle ---"
main_rel="$(node -e 'process.stdout.write(require(process.argv[1]).main)' "$extension_dir/package.json")"
if [ ! -f "$extension_dir/$main_rel" ]; then
  (cd "$extension_dir" && pnpm run build >/dev/null 2>&1)
fi
if [ -f "$extension_dir/$main_rel" ]; then
  pass "bundle present at $main_rel"
else
  fail "could not build $main_rel"
fi

# --- 3. detection ------------------------------------------------------------
echo "--- Step 3: detection ---"
detected="$("$skill_scripts/list-ides.sh" --home "$fake_home" 2>/dev/null)"
for id in vscode cursor; do
  if printf '%s\n' "$detected" | grep -qE "^$id[[:space:]]"; then
    pass "detected $id under the fake home"
  else
    fail "did not detect $id under the fake home"
  fi
done
if printf '%s\n' "$detected" | grep -q "\.someide/extensions"; then
  pass "reported the unrecognised .someide extensions directory"
else
  fail "did not report the unrecognised .someide extensions directory"
fi

# --- 4. useful failure for a missing IDE ------------------------------------
echo "--- Step 4: missing IDE ---"
out="$("$skill_scripts/install-extension.sh" --home "$fake_home" --ide positron --no-build 2>&1)"
if [ $? -eq 0 ]; then
  fail "installing into an absent IDE should fail"
elif printf '%s\n' "$out" | grep -q "none of these IDEs is installed"; then
  pass "absent IDE fails with an actionable message"
else
  fail "absent IDE failed without explaining why: $out"
fi

out="$("$skill_scripts/install-extension.sh" --home "$fake_home" --ide nope --no-build 2>&1)"
if printf '%s\n' "$out" | grep -q "unknown IDE id"; then
  pass "unknown IDE id is rejected with the known list"
else
  fail "unknown IDE id was not rejected clearly"
fi

# --- 5. symlink install ------------------------------------------------------
echo "--- Step 5: symlink install ---"
if "$skill_scripts/install-extension.sh" --home "$fake_home" --all --no-build >/dev/null 2>&1; then
  pass "install --all succeeded"
else
  fail "install --all failed"
fi

for ide in .vscode .cursor; do
  dir="$fake_home/$ide/extensions"
  if [ -L "$dir/$slug" ]; then
    pass "$ide: symlink created"
  else
    fail "$ide: no symlink at $dir/$slug"
  fi
  if node -e '
      const entries = require(process.argv[1]);
      process.exit(entries.some((e) => e.identifier.id === process.argv[2]) ? 0 : 1);
    ' "$dir/extensions.json" "$qualified"; then
    pass "$ide: registered in extensions.json"
  else
    fail "$ide: missing from extensions.json (the IDE would ignore the install)"
  fi
  # The whole point of upserting rather than deleting the index.
  if node -e '
      const entries = require(process.argv[1]);
      process.exit(entries.some((e) => e.identifier.id === "someone.other") ? 0 : 1);
    ' "$dir/extensions.json"; then
    pass "$ide: other extensions were left in the index"
  else
    fail "$ide: clobbered another extension's index entry"
  fi
done

# --- 6. explicit extensions dir ---------------------------------------------
echo "--- Step 6: --extensions-dir ---"
if "$skill_scripts/install-extension.sh" --extensions-dir "$fake_home/.someide/extensions" \
     --no-build >/dev/null 2>&1 && [ -L "$fake_home/.someide/extensions/$slug" ]; then
  pass "--extensions-dir installs into an IDE the registry does not know"
else
  fail "--extensions-dir install failed"
fi

# --- 7. verify ---------------------------------------------------------------
echo "--- Step 7: verify.ts ---"
if pnpm tsx "$skill_scripts/verify.ts" --home "$fake_home" --all >/dev/null 2>&1; then
  pass "verify.ts --all passes against the fake home"
else
  pnpm tsx "$skill_scripts/verify.ts" --home "$fake_home" --all || true
  fail "verify.ts --all failed"
fi

# verify.ts must actually notice a broken install, not just rubber-stamp it.
node -e '
  const fs = require("node:fs");
  const file = process.argv[1];
  const entries = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify(entries.filter((e) => e.identifier.id !== process.argv[2])));
' "$fake_home/.vscode/extensions/extensions.json" "$qualified"
if pnpm tsx "$skill_scripts/verify.ts" --home "$fake_home" --ide vscode >/dev/null 2>&1; then
  fail "verify.ts passed an install missing from extensions.json"
else
  pass "verify.ts catches an install missing from extensions.json"
fi

# --- 8. VSIX (optional) ------------------------------------------------------
if [ "$with_vsix" -eq 1 ]; then
  echo "--- Step 8: VSIX ---"
  vsix="$(dirname "$fake_home")/tendril.vsix"
  if "$skill_scripts/package-vsix.sh" --out "$vsix" --no-build >/dev/null 2>&1 && [ -f "$vsix" ]; then
    pass "package-vsix.sh produced $vsix"
  else
    fail "package-vsix.sh failed"
  fi

  if [ -f "$vsix" ]; then
    for id in $(bash -c ". '$skill_scripts/ide-registry.sh'; TENDRIL_IDE_HOME='$HOME' tendril_ide_detected"); do
      cli="$(bash -c ". '$skill_scripts/ide-registry.sh'; tendril_ide_cli '$id'" 2>/dev/null)"
      [ -n "$cli" ] || continue
      dir="$fake_home/vsix-$id/extensions"
      mkdir -p "$dir"
      if "$skill_scripts/install-extension.sh" --extensions-dir "$dir" --ide "$id" \
           --vsix "$vsix" --no-build >/dev/null 2>&1; then
        pass "$id: VSIX installed into a temp extensions dir"
      else
        fail "$id: VSIX install failed"
      fi
    done
  fi
else
  echo "--- Step 8: VSIX (skipped; pass --vsix to run) ---"
fi

# --- 9. uninstall ------------------------------------------------------------
echo "--- Step 9: uninstall ---"
"$skill_scripts/install-extension.sh" --home "$fake_home" --all --no-build >/dev/null 2>&1
if "$skill_scripts/uninstall-extension.sh" --home "$fake_home" --all >/dev/null 2>&1; then
  pass "uninstall --all succeeded"
else
  fail "uninstall --all failed"
fi
for ide in .vscode .cursor; do
  dir="$fake_home/$ide/extensions"
  if [ -e "$dir/$slug" ] || [ -L "$dir/$slug" ]; then
    fail "$ide: $slug survived the uninstall"
  else
    pass "$ide: $slug removed"
  fi
  if node -e '
      const entries = require(process.argv[1]);
      process.exit(entries.some((e) => e.identifier.id === "someone.other") ? 0 : 1);
    ' "$dir/extensions.json"; then
    pass "$ide: unrelated index entry survived the uninstall"
  else
    fail "$ide: uninstall removed an unrelated index entry"
  fi
done

# Unlinking must never follow the link into the checkout.
if [ -f "$extension_dir/package.json" ] && [ -f "$extension_dir/src/extension.ts" ]; then
  pass "the extension checkout is intact"
else
  fail "the extension checkout was damaged"
fi

# Second run must be a no-op, not an error.
if "$skill_scripts/uninstall-extension.sh" --home "$fake_home" --all >/dev/null 2>&1; then
  pass "uninstall is idempotent"
else
  fail "a second uninstall failed"
fi

echo
if [ "$failed" -eq 0 ]; then
  echo "==> ALL EXTENSION INSTALL TESTS PASSED"
  exit 0
fi
echo "==> EXTENSION INSTALL TESTS FAILED"
exit 1
