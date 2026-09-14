#!/bin/bash
set -euo pipefail

TARGET_BUNDLE="${1:-}"

if [ -z "$TARGET_BUNDLE" ]; then
    echo "Usage: $0 <path-to-app-or-dmg>"
    exit 1
fi

echo "==> Validating Apple Signing and Notarization Credentials..."

if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
    echo "ERROR: APPLE_SIGNING_IDENTITY environment variable is not set." >&2
    echo "Developer ID Application certificate is required for macOS code signing." >&2
    exit 1
fi

if [ -z "${APPLE_ID:-}" ] || [ -z "${APPLE_PASSWORD:-}" ] || [ -z "${APPLE_TEAM_ID:-}" ]; then
    echo "ERROR: Missing Apple Notarization credentials." >&2
    echo "APPLE_ID, APPLE_PASSWORD, and APPLE_TEAM_ID are required for notarytool submission." >&2
    exit 1
fi

echo "==> Signing $TARGET_BUNDLE with identity '$APPLE_SIGNING_IDENTITY'..."
codesign --force --deep --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$TARGET_BUNDLE"

echo "==> Submitting $TARGET_BUNDLE for notarization via xcrun notarytool..."
xcrun notarytool submit "$TARGET_BUNDLE" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait

echo "==> Stapling notarization ticket..."
xcrun stapler staple "$TARGET_BUNDLE"

echo "==> Code signing and notarization completed successfully."
