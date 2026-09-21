import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * Source scan for hover fills that compile, apply, and cannot be seen.
 *
 * `--accent` is `#f8f8f8` in light and `#1a1a1a` in dark; `--muted` is byte-identical to it in both.
 * So `hover:bg-accent` measures 1.062:1 on a `#ffffff` surface and 1.030:1 on a dark `--card`, and
 * `hover:bg-muted/50` on an already-`bg-muted` strip (`TabsList`, the ChatHeader jobs badge) measures
 * exactly 1.000:1 -- a hover state that changes zero pixels. The whole app was migrated onto
 * `bg-secondary/60` (1.142:1 light, 1.092-1.174 dark), which is the token the SELECTED state already
 * uses, so hover previews selection at 60% rather than being a neutral nobody can see.
 *
 * Without this test the migration decays: the next person copies `hover:bg-accent` out of an old file
 * and the system re-fragments, which is precisely the inconsistency that prompted the pass. There is
 * no ESLint config in this repo (no `eslint.config.*`), so a vitest source scan is the available
 * lever, and it is the established idiom -- `max-path-budget.test.ts` already enforces a numeric
 * budget over the tree and `focus-visible-audit.test.ts` already scans stylesheets for a rule shape.
 */
const BANNED: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /hover:bg-accent\b/, why: "1.062:1 light / 1.030:1 on dark --card" },
  { pattern: /hover:bg-accent\//, why: "accent at partial alpha: 1.026:1 light / 1.010:1 dark" },
  { pattern: /hover:bg-muted\b/, why: "byte-identical to --accent, same 1.062:1 / 1.030:1" },
  { pattern: /hover:bg-muted\/50/, why: "1.026:1, and exactly 1.000:1 on a bg-muted surface" },
  { pattern: /active:bg-accent\b/, why: "an active state indistinguishable from idle" },
  { pattern: /focus-visible:bg-accent\b/, why: "a focus fill at 1.062:1" },
];

/**
 * Files still holding an invisible token because a concurrent agent owns them. Each entry is a
 * promise, not an exemption: this list must shrink to empty as those changes land. Do not add to it
 * to make a new violation pass -- use `bg-secondary/60`. Empty now; kept as a `Set` so a future
 * exemption has somewhere to go without changing the check below.
 */
const ALLOWLIST: ReadonlySet<string> = new Set([]);

const ROOTS = [
  "src/packages/components/src",
  "src/apps/tendril-app/src",
  "src/apps/tendril-docs/src",
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      sourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|stories)\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

describe("hover token audit", () => {
  it("no source file uses a hover fill that is invisible against its surface", () => {
    const violations: string[] = [];

    for (const root of ROOTS) {
      for (const file of sourceFiles(resolve(repoRoot, root))) {
        const rel = relative(repoRoot, file).replaceAll("\\", "/");
        if (ALLOWLIST.has(rel)) continue;

        const lines = readFileSync(file, "utf-8").split("\n");
        lines.forEach((line, index) => {
          // A quoted token inside a `//` comment is documentation of the old value, not a usage.
          if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
          for (const { pattern, why } of BANNED) {
            if (pattern.test(line)) {
              violations.push(
                `${rel}:${index + 1} uses ${pattern.source.replace(/\\b|\\\//g, (m) => (m === "\\/" ? "/" : ""))} (${why}). ` +
                  `Use hover:bg-secondary/60 -- 1.142:1, the token the selected state already uses.`,
              );
            }
          }
        });
      }
    }

    expect(violations).toEqual([]);
  });

  it("the owned-file allowlist stays empty", () => {
    // The migration is done; any new entry here is a regression, not a promise.
    expect(ALLOWLIST.size).toBe(0);
  });
});
