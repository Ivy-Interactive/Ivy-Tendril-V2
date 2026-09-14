import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Storybook test runner expect types", () => {
  it("tsconfig.json includes jest-image-snapshot in types array", () => {
    const tsconfigPath = path.join(repoRoot, "tsconfig.json");
    const tsconfigContent = readFileSync(tsconfigPath, "utf-8");
    const tsconfig = JSON.parse(tsconfigContent);

    expect(tsconfig.compilerOptions.types).toContain("jest-image-snapshot");
  });

  it("test-runner.ts contains no @ts-expect-error directives", () => {
    const testRunnerPath = path.join(repoRoot, ".storybook", "test-runner.ts");
    const testRunnerContent = readFileSync(testRunnerPath, "utf-8");

    expect(testRunnerContent).not.toMatch(/@ts-expect-error/);
  });

  it("test-runner.ts declares no local expect constant", () => {
    const testRunnerPath = path.join(repoRoot, ".storybook", "test-runner.ts");
    const testRunnerContent = readFileSync(testRunnerPath, "utf-8");

    expect(testRunnerContent).not.toMatch(/declare\s+const\s+expect/);
  });
});
