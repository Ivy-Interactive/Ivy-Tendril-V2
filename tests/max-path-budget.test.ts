import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("tsgolint path budget", () => {
  it("fits inside MAX_PATH from a maximum-depth Tendril worktree", () => {
    // Resolve vite-plus package.json using createRequire
    const require = createRequire(join(repoRoot, "package.json"));
    const vitePlusPkgJson = require.resolve("vite-plus/package.json");
    const vitePlusRoot = dirname(vitePlusPkgJson);

    // Build the path to tsgolint.exe
    const tsgolintPath = join(vitePlusRoot, "node_modules", ".bin", "tsgolint.exe");

    // Get the suffix length (relative path from repo root)
    const suffix = relative(repoRoot, tsgolintPath);
    const suffixLength = suffix.length;

    // Constants derived from Tendril's worktree path structure
    // D:\.tendril\Plans\ (18) + NNNNN- + 60-char SafeTitle (66) +
    // \Worktrees\SpaceCorps\components-storybook (42) = 126
    const WORST_CASE_CHECKOUT = 126;

    // MAX_PATH (260) minus terminating NUL = 259 usable characters
    // Measured: CreateProcess fails at 260, succeeds at 259
    const USABLE_MAX_PATH = 259;

    const worstCaseTarget = WORST_CASE_CHECKOUT + 1 + suffixLength;

    expect(worstCaseTarget).toBeLessThanOrEqual(USABLE_MAX_PATH);

    if (worstCaseTarget > USABLE_MAX_PATH) {
      throw new Error(
        `the tsgolint path is ${worstCaseTarget - USABLE_MAX_PATH} chars over the ` +
          `Windows spawn limit from a maximum-depth Tendril worktree (limit ${USABLE_MAX_PATH}); ` +
          `lower virtualStoreDirMaxLength in pnpm-workspace.yaml`,
      );
    }
  });

  it("pnpm-workspace.yaml still declares virtualStoreDirMaxLength", () => {
    const workspaceYaml = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf-8");

    expect(workspaceYaml).toMatch(/^virtualStoreDirMaxLength:\s*\d+$/m);

    if (!workspaceYaml.match(/^virtualStoreDirMaxLength:\s*\d+$/m)) {
      throw new Error(
        "virtualStoreDirMaxLength is missing from pnpm-workspace.yaml; " +
          "without it, virtual store directory names grow to 60 characters " +
          "and exceed MAX_PATH in deep Tendril worktrees",
      );
    }
  });
});
