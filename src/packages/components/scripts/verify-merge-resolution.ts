/**
 * Detects merge resolutions that silently revert already-merged changes by keeping the base side
 * when one parent changed.
 *
 * Compares package.json and pnpm-workspace.yaml across merge commits or in-progress merges. For
 * every dependency/script key in package.json and every catalog, override and setting in
 * pnpm-workspace.yaml, if one parent changed the value from the base and the merged result matches
 * the base, that change was lost.
 *
 * Node builtins and `git` only - runs in CI with no install.
 *
 * Usage:
 *   tsx scripts/verify-merge-resolution.ts                    in-progress merge (reads MERGE_HEAD)
 *   tsx scripts/verify-merge-resolution.ts --commit <ref>     single merge commit
 *   tsx scripts/verify-merge-resolution.ts --range <ref>      all merge commits in ref..HEAD
 *   tsx scripts/verify-merge-resolution.ts --files <base> <ours> <theirs> <merged>
 *   tsx scripts/verify-merge-resolution.ts --json             report as JSON, exit 0
 *   tsx scripts/verify-merge-resolution.ts --allow <section>.<key>  suppress one finding (repeatable)
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "scripts",
];

/** package.json keys outside SECTIONS whose loss a merge resolution can hide. */
const TOP_LEVEL_KEYS = ["packageManager", "devEngines", "type", "main", "types", "exports"];

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

interface ParsedArgs {
  mode: "in-progress" | "files" | "commit" | "range";
  jsonOutput: boolean;
  allowed: Set<string>;
  files: string[];
  ref: string | null;
}

interface Finding {
  section: string;
  key: string;
  action: "added" | "removed" | "changed";
  lostFrom: "ours" | "theirs";
  base: string | null;
  ours: string | null;
  theirs: string | null;
  merged: string | null;
  manifest: string;
}

interface CommitFindingResult {
  ref: string;
  findings: Finding[];
}

function parseArgs(): ParsedArgs {
  const args: ParsedArgs = {
    mode: "in-progress",
    jsonOutput: false,
    allowed: new Set<string>(),
    files: [],
    ref: null,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--json") {
      args.jsonOutput = true;
    } else if (arg === "--files") {
      args.mode = "files";
      args.files = process.argv.slice(i + 1, i + 5);
      if (args.files.length !== 4) {
        throw new Error("--files requires exactly 4 paths: <base> <ours> <theirs> <merged>");
      }
      i += 4;
    } else if (arg === "--commit") {
      args.mode = "commit";
      args.ref = process.argv[++i];
      if (!args.ref) {
        throw new Error("--commit requires a ref argument");
      }
    } else if (arg === "--range") {
      args.mode = "range";
      args.ref = process.argv[++i];
      if (!args.ref) {
        throw new Error("--range requires a ref argument");
      }
    } else if (arg === "--allow") {
      const key = process.argv[++i];
      if (!key) {
        throw new Error("--allow requires a <section>.<key> argument");
      }
      args.allowed.add(key);
    }
  }

  return args;
}

function gitShow(ref: string, path: string): string | null {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error: unknown) {
    const err = error as { status?: number };
    if (err.status === 128) {
      return null;
    }
    throw error;
  }
}

function gitMergeBase(ref1: string, ref2: string): string {
  return execFileSync("git", ["merge-base", ref1, ref2], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function gitDir(): string {
  try {
    return execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    throw new Error(
      `Not a git repository (git rev-parse --absolute-git-dir failed in ${repoRoot})`,
    );
  }
}

function gitRevList(range: string): string[] {
  const output = spawnSync("git", ["rev-list", "--merges", "--first-parent", range], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (output.status !== 0) {
    return [];
  }
  return output.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseManifest(text: string | null): Record<string, unknown> {
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

interface WorkspaceNode {
  [key: string]: unknown;
  _list?: string[];
}

interface StackEntry {
  obj: WorkspaceNode;
  indent: number;
}

function parseWorkspace(text: string | null): Record<string, unknown> | null {
  if (!text) {
    return {};
  }

  const lines = text.split("\n");
  const root: WorkspaceNode = {};
  const stack: StackEntry[] = [{ obj: root, indent: -1 }];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (trimmed === "" || trimmed[0] === "#") {
      continue;
    }

    const indent = line.length - trimmed.length;

    if (
      trimmed.includes("{") ||
      trimmed.includes("[") ||
      trimmed.includes("|") ||
      trimmed.includes(">")
    ) {
      return null;
    }

    if (trimmed.startsWith("- ")) {
      const value = unquote(trimmed.slice(2).split(" #")[0].trim());
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      const parent = stack[stack.length - 1].obj;
      if (!Array.isArray(parent._list)) {
        parent._list = [];
      }
      parent._list.push(value);
      continue;
    }

    let colonIndex = -1;
    let inQuote = false;
    let quoteChar: string | null = null;

    for (let j = 0; j < trimmed.length; j++) {
      const char = trimmed[j];
      if (!inQuote && (char === '"' || char === "'")) {
        inQuote = true;
        quoteChar = char;
      } else if (inQuote && char === quoteChar) {
        inQuote = false;
        quoteChar = null;
      } else if (!inQuote && char === ":" && (j + 1 === trimmed.length || trimmed[j + 1] === " ")) {
        colonIndex = j;
        break;
      }
    }

    if (colonIndex === -1) {
      continue;
    }

    const key = unquote(trimmed.slice(0, colonIndex).trim());
    let value = trimmed.slice(colonIndex + 1).trim();

    if (value.includes(" #") && !value.startsWith('"') && !value.startsWith("'")) {
      value = value.split(" #")[0].trim();
    }

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    if (value === "") {
      const nested: WorkspaceNode = {};
      parent[key] = nested;
      stack.push({ obj: nested, indent });
    } else {
      parent[key] = unquote(value);
    }
  }

  function flattenLists(obj: Record<string, unknown>): void {
    for (const key in obj) {
      const val = obj[key];
      if (val && typeof val === "object") {
        const valObj = val as WorkspaceNode;
        if ("_list" in valObj) {
          obj[key] = valObj._list;
        } else {
          flattenLists(valObj as Record<string, unknown>);
        }
      }
    }
  }

  flattenLists(root);
  return root;
}

function unquote(str: string): string {
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  return str;
}

function getValueAtPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current === undefined ? null : current;
}

function diffFlatMap(
  section: string,
  baseMap: Record<string, unknown>,
  oursMap: Record<string, unknown>,
  theirsMap: Record<string, unknown>,
  mergedMap: Record<string, unknown>,
  manifest = "package.json",
): Finding[] {
  const findings: Finding[] = [];
  const allKeys = new Set([
    ...Object.keys(baseMap),
    ...Object.keys(oursMap),
    ...Object.keys(theirsMap),
    ...Object.keys(mergedMap),
  ]);

  for (const key of allKeys) {
    const baseVal = (baseMap[key] as string) || null;
    const oursVal = (oursMap[key] as string) || null;
    const theirsVal = (theirsMap[key] as string) || null;
    const mergedVal = (mergedMap[key] as string) || null;

    if (oursVal !== baseVal && mergedVal === baseVal) {
      findings.push({
        section,
        key,
        action: baseVal === null ? "added" : oursVal === null ? "removed" : "changed",
        lostFrom: "ours",
        base: baseVal,
        ours: oursVal,
        theirs: theirsVal,
        merged: mergedVal,
        manifest,
      });
    }

    if (theirsVal !== baseVal && mergedVal === baseVal) {
      findings.push({
        section,
        key,
        action: baseVal === null ? "added" : theirsVal === null ? "removed" : "changed",
        lostFrom: "theirs",
        base: baseVal,
        ours: oursVal,
        theirs: theirsVal,
        merged: mergedVal,
        manifest,
      });
    }
  }

  return findings;
}

function walkWorkspaceLeafs(
  obj: Record<string, unknown>,
  prefix = "workspace",
): Record<string, Record<string, string | null>> {
  const maps: Record<string, Record<string, string | null>> = {};

  function walk(current: unknown, path: string): void {
    if (current == null || typeof current !== "object") {
      return;
    }

    const currentObj = current as Record<string, unknown>;

    if (Array.isArray(current)) {
      maps[path] = { [path.split(".").pop()!]: JSON.stringify(current) };
      return;
    }

    let hasScalarChild = false;
    for (const key in currentObj) {
      const value = currentObj[key];
      if (value == null || typeof value !== "object") {
        hasScalarChild = true;
        break;
      }
    }

    if (hasScalarChild) {
      const flatMap: Record<string, string | null> = {};
      for (const key in currentObj) {
        const value = currentObj[key];
        if (value == null || typeof value !== "object") {
          flatMap[key] =
            value === null || value === undefined
              ? null
              : String(value as string | number | boolean);
        } else if (Array.isArray(value)) {
          flatMap[key] = JSON.stringify(value);
        }
      }
      if (Object.keys(flatMap).length > 0) {
        maps[path] = flatMap;
      }
    }

    for (const key in currentObj) {
      const value = currentObj[key];
      if (value != null && typeof value === "object" && !Array.isArray(value)) {
        walk(value, path ? `${path}.${key}` : key);
      }
    }
  }

  walk(obj, prefix);
  return maps;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== "object") return value;
  const sorted: Record<string, unknown> = {};
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj).sort()) sorted[key] = sortKeysDeep(obj[key]);
  return sorted;
}

function canonicalValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return String(value as string | number | boolean);
  return JSON.stringify(sortKeysDeep(value));
}

function topLevelMap(
  manifest: Record<string, unknown> | null | undefined,
): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const key of TOP_LEVEL_KEYS) {
    const canonical = canonicalValue(manifest?.[key]);
    if (canonical !== null) map[key] = canonical;
  }
  return map;
}

function compareManifests(
  base: Record<string, unknown>,
  ours: Record<string, unknown>,
  theirs: Record<string, unknown>,
  merged: Record<string, unknown>,
  baseWs?: Record<string, unknown> | null,
  oursWs?: Record<string, unknown> | null,
  theirsWs?: Record<string, unknown> | null,
  mergedWs?: Record<string, unknown> | null,
): Finding[] {
  const findings: Finding[] = [];

  for (const section of SECTIONS) {
    const baseSection = (getValueAtPath(base, section) as Record<string, unknown>) || {};
    const oursSection = (getValueAtPath(ours, section) as Record<string, unknown>) || {};
    const theirsSection = (getValueAtPath(theirs, section) as Record<string, unknown>) || {};
    const mergedSection = (getValueAtPath(merged, section) as Record<string, unknown>) || {};

    findings.push(
      ...diffFlatMap(
        section,
        baseSection,
        oursSection,
        theirsSection,
        mergedSection,
        "package.json",
      ),
    );
  }

  findings.push(
    ...diffFlatMap(
      "topLevel",
      topLevelMap(base),
      topLevelMap(ours),
      topLevelMap(theirs),
      topLevelMap(merged),
      "package.json",
    ),
  );

  const pnpmOverridesPath = "pnpm.overrides";
  const basePnpm = (getValueAtPath(base, pnpmOverridesPath) as Record<string, unknown>) || {};
  const oursPnpm = (getValueAtPath(ours, pnpmOverridesPath) as Record<string, unknown>) || {};
  const theirsPnpm = (getValueAtPath(theirs, pnpmOverridesPath) as Record<string, unknown>) || {};
  const mergedPnpm = (getValueAtPath(merged, pnpmOverridesPath) as Record<string, unknown>) || {};

  findings.push(
    ...diffFlatMap("pnpm.overrides", basePnpm, oursPnpm, theirsPnpm, mergedPnpm, "package.json"),
  );

  if (
    baseWs !== undefined &&
    oursWs !== undefined &&
    theirsWs !== undefined &&
    mergedWs !== undefined
  ) {
    const baseMaps = walkWorkspaceLeafs(baseWs || {});
    const oursMaps = walkWorkspaceLeafs(oursWs || {});
    const theirsMaps = walkWorkspaceLeafs(theirsWs || {});
    const mergedMaps = walkWorkspaceLeafs(mergedWs || {});

    const allSections = new Set([
      ...Object.keys(baseMaps),
      ...Object.keys(oursMaps),
      ...Object.keys(theirsMaps),
      ...Object.keys(mergedMaps),
    ]);

    for (const section of allSections) {
      findings.push(
        ...diffFlatMap(
          section,
          baseMaps[section] || {},
          oursMaps[section] || {},
          theirsMaps[section] || {},
          mergedMaps[section] || {},
          "pnpm-workspace.yaml",
        ),
      );
    }
  }

  return findings;
}

function checkFiles(
  basePath: string,
  oursPath: string,
  theirsPath: string,
  mergedPath: string,
): Finding[] {
  const isJson = basePath.endsWith(".json");
  const isYaml = basePath.endsWith(".yaml") || basePath.endsWith(".yml");

  if (!isJson && !isYaml) {
    throw new Error(
      `--files: unsupported file extension (expected .json, .yaml, or .yml): ${basePath}`,
    );
  }

  const allSameExt = [oursPath, theirsPath, mergedPath].every((p) =>
    isJson ? p.endsWith(".json") : p.endsWith(".yaml") || p.endsWith(".yml"),
  );

  if (!allSameExt) {
    throw new Error("--files: all four paths must have the same extension");
  }

  if (isJson) {
    const base = parseManifest(readFileSync(basePath, "utf8"));
    const ours = parseManifest(readFileSync(oursPath, "utf8"));
    const theirs = parseManifest(readFileSync(theirsPath, "utf8"));
    const merged = parseManifest(readFileSync(mergedPath, "utf8"));
    return compareManifests(base, ours, theirs, merged);
  } else {
    const base = parseWorkspace(readFileSync(basePath, "utf8"));
    const ours = parseWorkspace(readFileSync(oursPath, "utf8"));
    const theirs = parseWorkspace(readFileSync(theirsPath, "utf8"));
    const merged = parseWorkspace(readFileSync(mergedPath, "utf8"));

    if (base === null || ours === null || theirs === null || merged === null) {
      process.stdout.write(
        "pnpm-workspace.yaml: unsupported YAML construct (flow collections, multi-line scalars, or anchors), skipped\n",
      );
      return [];
    }

    return compareManifests({}, {}, {}, {}, base, ours, theirs, merged);
  }
}

function checkCommit(ref: string): CommitFindingResult {
  const mergeBase = gitMergeBase(`${ref}^1`, `${ref}^2`);

  const base = parseManifest(gitShow(mergeBase, "package.json"));
  const ours = parseManifest(gitShow(`${ref}^1`, "package.json"));
  const theirs = parseManifest(gitShow(`${ref}^2`, "package.json"));
  const merged = parseManifest(gitShow(ref, "package.json"));

  const baseWsText = gitShow(mergeBase, "pnpm-workspace.yaml");
  const oursWsText = gitShow(`${ref}^1`, "pnpm-workspace.yaml");
  const theirsWsText = gitShow(`${ref}^2`, "pnpm-workspace.yaml");
  const mergedWsText = gitShow(ref, "pnpm-workspace.yaml");

  const baseWs = parseWorkspace(baseWsText);
  const oursWs = parseWorkspace(oursWsText);
  const theirsWs = parseWorkspace(theirsWsText);
  const mergedWs = parseWorkspace(mergedWsText);

  if (baseWs === null || oursWs === null || theirsWs === null || mergedWs === null) {
    if (baseWsText || oursWsText || theirsWsText || mergedWsText) {
      process.stdout.write(
        "pnpm-workspace.yaml: unsupported YAML construct (flow collections, multi-line scalars, or anchors), skipped\n",
      );
    }
    return { ref, findings: compareManifests(base, ours, theirs, merged) };
  }

  return {
    ref,
    findings: compareManifests(base, ours, theirs, merged, baseWs, oursWs, theirsWs, mergedWs),
  };
}

function checkRange(ref: string): CommitFindingResult[] {
  const commits = gitRevList(`${ref}..HEAD`);
  const results: CommitFindingResult[] = [];
  for (const commit of commits) {
    const result = checkCommit(commit);
    if (result.findings.length > 0) {
      results.push(result);
    }
  }
  return results;
}

function checkInProgress(): Finding[] {
  const mergeHeadPath = join(gitDir(), "MERGE_HEAD");
  if (!existsSync(mergeHeadPath)) {
    throw new Error("Not in a merge (no MERGE_HEAD found)");
  }

  const theirs = readFileSync(mergeHeadPath, "utf8").trim();
  const ours = "HEAD";
  const base = gitMergeBase(ours, theirs);

  const basePkg = parseManifest(gitShow(base, "package.json"));
  const oursPkg = parseManifest(gitShow(ours, "package.json"));
  const theirsPkg = parseManifest(gitShow(theirs, "package.json"));
  const mergedPkg = parseManifest(readFileSync(join(repoRoot, "package.json"), "utf8"));

  const baseWsText = gitShow(base, "pnpm-workspace.yaml");
  const oursWsText = gitShow(ours, "pnpm-workspace.yaml");
  const theirsWsText = gitShow(theirs, "pnpm-workspace.yaml");
  const workspacePath = join(repoRoot, "pnpm-workspace.yaml");
  const mergedWsText = existsSync(workspacePath) ? readFileSync(workspacePath, "utf8") : null;

  const baseWs = parseWorkspace(baseWsText);
  const oursWs = parseWorkspace(oursWsText);
  const theirsWs = parseWorkspace(theirsWsText);
  const mergedWs = parseWorkspace(mergedWsText);

  if (baseWs === null || oursWs === null || theirsWs === null || mergedWs === null) {
    if (baseWsText || oursWsText || theirsWsText || mergedWsText) {
      process.stdout.write(
        "pnpm-workspace.yaml: unsupported YAML construct (flow collections, multi-line scalars, or anchors), skipped\n",
      );
    }
    return compareManifests(basePkg, oursPkg, theirsPkg, mergedPkg);
  }

  return compareManifests(
    basePkg,
    oursPkg,
    theirsPkg,
    mergedPkg,
    baseWs,
    oursWs,
    theirsWs,
    mergedWs,
  );
}

function filterFindings(findings: Finding[], allowed: Set<string>): Finding[] {
  return findings.filter((finding) => {
    const key = `${finding.section}.${finding.key}`;
    return !allowed.has(key);
  });
}

function formatTable(findings: Finding[]): string {
  if (findings.length === 0) {
    return "No lost changes detected.\n";
  }

  const lines = [
    "ERROR: Merge resolution reverted changes:\n",
    "Section                                       Key                          Action   Lost From",
    "--------------------------------------------  ---------------------------  -------  ---------",
  ];

  for (const finding of findings) {
    const section = finding.section.padEnd(44);
    const key = finding.key.padEnd(27);
    const action = finding.action.padEnd(7);
    const lostFrom = finding.lostFrom;
    lines.push(`${section}  ${key}  ${action}  ${lostFrom}`);
  }

  lines.push("");
  lines.push(
    "To suppress a deliberate drop, pass --allow <section>.<key> and document why in the commit message.",
  );

  return lines.join("\n");
}

function run(): number {
  const args = parseArgs();

  let allFindings: Finding[] = [];
  let results: CommitFindingResult[] = [];

  if (args.mode === "files") {
    allFindings = checkFiles(args.files[0], args.files[1], args.files[2], args.files[3]);
  } else if (args.mode === "commit") {
    const result = checkCommit(args.ref!);
    allFindings = result.findings;
    results = [result];
  } else if (args.mode === "range") {
    results = checkRange(args.ref!);
    allFindings = results.flatMap((r) => r.findings);
  } else if (args.mode === "in-progress") {
    allFindings = checkInProgress();
  }

  const filtered = filterFindings(allFindings, args.allowed);

  if (args.jsonOutput) {
    const output =
      args.mode === "range" && results.length > 0
        ? { commits: results.map((r) => ({ ref: r.ref, lostChanges: r.findings })) }
        : { lostChanges: filtered };
    process.stdout.write(JSON.stringify(output) + "\n");
    return 0;
  }

  if (filtered.length === 0) {
    process.stdout.write("No lost changes detected.\n");
    return 0;
  }

  process.stdout.write(formatTable(filtered));
  return 1;
}

try {
  process.exit(run());
} catch (error: unknown) {
  const err = error as Error;
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
}
