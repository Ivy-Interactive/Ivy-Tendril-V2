#!/bin/bash
set -euo pipefail

echo "==> Running Release Packaging Smoke Tests..."

# 1. Verify companion sidecars exist in src-tauri/binaries/
echo "==> Checking companion sidecar binaries..."
SIDECAR_DIR="src-tauri/binaries"
if [ ! -d "$SIDECAR_DIR" ]; then
    echo "ERROR: Sidecar directory $SIDECAR_DIR missing." >&2
    exit 1
fi

REQUIRED_SIDECARS=(
    "tendril-aarch64-apple-darwin"
    "tendril-x86_64-apple-darwin"
    "tendril-x86_64-unknown-linux-gnu"
    "tendril-x86_64-pc-windows-msvc.exe"
)

for sidecar in "${REQUIRED_SIDECARS[@]}"; do
    path="$SIDECAR_DIR/$sidecar"
    if [ ! -f "$path" ]; then
        echo "ERROR: Missing required companion binary: $path" >&2
        exit 1
    fi
    echo "  [OK] Found sidecar: $sidecar"
done

# 2. Verify binary executable permissions on unix sidecars
if [ -x "$SIDECAR_DIR/tendril-aarch64-apple-darwin" ]; then
    echo "  [OK] Unix permissions executable: tendril-aarch64-apple-darwin"
else
    echo "ERROR: tendril-aarch64-apple-darwin is not executable." >&2
    exit 1
fi

# 3. Verify tauri.conf.json externalBin bundle configuration
echo "==> Validating tauri.conf.json bundle configuration..."
grep -q '"externalBin"' src-tauri/tauri.conf.json || {
    echo "ERROR: externalBin is not configured in tauri.conf.json" >&2
    exit 1
}
grep -q '"binaries/tendril"' src-tauri/tauri.conf.json || {
    echo "ERROR: binaries/tendril is not listed in externalBin" >&2
    exit 1
}
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
