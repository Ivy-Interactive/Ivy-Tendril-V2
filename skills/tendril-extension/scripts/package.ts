#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let extDir = resolve(__dirname, '../../../extensions/vscode');
if (!existsSync(extDir)) {
  extDir = resolve(__dirname, '../../..');
}

console.log(`==> Packaging Ivy Tendril VSIX archive in ${extDir}...`);

function run(cmd: string, args: string[]): void {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { cwd: extDir, stdio: 'inherit', shell: true });
  if (res.status !== 0) {
    console.error(`Command failed with exit code ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

run('pnpm', ['install']);
run('pnpm', ['run', 'build']);
run('npx', ['@vscode/vsce', 'package', '--no-dependencies']);

const files = existsSync(extDir) ? readdirSync(extDir) : [];
const vsixFile = files.filter((f) => f.endsWith('.vsix')).pop();
if (vsixFile) {
  console.log(`==> VSIX Package created successfully: ${vsixFile}`);
} else {
  console.log('==> Packaging complete.');
}
