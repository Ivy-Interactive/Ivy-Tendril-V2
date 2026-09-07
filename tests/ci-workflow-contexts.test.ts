import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ciWorkflowPath = resolve(repoRoot, ".github/workflows/ci.yml");
const rulesetPath = resolve(repoRoot, ".github/rulesets/main-require-green-suite.json");

interface GitHubWorkflow {
  jobs: Record<
    string,
    {
      name?: string;
      needs?: string | string[];
      steps?: Array<{
        name?: string;
        uses?: string;
        with?: Record<string, unknown>;
        run?: string;
        if?: string;
      }>;
    }
  >;
}

interface GitHubRuleset {
  rules: Array<{
    type: string;
    parameters?: {
      strict_required_status_checks_policy?: boolean;
      required_status_checks?: Array<{
        context: string;
        integration_id: null | number;
      }>;
    };
  }>;
}

function readWorkflow(): GitHubWorkflow {
  const content = readFileSync(ciWorkflowPath, "utf8");
  return parse(content) as GitHubWorkflow;
}

function readRuleset(): GitHubRuleset {
  const content = readFileSync(rulesetPath, "utf8");
  return JSON.parse(content) as GitHubRuleset;
}

describe("CI workflow and ruleset alignment", () => {
  it("every ruleset context resolves to a job in ci.yml", () => {
    const workflow = readWorkflow();
    const ruleset = readRuleset();

    const statusCheckRule = ruleset.rules.find((r) => r.type === "required_status_checks");
    expect(statusCheckRule).toBeDefined();

    const requiredContexts =
      statusCheckRule?.parameters?.required_status_checks?.map((c) => c.context) ?? [];
    expect(requiredContexts.length).toBeGreaterThan(0);

    const jobContexts = Object.entries(workflow.jobs).map(([id, job]) => {
      return job.name ?? id;
    });

    for (const context of requiredContexts) {
      expect(jobContexts).toContain(context);
    }
  });

  it("strict_required_status_checks_policy is true", () => {
    const ruleset = readRuleset();

    const statusCheckRule = ruleset.rules.find((r) => r.type === "required_status_checks");
    expect(statusCheckRule).toBeDefined();
    expect(statusCheckRule?.parameters?.strict_required_status_checks_policy).toBe(true);
  });

  it("no job or step in ci.yml sets if: always()", () => {
    const workflow = readWorkflow();

    for (const [, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.if) {
          expect(step.if).not.toContain("always()");
        }
      }
    }
  });

  it("no actions/checkout step in ci.yml sets a ref override", () => {
    const workflow = readWorkflow();

    for (const [, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith("actions/checkout")) {
          expect(step.with?.ref).toBeUndefined();
        }
      }
    }
  });

  it("Lint & Types, Package Build, and Unit Tests each run exactly one vp command", () => {
    const workflow = readWorkflow();

    const expectedCommands: Record<string, string> = {
      "Lint & Types": "vp check",
      "Package Build": "vp pack",
      "Unit Tests": "vp test",
    };

    for (const [expectedName, expectedCommand] of Object.entries(expectedCommands)) {
      const job = Object.values(workflow.jobs).find((j) => j.name === expectedName);
      expect(job).toBeDefined();

      const vpSteps = job?.steps?.filter((step) => step.run?.includes("vp ")) ?? [];
      expect(vpSteps.length).toBe(1);

      const actualCommand = vpSteps[0]?.run?.trim();
      expect(actualCommand).toBe(expectedCommand);
    }
  });

  it("Unit Tests job declares needs build and contains an actions/download-artifact step", () => {
    const workflow = readWorkflow();
    const testJob = workflow.jobs.test;
    expect(testJob).toBeDefined();

    const needs = Array.isArray(testJob?.needs) ? testJob.needs : [testJob?.needs];
    expect(needs).toContain("build");

    const downloadStep = testJob?.steps?.find((step) =>
      step.uses?.startsWith("actions/download-artifact"),
    );
    expect(downloadStep).toBeDefined();
    expect(downloadStep?.with?.name).toBe("dist");
    expect(downloadStep?.with?.path).toBe("dist/");
  });
});
