import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

// Resolved in two steps rather than `new URL("../scripts/...", import.meta.url)`, which Vite
// rewrites into an asset URL that `fileURLToPath` then rejects.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(repoRoot, "scripts", "patch-tsgolint-win.ts");
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");

interface PatchReport {
  action: "skip" | "present" | "linked" | "copied";
  reason?: string;
  source?: string;
  target?: string;
  targetLength?: number;
}

/** Drives the script's dry-run mode: it reports what it would do without touching the tree. */
function runJson(): PatchReport {
  const stdout = execFileSync(process.execPath, [tsxCli, script, "--json"], { encoding: "utf8" });
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

  describe("obsolescence canary", () => {
    it("upstream still declares no .exe bin", () => {
      const requireFromRepo = createRequire(resolve(repoRoot, "package.json"));
      const vitePlusPkgPath = requireFromRepo.resolve("vite-plus/package.json");
      const requireFromVitePlus = createRequire(vitePlusPkgPath);

      // Check oxlint-tsgolint
      const tsgolintPkgPath = requireFromVitePlus.resolve("oxlint-tsgolint/package.json");
      const tsgolintPkg = JSON.parse(readFileSync(tsgolintPkgPath, "utf8"));

      if (tsgolintPkg.bin) {
        const binEntries = Object.entries(tsgolintPkg.bin);
        for (const [name, path] of binEntries) {
          expect(name.endsWith(".exe")).toBe(false);
          expect((path as string).endsWith(".exe")).toBe(false);
        }
      }

      // Check @oxlint-tsgolint/<platform>-<arch> (optional dependency, may not be installed)
      const platformPkgName = `@oxlint-tsgolint/${process.platform}-${process.arch}`;
      try {
        const platformPkgPath = requireFromVitePlus.resolve(`${platformPkgName}/package.json`);
        const platformPkg = JSON.parse(readFileSync(platformPkgPath, "utf8"));

        if (platformPkg.bin) {
          const binEntries = Object.entries(platformPkg.bin);
          for (const [name, path] of binEntries) {
            expect(
              name.endsWith(".exe"),
              `tsgolint.exe is now declared upstream — the Windows patch is obsolete. Follow 'Retiring this repair' in README.md.`,
            ).toBe(false);
            expect(
              (path as string).endsWith(".exe"),
              `tsgolint.exe is now declared upstream — the Windows patch is obsolete. Follow 'Retiring this repair' in README.md.`,
            ).toBe(false);
          }
        }
      } catch {
        // Platform package not installed (e.g., Linux CI runner) — skip that check
      }
    });

    describe.runIf(process.platform === "win32")("pnpm shim path normalization", () => {
      it("the pnpm shim still hands cmd.exe an unnormalized path", () => {
        const requireFromRepo = createRequire(resolve(repoRoot, "package.json"));
        const vitePlusPkgPath = requireFromRepo.resolve("vite-plus/package.json");
        const vitePlusDir = dirname(vitePlusPkgPath);
        const shimPath = resolve(vitePlusDir, "node_modules", ".bin", "tsgolint.CMD");

        if (!existsSync(shimPath)) {
          // Shim not present — skip this check
          return;
        }

        const shimContent = readFileSync(shimPath, "utf8");
        expect(
          shimContent.includes("\\..\\..\\"),
          `the pnpm shim now hands cmd.exe a normalized path — the Windows patch is obsolete. Follow 'Retiring this repair' in README.md.`,
        ).toBe(true);
      });
    });
  });
});
