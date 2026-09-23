// Suite 4, idle: the server alone with no clients. Start on a freshly restored home, wait until
// ready, then sample the server tree (the server plus any descendants) every second. The first
// `settleSec` seconds after ready are the settling phase: both apps run one-off work after a start
// (V1: model pricing fetch at +15 s, cost backfill at +60 s; V2: PR sync at +30 s and its model
// enrichment fetch), and V1's footprint is still climbing then. The measured idle window is the
// `durationSec` seconds after it; the settling phase is reported separately (settling_cpu_s) so its
// cost is visible rather than mixed into "idle". Runs are interleaved ABBA.
//
// What falls inside the window (both apps' own timers, left at their shipped defaults): both rescan
// plans every 30 s; V2 runs job maintenance every 60 s. They are part of each app's idle cost.
//
// The process set is the headless backend only: V1's `--web` server (which also renders its UI on the
// server) against V2's daemon alone. V2's UI host (tendril-app) is not running here; the desktop
// suite measures both apps' whole process trees.

import fs from 'node:fs';
import { type DatasetName } from '../lib/config.ts';
import { isAlive, sleep } from '../lib/proc.ts';
import { Sampler } from '../lib/procstat.ts';
import { newSuiteResult, type AppId, type SuiteResult } from '../lib/results.ts';
import type { AppAdapter } from '../apps/types.ts';
import { restoreHome } from '../datasets/index.ts';
import type { SuiteContext } from './index.ts';
import { checkCliLinks, cliLinkState, Recorder, round, toMiB } from './csi-shared.ts';

const SAMPLE_MS = 1000;

interface IdleRun {
  footprintStart: number;
  footprintEnd: number;
  footprintMean: number;
  rssMean: number;
  peak: number;
  settlingCpuS: number;
  settlingPeak: number;
  cpuPercent: number;
  wakeupsPerSec: number;
  windowSec: number;
  points: number;
  maxProcesses: number;
  processNames: string[];
  readyMs: number;
  footprintSeries: Array<[number, number]>;
  cpuSeries: Array<[number, number]>;
  samplerErrors: string[];
}

export async function run(ctx: SuiteContext): Promise<SuiteResult> {
  const r = newSuiteResult('idle', ctx.runId, ctx.profile);
  r.series ??= [];
  const rec = new Recorder(r);
  const log = ctx.log;
  const links = cliLinkState();
  const { runs, settleSec, durationSec } = ctx.knobs.idle;
  const from = settleSec;
  const total = settleSec + durationSec;
  r.notes.push(
    `${runs} run(s) per dataset and app, sampled every ${SAMPLE_MS} ms from ready: a settling phase of ${settleSec} s (reported as settling_cpu_s and settling_peak_footprint_mib), then the measured idle window of ${durationSec} s (+${from} s to +${total} s after ready) for means, CPU and wakeups`,
    'process set: the headless backend only (V1 Ivy.Tendril --web, which includes its server-side UI; V2 tendril serve without the tendril-app host); whole desktop process trees are in the desktop suite',
  );

  for (const dataset of ctx.datasets as DatasetName[]) {
    const got = new Map<AppId, IdleRun[]>(ctx.apps.map((a) => [a.id, []]));
    const outcomes = await ctx.interleave(runs, ctx.apps, async (app: AppAdapter) => {
      const h = await restoreHome({ paths: ctx.paths, dataset, app: app.id, runDir: ctx.runDir, suffix: 'idle', log });
      const server = await app.startServer({ home: h.home, runDir: ctx.runDir, mode: 'web' });
      try {
        const sampler = new Sampler(ctx.procstat, () => [{ role: 'server', pid: server.pid }], { intervalMs: SAMPLE_MS, resetAtStart: true, log });
        await sampler.start();
        let settlingPeak = NaN;
        try {
          await sleep(settleSec * 1000);
          // Peak of the settling phase, then a fresh interval so the window's own peak is separate.
          settlingPeak = sampler.peakFootprint();
          await sampler.resetPeaks();
          await sleep(durationSec * 1000);
        } finally {
          await sampler.stop();
        }
        if (!isAlive(server.pid)) throw new Error(`server pid ${server.pid} exited during the idle window (see ${server.logs.stderr})`);
        const pts = sampler.points;
        const end = sampler.durationSec;
        if (pts.length < 3) throw new Error(`only ${pts.length} sample(s) in the window (${sampler.errors.slice(0, 3).join('; ')})`);
        const names = new Set<string>();
        let maxProcs = 0;
        for (const p of pts) {
          maxProcs = Math.max(maxProcs, p.procs.size);
          for (const q of p.procs.values()) if (q.name) names.add(q.name);
        }
        const cpuSeries: Array<[number, number]> = [];
        for (let k = 1; k < pts.length; k++) {
          const c = sampler.cpuPercent(pts[k - 1]!.sec, pts[k]!.sec);
          if (c !== null) cpuSeries.push([round(pts[k]!.sec, 3), round(c, 3)]);
        }
        if (end < from + durationSec / 2) throw new Error(`the window ended ${end.toFixed(1)} s after ready, before +${from + durationSec / 2} s (${sampler.errors.slice(0, 3).join('; ') || 'no sampler errors'})`);
        const run: IdleRun = {
          footprintStart: sampler.valueAt(from) ?? NaN,
          footprintEnd: sampler.valueAt(end) ?? NaN,
          footprintMean: sampler.mean('footprint', from, end) ?? NaN,
          rssMean: sampler.mean('resident', from, end) ?? NaN,
          peak: sampler.peakFootprint(),
          settlingCpuS: sampler.delta('cpu_ns', 0, from) / 1e9,
          settlingPeak,
          cpuPercent: sampler.cpuPercent(from, end) ?? NaN,
          wakeupsPerSec: sampler.wakeupsPerSec(from, end) ?? NaN,
          windowSec: end - from,
          points: pts.length,
          maxProcesses: maxProcs,
          processNames: [...names].sort(),
          readyMs: Math.max(server.timings.httpReadyMs, server.timings.dataReadyMs),
          footprintSeries: sampler.series('footprint').map(([s, b]) => [round(s, 3), round(toMiB(b), 3)]),
          cpuSeries,
          samplerErrors: sampler.errors.slice(0, 5),
        };
        got.get(app.id)!.push(run);
        log.info(`idle ${app.id}/${dataset}: mean ${toMiB(run.footprintMean).toFixed(1)} MiB, cpu ${run.cpuPercent.toFixed(2)} %, ${run.wakeupsPerSec.toFixed(1)} wakeups/s over ${run.windowSec.toFixed(1)} s`);
      } finally {
        await server.stop();
        fs.rmSync(h.home, { recursive: true, force: true });
      }
    });
    for (const o of outcomes) if (!o.ok) rec.fail(o.app.id, dataset, 'idle', o.error);

    for (const app of ctx.apps) {
      const rs = got.get(app.id)!;
      if (!rs.length) continue;
      const col = (f: (x: IdleRun) => number, digits = 3) => rs.map((x) => round(f(x), digits));
      const window = { fromSec: from, windowSec: rs.map((x) => round(x.windowSec, 2)), samplePeriodMs: SAMPLE_MS, tree: app.id === 'v1' ? 'Ivy.Tendril --web (server incl. server-side UI) plus descendants' : 'tendril serve (daemon only; the tendril-app host is not running) plus descendants' };
      rec.metric({
        scenario: 'idle',
        app: app.id,
        dataset,
        metric: 'footprint_mean_mib',
        unit: 'MiB',
        samples: col((x) => toMiB(x.footprintMean)),
        meta: { ...window, runs: rs.map((x) => ({ points: x.points, maxProcesses: x.maxProcesses, processNames: x.processNames, readyMs: round(x.readyMs, 1), samplerErrors: x.samplerErrors.length ? x.samplerErrors : undefined })) },
      });
      rec.metric({ scenario: 'idle', app: app.id, dataset, metric: 'footprint_window_start_mib', unit: 'MiB', samples: col((x) => toMiB(x.footprintStart)), meta: { atSec: from } });
      rec.metric({ scenario: 'idle', app: app.id, dataset, metric: 'footprint_end_mib', unit: 'MiB', samples: col((x) => toMiB(x.footprintEnd)) });
      rec.metric({ scenario: 'idle', app: app.id, dataset, metric: 'peak_footprint_mib', unit: 'MiB', samples: col((x) => toMiB(x.peak)), meta: { definition: 'sum of per-process interval max phys_footprint over the idle window (reset when it opens)' } });
      rec.metric({ scenario: 'settling', app: app.id, dataset, metric: 'settling_cpu_s', unit: 'cpu_s', samples: col((x) => x.settlingCpuS, 4), meta: { fromSec: 0, toSec: from, definition: 'CPU seconds of the server tree from ready until the idle window opens (one-off post-start work)' } });
      rec.metric({ scenario: 'settling', app: app.id, dataset, metric: 'settling_peak_footprint_mib', unit: 'MiB', samples: col((x) => toMiB(x.settlingPeak)), meta: { fromSec: 0, toSec: from, definition: 'sum of per-process interval max phys_footprint from ready until the idle window opens' } });
      rec.metric({ scenario: 'idle', app: app.id, dataset, metric: 'cpu_percent_mean', unit: 'percent', samples: col((x) => x.cpuPercent, 4), meta: { ...window, definition: 'CPU time over the window / window length, percent of one core' } });
      rec.metric({ scenario: 'idle', app: app.id, dataset, metric: 'idle_wakeups_per_s', unit: 'count', samples: col((x) => x.wakeupsPerSec, 3), meta: { ...window, definition: 'pkg_idle_wkups + interrupt_wkups per second' } });
      rec.metric({ scenario: 'idle', app: app.id, dataset, metric: 'rss_mib', unit: 'MiB', samples: col((x) => toMiB(x.rssMean)), meta: { ...window, definition: 'mean resident size over the window (context only: counts shared pages)' } });
      for (const x of rs) {
        r.series.push({ app: app.id, dataset, scenario: 'idle', name: 'footprint_mib', unit: 'MiB', points: x.footprintSeries });
        r.series.push({ app: app.id, dataset, scenario: 'idle', name: 'cpu_percent', unit: 'percent', points: x.cpuSeries });
      }
    }
  }

  checkCliLinks(links, r, log);
  return r;
}
