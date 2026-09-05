/**
 * Puts the native `tsgolint.exe` where vite-plus looks for it first, so oxlint runs the type-aware
 * linter directly instead of shelling out to pnpm's `tsgolint.CMD` through cmd.exe.
 *
 * `resolveTsgolintExecutable` in vite-plus tries `<vite-plus>/node_modules/.bin/tsgolint.exe`
 * before `tsgolint.cmd`. pnpm only writes the `.CMD` shim, and that shim hands cmd.exe an
 * unnormalized `..`-laden path into the virtual store — which blows past the 260 character Windows
 * MAX_PATH limit once the checkout itself sits deep in a Tendril worktree, and lint dies with
 * "The system cannot find the path specified.". Dropping the real binary next to the shim removes
 * cmd.exe, the shim and the double descent from the picture.
 *
 * Every `pnpm install` deletes the binary again while relinking bins, so this runs from `prepare`
 * (after bin linking) as well as from `lint` and `check`.
 *
 * Node builtins only — this must run before any dependency is guaranteed importable. It never
 * fails the caller: anything unexpected becomes one warning on stderr and exit code 0.
 *
 * Usage:
 *   node scripts/patch-tsgolint-win.mjs            apply the repair
 *   node scripts/patch-tsgolint-win.mjs --json     report what it would do, write nothing
 */

import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Longest path cmd.exe and the ANSI Win32 APIs can open, terminating NUL included. */
const MAX_PATH = 260;

/** `linkSync` failures that a plain copy can still get past. */
const COPY_FALLBACK_CODES = new Set(["EXDEV", "EPERM", "EACCES", "EMLINK", "ENOSYS"]);

const dryRun = process.argv.includes("--json");
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function warn(text) {
  process.stderr.write(`[tsgolint-win] ${text}\n`);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Walks the same resolution chain vite-plus uses, so no `.pnpm` path is ever hard-coded.
 * @returns {{ binDir: string, source: string, target: string }}
 */
function resolvePaths() {
  const fromRepo = createRequire(join(repoRoot, "package.json"));
  const vitePlusPkgJson = fromRepo.resolve("vite-plus/package.json");
  const binDir = join(dirname(vitePlusPkgJson), "node_modules", ".bin");

  const tsgolintJs = createRequire(vitePlusPkgJson).resolve("oxlint-tsgolint/bin/tsgolint.js");
  const source = createRequire(tsgolintJs).resolve(
    `@oxlint-tsgolint/${process.platform}-${process.arch}/tsgolint.exe`,
  );

  return { binDir, source, target: join(binDir, "tsgolint.exe") };
}

/**
 * Hard-links (or, failing that, copies) the binary in through a temp name, so a concurrent
 * `prepare`/`lint` pair never reads a half-written 22 MB executable.
 * @returns {"linked" | "copied"}
 */
function install(binDir, source, target) {
  mkdirSync(binDir, { recursive: true });
  const temp = join(binDir, `tsgolint.exe.tmp-${process.pid}`);

  try {
    if (existsSync(temp)) {
      unlinkSync(temp);
    }

    let action = "linked";
    try {
      linkSync(source, temp);
    } catch (error) {
      if (!COPY_FALLBACK_CODES.has(error?.code)) {
        throw error;
      }
      copyFileSync(source, temp);
      action = "copied";
    }

    renameSync(temp, target);
    return action;
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // Nothing to clean up.
    }
    throw error;
  }
}

/** @returns {{ action: string, reason?: string, source?: string, target?: string, targetLength?: number }} */
function run() {
  if (process.platform !== "win32") {
    return { action: "skip", reason: "not-win32" };
  }
  if (process.arch !== "x64" && process.arch !== "arm64") {
    return { action: "skip", reason: `unsupported-arch:${process.arch}` };
  }

  let paths;
  try {
    paths = resolvePaths();
  } catch (error) {
    warn(
      `could not resolve tsgolint.exe from ${repoRoot} (${messageOf(error)}) — type-aware lint may fail`,
    );
    return { action: "skip", reason: "unresolved" };
  }

  const { binDir, source, target } = paths;
  const report = { source, target, targetLength: target.length };

  if (target.length > MAX_PATH - 1) {
    warn(`target path is ${target.length} chars, over MAX_PATH — type-aware lint may still fail`);
  }

  try {
    const sourceSize = statSync(source).size;
    if (existsSync(target) && statSync(target).size === sourceSize) {
      return { action: "present", ...report };
    }
  } catch (error) {
    warn(`could not stat ${source} (${messageOf(error)}) — type-aware lint may fail`);
    return { action: "skip", reason: "unreadable", ...report };
  }

  if (dryRun) {
    return { action: "linked", ...report };
  }

  try {
    return { action: install(binDir, source, target), ...report };
  } catch (error) {
    warn(`could not place ${target} (${messageOf(error)}) — type-aware lint may fail`);
    return { action: "skip", reason: "install-failed", ...report };
  }
}

const result = run();
if (dryRun) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
