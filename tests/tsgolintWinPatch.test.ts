import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

// Resolved in two steps rather than `new URL("../scripts/...", import.meta.url)`, which Vite
// rewrites into an asset URL that `fileURLToPath` then rejects.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(repoRoot, "scripts", "patch-tsgolint-win.mjs");

interface PatchReport {
  action: "skip" | "present" | "linked" | "copied";
  reason?: string;
  source?: string;
  target?: string;
  targetLength?: number;
}

/** Drives the script's dry-run mode: it reports what it would do without touching the tree. */
function runJson(): PatchReport {
  const stdout = execFileSync(process.execPath, [script, "--json"], { encoding: "utf8" });
  return JSON.parse(stdout) as PatchReport;
}

describe("patch-tsgolint-win", () => {
  it("exits 0 and prints valid JSON on every platform", () => {
    const report = runJson();
    expect(typeof report.action).toBe("string");
  });

  describe.skipIf(process.platform === "win32")("off Windows", () => {
    it("skips without resolving anything", () => {
      expect(runJson()).toEqual({ action: "skip", reason: "not-win32" });
    });
  });

  describe.runIf(process.platform === "win32")("on Windows", () => {
    it("resolves the binary vite-plus looks for first", () => {
      const report = runJson();

      expect(["present", "linked", "copied"]).toContain(report.action);
      expect(report.source).toMatch(/tsgolint\.exe$/);
      expect(report.target).toMatch(/vite-plus[\\/]node_modules[\\/]\.bin[\\/]tsgolint\.exe$/);
      expect(typeof report.targetLength).toBe("number");
    });

    it("leaves the tree untouched in --json mode", () => {
      const target = runJson().target;
      expect(target).toBeDefined();

      const before = existsSync(target as string);
      runJson();

      expect(existsSync(target as string)).toBe(before);
    });
  });
});
