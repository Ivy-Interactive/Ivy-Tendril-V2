#!/usr/bin/env node
/**
 * Build a .vsix for the Ivy Tendril extension.
 *
 * Usage:
 *   pnpm tsx src/skills/tendril-extension/scripts/package.ts [--out <path>] [--no-build]
 *
 * This is a thin wrapper over package-vsix.sh so the shell and Node entry
 * points cannot drift. The shell script owns the logic: manifest validation,
 * build, then the workspace-local vsce.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const script = resolve(HERE, 'package-vsix.sh');

const res = spawnSync('bash', [script, ...process.argv.slice(2)], { stdio: 'inherit' });
if (res.error) {
  console.error(`error: could not run ${script}: ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status ?? 1);
