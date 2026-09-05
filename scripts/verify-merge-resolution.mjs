/**
 * Detects merge resolutions that silently revert already-merged changes by keeping the base side
 * when one parent changed.
 *
 * Compares package.json and pnpm-workspace.yaml across merge commits or in-progress merges. For
 * every dependency/script key in package.json and every catalog, override and setting in
 * pnpm-workspace.yaml, if one parent changed the value from the base and the merged result matches
 * the base, that change was lost.
 *
 * Node builtins and `git` only — runs in CI with no install.
 *
 * Usage:
 *   node scripts/verify-merge-resolution.mjs                    in-progress merge (reads MERGE_HEAD)
 *   node scripts/verify-merge-resolution.mjs --commit <ref>     single merge commit
 *   node scripts/verify-merge-resolution.mjs --range <ref>      all merge commits in ref..HEAD
 *   node scripts/verify-merge-resolution.mjs --files <base> <ours> <theirs> <merged>
 *   node scripts/verify-merge-resolution.mjs --json             report as JSON, exit 0
 *   node scripts/verify-merge-resolution.mjs --allow <section>.<key>  suppress one finding (repeatable)
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

function parseArgs() {
  const args = {
    mode: "in-progress",
    jsonOutput: false,
    allowed: new Set(),
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

function gitShow(ref, path) {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    if (error.status === 128) {
      return null;
    }
    throw error;
  }
}

function gitMergeBase(ref1, ref2) {
  return execFileSync("git", ["merge-base", ref1, ref2], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function gitRevList(range) {
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

function parseManifest(text) {
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function parseWorkspace(text) {
  if (!text) {
    return {};
  }

  const lines = text.split("\n");
  const root = {};
  const stack = [{ obj: root, indent: -1 }];

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
    let quoteChar = null;

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
      const nested = {};
      parent[key] = nested;
      stack.push({ obj: nested, indent });
    } else {
      parent[key] = unquote(value);
    }
  }

  function flattenLists(obj) {
    for (const key in obj) {
      if (obj[key] && typeof obj[key] === "object") {
        if ("_list" in obj[key]) {
          obj[key] = obj[key]._list;
        } else {
          flattenLists(obj[key]);
        }
      }
    }
  }

  flattenLists(root);
  return root;
}

function unquote(str) {
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  return str;
}

function getValueAtPath(obj, path) {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return null;
    }
    current = current[part];
  }
  return current === undefined ? null : current;
}

function diffFlatMap(section, baseMap, oursMap, theirsMap, mergedMap, manifest = "package.json") {
  const findings = [];
  const allKeys = new Set([
    ...Object.keys(baseMap),
    ...Object.keys(oursMap),
    ...Object.keys(theirsMap),
    ...Object.keys(mergedMap),
  ]);

  for (const key of allKeys) {
    const baseVal = baseMap[key] || null;
    const oursVal = oursMap[key] || null;
    const theirsVal = theirsMap[key] || null;
    const mergedVal = mergedMap[key] || null;

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

function walkWorkspaceLeafs(obj, prefix = "workspace") {
  const maps = {};

  function walk(current, path) {
    if (current == null || typeof current !== "object") {
      return;
    }

    if (Array.isArray(current)) {
      maps[path] = { [path.split(".").pop()]: JSON.stringify(current) };
      return;
    }

    let hasScalarChild = false;
    for (const key in current) {
      const value = current[key];
      if (value == null || typeof value !== "object") {
        hasScalarChild = true;
        break;
      }
    }

    if (hasScalarChild) {
      const flatMap = {};
      for (const key in current) {
        const value = current[key];
        if (value == null || typeof value !== "object") {
          flatMap[key] = value === null || value === undefined ? null : String(value);
        } else if (Array.isArray(value)) {
          flatMap[key] = JSON.stringify(value);
        }
      }
      if (Object.keys(flatMap).length > 0) {
        maps[path] = flatMap;
      }
    }

    for (const key in current) {
      const value = current[key];
      if (value != null && typeof value === "object" && !Array.isArray(value)) {
        walk(value, path ? `${path}.${key}` : key);
      }
    }
  }

  walk(obj, prefix);
  return maps;
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== "object") return value;
  const sorted = {};
  for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep(value[key]);
  return sorted;
}

function canonicalValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return String(value);
  return JSON.stringify(sortKeysDeep(value));
}

function topLevelMap(manifest) {
  const map = {};
  for (const key of TOP_LEVEL_KEYS) {
    const canonical = canonicalValue(manifest?.[key]);
    if (canonical !== null) map[key] = canonical;
  }
  return map;
}

function compareManifests(base, ours, theirs, merged, baseWs, oursWs, theirsWs, mergedWs) {
  const findings = [];

  for (const section of SECTIONS) {
    const baseSection = getValueAtPath(base, section) || {};
    const oursSection = getValueAtPath(ours, section) || {};
    const theirsSection = getValueAtPath(theirs, section) || {};
    const mergedSection = getValueAtPath(merged, section) || {};

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
  const basePnpm = getValueAtPath(base, pnpmOverridesPath) || {};
  const oursPnpm = getValueAtPath(ours, pnpmOverridesPath) || {};
  const theirsPnpm = getValueAtPath(theirs, pnpmOverridesPath) || {};
  const mergedPnpm = getValueAtPath(merged, pnpmOverridesPath) || {};

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

function checkFiles(basePath, oursPath, theirsPath, mergedPath) {
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

function checkCommit(ref) {
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

function checkRange(ref) {
  const commits = gitRevList(`${ref}..HEAD`);
  const results = [];
  for (const commit of commits) {
    const result = checkCommit(commit);
    if (result.findings.length > 0) {
      results.push(result);
    }
  }
  return results;
}

function checkInProgress() {
  const mergeHeadPath = join(repoRoot, ".git", "MERGE_HEAD");
  if (!existsSync(mergeHeadPath)) {
    throw new Error("Not in a merge (no .git/MERGE_HEAD found)");
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

function filterFindings(findings, allowed) {
  return findings.filter((finding) => {
    const key = `${finding.section}.${finding.key}`;
    return !allowed.has(key);
  });
}

function formatTable(findings) {
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

function run() {
  const args = parseArgs();

  let allFindings = [];
  let results = [];

  if (args.mode === "files") {
    allFindings = checkFiles(...args.files);
  } else if (args.mode === "commit") {
    const result = checkCommit(args.ref);
    allFindings = result.findings;
    results = [result];
  } else if (args.mode === "range") {
    results = checkRange(args.ref);
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
} catch (error) {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exit(1);
}
