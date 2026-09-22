// Suite 3, startup: server start to ready, per dataset and app, interleaved ABBA.
//
//   first-start  a freshly restored template home (page cache warmed by restoreHome, so this is
//                "first start on a new home", not a cold disk): both apps parse every plan, V1
//                deploys its promptwares, V2 registers its file watches.
//   warm-start   restart on a home the same app has already synced (one unmeasured start/stop
//                first), which is what every later launch of a real install looks like.
//
// Readiness comes from the adapters (polled every READY_POLL_MS): V1 has two signals, HTTP
// (/api/ping 200) and data (the "Initial sync complete" log line), and the sync line can come first,
// so `usable_ms` = max(http, data) is the moment both hold. V2's /api/health only answers once its
// reconcile has finished, so its three readiness numbers are one.
//
// Memory and CPU up to ready come from a Sampler polling every child of this harness (except the
// procstat helper) and their descendants every SAMPLE_MS while the adapter starts the server. The
// adapter spawns the server itself and only returns its pid once it is ready, so the sampler cannot
// be pointed at it up front; each root is tagged with its own pid and the server's tree is picked
// out afterwards. Children shorter-lived than one tick (V1's `which`, parts of its login-shell
// probe) can be missed; the rest are included, as they are part of what a start costs.

import { performance } from 'node:perf_hooks';
import { TIMEOUTS, type DatasetName } from '../lib/config.ts';
import { errorMessage, type Logger } from '../lib/log.ts';
import { Sampler, type ProcStat } from '../lib/procstat.ts';
import { newSuiteResult, type AppId, type SuiteResult } from '../lib/results.ts';
import type { AppAdapter, ServerHandle } from '../apps/types.ts';
import { restoreHome } from '../datasets/index.ts';
import type { SuiteContext } from './index.ts';
import { checkCliLinks, cliLinkState, isTimeout, Recorder, round, toMiB } from './csi-shared.ts';

/** Sampling cadence while a server starts (resolution of footprint/CPU "at ready"). */
const SAMPLE_MS = 100;

/** V2 startup phases the adapter reads from the daemon's log (see apps/v2.ts STDERR_MARKERS). */
const V2_PHASES: Array<[key: string, metric: string]> = [
  ['boundMs', 'phase_bound_ms'],
  ['watcherRegistered', 'phase_watcher_registered_ms'],
  ['plansSynced', 'phase_plans_synced_ms'],
  ['recommendationsRebuilt', 'phase_recommendations_rebuilt_ms'],
];

interface StartMeasure {
  httpMs: number;
  dataMs: number;
  usableMs: number;
  footprintAtReady: number;
  peakToReady: number;
  cpuToReadyS: number;
  /** How long after the ready moment the sample used for "at ready" was taken. */
  sampleLagMs: number;
  processes: number;
  processNames: string[];
  phases: Record<string, number>;
  serverMeta: Record<string, unknown>;
}

function phaseMs(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && typeof (v as { ms?: unknown }).ms === 'number') return (v as { ms: number }).ms;
  return null;
}

/** Starts the server with the sampler running and reduces the samples to the moment of readiness. */
async function measuredStart(ps: ProcStat, app: AppAdapter, home: string, runDir: string, log: Logger): Promise<{ m: StartMeasure; server: ServerHandle }> {
  const sampler = new Sampler(
    ps,
    async () => (await ps.children(process.pid)).filter((p) => p !== ps.helperPid).map((pid) => ({ role: String(pid), pid })),
    { intervalMs: SAMPLE_MS, expandEveryMs: SAMPLE_MS, resetAtStart: false, log },
  );
  await sampler.start();
  let server: ServerHandle;
  try {
    server = await app.startServer({ home, runDir, mode: 'web' });
  } finally {
    await sampler.stop();
  }
  try {
    const role = String(server.pid);
    const httpMs = server.timings.httpReadyMs;
    const dataMs = server.timings.dataReadyMs;
    const usableMs = Math.max(httpMs, dataMs);
    const readyT = server.timings.spawnAt + usableMs;
    const pts = sampler.points;
    let idx = pts.findIndex((p) => p.t >= readyT && [...p.procs.values()].some((q) => q.role === role));
    if (idx < 0) idx = pts.length - 1;
    const at = pts[idx];
    if (!at || ![...at.procs.values()].some((q) => q.role === role)) {
      throw new Error(`the sampler never saw server pid ${server.pid} (${sampler.errors.slice(0, 3).join('; ') || 'no errors'})`);
    }
    let footprint = 0;
    for (const q of at.procs.values()) if (q.role === role) footprint += q.footprint;
    const peakByPid = new Map<number, number>();
    const names = new Set<string>();
    for (const p of pts.slice(0, idx + 1)) {
      for (const [pid, q] of p.procs) {
        if (q.role !== role) continue;
        peakByPid.set(pid, Math.max(peakByPid.get(pid) ?? 0, q.lifetimeMax));
        if (q.name) names.add(q.name);
      }
    }
    const peak = [...peakByPid.values()].reduce((a, b) => a + b, 0);
    const cpuNs = sampler.delta('cpu_ns', 0, at.sec, role);
    const phases: Record<string, number> = {};
    const rawPhases = (server.meta?.phases ?? {}) as Record<string, unknown>;
    for (const [k] of V2_PHASES) {
      const v = phaseMs(rawPhases[k]);
      if (v !== null) phases[k] = v;
    }
    const others = new Set<string>();
    for (const p of pts) for (const q of p.procs.values()) if (q.role !== role) others.add(q.role);
    if (others.size) log.warn(`${app.id}: other harness children were running during the start (roots ${[...others].join(', ')}); they are excluded`);
    return {
      server,
      m: {
        httpMs,
        dataMs,
        usableMs,
        footprintAtReady: footprint,
        peakToReady: peak,
        cpuToReadyS: cpuNs / 1e9,
        sampleLagMs: at.t - readyT,
        processes: peakByPid.size,
        processNames: [...names].sort(),
        phases,
        serverMeta: server.meta ?? {},
      },
    };
  } catch (e) {
    await server.stop();
    throw e;
  }
}

interface Collected {
  runs: StartMeasure[];
  /** Starts that did not reach ready within TIMEOUTS.startupMs (censored at the limit). */
  timedOut: number;
  prime?: Record<string, unknown>;
}

function record(rec: Recorder, scenario: string, app: AppId, dataset: string, c: Collected): void {
  const censored = c.timedOut ? Array.from({ length: c.timedOut }, () => TIMEOUTS.startupMs) : undefined;
  if (!c.runs.length) {
    // Every start timed out: the readiness metrics still say "at least the limit" for this app.
    if (censored) for (const metric of ['http_ready_ms', 'data_ready_ms', 'usable_ms']) rec.metric({ scenario, app, dataset, metric, unit: 'ms', samples: [], censored, meta: { timedOut: c.timedOut, limitMs: TIMEOUTS.startupMs } });
    return;
  }
  const col = (f: (m: StartMeasure) => number, digits = 3) => c.runs.map((m) => round(f(m), digits));
  const perRun = c.runs.map((m) => ({
    httpMs: round(m.httpMs, 1),
    dataMs: round(m.dataMs, 1),
    sampleLagMs: round(m.sampleLagMs, 1),
    processes: m.processes,
    processNames: m.processNames,
    phases: Object.keys(m.phases).length ? m.phases : undefined,
    initialSync: m.serverMeta.initialSync,
    stop: m.serverMeta.stop,
  }));
  const readiness =
    app === 'v1'
      ? 'http = GET /api/ping 200; data = stdout "Initial sync complete" (can precede http)'
      : 'GET /api/health 200, which the daemon only answers after reconcile (sync + recommendations rebuild): http = data';
  rec.metric({ scenario, app, dataset, metric: 'http_ready_ms', unit: 'ms', samples: col((m) => m.httpMs), censored, meta: { readiness, runs: perRun, prime: c.prime, bin: c.runs[0]!.serverMeta.bin } });
  rec.metric({ scenario, app, dataset, metric: 'data_ready_ms', unit: 'ms', samples: col((m) => m.dataMs), censored, meta: { readiness } });
  rec.metric({ scenario, app, dataset, metric: 'usable_ms', unit: 'ms', samples: col((m) => m.usableMs), censored, meta: { definition: 'max(http_ready_ms, data_ready_ms): both the API and the synced data are available' } });
  const tree = { what: 'server process plus descendants seen by the sampler', samplePeriodMs: SAMPLE_MS };
  rec.metric({ scenario, app, dataset, metric: 'footprint_at_ready_mib', unit: 'MiB', samples: col((m) => toMiB(m.footprintAtReady)), meta: { ...tree, at: 'first sample at or after usable_ms (lag per run in http_ready_ms meta)' } });
  rec.metric({ scenario, app, dataset, metric: 'peak_footprint_startup_mib', unit: 'MiB', samples: col((m) => toMiB(m.peakToReady)), meta: { ...tree, definition: 'sum over the tree of each process lifetime max phys_footprint, up to ready (upper bound on the simultaneous peak)' } });
  rec.metric({ scenario, app, dataset, metric: 'cpu_s_to_ready', unit: 'cpu_s', samples: col((m) => m.cpuToReadyS, 4), meta: { ...tree, childProcesses: medianCount(c.runs.map((m) => m.processes - 1)) } });
  if (app === 'v2') {
    for (const [key, metric] of V2_PHASES) {
      const s = c.runs.map((m) => m.phases[key]).filter((x): x is number => typeof x === 'number');
      if (s.length) rec.metric({ scenario, app, dataset, metric, unit: 'ms', samples: s, meta: { source: 'time the daemon log line reached the harness, from spawn', v2Only: true } });
    }
  }
}

function medianCount(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1]! : 0;
}

export async function run(ctx: SuiteContext): Promise<SuiteResult> {
  const r = newSuiteResult('startup', ctx.runId, ctx.profile);
  const rec = new Recorder(r);
  const log = ctx.log;
  const links = cliLinkState();
  const { firstStartRuns, warmRuns } = ctx.knobs.startup;
  r.notes.push(`startup timeout ${TIMEOUTS.startupMs} ms per start; tree sampled every ${SAMPLE_MS} ms while starting`);

  for (const dataset of ctx.datasets as DatasetName[]) {
    // first-start: a new copy of the template for every run.
    const first = new Map<AppId, Collected>(ctx.apps.map((a) => [a.id, { runs: [], timedOut: 0 }]));
    const firstOut = await ctx.interleave(firstStartRuns, ctx.apps, async (app: AppAdapter) => {
      const h = await restoreHome({ paths: ctx.paths, dataset, app: app.id, runDir: ctx.runDir, suffix: 'startup-first', log });
      const t0 = performance.now();
      const { m, server } = await measuredStart(ctx.procstat, app, h.home, ctx.runDir, log).catch((e: unknown) => {
        if (isTimeout(e)) first.get(app.id)!.timedOut++;
        throw e;
      });
      await server.stop();
      first.get(app.id)!.runs.push(m);
      log.info(`first-start ${app.id}/${dataset}: http ${m.httpMs.toFixed(0)} ms, data ${m.dataMs.toFixed(0)} ms, ${toMiB(m.footprintAtReady).toFixed(1)} MiB at ready (${((performance.now() - t0) / 1000).toFixed(1)} s incl. stop)`);
    });
    for (const o of firstOut) if (!o.ok) rec.fail(o.app.id, dataset, 'first-start', o.error);
    for (const app of ctx.apps) record(rec, 'first-start', app.id, dataset, first.get(app.id)!);

    // warm-start: one home per app, synced by an unmeasured start, then restarted each run.
    const warm = new Map<AppId, Collected>();
    const warmHomes = new Map<AppId, string>();
    for (const app of ctx.apps) {
      try {
        const h = await restoreHome({ paths: ctx.paths, dataset, app: app.id, runDir: ctx.runDir, suffix: 'startup-warm', log });
        const server = await app.startServer({ home: h.home, runDir: ctx.runDir, mode: 'web' });
        const prime = { httpMs: round(server.timings.httpReadyMs, 1), dataMs: round(server.timings.dataReadyMs, 1) };
        await server.stop();
        warmHomes.set(app.id, h.home);
        warm.set(app.id, { runs: [], timedOut: 0, prime });
      } catch (e) {
        log.warn(`${app.id}/${dataset}: priming the warm-start home failed: ${errorMessage(e)}`);
        rec.fail(app.id, dataset, 'warm-start', new Error(`priming start failed: ${errorMessage(e)}`));
      }
    }
    const warmApps = ctx.apps.filter((a) => warmHomes.has(a.id));
    if (warmApps.length) {
      const warmOut = await ctx.interleave(warmRuns, warmApps, async (app: AppAdapter) => {
        const { m, server } = await measuredStart(ctx.procstat, app, warmHomes.get(app.id)!, ctx.runDir, log).catch((e: unknown) => {
          if (isTimeout(e)) warm.get(app.id)!.timedOut++;
          throw e;
        });
        await server.stop();
        warm.get(app.id)!.runs.push(m);
        log.info(`warm-start ${app.id}/${dataset}: http ${m.httpMs.toFixed(0)} ms, data ${m.dataMs.toFixed(0)} ms, ${toMiB(m.footprintAtReady).toFixed(1)} MiB at ready`);
      });
      for (const o of warmOut) if (!o.ok) rec.fail(o.app.id, dataset, 'warm-start', o.error);
      for (const app of warmApps) record(rec, 'warm-start', app.id, dataset, warm.get(app.id)!);
    }
  }

  checkCliLinks(links, r, log);
  return r;
}
