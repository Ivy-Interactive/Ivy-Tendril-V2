// Pieces both adapters need: build-info lookups, one-shot app commands, the identical REST request
// shapes, and everything around launching a real desktop app through LaunchServices (finding its
// pid, attributing the WebKit XPC processes it owns, and quitting it without leaving any behind).

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import type { WorkspacePaths } from '../lib/config.ts';
import type { Logger } from '../lib/log.ts';
import { isAlive, sleep, spawnLogged, TimeoutError, waitFor } from '../lib/proc.ts';
import type { ProcStat } from '../lib/procstat.ts';
import type { ApiRequest, ApiRequestContext, ApiScenario, NavTarget } from './types.ts';

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------------------------
// build-info.json

/** build-info.json as written by `setup` (null when setup has not run). */
export function readBuildInfo(paths: WorkspacePaths): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(paths.buildInfo, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The first string found at any of the dotted `keys` (e.g. `v1.serverBin`). */
export function pickString(obj: unknown, keys: readonly string[]): { key: string; value: string } | null {
  for (const key of keys) {
    let cur: unknown = obj;
    for (const part of key.split('.')) {
      cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[part] : undefined;
    }
    if (typeof cur === 'string' && cur) return { key, value: cur };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Process helpers

let seq = 0;
/** Unique, sortable suffix for log file names within one harness process. */
export function nextTag(): string {
  return String(++seq).padStart(3, '0');
}

/**
 * An empty working directory two levels deep inside `root`. V2 looks for promptwares at
 * `src/promptwares`, `promptwares`, `../promptwares`, `../../src/promptwares`, ... relative to its CWD
 * (case-insensitively on APFS), so the CWD and both parents must be under our control or a stray
 * directory could change what the daemon deploys on start.
 */
export function emptyCwd(root: string): string {
  // If an app ever leaves something in its CWD, move on to a fresh sibling rather than reuse it.
  for (let i = 0; i < 100; i++) {
    const dir = path.join(root, 'cwd', i ? `empty-${i}` : 'empty');
    fs.mkdirSync(dir, { recursive: true });
    if (fs.readdirSync(dir).length === 0) return dir;
  }
  throw new Error(`no empty working directory left under ${path.join(root, 'cwd')}`);
}

export interface OnceResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  ms: number;
  stdout: string;
  stderr: string;
}

/** Runs an app command to completion through spawnLogged (so an interrupt still stops it). */
export async function runOnce(o: { cmd: string; args: string[]; env: Record<string, string>; cwd: string; logDir: string; logPrefix: string; timeoutMs: number; log: Logger }): Promise<OnceResult> {
  const sp = spawnLogged({ cmd: o.cmd, args: o.args, env: o.env, cwd: o.cwd, logDir: o.logDir, logPrefix: o.logPrefix, log: o.log });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((r) => {
    timer = setTimeout(() => r('timeout'), o.timeoutMs);
  });
  const res = await Promise.race([sp.exited, timeout]);
  clearTimeout(timer);
  if (res === 'timeout') {
    await sp.stop();
    throw new TimeoutError(`${path.basename(o.cmd)} ${o.args.join(' ')}: no exit within ${o.timeoutMs} ms`);
  }
  // Let the pipes drain the last lines before collecting them.
  await sleep(20);
  const lines = sp.lines();
  return {
    code: res.code,
    signal: res.signal,
    ms: res.t - sp.spawnAt,
    stdout: lines.filter((l) => l.stream === 'stdout').map((l) => l.line).join('\n'),
    stderr: lines.filter((l) => l.stream === 'stderr').map((l) => l.line).join('\n'),
  };
}

export function tail(s: string, n = 12): string {
  return s.split('\n').filter(Boolean).slice(-n).join('\n');
}

/** Reads `<home>/.master` (both apps write one; the shapes differ). */
export function readMaster(home: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, '.master'), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Resolves once `pid` has exited (true) or after `timeoutMs` (false). */
export async function waitExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(25);
  }
  return !isAlive(pid);
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // Already gone.
  }
}

// ---------------------------------------------------------------------------------------------
// Identical REST requests

/**
 * The benchmark's API scenarios. Both apps take the same request except `health`, which is each
 * framework's cheapest endpoint (V1 has no /api/health). `plans.update` alternates Icebox/Draft on
 * the iteration index so an even number of writes leaves the plan where it started.
 */
export function apiScenarios(healthPath: string): Record<ApiScenario, (ctx: ApiRequestContext) => ApiRequest> {
  return {
    health: () => ({ method: 'GET', path: healthPath }),
    'plans.list': () => ({ method: 'GET', path: '/api/plans?limit=50' }),
    'plans.filter': () => ({ method: 'GET', path: '/api/plans?state=Draft&limit=50' }),
    'plans.get': (c) => ({ method: 'GET', path: `/api/plans/${encodeURIComponent(c.planId)}` }),
    'projects.list': () => ({ method: 'GET', path: '/api/projects' }),
    'jobs.get': (c) => ({ method: 'GET', path: `/api/jobs/${encodeURIComponent(c.jobId)}` }),
    'plans.update': (c) => ({
      method: 'PUT',
      path: `/api/plans/${encodeURIComponent(c.planId)}`,
      body: { field: 'state', value: (c.i ?? 0) % 2 === 0 ? 'Icebox' : 'Draft' },
    }),
  };
}

/** Shared Tendril shell markup (identical in both versions). */
export function navButton(target: NavTarget): string {
  return `button.tsh-nav-item[data-menu-item="${target}"]`;
}

export function navBadge(target: NavTarget): string {
  return `${navButton(target)} .tsh-nav-badge`;
}

// ---------------------------------------------------------------------------------------------
// Desktop apps (LaunchServices)

/**
 * The privacy-protected (TCC) folder `p` is in, or null. An app launched through LaunchServices is
 * its own responsible process, so reading its home from one of these needs the user's consent:
 * the locally built, ad-hoc signed V2 Tendril.app blocked in `open()` of `<home>/.master` inside
 * Tauri's setup (observed: no window, WebContent never loaded) until killed. The installed V1 app
 * happens to hold a Desktop grant on this machine; desktop runs must not depend on either.
 */
export function tccProtectedRoot(p: string): string | null {
  const abs = path.resolve(p);
  const home = os.homedir();
  const roots = ['Desktop', 'Documents', 'Downloads', path.join('Library', 'Mobile Documents')].map((d) => path.join(home, d));
  for (const r of roots) if (abs === r || abs.startsWith(`${r}/`)) return r;
  if (abs.startsWith('/Volumes/')) return abs.split('/').slice(0, 3).join('/');
  return null;
}

export function assertDesktopHome(app: string, home: string): void {
  const root = tccProtectedRoot(home);
  if (root) {
    throw new Error(
      `${app} desktop home ${home} is inside ${root}, which macOS privacy protection guards: the app would block on a consent prompt. ` +
        'Restore desktop homes outside it: restoreHome({ ..., homesRoot: desktopHomesRoot(runDir) }) from datasets/index.ts.',
    );
  }
}

/** CFBundleShortVersionString of an .app, or null. */
export async function bundleVersion(app: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(app, 'Contents', 'Info.plist')]);
    return String(stdout).trim() || null;
  } catch {
    return null;
  }
}

/** Pids currently running `exe` (matched on the executable path, not the name). */
export async function pidsRunning(procstat: ProcStat, exe: string): Promise<number[]> {
  const base = path.basename(exe);
  const table = await procstat.listAll();
  // proc_name is truncated to 32 characters; compare on a prefix, then confirm with the real path.
  const candidates = table.filter((p) => p.name && (base.startsWith(p.name) || p.name.startsWith(base.slice(0, 15)))).map((p) => p.pid);
  if (!candidates.length) return [];
  const paths = await procstat.paths(candidates);
  const real = fs.realpathSync(exe);
  return candidates.filter((pid) => {
    const p = paths.get(pid);
    if (!p) return false;
    try {
      return fs.realpathSync(p) === real;
    } catch {
      return p === exe;
    }
  });
}

/**
 * The environment of a running same-user process as seen by `ps -E`. Used to prove that the app
 * process LaunchServices started is the one we launched with our isolated TENDRIL_HOME (and not,
 * say, the user's own copy of the same app).
 */
export async function processEnvContains(pid: number, entry: string): Promise<boolean | null> {
  try {
    const { stdout } = await execFileP('/bin/ps', ['-wwE', '-o', 'command=', '-p', String(pid)], { maxBuffer: 8 * 1024 * 1024 });
    const s = String(stdout);
    if (!s.trim()) return null;
    return s.includes(` ${entry} `) || s.endsWith(` ${entry}\n`) || s.includes(` ${entry}\n`);
  } catch {
    return null;
  }
}

export interface LaunchResult {
  appPid: number;
  /** performance.now() just before `open` was spawned. */
  launchedAt: number;
  /** performance.now() when the new app pid was first seen. */
  pidSeenAt: number;
  stdoutPath: string;
  stderrPath: string;
  openMs: number;
}

/**
 * Launches an .app with `open -n -F` (new instance, no restored windows) so LaunchServices makes it
 * its own "responsible" process: that is what lets us attribute its WebKit XPC services, which are
 * children of launchd, not of the app. The pid is the new process running `exe`.
 */
export async function launchApp(o: {
  app: string;
  exe: string;
  env: Record<string, string>;
  args?: string[];
  logDir: string;
  logPrefix: string;
  procstat: ProcStat;
  timeoutMs: number;
  log: Logger;
}): Promise<LaunchResult> {
  fs.mkdirSync(o.logDir, { recursive: true });
  const stdoutPath = path.join(o.logDir, `${o.logPrefix}.app.stdout.log`);
  const stderrPath = path.join(o.logDir, `${o.logPrefix}.app.stderr.log`);
  const before = new Set(await pidsRunning(o.procstat, o.exe));
  const args = ['-n', '-F'];
  for (const [k, v] of Object.entries(o.env)) args.push('--env', `${k}=${v}`);
  args.push('--stdout', stdoutPath, '--stderr', stderrPath, o.app);
  if (o.args?.length) args.push('--args', ...o.args);
  const opener = spawnLogged({ cmd: '/usr/bin/open', args, logDir: o.logDir, logPrefix: `${o.logPrefix}.open`, log: o.log });
  const launchedAt = opener.spawnAt;
  const exit = await Promise.race([opener.exited, sleep(o.timeoutMs).then(() => null)]);
  if (!exit) {
    await opener.stop();
    throw new TimeoutError(`open ${o.app} did not return within ${o.timeoutMs} ms`);
  }
  if (exit.code !== 0) {
    throw new Error(`open ${o.app} exited with ${exit.code ?? exit.signal}: ${tail(opener.lines().map((l) => l.line).join('\n'), 5)}`);
  }
  const found = await waitFor(
    async () => {
      const now = await pidsRunning(o.procstat, o.exe);
      return now.find((p) => !before.has(p)) ?? null;
    },
    { timeoutMs: o.timeoutMs, intervalMs: 20, description: `waiting for a new ${path.basename(o.exe)} process` },
  );
  return { appPid: found.value, launchedAt, pidSeenAt: found.t, stdoutPath, stderrPath, openMs: exit.t - launchedAt };
}

const WEBKIT_ROLES: Array<[RegExp, string]> = [
  [/WebContent/, 'webkit-webcontent'],
  [/GPU/, 'webkit-gpu'],
  [/Networking/, 'webkit-networking'],
];

export function webkitRole(name: string): string {
  for (const [re, role] of WEBKIT_ROLES) if (re.test(name)) return role;
  return 'webkit-other';
}

/** WebKit XPC processes (ppid 1) whose responsible pid is `appPid`, with their roles. */
export async function webkitProcesses(procstat: ProcStat, appPid: number): Promise<Array<{ role: string; pid: number; name: string }>> {
  const table = await procstat.listAll();
  const wk = table.filter((p) => p.name.startsWith('com.apple.WebKit') || p.name.startsWith('com.apple.WebK'));
  if (!wk.length) return [];
  const resp = await procstat.responsible(wk.map((p) => p.pid));
  return wk.filter((p) => resp.get(p.pid) === appPid).map((p) => ({ role: webkitRole(p.name), pid: p.pid, name: p.name }));
}

/**
 * Quits a LaunchServices-launched app: each signal in `signals` in turn with `graceMs` to exit,
 * then SIGKILL. Then waits for the WebKit processes it owned (recorded up front: once the app is
 * gone they can no longer be attributed) and kills any that outlive it by 10 s. Returns what
 * happened, for the handle's meta.
 */
export async function quitApp(o: { appPid: number; procstat: ProcStat; signals: NodeJS.Signals[]; graceMs: number; log: Logger }): Promise<{ exitedOn: string; forced: boolean; webkit: number[]; webkitForced: number[]; ms: number }> {
  const t0 = performance.now();
  const webkit = (await webkitProcesses(o.procstat, o.appPid).catch(() => [])).map((w) => w.pid);
  let exitedOn = 'already exited';
  let forced = false;
  if (isAlive(o.appPid)) {
    exitedOn = '';
    for (const sig of o.signals) {
      signal(o.appPid, sig);
      if (await waitExit(o.appPid, o.graceMs)) {
        exitedOn = sig;
        break;
      }
      o.log.warn(`app pid ${o.appPid} still running ${o.graceMs} ms after ${sig}`);
    }
    if (!exitedOn) {
      forced = true;
      exitedOn = 'SIGKILL';
      signal(o.appPid, 'SIGKILL');
      await waitExit(o.appPid, 3000);
    }
  }
  const webkitForced: number[] = [];
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline && webkit.some(isAlive)) await sleep(50);
  for (const pid of webkit.filter(isAlive)) {
    webkitForced.push(pid);
    signal(pid, 'SIGKILL');
  }
  if (webkitForced.length) {
    o.log.warn(`WebKit process(es) ${webkitForced.join(', ')} outlived app ${o.appPid} by 10 s; killed`);
    await sleep(200);
  }
  const survivors = [o.appPid, ...webkit].filter(isAlive);
  if (survivors.length) o.log.error(`still running after quitting app ${o.appPid}: ${survivors.join(', ')}`);
  return { exitedOn, forced, webkit, webkitForced, ms: performance.now() - t0 };
}

/** Whether `pid` holds an established TCP connection to 127.0.0.1:`port` (via lsof). */
export async function hasConnectionTo(pid: number, port: number): Promise<boolean | null> {
  try {
    const { stdout } = await execFileP('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), `-iTCP@127.0.0.1:${port}`, '-sTCP:ESTABLISHED', '-Fn'], { timeout: 10_000 });
    return String(stdout).includes(`:${port}`);
  } catch (e) {
    // lsof exits 1 when nothing matches.
    const err = e as { code?: number; stdout?: string };
    if (err.code === 1) return false;
    return null;
  }
}
