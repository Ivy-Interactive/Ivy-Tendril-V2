#!/bin/bash
set -euo pipefail

echo "==> Running Release Packaging Smoke Tests..."

# 1. Verify the sidecars this host's build needs exist in src-tauri/binaries/
#
# Only the *host* triple, deliberately. Tauri resolves an externalBin by target triple and a build
# only stages the triple it is building, so the other three were dead weight - and when they were
# committed placeholders, four 163-byte "stub running" shell scripts rode into every installer. The
# release workflow builds `tendril-<host>` and fetches `opencode-<host>` per runner; this checks the
# same pair.
echo "==> Checking companion sidecar binaries..."
SIDECAR_DIR="src-tauri/binaries"
if [ ! -d "$SIDECAR_DIR" ]; then
    echo "ERROR: Sidecar directory $SIDECAR_DIR missing." >&2
    exit 1
fi

HOST_TRIPLE="$(rustc -vV | sed -n 's|host: ||p')"
case "$HOST_TRIPLE" in
    *windows*) HOST_EXE=".exe" ;;
    *)         HOST_EXE="" ;;
esac

REQUIRED_SIDECARS=(
    "tendril-${HOST_TRIPLE}${HOST_EXE}"
    "opencode-${HOST_TRIPLE}${HOST_EXE}"
)

for sidecar in "${REQUIRED_SIDECARS[@]}"; do
    path="$SIDECAR_DIR/$sidecar"
    if [ ! -f "$path" ]; then
        echo "ERROR: Missing required sidecar: $path" >&2
        case "$sidecar" in
            opencode-*) echo "       Run: ./scripts/release/fetch-opencode-sidecar.sh" >&2 ;;
            tendril-*)  echo "       Run: cargo build --release --bin tendril, then copy it here" >&2 ;;
        esac
        exit 1
    fi
    echo "  [OK] Found sidecar: $sidecar"
done

# 2. Verify executable permissions (a sidecar Tauri cannot exec fails at runtime, not at bundle time)
if [ -z "$HOST_EXE" ]; then
    for sidecar in "${REQUIRED_SIDECARS[@]}"; do
        if [ -x "$SIDECAR_DIR/$sidecar" ]; then
            echo "  [OK] Unix permissions executable: $sidecar"
        else
            echo "ERROR: $sidecar is not executable." >&2
            exit 1
        fi
    done
fi

# 3. Verify tauri.conf.json externalBin bundle configuration
echo "==> Validating tauri.conf.json bundle configuration..."
grep -q '"externalBin"' src-tauri/tauri.conf.json || {
    echo "ERROR: externalBin is not configured in tauri.conf.json" >&2
    exit 1
}
for entry in "binaries/tendril" "binaries/opencode"; do
    grep -q "\"$entry\"" src-tauri/tauri.conf.json || {
        echo "ERROR: $entry is not listed in externalBin" >&2
        exit 1
    }
done
echo "  [OK] tauri.conf.json externalBin configured correctly"

# 4. Verify release signing stubs exist and are executable
echo "==> Validating signing stubs..."
test -x scripts/release/sign-macos.sh || {
    echo "ERROR: sign-macos.sh is missing or not executable" >&2
    exit 1
}
test -f scripts/release/sign-windows.ps1 || {
    echo "ERROR: sign-windows.ps1 is missing" >&2
    exit 1
}
test -x scripts/release/generate-checksums.sh || {
    echo "ERROR: generate-checksums.sh is missing or not executable" >&2
    exit 1
}
echo "  [OK] Release signing stubs present"

# 5. Verify SHA-256 checksum manifest generation
echo "==> Testing checksums generation..."
TEST_DIST_DIR=$(mktemp -d)
echo "test artifact binary payload" > "$TEST_DIST_DIR/Tendril-App.dmg"
./scripts/release/generate-checksums.sh "$TEST_DIST_DIR" SHA256SUMS.txt
test -s "$TEST_DIST_DIR/SHA256SUMS.txt" || {
    echo "ERROR: Checksum file was empty" >&2
    rm -rf "$TEST_DIST_DIR"
    exit 1
}
grep -q "Tendril-App.dmg" "$TEST_DIST_DIR/SHA256SUMS.txt" || {
    echo "ERROR: Manifest missing artifact hash" >&2
    rm -rf "$TEST_DIST_DIR"
    exit 1
}
rm -rf "$TEST_DIST_DIR"
echo "  [OK] Checksum manifest generation verified"

echo "==> Release packaging smoke test completed successfully!"
