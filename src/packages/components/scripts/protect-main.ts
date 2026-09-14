/**
 * Activates the main branch protection ruleset by POSTing the staged configuration to GitHub.
 *
 * The ruleset requires green CI status checks (Lint & Types, Package Build, Unit Tests,
 * Merge Resolution Guard) plus a non-fast-forward rule. It cannot be activated on private repos
 * in free GitHub org plans - the API returns 403.
 *
 * Node builtins and `gh` only, matching verify-merge-resolution.ts's dependency-free style.
 *
 * Usage:
 *   tsx scripts/protect-main.ts
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const rulesetPath = join(repoRoot, ".github/rulesets/main-require-green-suite.json");

interface StatusCheckRule {
  type: string;
  parameters?: {
    required_status_checks: Array<{ context: string }>;
  };
}

interface RulesetResponse {
  id: number;
  name: string;
  rules: StatusCheckRule[];
}

interface ExecFileError extends Error {
  status?: number;
  stderr?: string | Buffer;
}

function main(): void {
  // First, try to GET existing rulesets to detect 403 early
  try {
    execFileSync("gh", ["api", "repos/SpaceCorps/components-storybook/rulesets", "--jq", "."], {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
    });
  } catch (error) {
    const err = error as ExecFileError;
    const stderr = err.stderr ? String(err.stderr) : "";
    if (err.status === 1 && stderr.includes("HTTP 403")) {
      console.error("ERROR: Cannot activate ruleset - GitHub API returned 403 Forbidden.\n");
      console.error(
        "This repository is private and the SpaceCorps organization is on the GitHub Free plan.",
      );
      console.error("Rulesets and branch protection require GitHub Pro or higher.\n");
      console.error("To activate branch protection, either:");
      console.error(
        "  1. Make this repository public (Settings -> Danger Zone -> Change visibility)",
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
    const created = JSON.parse(output) as RulesetResponse;
    console.log(
      `✓ Branch protection ruleset activated (ID: ${created.id}, name: "${created.name}")`,
    );
    const requiredChecks =
      created.rules
        .find((r) => r.type === "required_status_checks")
        ?.parameters?.required_status_checks.map((c) => c.context)
        .join(", ") ?? "";
    console.log(`  Required status checks: ${requiredChecks}`);
  } catch (error) {
    const err = error as ExecFileError;
    console.error(`ERROR: Failed to create ruleset: ${err.message}`);
    if (err.stderr) {
      console.error(String(err.stderr));
    }
    process.exit(1);
  }
}

main();
