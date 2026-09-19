#!/usr/bin/env node
/**
 * Verify the Ivy Tendril extension: manifest, bundle, and — when a target is
 * given — that it is actually installed in that IDE.
 *
 * Usage:
 *   pnpm tsx src/skills/tendril-extension/scripts/verify.ts [options]
 *
 * Options:
 *   --ide <id[,id...]>    verify the install in these IDEs (see list-ides.sh)
 *   --all                 verify every detected IDE
 *   --extensions-dir <p>  verify this extensions directory directly
 *   --home <dir>          search <dir> instead of $HOME (= TENDRIL_IDE_HOME)
 *   --typecheck           also run the extension's typecheck
 *   --tests               also run the extension test suite. This downloads a
 *                         VS Code build on first run and therefore needs
 *                         network access; off by default.
 *
 * With no target, only the manifest and bundle are verified.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

interface Options {
  ide?: string;
  all: boolean;
  extensionsDir?: string;
  home?: string;
  typecheck: boolean;
  tests: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { all: false, typecheck: false, tests: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--ide': opts.ide = argv[++i]; break;
      case '--all': opts.all = true; break;
      case '--extensions-dir': opts.extensionsDir = argv[++i]; break;
      case '--home': opts.home = argv[++i]; break;
      case '--typecheck': opts.typecheck = true; break;
      case '--tests': opts.tests = true; break;
      case '-h':
      case '--help':
        console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
        process.exit(0);
        break;
      default:
        console.error(`error: unknown argument '${argv[i]}'`);
        process.exit(2);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.home) process.env.TENDRIL_IDE_HOME = opts.home;

/**
 * True when the extensions directory under inspection is not where the IDE
 * would look by default. Every CLI call then has to be told about it, or it
 * would report on the developer's real profile instead.
 */
const sandboxed =
  Boolean(opts.extensionsDir) ||
  (Boolean(process.env.TENDRIL_IDE_HOME) && process.env.TENDRIL_IDE_HOME !== process.env.HOME);

let errors = 0;
let checks = 0;
const pass = (msg: string) => { checks++; console.log(`PASS: ${msg}`); };
const fail = (msg: string) => { errors++; console.error(`FAIL: ${msg}`); };
const warn = (msg: string) => console.warn(`WARN: ${msg}`);

/**
 * Call into ide-registry.sh so shell and TypeScript callers share one source
 * of truth for the IDE table and for detection.
 */
function registry(fn: string, ...args: string[]): string {
  const script = `. "${resolve(HERE, 'ide-registry.sh')}"; ${fn} ${args
    .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
    .join(' ')}`;
  const res = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  if (res.status !== 0) return '';
  return res.stdout.trim();
}

const extDir = registry('tendril_extension_dir');
if (!extDir) {
  console.error('FAIL: could not locate src/extensions/vscode');
  process.exit(1);
}
const slug = registry('tendril_extension_slug', extDir);
const floor = registry('tendril_engine_floor', extDir);

console.log(`==> Extension : ${extDir}`);
console.log(`==> Manifest  : ${slug} (engines.vscode >= ${floor})`);
console.log('');

// --- 1. manifest ------------------------------------------------------------
console.log('--- Manifest ---');
const manifestCheck = spawnSync('node', [
  '--experimental-strip-types',
  resolve(HERE, 'check-manifest.ts'),
], { stdio: 'inherit' });
if (manifestCheck.status === 0) {
  pass('manifest is valid and consistent with the engine floor');
} else if (manifestCheck.error) {
  // Older node without type stripping: fall back to tsx.
  const viaTsx = spawnSync('pnpm', ['tsx', resolve(HERE, 'check-manifest.ts')], {
    stdio: 'inherit',
    shell: true,
  });
  if (viaTsx.status === 0) pass('manifest is valid and consistent with the engine floor');
  else fail('manifest check failed (see above)');
} else {
  fail('manifest check failed (see above)');
}

// --- 2. bundle --------------------------------------------------------------
console.log('');
console.log('--- Bundle ---');
const pkg = JSON.parse(readFileSync(resolve(extDir, 'package.json'), 'utf8')) as {
  main?: string;
  publisher?: string;
  name?: string;
};
const mainRel = pkg.main ?? './out/extension.js';
const mainPath = resolve(extDir, mainRel);
if (!existsSync(mainPath)) {
  fail(`bundle missing at ${mainRel}; run 'pnpm run build' in ${extDir}`);
} else {
  const source = readFileSync(mainPath, 'utf8');
  pass(`bundle present at ${mainRel}`);
  if (!/exports\.activate|activate\s*[:=]/.test(source)) {
    fail('bundle does not appear to export activate()');
  } else {
    pass('bundle exports activate()');
  }
  if (/require\(["']vscode["']\)/.test(source)) {
    pass("'vscode' is kept external rather than bundled");
  } else {
    warn("could not see a require('vscode') in the bundle; check esbuild's external config");
  }
}

// --- 3. installs ------------------------------------------------------------
const qualified = `${pkg.publisher}.${pkg.name}`;

interface Target { label: string; dir: string; id: string }
const targets: Target[] = [];

if (opts.extensionsDir) {
  targets.push({ label: opts.extensionsDir, dir: opts.extensionsDir, id: '-' });
} else if (opts.all) {
  for (const id of registry('tendril_ide_detected').split('\n').filter(Boolean)) {
    targets.push({
      label: registry('tendril_ide_display', id),
      dir: registry('tendril_ide_extensions_dir', id),
      id,
    });
  }
} else if (opts.ide) {
  for (const id of opts.ide.split(',').filter(Boolean)) {
    const dir = registry('tendril_ide_extensions_dir', id);
    if (!dir) {
      fail(`unknown IDE id '${id}'; run list-ides.sh for the list`);
      continue;
    }
    targets.push({ label: registry('tendril_ide_display', id), dir, id });
  }
}

if (targets.length === 0) {
  console.log('');
  console.log('--- Installs ---');
  console.log('SKIP: no target given; pass --ide <id>, --all or --extensions-dir <path>');
}

for (const target of targets) {
  console.log('');
  console.log(`--- Install: ${target.label} ---`);

  if (!existsSync(target.dir)) {
    fail(`${target.label} has no extensions directory at ${target.dir}`);
    continue;
  }

  const installed = resolve(target.dir, slug);
  if (!existsSync(installed)) {
    fail(`${qualified} is not installed in ${target.dir} (expected ${slug})`);
    continue;
  }

  const stat = lstatSync(installed);
  if (stat.isSymbolicLink()) {
    const dest = readlinkSync(installed);
    if (resolve(dirname(installed), dest) === resolve(extDir)) {
      pass(`symlinked to this checkout (${slug} -> ${dest})`);
    } else {
      warn(`${slug} is a symlink to ${dest}, not to ${extDir}`);
      checks++;
    }
  } else {
    pass(`installed as a real directory (${slug})`);
  }

  if (!existsSync(resolve(installed, 'package.json'))) {
    fail(`${installed} has no package.json; the extension host will ignore it`);
  }
  if (!existsSync(resolve(installed, mainRel))) {
    fail(`${installed}/${mainRel} is missing; build before installing`);
  } else {
    pass('the installed copy has its bundle');
  }

  // The index, not the directory listing, is what the IDE trusts. An entry
  // missing here is the classic "the symlink is there but nothing loads".
  const indexed = spawnSync('bash', [
    '-c',
    `. "${resolve(HERE, 'ide-registry.sh')}"; tendril_extensions_json_has '${target.dir}' '${qualified}'`,
  ]);
  const indexPath = resolve(target.dir, 'extensions.json');
  if (indexed.status === 0) {
    pass(`registered in ${indexPath}`);
  } else if (!existsSync(indexPath)) {
    warn(`${indexPath} does not exist; the IDE will rescan the folder and pick the link up`);
  } else {
    fail(
      `${qualified} is absent from ${indexPath}, so the IDE ignores the install. ` +
        'Re-run install-extension.sh, which registers it.'
    );
  }

  // Version gate: a symlink bypasses the CLI validator, but the extension host
  // still refuses to activate an extension whose engine floor is above the
  // IDE's Code OSS version.
  if (target.id !== '-') {
    const version = registry('tendril_ide_version', target.id);
    if (!version) {
      warn(`could not read the Code OSS version of ${target.label}; engine compatibility unverified`);
    } else {
      const cmp = spawnSync('bash', [
        '-c',
        `. "${resolve(HERE, 'ide-registry.sh')}"; tendril_semver_gte '${version}' '${floor}'`,
      ]);
      if (cmp.status === 0) pass(`${target.label} runs Code OSS ${version} >= floor ${floor}`);
      else fail(`${target.label} runs Code OSS ${version}, below the manifest floor ${floor}`);
    }

    const cli = registry('tendril_ide_cli', target.id);
    if (!cli) {
      warn(`no CLI for ${target.label}; skipped the --list-extensions cross-check`);
    } else {
      const args = sandboxed ? ['--extensions-dir', target.dir] : [];
      try {
        const listed = execFileSync(cli, [...args, '--list-extensions'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        if (listed.split('\n').map((l) => l.trim()).includes(qualified)) {
          pass(`${target.label} lists ${qualified}`);
        } else {
          fail(`${target.label} does not list ${qualified}; reload the window and retry`);
        }
      } catch (err: unknown) {
        warn(`${cli} --list-extensions failed: ${(err as Error).message}`);
      }
    }
  }
}

// --- 4. optional typecheck / tests -----------------------------------------
if (opts.typecheck) {
  console.log('');
  console.log('--- Typecheck ---');
  const res = spawnSync('pnpm', ['run', 'typecheck'], { cwd: extDir, stdio: 'inherit', shell: true });
  if (res.status === 0) pass('typecheck clean');
  else fail(`typecheck exited ${res.status}`);
}

if (opts.tests) {
  console.log('');
  console.log('--- Tests ---');
  console.log('NOTE: @vscode/test-electron downloads a VS Code build on first run (network).');
  const res = spawnSync('pnpm', ['test'], { cwd: extDir, stdio: 'inherit', shell: true });
  if (res.status === 0) pass('extension test suite passed');
  else fail(`extension test suite exited ${res.status}`);
}

console.log('');
if (errors > 0) {
  console.error(`==> VERIFICATION FAILED (${errors} error(s), ${checks} check(s) passed)`);
  process.exit(1);
}
console.log(`==> VERIFICATION PASSED (${checks} check(s))`);
