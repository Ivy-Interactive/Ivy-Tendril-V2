import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("playwright lockfile deduplication", () => {
  it("has exactly one playwright-core@1.63.0 package declaration", () => {
    const lockfile = readFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "utf8");
    // Extract packages section only (before snapshots section)
    const packagesSection = lockfile.split(/^snapshots:/m)[0];
    const playwrightCorePackages =
      packagesSection.match(/^\s+playwright-core@1\.\d+\.\d+:/gm) || [];
    expect(playwrightCorePackages.length).toBe(1);
    expect(playwrightCorePackages[0]).toContain("playwright-core@1.63.0");
  });

  it("has exactly one playwright@1.63.0 package declaration", () => {
    const lockfile = readFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "utf8");
    // Extract packages section only (before snapshots section)
    const packagesSection = lockfile.split(/^snapshots:/m)[0];
    const playwrightPackages = packagesSection.match(/^\s+playwright@1\.\d+\.\d+:/gm) || [];
    expect(playwrightPackages.length).toBe(1);
    expect(playwrightPackages[0]).toContain("playwright@1.63.0");
  });

  it("has no 1.62.1 playwright dependencies", () => {
    const lockfile = readFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "utf8");
    expect(lockfile).not.toContain("playwright: 1.62.1");
    expect(lockfile).not.toContain("playwright-core: 1.62.1");
  });

  it("pins playwright-core to 1.63.0 in pnpm-workspace.yaml overrides", () => {
    const workspace = readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
    expect(workspace).toContain("playwright-core@*: 1.63.0");
  });

  it("removes all 'page as any' casts from test-runner.ts", () => {
    const testRunner = readFileSync(path.join(repoRoot, ".storybook/test-runner.ts"), "utf8");
    expect(testRunner).not.toContain("page as any");
    expect(testRunner).toContain("injectAxe(page)");
    expect(testRunner).toContain("configureAxe(page,");
    expect(testRunner).toContain("checkA11y(page,");
  });
});
