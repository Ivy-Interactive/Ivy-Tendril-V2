// Process plumbing: clean environments, spawning into our own process group with logs on disk,
// tree kills, readiness waits and port allocation. Every process the harness starts goes through
// spawnLogged so that stopAll() (run on success, failure and Ctrl-C) can leave the machine clean.

import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';
import { promisify } from 'node:util';
import { DEFAULT_WORKSPACE, FORBIDDEN_PORTS, REAL_TENDRIL_HOME, SCRUBBED_ENV_VARS, TIMEOUTS, type WorkspacePaths } from './config.ts';
import { errorMessage, nullLogger, type Logger } from './log.ts';
import { descendantsFromTable, type ProcStat } from './procstat.ts';

const execFileP = promisify(execFile);

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Environment

/**
 * process.env minus everything that would point an app at the user's real data or change how it
 * runs (see SCRUBBED_ENV_VARS), plus `extra`. An `undefined` value in `extra` deletes the key.
 * Refuses to produce an environment whose TENDRIL_HOME is the user's real home.
 */
export function cleanEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of SCRUBBED_ENV_VARS) delete env[k];
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  if (env.TENDRIL_HOME && path.resolve(env.TENDRIL_HOME) === path.resolve(REAL_TENDRIL_HOME)) {
    throw new Error(`refusing to start a process with TENDRIL_HOME=${env.TENDRIL_HOME} (the user's real Tendril home)`);
  }
  return env;
}

/**
 * The environment every app process gets: isolated TENDRIL_HOME and an empty CLAUDE_CONFIG_DIR, so
 * V1's usage provider can never read real credentials. App-specific keys (IVY_TLS=0 for V1) go in
 * `extra`.
 */
export function appEnv(home: string, paths: WorkspacePaths, extra: Record<string, string | undefined> = {}): Record<string, string> {
  if (!home) throw new Error('appEnv: an isolated home is required');
  // cleanEnv validates the home first, so a bad call has no side effects.
  const env = cleanEnv({ TENDRIL_HOME: path.resolve(home), CLAUDE_CONFIG_DIR: paths.emptyClaudeConfig, ...extra });
  fs.mkdirSync(paths.emptyClaudeConfig, { recursive: true });
  const leftovers = fs.readdirSync(paths.emptyClaudeConfig);
  if (leftovers.length) {
    throw new Error(`${paths.emptyClaudeConfig} must stay empty (found ${leftovers.slice(0, 5).join(', ')})`);
  }
  return env;
}

// ---------------------------------------------------------------------------------------------
// Registry of everything we started (for guaranteed cleanup)

const live = new Map<number, Spawned>();

/** Children of the harness that are not part of any measurement (the caffeinate sleep guard). */
export const helperPids = new Set<number>();
const cleanups = new Set<() => Promise<void> | void>();

/** Registers extra cleanup (a desktop app launched through `open`, a browser); returns an unregister. */
export function registerCleanup(fn: () => Promise<void> | void): () => void {
  cleanups.add(fn);
  return () => cleanups.delete(fn);
}

export function liveProcesses(): Array<{ pid: number; label: string }> {
  return [...live.values()].map((s) => ({ pid: s.pid, label: s.label }));
}

/** Stops every process spawned through spawnLogged that is still running, then runs cleanups. */
export async function stopAll(log: Logger = nullLogger): Promise<Array<{ pid: number; label: string }>> {
  const survivors = [...live.values()];
  await Promise.all(
    survivors.map(async (s) => {
      log.warn(`stopping leftover process ${s.label} (pid ${s.pid})`);
      await s.stop().catch((e) => log.error(`failed to stop ${s.label}: ${errorMessage(e)}`));
    }),
  );
  for (const fn of [...cleanups]) {
    try {
      await fn();
    } catch (e) {
      log.error(`cleanup failed: ${errorMessage(e)}`);
    }
    cleanups.delete(fn);
  }
  return survivors.map((s) => ({ pid: s.pid, label: s.label }));
}

const interruptHooks = new Set<() => void>();

/** Runs (synchronously) after cleanup when the harness is interrupted, e.g. to mark run.json. */
export function onInterrupt(fn: () => void): () => void {
  interruptHooks.add(fn);
  return () => interruptHooks.delete(fn);
}

let handlersInstalled = false;

/**
 * Ctrl-C / SIGTERM run the async cleanup before exiting; a plain exit (or a crash) still SIGKILLs
 * every process group we own synchronously, which is all an 'exit' handler can do.
 */
export function installExitHandlers(log: Logger = nullLogger): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  let stopping = false;
  const onSignal = (sig: NodeJS.Signals) => {
    if (stopping) {
      log.error(`${sig} again: exiting without waiting for cleanup`);
      process.exit(sig === 'SIGINT' ? 130 : 143);
    }
    stopping = true;
    log.warn(`${sig} received: stopping ${live.size} process(es) and cleaning up`);
    void stopAll(log).finally(() => {
      for (const fn of interruptHooks) {
        try {
          fn();
        } catch (e) {
          log.error(`interrupt hook failed: ${errorMessage(e)}`);
        }
      }
      process.exit(sig === 'SIGINT' ? 130 : 143);
    });
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('exit', () => {
    for (const s of live.values()) {
      try {
        process.kill(s.detached ? -s.pid : s.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Spawning

export interface LineEvent {
  line: string;
  stream: 'stdout' | 'stderr';
  /** performance.now() when the line reached the harness. */
  t: number;
}

export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  t: number;
}

export interface SpawnOptions {
  cmd: string;
  args?: string[];
  cwd?: string;
  /** Full environment (build it with cleanEnv/appEnv); defaults to cleanEnv(). */
  env?: Record<string, string>;
  /** Directory for `<logPrefix>.stdout.log` / `.stderr.log` (default: setDefaultLogDir(), else <ws>/logs). */
  logDir?: string;
  logPrefix: string;
  /** Own process group (default true), so killTree can signal the whole group. */
  detached?: boolean;
  stdin?: 'ignore' | 'pipe';
  /** How many recent lines to keep for onLine() history (default 20000). */
  keepLines?: number;
  log?: Logger;
}

export interface Spawned {
  child: ChildProcess;
  pid: number;
  label: string;
  detached: boolean;
  /** performance.now() immediately before spawn(). */
  spawnAt: number;
  stdoutPath: string;
  stderrPath: string;
  exited: Promise<ExitInfo>;
  /** Set once the process has exited. */
  exitInfo: ExitInfo | null;
  /**
   * Resolves on the first line matching `re` (by default including lines already seen). Rejects on
   * timeout, or as soon as the process exits without printing it.
   */
  onLine(re: RegExp, opts?: { stream?: 'stdout' | 'stderr' | 'both'; timeoutMs?: number; fromStart?: boolean }): Promise<LineEvent>;
  lines(): LineEvent[];
  stop(opts?: KillOptions): Promise<KillResult>;
}

let defaultLogDir: string | null = null;

/** Where spawnLogged puts process logs when the caller does not say (the run command sets <runDir>/logs). */
export function setDefaultLogDir(dir: string | null): void {
  defaultLogDir = dir;
}

/** Executables of the apps under test: starting one without an isolated home would use ~/.tendril. */
const APP_BINARIES = new Set(['Ivy.Tendril', 'tendril', 'tendril-app', 'v2shim']);

function assertIsolated(cmd: string, args: readonly string[], env: Record<string, string>): void {
  const base = path.basename(cmd);
  if (APP_BINARIES.has(base) && !env.TENDRIL_HOME) {
    throw new Error(`refusing to start ${base} without an explicit TENDRIL_HOME (use appEnv(home, paths))`);
  }
  if (base === 'open' && args.some((a) => /Tendril/i.test(a)) && !args.some((a) => a.startsWith('TENDRIL_HOME='))) {
    throw new Error('refusing to `open` a Tendril app without `--env TENDRIL_HOME=<isolated home>`');
  }
}

export function spawnLogged(opts: SpawnOptions): Spawned {
  const log = opts.log ?? nullLogger;
  const logDir = opts.logDir ?? defaultLogDir ?? path.join(DEFAULT_WORKSPACE, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const stdoutPath = path.join(logDir, `${opts.logPrefix}.stdout.log`);
  const stderrPath = path.join(logDir, `${opts.logPrefix}.stderr.log`);
  const detached = opts.detached ?? true;
  const keep = opts.keepLines ?? 20_000;
  const env = opts.env ?? cleanEnv();
  assertIsolated(opts.cmd, opts.args ?? [], env);
  const outFile = fs.createWriteStream(stdoutPath, { flags: 'a' });
  const errFile = fs.createWriteStream(stderrPath, { flags: 'a' });

  const spawnAt = performance.now();
  const child = spawn(opts.cmd, opts.args ?? [], {
    cwd: opts.cwd,
    env,
    detached,
    stdio: [opts.stdin ?? 'ignore', 'pipe', 'pipe'],
  });
  if (child.pid === undefined) {
    // spawn failures (ENOENT, EACCES) surface asynchronously; make them synchronous and loud, and
    // swallow the later 'error' event so it cannot crash the harness as an unhandled one.
    child.on('error', () => {});
    outFile.end();
    errFile.end();
    throw new Error(`failed to spawn ${opts.cmd}: executable missing or not runnable`);
  }
  const pid = child.pid;
  const label = `${opts.logPrefix}[${pid}]`;
  log.debug(`spawned ${label}: ${opts.cmd} ${(opts.args ?? []).join(' ')}`);

  const history: LineEvent[] = [];
  type Waiter = { re: RegExp; stream: 'stdout' | 'stderr' | 'both'; resolve: (e: LineEvent) => void; reject: (e: Error) => void };
  const waiters = new Set<Waiter>();

  const emitLine = (line: string, stream: 'stdout' | 'stderr') => {
    const ev: LineEvent = { line, stream, t: performance.now() };
    history.push(ev);
    if (history.length > keep) history.splice(0, history.length - keep);
    for (const w of [...waiters]) {
      if ((w.stream === 'both' || w.stream === stream) && w.re.test(line)) {
        waiters.delete(w);
        w.resolve(ev);
      }
    }
  };

  const pump = (src: NodeJS.ReadableStream, file: fs.WriteStream, stream: 'stdout' | 'stderr') => {
    const dec = new StringDecoder('utf8');
    let partial = '';
    src.on('data', (chunk: Buffer) => {
      file.write(chunk);
      partial += dec.write(chunk);
      let nl: number;
      while ((nl = partial.indexOf('\n')) >= 0) {
        emitLine(partial.slice(0, nl).replace(/\r$/, ''), stream);
        partial = partial.slice(nl + 1);
      }
    });
    src.on('end', () => {
      partial += dec.end();
      if (partial) emitLine(partial.replace(/\r$/, ''), stream);
      partial = '';
      file.end();
    });
  };
  pump(child.stdout!, outFile, 'stdout');
  pump(child.stderr!, errFile, 'stderr');

  let exitInfo: ExitInfo | null = null;
  const exited = new Promise<ExitInfo>((resolve) => {
    child.on('exit', (code, signal) => {
      exitInfo = { code, signal, t: performance.now() };
      live.delete(pid);
      log.debug(`${label} exited (code ${code}, signal ${signal})`);
      // Give the pipes a moment to deliver the last lines before failing any waiter.
      setTimeout(() => {
        for (const w of [...waiters]) {
          waiters.delete(w);
          w.reject(new Error(`${label} exited (code ${code}, signal ${signal}) before printing ${w.re}`));
        }
      }, 50);
      resolve(exitInfo);
    });
    child.on('error', (e) => {
      log.error(`${label} error: ${e.message}`);
    });
  });

  const handle: Spawned = {
    child,
    pid,
    label,
    detached,
    spawnAt,
    stdoutPath,
    stderrPath,
    exited,
    get exitInfo() {
      return exitInfo;
    },
    onLine(re, o = {}) {
      const stream = o.stream ?? 'both';
      if (o.fromStart ?? true) {
        const hit = history.find((h) => (stream === 'both' || h.stream === stream) && re.test(h.line));
        if (hit) return Promise.resolve(hit);
      }
      if (exitInfo) return Promise.reject(new Error(`${label} already exited before printing ${re}`));
      return new Promise<LineEvent>((resolve, reject) => {
        const w: Waiter = { re, stream, resolve, reject };
        waiters.add(w);
        if (o.timeoutMs !== undefined) {
          const timer = setTimeout(() => {
            if (!waiters.delete(w)) return;
            reject(new TimeoutError(`${label}: no line matching ${re} within ${o.timeoutMs} ms`));
          }, o.timeoutMs);
          timer.unref();
          const clear = () => clearTimeout(timer);
          exited.then(clear, clear);
        }
      });
    },
    lines: () => history.slice(),
    stop: (k) => killTree(pid, { ...k, exited, log }),
  };
  live.set(pid, handle);
  return handle;
}

// ---------------------------------------------------------------------------------------------
// Killing

export interface KillOptions {
  /** First signal (default SIGTERM; V1 ignores SIGINT from non-interactive shells). */
  signal?: NodeJS.Signals;
  /** How long to wait after the first signal before SIGKILL (default 5 s). */
  graceMs?: number;
  procstat?: ProcStat;
  /** Resolves when the root exits (spawnLogged passes its own, which also reaps the zombie). */
  exited?: Promise<unknown>;
  log?: Logger;
}

export interface KillResult {
  pid: number;
  /** Escalated to SIGKILL. */
  forced: boolean;
  /** Pids from the tree still alive afterwards (should be empty). */
  survivors: number[];
  ms: number;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function trySignal(target: number, sig: NodeJS.Signals): boolean {
  try {
    process.kill(target, sig);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stops `pid` and everything under it: the first signal goes to its process group when it leads
 * one (spawnLogged children do), otherwise to the pid; after the grace period everything left in
 * the group plus every descendant recorded up front gets SIGKILL. Descendants are recorded before
 * signalling because once the root dies they are re-parented to launchd and untraceable.
 */
export async function killTree(pid: number, sigOrOpts: NodeJS.Signals | KillOptions = {}): Promise<KillResult> {
  const opts: KillOptions = typeof sigOrOpts === 'string' ? { signal: sigOrOpts } : sigOrOpts;
  const t0 = performance.now();
  const log = opts.log ?? nullLogger;
  const grace = opts.graceMs ?? TIMEOUTS.stopGraceMs;
  const sig = opts.signal ?? 'SIGTERM';
  const tree = await descendants(pid, opts.procstat).catch(() => [] as number[]);
  const leader = groupAlive(pid);

  if (!isAlive(pid) && !leader) {
    return { pid, forced: false, survivors: tree.filter(isAlive), ms: performance.now() - t0 };
  }
  if (leader) trySignal(-pid, sig);
  else trySignal(pid, sig);

  const rootGone = async (deadline: number) => {
    while (performance.now() < deadline) {
      if (!isAlive(pid)) return true;
      if (opts.exited) {
        const done = await Promise.race([opts.exited.then(() => true), sleep(25).then(() => false)]);
        if (done) return true;
      } else {
        await sleep(25);
      }
    }
    return !isAlive(pid);
  };
  const deadline = t0 + grace;
  let forced = false;
  const gone = await rootGone(deadline);
  if (gone) {
    // The root handled the signal; give its own children the rest of the grace period to follow.
    while (performance.now() < deadline && ((leader && groupAlive(pid)) || tree.some(isAlive))) await sleep(25);
  }
  const leftovers = tree.filter(isAlive);
  if (!gone || (leader && groupAlive(pid)) || leftovers.length) {
    forced = true;
    log.warn(`pid ${pid}: still running ${Math.round(performance.now() - t0)} ms after ${sig}; sending SIGKILL`);
    if (leader) trySignal(-pid, 'SIGKILL');
    trySignal(pid, 'SIGKILL');
    for (const d of leftovers) trySignal(d, 'SIGKILL');
    const killDeadline = performance.now() + 2000;
    while (performance.now() < killDeadline && (isAlive(pid) || tree.some(isAlive))) await sleep(20);
  }
  const survivors = [pid, ...tree].filter(isAlive);
  if (survivors.length) log.error(`pid ${pid}: survivors after SIGKILL: ${survivors.join(', ')}`);
  return { pid, forced, survivors, ms: performance.now() - t0 };
}

// ---------------------------------------------------------------------------------------------
// Process tree discovery

async function psTable(): Promise<Array<{ pid: number; ppid: number; pgid: number; uid: number; name: string; start_us: null }>> {
  const { stdout } = await execFileP('/bin/ps', ['-axo', 'pid=,ppid=,pgid='], { maxBuffer: 16 * 1024 * 1024 });
  const rows = [];
  for (const line of stdout.split('\n')) {
    const m = line.trim().split(/\s+/);
    if (m.length < 3) continue;
    rows.push({ pid: Number(m[0]), ppid: Number(m[1]), pgid: Number(m[2]), uid: -1, name: '', start_us: null });
  }
  return rows;
}

/** All descendants of `pid` (via procstat's process table when given, `ps` otherwise). */
export async function descendants(pid: number, procstat?: ProcStat): Promise<number[]> {
  const table = procstat ? await procstat.listAll() : await psTable();
  return descendantsFromTable(table, pid);
}

// ---------------------------------------------------------------------------------------------
// Waiting

export class TimeoutError extends Error {
  override name = 'TimeoutError';
}

export interface WaitOptions {
  timeoutMs: number;
  intervalMs?: number;
  description?: string;
  /** Checked every attempt; a non-null string aborts the wait with that reason (e.g. process exited). */
  bail?: () => string | null | undefined;
}

/** Polls `fn` until it returns a truthy value. `t` is performance.now() of the successful attempt. */
export async function waitFor<T>(fn: () => T | Promise<T>, opts: WaitOptions): Promise<{ value: NonNullable<T>; t: number; attempts: number }> {
  const start = performance.now();
  const interval = opts.intervalMs ?? 50;
  let attempts = 0;
  let lastErr: unknown = null;
  for (;;) {
    const reason = opts.bail?.();
    if (reason) throw new Error(`${opts.description ?? 'waitFor'}: ${reason}`);
    attempts++;
    try {
      const v = await fn();
      if (v) return { value: v as NonNullable<T>, t: performance.now(), attempts };
    } catch (e) {
      lastErr = e;
    }
    if (performance.now() - start >= opts.timeoutMs) {
      const extra = lastErr ? ` (last error: ${errorMessage(lastErr)})` : '';
      throw new TimeoutError(`${opts.description ?? 'waitFor'}: timed out after ${opts.timeoutMs} ms${extra}`);
    }
    await sleep(interval);
  }
}

export interface WaitHttpOptions {
  expectStatus?: number | number[] | ((status: number) => boolean);
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Delay between attempts (default 5 ms: readiness is timed from these polls). */
  intervalMs?: number;
  /** Per-attempt timeout (a server that accepts but never answers must not stall the poll). */
  requestTimeoutMs?: number;
  method?: string;
  bail?: () => string | null | undefined;
}

export interface WaitHttpResult {
  /** performance.now() when the first successful response had been fully read. */
  t: number;
  status: number;
  attempts: number;
  body: string;
}

function statusMatches(status: number, expect: WaitHttpOptions['expectStatus']): boolean {
  if (expect === undefined) return status === 200;
  if (typeof expect === 'number') return status === expect;
  if (Array.isArray(expect)) return expect.includes(status);
  return expect(status);
}

/** One request on a fresh connection; resolves with status 0 on any network error. */
function probe(url: URL, method: string, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; body: string; error?: string }> {
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const req = mod.request(
      url,
      { method, headers, agent: false, timeout: timeoutMs, rejectUnauthorized: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.end();
  });
}

/** Like waitForHttp but returns status, body and attempt count as well. */
export async function waitForHttpDetailed(url: string, opts: WaitHttpOptions = {}): Promise<WaitHttpResult> {
  const u = new URL(url);
  const start = performance.now();
  const timeout = opts.timeoutMs ?? TIMEOUTS.startupMs;
  const interval = opts.intervalMs ?? 5;
  let attempts = 0;
  let last = '';
  for (;;) {
    const reason = opts.bail?.();
    if (reason) throw new Error(`waiting for ${url}: ${reason}`);
    attempts++;
    const r = await probe(u, opts.method ?? 'GET', opts.headers ?? {}, opts.requestTimeoutMs ?? 5000);
    if (r.status && statusMatches(r.status, opts.expectStatus)) {
      return { t: performance.now(), status: r.status, attempts, body: r.body };
    }
    last = r.status ? `HTTP ${r.status}` : (r.error ?? 'no response');
    if (performance.now() - start >= timeout) {
      throw new TimeoutError(`waiting for ${url}: timed out after ${timeout} ms (${attempts} attempts, last: ${last})`);
    }
    await sleep(interval);
  }
}

/** Polls `url` until it answers with the expected status; returns performance.now() of that success. */
export async function waitForHttp(url: string, opts: WaitHttpOptions = {}): Promise<number> {
  return (await waitForHttpDetailed(url, opts)).t;
}

// ---------------------------------------------------------------------------------------------
// Ports

const handedOut = new Set<number>();

/**
 * A currently free loopback port (bind 127.0.0.1:0, read, close). Never one of FORBIDDEN_PORTS and
 * never the same port twice per harness process, which narrows the bind race between allocation
 * and the app binding it.
 */
export async function freePort(): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const port = await new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.unref();
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        const p = typeof addr === 'object' && addr ? addr.port : 0;
        srv.close(() => resolve(p));
      });
    });
    if (!port || FORBIDDEN_PORTS.includes(port) || handedOut.has(port)) continue;
    handedOut.add(port);
    return port;
  }
  throw new Error('freePort: could not find a free loopback port');
}

/** Runs a short-lived command to completion with a clean env and a timeout (for tools, not apps). */
export async function run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  const r = await execFileP(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? cleanEnv(),
    timeout: opts.timeoutMs ?? 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { stdout: String(r.stdout), stderr: String(r.stderr) };
}
