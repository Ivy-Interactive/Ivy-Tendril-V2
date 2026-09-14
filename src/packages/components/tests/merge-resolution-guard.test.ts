import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(repoRoot, "scripts", "verify-merge-resolution.ts");
const fixturesDir = resolve(repoRoot, "tests", "fixtures", "merge-resolution");
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");

interface MergeResolutionReport {
  lostChanges: Array<{
    section: string;
    key: string;
    action: "added" | "removed" | "changed";
    lostFrom: "ours" | "theirs";
    base: string | null;
    ours: string | null;
    theirs: string | null;
    merged: string | null;
    manifest: string;
  }>;
}

function runJson(...args: string[]): MergeResolutionReport {
  const stdout = execFileSync(process.execPath, [tsxCli, script, "--json", ...args], {
    encoding: "utf8",
  });
  return JSON.parse(stdout) as MergeResolutionReport;
}

function runExitCode(...args: string[]): number {
  const result = spawnSync(process.execPath, [tsxCli, script, ...args], {
    encoding: "utf8",
  });
  return result.status ?? 1;
}

describe("verify-merge-resolution", () => {
  describe("clean merge", () => {
    it("reports no lost changes when the resolution took one side's changes", () => {
      const report = runJson(
        "--files",
        resolve(fixturesDir, "base.json"),
        resolve(fixturesDir, "ours.json"),
        resolve(fixturesDir, "theirs.json"),
        resolve(fixturesDir, "clean-merged.json"),
      );
      expect(report.lostChanges).toEqual([]);
    });
  });

  describe("8698ad1 revert pattern", () => {
    it("detects lost changes when merged equals base while one parent differs", () => {
      const report = runJson(
        "--files",
        resolve(fixturesDir, "base.json"),
        resolve(fixturesDir, "ours.json"),
        resolve(fixturesDir, "theirs.json"),
        resolve(fixturesDir, "merged.json"),
      );

      const keys = report.lostChanges.map((f) => `${f.section}.${f.key}`);
      expect(keys).toContain("scripts.storybook");
      expect(keys).toContain("devDependencies.@fontsource-variable/geist");
      expect(keys).toContain("devDependencies.@fontsource-variable/geist-mono");

      const storybookFinding = report.lostChanges.find(
        (f) => f.section === "scripts" && f.key === "storybook",
      );
      expect(storybookFinding).toBeDefined();
      expect(storybookFinding?.lostFrom).toBe("theirs");
      expect(storybookFinding?.action).toBe("changed");
      expect(storybookFinding?.base).toBe("storybook dev -p 6006");
      expect(storybookFinding?.theirs).toBe("storybook dev --ci --host 127.0.0.1");
      expect(storybookFinding?.merged).toBe("storybook dev -p 6006");

      const geistFinding = report.lostChanges.find(
        (f) => f.section === "devDependencies" && f.key === "@fontsource-variable/geist",
      );
      expect(geistFinding).toBeDefined();
      expect(geistFinding?.lostFrom).toBe("theirs");
      expect(geistFinding?.action).toBe("added");
      expect(geistFinding?.base).toBe(null);
      expect(geistFinding?.theirs).toBe("^5.3.0");
      expect(geistFinding?.merged).toBe(null);
    });

    it("does not report when both sides changed and one was chosen", () => {
      const report = runJson(
        "--files",
        resolve(fixturesDir, "base.json"),
        resolve(fixturesDir, "ours.json"),
        resolve(fixturesDir, "theirs.json"),
        resolve(fixturesDir, "clean-merged.json"),
      );

      expect(report.lostChanges.every((f) => f.merged !== f.base || f.ours === f.base)).toBe(true);
    });
  });

  describe("--allow suppression", () => {
    it("removes exactly the specified finding and leaves others", () => {
      const withoutAllow = runJson(
        "--files",
        resolve(fixturesDir, "base.json"),
        resolve(fixturesDir, "ours.json"),
        resolve(fixturesDir, "theirs.json"),
        resolve(fixturesDir, "merged.json"),
      );

      const withAllow = runJson(
        "--files",
        resolve(fixturesDir, "base.json"),
        resolve(fixturesDir, "ours.json"),
        resolve(fixturesDir, "theirs.json"),
        resolve(fixturesDir, "merged.json"),
        "--allow",
        "scripts.storybook",
      );

      expect(withoutAllow.lostChanges.length).toBeGreaterThan(0);
      expect(withAllow.lostChanges.length).toBe(withoutAllow.lostChanges.length - 1);

      const keys = withAllow.lostChanges.map((f) => `${f.section}.${f.key}`);
      expect(keys).not.toContain("scripts.storybook");
      expect(keys).toContain("devDependencies.@fontsource-variable/geist");
    });
  });

  describe("exit codes", () => {
    it("exits 0 when findings are present but --json is passed", () => {
      const exitCode = runExitCode(
        "--files",
        resolve(fixturesDir, "base.json"),
        resolve(fixturesDir, "ours.json"),
        resolve(fixturesDir, "theirs.json"),
        resolve(fixturesDir, "merged.json"),
        "--json",
      );
      expect(exitCode).toBe(0);
    });

    it("exits 1 when findings are present without --json", () => {
      const exitCode = runExitCode(
        "--files",
        resolve(fixturesDir, "base.json"),
        resolve(fixturesDir, "ours.json"),
        resolve(fixturesDir, "theirs.json"),
        resolve(fixturesDir, "merged.json"),
      );
      expect(exitCode).toBe(1);
    });

    it("exits 0 when no findings are present", () => {
      const exitCode = runExitCode(
        "--files",
        resolve(fixturesDir, "base.json"),
        resolve(fixturesDir, "ours.json"),
        resolve(fixturesDir, "theirs.json"),
        resolve(fixturesDir, "clean-merged.json"),
      );
      expect(exitCode).toBe(0);
    });
  });

  describe.skipIf(!canCheckCommit8698ad1())("git mode", () => {
    it("reproduces the 8698ad1 revert against real history", () => {
      const report = runJson("--commit", "8698ad1");

      const keys = report.lostChanges.map((f) => `${f.section}.${f.key}`);
      expect(keys).toContain("scripts.storybook");
      expect(keys).toContain("devDependencies.@fontsource-variable/geist");
    });
  });

  describe("--range mode", () => {
    it("reports clean when no merge commits exist in range", () => {
      const result = spawnSync(process.execPath, [tsxCli, script, "--range", "HEAD~1", "--json"], {
        encoding: "utf8",
      });

      if (result.status === 0) {
        const parsed = JSON.parse(result.stdout);
        const commits = parsed.commits || [];
        expect(commits.length).toBe(0);
      }
    });
  });

  describe("pnpm-workspace.yaml checking", () => {
    it("detects reverted workspace overrides when merged equals base", () => {
      const report = runJson(
        "--files",
        resolve(fixturesDir, "workspace-base.yaml"),
        resolve(fixturesDir, "workspace-ours.yaml"),
        resolve(fixturesDir, "workspace-theirs.yaml"),
        resolve(fixturesDir, "workspace-merged.yaml"),
      );

      const keys = report.lostChanges.map((f) => `${f.section}.${f.key}`);
      expect(keys).toContain("workspace.overrides.playwright@*");
      expect(keys).toContain("workspace.overrides.playwright-core@*");

      const playwrightFinding = report.lostChanges.find(
        (f) => f.section === "workspace.overrides" && f.key === "playwright@*",
      );
      expect(playwrightFinding).toBeDefined();
      expect(playwrightFinding?.manifest).toBe("pnpm-workspace.yaml");
      expect(playwrightFinding?.lostFrom).toBe("theirs");
      expect(playwrightFinding?.action).toBe("added");
      expect(playwrightFinding?.base).toBe(null);
      expect(playwrightFinding?.theirs).toBe("1.63.0");
      expect(playwrightFinding?.merged).toBe(null);

      const playwrightCoreFinding = report.lostChanges.find(
        (f) => f.section === "workspace.overrides" && f.key === "playwright-core@*",
      );
      expect(playwrightCoreFinding).toBeDefined();
      expect(playwrightCoreFinding?.manifest).toBe("pnpm-workspace.yaml");
      expect(playwrightCoreFinding?.lostFrom).toBe("theirs");
      expect(playwrightCoreFinding?.action).toBe("added");
      expect(playwrightCoreFinding?.base).toBe(null);
      expect(playwrightCoreFinding?.theirs).toBe("1.63.0");
      expect(playwrightCoreFinding?.merged).toBe(null);
    });

    it("reports no lost changes when workspace resolution is clean", () => {
      const report = runJson(
        "--files",
        resolve(fixturesDir, "workspace-base.yaml"),
        resolve(fixturesDir, "workspace-ours.yaml"),
        resolve(fixturesDir, "workspace-theirs.yaml"),
        resolve(fixturesDir, "workspace-clean-merged.yaml"),
      );

      expect(report.lostChanges).toEqual([]);
    });

    it("exits 1 without --json when workspace findings are present", () => {
      const exitCode = runExitCode(
        "--files",
        resolve(fixturesDir, "workspace-base.yaml"),
        resolve(fixturesDir, "workspace-ours.yaml"),
        resolve(fixturesDir, "workspace-theirs.yaml"),
        resolve(fixturesDir, "workspace-merged.yaml"),
      );
      expect(exitCode).toBe(1);
    });

    it("exits 0 with --json when workspace findings are present", () => {
      const exitCode = runExitCode(
        "--files",
        resolve(fixturesDir, "workspace-base.yaml"),
        resolve(fixturesDir, "workspace-ours.yaml"),
        resolve(fixturesDir, "workspace-theirs.yaml"),
        resolve(fixturesDir, "workspace-merged.yaml"),
        "--json",
      );
      expect(exitCode).toBe(0);
    });

    it("suppresses workspace findings with --allow workspace.overrides.playwright@*", () => {
      const withoutAllow = runJson(
        "--files",
        resolve(fixturesDir, "workspace-base.yaml"),
        resolve(fixturesDir, "workspace-ours.yaml"),
        resolve(fixturesDir, "workspace-theirs.yaml"),
        resolve(fixturesDir, "workspace-merged.yaml"),
      );

      const withAllow = runJson(
        "--files",
        resolve(fixturesDir, "workspace-base.yaml"),
        resolve(fixturesDir, "workspace-ours.yaml"),
        resolve(fixturesDir, "workspace-theirs.yaml"),
        resolve(fixturesDir, "workspace-merged.yaml"),
        "--allow",
        "workspace.overrides.playwright@*",
      );

      expect(withoutAllow.lostChanges.length).toBe(2);
      expect(withAllow.lostChanges.length).toBe(1);

      const keys = withAllow.lostChanges.map((f) => `${f.section}.${f.key}`);
      expect(keys).not.toContain("workspace.overrides.playwright@*");
      expect(keys).toContain("workspace.overrides.playwright-core@*");
    });
  });

  describe("YAML parser edge cases", () => {
    it("preserves catalog values with colons", () => {
      const report = runJson(
        "--files",
        resolve(fixturesDir, "workspace-base.yaml"),
        resolve(fixturesDir, "workspace-ours.yaml"),
        resolve(fixturesDir, "workspace-theirs.yaml"),
        resolve(fixturesDir, "workspace-clean-merged.yaml"),
      );

      const catalogVite = report.lostChanges.find(
        (f) => f.section === "workspace.catalog" && f.key === "vite",
      );
      expect(catalogVite).toBeUndefined();
    });

    it("preserves quoted values ending in colons", () => {
      const report = runJson(
        "--files",
        resolve(fixturesDir, "workspace-base.yaml"),
        resolve(fixturesDir, "workspace-ours.yaml"),
        resolve(fixturesDir, "workspace-theirs.yaml"),
        resolve(fixturesDir, "workspace-clean-merged.yaml"),
      );

      const viteOverride = report.lostChanges.find(
        (f) => f.section === "workspace.overrides" && f.key === "vite@*",
      );
      expect(viteOverride).toBeUndefined();
    });

    it("preserves quoted keys with special characters", () => {
      const report = runJson(
        "--files",
        resolve(fixturesDir, "workspace-base.yaml"),
        resolve(fixturesDir, "workspace-ours.yaml"),
        resolve(fixturesDir, "workspace-theirs.yaml"),
        resolve(fixturesDir, "workspace-clean-merged.yaml"),
      );

      const swcCore = report.lostChanges.find(
        (f) => f.section === "workspace.allowBuilds" && f.key === "@swc/core",
      );
      expect(swcCore).toBeUndefined();
    });
  });

  describe.skipIf(!canCheckCommit6dbce24())("git mode on pnpm-workspace.yaml", () => {
    it("reports no findings for 6dbce24 which took theirs correctly", () => {
      const report = runJson("--commit", "6dbce24");

      const workspaceFindings = report.lostChanges.filter(
        (f) => f.manifest === "pnpm-workspace.yaml",
      );
      expect(workspaceFindings).toEqual([]);
    });
  });

  describe("package.json top-level fields", () => {
    it("detects a reverted packageManager pin", () => {
      const report = runJson(
        "--files",
        resolve(fixturesDir, "top-level-base.json"),
        resolve(fixturesDir, "top-level-ours.json"),
        resolve(fixturesDir, "top-level-theirs.json"),
        resolve(fixturesDir, "top-level-merged.json"),
      );

      const finding = report.lostChanges.find(
        (f) => f.section === "topLevel" && f.key === "packageManager",
      );
      expect(finding).toBeDefined();
      expect(finding?.action).toBe("changed");
      expect(finding?.lostFrom).toBe("theirs");
      expect(finding?.base).toBe("pnpm@10.18.0");
      expect(finding?.theirs).toBe("pnpm@11.25.0");
      expect(finding?.merged).toBe("pnpm@10.18.0");
      expect(finding?.manifest).toBe("package.json");
    });

    it("detects a reverted devEngines block", () => {
      const report = runJson(
        "--files",
        resolve(fixturesDir, "top-level-base.json"),
        resolve(fixturesDir, "top-level-ours.json"),
        resolve(fixturesDir, "top-level-theirs.json"),
        resolve(fixturesDir, "top-level-merged.json"),
      );

      const finding = report.lostChanges.find(
        (f) => f.section === "topLevel" && f.key === "devEngines",
      );
      expect(finding).toBeDefined();
      expect(finding?.theirs).toBeDefined();

      const theirsDevEngines = JSON.parse(finding!.theirs!);
      expect(theirsDevEngines.packageManager.version).toBe("11.25.0");
    });

    it("detects a lost exports subpath", () => {
      const report = runJson(
        "--files",
        resolve(fixturesDir, "top-level-base.json"),
        resolve(fixturesDir, "top-level-ours.json"),
        resolve(fixturesDir, "top-level-theirs.json"),
        resolve(fixturesDir, "top-level-merged.json"),
      );

      const finding = report.lostChanges.find(
        (f) => f.section === "topLevel" && f.key === "exports",
      );
      expect(finding).toBeDefined();
      expect(finding?.action).toBe("changed");

      const theirsExports = JSON.parse(finding!.theirs!);
      const mergedExports = JSON.parse(finding!.merged!);
      expect(theirsExports["./ui"]).toBeDefined();
      expect(mergedExports["./ui"]).toBeUndefined();
    });

    it("detects a reverted types field and skips unchanged fields", () => {
      const report = runJson(
        "--files",
        resolve(fixturesDir, "top-level-base.json"),
        resolve(fixturesDir, "top-level-ours.json"),
        resolve(fixturesDir, "top-level-theirs.json"),
        resolve(fixturesDir, "top-level-merged.json"),
      );

      const typesFinding = report.lostChanges.find(
        (f) => f.section === "topLevel" && f.key === "types",
      );
      expect(typesFinding).toBeDefined();

      const typeFinding = report.lostChanges.find(
        (f) => f.section === "topLevel" && f.key === "type",
      );
      expect(typeFinding).toBeUndefined();

      const mainFinding = report.lostChanges.find(
        (f) => f.section === "topLevel" && f.key === "main",
      );
      expect(mainFinding).toBeUndefined();
    });

    it("does not report false positives from object key order", () => {
      const report = runJson(
        "--files",
        resolve(fixturesDir, "top-level-base.json"),
        resolve(fixturesDir, "top-level-ours.json"),
        resolve(fixturesDir, "top-level-theirs.json"),
        resolve(fixturesDir, "top-level-merged.json"),
      );

      const lostFromOurs = report.lostChanges.filter((f) => f.lostFrom === "ours");
      expect(lostFromOurs).toEqual([]);

      const allLostFromTheirs = report.lostChanges.every((f) => f.lostFrom === "theirs");
      expect(allLostFromTheirs).toBe(true);
    });

    it("reports nothing for a clean resolution", () => {
      const report = runJson(
        "--files",
        resolve(fixturesDir, "top-level-base.json"),
        resolve(fixturesDir, "top-level-ours.json"),
        resolve(fixturesDir, "top-level-theirs.json"),
        resolve(fixturesDir, "top-level-clean-merged.json"),
      );

      expect(report.lostChanges).toEqual([]);
    });

    it("allows suppressing topLevel.packageManager with --allow", () => {
      const report = runJson(
        "--files",
        resolve(fixturesDir, "top-level-base.json"),
        resolve(fixturesDir, "top-level-ours.json"),
        resolve(fixturesDir, "top-level-theirs.json"),
        resolve(fixturesDir, "top-level-merged.json"),
        "--allow",
        "topLevel.packageManager",
      );

      const packageManagerFinding = report.lostChanges.find(
        (f) => f.section === "topLevel" && f.key === "packageManager",
      );
      expect(packageManagerFinding).toBeUndefined();

      const devEnginesFinding = report.lostChanges.find(
        (f) => f.section === "topLevel" && f.key === "devEngines",
      );
      expect(devEnginesFinding).toBeDefined();
    });

    it("exits 1 without --json on a revert", () => {
      const exitCode = runExitCode(
        "--files",
        resolve(fixturesDir, "top-level-base.json"),
        resolve(fixturesDir, "top-level-ours.json"),
        resolve(fixturesDir, "top-level-theirs.json"),
        resolve(fixturesDir, "top-level-merged.json"),
      );
      expect(exitCode).toBe(1);
    });

    it("exits 0 with --json on a revert", () => {
      const exitCode = runExitCode(
        "--files",
        resolve(fixturesDir, "top-level-base.json"),
        resolve(fixturesDir, "top-level-ours.json"),
        resolve(fixturesDir, "top-level-theirs.json"),
        resolve(fixturesDir, "top-level-merged.json"),
        "--json",
      );
      expect(exitCode).toBe(0);
    });

    it("exits 0 on clean fixtures", () => {
      const exitCode = runExitCode(
        "--files",
        resolve(fixturesDir, "top-level-base.json"),
        resolve(fixturesDir, "top-level-ours.json"),
        resolve(fixturesDir, "top-level-theirs.json"),
        resolve(fixturesDir, "top-level-clean-merged.json"),
      );
      expect(exitCode).toBe(0);
    });

    describe.skipIf(!canCheckCommit735cf7e())("real history: Plan 00191 merge", () => {
      it("reports no topLevel findings for the correct resolution at 735cf7e", () => {
        const report = runJson("--commit", "735cf7e");

        const topLevelFindings = report.lostChanges.filter((f) => f.section === "topLevel");
        expect(topLevelFindings).toEqual([]);
      });
    });
  });
});

function canCheckCommit8698ad1(): boolean {
  const result = spawnSync("git", ["cat-file", "-e", "8698ad1^{commit}"], {
    cwd: repoRoot,
  });
  return result.status === 0;
}

function canCheckCommit6dbce24(): boolean {
  const result = spawnSync("git", ["cat-file", "-e", "6dbce24^{commit}"], {
    cwd: repoRoot,
  });
  return result.status === 0;
}

function canCheckCommit735cf7e(): boolean {
  const result = spawnSync("git", ["cat-file", "-e", "735cf7e^{commit}"], {
    cwd: repoRoot,
  });
  return result.status === 0;
}
