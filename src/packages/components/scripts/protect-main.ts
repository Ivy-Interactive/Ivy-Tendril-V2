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
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function resolveRulesetPath(baseDir: string = repoRoot): string {
  const packageRulesetPath = join(baseDir, ".github/rulesets/main-require-green-suite.json");
  if (existsSync(packageRulesetPath)) {
    return packageRulesetPath;
  }
  const monorepoRulesetPath = join(
    baseDir,
    "../..",
    ".github/rulesets/main-require-green-suite.json",
  );
  if (existsSync(monorepoRulesetPath)) {
    return monorepoRulesetPath;
  }
  return packageRulesetPath;
}

const rulesetPath = resolveRulesetPath();

export const GITHUB_REMOTE_REGEX = /(?:github\.com[:/])(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/;

export function parseGitRemoteUrl(url: string): string | null {
  const match = GITHUB_REMOTE_REGEX.exec(url.trim());
  if (match?.groups?.owner && match?.groups?.repo) {
    return `${match.groups.owner}/${match.groups.repo}`;
  }
  return null;
}

export function isValidRepoSlug(slug: string): boolean {
  if (!slug) return false;
  const parts = slug.trim().split("/");
  if (parts.length !== 2) return false;
  const [owner, repo] = parts;
  if (!owner || !repo) return false;
  if (/\s/.test(owner) || /\s/.test(repo)) return false;
  return true;
}

export function parseRepoFromArgs(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--repo") {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        return next;
      }
      return "";
    }
    if (arg.startsWith("--repo=")) {
      return arg.slice("--repo=".length);
    }
  }
  return null;
}

export interface ResolveSlugOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  exec?: typeof execFileSync;
}

export function resolveRepositorySlug(argv?: string[], options?: ResolveSlugOptions): string {
  const args = argv ?? process.argv.slice(2);
  const env = options?.env ?? process.env;
  const cwd = options?.cwd;
  const exec = options?.exec ?? execFileSync;

  // 1. Command-line argument: --repo <owner/repo> or --repo=<owner/repo>
  const fromArgs = parseRepoFromArgs(args);
  if (fromArgs !== null) {
    if (isValidRepoSlug(fromArgs)) {
      return fromArgs;
    }
    console.error(
      "ERROR: Could not resolve GitHub repository slug. Provide --repo <owner/repo> or set GITHUB_REPOSITORY.",
    );
    process.exit(1);
  }

  // 2. Environment variable: GITHUB_REPOSITORY
  const fromEnv = env.GITHUB_REPOSITORY?.trim();
  if (fromEnv) {
    if (isValidRepoSlug(fromEnv)) {
      return fromEnv;
    }
    console.error(
      "ERROR: Could not resolve GitHub repository slug. Provide --repo <owner/repo> or set GITHUB_REPOSITORY.",
    );
    process.exit(1);
  }

  // 3. Git remote origin: git remote get-url origin
  try {
    const remoteUrl = exec("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
    }).trim();
    const fromGit = parseGitRemoteUrl(remoteUrl);
    if (fromGit && isValidRepoSlug(fromGit)) {
      return fromGit;
    }
  } catch {
    // Ignore git failure and fall back
  }

  // 4. GitHub CLI fallback: gh repo view --json nameWithOwner --jq .nameWithOwner
  try {
    const ghOutput = exec(
      "gh",
      ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
      {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        cwd,
      },
    ).trim();
    if (ghOutput && isValidRepoSlug(ghOutput)) {
      return ghOutput;
    }
  } catch {
    // Ignore gh failure and fall back
  }

  // 5. Error handling
  console.error(
    "ERROR: Could not resolve GitHub repository slug. Provide --repo <owner/repo> or set GITHUB_REPOSITORY.",
  );
  process.exit(1);
}

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

export function main(): void {
  const repoSlug = resolveRepositorySlug();
  const owner = repoSlug.split("/")[0];

  // First, try to GET existing rulesets to detect 403 early
  try {
    execFileSync("gh", ["api", `repos/${repoSlug}/rulesets`, "--jq", "."], {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
    });
  } catch (error) {
    const err = error as ExecFileError;
    const stderr = err.stderr ? String(err.stderr) : "";
    if (err.status === 1 && stderr.includes("HTTP 403")) {
      console.error("ERROR: Cannot activate ruleset - GitHub API returned 403 Forbidden.\n");
      console.error(
        `This repository (${repoSlug}) is private and the ${owner} organization is on the GitHub Free plan.`,
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
      ["api", "--method", "POST", `repos/${repoSlug}/rulesets`, "--input", "-"],
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
