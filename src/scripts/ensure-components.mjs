#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const componentsDist = path.resolve(__dirname, "../packages/components/dist");
const distIndex = path.join(componentsDist, "index.mjs");
const distStyle = path.join(componentsDist, "style.css");

if (!fs.existsSync(distIndex) || !fs.existsSync(distStyle)) {
  console.log("\x1b[36m[setup] Building @ivy-interactive/components (dist missing)...\x1b[0m");
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
