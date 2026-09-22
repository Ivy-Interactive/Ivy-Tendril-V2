// `setup`: clone, check out and build everything the benchmark runs, then record exactly what was
// built in <ws>/build-info.json. A benchmark is only as reproducible as its inputs, so every step
// records the commit, command, tool versions and output digests it produced, and a step is skipped
// only when a stamp proves its inputs are unchanged and its outputs still exist.
//
//   node src/benchmark/bin/tendril-bench.ts setup [--only a,b] [--skip a,b] [--force] [--smoke] [--list]
//
// Steps run in the order of STEPS below. `--only` also accepts the groups v1, v2 and clone. `smoke`
// is opt-in (--smoke or --only smoke): it starts the V2 daemon + IPC shim and loads the UI in headless
// Chromium, then opens the real V2 desktop app once, which puts a window on screen.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';
import { parseArgs } from 'node:util';
import {
  BENCH_ROOT,
  REPO_ROOT,
  V1_PKG_ASSET,
  V1_REF,
  V1_RELEASE_REPO,
  V1_REPO,
  V1_SHA,
  V2_REPO,
  type CommandContext,
  type WorkspacePaths,
} from '../lib/config.ts';
import { v1BinaryInfo } from '../lib/env.ts';
import { errorMessage, errorText, localIso, type Logger } from '../lib/log.ts';
import { appEnv, cleanEnv, freePort, installExitHandlers, isAlive, registerCleanup, run, sleep, spawnLogged, stopAll, waitFor, waitForHttpDetailed, type Spawned } from '../lib/proc.ts';
import { PROCSTAT_SOURCE, ProcStat } from '../lib/procstat.ts';
import { readJson, writeJsonAtomic } from '../lib/results.ts';
import { dirBytes, listFiles } from '../lib/sizes.ts';

// ---------------------------------------------------------------------------------------------
// Constants

const BUILD_INFO_SCHEMA = 1;
/** Bumped when a step's semantics change, so old stamps stop counting as up to date. */
const STAMP_VERSION = 1;

/** Exactly the release publish (research: src/build_local.sh, publish-tendril.yml), plus CommitId. */
function v1PublishArgs(outDir: string, sha: string): string[] {
  return [
    'publish',
    'src/Ivy.Tendril/Ivy.Tendril.csproj',
    '-c',
    'Release',
    '-r',
    'osx-arm64',
    '-o',
    outDir,
    '-p:PublishSingleFile=true',
    '-p:ReadyToRun=false',
    '-p:Version=1.2.4',
    '-p:Publishing=true',
    `-p:CommitId=${sha}`,
    '--self-contained',
    'true',
  ];
}

/** CI (release-app.yml) runs `tauri build` with the config's macOS targets; these are the same two. */
const TAURI_BUILD_ARGS = ['--filter', '@ivy-interactive/tendril-app', 'exec', 'tauri', 'build', '--bundles', 'app,dmg', '--no-sign'];

/**
 * Build-affecting variables removed from every build command, so a developer's shell cannot change
 * what gets built: a stray CARGO_TARGET_DIR would even move the outputs, RUSTUP_TOOLCHAIN would
 * override rust-toolchain.toml, and APPLE_* would make tauri sign.
 */
const BUILD_SCRUB = [
  'CARGO_TARGET_DIR',
  'CARGO_BUILD_TARGET_DIR',
  'CARGO_BUILD_TARGET',
  'RUSTFLAGS',
  'CARGO_BUILD_RUSTFLAGS',
  'CARGO_ENCODED_RUSTFLAGS',
  'RUSTUP_TOOLCHAIN',
  'NODE_ENV',
  'NODE_OPTIONS',
  'CI',
  'APPLE_SIGNING_IDENTITY',
  'APPLE_CERTIFICATE',
  'APPLE_CERTIFICATE_PASSWORD',
  'APPLE_ID',
  'APPLE_PASSWORD',
  'APPLE_TEAM_ID',
  'APPLE_API_ISSUER',
  'APPLE_API_KEY',
  'APPLE_API_KEY_PATH',
  'TAURI_SIGNING_PRIVATE_KEY',
  'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
  'OPENCODE_VERSION',
  'OPENCODE_FORCE',
];

const INSTALLED_V1_APP = '/Applications/Ivy Tendril.app';
const V2_LAUNCH_AGENT = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.spacecorps.tendril.service.plist');

const HOUR = 3_600_000;

// ---------------------------------------------------------------------------------------------
// Small helpers

function exists(p: string): boolean {
  return fs.existsSync(p);
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

function sha256Text(s: string | Buffer): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function sha256OrNull(file: string): Promise<string | null> {
  return exists(file) ? sha256File(file) : null;
}

/** One digest for a whole tree: sha256 over the sorted (relative path, file sha256) list. */
async function treeDigest(dir: string): Promise<{ digest: string; files: number; bytes: number }> {
  const files = listFiles(dir);
  const h = crypto.createHash('sha256');
  let bytes = 0;
  for (const f of files) {
    h.update(`${f.rel}\0${await sha256File(f.abs)}\n`);
    bytes += f.bytes;
  }
  return { digest: h.digest('hex'), files: files.length, bytes };
}

function rmrf(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}

/** Replaces `dest` with `staged` so a reader never sees a half-written directory or file. */
function swapInto(staged: string, dest: string): void {
  const old = `${dest}.old-${process.pid}`;
  if (exists(dest)) fs.renameSync(dest, old);
  fs.renameSync(staged, dest);
  rmrf(old);
}

function firstLine(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.split('\n').map((l) => l.trim()).find(Boolean) ?? null;
}

async function tryOut(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}): Promise<string | null> {
  try {
    const r = await run(cmd, args, { cwd: opts.cwd, env: opts.env ?? buildEnv(), timeoutMs: opts.timeoutMs ?? 60_000 });
    return (r.stdout.trim() || r.stderr.trim()) || null;
  } catch {
    return null;
  }
}

function buildEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env = cleanEnv();
  for (const k of BUILD_SCRUB) delete env[k];
  for (const k of Object.keys(env)) if (k.startsWith('CARGO_PROFILE_')) delete env[k];
  return { ...env, ...extra };
}

function scrubbedBuildVarsPresent(): string[] {
  return Object.keys(process.env)
    .filter((k) => BUILD_SCRUB.includes(k) || k.startsWith('CARGO_PROFILE_'))
    .sort();
}

async function gitOut(dir: string, args: string[]): Promise<string | null> {
  return tryOut('git', ['-C', dir, ...args], { env: cleanEnv() });
}

async function gitHead(dir: string): Promise<string | null> {
  if (!exists(path.join(dir, '.git'))) return null;
  return gitOut(dir, ['rev-parse', 'HEAD']);
}

async function gitResolve(dir: string, ref: string): Promise<string | null> {
  return gitOut(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
}

async function gitStatus(dir: string): Promise<{ modified: string[]; untracked: string[] }> {
  const s = (await gitOut(dir, ['status', '--porcelain'])) ?? '';
  const modified: string[] = [];
  const untracked: string[] = [];
  for (const l of s.split('\n').filter(Boolean)) (l.startsWith('??') ? untracked : modified).push(l.slice(3));
  return { modified, untracked };
}

async function plistValue(plist: string, key: string): Promise<string | null> {
  return tryOut('/usr/bin/plutil', ['-extract', key, 'raw', plist]);
}

/** Top-level `name = "x"` / `version = "y"` pairs of a Cargo.lock. */
function lockVersions(file: string): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  let name: string | null = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line === '[[package]]') name = null;
    const n = line.match(/^name = "(.+)"$/);
    if (n) name = n[1]!;
    const v = line.match(/^version = "(.+)"$/);
    if (v && name) {
      if (!m.has(name)) m.set(name, new Set());
      m.get(name)!.add(v[1]!);
    }
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Command runner (build logs)

interface CmdRecord {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  exit: number | null;
  signal: string | null;
  ms: number;
}

interface ShOptions {
  cwd: string;
  env?: Record<string, string>;
  /** Only the non-inherited variables worth recording (e.g. NODE_ENV, CI). */
  envNote?: Record<string, string>;
  timeoutMs?: number;
  allowFail?: boolean;
}

class CommandFailed extends Error {
  override name = 'CommandFailed';
  readonly tail: string;
  constructor(message: string, tail: string) {
    super(message);
    this.tail = tail;
  }
}

// ---------------------------------------------------------------------------------------------
// Steps

type StepName =
  | 'v1-clone'
  | 'v2-clone'
  | 'procstat'
  | 'v1-publish'
  | 'v1-pkg'
  | 'v2-deps'
  | 'v2-wireframe'
  | 'v2-frontend'
  | 'v2-cli'
  | 'v2-sidecars'
  | 'v2-app'
  | 'v2-shim'
  | 'v1-select'
  | 'smoke';

type Info = Record<string, unknown>;

interface Stamp {
  step: StepName;
  stampVersion: number;
  key: string;
  completedAt: string;
  durationMs: number;
  info: Info;
}

interface StepDef {
  name: StepName;
  title: string;
  /** Where the step's info lives in build-info.json. */
  section: [string] | [string, string];
  /** Steps whose outputs must exist first (checked, not run, when they are not selected). */
  deps: StepName[];
  /** Not part of a default run. */
  optional?: boolean;
  /** Inputs that decide freshness; omitted = always runs (cheap and idempotent by itself). */
  key?: (s: StepRun) => Promise<unknown>;
  outputs?: (s: StepRun) => string[];
  run: (s: StepRun) => Promise<Info>;
}

class StepRun {
  readonly commands: CmdRecord[] = [];
  readonly notes: string[] = [];
  readonly logFile: string;
  readonly step: StepDef;
  readonly ctx: CommandContext;
  readonly paths: WorkspacePaths;
  readonly log: Logger;
  readonly force: boolean;
  readonly logDir: string;
  readonly scratch: string;
  constructor(step: StepDef, ctx: CommandContext, paths: WorkspacePaths, log: Logger, force: boolean, logDir: string, scratch: string) {
    this.step = step;
    this.ctx = ctx;
    this.paths = paths;
    this.log = log;
    this.force = force;
    this.logDir = logDir;
    this.scratch = scratch;
    this.logFile = path.join(logDir, `${step.name}.log`);
  }

  note(msg: string): void {
    this.notes.push(msg);
    this.log.warn(msg);
  }

  /** Runs a build command with stdout+stderr appended to this step's log; throws with the log tail. */
  async sh(cmd: string, args: string[], opts: ShOptions): Promise<CmdRecord & { tail: string }> {
    fs.mkdirSync(this.logDir, { recursive: true });
    const file = fs.openSync(this.logFile, 'a');
    const header = `\n===== ${localIso()} $ ${[cmd, ...args].join(' ')}  (cwd ${opts.cwd})${opts.envNote ? `  env ${JSON.stringify(opts.envNote)}` : ''}\n`;
    fs.writeSync(file, header);
    this.log.info(`$ ${[cmd, ...args].join(' ')}  (log: ${this.logFile})`);
    const t0 = performance.now();
    const tail: string[] = [];
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? buildEnv(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const killGroup = () => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
    };
    const unregister = registerCleanup(killGroup);
    const pump = (src: NodeJS.ReadableStream) => {
      const dec = new StringDecoder('utf8');
      let partial = '';
      src.on('data', (chunk: Buffer) => {
        fs.writeSync(file, chunk);
        partial += dec.write(chunk);
        const lines = partial.split('\n');
        partial = lines.pop() ?? '';
        for (const l of lines) {
          tail.push(l);
          if (tail.length > 80) tail.shift();
        }
      });
      src.on('end', () => {
        if (partial) tail.push(partial);
      });
    };
    pump(child.stdout!);
    pump(child.stderr!);
    let timer: NodeJS.Timeout | null = null;
    let timedOut = false;
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        killGroup();
      }, opts.timeoutMs);
    }
    const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on('error', (e) => {
        tail.push(`spawn error: ${e.message}`);
        resolve({ code: 127, signal: null });
      });
      child.on('close', (c, s) => resolve({ code: c, signal: s }));
    });
    if (timer) clearTimeout(timer);
    unregister();
    const ms = performance.now() - t0;
    fs.writeSync(file, `===== exit ${code}${signal ? ` (${signal})` : ''}${timedOut ? ' (timed out)' : ''} after ${(ms / 1000).toFixed(1)} s\n`);
    fs.closeSync(file);
    const rec: CmdRecord = { cmd, args, cwd: opts.cwd, env: opts.envNote, exit: code, signal, ms: Math.round(ms) };
    this.commands.push(rec);
    const tailText = tail.slice(-40).join('\n');
    if (code !== 0 && !opts.allowFail) {
      throw new CommandFailed(`${path.basename(cmd)} ${args.slice(0, 3).join(' ')} failed with exit ${code}${signal ? ` (${signal})` : ''}${timedOut ? ' (timed out)' : ''}; see ${this.logFile}\n${tailText}`, tailText);
    }
    return { ...rec, tail: tailText };
  }
}

// --- V1 --------------------------------------------------------------------------------------

async function ensureClone(s: StepRun, o: { dir: string; repo: string; ref: string; expectSha?: string }): Promise<Info> {
  const { dir, repo, ref } = o;
  let cloned = false;
  if (!exists(path.join(dir, '.git'))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await s.sh('git', ['clone', repo, dir], { cwd: path.dirname(dir), env: cleanEnv(), timeoutMs: HOUR });
    cloned = true;
  }
  let sha = await gitResolve(dir, ref);
  let fetched = false;
  if (!sha || s.force) {
    // Only when the pin is not already known locally: a pinned sha never moves, so a clone that has
    // it needs no network.
    const r = await s.sh('git', ['-C', dir, 'fetch', '--tags', 'origin'], { cwd: dir, env: cleanEnv(), timeoutMs: HOUR, allowFail: !!sha });
    fetched = r.exit === 0;
    sha = await gitResolve(dir, ref);
    if (!sha && /^[0-9a-f]{7,40}$/.test(ref)) {
      await s.sh('git', ['-C', dir, 'fetch', 'origin', ref], { cwd: dir, env: cleanEnv(), timeoutMs: HOUR });
      sha = await gitResolve(dir, ref);
    }
  }
  if (!sha) throw new Error(`${ref} does not resolve to a commit in ${dir}`);
  if (o.expectSha && sha !== o.expectSha) throw new Error(`${ref} resolves to ${sha} in ${dir}, expected ${o.expectSha} (did the tag move?)`);
  const headBefore = await gitHead(dir);
  if (headBefore !== sha) {
    await s.sh('git', ['-c', 'advice.detachedHead=false', '-C', dir, 'checkout', '--detach', sha], { cwd: dir, env: cleanEnv(), timeoutMs: 10 * 60_000 });
  }
  const st = await gitStatus(dir);
  if (st.modified.length) s.note(`${dir} has ${st.modified.length} modified tracked file(s): ${st.modified.slice(0, 5).join(', ')}`);
  return {
    dir,
    repo,
    origin: await gitOut(dir, ['remote', 'get-url', 'origin']),
    ref,
    sha,
    cloned,
    fetched,
    checkedOut: headBefore !== sha,
    headBefore,
    commitDate: await gitOut(dir, ['show', '-s', '--format=%cI', sha]),
    subject: await gitOut(dir, ['show', '-s', '--format=%s', sha]),
    modified: st.modified,
    untracked: st.untracked.slice(0, 50),
    untrackedCount: st.untracked.length,
  };
}

async function requireSha(dir: string, what: string): Promise<string> {
  const sha = await gitHead(dir);
  if (!sha) throw new Error(`${what} clone missing at ${dir}: run \`setup --only ${what}-clone\` first`);
  return sha;
}

async function stepV1Publish(s: StepRun): Promise<Info> {
  const { paths } = s;
  const sha = await requireSha(paths.v1Clone, 'v1');
  const sdk = await tryOut('dotnet', ['--version'], { cwd: paths.v1Clone });
  const staged = `${paths.v1Publish}.tmp-${process.pid}`;
  rmrf(staged);
  const sibling = path.join(path.dirname(paths.v1Clone), 'Ivy-Framework');
  if (exists(sibling)) s.note(`${sibling} exists; Publishing=true still forces the NuGet Ivy packages, but it would flip IvySource for any other build`);
  const env = buildEnv({ DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' });
  const args = v1PublishArgs(staged, sha);
  await s.sh('dotnet', args, { cwd: paths.v1Clone, env, envNote: { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' }, timeoutMs: 2 * HOUR });
  const stagedBin = path.join(staged, 'Ivy.Tendril');
  if (!exists(stagedBin)) throw new Error(`dotnet publish succeeded but ${stagedBin} is missing`);
  // Publish into a fresh directory and swap it in: a process still running the old single-file
  // binary keeps its inode instead of having its code pages rewritten under it.
  swapInto(staged, paths.v1Publish);
  const info = await v1BinaryInfo(paths.v1PublishBin);
  if (info.version !== '1.2.4') throw new Error(`published binary reports Tendril ${info.version}, expected 1.2.4`);
  return {
    dir: paths.v1Publish,
    bin: paths.v1PublishBin,
    bytes: info.bytes,
    sha256: await sha256File(paths.v1PublishBin),
    version: info.version,
    frameworks: info.frameworks,
    commitId: sha,
    dotnetSdk: sdk,
    command: ['dotnet', ...v1PublishArgs(paths.v1Publish, sha)],
    buildFlags: { configuration: 'Release', runtime: 'osx-arm64', PublishSingleFile: true, ReadyToRun: false, Version: '1.2.4', Publishing: true, CommitId: sha, selfContained: true },
    siblingIvyFramework: exists(sibling),
    files: listFiles(paths.v1Publish).map((f) => ({ file: f.rel, bytes: f.bytes })),
  };
}

interface ReleaseAsset {
  name: string;
  size: number;
  digest?: string;
  url?: string;
}

async function stepV1Pkg(s: StepRun): Promise<Info> {
  const { paths } = s;
  fs.mkdirSync(paths.artifactsV1, { recursive: true });
  const pkg = path.join(paths.artifactsV1, V1_PKG_ASSET);
  let asset: ReleaseAsset | null = null;
  let publishedAt: string | null = null;
  const view = await tryOut('gh', ['release', 'view', V1_REF, '-R', V1_RELEASE_REPO, '--json', 'assets,publishedAt,tagName'], { env: cleanEnv(), timeoutMs: 120_000 });
  if (view) {
    try {
      const j = JSON.parse(view) as { assets: ReleaseAsset[]; publishedAt?: string };
      asset = j.assets.find((a) => a.name === V1_PKG_ASSET) ?? null;
      publishedAt = j.publishedAt ?? null;
    } catch {
      asset = null;
    }
  }
  if (!asset) s.note(`could not read the ${V1_REF} release assets with gh; the pkg digest is not verified against GitHub`);
  const expected = asset?.digest?.replace(/^sha256:/, '') ?? null;

  let sha = await sha256OrNull(pkg);
  let downloaded = false;
  if (!sha || s.force || (expected && sha !== expected)) {
    const dl = path.join(paths.artifactsV1, `.download-${process.pid}`);
    rmrf(dl);
    fs.mkdirSync(dl, { recursive: true });
    try {
      await s.sh('gh', ['release', 'download', V1_REF, '-R', V1_RELEASE_REPO, '-p', V1_PKG_ASSET, '-D', dl, '--clobber'], { cwd: paths.artifactsV1, env: cleanEnv(), timeoutMs: 2 * HOUR });
      fs.renameSync(path.join(dl, V1_PKG_ASSET), pkg);
    } finally {
      rmrf(dl);
    }
    sha = await sha256File(pkg);
    downloaded = true;
  }
  if (expected && sha !== expected) throw new Error(`${pkg} sha256 ${sha} does not match the release digest ${expected}`);

  // `pkgutil --expand-full` refuses an existing destination, and a half-expanded tree must never
  // be mistaken for a good one: expand beside it and swap.
  const expanded = path.join(paths.artifactsV1, 'pkg-expanded');
  const staged = `${expanded}.tmp-${process.pid}`;
  rmrf(staged);
  await s.sh('/usr/sbin/pkgutil', ['--expand-full', pkg, staged], { cwd: paths.artifactsV1, env: cleanEnv(), timeoutMs: HOUR });
  swapInto(staged, expanded);
  const apps: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.name.endsWith('.app') && exists(path.join(p, 'Contents', 'MacOS', 'Ivy.Tendril'))) apps.push(p);
      else walk(p, depth + 1);
    }
  };
  walk(expanded, 0);
  if (apps.length !== 1) throw new Error(`expected exactly one Ivy Tendril .app in ${expanded}, found ${apps.length}: ${apps.join(', ')}`);
  const app = apps[0]!;
  const bin = path.join(app, 'Contents', 'MacOS', 'Ivy.Tendril');
  const totals = dirBytes(app);
  const quarantine = await tryOut('/usr/bin/xattr', ['-p', 'com.apple.quarantine', pkg]);
  return {
    asset: V1_PKG_ASSET,
    tag: V1_REF,
    repo: V1_RELEASE_REPO,
    url: asset?.url ?? null,
    publishedAt,
    pkg,
    bytes: fs.statSync(pkg).size,
    githubSize: asset?.size ?? null,
    sha256: sha,
    githubDigest: asset?.digest ?? null,
    digestVerified: !!expected && sha === expected,
    downloaded,
    quarantined: !!quarantine,
    expandedDir: expanded,
    components: fs.readdirSync(expanded).sort(),
    app,
    appBin: bin,
    appVersion: await plistValue(path.join(app, 'Contents', 'Info.plist'), 'CFBundleShortVersionString'),
    appBundleId: await plistValue(path.join(app, 'Contents', 'Info.plist'), 'CFBundleIdentifier'),
    appBinBytes: fs.statSync(bin).size,
    appBinSha256: await sha256File(bin),
    appTotals: totals,
  };
}

// --- V1 binary selection --------------------------------------------------------------------

interface SymlinkEffect {
  /** 'none': not inside a .app, EnsureCliSymlink returns at once; 'noop': it would change nothing. */
  effect: 'none' | 'noop' | 'would-modify';
  detail: string;
}

/**
 * What V1's `PathHelper.EnsureCliSymlink()` (Program.cs:174, every invocation) would do for this
 * executable with this HOME. For a binary inside `*.app/Contents/MacOS/` it (re)points
 * `/usr/local/bin/tendril`, else `~/.local/bin/tendril`, at itself. Running the expanded release pkg
 * therefore re-points the user's `tendril` command into the benchmark workspace; the harness must
 * only run .app binaries for which this is a no-op.
 */
function cliSymlinkEffect(exe: string, home: string): SymlinkEffect {
  if (!exe.includes('.app/Contents/MacOS/')) return { effect: 'none', detail: 'not inside a .app bundle: EnsureCliSymlink returns immediately' };
  const exeReal = fs.realpathSync(exe);
  const writable = (d: string) => {
    try {
      fs.accessSync(d, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  };
  for (const dir of ['/usr/local/bin', path.join(home, '.local', 'bin')]) {
    const link = path.join(dir, 'tendril');
    if (!exists(dir)) {
      if (writable(path.dirname(dir))) return { effect: 'would-modify', detail: `would create ${dir} and ${link}` };
      continue;
    }
    let target: string | null = null;
    try {
      target = fs.realpathSync(link);
    } catch {
      target = null;
    }
    if (target !== null) {
      if (target === exeReal) return { effect: 'noop', detail: `${link} already points at this binary` };
      if (writable(dir)) return { effect: 'would-modify', detail: `would re-point ${link} (now ${target}) at ${exe}` };
      continue;
    }
    let dangling = false;
    try {
      fs.lstatSync(link);
      dangling = true;
    } catch {
      dangling = false;
    }
    // A dangling link makes File.CreateSymbolicLink throw (EEXIST), and it moves on.
    if (!dangling && writable(dir)) return { effect: 'would-modify', detail: `would create ${link}` };
  }
  return { effect: 'noop', detail: 'no candidate location is writable' };
}

interface LinkSnapshot {
  path: string;
  kind: 'missing' | 'symlink' | 'other';
  target: string | null;
}

function snapshotCliLinks(home: string = os.homedir()): LinkSnapshot[] {
  return ['/usr/local/bin/tendril', path.join(home, '.local', 'bin', 'tendril')].map((p) => {
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) return { path: p, kind: 'symlink', target: fs.readlinkSync(p) };
      return { path: p, kind: 'other', target: null };
    } catch {
      return { path: p, kind: 'missing', target: null };
    }
  });
}

/** Puts the user's `tendril` symlinks back if a V1 run changed them (it must not, but check). */
function restoreCliLinks(before: LinkSnapshot[], log: Logger): string[] {
  const changed: string[] = [];
  const after = snapshotCliLinks();
  for (const b of before) {
    const a = after.find((x) => x.path === b.path)!;
    if (a.kind === b.kind && a.target === b.target) continue;
    changed.push(`${b.path}: ${b.kind}${b.target ? ` -> ${b.target}` : ''} became ${a.kind}${a.target ? ` -> ${a.target}` : ''}`);
    try {
      if (b.kind === 'symlink' && b.target) {
        if (a.kind !== 'missing') fs.rmSync(b.path, { force: true });
        fs.symlinkSync(b.target, b.path);
      } else if (b.kind === 'missing' && a.kind === 'symlink') {
        fs.rmSync(b.path, { force: true });
      }
      log.error(`restored ${b.path} after a V1 run changed it`);
    } catch (e) {
      log.error(`could not restore ${b.path}: ${errorMessage(e)}`);
    }
  }
  return changed;
}

const SMOKE_CONFIG = [
  'codingAgent: claude',
  'telemetry: false',
  'enrichModels: false',
  'desktopNotifications: false',
  'worktreeReaperInterval: 0',
  'inbox:',
  '  autoAcceptAssignedIssues: false',
  '  checkIntervalMinutes: 0',
];

interface V1Smoke {
  ok: boolean;
  httpReadyMs: number | null;
  dataReadyMs: number | null;
  ping: string | null;
  masterScheme: string | null;
  masterPort: number | null;
  port: number;
  exit: { code: number | null; signal: string | null } | null;
  stopMs: number | null;
  forcedKill: boolean;
  homeOverride: boolean;
  symlinksChanged: string[];
  error?: string;
  logs: { stdout: string; stderr: string };
}

/** `--web --port P` on an isolated home until /api/ping says pong, then SIGTERM. */
async function smokeV1(s: StepRun, label: string, bin: string, opts: { sandboxHome: boolean }): Promise<V1Smoke> {
  const root = path.join(s.scratch, `v1-${label}`);
  rmrf(root);
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'config.yaml'), `${[...SMOKE_CONFIG, 'projects: []'].join('\n')}\n`);
  const extra: Record<string, string> = { IVY_TLS: '0' };
  if (opts.sandboxHome) {
    const fakeHome = path.join(root, 'user-home');
    fs.mkdirSync(fakeHome, { recursive: true });
    extra.HOME = fakeHome;
  }
  const env = appEnv(home, s.paths, extra);
  const port = await freePort();
  const before = snapshotCliLinks();
  const res: V1Smoke = {
    ok: false,
    httpReadyMs: null,
    dataReadyMs: null,
    ping: null,
    masterScheme: null,
    masterPort: null,
    port,
    exit: null,
    stopMs: null,
    forcedKill: false,
    homeOverride: opts.sandboxHome,
    symlinksChanged: [],
    logs: { stdout: '', stderr: '' },
  };
  let proc: Spawned | null = null;
  try {
    proc = spawnLogged({ cmd: bin, args: ['--web', '--port', String(port)], cwd: root, env, logDir: s.logDir, logPrefix: `v1-select-${label}`, log: s.log });
    res.logs = { stdout: proc.stdoutPath, stderr: proc.stderrPath };
    const p = proc;
    const r = await waitForHttpDetailed(`http://127.0.0.1:${port}/api/ping`, {
      timeoutMs: 180_000,
      bail: () => (p.exitInfo ? `exited with ${p.exitInfo.code ?? p.exitInfo.signal}` : null),
    });
    res.httpReadyMs = Math.round(r.t - p.spawnAt);
    res.ping = r.body.trim().slice(0, 40);
    const sync = await p.onLine(/Initial sync complete/, { timeoutMs: 60_000 }).catch(() => null);
    if (sync) res.dataReadyMs = Math.round(sync.t - p.spawnAt);
    const master = readJson<{ scheme?: string; port?: number }>(path.join(home, '.master'));
    res.masterScheme = master?.scheme ?? null;
    res.masterPort = master?.port ?? null;
    res.ok = /pong/i.test(res.ping) && res.masterScheme !== 'https';
    if (!res.ok) res.error = `unexpected ping body ${JSON.stringify(res.ping)} or scheme ${res.masterScheme}`;
  } catch (e) {
    res.error = errorMessage(e);
  } finally {
    if (proc) {
      const k = await proc.stop({ signal: 'SIGTERM' });
      res.stopMs = Math.round(k.ms);
      res.forcedKill = k.forced;
      const x = proc.exitInfo as { code: number | null; signal: string | null } | null;
      res.exit = x ? { code: x.code, signal: x.signal } : null;
      if (k.survivors.length) res.error = `${res.error ? `${res.error}; ` : ''}survivors after stop: ${k.survivors.join(', ')}`;
    }
    res.symlinksChanged = restoreCliLinks(before, s.log);
    if (res.symlinksChanged.length) {
      res.ok = false;
      res.error = `${res.error ? `${res.error}; ` : ''}the run changed the user's tendril symlink(s): ${res.symlinksChanged.join('; ')}`;
    }
  }
  return res;
}

async function stepV1Select(s: StepRun): Promise<Info> {
  const { paths } = s;
  const pkgStamp = readStamp(paths, 'v1-pkg');
  const pkgBin = (pkgStamp?.info.appBin as string | undefined) ?? null;
  const pkgSha = (pkgStamp?.info.appBinSha256 as string | undefined) ?? null;
  const installedBin = path.join(INSTALLED_V1_APP, 'Contents', 'MacOS', 'Ivy.Tendril');
  const home = os.homedir();

  type Cand = { source: 'pkg-app' | 'installed-app' | 'publish'; bin: string; app: string | null };
  const cands: Cand[] = [];
  if (pkgBin && exists(pkgBin)) cands.push({ source: 'pkg-app', bin: pkgBin, app: pkgBin.replace(/\/Contents\/MacOS\/Ivy\.Tendril$/, '') });
  if (exists(installedBin)) cands.push({ source: 'installed-app', bin: installedBin, app: INSTALLED_V1_APP });
  if (exists(paths.v1PublishBin)) cands.push({ source: 'publish', bin: paths.v1PublishBin, app: null });

  const report: Record<string, Info> = {};
  for (const c of cands) {
    const bi = await v1BinaryInfo(c.bin);
    const sha = await sha256File(c.bin);
    const effect = cliSymlinkEffect(c.bin, home);
    const r: Info = {
      bin: c.bin,
      app: c.app,
      bytes: bi.bytes,
      sha256: sha,
      version: bi.version,
      frameworks: bi.frameworks,
      appBundleVersion: bi.appBundleVersion,
      identicalToReleasePkg: pkgSha ? sha === pkgSha : null,
      cliSymlinkEffect: effect,
    };
    let smoke: V1Smoke | null = null;
    if (c.source === 'pkg-app') {
      // Proves the release payload runs. HOME points at a sandbox so EnsureCliSymlink lands there
      // instead of re-pointing the user's ~/.local/bin/tendril.
      smoke = await smokeV1(s, c.source, c.bin, { sandboxHome: true });
    } else if (effect.effect !== 'would-modify') {
      smoke = await smokeV1(s, c.source, c.bin, { sandboxHome: false });
    } else {
      r.skippedSmoke = `not run: ${effect.detail}`;
    }
    r.smoke = smoke;
    report[c.source] = r;
    s.log.info(`V1 candidate ${c.source}: ${c.bin} version ${bi.version} sha ${sha.slice(0, 12)} symlink ${effect.effect}${smoke ? `, smoke ${smoke.ok ? `ok (ping ${smoke.httpReadyMs} ms)` : `FAILED: ${smoke.error}`}` : ''}`);
  }

  // Server runs happen with the real HOME, so a candidate is usable only if running it cannot touch
  // the user's `tendril` symlink. The release payload normally is not (it would re-point it), but the
  // installed /Applications copy is the same bytes and already the symlink's target.
  const usable = (src: Cand['source'], needRelease: boolean): Info | null => {
    const r = report[src];
    if (!r) return null;
    const smoke = r.smoke as V1Smoke | null;
    const effect = r.cliSymlinkEffect as SymlinkEffect;
    if (effect.effect === 'would-modify') return null;
    if (r.version !== '1.2.4') return null;
    if (needRelease && r.identicalToReleasePkg !== true && src !== 'pkg-app') return null;
    if (!smoke?.ok) return null;
    return r;
  };
  let server: Info | null = null;
  let serverSource: string | null = null;
  let serverReason = '';
  for (const src of ['pkg-app', 'installed-app'] as const) {
    const r = usable(src, true);
    if (r) {
      server = r;
      serverSource = src;
      serverReason =
        src === 'pkg-app'
          ? 'the expanded release pkg binary runs and cannot change the user tendril symlink'
          : 'byte-identical to the v1.2.4 release pkg payload, runs, and is already the target of the user tendril symlink (running the expanded pkg copy would re-point it)';
      break;
    }
  }
  if (!server) {
    const r = usable('publish', false);
    if (r) {
      server = r;
      serverSource = 'publish';
      const why = Object.entries(report)
        .filter(([k]) => k !== 'publish')
        .map(([k, v]) => `${k}: ${(v.cliSymlinkEffect as SymlinkEffect).effect === 'would-modify' ? (v.cliSymlinkEffect as SymlinkEffect).detail : ((v.smoke as V1Smoke | null)?.error ?? (v.identicalToReleasePkg === false ? 'differs from the release pkg' : 'not usable'))}`)
        .join('; ');
      serverReason = `no release binary is usable (${why || 'none present'}); falling back to the self-built publish`;
    }
  }
  if (!server) throw new Error(`no V1 binary is usable for server runs: ${JSON.stringify(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, (v.smoke as V1Smoke | null)?.error ?? (v.cliSymlinkEffect as SymlinkEffect).detail])))}`);

  // Desktop runs go through `open -a <app>`, so they need a .app and the same symlink safety.
  let desktop: Info | null = null;
  let desktopReason = '';
  for (const src of ['pkg-app', 'installed-app'] as const) {
    const r = report[src];
    if (!r) continue;
    const effect = r.cliSymlinkEffect as SymlinkEffect;
    if (effect.effect === 'would-modify') continue;
    if (src === 'installed-app' && r.identicalToReleasePkg !== true) continue;
    desktop = { app: r.app, bin: r.bin, sha256: r.sha256, source: src };
    desktopReason = src === 'pkg-app' ? 'the release pkg app cannot change the user tendril symlink' : 'the installed app is byte-identical to the release pkg payload and already the user tendril symlink target';
    break;
  }
  if (!desktop) desktopReason = 'no v1.2.4 release .app can be opened without re-pointing the user tendril symlink; desktop runs of V1 are not possible';

  return {
    candidates: report,
    server: { bin: server.bin, app: server.app ?? null, source: serverSource, sha256: server.sha256, version: server.version, frameworks: server.frameworks, reason: serverReason },
    desktop: desktop ? { ...desktop, reason: desktopReason } : { app: null, reason: desktopReason },
    cliLinks: snapshotCliLinks(),
  };
}

// --- V2 --------------------------------------------------------------------------------------

function v2AppDir(paths: WorkspacePaths): string {
  return path.join(paths.v2Clone, 'src', 'apps', 'tendril-app');
}
function v2BinariesDir(paths: WorkspacePaths): string {
  return path.join(v2AppDir(paths), 'src-tauri', 'binaries');
}
function wireframeDir(paths: WorkspacePaths): string {
  return path.join(paths.v2Clone, 'src', 'crates', 'tendril-wireframe');
}
const WIREFRAME_REQUIRED = ['vendor.manifest.json', 'tendril.manifest.json', 'ARTIFACTS.lock.json', 'css/tendril.css'];

async function hostTriple(paths: WorkspacePaths): Promise<string> {
  const vv = await tryOut('rustc', ['-vV'], { cwd: paths.v2Clone });
  const t = vv?.match(/^host:\s*(\S+)/m)?.[1];
  if (!t) throw new Error('cannot determine the rustc host triple (is rustup installed?)');
  return t;
}

/** Straight from the package: `pnpm exec` would first run the workspace's prepare scripts. */
async function tauriCliVersion(paths: WorkspacePaths): Promise<string | null> {
  const cli = path.join(v2AppDir(paths), 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  if (!exists(cli)) return null;
  const out = await tryOut(process.execPath, [cli, '--version'], { cwd: v2AppDir(paths) });
  return out?.match(/tauri-cli \S+/)?.[0] ?? out;
}

function opencodeVersion(paths: WorkspacePaths): string | null {
  const script = path.join(v2AppDir(paths), 'scripts', 'release', 'fetch-opencode-sidecar.sh');
  if (!exists(script)) return null;
  return fs.readFileSync(script, 'utf8').match(/OPENCODE_VERSION="\$\{OPENCODE_VERSION:-([^}"]+)\}"/)?.[1] ?? null;
}

/** Dist summary, including whether React is the production build (a NODE_ENV=test build is not). */
async function distInfo(dist: string): Promise<Info> {
  const t = await treeDigest(dist);
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const entry = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1] ?? null;
  let devReact = false;
  for (const f of listFiles(path.join(dist, 'assets'))) {
    if (!f.rel.endsWith('.js')) continue;
    if (fs.readFileSync(f.abs, 'utf8').includes('Download the React DevTools')) {
      devReact = true;
      break;
    }
  }
  return { dir: dist, files: t.files, bytes: t.bytes, digest: t.digest, entry, indexHtmlSha256: sha256Text(html), reactProductionBuild: !devReact };
}

async function stepV2Deps(s: StepRun): Promise<Info> {
  const { paths } = s;
  const pnpm = await tryOut('pnpm', ['--version'], { cwd: paths.v2Clone });
  await s.sh('pnpm', ['install', '--frozen-lockfile'], { cwd: paths.v2Clone, timeoutMs: HOUR });
  return { pnpm, lockSha256: await sha256File(path.join(paths.v2Clone, 'pnpm-lock.yaml')), command: ['pnpm', 'install', '--frozen-lockfile'] };
}

async function stepV2Wireframe(s: StepRun): Promise<Info> {
  const { paths } = s;
  // Exactly CI's step (release-app.yml "Generate wireframe payload"). The repo's
  // ensure-wireframe-payload.mjs only checks presence, so after a re-pin it would keep a stale payload.
  const vendor = path.join(wireframeDir(paths), 'pipeline', 'vendor');
  await s.sh('pnpm', ['install', '--frozen-lockfile'], { cwd: vendor, timeoutMs: HOUR });
  await s.sh('node', ['build-all.mjs'], { cwd: vendor, timeoutMs: HOUR });
  const artifacts = path.join(wireframeDir(paths), 'artifacts');
  const missing = WIREFRAME_REQUIRED.filter((f) => !exists(path.join(artifacts, f)));
  if (missing.length) throw new Error(`wireframe payload incomplete after build: missing ${missing.join(', ')}`);
  const t = await treeDigest(artifacts);
  return { artifacts, files: t.files, bytes: t.bytes, digest: t.digest };
}

async function stepV2Frontend(s: StepRun): Promise<Info> {
  const { paths } = s;
  // From the clone root with --filter only: a `cd` + build nests a second React (see memory note
  // components-build-from-root-only).
  await s.sh('pnpm', ['--filter', '@ivy-interactive/components', 'build'], { cwd: paths.v2Clone, timeoutMs: HOUR });
  await s.sh('pnpm', ['--filter', '@ivy-interactive/tendril-app', 'build'], {
    cwd: paths.v2Clone,
    env: buildEnv({ NODE_ENV: 'production' }),
    envNote: { NODE_ENV: 'production' },
    timeoutMs: HOUR,
  });
  const info = await distInfo(paths.v2Dist);
  if (!info.reactProductionBuild) throw new Error(`${paths.v2Dist} bundles development React (NODE_ENV leaked into the build)`);
  return { ...info, nodeEnv: 'production' };
}

async function stepV2Cli(s: StepRun): Promise<Info> {
  const { paths } = s;
  const rustc = await tryOut('rustc', ['-V'], { cwd: paths.v2Clone });
  const cargo = await tryOut('cargo', ['-V'], { cwd: paths.v2Clone });
  await s.sh('cargo', ['build', '--release', '--bin', 'tendril'], { cwd: paths.v2Clone, timeoutMs: 3 * HOUR });
  const scratchHome = path.join(s.scratch, 'v2-version-home');
  fs.mkdirSync(scratchHome, { recursive: true });
  // clap answers --version before touching the home; the home is isolated regardless.
  const version = await tryOut(paths.v2Bin, ['--home', scratchHome, '--version'], { cwd: scratchHome, env: cleanEnv({ TENDRIL_HOME: scratchHome }) });
  return {
    bin: paths.v2Bin,
    bytes: fs.statSync(paths.v2Bin).size,
    sha256: await sha256File(paths.v2Bin),
    version,
    rustc,
    cargo,
    command: ['cargo', 'build', '--release', '--bin', 'tendril'],
    profile: 'release (Cargo defaults; the workspace defines no [profile.release])',
  };
}

async function stepV2Sidecars(s: StepRun): Promise<Info> {
  const { paths } = s;
  const triple = await hostTriple(paths);
  const binDir = v2BinariesDir(paths);
  fs.mkdirSync(binDir, { recursive: true });
  const tendrilDest = path.join(binDir, `tendril-${triple}`);
  const cliSha = await sha256File(paths.v2Bin);
  if ((await sha256OrNull(tendrilDest)) !== cliSha) {
    const tmp = `${tendrilDest}.tmp-${process.pid}`;
    fs.copyFileSync(paths.v2Bin, tmp);
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, tendrilDest);
  }
  const script = path.join(v2AppDir(paths), 'scripts', 'release', 'fetch-opencode-sidecar.sh');
  await s.sh(script, [triple], {
    cwd: paths.v2Clone,
    env: buildEnv(s.force ? { OPENCODE_FORCE: '1' } : {}),
    envNote: s.force ? { OPENCODE_FORCE: '1' } : undefined,
    timeoutMs: HOUR,
  });
  const opencode = path.join(binDir, `opencode-${triple}`);
  if (!exists(opencode)) throw new Error(`${opencode} missing after fetch-opencode-sidecar.sh`);
  return {
    triple,
    dir: binDir,
    tendril: { path: tendrilDest, bytes: fs.statSync(tendrilDest).size, sha256: await sha256File(tendrilDest), sameAsCli: true },
    opencode: { path: opencode, bytes: fs.statSync(opencode).size, sha256: await sha256File(opencode), version: opencodeVersion(paths) },
  };
}

function findBundles(paths: WorkspacePaths): { apps: string[]; dmgs: string[] } {
  const roots = [path.join(paths.v2Clone, 'target', 'release', 'bundle'), path.join(v2AppDir(paths), 'src-tauri', 'target', 'release', 'bundle')];
  const apps: string[] = [];
  const dmgs: string[] = [];
  for (const r of roots) {
    const macos = path.join(r, 'macos');
    if (exists(macos)) for (const e of fs.readdirSync(macos)) if (e.endsWith('.app')) apps.push(path.join(macos, e));
    const dmg = path.join(r, 'dmg');
    if (exists(dmg)) for (const e of fs.readdirSync(dmg)) if (e.endsWith('.dmg')) dmgs.push(path.join(dmg, e));
  }
  return { apps, dmgs };
}

async function appBundleInfo(app: string, sidecars: Info | null, dist: Info | null): Promise<Info> {
  const plist = path.join(app, 'Contents', 'Info.plist');
  const macos = path.join(app, 'Contents', 'MacOS');
  const files: Info = {};
  for (const f of listFiles(macos)) files[f.rel] = { bytes: f.bytes, sha256: await sha256File(f.abs) };
  const sc = sidecars as { tendril?: { sha256?: string }; opencode?: { sha256?: string } } | null;
  const main = path.join(macos, 'tendril-app');
  // Tauri keys its embedded (brotli) assets by path, so the entry chunk's name appears verbatim in
  // the binary when this app embeds this dist.
  const entryName = typeof dist?.entry === 'string' ? path.basename(dist.entry) : null;
  let embedsDistEntry: boolean | null = null;
  if (entryName && exists(main)) embedsDistEntry = fs.readFileSync(main).includes(Buffer.from(entryName));
  const codesign = await run('/usr/bin/codesign', ['-dv', app], { env: cleanEnv(), timeoutMs: 60_000 })
    .then((r) => r.stderr.trim())
    .catch((e: { stderr?: string }) => String(e.stderr ?? '').trim());
  return {
    app,
    bundleId: await plistValue(plist, 'CFBundleIdentifier'),
    version: await plistValue(plist, 'CFBundleShortVersionString'),
    minimumSystemVersion: await plistValue(plist, 'LSMinimumSystemVersion'),
    totals: dirBytes(app),
    macos: files,
    sidecarTendrilMatches: sc?.tendril?.sha256 ? (files['tendril'] as { sha256?: string } | undefined)?.sha256 === sc.tendril.sha256 : null,
    sidecarOpencodeMatches: sc?.opencode?.sha256 ? (files['opencode'] as { sha256?: string } | undefined)?.sha256 === sc.opencode.sha256 : null,
    embedsDistEntry,
    distEntry: entryName,
    codesign: codesign.split('\n').filter((l) => /^(Identifier|Format|CodeDirectory|Signature|flags)|adhoc|linker-signed|not signed/i.test(l)),
  };
}

async function stepV2App(s: StepRun): Promise<Info> {
  const { paths } = s;
  const sidecars = readStamp(paths, 'v2-sidecars')?.info ?? null;
  const frontend = readStamp(paths, 'v2-frontend')?.info ?? null;
  const tauriVersion = await tauriCliVersion(paths);
  const start = Date.now();
  // CI=true is what GitHub Actions sets for release-app.yml, and it is what makes the bundler pass
  // --skip-jenkins to bundle_dmg.sh: no Finder AppleScript, which hangs or fails without an
  // Automation grant. The DMG then carries no custom window layout, like the CI artifact.
  const envNote = { CI: 'true', NODE_ENV: 'production' };
  const r = await s.sh('pnpm', TAURI_BUILD_ARGS, { cwd: paths.v2Clone, env: buildEnv(envNote), envNote, timeoutMs: 4 * HOUR, allowFail: true });
  const found = findBundles(paths);
  // Info.plist is generated on every bundle run, unlike the binaries, which the bundler may clone
  // with their old mtimes when cargo had nothing to rebuild.
  const freshApp = found.apps.find((a) => {
    const plist = path.join(a, 'Contents', 'Info.plist');
    return exists(path.join(a, 'Contents', 'MacOS', 'tendril-app')) && exists(plist) && fs.statSync(plist).mtimeMs >= start - 1000;
  });
  const freshDmg = found.dmgs.find((d) => fs.statSync(d).mtimeMs >= start - 1000) ?? null;
  if (!freshApp) throw new CommandFailed(`tauri build produced no new .app (exit ${r.exit}); see ${s.logFile}\n${r.tail}`, r.tail);
  let dmgError: string | null = null;
  if (r.exit !== 0) {
    dmgError = `tauri build exited ${r.exit} after producing the .app${freshDmg ? '' : ' and no .dmg'}: ${r.tail.split('\n').slice(-8).join(' | ')}`;
    s.note(dmgError);
  }

  fs.mkdirSync(paths.artifactsV2, { recursive: true });
  const appDest = path.join(paths.artifactsV2, path.basename(freshApp));
  const staged = `${appDest}.tmp-${process.pid}`;
  rmrf(staged);
  // ditto keeps the bundle exactly as built (signatures, xattrs, symlinks).
  await s.sh('/usr/bin/ditto', [freshApp, staged], { cwd: paths.artifactsV2, env: cleanEnv(), timeoutMs: HOUR });
  swapInto(staged, appDest);

  let dmg: Info | null = null;
  if (freshDmg) {
    const dest = path.join(paths.artifactsV2, path.basename(freshDmg));
    fs.copyFileSync(freshDmg, `${dest}.tmp-${process.pid}`);
    fs.renameSync(`${dest}.tmp-${process.pid}`, dest);
    const format = firstLine((await tryOut('/usr/bin/hdiutil', ['imageinfo', dest]))?.split('\n').find((l) => /^Format:/.test(l)))?.replace(/^Format:\s*/, '') ?? null;
    dmg = { kind: 'tauri', path: dest, buildPath: freshDmg, bytes: fs.statSync(dest).size, sha256: await sha256File(dest), format };
  } else {
    // Not what ships: a plain UDZO image of the same .app, so the size suite has a number, clearly
    // labelled. The failure above is recorded next to it.
    const version = (await plistValue(path.join(appDest, 'Contents', 'Info.plist'), 'CFBundleShortVersionString')) ?? '0.0.0';
    const dest = path.join(paths.artifactsV2, `Tendril_${version}_aarch64.hdiutil-fallback.dmg`);
    rmrf(dest);
    const h = await s.sh('/usr/bin/hdiutil', ['create', '-volname', 'Tendril', '-srcfolder', appDest, '-ov', '-format', 'UDZO', dest], { cwd: paths.artifactsV2, env: cleanEnv(), timeoutMs: HOUR, allowFail: true });
    if (h.exit === 0 && exists(dest)) dmg = { kind: 'hdiutil-fallback', path: dest, bytes: fs.statSync(dest).size, sha256: await sha256File(dest), note: 'not the Tauri DMG: hdiutil create -format UDZO of the same .app' };
  }

  const distAfter = await distInfo(paths.v2Dist);
  // tauri's beforeBuildCommand (`pnpm build`) rebuilt the dist; the app embeds that one.
  const distChanged = frontend ? frontend.digest !== distAfter.digest : null;
  if (distChanged) s.note(`tauri's beforeBuildCommand produced a different dist than the v2-frontend step (digest ${String(frontend?.digest).slice(0, 12)} -> ${String(distAfter.digest).slice(0, 12)}); the app and the shim use the new one`);
  if (!distAfter.reactProductionBuild) throw new Error('the dist tauri embedded bundles development React');
  const appInfo = await appBundleInfo(appDest, sidecars, distAfter);
  if (appInfo.sidecarTendrilMatches === false) throw new Error(`${appDest} does not contain the staged tendril sidecar`);
  return {
    ...appInfo,
    buildPath: freshApp,
    tauriCli: tauriVersion,
    command: ['pnpm', ...TAURI_BUILD_ARGS],
    env: envNote,
    exit: r.exit,
    dmg,
    dmgError,
    dist: distAfter,
    distRebuiltDifferently: distChanged,
  };
}

async function shimSourceDigest(): Promise<{ digest: string; files: string[] }> {
  const dir = path.join(BENCH_ROOT, 'v2-shim');
  const files = ['Cargo.toml', 'build.rs', ...listFiles(path.join(dir, 'src')).map((f) => `src/${f.rel}`)].sort();
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(`${f}\0${await sha256File(path.join(dir, f))}\n`);
  return { digest: h.digest('hex'), files };
}

async function stepV2Shim(s: StepRun): Promise<Info> {
  const { paths } = s;
  const src = path.join(BENCH_ROOT, 'v2-shim');
  const dest = paths.v2ShimDir;
  const srcTauri = path.join(v2AppDir(paths), 'src-tauri');
  fs.mkdirSync(dest, { recursive: true });
  // Refresh the sources but keep target/ (incremental builds).
  rmrf(path.join(dest, 'src'));
  fs.cpSync(path.join(src, 'src'), path.join(dest, 'src'), { recursive: true });
  fs.copyFileSync(path.join(src, 'build.rs'), path.join(dest, 'build.rs'));
  fs.copyFileSync(path.join(src, 'init.js'), path.join(dest, 'init.js'));
  const manifest = fs.readFileSync(path.join(src, 'Cargo.toml'), 'utf8');
  const rewritten = manifest.replace(/^(tendril-app\s*=\s*\{\s*path\s*=\s*)"[^"]*"/m, `$1${JSON.stringify(srcTauri)}`);
  if (rewritten === manifest) throw new Error('could not find the tendril-app path dependency in v2-shim/Cargo.toml');
  fs.writeFileSync(path.join(dest, 'Cargo.toml'), rewritten);
  // The app's toolchain pin, so the shim and the app compile with the same rustc.
  fs.copyFileSync(path.join(paths.v2Clone, 'rust-toolchain.toml'), path.join(dest, 'rust-toolchain.toml'));
  // Seed the lockfile from the app's so every shared dependency resolves to the version the app
  // ships; cargo only adds what the shim alone needs.
  const cloneLock = path.join(paths.v2Clone, 'Cargo.lock');
  fs.copyFileSync(cloneLock, path.join(dest, 'Cargo.lock'));
  const rustc = await tryOut('rustc', ['-V'], { cwd: dest });
  await s.sh('cargo', ['build', '--release'], { cwd: dest, timeoutMs: 3 * HOUR });
  if (!exists(paths.v2ShimBin)) throw new Error(`cargo build succeeded but ${paths.v2ShimBin} is missing`);

  const shimLock = lockVersions(path.join(dest, 'Cargo.lock'));
  const appLock = lockVersions(cloneLock);
  const mismatches: string[] = [];
  const added: string[] = [];
  for (const [name, versions] of shimLock) {
    const theirs = appLock.get(name);
    if (!theirs) {
      added.push(`${name} ${[...versions].join(',')}`);
      continue;
    }
    for (const v of versions) if (!theirs.has(v)) mismatches.push(`${name} ${v} (app: ${[...theirs].join(',')})`);
  }
  if (mismatches.length) s.note(`the shim resolved ${mismatches.length} crate(s) to versions the app does not use: ${mismatches.slice(0, 8).join('; ')}`);
  const described = await tryOut(paths.v2ShimBin, ['--describe'], { env: cleanEnv() });
  let describe: { registered?: string[]; stubbed?: string[]; tendrilAppDir?: string } = {};
  try {
    describe = JSON.parse(described ?? '{}') as typeof describe;
  } catch {
    s.note(`v2shim --describe printed unparseable output: ${described?.slice(0, 200)}`);
  }
  const initJs = path.join(src, 'init.js');
  return {
    dir: dest,
    bin: paths.v2ShimBin,
    bytes: fs.statSync(paths.v2ShimBin).size,
    sha256: await sha256File(paths.v2ShimBin),
    source: (await shimSourceDigest()).digest,
    initScript: initJs,
    initScriptSha256: await sha256File(initJs),
    linkedAgainst: describe.tendrilAppDir ?? srcTauri,
    registeredCommands: describe.registered?.length ?? null,
    stubbedCommands: describe.stubbed ?? null,
    lockMismatches: mismatches,
    lockAdded: added,
    rustc,
    command: ['cargo', 'build', '--release'],
    usage: `${paths.v2ShimBin} <dist> <port> --home <tendril-home>   (ready line on stdout: "shim listening on http://127.0.0.1:<port>")`,
  };
}

async function stepProcstat(s: StepRun): Promise<Info> {
  const bin = s.paths.procstatBin;
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  const tmp = `${bin}.tmp-${process.pid}`;
  const args = ['-O2', '-Wall', '-o', tmp, PROCSTAT_SOURCE, '-framework', 'CoreGraphics', '-framework', 'CoreFoundation'];
  try {
    await s.sh('cc', args, { cwd: BENCH_ROOT, env: cleanEnv(), timeoutMs: 10 * 60_000 });
    fs.renameSync(tmp, bin);
  } finally {
    rmrf(tmp);
  }
  const ps = await ProcStat.open({ bin, log: s.log });
  let footprint = 0;
  try {
    footprint = (await ps.sample([process.pid])).procs[0]?.phys_footprint ?? 0;
  } finally {
    await ps.close();
  }
  if (!footprint) throw new Error(`${bin} could not sample this process`);
  return {
    bin,
    bytes: fs.statSync(bin).size,
    source: PROCSTAT_SOURCE,
    sourceSha256: await sha256File(PROCSTAT_SOURCE),
    cc: firstLine(await tryOut('cc', ['--version'])),
    command: ['cc', ...args.map((a) => (a === tmp ? bin : a))],
  };
}

// --- smoke (opt-in) --------------------------------------------------------------------------

function writeSmokeV2Home(home: string): void {
  fs.mkdirSync(path.join(home, 'Plans'), { recursive: true });
  const repo = path.join(home, 'repos', 'Smoke');
  fs.mkdirSync(repo, { recursive: true });
  const cfg = [
    ...SMOKE_CONFIG,
    'onboarding:',
    '  completed: true',
    'projects:',
    '  - name: Smoke',
    '    color: Blue',
    '    repos:',
    `      - path: ${JSON.stringify(repo)}`,
    '        baseBranch: main',
  ];
  fs.writeFileSync(path.join(home, 'config.yaml'), `${cfg.join('\n')}\n`);
  const plans: Array<[number, string, string]> = [
    [1, 'Draft', 'Smoke Draft One'],
    [2, 'Draft', 'Smoke Draft Two'],
    [3, 'Review', 'Smoke Review'],
    [4, 'Completed', 'Smoke Completed'],
  ];
  for (const [n, state, title] of plans) {
    const dir = path.join(home, 'Plans', `${String(n).padStart(5, '0')}-${title.replace(/\s+/g, '')}`);
    fs.mkdirSync(path.join(dir, 'Revisions'), { recursive: true });
    const created = new Date(Date.UTC(2026, 0, 1, 0, n * 10)).toISOString();
    fs.writeFileSync(
      path.join(dir, 'plan.yaml'),
      [
        'schemaVersion: 3',
        `state: ${state}`,
        'project: Smoke',
        'level: Feature',
        `title: ${JSON.stringify(title)}`,
        'repos:',
        `- ${JSON.stringify(repo)}`,
        `created: ${created}`,
        `updated: ${created}`,
        'prs: []',
        'commits: []',
        'verifications: []',
        'relatedPlans: []',
        'dependsOn: []',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(dir, 'Revisions', '001.md'), `# ${title}\n\n## Problem\n\nSmoke test plan.\n`);
  }
  fs.writeFileSync(path.join(home, 'Plans', '.counter'), '5');
}

async function gitInitRepo(dir: string): Promise<void> {
  const env = cleanEnv({ GIT_AUTHOR_NAME: 'bench', GIT_AUTHOR_EMAIL: 'bench@example.invalid', GIT_COMMITTER_NAME: 'bench', GIT_COMMITTER_EMAIL: 'bench@example.invalid' });
  await run('git', ['init', '-q', '-b', 'main', dir], { env });
  fs.writeFileSync(path.join(dir, 'README.md'), 'bench\n');
  await run('git', ['-C', dir, 'add', '.'], { env });
  await run('git', ['-C', dir, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init'], { env });
}

async function processEnvHas(pid: number, entry: string): Promise<boolean> {
  const out = await tryOut('/bin/ps', ['-E', '-ww', '-o', 'command=', '-p', String(pid)], { env: cleanEnv(), timeoutMs: 10_000 });
  return !!out && out.split(/\s+/).includes(entry);
}

async function lsofConnections(pid: number, port: number): Promise<number> {
  const out = await tryOut('/usr/sbin/lsof', ['-a', '-nP', '-p', String(pid), '-iTCP', '-sTCP:ESTABLISHED'], { env: cleanEnv(), timeoutMs: 30_000 });
  if (!out) return 0;
  return out.split('\n').filter((l) => l.includes(`->127.0.0.1:${port} `) || l.endsWith(`->127.0.0.1:${port} (ESTABLISHED)`)).length;
}

function launchAgentState(): { exists: boolean; mtimeMs: number | null } {
  try {
    return { exists: true, mtimeMs: fs.statSync(V2_LAUNCH_AGENT).mtimeMs };
  } catch {
    return { exists: false, mtimeMs: null };
  }
}

type PwPage = import('playwright').Page;

async function smokeUi(s: StepRun, shimUrl: string, apiBase: string, secret: string): Promise<Info> {
  const { chromium } = (await import('playwright')) as typeof import('playwright');
  const browser = await chromium.launch({ headless: true });
  const unregister = registerCleanup(() => browser.close().catch(() => {}));
  const res: Info = { chromium: browser.version() };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript({ content: fs.readFileSync(path.join(BENCH_ROOT, 'v2-shim', 'init.js'), 'utf8') });
    const page: PwPage = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`);
    });
    const t0 = performance.now();
    await page.goto(`${shimUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('.tsh-root').first().waitFor({ state: 'visible', timeout: 60_000 });
    res.shellVisibleMs = Math.round(performance.now() - t0);
    const content = page.locator('[data-testid=plan-detail-view] .pws-root .pws-title, [data-testid=plans-empty]').first();
    await content.waitFor({ state: 'visible', timeout: 60_000 });
    res.contentReadyMs = Math.round(performance.now() - t0);
    res.contentText = ((await content.textContent()) ?? '').trim().slice(0, 120);
    res.url = page.url();

    const t1 = performance.now();
    await page.click('button.tsh-nav-item[data-menu-item="dashboard"]');
    await page.locator('.tdb-kpis').first().waitFor({ state: 'visible', timeout: 60_000 });
    res.dashboardMs = Math.round(performance.now() - t1);
    await page.click('button.tsh-nav-item[data-menu-item="plans"]');
    await page.locator('button.tsh-nav-item[data-menu-item="plans"]').waitFor({ state: 'visible' });

    // Push through the shim: a REST write on the daemon must reach the page via the app's bridges.
    const badge = 'button.tsh-nav-item[data-menu-item="plans"]';
    await page.waitForTimeout(1500);
    const before = await page.locator(badge).innerText();
    await page.evaluate((sel) => {
      const w = window as unknown as { __PUSH_AT__: number | null };
      w.__PUSH_AT__ = null;
      const start = document.querySelector(sel)?.textContent ?? '';
      const mo = new MutationObserver(() => {
        if ((document.querySelector(sel)?.textContent ?? '') !== start && w.__PUSH_AT__ === null) {
          w.__PUSH_AT__ = performance.timeOrigin + performance.now();
          mo.disconnect();
        }
      });
      mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    }, badge);
    const putAt = Date.now();
    const put = await fetch(`${apiBase}/api/plans/00001`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ field: 'state', value: 'Icebox' }),
    });
    res.pushPutStatus = put.status;
    try {
      await page.waitForFunction(() => (window as unknown as { __PUSH_AT__: number | null }).__PUSH_AT__ !== null, null, { timeout: 30_000 });
      const at = await page.evaluate(() => (window as unknown as { __PUSH_AT__: number }).__PUSH_AT__);
      res.pushMs = Math.round(at - putAt);
      res.pushBadge = { before: before.replace(/\s+/g, ' '), after: (await page.locator(badge).innerText()).replace(/\s+/g, ' ') };
    } catch {
      res.pushMs = null;
      res.pushError = `the plans nav badge (${before.replace(/\s+/g, ' ')}) did not change within 30 s of the PUT`;
    }

    const ipc = (await page.evaluate(() => (window as unknown as { __SHIM_IPC__: Array<{ cmd: string; ok: boolean; transport: string; error?: string }> }).__SHIM_IPC__)) ?? [];
    const failed = new Map<string, number>();
    for (const x of ipc) if (!x.ok) failed.set(`${x.cmd}: ${x.error ?? ''}`.slice(0, 200), (failed.get(`${x.cmd}: ${x.error ?? ''}`.slice(0, 200)) ?? 0) + 1);
    res.ipcCalls = ipc.length;
    res.ipcTransports = [...new Set(ipc.map((x) => x.transport))];
    res.ipcFailures = Object.fromEntries(failed);
    res.pageErrors = errors.slice(0, 20);
    const shot = path.join(s.logDir, 'smoke-v2-ui.png');
    await page.screenshot({ path: shot });
    res.screenshot = shot;
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    unregister();
  }
  return res;
}

async function smokeDesktop(s: StepRun, ps: ProcStat, app: string, home: string, daemonPort: number, daemonPid: number): Promise<Info> {
  const exe = path.join(app, 'Contents', 'MacOS', 'tendril-app');
  const res: Info = { app };
  const agentBefore = launchAgentState();
  const before = new Set((await ps.listAll()).map((p) => p.pid));
  // LaunchServices opens these for the app; like the home they must be outside ~/Desktop.
  const out = path.join(path.dirname(home), 'app.stdout.log');
  const err = path.join(path.dirname(home), 'app.stderr.log');
  const args = [
    '-n',
    '-F',
    app,
    '--env',
    `TENDRIL_HOME=${home}`,
    '--env',
    'TENDRIL_SKIP_SERVICE_PROVISION=1',
    '--env',
    'TENDRIL_SKIP_SERVICE_AUTOSTART=1',
    '--env',
    `CLAUDE_CONFIG_DIR=${s.paths.emptyClaudeConfig}`,
    '--stdout',
    out,
    '--stderr',
    err,
  ];
  if (!args.some((a) => a === `TENDRIL_HOME=${home}`)) throw new Error('refusing to open the app without an isolated TENDRIL_HOME');
  // A fresh start, as the desktop suite does it: the shim session above saved UI state here.
  rmrf(path.join(home, 'ui_state.json'));
  const t0 = performance.now();
  await run('/usr/bin/open', args, { env: cleanEnv(), timeoutMs: 60_000 });
  let appPid = 0;
  const unregister = registerCleanup(() => {
    if (appPid && isAlive(appPid)) process.kill(appPid, 'SIGKILL');
  });
  try {
    const found = await waitFor(
      async () => {
        const cand = (await ps.listAll()).filter((p) => !before.has(p.pid) && p.name.startsWith('tendril-app'));
        if (!cand.length) return null;
        const pathsByPid = await ps.paths(cand.map((c) => c.pid));
        // Other sessions may open the same bundle at the same moment; ours is the one with our home.
        for (const c of cand) if (pathsByPid.get(c.pid) === exe && (await processEnvHas(c.pid, `TENDRIL_HOME=${home}`))) return c.pid;
        return null;
      },
      { timeoutMs: 60_000, intervalMs: 50, description: 'tendril-app process' },
    );
    appPid = found.value;
    res.pid = appPid;
    res.processMs = Math.round(found.t - t0);
    const win = await waitFor(async () => (await ps.windows([appPid])).find((w) => w.onscreen && w.w > 100 && w.h > 100) ?? null, {
      timeoutMs: 60_000,
      intervalMs: 100,
      description: 'on-screen window',
    }).catch(async (e: unknown) => {
      // Keep going: whether the app reached the daemon is worth knowing either way, and a stack
      // sample says where a window-less app is stuck.
      res.windowError = errorMessage(e);
      res.windowsAll = await ps.windows([appPid], { all: true }).catch(() => []);
      const sample = path.join(s.logDir, 'smoke-v2-app.sample.txt');
      await run('/usr/bin/sample', [String(appPid), '1', '-file', sample], { env: cleanEnv(), timeoutMs: 60_000 }).catch(() => null);
      res.sample = exists(sample) ? sample : null;
      return null;
    });
    if (win) {
      res.windowMs = Math.round(win.t - t0);
      res.window = { w: win.value.w, h: win.value.h };
    }
    // Adoption: the app's WS bridge, change stream and IPC clients all connect to the daemon we
    // started; nothing else may serve this home.
    const conns = await waitFor(async () => (await lsofConnections(appPid, daemonPort)) || null, { timeoutMs: 30_000, intervalMs: 250, description: `connections to the daemon on port ${daemonPort}` }).catch(() => null);
    res.connectionsToDaemon = conns?.value ?? 0;
    await sleep(3000);
    const table = await ps.listAll();
    const children = table.filter((p) => p.ppid === appPid);
    res.children = children.map((c) => `${c.name}[${c.pid}]`);
    const spawnedDaemons = table.filter((p) => p.name === 'tendril' && p.pid !== daemonPid && !before.has(p.pid) && p.ppid === appPid);
    res.spawnedDaemons = spawnedDaemons.map((p) => p.pid);
    const webkit = table.filter((p) => p.name.startsWith('com.apple.WebKit'));
    const resp = await ps.responsible(webkit.map((p) => p.pid));
    res.webkitProcesses = webkit.filter((p) => resp.get(p.pid) === appPid).map((p) => `${p.name}[${p.pid}]`);
    res.homeBinCreated = exists(path.join(home, 'bin'));
    const agentAfter = launchAgentState();
    res.launchAgentChanged = agentAfter.exists !== agentBefore.exists || agentAfter.mtimeMs !== agentBefore.mtimeMs;
    const master = readJson<{ pid?: number }>(path.join(home, '.master'));
    res.masterPidIsOurDaemon = master?.pid === daemonPid;
    res.adopted =
      (res.connectionsToDaemon as number) > 0 && spawnedDaemons.length === 0 && !res.homeBinCreated && !res.launchAgentChanged && res.masterPidIsOurDaemon === true;
    res.ok = res.adopted === true && !!win;
  } finally {
    if (appPid && isAlive(appPid)) {
      const ours = async () => {
        const t = (await ps.listAll()).filter((p) => p.name.startsWith('com.apple.WebKit'));
        const r = await ps.responsible(t.map((p) => p.pid));
        return t.filter((p) => r.get(p.pid) === appPid).map((p) => p.pid);
      };
      const webkitPids = await ours().catch(() => [] as number[]);
      const q0 = performance.now();
      process.kill(appPid, 'SIGTERM');
      await waitFor(() => !isAlive(appPid), { timeoutMs: 10_000, intervalMs: 50 }).catch(() => {
        s.note(`tendril-app ${appPid} ignored SIGTERM for 10 s; sending SIGKILL`);
        process.kill(appPid, 'SIGKILL');
      });
      res.quitMs = Math.round(performance.now() - q0);
      // The WebKit services were launched for this app only; they normally exit with it.
      await waitFor(() => webkitPids.every((p) => !isAlive(p)), { timeoutMs: 15_000, intervalMs: 100 }).catch(() => {
        for (const p of webkitPids) if (isAlive(p)) process.kill(p, 'SIGKILL');
        s.note(`killed WebKit processes that outlived tendril-app: ${webkitPids.filter(isAlive).join(', ')}`);
      });
    }
    unregister();
  }
  const logs = { stdout: path.join(s.logDir, 'smoke-v2-app.stdout.log'), stderr: path.join(s.logDir, 'smoke-v2-app.stderr.log') };
  for (const [from, to] of [
    [out, logs.stdout],
    [err, logs.stderr],
  ] as const) {
    if (exists(from)) fs.copyFileSync(from, to);
  }
  res.logs = logs;
  return res;
}

async function stepSmoke(s: StepRun): Promise<Info> {
  const { paths } = s;
  const appStamp = readStamp(paths, 'v2-app');
  const app = (appStamp?.info.app as string | undefined) ?? null;
  rmrf(path.join(s.scratch, 'smoke-v2'));
  // Not under the workspace: it lives in ~/Desktop, a TCC-protected folder. A process started from
  // the terminal inherits the terminal's grant, but an app launched through LaunchServices is its
  // own responsible process, so its first open() of <home>/.master blocks on a "would like to access
  // files in your Desktop folder" prompt (observed: the main thread parked in daemon::read_master).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tendril-bench-smoke-'));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'cwd');
  fs.mkdirSync(cwd, { recursive: true });
  writeSmokeV2Home(home);
  await gitInitRepo(path.join(home, 'repos', 'Smoke'));
  const res: Info = { home };
  const ps = await ProcStat.open({ bin: paths.procstatBin, log: s.log });
  let daemon: Spawned | null = null;
  let shim: Spawned | null = null;
  try {
    const port = await freePort();
    daemon = spawnLogged({ cmd: paths.v2Bin, args: ['--home', home, 'serve', '--host', '127.0.0.1', '--port', String(port)], cwd, env: appEnv(home, paths), logDir: s.logDir, logPrefix: 'smoke-v2-daemon', log: s.log });
    const d = daemon;
    const health = await waitForHttpDetailed(`http://127.0.0.1:${port}/api/health`, { timeoutMs: 120_000, bail: () => (d.exitInfo ? `daemon exited with ${d.exitInfo.code ?? d.exitInfo.signal}` : null) });
    res.daemon = { pid: daemon.pid, port, healthMs: Math.round(health.t - daemon.spawnAt) };
    const secret = readJson<{ secret?: string }>(path.join(home, '.master'))?.secret ?? '';
    if (!secret) throw new Error('daemon .master has no secret');

    rmrf(path.join(home, 'ui_state.json'));
    const shimPort = await freePort();
    shim = spawnLogged({ cmd: paths.v2ShimBin, args: [paths.v2Dist, String(shimPort), '--home', home], cwd, env: appEnv(home, paths), logDir: s.logDir, logPrefix: 'smoke-v2-shim', log: s.log });
    const ready = await shim.onLine(/^shim listening on (http:\/\/\S+)/, { stream: 'stdout', timeoutMs: 60_000 });
    const shimUrl = ready.line.match(/(http:\/\/\S+)/)![1]!;
    const shimHealth = (await (await fetch(`${shimUrl}/__shim/health`)).json()) as Info;
    res.shim = { pid: shim.pid, url: shimUrl, readyMs: Math.round(ready.t - shim.spawnAt), health: shimHealth };
    res.ui = await smokeUi(s, shimUrl, `http://127.0.0.1:${port}`, secret).catch((e: unknown) => ({ error: errorText(e) }));
    await shim.stop();
    shim = null;

    if (app && exists(app)) {
      res.desktop = await smokeDesktop(s, ps, app, home, port, daemon.pid).catch((e: unknown) => ({ error: errorText(e) }));
    } else {
      res.desktop = { skipped: 'no V2 .app recorded by the v2-app step' };
    }
  } finally {
    if (shim) await shim.stop();
    if (daemon) await daemon.stop();
    await ps.close();
    rmrf(root);
  }
  const ui = res.ui as Info | undefined;
  const desktop = res.desktop as Info | undefined;
  const problems: string[] = [];
  if (!ui?.contentReadyMs) problems.push(`the V2 UI did not render through the shim${ui?.error ? `: ${String(ui.error).split('\n')[0]}` : ''}`);
  if (ui?.pushError) problems.push(String(ui.pushError));
  if (desktop && !('skipped' in desktop)) {
    if (desktop.error) problems.push(`V2 desktop app: ${String(desktop.error).split('\n')[0]}`);
    else if (!desktop.window) problems.push(`the V2 desktop app showed no window (${desktop.windowError}); stack sample: ${desktop.sample}`);
    if (!desktop.error && desktop.adopted !== true) problems.push('the V2 desktop app did not adopt the daemon');
  }
  res.ok = problems.length === 0;
  if (problems.length) throw Object.assign(new Error(problems.join('; ')), { info: res });
  return res;
}

// ---------------------------------------------------------------------------------------------
// Step table

const STEPS: StepDef[] = [
  {
    name: 'v1-clone',
    title: `clone Ivy-Tendril and check out ${V1_REF}`,
    section: ['v1', 'clone'],
    deps: [],
    run: (s) => ensureClone(s, { dir: s.paths.v1Clone, repo: V1_REPO, ref: V1_REF, expectSha: V1_SHA }),
  },
  {
    name: 'v2-clone',
    title: 'clone Ivy-Tendril-V2 and check out the pinned commit',
    section: ['v2', 'clone'],
    deps: [],
    run: (s) => ensureClone(s, { dir: s.paths.v2Clone, repo: V2_REPO, ref: s.ctx.v2Ref }),
  },
  {
    name: 'procstat',
    title: 'compile the procstat helper',
    section: ['procstat'],
    deps: [],
    key: async () => ({ source: await sha256File(PROCSTAT_SOURCE), cc: firstLine(await tryOut('cc', ['--version'])) }),
    outputs: (s) => [s.paths.procstatBin],
    run: stepProcstat,
  },
  {
    name: 'v1-publish',
    title: 'dotnet publish V1 (Release, osx-arm64, single file, self-contained)',
    section: ['v1', 'publish'],
    deps: ['v1-clone'],
    key: async (s) => ({ sha: await requireSha(s.paths.v1Clone, 'v1'), args: v1PublishArgs('<out>', '<sha>'), sdk: await tryOut('dotnet', ['--version'], { cwd: s.paths.v1Clone }) }),
    outputs: (s) => [s.paths.v1PublishBin],
    run: stepV1Publish,
  },
  {
    name: 'v1-pkg',
    title: `download and expand the ${V1_REF} osx-arm64 release pkg`,
    section: ['v1', 'releasePkg'],
    deps: [],
    key: async () => ({ tag: V1_REF, asset: V1_PKG_ASSET, repo: V1_RELEASE_REPO }),
    outputs: (s) => [path.join(s.paths.artifactsV1, V1_PKG_ASSET), path.join(s.paths.artifactsV1, 'pkg-expanded')],
    run: stepV1Pkg,
  },
  {
    name: 'v2-deps',
    title: 'pnpm install --frozen-lockfile',
    section: ['v2', 'deps'],
    deps: ['v2-clone'],
    key: async (s) => ({ sha: await requireSha(s.paths.v2Clone, 'v2'), lock: await sha256File(path.join(s.paths.v2Clone, 'pnpm-lock.yaml')), pnpm: await tryOut('pnpm', ['--version'], { cwd: s.paths.v2Clone }) }),
    outputs: (s) => [path.join(s.paths.v2Clone, 'node_modules', '.modules.yaml')],
    run: stepV2Deps,
  },
  {
    name: 'v2-wireframe',
    title: 'generate the tendril-wireframe payload',
    section: ['v2', 'wireframe'],
    deps: ['v2-deps'],
    key: async (s) => ({ sha: await requireSha(s.paths.v2Clone, 'v2'), lock: await sha256OrNull(path.join(wireframeDir(s.paths), 'pipeline', 'vendor', 'pnpm-lock.yaml')) }),
    outputs: (s) => WIREFRAME_REQUIRED.map((f) => path.join(wireframeDir(s.paths), 'artifacts', f)),
    run: stepV2Wireframe,
  },
  {
    name: 'v2-frontend',
    title: 'build components and the app frontend (NODE_ENV=production)',
    section: ['v2', 'frontend'],
    deps: ['v2-deps'],
    key: async (s) => ({ sha: await requireSha(s.paths.v2Clone, 'v2'), lock: await sha256File(path.join(s.paths.v2Clone, 'pnpm-lock.yaml')), nodeEnv: 'production' }),
    outputs: (s) => [path.join(s.paths.v2Dist, 'index.html')],
    run: stepV2Frontend,
  },
  {
    name: 'v2-cli',
    title: 'cargo build --release --bin tendril',
    section: ['v2', 'cli'],
    deps: ['v2-wireframe'],
    key: async (s) => ({
      sha: await requireSha(s.paths.v2Clone, 'v2'),
      lock: await sha256File(path.join(s.paths.v2Clone, 'Cargo.lock')),
      wireframe: readStamp(s.paths, 'v2-wireframe')?.info.digest ?? null,
      rustc: await tryOut('rustc', ['-V'], { cwd: s.paths.v2Clone }),
    }),
    outputs: (s) => [s.paths.v2Bin],
    run: stepV2Cli,
  },
  {
    name: 'v2-sidecars',
    title: 'stage the tendril and opencode sidecars',
    section: ['v2', 'sidecars'],
    deps: ['v2-cli'],
    key: async (s) => ({ tendril: await sha256File(s.paths.v2Bin), opencode: opencodeVersion(s.paths), triple: await hostTriple(s.paths) }),
    outputs: (s) => {
      const st = readStamp(s.paths, 'v2-sidecars')?.info as { tendril?: { path?: string }; opencode?: { path?: string } } | undefined;
      return [st?.tendril?.path ?? path.join(v2BinariesDir(s.paths), '<missing>'), st?.opencode?.path ?? path.join(v2BinariesDir(s.paths), '<missing>')];
    },
    run: stepV2Sidecars,
  },
  {
    name: 'v2-app',
    title: 'tauri build --bundles app,dmg (unsigned) and copy to artifacts/v2',
    section: ['v2', 'app'],
    deps: ['v2-sidecars', 'v2-frontend'],
    key: async (s) => {
      const sc = readStamp(s.paths, 'v2-sidecars')?.info as { tendril?: { sha256?: string }; opencode?: { sha256?: string } } | undefined;
      return {
        sha: await requireSha(s.paths.v2Clone, 'v2'),
        lock: await sha256File(path.join(s.paths.v2Clone, 'Cargo.lock')),
        pnpmLock: await sha256File(path.join(s.paths.v2Clone, 'pnpm-lock.yaml')),
        tendril: sc?.tendril?.sha256 ?? null,
        opencode: sc?.opencode?.sha256 ?? null,
        args: TAURI_BUILD_ARGS,
        rustc: await tryOut('rustc', ['-V'], { cwd: s.paths.v2Clone }),
      };
    },
    outputs: (s) => [path.join(s.paths.artifactsV2, 'Tendril.app', 'Contents', 'MacOS', 'tendril-app')],
    run: stepV2App,
  },
  {
    name: 'v2-shim',
    title: 'build the V2 IPC shim against the clone',
    section: ['v2', 'shim'],
    deps: ['v2-sidecars', 'v2-frontend'],
    key: async (s) => {
      const sc = readStamp(s.paths, 'v2-sidecars')?.info as { tendril?: { sha256?: string }; opencode?: { sha256?: string } } | undefined;
      return {
        source: (await shimSourceDigest()).digest,
        sha: await requireSha(s.paths.v2Clone, 'v2'),
        lock: await sha256File(path.join(s.paths.v2Clone, 'Cargo.lock')),
        // generate_context! embeds ../dist and tauri-build checks the sidecars, so both are inputs.
        dist: (await treeDigest(s.paths.v2Dist)).digest,
        tendril: sc?.tendril?.sha256 ?? null,
        opencode: sc?.opencode?.sha256 ?? null,
        rustc: await tryOut('rustc', ['-V'], { cwd: s.paths.v2Clone }),
      };
    },
    outputs: (s) => [s.paths.v2ShimBin],
    run: stepV2Shim,
  },
  {
    name: 'v1-select',
    title: 'choose (and smoke-test) the V1 binaries for server and desktop runs',
    section: ['v1', 'selection'],
    deps: ['v1-publish', 'v1-pkg'],
    key: async (s) => {
      const bins = [readStamp(s.paths, 'v1-pkg')?.info.appBin as string | undefined, path.join(INSTALLED_V1_APP, 'Contents', 'MacOS', 'Ivy.Tendril'), s.paths.v1PublishBin];
      const shas = [];
      for (const b of bins) shas.push(b && exists(b) ? { b, sha: await sha256File(b) } : null);
      return { shas, links: snapshotCliLinks() };
    },
    outputs: () => [],
    run: stepV1Select,
  },
  {
    name: 'smoke',
    title: 'smoke test: V2 daemon + shim in headless Chromium, and the V2 desktop app once',
    section: ['smoke'],
    deps: ['v2-cli', 'v2-shim', 'v2-app', 'procstat'],
    optional: true,
    run: stepSmoke,
  },
];

const GROUPS: Record<string, StepName[]> = {
  all: STEPS.filter((s) => !s.optional).map((s) => s.name),
  v1: ['v1-clone', 'v1-publish', 'v1-pkg', 'v1-select'],
  v2: ['v2-clone', 'v2-deps', 'v2-wireframe', 'v2-frontend', 'v2-cli', 'v2-sidecars', 'v2-app', 'v2-shim'],
  clone: ['v1-clone', 'v2-clone'],
};

// ---------------------------------------------------------------------------------------------
// Stamps and build-info

function stampFile(paths: WorkspacePaths, step: StepName): string {
  return path.join(paths.builds, '.stamps', `${step}.json`);
}

function readStamp(paths: WorkspacePaths, step: StepName): Stamp | null {
  const s = readJson<Stamp>(stampFile(paths, step));
  return s && s.stampVersion === STAMP_VERSION ? s : null;
}

type StepStatus = 'built' | 'up-to-date' | 'failed' | 'not-run';

interface StepOutcome {
  status: StepStatus;
  at: string;
  durationMs: number;
  log: string;
  commands: CmdRecord[];
  notes: string[];
  error?: string;
}

async function collectTools(paths: WorkspacePaths): Promise<Info> {
  const v2 = exists(paths.v2Clone) ? paths.v2Clone : undefined;
  const v1 = exists(paths.v1Clone) ? paths.v1Clone : undefined;
  return {
    node: process.version,
    pnpm: await tryOut('pnpm', ['--version'], { cwd: v2 }),
    rustc: await tryOut('rustc', ['-V'], { cwd: v2 }),
    cargo: await tryOut('cargo', ['-V'], { cwd: v2 }),
    rustup: firstLine(await tryOut('rustup', ['--version'])),
    dotnetSdk: await tryOut('dotnet', ['--version'], { cwd: v1 }),
    pwsh: await tryOut('pwsh', ['--version']),
    gh: firstLine(await tryOut('gh', ['--version'])),
    git: await tryOut('git', ['--version']),
    cc: firstLine(await tryOut('cc', ['--version'])),
    xcode: firstLine(await tryOut('xcodebuild', ['-version'])),
    tauriCli: v2 ? await tauriCliVersion(paths) : null,
    macos: (await tryOut('/usr/bin/sw_vers', ['-productVersion'])) + ` (${await tryOut('/usr/bin/sw_vers', ['-buildVersion'])})`,
    arch: os.arch(),
  };
}

function setSection(root: Info, section: StepDef['section'], value: unknown): void {
  if (section.length === 1) {
    root[section[0]] = value;
    return;
  }
  const [a, b] = section;
  const sub = (root[a] && typeof root[a] === 'object' ? root[a] : {}) as Info;
  sub[b] = value;
  root[a] = sub;
}

function getSection(root: Info, section: StepDef['section']): Info | null {
  const v = section.length === 1 ? root[section[0]] : (root[section[0]] as Info | undefined)?.[section[1]];
  return v && typeof v === 'object' ? (v as Info) : null;
}

async function writeBuildInfo(ctx: CommandContext, outcomes: Map<StepName, StepOutcome>, tools: Info): Promise<Info> {
  const { paths } = ctx;
  const prev = readJson<Info>(paths.buildInfo);
  const prevSteps = (prev?.schemaVersion === BUILD_INFO_SCHEMA ? (prev.steps as Record<string, StepOutcome> | undefined) : undefined) ?? {};
  const info: Info = {
    schemaVersion: BUILD_INFO_SCHEMA,
    generatedAt: localIso(),
    workspace: paths.ws,
    harness: {
      repo: REPO_ROOT,
      sha: await gitOut(REPO_ROOT, ['rev-parse', 'HEAD']),
      benchmarkDirty: ((await gitOut(REPO_ROOT, ['status', '--porcelain', '--', 'src/benchmark'])) ?? '').split('\n').filter(Boolean).length,
    },
    pins: { v1Ref: V1_REF, v1Sha: V1_SHA, v2Ref: ctx.v2Ref, v2Sha: await gitHead(paths.v2Clone) },
    tools,
    scrubbedBuildVars: scrubbedBuildVarsPresent(),
  };
  const steps: Record<string, StepOutcome & { builtAt?: string; buildDurationMs?: number }> = {};
  for (const def of STEPS) {
    const stamp = readStamp(paths, def.name);
    const o = outcomes.get(def.name);
    if (o) steps[def.name] = { ...o, builtAt: stamp?.completedAt, buildDurationMs: stamp?.durationMs };
    else if (prevSteps[def.name]) steps[def.name] = { ...prevSteps[def.name]!, status: prevSteps[def.name]!.status === 'failed' ? 'failed' : 'not-run' };
    const value = stamp?.info ?? (o?.status === 'failed' ? { error: o.error } : prev ? getSection(prev, def.section) : null);
    if (value) setSection(info, def.section, value);
  }
  info.steps = steps;

  // The paths other parts of the harness read, in one place.
  const sel = getSection(info, ['v1', 'selection']) as { server?: Info; desktop?: Info } | null;
  const pkg = getSection(info, ['v1', 'releasePkg']);
  const app = getSection(info, ['v2', 'app']);
  const shim = getSection(info, ['v2', 'shim']);
  info.artifacts = {
    v1ServerBin: sel?.server?.bin ?? null,
    v1ServerSource: sel?.server?.source ?? null,
    v1ServerSha256: sel?.server?.sha256 ?? null,
    v1DesktopApp: sel?.desktop?.app ?? null,
    v1PublishBin: paths.v1PublishBin,
    v1Pkg: pkg?.pkg ?? null,
    v1PkgApp: pkg?.app ?? null,
    v2Bin: paths.v2Bin,
    v2Dist: paths.v2Dist,
    v2App: app?.app ?? null,
    v2Dmg: (app?.dmg as Info | null | undefined)?.path ?? null,
    v2DmgKind: (app?.dmg as Info | null | undefined)?.kind ?? null,
    v2ShimBin: shim?.bin ?? null,
    v2ShimInit: shim?.initScript ?? path.join(BENCH_ROOT, 'v2-shim', 'init.js'),
    procstat: paths.procstatBin,
  };
  // Flat aliases of the same paths, next to the per-step sections the adapters also read.
  const a = info.artifacts as Info;
  const v1 = (info.v1 ?? {}) as Info;
  Object.assign(v1, { serverBin: a.v1ServerBin, serverSource: a.v1ServerSource, serverSha256: a.v1ServerSha256, desktopApp: a.v1DesktopApp });
  info.v1 = v1;
  const v2 = (info.v2 ?? {}) as Info;
  Object.assign(v2, { bin: a.v2Bin, dist: a.v2Dist, shimBin: a.v2ShimBin, shimInit: a.v2ShimInit, appPath: a.v2App, dmgPath: a.v2Dmg });
  info.v2 = v2;
  writeJsonAtomic(paths.buildInfo, info);
  return info;
}

// ---------------------------------------------------------------------------------------------
// Entry

const SETUP_OPTIONS = {
  only: { type: 'string' },
  skip: { type: 'string' },
  force: { type: 'boolean' },
  smoke: { type: 'boolean' },
  list: { type: 'boolean' },
} as const;

function expand(spec: string | undefined): StepName[] | null {
  if (!spec) return null;
  const out = new Set<StepName>();
  for (const raw of spec.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (GROUPS[raw]) for (const n of GROUPS[raw]!) out.add(n);
    else if (STEPS.some((s) => s.name === raw)) out.add(raw as StepName);
    else throw new Error(`unknown setup step "${raw}" (steps: ${STEPS.map((s) => s.name).join(', ')}; groups: ${Object.keys(GROUPS).join(', ')})`);
  }
  return [...out];
}

function outputsPresent(def: StepDef, s: StepRun): boolean {
  return (def.outputs?.(s) ?? []).every((p) => exists(p));
}

export async function main(ctx: CommandContext): Promise<number> {
  const { paths } = ctx;
  const flags = parseArgs({ args: ctx.argv, options: SETUP_OPTIONS, strict: false, allowPositionals: true }).values as Record<string, string | boolean | undefined>;
  let only: StepName[] | null;
  let skip: StepName[];
  try {
    only = expand(typeof flags.only === 'string' ? flags.only : undefined);
    skip = expand(typeof flags.skip === 'string' ? flags.skip : undefined) ?? [];
  } catch (e) {
    ctx.log.error(errorMessage(e));
    return 2;
  }
  const force = flags.force === true;
  const selected = STEPS.filter((d) => (only ? only.includes(d.name) : !d.optional || (d.name === 'smoke' && flags.smoke === true)) && !skip.includes(d.name));

  const logDir = path.join(paths.logs, 'setup');
  const scratch = path.join(paths.builds, '.setup-scratch');
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(scratch, { recursive: true });
  const log = ctx.log.child('setup');
  log.setFile(path.join(logDir, 'setup.log'));

  if (flags.list) {
    for (const def of STEPS) {
      const s = new StepRun(def, ctx, paths, log, false, logDir, scratch);
      const stamp = readStamp(paths, def.name);
      let state = 'always runs';
      if (def.key) {
        const key = JSON.stringify(await def.key(s).catch((e: unknown) => ({ error: errorMessage(e) })));
        state = stamp && stamp.key === key && outputsPresent(def, s) ? `up to date (built ${stamp.completedAt})` : stamp ? 'stale' : 'never built';
      }
      process.stdout.write(`${selected.includes(def) ? '*' : ' '} ${def.name.padEnd(13)} ${state.padEnd(48)} ${def.title}${def.optional ? ' [opt-in]' : ''}\n`);
    }
    return 0;
  }

  installExitHandlers(log);
  log.info(`workspace ${paths.ws}; steps: ${selected.map((d) => d.name).join(', ')}${force ? ' (forced)' : ''}`);
  const outcomes = new Map<StepName, StepOutcome>();
  let failed = 0;
  for (const def of selected) {
    const s = new StepRun(def, ctx, paths, log.child(def.name), force, logDir, scratch);
    const t0 = performance.now();
    const at = localIso();
    const record = (status: StepStatus, error?: string) =>
      outcomes.set(def.name, { status, at, durationMs: Math.round(performance.now() - t0), log: s.logFile, commands: s.commands, notes: s.notes, ...(error ? { error } : {}) });
    try {
      const unmet = def.deps.filter((d) => {
        if (outcomes.get(d)?.status === 'failed') return true;
        const depDef = STEPS.find((x) => x.name === d)!;
        if (!depDef.key) return false;
        return !readStamp(paths, d) || !outputsPresent(depDef, new StepRun(depDef, ctx, paths, log, false, logDir, scratch));
      });
      // v1-select can decide with whatever candidates exist; everything else needs its inputs.
      if (unmet.length && def.name !== 'v1-select') throw new Error(`needs ${unmet.join(', ')} first (failed or never built)`);
      const key = def.key ? JSON.stringify({ v: STAMP_VERSION, key: await def.key(s) }) : null;
      const stamp = readStamp(paths, def.name);
      if (!force && key && stamp && stamp.key === key && outputsPresent(def, s)) {
        log.info(`${def.name}: up to date (built ${stamp.completedAt})`);
        record('up-to-date');
        continue;
      }
      log.info(`${def.name}: ${def.title}`);
      // A failed rebuild must not leave the old stamp claiming its outputs are current.
      rmrf(stampFile(paths, def.name));
      const info = await def.run(s);
      const durationMs = Math.round(performance.now() - t0);
      if (s.notes.length) info.notes = s.notes;
      if (key) {
        const st: Stamp = { step: def.name, stampVersion: STAMP_VERSION, key, completedAt: localIso(), durationMs, info };
        writeJsonAtomic(stampFile(paths, def.name), st);
      } else {
        writeJsonAtomic(stampFile(paths, def.name), { step: def.name, stampVersion: STAMP_VERSION, key: '', completedAt: localIso(), durationMs, info } satisfies Stamp);
      }
      record('built');
      log.info(`${def.name}: done in ${(durationMs / 1000).toFixed(1)} s`);
    } catch (e) {
      failed++;
      const msg = errorMessage(e);
      log.error(`${def.name} FAILED: ${e instanceof CommandFailed ? msg : errorText(e)}`);
      const partial = (e as { info?: Info }).info;
      if (partial) {
        // Keep what a failed smoke test observed; it is the diagnosis.
        writeJsonAtomic(stampFile(paths, def.name), { step: def.name, stampVersion: STAMP_VERSION, key: '', completedAt: localIso(), durationMs: Math.round(performance.now() - t0), info: { ...partial, error: msg } } satisfies Stamp);
      }
      record('failed', msg.slice(0, 4000));
    }
  }
  await stopAll(log);
  const tools = await collectTools(paths);
  const info = await writeBuildInfo(ctx, outcomes, tools);
  log.info(`wrote ${paths.buildInfo}`);
  const a = info.artifacts as Record<string, unknown>;
  for (const [k, v] of Object.entries(a)) log.info(`  ${k.padEnd(15)} ${v ?? '(none)'}`);
  const summary = [...outcomes].map(([n, o]) => `${n}=${o.status}`).join(' ');
  log.info(`setup ${failed ? `finished with ${failed} failed step(s)` : 'complete'}: ${summary}`);
  return failed ? 1 : 0;
}

export default main;
