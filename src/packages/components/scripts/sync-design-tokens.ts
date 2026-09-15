/**
 * Regenerates the semantic palette in `src/styles/tokens.css` from `@ivy-interactive/ivy-design-system`,
 * so V2 renders the same colours as the C# app instead of drifting into its own palette.
 *
 *   pnpm sync:tokens           rewrite the generated regions
 *   pnpm sync:tokens --check   fail if the file is out of date (used by the test suite)
 */
import { writeFileSync } from "node:fs";
import { readTokensCss, syncManagedRegions, tokensCssPath } from "./design-tokens.ts";

const check = process.argv.includes("--check");
const current = readTokensCss();
const synced = syncManagedRegions(current);

if (current === synced) {
  console.log(`tokens.css is up to date with the design system.`);
  process.exit(0);
}

if (check) {
  console.error(
    `tokens.css is out of date with @ivy-interactive/ivy-design-system.\nRun: pnpm sync:tokens`,
  );
  process.exit(1);
}

writeFileSync(tokensCssPath(), synced);
console.log(`Updated ${tokensCssPath()} from the design system.`);
