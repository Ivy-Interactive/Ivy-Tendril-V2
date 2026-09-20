#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const crateRoot = path.resolve(__dirname, "../crates/tendril-wireframe");
const pipelineRoot = path.join(crateRoot, "pipeline", "vendor");
const artifacts = path.join(crateRoot, "artifacts");

/**
 * The tendril-wireframe payload, generated before anything invokes cargo.
 *
 * `build.rs` embeds `artifacts/` with one `include_bytes!` and panics outright when the payload is
 * incomplete, because a warning there used to produce a binary that compiled cleanly and then died
 * at startup. The payload is generated rather than committed, so on a fresh clone it is simply not
 * there - and every `.github/workflows/*.yml` generates it before touching cargo, while nothing
 * local did. `pnpm dev:desktop` therefore failed on a fresh clone with a build.rs panic that named
 * the fix but left the developer to run it by hand.
 *
 * The four names below are exactly the ones `build.rs` requires. They are checked by name rather
 * than by testing the directory for emptiness: `artifacts/fonts/` and `artifacts/css/fonts.css` are
 * checked in - they are the one step the pipeline cannot reproduce offline - so after a fresh clone
 * the directory is already non-empty while everything that matters is still missing.
 */
const REQUIRED = [
  "vendor.manifest.json",
  "tendril.manifest.json",
  "ARTIFACTS.lock.json",
  "css/tendril.css",
];

/**
 * Why presence and not freshness, when the sibling `ensure-components.mjs` compares mtimes.
 *
 * There is no source tree here to compare against. The payload is a function of the versions pinned
 * in `pipeline/vendor/pnpm-lock.yaml`, and the generator is reproducible: a warm re-run takes about
 * 0.6s and rewrites the same bytes, verified by `verify-artifacts.mjs` and by CI's
 * `git diff --exit-code` over this directory. So the cheap question - are the files there - is also
 * the correct one, and a developer who changes a pinned version runs the pipeline deliberately.
 */
function missingFiles() {
  return REQUIRED.filter((rel) => !fs.existsSync(path.join(artifacts, rel)));
}

const missing = missingFiles();
if (missing.length === 0) {
  process.exit(0);
}

console.log(
  `\x1b[36m[setup] Generating the tendril-wireframe payload (missing ${missing.join(", ")})...\x1b[0m`,
);

try {
  // `--frozen-lockfile` to match what CI installs, so a dev run cannot silently drift off the
  // pinned versions the payload is supposed to be a pure function of. Skipped once the pipeline's
  // own node_modules is in place, which is what keeps the common case near-instant.
  if (!fs.existsSync(path.join(pipelineRoot, "node_modules"))) {
    execSync("pnpm install --frozen-lockfile", { stdio: "inherit", cwd: pipelineRoot });
  }

  // Offline-safe as invoked here: the one networked step, fetch-fonts.mjs, is skipped while the
  // checked-in woff2 files are present, and they are tracked. Regenerating also leaves those
  // tracked files byte-identical, so this never dirties the working tree or trips CI's
  // `git diff --exit-code` gate over artifacts/.
  execSync("node build-all.mjs", { stdio: "inherit", cwd: pipelineRoot });
} catch (err) {
  console.error(
    "\x1b[31m[setup] Could not generate the tendril-wireframe payload. Every cargo build will\n" +
      "  fail until it exists. Generate it with:\n" +
      "    cd src/crates/tendril-wireframe/pipeline/vendor && pnpm install --frozen-lockfile && node build-all.mjs\x1b[0m",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
}

// Fail loudly rather than hand a "success" to a cargo build that is about to panic anyway: the
// generator can exit zero and still not have written what build.rs reads, and the panic that
// follows names build.rs rather than this script.
const stillMissing = missingFiles();
if (stillMissing.length > 0) {
  console.error(
    `\x1b[31m[setup] The pipeline ran but the payload is still missing ${stillMissing.join(", ")}.\x1b[0m`,
  );
  process.exit(1);
}
