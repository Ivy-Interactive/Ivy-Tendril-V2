import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Shared constants
// MAX_PATH (260) minus terminating NUL = 259 usable characters
// Measured: CreateProcess fails at 260, succeeds at 259
const USABLE_MAX_PATH = 259;

// Tendril's worst-case worktree path for this repo:
// D:\.tendril\Plans\ (18) + NNNNN- + 60-char SafeTitle (66) +
// \Worktrees\SpaceCorps\components-storybook (42) = 126
const TENDRIL_WORKTREE_BASE = 126;

// Windows shim extensions (.exe, .CMD, .ps1) are all 4 characters
const WIN_SHIM_EXT = 4;

describe("MAX_PATH budget", () => {
  it("the declared and installed virtualStoreDirMaxLength agree", () => {
    // Parse declared value from pnpm-workspace.yaml
    const workspaceYaml = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf-8");
    const match = workspaceYaml.match(/^virtualStoreDirMaxLength:\s*(\d+)$/m);

    if (!match) {
      throw new Error(
        "virtualStoreDirMaxLength is missing from pnpm-workspace.yaml; " +
          "without it, virtual store directory names grow to 60 characters " +
          "and exceed MAX_PATH in deep Tendril worktrees",
      );
    }

    const declared = Number.parseInt(match[1], 10);

    expect(declared).toBeGreaterThan(0);
    expect(declared).toBeLessThanOrEqual(40);

    if (declared > 40) {
      throw new Error(
        `virtualStoreDirMaxLength is ${declared}, exceeding the safe maximum of 40; ` +
          `virtual store directories longer than 40 characters exceed MAX_PATH in Tendril worktrees`,
      );
    }

    // If node_modules exists, check installed value matches
    const modulesYamlPath = join(repoRoot, "node_modules", ".modules.yaml");
    if (existsSync(modulesYamlPath)) {
      const modulesYaml = readFileSync(modulesYamlPath, "utf-8");
      const installedMatch = modulesYaml.match(/^\s*"?virtualStoreDirMaxLength"?:\s*(\d+)/m);

      if (installedMatch) {
        const installed = Number.parseInt(installedMatch[1], 10);
        expect(installed).toBe(declared);

        if (installed !== declared) {
          throw new Error(
            `node_modules was installed with virtualStoreDirMaxLength=${installed}, ` +
              `but pnpm-workspace.yaml declares ${declared}; run pnpm install`,
          );
        }
      }
    }
  });

  it("every executable this repo spawns fits inside MAX_PATH from a maximum-depth Tendril worktree", () => {
    const candidates: Array<{ path: string; length: number }> = [];

    // Helper to add a candidate with normalized length
    const addCandidate = (absPath: string) => {
      const relPath = relative(repoRoot, absPath);
      // Strip extension and add WIN_SHIM_EXT for cross-platform measurement
      const ext = extname(relPath);
      const normalized = ext ? relPath.slice(0, -ext.length) + ".".repeat(WIN_SHIM_EXT) : relPath;
      candidates.push({ path: relPath, length: normalized.length });
    };

    // 1. Every entry in node_modules/.bin
    const binDir = join(repoRoot, "node_modules", ".bin");
    if (existsSync(binDir)) {
      const entries = readdirSync(binDir);
      for (const entry of entries) {
        addCandidate(join(binDir, entry));
      }
    }

    // 2. Every entry in <vite-plus>/node_modules/.bin
    const require = createRequire(join(repoRoot, "package.json"));
    const vitePlusPkgJson = require.resolve("vite-plus/package.json");
    const vitePlusRoot = dirname(vitePlusPkgJson);
    const vitePlusBinDir = join(vitePlusRoot, "node_modules", ".bin");
    if (existsSync(vitePlusBinDir)) {
      const entries = readdirSync(vitePlusBinDir);
      for (const entry of entries) {
        addCandidate(join(vitePlusBinDir, entry));
      }
    }

    // 3. Native toolchain binaries (compute for win32-x64 as string arithmetic)
    // Read virtualStoreDirMaxLength to check if virtual store directory names would be hashed
    const workspaceYaml = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf-8");
    const vsdMatch = workspaceYaml.match(/^virtualStoreDirMaxLength:\s*(\d+)$/m);
    const maxDirLen = vsdMatch ? Number.parseInt(vsdMatch[1], 10) : 120;

    // TypeScript tsc.exe
    const typescriptPkgJson = require.resolve("typescript/package.json");
    const typescriptVersion = JSON.parse(readFileSync(typescriptPkgJson, "utf-8")).version;
    const tscDirName = `@typescript+typescript-win32-x64@${typescriptVersion}`;

    if (tscDirName.length > maxDirLen) {
      throw new Error(
        `typescript virtual store directory "${tscDirName}" (${tscDirName.length} chars) ` +
          `exceeds virtualStoreDirMaxLength=${maxDirLen}; the directory name would be hashed ` +
          `and this arithmetic no longer applies`,
      );
    }

    const tscPath = `.pnpm/${tscDirName}/node_modules/@typescript/typescript-win32-x64/lib/tsc.exe`;
    const tscNormalized = tscPath.slice(0, -extname(tscPath).length) + ".".repeat(WIN_SHIM_EXT);
    candidates.push({ path: tscPath, length: tscNormalized.length });

    // Oxlint tsgolint.exe
    const tsgolintPkgJson = require.resolve("oxlint-tsgolint/package.json");
    const tsgolintVersion = JSON.parse(readFileSync(tsgolintPkgJson, "utf-8")).version;
    const tsgolintDirName = `@oxlint-tsgolint+win32-x64@${tsgolintVersion}`;

    if (tsgolintDirName.length > maxDirLen) {
      throw new Error(
        `oxlint-tsgolint virtual store directory "${tsgolintDirName}" (${tsgolintDirName.length} chars) ` +
          `exceeds virtualStoreDirMaxLength=${maxDirLen}; the directory name would be hashed ` +
          `and this arithmetic no longer applies`,
      );
    }

    const tsgolintPath = `.pnpm/${tsgolintDirName}/node_modules/@oxlint-tsgolint/win32-x64/tsgolint.exe`;
    const tsgolintNormalized =
      tsgolintPath.slice(0, -extname(tsgolintPath).length) + ".".repeat(WIN_SHIM_EXT);
    candidates.push({ path: tsgolintPath, length: tsgolintNormalized.length });

    // Find the maximum length
    const maxCandidate = candidates.reduce((max, c) => (c.length > max.length ? c : max));
    const worstCaseTarget = TENDRIL_WORKTREE_BASE + 1 + maxCandidate.length;

    expect(worstCaseTarget).toBeLessThanOrEqual(USABLE_MAX_PATH);

    if (worstCaseTarget > USABLE_MAX_PATH) {
      // Sort by length descending and take top 5
      const top5 = candidates
        .sort((a, b) => b.length - a.length)
        .slice(0, 5)
        .map((c) => `  ${c.path} (${c.length})`)
        .join("\n");

      throw new Error(
        `the longest spawned executable path is ${worstCaseTarget - USABLE_MAX_PATH} chars over ` +
          `the Windows spawn limit from a maximum-depth Tendril worktree (limit ${USABLE_MAX_PATH}):\n` +
          `\nTop 5 longest executables:\n${top5}\n\n` +
          `To fix: lower virtualStoreDirMaxLength in pnpm-workspace.yaml, or flatten the Tendril worktree path.`,
      );
    }
  });

  it.runIf(process.platform === "win32")(
    "the deepest executable path in the tree has not grown",
    () => {
      // Recorded after fresh install with virtualStoreDirMaxLength=40
      // Raising this value is a deliberate act, not a fix
      const RECORDED_TREE_MAX = 148;

      const allExecutables: Array<{ path: string; length: number }> = [];

      // Walk node_modules for .bin directories and executable files
      const walk = (dir: string) => {
        if (!existsSync(dir)) return;

        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);

          if (entry.isDirectory()) {
            // Recursively walk, but look for .bin directories
            if (entry.name === ".bin") {
              const binEntries = readdirSync(fullPath);
              for (const binEntry of binEntries) {
                const relPath = relative(repoRoot, join(fullPath, binEntry));
                allExecutables.push({ path: relPath, length: relPath.length });
              }
            } else if (!entry.name.startsWith(".")) {
              // Don't recurse into hidden directories other than .bin
              walk(fullPath);
            }
          } else if (entry.isFile()) {
            const ext = extname(entry.name);
            if ([".exe", ".cmd", ".bat", ".ps1"].includes(ext.toLowerCase())) {
              const relPath = relative(repoRoot, fullPath);
              allExecutables.push({ path: relPath, length: relPath.length });
            }
          }
        }
      };

      walk(join(repoRoot, "node_modules"));

      if (allExecutables.length === 0) {
        // No executables found - this is fine, just means we're not on Windows or node_modules is empty
        return;
      }

      const maxPath = allExecutables.reduce((max, e) => (e.length > max.length ? e : max));

      expect(maxPath.length).toBeLessThanOrEqual(RECORDED_TREE_MAX);

      if (maxPath.length > RECORDED_TREE_MAX) {
        // Sort by length descending and take top 5
        const top5 = allExecutables
          .sort((a, b) => b.length - a.length)
          .slice(0, 5)
          .map((e) => `  ${e.path} (${e.length})`)
          .join("\n");

        throw new Error(
          `the deepest executable path in the tree is ${maxPath.length} chars, ` +
            `exceeding the recorded baseline of ${RECORDED_TREE_MAX}:\n` +
            `\nTop 5 deepest:\n${top5}\n\n` +
            `This indicates a dependency update added a longer executable path. ` +
            `Review the change and update RECORDED_TREE_MAX if the new depth is acceptable, ` +
            `or consider removing the dependency if it pushes the path budget too far.`,
        );
      }
    },
  );
});
