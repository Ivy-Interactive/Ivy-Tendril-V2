/**
 * Activates the main branch protection ruleset by POSTing the staged configuration to GitHub.
 *
 * The ruleset requires green CI status checks (Lint & Types, Package Build, Unit Tests,
 * Merge Resolution Guard) plus a non-fast-forward rule. It cannot be activated on private repos
 * in free GitHub org plans — the API returns 403.
 *
 * Node builtins and `gh` only, matching verify-merge-resolution.mjs's dependency-free style.
 *
 * Usage:
 *   node scripts/protect-main.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const rulesetPath = join(repoRoot, ".github/rulesets/main-require-green-suite.json");

function main() {
  // First, try to GET existing rulesets to detect 403 early
  try {
    execFileSync("gh", ["api", "repos/SpaceCorps/components-storybook/rulesets", "--jq", "."], {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
    });
  } catch (error) {
    if (error.status === 1 && error.stderr?.includes("HTTP 403")) {
      console.error("ERROR: Cannot activate ruleset — GitHub API returned 403 Forbidden.\n");
      console.error(
        "This repository is private and the SpaceCorps organization is on the GitHub Free plan.",
      );
      console.error("Rulesets and branch protection require GitHub Pro or higher.\n");
      console.error("To activate branch protection, either:");
      console.error(
        "  1. Make this repository public (Settings → Danger Zone → Change visibility)",
      );
      console.error("  2. Upgrade the organization to GitHub Team or Enterprise\n");
      console.error(
        "The ruleset configuration is staged in .github/rulesets/main-require-green-suite.json",
      );
      console.error("and will be activated automatically when one of the above conditions is met.");
      process.exit(1);
    }
    throw error;
  }

  // Read the staged ruleset
  const rulesetBody = readFileSync(rulesetPath, "utf8");

  // POST the ruleset
  try {
    const output = execFileSync(
      "gh",
      ["api", "--method", "POST", "repos/SpaceCorps/components-storybook/rulesets", "--input", "-"],
      { encoding: "utf8", input: rulesetBody, stdio: ["pipe", "pipe", "pipe"] },
    );
    const created = JSON.parse(output);
    console.log(
      `✓ Branch protection ruleset activated (ID: ${created.id}, name: "${created.name}")`,
    );
    console.log(
      `  Required status checks: ${created.rules
        .find((r) => r.type === "required_status_checks")
        ?.parameters.required_status_checks.map((c) => c.context)
        .join(", ")}`,
    );
  } catch (error) {
    console.error(`ERROR: Failed to create ruleset: ${error.message}`);
    if (error.stderr) {
      console.error(error.stderr);
    }
    process.exit(1);
  }
}

main();
