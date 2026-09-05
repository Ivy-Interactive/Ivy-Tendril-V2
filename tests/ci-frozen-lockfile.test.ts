import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = resolve(repoRoot, ".github/workflows");

interface GitHubWorkflow {
  jobs: Record<
    string,
    {
      name?: string;
      steps?: Array<{
        name?: string;
        uses?: string;
        with?: Record<string, unknown>;
        run?: string;
      }>;
    }
  >;
}

/**
 * Workflows that legitimately rewrite the lockfile and must NOT use --frozen-lockfile.
 * Empty today — a future workflow that needs to opt out must be added here.
 */
const UNFROZEN_ALLOWLIST: readonly string[] = [];

function readWorkflow(filename: string): GitHubWorkflow {
  const content = readFileSync(resolve(workflowsDir, filename), "utf8");
  return parse(content) as GitHubWorkflow;
}

function getAllWorkflowFiles(): string[] {
  return readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
}

describe("CI frozen lockfile enforcement", () => {
  it("every voidzero-dev/setup-vp step installs with --frozen-lockfile or disables install", () => {
    const workflowFiles = getAllWorkflowFiles();
    const violations: string[] = [];

    for (const file of workflowFiles) {
      if (UNFROZEN_ALLOWLIST.includes(file)) {
        continue;
      }

      const workflow = readWorkflow(file);

      for (const [jobId, job] of Object.entries(workflow.jobs)) {
        for (const step of job.steps ?? []) {
          if (step.uses?.startsWith("voidzero-dev/setup-vp")) {
            const runInstall = step.with?.["run-install"];

            // If run-install is explicitly false, skip
            if (runInstall === false || runInstall === "false") {
              continue;
            }

            // Otherwise, run-install must contain --frozen-lockfile
            const runInstallStr =
              typeof runInstall === "string" ? runInstall : JSON.stringify(runInstall ?? "");
            if (!runInstallStr.includes("--frozen-lockfile")) {
              violations.push(
                `${file} / job:${jobId} / step:"${step.name ?? "(unnamed)"}" — voidzero-dev/setup-vp without --frozen-lockfile`,
              );
            }
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(`Found ${violations.length} violation(s):\n${violations.join("\n")}`);
    }
  });

  it("every pnpm install or vp install command uses --frozen-lockfile", () => {
    const workflowFiles = getAllWorkflowFiles();
    const violations: string[] = [];

    for (const file of workflowFiles) {
      if (UNFROZEN_ALLOWLIST.includes(file)) {
        continue;
      }

      const workflow = readWorkflow(file);

      for (const [jobId, job] of Object.entries(workflow.jobs)) {
        for (const step of job.steps ?? []) {
          if (!step.run) {
            continue;
          }

          const lines = step.run.split("\n");
          for (const line of lines) {
            // Match "pnpm install" or "vp install" as standalone commands
            // (not "pnpm run install" or similar)
            const match = line.match(/\b(pnpm|vp)\s+install\b/);
            if (match && !line.includes("--frozen-lockfile")) {
              violations.push(
                `${file} / job:${jobId} / step:"${step.name ?? "(unnamed)"}" — ${match[0]} without --frozen-lockfile`,
              );
            }
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(`Found ${violations.length} violation(s):\n${violations.join("\n")}`);
    }
  });

  it("UNFROZEN_ALLOWLIST is empty", () => {
    expect(UNFROZEN_ALLOWLIST.length).toBe(0);
  });
});
