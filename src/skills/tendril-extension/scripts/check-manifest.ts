#!/usr/bin/env node
/**
 * Validate src/extensions/vscode/package.json for cross-IDE installability.
 *
 * Run with:
 *   pnpm tsx src/skills/tendril-extension/scripts/check-manifest.ts
 *
 * Everything here is offline and reads only the manifest, the built bundle and
 * the pinned @types/vscode. The rules encode the checks that VS Code and its
 * forks apply at install/activation time, so a failure here corresponds to a
 * real downstream failure rather than to style.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Walk up looking for the extension, so the skill works in-repo or vendored. */
function findExtensionDir(): string {
  if (process.env.TENDRIL_EXTENSION_DIR) {
    return resolve(process.env.TENDRIL_EXTENSION_DIR);
  }
  let dir = HERE;
  while (dir !== '/') {
    for (const candidate of [
      resolve(dir, 'src/extensions/vscode'),
      resolve(dir, 'extensions/vscode'),
    ]) {
      if (existsSync(resolve(candidate, 'package.json'))) return candidate;
    }
    dir = dirname(dir);
  }
  throw new Error('could not locate src/extensions/vscode; set TENDRIL_EXTENSION_DIR');
}

/**
 * Lowest Code OSS version that understands each contribution point. A
 * contribution declared above the manifest's engine floor is silently dropped
 * by older IDEs, which is how a feature "installs fine but does nothing".
 */
const CONTRIBUTION_MIN_ENGINE: Record<string, string> = {
  commands: '1.0.0',
  configuration: '1.0.0',
  menus: '1.0.0',
  views: '1.23.0',
  viewsContainers: '1.24.0',
  keybindings: '1.0.0',
  customEditors: '1.46.0',
  notebooks: '1.57.0',
  walkthroughs: '1.60.0',
  chatParticipants: '1.90.0',
  languageModelTools: '1.95.0',
  mcpServerDefinitionProviders: '1.101.0',
};

/** Lowest Code OSS version that understands each top-level manifest field. */
const FIELD_MIN_ENGINE: Record<string, string> = {
  extensionKind: '1.40.0',
  capabilities: '1.56.0',
  pricing: '1.66.0',
  l10n: '1.73.0',
};

/**
 * Contribution properties gated behind an API proposal. VS Code refuses to
 * register the whole entry when an extension without the proposal uses one:
 *   Extension '<id>' CANNOT use API proposal: defaultChatParticipant.
 * Verified against the 1.137.0 and 1.107.0 bundles on this machine.
 */
const PROPOSAL_GATED: Array<{ point: string; prop: string; proposal: string }> = [
  { point: 'chatParticipants', prop: 'isDefault', proposal: 'defaultChatParticipant' },
  { point: 'chatParticipants', prop: 'modes', proposal: 'defaultChatParticipant' },
  { point: 'chatParticipants', prop: 'locations', proposal: 'chatParticipantAdditions' },
];

/** Category enum read out of the 1.137.0 workbench bundle. */
const VALID_CATEGORIES = [
  'AI', 'Azure', 'Chat', 'Data Science', 'Debuggers', 'Extension Packs', 'Education',
  'Formatters', 'Keymaps', 'Language Packs', 'Linters', 'Machine Learning', 'Notebooks',
  'Programming Languages', 'SCM Providers', 'Snippets', 'Testing', 'Themes',
  'Visualization', 'Other',
];

const VALID_EXTENSION_KINDS = ['ui', 'workspace', 'web'];

interface Manifest {
  name?: string;
  publisher?: string;
  version?: string;
  main?: string;
  browser?: string;
  icon?: string;
  categories?: string[];
  activationEvents?: string[];
  extensionKind?: string[];
  enabledApiProposals?: string[];
  engines?: { vscode?: string };
  contributes?: Record<string, unknown>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

const errors: string[] = [];
const warnings: string[] = [];
const fail = (msg: string) => errors.push(msg);
const warn = (msg: string) => warnings.push(msg);

function parseSemver(input: string): [number, number, number] | undefined {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(input);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

function compare(a: string, b: string): number {
  const [x, y] = [parseSemver(a), parseSemver(b)];
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

const extDir = findExtensionDir();
const manifestPath = resolve(extDir, 'package.json');

let pkg: Manifest;
try {
  pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
} catch (err: unknown) {
  console.error(`FAIL: ${manifestPath} is not valid JSON: ${(err as Error).message}`);
  process.exit(1);
}

console.log(`==> Checking manifest: ${manifestPath}`);

// --- identity ---------------------------------------------------------------
for (const key of ['name', 'publisher', 'version'] as const) {
  if (!pkg[key]) fail(`"${key}" is required; without it the install directory name cannot be built`);
}
if (pkg.name && !/^[a-z0-9][a-z0-9-]*$/.test(pkg.name)) {
  fail(`"name" must be lowercase alphanumeric with dashes, got "${pkg.name}"`);
}

// --- engine floor -----------------------------------------------------------
const rawEngine = pkg.engines?.vscode;
let floor = '';
if (!rawEngine) {
  fail('"engines.vscode" is required');
} else if (!parseSemver(rawEngine)) {
  fail(`"engines.vscode" must contain an x.y.z version, got "${rawEngine}"`);
} else {
  floor = parseSemver(rawEngine)!.join('.');
  if (!/^(\^|>=)?\d+\.\d+\.\d+$/.test(rawEngine.trim())) {
    warn(`"engines.vscode" is "${rawEngine}"; prefer a plain "^x.y.z" so every fork's validator agrees`);
  }
  console.log(`PASS: engines.vscode "${rawEngine}" -> floor ${floor}`);
}

// The @types version caps the API surface the code can even reference. If it
// is newer than the floor, the code can compile against APIs the floor does
// not guarantee, and the extension breaks on the oldest supported IDE.
const typesVersion = pkg.devDependencies?.['@types/vscode'];
if (!typesVersion) {
  warn('"@types/vscode" is not pinned in devDependencies; the API surface is then unbounded');
} else if (floor) {
  const typesFloor = parseSemver(typesVersion);
  if (!typesFloor) {
    warn(`cannot parse @types/vscode "${typesVersion}"`);
  } else if (compare(typesFloor.join('.'), floor) > 0) {
    fail(
      `@types/vscode ${typesVersion} is newer than engines.vscode floor ${floor}; ` +
        'the compiler would accept APIs the floor does not guarantee. Pin them to the same version.'
    );
  } else {
    console.log(`PASS: @types/vscode ${typesVersion} <= floor ${floor}`);
  }
}

// --- entry point ------------------------------------------------------------
if (!pkg.main && !pkg.browser) {
  fail('neither "main" nor "browser" is set, so there is nothing to activate');
}
// vsce enforces this and refuses to package otherwise.
if (pkg.main && (!pkg.activationEvents || pkg.activationEvents.length === 0)) {
  const generated = Object.keys(pkg.contributes ?? {}).some((k) =>
    ['commands', 'chatParticipants', 'views'].includes(k)
  );
  if (!generated) {
    fail('"main" is set but "activationEvents" is empty; vsce refuses to package this');
  }
}
if (pkg.main) {
  const mainPath = resolve(extDir, pkg.main);
  if (!existsSync(mainPath)) {
    warn(`"main" points at ${pkg.main}, which does not exist yet; run 'pnpm run build'`);
  } else {
    console.log(`PASS: bundle present at ${pkg.main}`);
  }
}

// --- files the VSIX needs ---------------------------------------------------
for (const [label, rel] of [
  ['icon', pkg.icon],
  ['LICENSE', 'LICENSE'],
  ['README', 'README.md'],
] as Array<[string, string | undefined]>) {
  if (!rel) continue;
  if (!existsSync(resolve(extDir, rel))) warn(`${label} file "${rel}" is missing`);
}

// --- categories, extensionKind, proposals -----------------------------------
for (const category of pkg.categories ?? []) {
  if (!VALID_CATEGORIES.includes(category)) {
    fail(`category "${category}" is not one of the accepted values: ${VALID_CATEGORIES.join(', ')}`);
  }
}
for (const kind of pkg.extensionKind ?? []) {
  if (!VALID_EXTENSION_KINDS.includes(kind)) {
    fail(`extensionKind "${kind}" must be one of ${VALID_EXTENSION_KINDS.join(', ')}`);
  }
}
if (pkg.enabledApiProposals?.length) {
  fail(
    `"enabledApiProposals" is set (${pkg.enabledApiProposals.join(', ')}). Proposed APIs only ` +
      'work in a build launched with --enable-proposed-api, so a released VSIX must not use them.'
  );
}

// --- contribution points vs the engine floor --------------------------------
const contributes = pkg.contributes ?? {};
for (const point of Object.keys(contributes)) {
  const required = CONTRIBUTION_MIN_ENGINE[point];
  if (!required) {
    warn(`contribution point "${point}" is not in this script's table; its minimum engine is unchecked`);
    continue;
  }
  if (floor && compare(floor, required) < 0) {
    fail(`contributes."${point}" needs engines.vscode >= ${required}, but the floor is ${floor}`);
  }
}
for (const field of Object.keys(FIELD_MIN_ENGINE)) {
  if (pkg[field] === undefined) continue;
  if (floor && compare(floor, FIELD_MIN_ENGINE[field]) < 0) {
    fail(`"${field}" needs engines.vscode >= ${FIELD_MIN_ENGINE[field]}, but the floor is ${floor}`);
  }
}

// --- proposal-gated contribution properties ---------------------------------
for (const { point, prop, proposal } of PROPOSAL_GATED) {
  const entries = contributes[point];
  if (!Array.isArray(entries)) continue;
  for (const entry of entries as Array<Record<string, unknown>>) {
    if (entry && Object.prototype.hasOwnProperty.call(entry, prop)) {
      fail(
        `contributes.${point}[].${prop} requires the "${proposal}" API proposal, which is ` +
          'restricted to first-party extensions. VS Code logs "CANNOT use API proposal" and ' +
          'skips the whole entry, so the feature never registers. Remove it.'
      );
    }
  }
}

// --- chat participant specifics ---------------------------------------------
const participants = contributes.chatParticipants;
if (Array.isArray(participants)) {
  for (const p of participants as Array<Record<string, unknown>>) {
    if (!p.id || !p.name) fail('every contributes.chatParticipants entry needs both "id" and "name"');
    if (typeof p.name === 'string' && !/^[\w-]+$/.test(p.name)) {
      fail(`chat participant name "${p.name}" must match /^[\\w-]+$/`);
    }
  }
  console.log(`PASS: ${participants.length} chat participant(s) declared`);
}

// --- report -----------------------------------------------------------------
for (const w of warnings) console.warn(`WARN: ${w}`);
for (const e of errors) console.error(`FAIL: ${e}`);

if (errors.length > 0) {
  console.error(`==> MANIFEST CHECK FAILED (${errors.length} error(s), ${warnings.length} warning(s))`);
  process.exit(1);
}
console.log(`==> MANIFEST OK (${warnings.length} warning(s))`);
