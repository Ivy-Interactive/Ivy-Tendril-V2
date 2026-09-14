import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspacePath = resolve(repoRoot, "pnpm-workspace.yaml");

interface WorkspaceConfig {
  allowBuilds?: Record<string, unknown>;
}

describe("pnpm-workspace.yaml allowBuilds", () => {
  it("has allowBuilds with @swc/core and esbuild keys", () => {
    const content = readFileSync(workspacePath, "utf8");
    const workspace = parse(content) as WorkspaceConfig;

    expect(workspace.allowBuilds).toBeDefined();
    expect(workspace.allowBuilds).toHaveProperty("@swc/core");
    expect(workspace.allowBuilds).toHaveProperty("esbuild");
  });

  it("all allowBuilds values are boolean (not placeholders)", () => {
    const content = readFileSync(workspacePath, "utf8");
    const workspace = parse(content) as WorkspaceConfig;

    if (!workspace.allowBuilds) {
      throw new Error(
        "allowBuilds is missing from pnpm-workspace.yaml. " +
          "Run 'corepack pnpm@11.25.0 approve-builds' to configure it. " +
          "See ERR_PNPM_IGNORED_BUILDS documentation.",
      );
    }

    const entries = Object.entries(workspace.allowBuilds);
    expect(entries.length).toBeGreaterThan(0);

    for (const [key, value] of entries) {
      expect(typeof value).toBe("boolean");
      if (typeof value !== "boolean") {
        throw new Error(
          `allowBuilds["${key}"] is not a boolean (got: ${JSON.stringify(value)}). ` +
            `Placeholder values cause ERR_PNPM_IGNORED_BUILDS in pnpm 11. ` +
            `Run 'corepack pnpm@11.25.0 approve-builds' to fix.`,
        );
      }
    }
  });

  it("does not contain placeholder text 'set this to true or false'", () => {
    const content = readFileSync(workspacePath, "utf8");
    expect(content).not.toContain("set this to true or false");
  });
});
