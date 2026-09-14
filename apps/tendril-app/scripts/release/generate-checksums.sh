#!/bin/bash
set -euo pipefail

DIST_DIR="${1:-src-tauri/target/release/bundle}"
OUTPUT_FILE="${2:-SHA256SUMS.txt}"

if [ ! -d "$DIST_DIR" ]; then
    echo "Directory $DIST_DIR does not exist. Creating directory for artifacts."
    mkdir -p "$DIST_DIR"
fi

echo "==> Generating SHA-256 Checksums for release artifacts in $DIST_DIR..."

cd "$DIST_DIR"
if command -v sha256sum >/dev/null 2>&1; then
    find . -type f \( -name "*.dmg" -o -name "*.app" -o -name "*.exe" -o -name "*.msi" -o -name "*.deb" -o -name "*.AppImage" -o -name "*.tar.gz" -o -name "*.zip" \) -exec sha256sum {} + > "$OUTPUT_FILE" 2>/dev/null || true
elif command -v shasum >/dev/null 2>&1; then
    find . -type f \( -name "*.dmg" -o -name "*.app" -o -name "*.exe" -o -name "*.msi" -o -name "*.deb" -o -name "*.AppImage" -o -name "*.tar.gz" -o -name "*.zip" \) -exec shasum -a 256 {} + > "$OUTPUT_FILE" 2>/dev/null || true
fi

if [ ! -s "$OUTPUT_FILE" ]; then
    find . -maxdepth 2 -type f ! -name "$OUTPUT_FILE" -exec shasum -a 256 {} + > "$OUTPUT_FILE" 2>/dev/null || true
fi

echo "==> Checksums written to $DIST_DIR/$OUTPUT_FILE:"
cat "$OUTPUT_FILE"
