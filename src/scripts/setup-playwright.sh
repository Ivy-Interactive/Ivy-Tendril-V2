#!/usr/bin/env bash
set -euo pipefail

echo "=== Setting up Playwright and Browser Dependencies ==="

# 1. Ensure node_modules and CLI are present
if ! command -v pnpm >/dev/null 2>&1; then
  echo "Error: pnpm is required but not installed." >&2
  exit 1
fi

# 2. Run browser installation with dependencies
echo "Installing Chromium browser binaries and system libraries..."
if [[ "${1:-}" == "--all" ]]; then
  pnpm exec playwright install --with-deps
else
  pnpm exec playwright install --with-deps chromium
fi

# 3. Verify installation with a headless smoke check
echo "Verifying Playwright browser launch..."
node -e '
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent("<html><body><h1>Tendril Screenshot OK</h1></body></html>");
  const buffer = await page.screenshot();
  if (!buffer || buffer.length === 0) {
    throw new Error("Screenshot buffer is empty");
  }
  await browser.close();
  console.log("Playwright browser smoke check passed: " + buffer.length + " bytes captured.");
})().catch(err => {
  console.error("Playwright smoke check failed:", err);
  process.exit(1);
});
'

echo "Playwright environment setup completed successfully."
