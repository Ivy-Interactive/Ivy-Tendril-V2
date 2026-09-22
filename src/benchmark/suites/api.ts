// Suite 5, api: REST latency and throughput of each server, per dataset.
//
// One server per (dataset, app), and only one app process alive at any time: a second, idle server
// would run its own background work (V1's 30 s full rescan and +15 s pricing fetch, V2's watcher
// catch-up passes) inside the other app's measurement windows. Drift between the two apps is instead
// balanced by alternating which app goes first on each dataset (v1 first on the 1st, 3rd, ...
// dataset; v2 first on the 2nd, 4th, ...), and every phase records the machine load.
//
// Per server, in this order:
//   1. settle: wait until SETTLE_AFTER_SPAWN_MS after spawn, so V1's one-off +5 s and +15 s startup
//      tasks are not inside the samples;
//   2. sequential reads: `seqWarmup` discarded then `seqSamples` timed rounds, each round one request
//      per read scenario, on one keep-alive connection (latency = request start to last body byte);
//   3. closed-loop load for plans.list and plans.get at each concurrency level (warmup, then a timed
//      window with the server tree's footprint interval reset before and read after);
//   4. sequential writes (plans.update), last, so the rescans a write can trigger never land in a
//      read measurement.
//
// The load generator runs in worker threads (one Node event loop tops out well below what V2 can
// serve at c=32 on 16 cores). Each thread reports its own CPU time and event-loop utilisation, so a
// run where the client rather than the server was the limit is flagged in the result.

import fs from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { API_SCENARIOS, type ApiScenario, type AppAdapter, type ServerHandle } from '../apps/types.ts';
import type { DatasetName } from '../lib/config.ts';
import { loadManifest, restoreHome, type DatasetManifest } from '../datasets/index.ts';
import { createAgent, joinUrl, request, type RequestSpec } from '../lib/http.ts';
import { errorMessage, type Logger } from '../lib/log.ts';
import { isAlive, sleep } from '../lib/proc.ts';
import { toMiB, type TreeSample } from '../lib/procstat.ts';
import { newSuiteResult, type AppId, type Metric, type SuiteResult } from '../lib/results.ts';
import { median, quantile, systematicSubsample } from '../lib/stats.ts';
import type { SuiteContext } from './index.ts';

const SUITE = 'api';

/** Scenarios that also get closed-loop load runs. */
const LOAD_SCENARIOS: readonly ApiScenario[] = ['plans.list', 'plans.get'];

/** Which manifest id a scenario needs (none of them exist on `empty`, where both apps answer 404). */
const NEEDS_ID: Partial<Record<ApiScenario, 'getPlanId' | 'updatePlanId' | 'jobId'>> = {
  'plans.get': 'getPlanId',
  'plans.update': 'updatePlanId',
  'jobs.get': 'jobId',
};

/** Read scenarios whose payload is big enough on both apps for "ms per KB" to mean anything. */
const PER_KB_SCENARIOS: ReadonlySet<ApiScenario> = new Set(['plans.list', 'plans.filter', 'plans.get']);

/**
 * V1 runs a PR status sync at +5 s and a models.dev pricing fetch plus SQLite writes at +15 s after
 * start (research v1-run section 2). Measuring from here keeps both out of the samples. The +60 s
 * cost backfill and both apps' 30 s rescans still fall inside: they are what a running server does.
 */
const SETTLE_AFTER_SPAWN_MS = 16_000;

/** Pause between phases so one phase's tail (keep-alive teardown, GC) does not open the next. */
const PHASE_PAUSE_MS = 250;

/**
 * At most this many load-generator threads (TENDRIL_BENCH_API_CLIENT_THREADS overrides): half the
 * logical cores, capped at 8. An idle thread costs nothing, so spare threads are only headroom; a
 * busy one costs the same CPU per request however the connections are spread. Every thread's CPU
 * and event-loop utilisation is recorded, so saturation is visible rather than assumed away.
 */
const CLIENT_THREADS_MAX = (() => {
  const env = Number(process.env.TENDRIL_BENCH_API_CLIENT_THREADS);
  if (Number.isInteger(env) && env >= 1 && env <= 64) return env;
  return Math.max(1, Math.min(8, Math.floor(os.availableParallelism() / 2)));
})();

/** A client thread above this event-loop utilisation (or CPU share of its wall time) is the limit. */
const SATURATED = 0.9;

/**
 * Below this ratio of on-CPU time to event-loop active time, the client threads were runnable but
 * waiting for a core: the machine was contended, and throughput says as much about the other
 * processes as about the server. Observed: about 0.45 at a 1-min load of 27, 0.05 to 0.15 at 170.
 */
const ON_CPU_MIN = 0.25;

// ---------------------------------------------------------------------------------------------
// Load worker (runs when this module is loaded as a worker thread)

interface LoadWorkerData {
  kind: 'api-load-worker';
  specs: RequestSpec[];
  sockets: number;
  timeoutMs: number;
}

type ToWorker = { cmd: 'run'; ms: number } | { cmd: 'close' };

/** One thread's view of one timed window. Times are epoch ms (performance.timeOrigin + now). */
interface WindowResult {
  type: 'window';
  ok: number;
  errors: number;
  statuses: Record<string, number>;
  errorSamples: string[];
  /** 2xx only: latency and end time of each response, in completion order. */
  lat: Float64Array;
  ends: Float64Array;
  okBytes: number;
  first: number;
  last: number;
  elu: number;
  cpuS: number;
  wallMs: number;
}

type FromWorker = { type: 'ready' } | WindowResult | { type: 'fatal'; message: string };

async function loadWindow(d: LoadWorkerData, agent: ReturnType<typeof createAgent>, ms: number): Promise<WindowResult> {
  const origin = performance.timeOrigin;
  const lat: number[] = [];
  const ends: number[] = [];
  const statuses: Record<string, number> = {};
  const errorSamples: string[] = [];
  let ok = 0;
  let errors = 0;
  let okBytes = 0;
  let first = Infinity;
  let last = 0;
  let seq = 0;
  const elu0 = performance.eventLoopUtilization();
  const cpu0 = process.threadCpuUsage();
  const t0 = performance.now();
  const deadline = t0 + ms;
  const loop = async () => {
    while (performance.now() < deadline) {
      const spec = d.specs[seq++ % d.specs.length]!;
      const r = await request({ ...spec, agent, timeoutMs: d.timeoutMs });
      first = Math.min(first, r.start);
      last = Math.max(last, r.end);
      const key = r.status ? String(r.status) : 'error';
      statuses[key] = (statuses[key] ?? 0) + 1;
      if (r.status >= 200 && r.status < 300) {
        ok++;
        okBytes += r.bytes;
        lat.push(r.ms);
        ends.push(origin + r.end);
      } else {
        errors++;
        if (errorSamples.length < 10) errorSamples.push(r.status ? `HTTP ${r.status}` : (r.error ?? 'error'));
      }
    }
  };
  await Promise.all(Array.from({ length: d.sockets }, loop));
  const wallMs = performance.now() - t0;
  const cpu = process.threadCpuUsage(cpu0);
  return {
    type: 'window',
    ok,
    errors,
    statuses,
    errorSamples,
    lat: Float64Array.from(lat),
    ends: Float64Array.from(ends),
    okBytes,
    first: Number.isFinite(first) ? origin + first : 0,
    last: last ? origin + last : 0,
    elu: performance.eventLoopUtilization(elu0).utilization,
    cpuS: (cpu.user + cpu.system) / 1e6,
    wallMs,
  };
}

function workerMain(d: LoadWorkerData): void {
  const port = parentPort!;
  const agent = createAgent({ maxSockets: d.sockets });
  port.on('message', (m: ToWorker) => {
    if (m.cmd === 'close') {
      agent.destroy();
      port.close();
      return;
    }
    loadWindow(d, agent, m.ms).then(
      (r) => port.postMessage(r, [r.lat.buffer as ArrayBuffer, r.ends.buffer as ArrayBuffer]),
      (e: unknown) => port.postMessage({ type: 'fatal', message: errorMessage(e) } satisfies FromWorker),
    );
  });
  port.postMessage({ type: 'ready' } satisfies FromWorker);
}

if (!isMainThread && (workerData as Partial<LoadWorkerData> | null)?.kind === 'api-load-worker') workerMain(workerData as LoadWorkerData);

// ---------------------------------------------------------------------------------------------
// Worker pool (main thread)

function nextMessage(w: Worker): Promise<FromWorker> {
  return new Promise((resolve, reject) => {
    const onMessage = (m: FromWorker) => {
      cleanup();
      if (m.type === 'fatal') reject(new Error(`load worker: ${m.message}`));
      else resolve(m);
    };
    const onError = (e: Error) => {
      cleanup();
      reject(e);
    };
    const onExit = (code: number) => {
      cleanup();
      reject(new Error(`load worker exited with code ${code}`));
    };
    const cleanup = () => {
      w.off('message', onMessage);
      w.off('error', onError);
      w.off('exit', onExit);
    };
    w.on('message', onMessage);
    w.on('error', onError);
    w.on('exit', onExit);
  });
}

interface LoadPool {
  threads: number;
  socketsPerThread: number[];
  run(ms: number): Promise<WindowResult[]>;
  close(): Promise<void>;
}

/** `concurrency` keep-alive connections spread over up to CLIENT_THREADS_MAX threads. */
async function startPool(specs: RequestSpec[], concurrency: number, timeoutMs: number): Promise<LoadPool> {
  const threads = Math.min(concurrency, CLIENT_THREADS_MAX);
  const socketsPerThread = Array.from({ length: threads }, (_, t) => Math.floor(concurrency / threads) + (t < concurrency % threads ? 1 : 0));
  const workers: Worker[] = [];
  // Ask each thread to close its keep-alive sockets first so the server sees orderly FINs rather
  // than resets; terminate whatever has not exited a second later.
  const close = async () => {
    await Promise.all(
      workers.map(async (w) => {
        const exited = new Promise<void>((r) => w.once('exit', () => r()));
        try {
          w.postMessage({ cmd: 'close' } satisfies ToWorker);
        } catch {
          // already gone
        }
        await Promise.race([exited, sleep(1000)]);
        await w.terminate().catch(() => 0);
      }),
    );
  };
  try {
    for (const sockets of socketsPerThread) {
      const data: LoadWorkerData = { kind: 'api-load-worker', specs, sockets, timeoutMs };
      const w = new Worker(new URL(import.meta.url), { workerData: data });
      workers.push(w);
    }
    await Promise.all(workers.map(nextMessage));
  } catch (e) {
    await close();
    throw e;
  }
  return {
    threads,
    socketsPerThread,
    async run(ms: number) {
      const replies = workers.map(nextMessage);
      for (const w of workers) w.postMessage({ cmd: 'run', ms } satisfies ToWorker);
      return (await Promise.all(replies)) as WindowResult[];
    },
    close,
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers

function round(x: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

function latencySummary(xs: readonly number[]): Record<string, number> {
  if (!xs.length) return { n: 0 };
  let max = -Infinity;
  for (const x of xs) if (x > max) max = x;
  return { n: xs.length, median: round(median(xs)), p90: round(quantile(xs, 0.9)), p99: round(quantile(xs, 0.99)), max: round(max) };
}

function statusText(statuses: Record<string, number>): string {
  return Object.entries(statuses)
    .map(([k, n]) => `${k === 'error' ? 'no response' : `HTTP ${k}`} x${n}`)
    .join(', ');
}

interface Target {
  app: AppAdapter;
  server: ServerHandle;
  dataset: DatasetName;
  manifest: DatasetManifest;
  log: Logger;
}

function requestFor(t: Target, scenario: ApiScenario, i: number): RequestSpec & { path: string } {
  const planId = (scenario === 'plans.update' ? t.manifest.ids.updatePlanId : t.manifest.ids.getPlanId) ?? '';
  const r = t.app.api[scenario]({ planId, jobId: t.manifest.ids.jobId ?? '', i });
  return { method: r.method, url: joinUrl(t.server.baseUrl, r.path), headers: t.server.authHeaders(), body: r.body, path: r.path };
}

function assertServerAlive(t: Target): void {
  if (!isAlive(t.server.pid)) throw new Error(`${t.app.id} server (pid ${t.server.pid}) is no longer running; see ${t.server.logs.stdout}`);
}

// ---------------------------------------------------------------------------------------------
// Sequential latency

interface SeqAcc {
  lat: number[];
  ttfb: number[];
  bytes: number[];
  statuses: Record<string, number>;
  warmupStatuses: Record<string, number>;
  errorSamples: string[];
  method: string;
  path: string;
}

/**
 * Sequential requests on one keep-alive connection, round-robin over `scenarios` (A B C A B C ...):
 * each scenario's samples then span the whole phase, so a transient (a rescan, another process's
 * burst) spreads over all of them instead of landing on whichever scenario happened to be running.
 * Round `i` is the iteration index passed to the request builder (plans.update alternates on it).
 */
async function sequential(ctx: SuiteContext, result: SuiteResult, t: Target, scenarios: readonly ApiScenario[]): Promise<void> {
  const { seqWarmup, seqSamples } = ctx.knobs.api;
  const accs = new Map<ApiScenario, SeqAcc>(scenarios.map((sc) => [sc, { lat: [], ttfb: [], bytes: [], statuses: {}, warmupStatuses: {}, errorSamples: [], method: '', path: '' }]));
  const agent = createAgent({ maxSockets: 1 });
  try {
    for (let i = 0; i < seqWarmup + seqSamples; i++) {
      for (const scenario of scenarios) {
        const acc = accs.get(scenario)!;
        const spec = requestFor(t, scenario, i);
        acc.method = spec.method ?? 'GET';
        acc.path = spec.path;
        const r = await request({ ...spec, agent });
        const key = r.status ? String(r.status) : 'error';
        if (i < seqWarmup) {
          acc.warmupStatuses[key] = (acc.warmupStatuses[key] ?? 0) + 1;
          continue;
        }
        acc.statuses[key] = (acc.statuses[key] ?? 0) + 1;
        if (r.status >= 200 && r.status < 300) {
          acc.lat.push(r.ms);
          acc.ttfb.push(r.ttfbMs);
          acc.bytes.push(r.bytes);
        } else if (acc.errorSamples.length < 5) {
          acc.errorSamples.push(r.status ? `HTTP ${r.status}` : (r.error ?? 'error'));
        }
      }
    }
  } finally {
    agent.destroy();
  }
  for (const [scenario, acc] of accs) emitSequential(ctx, result, t, scenario, acc, scenarios.length);
}

function emitSequential(ctx: SuiteContext, result: SuiteResult, t: Target, scenario: ApiScenario, acc: SeqAcc, mixed: number): void {
  const { seqWarmup, seqSamples } = ctx.knobs.api;
  const { lat, ttfb, bytes, statuses, warmupStatuses, errorSamples, method, path: reqPath } = acc;
  const errors = seqSamples - lat.length;
  if (errors) {
    result.failures.push({ app: t.app.id, dataset: t.dataset, scenario, error: `${errors}/${seqSamples} sequential requests to ${method} ${reqPath} were not 2xx (${statusText(statuses)}); first: ${errorSamples.join('; ')}` });
  }
  const warmErrors = Object.entries(warmupStatuses).filter(([k]) => !/^2\d\d$/.test(k));
  if (warmErrors.length) result.notes.push(`${t.app.id}/${t.dataset} ${scenario}: warmup responses ${statusText(warmupStatuses)}`);
  if (!lat.length) return;

  const responseBytes = median(bytes);
  const base = { method, path: reqPath, warmup: seqWarmup, requested: seqSamples, ok: lat.length, errors, statuses, roundRobinWith: mixed - 1 };
  const push = (m: Omit<Metric, 'suite' | 'app' | 'dataset' | 'scenario'>) => result.metrics.push({ suite: SUITE, scenario, app: t.app.id, dataset: t.dataset, ...m });
  push({
    metric: 'latency_ms',
    unit: 'ms',
    samples: lat,
    better: 'lower',
    meta: {
      ...base,
      responseBytes,
      responseBytesMin: Math.min(...bytes),
      responseBytesMax: Math.max(...bytes),
      ttfbMedianMs: round(median(ttfb)),
      note: `request start to last body byte, one keep-alive connection, uncompressed${mixed > 1 ? `; issued round-robin with ${mixed - 1} other read scenario(s)` : ''}`,
    },
  });
  push({
    metric: 'ttfb_ms',
    unit: 'ms',
    samples: ttfb,
    better: 'lower',
    meta: { ...base, payloadBytes: responseBytes, note: 'request start to response headers; the rest of latency_ms is body transfer and parsing on the client' },
  });
  if (PER_KB_SCENARIOS.has(scenario) && t.manifest.counts.plans > 0 && bytes.every((b) => b > 0)) {
    push({
      metric: 'latency_ms_per_kb',
      unit: 'ms',
      samples: lat.map((ms, k) => ms / (bytes[k]! / 1000)),
      better: 'lower',
      meta: {
        ...base,
        payloadBytes: responseBytes,
        derived: 'latency_ms / (response bytes / 1000), per request',
        note: 'normalises for the payload asymmetry (V2 returns full plan objects, V1 thin summaries); latency has a fixed per-request floor, so this favours the larger payload and is context, not a like-for-like result',
      },
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Closed-loop load

interface LoadOutcome {
  concurrency: number;
  okRps: number;
  maxElu: number;
  clientCores: number;
}

function mergeByEnd(parts: WindowResult[]): number[] {
  const n = parts.reduce((s, p) => s + p.lat.length, 0);
  const ends = new Float64Array(n);
  const lat = new Float64Array(n);
  let k = 0;
  for (const p of parts) {
    ends.set(p.ends, k);
    lat.set(p.lat, k);
    k += p.lat.length;
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => ends[a]! - ends[b]! || a - b);
  return idx.map((i) => lat[i]!);
}

/** Footprint peak and CPU of the server tree between two samples (reset taken before `before`). */
function serverWindow(before: TreeSample, after: TreeSample, resetOk: ReadonlySet<number>) {
  const prev = new Map(before.procs.map((p) => [p.pid, p]));
  let peak = 0;
  let cpuNs = 0;
  let bornInside = 0;
  for (const p of after.procs) {
    const b = prev.get(p.pid);
    const same = b !== undefined && b.start_ns === p.start_ns;
    // A process that was not reset (born inside the window) has only its lifetime maximum.
    peak += same && resetOk.has(p.pid) ? p.interval_max_footprint : p.lifetime_max_footprint;
    cpuNs += same ? p.cpu_ns - b.cpu_ns : p.cpu_ns;
    if (!same) bornInside++;
  }
  const exited = before.procs.filter((b) => !after.procs.some((p) => p.pid === b.pid && p.start_ns === b.start_ns)).length;
  return { peakBytes: peak, cpuS: cpuNs / 1e9, procs: after.procs.length, bornInside, exited };
}

async function loadRun(ctx: SuiteContext, result: SuiteResult, t: Target, scenario: ApiScenario, concurrency: number): Promise<LoadOutcome | null> {
  const { concurrencyDurationSec, maxLatencySamples } = ctx.knobs.api;
  const durationMs = concurrencyDurationSec * 1000;
  const warmupMs = Math.min(2000, Math.max(500, durationMs / 4));
  const name = `${scenario}@c${concurrency}`;
  const { path: reqPath, ...spec } = requestFor(t, scenario, 0);
  const pool = await startPool([spec], concurrency, 60_000);
  try {
    await pool.run(warmupMs);
    assertServerAlive(t);

    const pids = await t.server.pids();
    const reset = await ctx.procstat.reset(pids);
    const before = await ctx.procstat.sampleTree([{ role: 'server', pid: t.server.pid }]);
    const load0 = os.loadavg()[0]!;
    const cpu0 = process.cpuUsage();
    const wall0 = performance.now();
    const parts = await pool.run(durationMs);
    const wallMs = performance.now() - wall0;
    const cpu = process.cpuUsage(cpu0);
    const after = await ctx.procstat.sampleTree([{ role: 'server', pid: t.server.pid }]);

    const ok = parts.reduce((s, p) => s + p.ok, 0);
    const errors = parts.reduce((s, p) => s + p.errors, 0);
    const total = ok + errors;
    const statuses: Record<string, number> = {};
    for (const p of parts) for (const [k, n] of Object.entries(p.statuses)) statuses[k] = (statuses[k] ?? 0) + n;
    const errorSamples = parts.flatMap((p) => p.errorSamples).slice(0, 10);
    const first = Math.min(...parts.filter((p) => p.first).map((p) => p.first));
    const last = Math.max(...parts.map((p) => p.last));
    const elapsedMs = Number.isFinite(first) && last > first ? last - first : 0;
    if (errors) {
      result.failures.push({ app: t.app.id, dataset: t.dataset, scenario: name, error: `${errors}/${total} requests to ${spec.method} ${reqPath} at c=${concurrency} were not 2xx (${statusText(statuses)}); first: ${errorSamples.join('; ')}` });
    }
    if (!total || !elapsedMs) {
      result.failures.push({ app: t.app.id, dataset: t.dataset, scenario: name, error: `no request completed in the ${concurrencyDurationSec} s window` });
      return null;
    }

    const all = mergeByEnd(parts);
    const okRps = ok / (elapsedMs / 1000);
    const srv = serverWindow(before, after, new Set(reset.ok));
    const clientCpuS = (cpu.user + cpu.system) / 1e6;
    const threads = parts.map((p) => ({ cpuCores: round(p.cpuS / (p.wallMs / 1000)), elu: round(p.elu) }));
    const maxElu = Math.max(...threads.map((x) => x.elu));
    const maxThreadCores = Math.max(...threads.map((x) => x.cpuCores));
    // ELU counts wall time inside callbacks, including time a runnable thread waits for a core, so
    // compare it with the thread's own CPU time to tell a busy client from a starved one.
    const eluSum = threads.reduce((s, x) => s + x.elu, 0);
    const onCpuShare = eluSum > 0 ? round(threads.reduce((s, x) => s + x.cpuCores, 0) / eluSum) : 1;
    const contended = maxElu > 0.3 && onCpuShare < ON_CPU_MIN;
    const limit: 'none' | 'saturated' | 'starved' = maxThreadCores > SATURATED ? 'saturated' : maxElu > SATURATED ? (contended ? 'starved' : 'saturated') : 'none';
    const client = {
      threads: pool.threads,
      socketsPerThread: pool.socketsPerThread,
      cpuS: round(clientCpuS),
      cpuCores: round(clientCpuS / (wallMs / 1000)),
      perThread: threads,
      onCpuShare,
      limit,
      note: 'harness process CPU (all load threads) over the timed window. limit: saturated = a thread used about a whole core or its event loop never idled (client-bound); starved = its event loop never idled but it was mostly off CPU (machine contention)',
    };
    const meta = {
      concurrency,
      method: spec.method,
      path: reqPath,
      durationSec: round(elapsedMs / 1000),
      targetDurationSec: concurrencyDurationSec,
      warmupSec: warmupMs / 1000,
      requests: ok,
      completed: total,
      responseBytes: ok ? Math.round(parts.reduce((s, p) => s + p.okBytes, 0) / ok) : 0,
      loadavg1: round(load0, 2),
    };
    const push = (m: Omit<Metric, 'suite' | 'app' | 'dataset' | 'scenario'>) => result.metrics.push({ suite: SUITE, scenario: name, app: t.app.id, dataset: t.dataset, ...m });

    if (ok) push({ metric: 'throughput_rps', unit: 'req/s', samples: [okRps], better: 'higher', meta: { ...meta, allRps: round(total / (elapsedMs / 1000), 1), client } });
    if (all.length) {
      const capped = systematicSubsample(all, maxLatencySamples);
      push({
        metric: 'latency_ms',
        unit: 'ms',
        samples: capped,
        better: 'lower',
        meta: { ...meta, all: latencySummary(all), subsampled: capped.length < all.length ? `systematic, ${capped.length} of ${all.length} in completion order` : false },
      });
    }
    push({ metric: 'error_rate', unit: 'percent', samples: [(errors / total) * 100], better: 'lower', meta: { ...meta, errors, statuses, errorSamples } });
    push({
      metric: 'server_peak_footprint_mib',
      unit: 'MiB',
      samples: [toMiB(srv.peakBytes)],
      better: 'lower',
      meta: {
        ...meta,
        footprintBeforeMiB: round(toMiB(before.total.footprint), 2),
        footprintAfterMiB: round(toMiB(after.total.footprint), 2),
        procs: srv.procs,
        bornInside: srv.bornInside,
        exitedInside: srv.exited,
        resetFailed: reset.failed,
        note: 'sum of per-process interval maxima after a reset at window start (upper bound on the simultaneous peak)',
      },
    });
    push({ metric: 'server_cpu_s', unit: 'cpu_s', samples: [srv.cpuS], better: 'lower', meta: { ...meta, serverCores: round(srv.cpuS / (elapsedMs / 1000)), exitedInside: srv.exited } });
    if (srv.exited) result.notes.push(`${t.app.id}/${t.dataset} ${name}: ${srv.exited} server process(es) exited inside the window; their CPU after the first sample is not counted`);
    const clientDesc = `max event-loop utilisation ${maxElu.toFixed(2)}, max thread CPU ${maxThreadCores.toFixed(2)} cores, on-CPU share ${onCpuShare.toFixed(2)}, ${pool.threads} thread(s)`;
    if (limit === 'saturated') result.notes.push(`${t.app.id}/${t.dataset} ${name}: a load-generator thread was saturated (${clientDesc}); throughput may be client-bound`);
    else if (contended) result.notes.push(`${t.app.id}/${t.dataset} ${name}: load-generator threads were mostly off CPU while active (${clientDesc}); the machine was contended (1-min load ${load0.toFixed(1)}), so throughput and latency include client scheduling delay`);
    t.log.info(
      `${name}: ${okRps.toFixed(0)} req/s, p50 ${median(all).toFixed(2)} ms, errors ${errors}, server peak ${toMiB(srv.peakBytes).toFixed(1)} MiB, server CPU ${srv.cpuS.toFixed(2)} s, client ${client.cpuCores.toFixed(2)} cores (max ELU ${maxElu.toFixed(2)})`,
    );
    return { concurrency, okRps, maxElu, clientCores: client.cpuCores };
  } finally {
    await pool.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Per server

async function runServer(ctx: SuiteContext, result: SuiteResult, app: AppAdapter, dataset: DatasetName, manifest: DatasetManifest, skipped: ReadonlySet<ApiScenario>): Promise<void> {
  const log = ctx.log.child(`${app.id}-${dataset}`);
  const restored = await restoreHome({ paths: ctx.paths, dataset, app: app.id, runDir: ctx.runDir, suffix: SUITE, log });
  let server: ServerHandle | null = null;
  try {
    server = await app.startServer({ home: restored.home, runDir: ctx.runDir, mode: 'web' });
    const t: Target = { app, server, dataset, manifest, log };
    const settleMs = Math.max(0, server.timings.spawnAt + SETTLE_AFTER_SPAWN_MS - performance.now());
    log.info(`server pid ${server.pid} ready (http ${server.timings.httpReadyMs.toFixed(0)} ms, data ${server.timings.dataReadyMs.toFixed(0)} ms); settling ${(settleMs / 1000).toFixed(1)} s`);
    result.notes.push(
      `${app.id}/${dataset}: server ${String(server.meta?.bin ?? app.cli.bin)} (pid ${server.pid}) http-ready ${server.timings.httpReadyMs.toFixed(0)} ms, data-ready ${server.timings.dataReadyMs.toFixed(0)} ms; measurements start ${SETTLE_AFTER_SPAWN_MS / 1000} s after spawn`,
    );
    await sleep(settleMs);

    const reads = API_SCENARIOS.filter((s) => s !== 'plans.update' && !skipped.has(s));
    assertServerAlive(t);
    try {
      await sequential(ctx, result, t, reads);
    } catch (e) {
      for (const scenario of reads) result.failures.push({ app: app.id, dataset, scenario, error: errorMessage(e) });
    }
    await sleep(PHASE_PAUSE_MS);

    for (const scenario of LOAD_SCENARIOS) {
      if (skipped.has(scenario)) continue;
      const outcomes: LoadOutcome[] = [];
      for (const c of ctx.knobs.api.concurrency) {
        assertServerAlive(t);
        try {
          const o = await loadRun(ctx, result, t, scenario, c);
          if (o) outcomes.push(o);
        } catch (e) {
          result.failures.push({ app: app.id, dataset, scenario: `${scenario}@c${c}`, error: errorMessage(e) });
        }
        await sleep(PHASE_PAUSE_MS);
      }
      if (outcomes.length > 1) {
        const steps = outcomes.slice(1).map((o, k) => `c${outcomes[k]!.concurrency}->c${o.concurrency} x${(o.okRps / outcomes[k]!.okRps).toFixed(2)}`);
        result.notes.push(
          `${app.id}/${dataset} ${scenario} throughput scaling: ${outcomes.map((o) => `c${o.concurrency} ${o.okRps.toFixed(0)} req/s (client ${o.clientCores.toFixed(2)} cores, max ELU ${o.maxElu.toFixed(2)})`).join('; ')}; ${steps.join(', ')}`,
        );
      }
    }

    if (!skipped.has('plans.update')) {
      assertServerAlive(t);
      try {
        await sequential(ctx, result, t, ['plans.update']);
      } catch (e) {
        result.failures.push({ app: app.id, dataset, scenario: 'plans.update', error: errorMessage(e) });
      }
    }
  } finally {
    if (server) await server.stop();
    fs.rmSync(restored.home, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Entry

export async function run(ctx: SuiteContext): Promise<SuiteResult> {
  const result = newSuiteResult(SUITE, ctx.runId, ctx.profile);
  const k = ctx.knobs.api;
  result.notes.push(
    `app order alternates per dataset (${ctx.datasets.map((d, i) => `${d}: ${(i % 2 === 0 ? ctx.apps : [...ctx.apps].reverse()).map((a) => a.id).join(' then ')}`).join('; ')}); only one server runs at a time, so no idle peer's background work lands in a measurement`,
    `per server: settle until ${SETTLE_AFTER_SPAWN_MS / 1000} s after spawn, sequential reads round-robin across scenarios (${k.seqWarmup} warmup + ${k.seqSamples} timed per scenario), closed-loop load for ${LOAD_SCENARIOS.join(', ')} at c=${k.concurrency.join(', ')} (${k.concurrencyDurationSec} s each after a short warmup), then sequential plans.update writes last`,
    `load generator: up to ${CLIENT_THREADS_MAX} worker thread(s) (${os.availableParallelism()} logical cores), keep-alive connections split across them; per-thread CPU and event-loop utilisation are in throughput_rps meta.client (limit: none, saturated or starved)`,
    'payloads differ: V2 plans.list/plans.filter/plans.get return full PlanFile objects (including latest revision text), V1 returns thin summaries; response bytes are in meta.responseBytes, and latency_ms_per_kb is a derived normalisation shown for context only',
  );

  for (const [di, dataset] of ctx.datasets.entries()) {
    const manifest = loadManifest(ctx.paths, dataset);
    if (!manifest) {
      for (const app of ctx.apps) result.failures.push({ app: app.id, dataset, scenario: '(dataset)', error: `dataset ${dataset} is not built: run \`node src/benchmark/bin/tendril-bench.ts datasets\`` });
      continue;
    }
    const skipped = new Set<ApiScenario>();
    for (const [scenario, key] of Object.entries(NEEDS_ID) as Array<[ApiScenario, 'getPlanId' | 'updatePlanId' | 'jobId']>) {
      if (!manifest.ids[key]) skipped.add(scenario);
    }
    if (skipped.size) {
      result.notes.push(`${dataset}: skipped ${[...skipped].join(', ')} on both apps: the dataset has no ${[...new Set([...skipped].map((s) => NEEDS_ID[s]))].join('/')} (both apps would answer 404)`);
    }
    const order = di % 2 === 0 ? ctx.apps : [...ctx.apps].reverse();
    for (const app of order) {
      ctx.log.info(`dataset ${dataset}: ${app.id}`);
      try {
        await runServer(ctx, result, app, dataset, manifest, skipped);
      } catch (e) {
        ctx.log.warn(`${app.id}/${dataset} failed: ${errorMessage(e)}`);
        result.failures.push({ app: app.id as AppId, dataset, scenario: '(server)', error: errorMessage(e) });
      }
    }
  }
  return result;
}
