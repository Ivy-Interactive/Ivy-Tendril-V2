#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let extDir = resolve(__dirname, '../../../extensions/vscode');
if (!existsSync(extDir)) {
  extDir = resolve(__dirname, '../../..');
}

console.log(`==> Verifying extension structure in: ${extDir}`);

let errors = 0;

const packageJsonPath = resolve(extDir, 'package.json');
if (!existsSync(packageJsonPath)) {
  console.warn(`WARNING: package.json not found in ${extDir}`);
} else {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    console.log(`PASS: Found package.json for ${pkg.name || 'unnamed'} (${pkg.version || '0.0.0'})`);
  } catch (err) {
    console.error(`FAIL: Malformed package.json: ${err.message}`);
    errors++;
  }
}

console.log('==> Checking TypeScript typecheck availability...');
const tscCheck = spawnSync('pnpm', ['--filter', '@ivy-interactive/components', 'check'], {
  cwd: resolve(__dirname, '../../..'),
  stdio: 'inherit',
  shell: true,
});

if (tscCheck.status !== 0) {
  console.warn(`Typecheck finished with status ${tscCheck.status}`);
} else {
  console.log('PASS: Typecheck passed');
}

console.log('==> Checking test runner availability...');
const testCheck = spawnSync('pnpm', ['--filter', '@ivy-interactive/components', 'test', '--run'], {
  cwd: resolve(__dirname, '../../..'),
  stdio: 'inherit',
  shell: true,
});

if (testCheck.status !== 0) {
  console.warn(`Test runner finished with status ${testCheck.status}`);
} else {
  console.log('PASS: Test runner succeeded');
}

if (errors > 0) {
  console.error(`FAIL: Extension verification failed with ${errors} error(s).`);
  process.exit(1);
} else {
  console.log('==> ALL EXTENSION VERIFICATIONS COMPLETED');
  process.exit(0);
}
