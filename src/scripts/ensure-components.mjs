#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const componentsRoot = path.resolve(__dirname, "../packages/components");
const componentsSrc = path.join(componentsRoot, "src");
const componentsDist = path.join(componentsRoot, "dist");
const distIndex = path.join(componentsDist, "index.mjs");
const distStyle = path.join(componentsDist, "style.css");

/**
 * The app imports `@ivy-interactive/components` through its `exports` map, which points at `dist/` -
 * never at `src/`. Vite therefore has no way to notice a source edit, and this script is the only
 * thing standing between an edited component and a dev session still running the previous build.
 *
 * It used to build only when `dist/` was absent, which made every subsequent edit invisible: the
 * fix was in the source, the running app had the stale bundle, and the bug looked like it had come
 * back from the dead. Presence is the wrong question; freshness is the right one.
 */

/** Newest mtime under `dir`, skipping nothing - a stale bundle is worse than a redundant build. */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

function staleReason() {
  if (!fs.existsSync(distIndex) || !fs.existsSync(distStyle)) return "dist missing";

  // Both entry points matter: `style.css` is emitted separately, so a CSS-only edit moves one and
  // not the other. Taking the older of the two is what makes a CSS change trigger a rebuild.
  const built = Math.min(fs.statSync(distIndex).mtimeMs, fs.statSync(distStyle).mtimeMs);

  // `package.json` counts too - its `exports` map and dependency set change what the build emits.
  const sources = Math.max(
    newestMtime(componentsSrc),
    fs.statSync(path.join(componentsRoot, "package.json")).mtimeMs,
  );

  return sources > built ? "sources changed" : null;
}

const reason = staleReason();
if (reason) {
  console.log(`\x1b[36m[setup] Building @ivy-interactive/components (${reason})...\x1b[0m`);
  try {
    execSync("pnpm --filter @ivy-interactive/components build", {
      stdio: "inherit",
      cwd: repoRoot,
    });
  } catch (err) {
    console.error("\x1b[31m[setup] Failed to build @ivy-interactive/components:\x1b[0m", err);
    process.exit(1);
  }
}
