import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(repoRoot, "scripts", "verify-merge-resolution.mjs");
const fixturesDir = resolve(repoRoot, "tests", "fixtures", "merge-resolution");

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
  }>;
}

function runJson(...args: string[]): MergeResolutionReport {
  const stdout = execFileSync(process.execPath, [script, "--json", ...args], {
    encoding: "utf8",
  });
  return JSON.parse(stdout) as MergeResolutionReport;
}

function runExitCode(...args: string[]): number {
  const result = spawnSync(process.execPath, [script, ...args], {
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

      expect(report.lostChanges.every((f) => f.merged !== f.base || f.ours === f.base)).toBe(
        true,
      );
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
      const result = spawnSync(process.execPath, [script, "--range", "HEAD~1", "--json"], {
        encoding: "utf8",
      });

      if (result.status === 0) {
        const parsed = JSON.parse(result.stdout);
        const commits = parsed.commits || [];
        expect(commits.length).toBe(0);
      }
    });
  });
});

function canCheckCommit8698ad1(): boolean {
  const result = spawnSync("git", ["cat-file", "-e", "8698ad1^{commit}"], {
    cwd: repoRoot,
  });
  return result.status === 0;
}
