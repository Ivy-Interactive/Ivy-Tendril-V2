/**
 * Detects merge resolutions that silently revert already-merged changes by keeping the base side
 * when one parent changed.
 *
 * Compares package.json manifests across merge commits or in-progress merges. For every key in
 * dependencies/devDependencies/peerDependencies/optionalDependencies/scripts/pnpm.overrides, if
 * one parent changed the value from the base and the merged result matches the base, that change
 * was lost.
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

function compareManifests(base, ours, theirs, merged) {
  const findings = [];

  for (const section of SECTIONS) {
    const baseSection = getValueAtPath(base, section) || {};
    const oursSection = getValueAtPath(ours, section) || {};
    const theirsSection = getValueAtPath(theirs, section) || {};
    const mergedSection = getValueAtPath(merged, section) || {};

    const allKeys = new Set([
      ...Object.keys(baseSection),
      ...Object.keys(oursSection),
      ...Object.keys(theirsSection),
      ...Object.keys(mergedSection),
    ]);

    for (const key of allKeys) {
      const baseVal = baseSection[key] || null;
      const oursVal = oursSection[key] || null;
      const theirsVal = theirsSection[key] || null;
      const mergedVal = mergedSection[key] || null;

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
        });
      }
    }
  }

  const pnpmOverridesPath = "pnpm.overrides";
  const basePnpm = getValueAtPath(base, pnpmOverridesPath) || {};
  const oursPnpm = getValueAtPath(ours, pnpmOverridesPath) || {};
  const theirsPnpm = getValueAtPath(theirs, pnpmOverridesPath) || {};
  const mergedPnpm = getValueAtPath(merged, pnpmOverridesPath) || {};

  const allPnpmKeys = new Set([
    ...Object.keys(basePnpm),
    ...Object.keys(oursPnpm),
    ...Object.keys(theirsPnpm),
    ...Object.keys(mergedPnpm),
  ]);

  for (const key of allPnpmKeys) {
    const baseVal = basePnpm[key] || null;
    const oursVal = oursPnpm[key] || null;
    const theirsVal = theirsPnpm[key] || null;
    const mergedVal = mergedPnpm[key] || null;

    if (oursVal !== baseVal && mergedVal === baseVal) {
      findings.push({
        section: "pnpm.overrides",
        key,
        action: baseVal === null ? "added" : oursVal === null ? "removed" : "changed",
        lostFrom: "ours",
        base: baseVal,
        ours: oursVal,
        theirs: theirsVal,
        merged: mergedVal,
      });
    }

    if (theirsVal !== baseVal && mergedVal === baseVal) {
      findings.push({
        section: "pnpm.overrides",
        key,
        action: baseVal === null ? "added" : theirsVal === null ? "removed" : "changed",
        lostFrom: "theirs",
        base: baseVal,
        ours: oursVal,
        theirs: theirsVal,
        merged: mergedVal,
      });
    }
  }

  return findings;
}

function checkFiles(basePath, oursPath, theirsPath, mergedPath) {
  const base = parseManifest(readFileSync(basePath, "utf8"));
  const ours = parseManifest(readFileSync(oursPath, "utf8"));
  const theirs = parseManifest(readFileSync(theirsPath, "utf8"));
  const merged = parseManifest(readFileSync(mergedPath, "utf8"));
  return compareManifests(base, ours, theirs, merged);
}

function checkCommit(ref) {
  const base = parseManifest(gitShow(gitMergeBase(`${ref}^1`, `${ref}^2`), "package.json"));
  const ours = parseManifest(gitShow(`${ref}^1`, "package.json"));
  const theirs = parseManifest(gitShow(`${ref}^2`, "package.json"));
  const merged = parseManifest(gitShow(ref, "package.json"));
  return { ref, findings: compareManifests(base, ours, theirs, merged) };
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

  return compareManifests(basePkg, oursPkg, theirsPkg, mergedPkg);
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
    "Section              Key                          Action   Lost From",
    "-------------------  ---------------------------  -------  ---------",
  ];

  for (const finding of findings) {
    const section = finding.section.padEnd(19);
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
