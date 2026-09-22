// Suite 4, idle: the server alone with no clients. Start on a freshly restored home, wait until
// ready, then sample the server tree (the server plus any descendants) every second for the
// profile's duration. Footprint is read at +10 s and at the end; means, CPU and wakeups cover the
// window from +10 s to the end, so the tail of startup work is left out. Runs are interleaved ABBA.
//
// What falls inside the window (both apps' own timers, left at their defaults): both rescan plans
// every 30 s; V1 also fetches model pricing at +15 s after start and backfills costs at +60 s; V2
// runs job maintenance every 60 s and its PR sync at +30 s. They are part of each app's idle cost.

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
/** Start of the averaging window, seconds after ready. */
const WINDOW_FROM_SEC = 10;

interface IdleRun {
  footprint10: number;
  footprintEnd: number;
  footprintMean: number;
  rssMean: number;
  peak: number;
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
  const { runs, durationSec } = ctx.knobs.idle;
  // A window too short for the +10 s start still yields numbers, over the whole run.
  const from = durationSec > WINDOW_FROM_SEC + 2 ? WINDOW_FROM_SEC : 0;
  r.notes.push(`${runs} run(s) x ${durationSec} s per dataset and app, sampled every ${SAMPLE_MS} ms; window for means, CPU and wakeups: +${from} s to the end`);

  for (const dataset of ctx.datasets as DatasetName[]) {
    const got = new Map<AppId, IdleRun[]>(ctx.apps.map((a) => [a.id, []]));
    const outcomes = await ctx.interleave(runs, ctx.apps, async (app: AppAdapter) => {
      const h = await restoreHome({ paths: ctx.paths, dataset, app: app.id, runDir: ctx.runDir, suffix: 'idle', log });
      const server = await app.startServer({ home: h.home, runDir: ctx.runDir, mode: 'web' });
      try {
        const sampler = new Sampler(ctx.procstat, () => [{ role: 'server', pid: server.pid }], { intervalMs: SAMPLE_MS, resetAtStart: true, log });
        await sampler.start();
        try {
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
        const run: IdleRun = {
          footprint10: sampler.valueAt(from) ?? NaN,
          footprintEnd: sampler.valueAt(end) ?? NaN,
          footprintMean: sampler.mean('footprint', from, end) ?? NaN,
          rssMean: sampler.mean('resident', from, end) ?? NaN,
          peak: sampler.peakFootprint(),
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
      const window = { fromSec: from, windowSec: rs.map((x) => round(x.windowSec, 2)), samplePeriodMs: SAMPLE_MS, tree: 'server process plus descendants' };
      rec.metric({
        scenario: 'idle',
        app: app.id,
        dataset,
        metric: 'footprint_mean_mib',
        unit: 'MiB',
        samples: col((x) => toMiB(x.footprintMean)),
        meta: { ...window, runs: rs.map((x) => ({ points: x.points, maxProcesses: x.maxProcesses, processNames: x.processNames, readyMs: round(x.readyMs, 1), samplerErrors: x.samplerErrors.length ? x.samplerErrors : undefined })) },
      });
      rec.metric({ scenario: 'idle', app: app.id, dataset, metric: 'footprint_10s_mib', unit: 'MiB', samples: col((x) => toMiB(x.footprint10)), meta: { atSec: from } });
      rec.metric({ scenario: 'idle', app: app.id, dataset, metric: 'footprint_end_mib', unit: 'MiB', samples: col((x) => toMiB(x.footprintEnd)) });
      rec.metric({ scenario: 'idle', app: app.id, dataset, metric: 'peak_footprint_mib', unit: 'MiB', samples: col((x) => toMiB(x.peak)), meta: { definition: 'sum of per-process interval max phys_footprint over the whole idle run (reset at its start)' } });
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
