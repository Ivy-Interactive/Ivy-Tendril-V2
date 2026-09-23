// TypeScript side of native/procstat.c: one persistent helper process for the whole run, spoken to
// over a line protocol. Also the tree expansion, aggregation and time-series sampling every memory
// and CPU number in the report goes through, so the metric definitions live here:
//
//   footprint      = sum of ri_phys_footprint over the process set (dirty + compressed + swapped +
//                    IOKit-owned). Same number as Activity Monitor "Memory" and jetsam accounting.
//   peak footprint = sum of per-process ri_interval_max_phys_footprint since reset(). A sum of
//                    per-process peaks is an upper bound on the simultaneous peak.
//   rss            = sum of ri_resident_size. Context only: it double-counts shared clean pages.
//   cpu            = ri_user_time + ri_system_time, converted from mach ticks to ns by the helper.

import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { BENCH_ROOT, DEFAULT_WORKSPACE, workspacePaths } from './config.ts';
import { nullLogger, type Logger } from './log.ts';

const execFileP = promisify(execFile);

export const PROCSTAT_SOURCE = path.join(BENCH_ROOT, 'native', 'procstat.c');
export const MiB = 1024 * 1024;

export function toMiB(bytes: number): number {
  return bytes / MiB;
}

// ---------------------------------------------------------------------------------------------
// Wire types (exactly what the helper prints)

export interface ProcSample {
  pid: number;
  ok: boolean;
  err?: string;
  name?: string;
  phys_footprint: number;
  lifetime_max_footprint: number;
  interval_max_footprint: number;
  resident: number;
  wired: number;
  cpu_ns: number;
  user_ns: number;
  system_ns: number;
  pkg_idle_wkups: number;
  interrupt_wkups: number;
  pageins: number;
  diskio_read: number;
  diskio_written: number;
  logical_writes: number;
  instructions: number;
  cycles: number;
  billed_energy_nj: number;
  runnable_ns: number;
  /** Process start, same clock as `t_ns` (mach absolute time in ns). */
  start_ns: number;
  /** Non-zero once the process has exited (zombie not yet reaped). */
  exit_ns: number;
}

export interface SampleResult {
  /** mach_absolute_time in ns at the helper, taken before the first pid was read. */
  t_ns: number;
  /** performance.now() when the reply arrived in this process. */
  t: number;
  procs: ProcSample[];
}

export interface ResetResult {
  ok: number[];
  failed: Array<{ pid: number; err: string }>;
}

export interface ProcInfo {
  pid: number;
  ppid: number;
  pgid: number;
  uid: number;
  name: string;
  /** Wall-clock start in microseconds since the epoch (null when the kernel refused full info). */
  start_us: number | null;
}

export interface WindowInfo {
  pid: number;
  id: number;
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
  onscreen: boolean;
  owner: string;
}

// ---------------------------------------------------------------------------------------------
// Tree aggregation types

export interface RoleRoot {
  role: string;
  pid: number;
}

export interface Agg {
  count: number;
  footprint: number;
  /** Sum of per-process interval max since the last reset (upper bound on simultaneous peak). */
  peakFootprint: number;
  lifetimeMaxFootprint: number;
  resident: number;
  cpu_ns: number;
  pkg_idle_wkups: number;
  interrupt_wkups: number;
  diskio_read: number;
  diskio_written: number;
}

export interface TreeProc extends ProcSample {
  role: string;
  /** The root pid this process was reached from. */
  root: number;
  ppid: number | null;
}

export interface TreeSample {
  t_ns: number;
  t: number;
  procs: TreeProc[];
  byRole: Record<string, Agg>;
  total: Agg;
  /** Pids that were requested but could not be read (exited, or not permitted). */
  missing: Array<{ pid: number; role: string; err: string }>;
}

export function emptyAgg(): Agg {
  return {
    count: 0,
    footprint: 0,
    peakFootprint: 0,
    lifetimeMaxFootprint: 0,
    resident: 0,
    cpu_ns: 0,
    pkg_idle_wkups: 0,
    interrupt_wkups: 0,
    diskio_read: 0,
    diskio_written: 0,
  };
}

function addTo(a: Agg, p: ProcSample): void {
  a.count++;
  a.footprint += p.phys_footprint;
  a.peakFootprint += p.interval_max_footprint;
  a.lifetimeMaxFootprint += p.lifetime_max_footprint;
  a.resident += p.resident;
  a.cpu_ns += p.cpu_ns;
  a.pkg_idle_wkups += p.pkg_idle_wkups;
  a.interrupt_wkups += p.interrupt_wkups;
  a.diskio_read += p.diskio_read;
  a.diskio_written += p.diskio_written;
}

/** Descendants of `roots` in a process table, breadth-first, excluding the roots themselves. */
export function descendantsFromTable(table: ProcInfo[], root: number): number[] {
  const kids = new Map<number, number[]>();
  for (const p of table) {
    if (p.pid === p.ppid) continue;
    let list = kids.get(p.ppid);
    if (!list) kids.set(p.ppid, (list = []));
    list.push(p.pid);
  }
  const out: number[] = [];
  const seen = new Set<number>([root]);
  const queue = [root];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const k of kids.get(cur) ?? []) {
      if (seen.has(k) || k <= 1) continue;
      seen.add(k);
      out.push(k);
      queue.push(k);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Build

/**
 * Compiles the helper when it is missing or older than its source. Builds to a temp name and
 * renames, so two harness invocations racing here never exec a half-written binary.
 */
export async function ensureProcstat(bin: string = workspacePaths(DEFAULT_WORKSPACE).procstatBin, log: Logger = nullLogger): Promise<string> {
  const srcStat = fs.statSync(PROCSTAT_SOURCE);
  let fresh = false;
  try {
    fresh = fs.statSync(bin).mtimeMs >= srcStat.mtimeMs;
  } catch {
    fresh = false;
  }
  if (fresh) return bin;
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  const tmp = `${bin}.tmp-${process.pid}`;
  const args = ['-O2', '-Wall', '-o', tmp, PROCSTAT_SOURCE, '-framework', 'CoreGraphics', '-framework', 'CoreFoundation'];
  log.info(`compiling procstat: cc ${args.join(' ')}`);
  try {
    await execFileP('cc', args, { timeout: 120_000 });
    fs.renameSync(tmp, bin);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`failed to compile ${PROCSTAT_SOURCE}: ${(e as Error).message}`);
  }
  return bin;
}

// ---------------------------------------------------------------------------------------------
// Client

interface Pending {
  line: string;
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
}

export class ProcStat {
  private child: ChildProcess | null = null;
  private pending: Pending[] = [];
  private buf = '';
  private closed = false;
  private readonly bin: string;
  private readonly log: Logger;
  timebase: [number, number] | null = null;
  helperPid = 0;

  private constructor(bin: string, log: Logger) {
    this.bin = bin;
    this.log = log;
  }

  /** Compiles the helper if needed, starts it and checks it answers. */
  static async open(opts: { bin?: string; ws?: string; log?: Logger } = {}): Promise<ProcStat> {
    const log = opts.log ?? nullLogger;
    const bin = await ensureProcstat(opts.bin ?? workspacePaths(opts.ws ?? DEFAULT_WORKSPACE).procstatBin, log);
    const ps = new ProcStat(bin, log);
    const pong = await ps.ping();
    ps.timebase = pong.timebase;
    ps.helperPid = pong.pid;
    return ps;
  }

  private start(): ChildProcess {
    const child = spawn(this.bin, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => this.onData(chunk));
    child.on('exit', (code, signal) => {
      const err = new Error(`procstat helper exited (code ${code}, signal ${signal})`);
      if (!this.closed) this.log.warn(err.message);
      for (const p of this.pending.splice(0)) p.reject(err);
      if (this.child === child) this.child = null;
    });
    child.on('error', (e) => {
      for (const p of this.pending.splice(0)) p.reject(e);
    });
    // The helper must never keep the harness alive on its own; it is re-ref'd while a request is out.
    this.child = child;
    this.setRef(false);
    return child;
  }

  private setRef(on: boolean): void {
    const c = this.child;
    if (!c) return;
    const streams = [c.stdin, c.stdout] as Array<{ ref?: () => void; unref?: () => void } | null>;
    if (on) {
      c.ref();
      for (const s of streams) s?.ref?.();
    } else {
      c.unref();
      for (const s of streams) s?.unref?.();
    }
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      const p = this.pending.shift();
      if (!p) {
        this.log.warn(`procstat: unsolicited output: ${line.slice(0, 200)}`);
        continue;
      }
      try {
        p.resolve(JSON.parse(line) as Record<string, unknown>);
      } catch (e) {
        p.reject(new Error(`procstat: bad JSON for "${p.line}": ${line.slice(0, 200)}`));
      }
    }
    if (this.pending.length === 0) this.setRef(false);
  }

  /** Sends one command line; the helper answers strictly in order. Restarts a helper that died. */
  private send(line: string): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error('procstat is closed'));
    const child = this.child ?? this.start();
    return new Promise((resolve, reject) => {
      this.pending.push({ line, resolve, reject });
      this.setRef(true);
      child.stdin!.write(`${line}\n`);
    });
  }

  private static pidList(pids: readonly number[]): string {
    for (const p of pids) {
      if (!Number.isInteger(p) || p < 0) throw new Error(`invalid pid ${p}`);
    }
    return pids.join(' ');
  }

  private static check(r: Record<string, unknown>, key: string, what: string): void {
    if (!(key in r)) throw new Error(`procstat ${what}: ${String(r.error ?? JSON.stringify(r))}`);
  }

  async ping(): Promise<{ pid: number; timebase: [number, number] }> {
    const r = await this.send('ping');
    ProcStat.check(r, 'ok', 'ping');
    return { pid: r.pid as number, timebase: r.timebase as [number, number] };
  }

  async sample(pids: readonly number[]): Promise<SampleResult> {
    // Sent even for an empty set: callers still need the helper's timestamp for the point.
    const r = await this.send(pids.length ? `sample ${ProcStat.pidList(pids)}` : 'sample');
    const t = performance.now();
    ProcStat.check(r, 'procs', 'sample');
    const procs = (r.procs as ProcSample[]).map((p) => (p.ok ? p : { ...zeroSample(p.pid), ok: false, err: p.err }));
    return { t_ns: r.t_ns as number, t, procs };
  }

  /** Resets ri_interval_max_phys_footprint to the current footprint for each pid. */
  async reset(pids: readonly number[]): Promise<ResetResult> {
    if (pids.length === 0) return { ok: [], failed: [] };
    const r = await this.send(`reset ${ProcStat.pidList(pids)}`);
    ProcStat.check(r, 'ok', 'reset');
    return { ok: r.ok as number[], failed: r.failed as ResetResult['failed'] };
  }

  async children(pid: number): Promise<number[]> {
    const r = await this.send(`children ${ProcStat.pidList([pid])}`);
    ProcStat.check(r, 'children', 'children');
    return r.children as number[];
  }

  /** Responsible pid per pid (-1 when unknown). WebKit XPC services report the app that launched them. */
  async responsible(pids: readonly number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (pids.length === 0) return out;
    const r = await this.send(`resp ${ProcStat.pidList(pids)}`);
    ProcStat.check(r, 'resp', 'resp');
    for (const e of r.resp as Array<{ pid: number; responsible: number }>) out.set(e.pid, e.responsible);
    return out;
  }

  async listAll(): Promise<ProcInfo[]> {
    const r = await this.send('list');
    ProcStat.check(r, 'procs', 'list');
    return r.procs as ProcInfo[];
  }

  async paths(pids: readonly number[]): Promise<Map<number, string | null>> {
    const out = new Map<number, string | null>();
    if (pids.length === 0) return out;
    const r = await this.send(`path ${ProcStat.pidList(pids)}`);
    ProcStat.check(r, 'paths', 'path');
    for (const e of r.paths as Array<{ pid: number; path: string | null }>) out.set(e.pid, e.path);
    return out;
  }

  /**
   * Windows owned by `pids` (all owners when empty). By default only on-screen windows, which is
   * what "window visible" means for the desktop suite; `all` also returns off-screen ones.
   */
  async windows(pids: readonly number[] = [], opts: { all?: boolean } = {}): Promise<WindowInfo[]> {
    const cmd = opts.all ? 'windows-all' : 'windows';
    const r = await this.send(pids.length ? `${cmd} ${ProcStat.pidList(pids)}` : cmd);
    ProcStat.check(r, 'windows', cmd);
    if (r.error) throw new Error(`procstat ${cmd}: ${String(r.error)}`);
    return r.windows as WindowInfo[];
  }

  /** All descendants of `pid` (children, grandchildren, ...), from one consistent process table. */
  async descendants(pid: number): Promise<number[]> {
    return descendantsFromTable(await this.listAll(), pid);
  }

  /**
   * Samples `roots` plus (by default) all their descendants. Each process is attributed to the role
   * of the first root it was reached from, so a pid listed twice is counted once.
   */
  async sampleTree(roots: readonly RoleRoot[], opts: { descendants?: boolean; table?: ProcInfo[] } = {}): Promise<TreeSample> {
    const expand = opts.descendants ?? true;
    const table = expand ? (opts.table ?? (await this.listAll())) : [];
    const ppidOf = new Map<number, number>(table.map((p) => [p.pid, p.ppid]));
    const members: Array<{ pid: number; role: string; root: number }> = [];
    const seen = new Set<number>();
    for (const r of roots) {
      if (!seen.has(r.pid)) {
        seen.add(r.pid);
        members.push({ pid: r.pid, role: r.role, root: r.pid });
      }
      if (!expand) continue;
      for (const d of descendantsFromTable(table, r.pid)) {
        if (seen.has(d)) continue;
        seen.add(d);
        members.push({ pid: d, role: r.role, root: r.pid });
      }
    }
    const s = await this.sample(members.map((m) => m.pid));
    const byRole: Record<string, Agg> = {};
    for (const r of roots) byRole[r.role] ??= emptyAgg();
    const total = emptyAgg();
    const procs: TreeProc[] = [];
    const missing: TreeSample['missing'] = [];
    s.procs.forEach((p, i) => {
      const m = members[i]!;
      if (!p.ok) {
        missing.push({ pid: p.pid, role: m.role, err: p.err ?? 'unknown' });
        return;
      }
      procs.push({ ...p, role: m.role, root: m.root, ppid: ppidOf.get(p.pid) ?? null });
      addTo(byRole[m.role]!, p);
      addTo(total, p);
    });
    return { t_ns: s.t_ns, t: s.t, procs, byRole, total, missing };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const c = this.child;
    this.child = null;
    if (!c) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        c.kill('SIGKILL');
        resolve();
      }, 2000);
      c.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      c.stdin!.end('quit\n');
    });
  }
}

function zeroSample(pid: number): ProcSample {
  return {
    pid,
    ok: false,
    phys_footprint: 0,
    lifetime_max_footprint: 0,
    interval_max_footprint: 0,
    resident: 0,
    wired: 0,
    cpu_ns: 0,
    user_ns: 0,
    system_ns: 0,
    pkg_idle_wkups: 0,
    interrupt_wkups: 0,
    pageins: 0,
    diskio_read: 0,
    diskio_written: 0,
    logical_writes: 0,
    instructions: 0,
    cycles: 0,
    billed_energy_nj: 0,
    runnable_ns: 0,
    start_ns: 0,
    exit_ns: 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Time-series sampler (idle, desktop)

export interface PidPoint {
  role: string;
  name: string;
  footprint: number;
  intervalMax: number;
  lifetimeMax: number;
  resident: number;
  cpu_ns: number;
  pkg_idle_wkups: number;
  interrupt_wkups: number;
  start_ns: number;
}

export interface SamplerPoint {
  /** Seconds since the sampler's first sample (helper clock). */
  sec: number;
  t_ns: number;
  /** performance.now() when the sample arrived. */
  t: number;
  procs: Map<number, PidPoint>;
}

export type CounterName = 'cpu_ns' | 'pkg_idle_wkups' | 'interrupt_wkups';
export type GaugeName = 'footprint' | 'resident' | 'intervalMax' | 'lifetimeMax';

export interface SamplerOptions {
  intervalMs: number;
  /** Re-expand descendants at most this often (the process table walk is the costly part). */
  expandEveryMs?: number;
  descendants?: boolean;
  /** Reset interval-max footprint of the initial process set, so peakFootprint() is per window. */
  resetAtStart?: boolean;
  log?: Logger;
}

/**
 * Polls a pid-set provider on a fixed cadence (slots anchored to the start, so a slow tick does not
 * drift the rest) and keeps a per-pid time series. Processes that appear mid-window are picked up at
 * the next expansion; counters of a process that started inside the window count from zero.
 */
export class Sampler {
  readonly points: SamplerPoint[] = [];
  readonly errors: string[] = [];
  private readonly ps: ProcStat;
  private readonly provider: () => RoleRoot[] | Promise<RoleRoot[]>;
  private readonly opts: Required<Omit<SamplerOptions, 'log'>> & { log: Logger };
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inFlight: Promise<void> | null = null;
  private members: Array<{ pid: number; role: string }> = [];
  private lastExpand = -Infinity;
  private t0Ns = 0;
  private startPerf = 0;
  private tick = 0;
  /** Latest interval-max seen per pid: survives the process exiting, so a transient peak counts. */
  private readonly lastIntervalMax = new Map<number, { role: string; bytes: number }>();

  constructor(ps: ProcStat, provider: () => RoleRoot[] | Promise<RoleRoot[]>, opts: SamplerOptions) {
    this.ps = ps;
    this.provider = provider;
    this.opts = {
      intervalMs: opts.intervalMs,
      expandEveryMs: opts.expandEveryMs ?? Math.max(opts.intervalMs, 1000),
      descendants: opts.descendants ?? true,
      resetAtStart: opts.resetAtStart ?? true,
      log: opts.log ?? nullLogger,
    };
  }

  private async refreshMembers(force: boolean): Promise<void> {
    const now = performance.now();
    const roots = await this.provider();
    if (!force && now - this.lastExpand < this.opts.expandEveryMs) {
      // Keep the expanded set but make sure a changed root list is reflected immediately.
      const known = new Set(this.members.map((m) => m.pid));
      for (const r of roots) if (!known.has(r.pid)) this.members.push({ pid: r.pid, role: r.role });
      return;
    }
    this.lastExpand = now;
    const table = this.opts.descendants ? await this.ps.listAll() : [];
    const seen = new Set<number>();
    const members: Array<{ pid: number; role: string }> = [];
    for (const r of roots) {
      if (!seen.has(r.pid)) {
        seen.add(r.pid);
        members.push({ pid: r.pid, role: r.role });
      }
      if (!this.opts.descendants) continue;
      for (const d of descendantsFromTable(table, r.pid)) {
        if (seen.has(d)) continue;
        seen.add(d);
        members.push({ pid: d, role: r.role });
      }
    }
    this.members = members;
  }

  private async sampleOnce(force: boolean): Promise<void> {
    try {
      await this.refreshMembers(force);
      const s = await this.ps.sample(this.members.map((m) => m.pid));
      if (this.points.length === 0) this.t0Ns = s.t_ns;
      const procs = new Map<number, PidPoint>();
      s.procs.forEach((p, i) => {
        if (!p.ok) return;
        const role = this.members[i]!.role;
        procs.set(p.pid, {
          role,
          name: p.name ?? '',
          footprint: p.phys_footprint,
          intervalMax: p.interval_max_footprint,
          lifetimeMax: p.lifetime_max_footprint,
          resident: p.resident,
          cpu_ns: p.cpu_ns,
          pkg_idle_wkups: p.pkg_idle_wkups,
          interrupt_wkups: p.interrupt_wkups,
          start_ns: p.start_ns,
        });
        this.lastIntervalMax.set(p.pid, { role, bytes: p.interval_max_footprint });
      });
      // Drop pids that are gone so the next tick does not keep asking for them.
      this.members = this.members.filter((_, i) => s.procs[i]?.ok);
      this.points.push({ sec: (s.t_ns - this.t0Ns) / 1e9, t_ns: s.t_ns, t: s.t, procs });
    } catch (e) {
      this.errors.push((e as Error).message);
      this.opts.log.warn(`sampler tick failed: ${(e as Error).message}`);
    }
  }

  /** Takes the first sample (after the optional reset) before returning. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.refreshMembers(true);
    if (this.opts.resetAtStart) {
      const r = await this.ps.reset(this.members.map((m) => m.pid));
      for (const f of r.failed) this.errors.push(`reset ${f.pid}: ${f.err}`);
    }
    this.startPerf = performance.now();
    this.tick = 0;
    await this.sampleOnce(true);
    this.schedule();
  }

  private schedule(): void {
    if (!this.running) return;
    const interval = this.opts.intervalMs;
    const now = performance.now();
    let next = this.tick + 1;
    // A tick that overran its slot skips the missed slots instead of firing a burst.
    if (this.startPerf + next * interval < now) next = Math.floor((now - this.startPerf) / interval) + 1;
    this.tick = next;
    const delay = Math.max(0, this.startPerf + next * interval - now);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.inFlight = this.sampleOnce(false).finally(() => {
        this.inFlight = null;
        this.schedule();
      });
    }, delay);
  }

  /**
   * Starts a new peak window mid-run: resets the interval maximum of every current member and
   * forgets the peaks recorded so far, so peakFootprint() afterwards covers only what follows.
   */
  async resetPeaks(): Promise<void> {
    if (this.inFlight) await this.inFlight;
    const r = await this.ps.reset(this.members.map((m) => m.pid));
    for (const f of r.failed) this.errors.push(`reset ${f.pid}: ${f.err}`);
    this.lastIntervalMax.clear();
  }

  /** Stops polling and takes one last sample so the window ends exactly now. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.inFlight) await this.inFlight;
    await this.sampleOnce(true);
  }

  get durationSec(): number {
    return this.points.length ? this.points[this.points.length - 1]!.sec : 0;
  }

  private sumPoint(pt: SamplerPoint, metric: GaugeName, role?: string): number {
    let s = 0;
    for (const p of pt.procs.values()) if (!role || p.role === role) s += p[metric];
    return s;
  }

  roles(): string[] {
    const set = new Set<string>();
    for (const pt of this.points) for (const p of pt.procs.values()) set.add(p.role);
    return [...set].sort();
  }

  /** [sec, bytes] per point, summed over the process set (or one role). */
  series(metric: GaugeName = 'footprint', role?: string): Array<[number, number]> {
    return this.points.map((pt) => [pt.sec, this.sumPoint(pt, metric, role)]);
  }

  /** The first point at or after `sec` (the last point if `sec` is past the end). */
  pointAt(sec: number): SamplerPoint | null {
    if (!this.points.length) return null;
    return this.points.find((p) => p.sec >= sec - 1e-9) ?? this.points[this.points.length - 1]!;
  }

  valueAt(sec: number, metric: GaugeName = 'footprint', role?: string): number | null {
    const pt = this.pointAt(sec);
    return pt ? this.sumPoint(pt, metric, role) : null;
  }

  /** Time-weighted is unnecessary with fixed slots; a plain mean over points inside [from, to]. */
  mean(metric: GaugeName = 'footprint', fromSec = 0, toSec = Infinity, role?: string): number | null {
    const pts = this.points.filter((p) => p.sec >= fromSec - 1e-9 && p.sec <= toSec + 1e-9);
    if (!pts.length) return null;
    return pts.reduce((a, p) => a + this.sumPoint(p, metric, role), 0) / pts.length;
  }

  /**
   * Counter increase over [fromSec, toSec] summed over the process set. Per pid the increase is
   * last-seen minus first-seen inside the window; a process that started inside the window counts
   * from zero (its start time is known), and one that exited contributes up to its last sample.
   */
  delta(counter: CounterName, fromSec = 0, toSec = Infinity, role?: string): number {
    const pts = this.points.filter((p) => p.sec >= fromSec - 1e-9 && p.sec <= toSec + 1e-9);
    if (pts.length === 0) return 0;
    const windowStartNs = pts[0]!.t_ns;
    const first = new Map<number, PidPoint>();
    const last = new Map<number, PidPoint>();
    for (const pt of pts) {
      for (const [pid, p] of pt.procs) {
        if (role && p.role !== role) continue;
        if (!first.has(pid)) first.set(pid, p);
        last.set(pid, p);
      }
    }
    let sum = 0;
    for (const [pid, l] of last) {
      const f = first.get(pid)!;
      const bornInside = l.start_ns > windowStartNs;
      sum += bornInside ? l[counter] : l[counter] - f[counter];
    }
    return sum;
  }

  /** Counter rate per second over [fromSec, toSec]. */
  rate(counter: CounterName, fromSec = 0, toSec = Infinity, role?: string): number | null {
    const pts = this.points.filter((p) => p.sec >= fromSec - 1e-9 && p.sec <= toSec + 1e-9);
    if (pts.length < 2) return null;
    const span = pts[pts.length - 1]!.sec - pts[0]!.sec;
    if (span <= 0) return null;
    return this.delta(counter, fromSec, toSec, role) / span;
  }

  /** Average CPU as percent of one core over [fromSec, toSec]. */
  cpuPercent(fromSec = 0, toSec = Infinity, role?: string): number | null {
    const r = this.rate('cpu_ns', fromSec, toSec, role);
    return r === null ? null : (r / 1e9) * 100;
  }

  /** Idle + interrupt wakeups per second. */
  wakeupsPerSec(fromSec = 0, toSec = Infinity, role?: string): number | null {
    const a = this.rate('pkg_idle_wkups', fromSec, toSec, role);
    const b = this.rate('interrupt_wkups', fromSec, toSec, role);
    return a === null || b === null ? null : a + b;
  }

  /**
   * Sum of per-process peaks since start() (or since each process started, if later). Upper bound on
   * the simultaneous peak of the set.
   */
  peakFootprint(role?: string): number {
    let s = 0;
    for (const v of this.lastIntervalMax.values()) if (!role || v.role === role) s += v.bytes;
    return s;
  }

  /** Highest sampled simultaneous footprint (lower bound on the true simultaneous peak). */
  maxSampledFootprint(role?: string): number {
    let m = 0;
    for (const pt of this.points) m = Math.max(m, this.sumPoint(pt, 'footprint', role));
    return m;
  }
}
