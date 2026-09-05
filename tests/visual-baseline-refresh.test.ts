import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface WorkflowDocument {
  on?: {
    schedule?: Array<{ cron?: string }>;
    workflow_dispatch?: unknown;
  };
  jobs?: Record<
    string,
    {
      needs?: string | string[];
      container?: {
        image?: string;
      };
      steps?: Array<{
        name?: string;
        run?: string;
      }>;
    }
  >;
}

interface PackageJson {
  scripts?: Record<string, string>;
}

function readWorkflow(filename: string): WorkflowDocument {
  const content = readFileSync(path.join(repoRoot, ".github", "workflows", filename), "utf8");
  return parseDocument(content).toJS() as WorkflowDocument;
}

function readPackageJson(): PackageJson {
  const content = readFileSync(path.join(repoRoot, "package.json"), "utf8");
  return JSON.parse(content);
}

function readPnpmWorkspace(): { overrides?: Record<string, string> } {
  const content = readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  return parseDocument(content).toJS() as { overrides?: Record<string, string> };
}

describe("visual baseline refresh workflow", () => {
  it("uses the same container image as the visual job in storybook-tests.yml", () => {
    const refreshWorkflow = readWorkflow("visual-baseline-refresh.yml");
    const storybookTests = readWorkflow("storybook-tests.yml");

    const refreshImage = refreshWorkflow.jobs?.refresh?.container?.image;
    const visualImage = storybookTests.jobs?.visual?.container?.image;

    expect(refreshImage).toBeDefined();
    expect(visualImage).toBeDefined();
    expect(refreshImage).toBe(visualImage);
  });

  it("container image tag matches the pinned Playwright version", () => {
    const refreshWorkflow = readWorkflow("visual-baseline-refresh.yml");
    const workspace = readPnpmWorkspace();

    const containerImage = refreshWorkflow.jobs?.refresh?.container?.image;
    expect(containerImage).toBeDefined();

    // Extract version from pnpm-workspace.yaml overrides
    const playwrightOverride = workspace.overrides?.["playwright@*"];
    const playwrightCoreOverride = workspace.overrides?.["playwright-core@*"];

    expect(playwrightOverride).toBeDefined();
    expect(playwrightCoreOverride).toBeDefined();
    expect(playwrightOverride).toBe(playwrightCoreOverride);

    // The image tag should start with v{version}-
    const expectedPrefix = `v${playwrightOverride}-`;
    expect(containerImage).toContain(expectedPrefix);
  });

  it("refresh step uses the non-ci update script", () => {
    const refreshWorkflow = readWorkflow("visual-baseline-refresh.yml");
    const packageJson = readPackageJson();

    // Find the regenerate baselines step
    const refreshJob = refreshWorkflow.jobs?.refresh;
    const regenerateStep = refreshJob?.steps?.find((step) => step.name === "Regenerate baselines");

    expect(regenerateStep).toBeDefined();
    expect(regenerateStep?.run).toBeDefined();
    expect(regenerateStep?.run).toContain("test-storybook:visual:update:ci");

    // Verify the script does not pass --ci flag
    const script = packageJson.scripts?.["test-storybook:visual:update:ci"];
    expect(script).toBeDefined();
    expect(script).toContain("--updateSnapshot");
    expect(script).not.toContain("test-storybook --ci");
  });

  it("refresh job has no needs dependency", () => {
    const refreshWorkflow = readWorkflow("visual-baseline-refresh.yml");
    const refreshJob = refreshWorkflow.jobs?.refresh;

    expect(refreshJob).toBeDefined();
    expect(refreshJob?.needs).toBeUndefined();
  });

  it("workflow has schedule with cron and workflow_dispatch", () => {
    const refreshWorkflow = readWorkflow("visual-baseline-refresh.yml");

    expect(refreshWorkflow.on?.schedule).toBeDefined();
    expect(refreshWorkflow.on?.schedule?.length).toBeGreaterThan(0);
    expect(refreshWorkflow.on?.schedule?.[0].cron).toBeDefined();

    expect(refreshWorkflow.on?.workflow_dispatch).toBeDefined();
  });
});
