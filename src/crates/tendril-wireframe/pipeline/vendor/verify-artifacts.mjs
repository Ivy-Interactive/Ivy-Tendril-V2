// Checks that artifacts/ on disk matches the SHA-256s in ARTIFACTS.lock.json.
//
// The lock has always recorded a hash per file, but nothing ever checked it: build-all.mjs writes
// the lock from whatever it just produced, so the file is self-consistent by construction and
// says nothing about whether the pinned versions still produce those bytes. Running this after a
// clean `node build-all.mjs` is what turns it into a real guarantee.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const artifacts = path.resolve(here, "../../artifacts");
const LOCK = "ARTIFACTS.lock.json";

export function verifyArtifacts() {
  const lockPath = path.join(artifacts, LOCK);
  if (!fs.existsSync(lockPath)) {
    throw new Error(`${LOCK} is missing. Run: node build-all.mjs`);
  }
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));

  const onDisk = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name !== LOCK) onDisk.push(path.relative(artifacts, p).split(path.sep).join("/"));
    }
  };
  walk(artifacts);

  const changed = [];
  const missing = [];
  for (const [rel, want] of Object.entries(lock.files)) {
    const p = path.join(artifacts, rel);
    if (!fs.existsSync(p)) {
      missing.push(rel);
      continue;
    }
    const got = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    if (got !== want) changed.push(rel);
  }
  const extra = onDisk.filter((f) => !(f in lock.files));

  const problems = [
    ["missing", missing],
    ["changed", changed],
    ["unexpected", extra],
  ].filter(([, list]) => list.length);

  if (problems.length) {
    const detail = problems
      .map(([kind, list]) => `  ${list.length} ${kind}:\n${list.slice(0, 10).map((f) => `    ${f}`).join("\n")}` +
        (list.length > 10 ? `\n    ... and ${list.length - 10} more` : ""))
      .join("\n");
    throw new Error(
      `artifacts/ does not match ${LOCK}:\n${detail}\n\n` +
        `The payload is generated from the versions pinned in pnpm-lock.yaml. If this fired in CI ` +
        `the pinned versions no longer produce the recorded bytes; if it fired locally, re-run ` +
        `node build-all.mjs.`
    );
  }

  return { fileCount: Object.keys(lock.files).length, totalBytes: lock.totalBytes };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { fileCount, totalBytes } = verifyArtifacts();
  console.log(`artifacts/ matches ${LOCK}: ${fileCount} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
}
