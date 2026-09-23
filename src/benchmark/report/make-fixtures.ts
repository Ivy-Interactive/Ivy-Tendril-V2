// Writes report/fixtures/{run.json,results/*.json}: synthetic but realistic results for every suite,
// both apps and all datasets, used to develop and test the report without a two-hour run.
//
//   node src/benchmark/report/make-fixtures.ts
//
// Magnitudes come from the research runs on this machine (sizes are the real byte counts of the
// v1.2.4 release and a V2 build; latencies and memory are the order of magnitude seen in probes).
// The fixtures deliberately include what the report must handle: failures and a timeout, a noisy
// metric, a suite that started under load, V1 wins, a winner that changes with dataset size,
// one-sided metrics, zero-byte artifacts and single-sample metrics. Seeded, so reruns are identical.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASETS, PROFILES, V1_SHA, V2_REF_DEFAULT } from '../lib/config.ts';
import type { AppId, Metric, RunInfo, SeriesEntry, SuiteResult, Unit } from '../lib/results.ts';
import { mulberry32 } from '../lib/stats.ts';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const RUN_ID = '20260922-090000-full';
const PROFILE = 'full';
const knobs = PROFILES.full;

const rand = mulberry32(20260922);
function normal(): number {
  // Box-Muller on the seeded stream.
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Lognormal around `median` with spread ~cv, plus an optional slow tail. */
function draw(n: number, median: number, cv: number, opts: { tail?: number; tailX?: number; digits?: number } = {}): number[] {
  const d = opts.digits ?? 3;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let x = median * Math.exp(cv * normal());
    if (opts.tail && rand() < opts.tail) x *= opts.tailX ?? 3;
    out.push(Number(x.toFixed(d)));
  }
  return out;
}

const ds = ['empty', 'small', 'medium', 'large'] as const;
type Ds = (typeof ds)[number];
const byDs = <T>(v: Record<Ds, T>) => v;

let clock = Date.parse('2026-09-22T09:00:00+02:00');
function iso(ms: number): string {
  const d = new Date(ms + 2 * 3600_000);
  return `${d.toISOString().slice(0, 23)}+02:00`;
}

function suite(name: string, minutes: number, load: { start: number; end: number; samples: number[] }): SuiteResult {
  const startedAt = iso(clock);
  clock += minutes * 60_000;
  const finishedAt = iso(clock);
  clock += 20_000;
  return {
    suite: name,
    runId: RUN_ID,
    profile: PROFILE,
    startedAt,
    finishedAt,
    env: { loadavgStart: [load.start, load.start * 1.2, load.start * 1.4].map((x) => Number(x.toFixed(2))), loadavgEnd: [load.end, load.end * 1.1, load.end * 1.3].map((x) => Number(x.toFixed(2))), loadSamples: load.samples, quietWaitMs: 0 },
    metrics: [],
    series: [],
    notes: [],
    failures: [],
  };
}

function loadTrace(n: number, base: number, spike = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Number((base + 0.3 * Math.abs(normal()) + (spike && i > n / 3 && i < n / 2 ? spike : 0)).toFixed(2)));
  return out;
}

function add(r: SuiteResult, scenario: string, app: AppId, dataset: string | null, metric: string, unit: Unit, samples: number[], better: 'lower' | 'higher' = 'lower', meta?: Record<string, unknown>): void {
  const m: Metric = { suite: r.suite, scenario, app, dataset, metric, unit, samples, better };
  if (meta) m.meta = meta;
  r.metrics.push(m);
}

const results: SuiteResult[] = [];

// ---------------------------------------------------------------------------------------------
// size (exact bytes; V1 = the v1.2.4 release, V2 = a build at the pinned commit)
{
  const r = suite('size', 3, { start: 1.1, end: 1.3, samples: loadTrace(36, 1.1) });
  const b = (scenario: string, app: AppId, bytes: number, meta?: Record<string, unknown>) => add(r, scenario, app, null, 'bytes', 'bytes', [bytes], 'lower', { deterministic: true, ...meta });
  b('installer', 'v1', 388_890_560, { file: 'IvyTendril-1.2.4-osx-arm64.pkg', sha256: 'c1f26218d2b5a0e8f63a9b0b7a86e1f0c4e3b7d7a41a3c1d7b8a55f2e9c0b412' });
  b('installer', 'v2', 72_418_905, { file: 'Tendril_0.1.0_aarch64.dmg' });
  const v2app = { 'tendril-app': 25_961_344, tendril: 38_940_096, opencode: 144_470_498, other: 66_916 };
  const v2total = Object.values(v2app).reduce((s, x) => s + x, 0);
  b('installed-app', 'v1', 1_167_911_573, { files: 5534, path: '/Applications/Ivy Tendril.app' });
  b('installed-app', 'v2', v2total, { files: 5 });
  add(r, 'installed-app', 'v1', null, 'files', 'count', [5534], 'lower', { deterministic: true });
  add(r, 'installed-app', 'v2', null, 'files', 'count', [5], 'lower', { deterministic: true });
  const v1parts: Array<[string, number, string]> = [
    ['Resources/dotnet', 651_300_995, 'bundled toolchains'],
    ['Resources/PowerShell', 196_209_555, 'bundled toolchains'],
    ['MacOS/Ivy.Tendril', 165_830_496, 'core app'],
    ['MacOS/ivy-agent', 138_823_456, 'agent sidecar'],
    ['MacOS/UpdateMac', 7_529_712, 'updater'],
    ['MacOS/native dylibs', 6_036_672, 'core app'],
    ['other', 2_180_687, 'other'],
  ];
  for (const [n, bytes, group] of v1parts) b(`installed-app/${n}`, 'v1', bytes, { parent: 'installed-app', group });
  for (const [n, bytes] of Object.entries(v2app)) b(`installed-app/MacOS/${n}`.replace('MacOS/other', 'other'), 'v2', bytes, { parent: 'installed-app', group: n === 'opencode' ? 'agent sidecar' : n === 'other' ? 'other' : 'core app' });
  b('installed-app-after-first-launch', 'v1', 1_167_911_573);
  b('installed-app-after-first-launch', 'v2', v2total + 38_940_096 + 144_470_498, { note: 'first launch copies tendril and opencode into <home>/bin' });
  b('core-app', 'v1', 165_830_496 + 6_036_672);
  b('core-app', 'v2', 25_961_344 + 38_940_096);
  b('agent-sidecar', 'v1', 138_823_456, { version: 'ivy-agent 0.1.5' });
  b('agent-sidecar', 'v2', 144_470_498, { version: 'opencode 1.18.31' });
  b('bundled-toolchains', 'v1', 651_300_995 + 196_209_555);
  b('bundled-toolchains', 'v2', 0);
  b('updater', 'v1', 7_529_712);
  b('updater', 'v2', 0);
  b('server-binary', 'v1', 165_830_496);
  b('server-binary', 'v2', 38_940_096);
  b('server-binary (strip -x, informational)', 'v2', 30_112_560);
  b('ui-host-binary', 'v2', 25_961_344);
  b('Ivy.Tendril single-file bundle', 'v1', 165_830_496);
  for (const [n, bytes] of [
    ['native host (coreclr)', 10_506_240],
    ['.NET shared framework (313 files)', 98_548_304],
    ['Ivy framework', 22_048_768],
    ['Tendril assemblies', 13_453_472],
    ['third-party NuGet (69 files)', 20_220_944],
    ['trailer', 1_052_768],
  ] as const)
    b(`Ivy.Tendril single-file bundle/${n}`, 'v1', bytes);
  const fe = (scenario: string, app: AppId, raw: number, gz: number, br: number) => {
    b(scenario, app, raw);
    add(r, scenario, app, null, 'bytes_gzip9', 'bytes', [gz], 'lower', { deterministic: true });
    add(r, scenario, app, null, 'bytes_brotli11', 'bytes', [br], 'lower', { deterministic: true });
  };
  fe('frontend/eager-js', 'v1', 11_910_132, 3_761_873, 2_984_836);
  fe('frontend/eager-js', 'v2', 1_599_837, 491_139, 427_888);
  fe('frontend/eager-css', 'v1', 331_583, 57_563, 48_410);
  fe('frontend/eager-css', 'v2', 295_829, 45_862, 37_247);
  fe('frontend/all-js', 'v1', 20_569_145, 6_727_954, 5_591_599);
  fe('frontend/all-js', 'v2', 10_252_067, 3_202_584, 2_703_053);
  fe('frontend/fonts', 'v1', 1_431_408, 1_225_101, 1_205_359);
  fe('frontend/fonts', 'v2', 1_072_948, 866_377, 846_867);
  b('frontend/sourcemaps', 'v1', 5_263_944);
  b('frontend/sourcemaps', 'v2', 0);
  b('frontend/wireframe-payload', 'v2', 3_951_046);
  fe('frontend/webviewer-proxy-assets', 'v1', 198_760, 65_062, 56_457);
  fe('frontend/webviewer-proxy-assets', 'v2', 200_750, 65_709, 57_039);
  r.notes.push('V1 installer from gh release download v1.2.4 (digest verified); installed app measured from the expanded pkg payload');
  r.notes.push('V2 .app and .dmg from tauri build --bundles app,dmg --no-sign at the pinned commit');
  results.push(r);
}

// ---------------------------------------------------------------------------------------------
// cli
{
  const r = suite('cli', 6, { start: 1.2, end: 1.4, samples: loadTrace(72, 1.2) });
  const n = knobs.cli.runs;
  add(r, '--version', 'v1', null, 'wall_ms', 'ms', draw(n, 142, 0.05));
  add(r, '--version', 'v2', null, 'wall_ms', 'ms', draw(n, 2.4, 0.12));
  add(r, '--version', 'v1', null, 'peak_footprint_mib', 'MiB', draw(n, 38.2, 0.01, { digits: 2 }));
  add(r, '--version', 'v2', null, 'peak_footprint_mib', 'MiB', draw(n, 2.1, 0.01, { digits: 2 }));
  for (const d of ['small', 'large'] as const) {
    const big = d === 'large';
    add(r, 'plan list', 'v1', d, 'wall_ms', 'ms', draw(n, big ? 1480 : 610, 0.04));
    add(r, 'plan list', 'v2', d, 'wall_ms', 'ms', draw(n, big ? 41 : 9.8, 0.08));
    add(r, 'plan list', 'v1', d, 'peak_footprint_mib', 'MiB', draw(n, big ? 152 : 74, 0.02, { digits: 2 }));
    add(r, 'plan list', 'v2', d, 'peak_footprint_mib', 'MiB', draw(n, big ? 28 : 6.3, 0.02, { digits: 2 }));
    add(r, 'plan get', 'v1', d, 'wall_ms', 'ms', draw(n, big ? 590 : 560, 0.04));
    add(r, 'plan get', 'v2', d, 'wall_ms', 'ms', draw(n, big ? 4.6 : 4.1, 0.1));
  }
  r.notes.push("commands: V1 `Ivy.Tendril plan list` / `plan get <id>`, V2 `tendril --home H plan list` / `plan get <id>`; outputs differ in format (V1 table, V2 JSON)");
  results.push(r);
}

// ---------------------------------------------------------------------------------------------
// startup
{
  const r = suite('startup', 24, { start: 1.3, end: 1.6, samples: loadTrace(288, 1.3) });
  const v1http = byDs({ empty: 1150, small: 1190, medium: 1240, large: 1330 });
  const v1dataFirst = byDs({ empty: 1260, small: 1520, medium: 2210, large: 5840 });
  const v1dataWarm = byDs({ empty: 1350, small: 1420, medium: 1700, large: 2900 });
  const v2first = byDs({ empty: 44, small: 108, medium: 420, large: 2140 });
  const v2warm = byDs({ empty: 39, small: 71, medium: 180, large: 655 });
  const fpReady = { v1: byDs({ empty: 95, small: 111, medium: 151, large: 262 }), v2: byDs({ empty: 6.1, small: 9.2, medium: 16.4, large: 42.3 }) };
  const peak = { v1: byDs({ empty: 121, small: 142, medium: 191, large: 331 }), v2: byDs({ empty: 8.9, small: 14.1, medium: 28.6, large: 75.2 }) };
  const cpu = { v1: byDs({ empty: 1.9, small: 2.3, medium: 3.4, large: 8.5 }), v2: byDs({ empty: 0.021, small: 0.062, medium: 0.25, large: 1.42 }) };
  for (const d of ds) {
    for (const [sc, n] of [
      ['first-start', knobs.startup.firstStartRuns],
      ['warm-start', knobs.startup.warmRuns],
    ] as const) {
      const warm = sc === 'warm-start';
      add(r, sc, 'v1', d, 'http_ready_ms', 'ms', draw(n, v1http[d] * (warm ? 1.05 : 1), 0.06));
      add(r, sc, 'v2', d, 'http_ready_ms', 'ms', draw(n, warm ? v2warm[d] : v2first[d], 0.08));
      add(r, sc, 'v1', d, 'data_ready_ms', 'ms', draw(n, warm ? v1dataWarm[d] : v1dataFirst[d], 0.07));
      add(r, sc, 'v2', d, 'data_ready_ms', 'ms', draw(n, warm ? v2warm[d] : v2first[d], 0.08));
      for (const a of ['v1', 'v2'] as const) {
        add(r, sc, a, d, 'footprint_at_ready_mib', 'MiB', draw(n, fpReady[a][d] * (warm ? 0.95 : 1), 0.04, { digits: 2 }));
        add(r, sc, a, d, 'peak_footprint_startup_mib', 'MiB', draw(n, peak[a][d] * (warm ? 0.9 : 1), 0.04, { digits: 2 }));
        add(r, sc, a, d, 'cpu_s_to_ready', 'cpu_s', draw(n, cpu[a][d] * (warm ? 0.8 : 1), 0.06, { digits: 4 }), 'lower', a === 'v1' ? { childProcesses: 21 } : undefined);
      }
    }
  }
  r.notes.push('V1 server binary: builds/v1-publish/Ivy.Tendril (Tendril 1.2.4, .NET 10.0.7)');
  results.push(r);
}

// ---------------------------------------------------------------------------------------------
// idle (with time series)
{
  const r = suite('idle', 26, { start: 1.1, end: 1.2, samples: loadTrace(312, 1.1) });
  const fp = { v1: byDs({ empty: 148, small: 176, medium: 215, large: 286 }), v2: byDs({ empty: 8.4, small: 11.2, medium: 19.3, large: 38.6 }) };
  const cpu = { v1: byDs({ empty: 0.62, small: 0.95, medium: 2.4, large: 6.1 }), v2: byDs({ empty: 0.04, small: 0.09, medium: 0.41, large: 1.85 }) };
  const wk = { v1: byDs({ empty: 61, small: 64, medium: 70, large: 83 }), v2: byDs({ empty: 4.2, small: 5.1, medium: 7.7, large: 12.4 }) };
  for (const d of ds) {
    for (const a of ['v1', 'v2'] as const) {
      const runs = knobs.idle.runs;
      const series: number[][] = [];
      for (let run = 0; run < runs; run++) {
        const base = fp[a][d] * (1 + 0.02 * normal());
        const pts: number[] = [];
        for (let t = 0; t <= knobs.idle.durationSec; t++) {
          let v = a === 'v1' ? base * (0.9 + 0.1 * ((t % 23) / 23)) : base;
          if (t % 30 >= 1 && t % 30 <= 3 && t > 5) v *= a === 'v1' ? 1.12 : 1 + (d === 'large' ? 0.35 : 0.08);
          v *= 1 + 0.004 * normal();
          pts.push(Number(v.toFixed(2)));
        }
        series.push(pts);
        r.series!.push({ app: a, dataset: d, scenario: 'idle', name: 'footprint_mib', unit: 'MiB', points: pts.map((v, t) => [t, v] as [number, number]) } satisfies SeriesEntry);
      }
      const at = (t: number) => series.map((s) => s[t]!);
      const mean = series.map((s) => Number((s.slice(10).reduce((x, y) => x + y, 0) / (s.length - 10)).toFixed(2)));
      add(r, 'idle', a, d, 'footprint_10s_mib', 'MiB', at(10));
      add(r, 'idle', a, d, 'footprint_end_mib', 'MiB', at(knobs.idle.durationSec));
      add(r, 'idle', a, d, 'footprint_mean_mib', 'MiB', mean);
      add(r, 'idle', a, d, 'cpu_percent_mean', 'percent', draw(runs, cpu[a][d], 0.08));
      add(r, 'idle', a, d, 'idle_wakeups_per_s', 'count', draw(runs, wk[a][d], 0.05, { digits: 1 }));
      add(r, 'idle', a, d, 'rss_mib', 'MiB', draw(runs, a === 'v1' ? fp[a][d] * 1.18 + 20 : fp[a][d] * 1.6 + 9, 0.02, { digits: 2 }));
    }
  }
  results.push(r);
}

// ---------------------------------------------------------------------------------------------
// api
{
  const r = suite('api', 34, { start: 3.1, end: 4.2, samples: loadTrace(408, 2.6, 3.9) });
  r.notes.push('load did not drop below 2 within 600 s (1-min load 3.10 at start)');
  const seq = knobs.api.seqSamples;
  const plans = (d: Ds) => DATASETS[d].plans;
  const listBytes = (a: AppId, d: Ds) => (plans(d) === 0 ? 2 : Math.min(50, plans(d)) * (a === 'v1' ? 148 : 9_480));
  const lat: Record<string, (a: AppId, d: Ds) => number> = {
    health: (a) => (a === 'v1' ? 0.34 : 0.081),
    'plans.list': (a, d) => (a === 'v1' ? byDs({ empty: 0.62, small: 8.9, medium: 44, large: 212 })[d] : byDs({ empty: 0.14, small: 1.9, medium: 2.1, large: 2.6 })[d]),
    'plans.filter': (a, d) => (a === 'v1' ? byDs({ empty: 0.6, small: 8.1, medium: 41, large: 204 })[d] : byDs({ empty: 0.13, small: 1.2, medium: 1.9, large: 2.4 })[d]),
    'plans.get': (a, d) => (a === 'v1' ? 1.21 : byDs({ empty: 0.21, small: 0.39, medium: 0.44, large: 0.61 })[d]),
    'projects.list': (a) => (a === 'v1' ? 0.41 : 0.15),
    'jobs.get': (a) => (a === 'v1' ? 0.52 : 0.26),
    'plans.update': (a, d) => (a === 'v1' ? byDs({ empty: 6.8, small: 7.9, medium: 19, large: 61 })[d] : byDs({ empty: 2.9, small: 3.1, medium: 3.6, large: 5.2 })[d]),
  };
  const bytes: Record<string, (a: AppId, d: Ds) => number> = {
    health: (a) => (a === 'v1' ? 4 : 15),
    'plans.list': listBytes,
    'plans.filter': (a, d) => Math.round(listBytes(a, d) * 0.6),
    'plans.get': (a) => (a === 'v1' ? 611 : 18_240),
    'projects.list': (a) => (a === 'v1' ? 412 : 690),
    'jobs.get': (a) => (a === 'v1' ? 530 : 470),
    'plans.update': (a) => (a === 'v1' ? 2 : 64),
  };
  for (const d of ds) {
    for (const sc of Object.keys(lat)) {
      if (d === 'empty' && (sc === 'plans.get' || sc === 'jobs.get' || sc === 'plans.update')) continue;
      for (const a of ['v1', 'v2'] as const) {
        add(r, sc, a, d, 'latency_ms', 'ms', draw(seq, lat[sc]!(a, d), 0.12, { tail: 0.02, tailX: 2.5, digits: 4 }), 'lower', { responseBytes: bytes[sc]!(a, d), statusCounts: { '200': seq } });
      }
    }
    if (d === 'empty') continue;
    for (const c of knobs.api.concurrency) {
      for (const sc of ['plans.list', 'plans.get'] as const) {
        for (const a of ['v1', 'v2'] as const) {
          const base = lat[sc]!(a, d);
          const cores = a === 'v1' ? 5.5 : 9;
          const rps = (1000 / base) * Math.min(c, cores) * (a === 'v2' && c >= 8 ? 0.85 : 1);
          const latMs = (1000 / rps) * c;
          const scenario = `${sc}@c${c}`;
          const meta = { concurrency: c, durationSec: knobs.api.concurrencyDurationSec, requests: Math.round(rps * knobs.api.concurrencyDurationSec) };
          add(r, scenario, a, d, 'throughput_rps', 'req/s', [Number(rps.toFixed(1))], 'higher', meta);
          add(r, scenario, a, d, 'latency_ms', 'ms', draw(800, latMs, 0.18, { tail: 0.01, tailX: 4, digits: 4 }), 'lower', meta);
          const err = a === 'v1' && d === 'large' && c === 32 && sc === 'plans.list' ? 0.42 : 0;
          add(r, scenario, a, d, 'error_rate', 'percent', [err], 'lower', meta);
          const fpBase = a === 'v1' ? byDs({ empty: 150, small: 205, medium: 262, large: 390 })[d] : byDs({ empty: 9, small: 22, medium: 31, large: 58 })[d];
          add(r, scenario, a, d, 'server_peak_footprint_mib', 'MiB', [Number((fpBase * (1 + 0.02 * Math.log2(c))).toFixed(2))], 'lower', meta);
          add(r, scenario, a, d, 'server_cpu_s', 'cpu_s', [Number((knobs.api.concurrencyDurationSec * Math.min(c, cores) * 0.9).toFixed(3))], 'lower', meta);
        }
      }
    }
  }
  results.push(r);
}

// ---------------------------------------------------------------------------------------------
// ui
{
  const r = suite('ui', 41, { start: 1.4, end: 1.7, samples: loadTrace(492, 1.5) });
  const k = knobs.ui;
  for (const d of ds) {
    const big = byDs({ empty: 0, small: 1, medium: 2, large: 3 })[d];
    const v1content = [680, 720, 905, 1480][big]!;
    const v2content = [310, 840, 1520, 4610][big]!;
    add(r, 'cold-load', 'v1', d, 'dom_content_loaded_ms', 'ms', draw(k.coldLoads, 118, 0.06));
    add(r, 'cold-load', 'v2', d, 'dom_content_loaded_ms', 'ms', draw(k.coldLoads, 86, 0.06));
    add(r, 'cold-load', 'v1', d, 'load_ms', 'ms', draw(k.coldLoads, 905, 0.05));
    add(r, 'cold-load', 'v2', d, 'load_ms', 'ms', draw(k.coldLoads, 238, 0.06));
    add(r, 'cold-load', 'v1', d, 'shell_visible_ms', 'ms', draw(k.coldLoads, 640, 0.05));
    add(r, 'cold-load', 'v2', d, 'shell_visible_ms', 'ms', draw(k.coldLoads, 296, 0.06));
    add(r, 'cold-load', 'v1', d, 'content_ready_ms', 'ms', draw(k.coldLoads, v1content, 0.06), 'lower', { kind: d === 'empty' ? 'empty' : 'content' });
    add(r, 'cold-load', 'v2', d, 'content_ready_ms', 'ms', draw(k.coldLoads, v2content, d === 'large' ? 0.34 : 0.07), 'lower', { kind: d === 'empty' ? 'empty' : 'content', ipcCalls: [9, 31, 118, 420][big] });
    add(r, 'cold-load', 'v1', d, 'transfer_bytes', 'bytes', draw(k.coldLoads, 12_412_000, 0.001, { digits: 0 }));
    add(r, 'cold-load', 'v2', d, 'transfer_bytes', 'bytes', draw(k.coldLoads, 1_931_000, 0.001, { digits: 0 }));
    add(r, 'cold-load', 'v1', d, 'request_count', 'count', draw(k.coldLoads, 52, 0.001, { digits: 0 }));
    add(r, 'cold-load', 'v2', d, 'request_count', 'count', draw(k.coldLoads, 31, 0.001, { digits: 0 }));
    add(r, 'cold-load', 'v1', d, 'js_heap_used_mib', 'MiB', draw(k.coldLoads, [34, 38, 52, 96][big]!, 0.03, { digits: 2 }));
    add(r, 'cold-load', 'v2', d, 'js_heap_used_mib', 'MiB', draw(k.coldLoads, [14, 18, 31, 72][big]!, 0.03, { digits: 2 }));
    add(r, 'cold-load', 'v1', d, 'dom_nodes', 'count', draw(k.coldLoads, [1400, 1800, 4100, 9100][big]!, 0.01, { digits: 0 }));
    add(r, 'cold-load', 'v2', d, 'dom_nodes', 'count', draw(k.coldLoads, [1100, 1500, 2300, 3500][big]!, 0.01, { digits: 0 }));
    const navBase = { jobs: [420, 150], dashboard: [790, 360], review: [510, 205], plans: [395, 118] } as const;
    for (const [t, [b1, b2]] of Object.entries(navBase)) {
      const grow = 1 + big * 0.25;
      const scen = `navigate:${t}`;
      const v1n = t === 'jobs' && d === 'large' ? k.navCycles - 1 : k.navCycles;
      add(r, scen, 'v1', d, 'nav_first_ms', 'ms', draw(k.navCycles, b1 * grow * 1.1, 0.08));
      add(r, scen, 'v2', d, 'nav_first_ms', 'ms', draw(k.navCycles, b2 * grow * (t === 'dashboard' ? 2.1 : 1.3), 0.08));
      add(r, scen, 'v1', d, 'nav_ms', 'ms', draw(v1n * 2, b1 * grow, 0.07));
      add(r, scen, 'v2', d, 'nav_ms', 'ms', draw(k.navCycles * 2, t === 'dashboard' ? 62 : b2 * grow, 0.07));
      if (v1n < k.navCycles) r.failures.push({ app: 'v1', dataset: d, scenario: scen, error: 'TimeoutError: waiting for locator(\'td[role=gridcell]\') to be attached exceeded 120000 ms' });
      add(r, `nav-under-load:${t}`, 'v1', d, 'nav_ms', 'ms', draw(k.navUnderLoadCycles, b1 * grow * 1.6, 0.12));
      add(r, `nav-under-load:${t}`, 'v2', d, 'nav_ms', 'ms', draw(k.navUnderLoadCycles, (t === 'dashboard' ? 70 : b2 * grow) * 1.25, 0.12));
    }
    add(r, 'push-rest', 'v1', d, 'push_latency_ms', 'ms', draw(k.pushSamples, [735, 751, 802, 1105][big]!, 0.05));
    add(r, 'push-rest', 'v2', d, 'push_latency_ms', 'ms', draw(k.pushSamples, [520, 532, 578, 702][big]!, 0.05));
    add(r, 'push-fs', 'v1', d, 'push_latency_ms', 'ms', draw(k.fsPushSamples, [905, 920, 990, 1310][big]!, 0.06));
    add(r, 'push-fs', 'v2', d, 'push_latency_ms', 'ms', draw(k.fsPushSamples, [612, 625, 660, 1480][big]!, 0.06));
    add(r, 'after-flows', 'v1', d, 'renderer_footprint_mib', 'MiB', [[112, 121, 158, 262][big]!], 'lower', { wsFrames: [210, 260, 390, 710][big] });
    add(r, 'after-flows', 'v2', d, 'renderer_footprint_mib', 'MiB', [[71, 88, 132, 214][big]!], 'lower', { ipcCalls: [40, 96, 330, 1210][big] });
    add(r, 'after-flows', 'v1', d, 'browser_tree_footprint_mib', 'MiB', [[198, 214, 262, 381][big]!]);
    add(r, 'after-flows', 'v2', d, 'browser_tree_footprint_mib', 'MiB', [[151, 170, 221, 318][big]!]);
    const s1 = [241, 283, 321, 436][big]!;
    const dmn = [9.8, 14.2, 24.1, 51.7][big]!;
    const shim = [12.4, 13.1, 15.9, 22.8][big]!;
    add(r, 'after-flows', 'v1', d, 'server_tree_footprint_mib', 'MiB', [s1], 'lower', { byRole: { server: s1 } });
    add(r, 'after-flows', 'v2', d, 'server_tree_footprint_mib', 'MiB', [Number((dmn + shim).toFixed(1))], 'lower', { byRole: { daemon: dmn, 'v2-shim': shim } });
  }
  add(r, 'about:blank', 'v1', null, 'browser_tree_footprint_mib', 'MiB', [55.3]);
  add(r, 'about:blank', 'v2', null, 'browser_tree_footprint_mib', 'MiB', [55.1]);
  r.notes.push('V2 IPC shim: builds/v2-shim/target/release/v2shim (release build)');
  r.notes.push('V1 Jobs view waits for td[role=gridcell] with state attached (the grid cells are invisible)');
  results.push(r);
}

// ---------------------------------------------------------------------------------------------
// desktop
{
  const r = suite('desktop', 22, { start: 1.2, end: 1.3, samples: loadTrace(264, 1.25) });
  const n = knobs.desktop.runs;
  const roles = {
    v1: byDs({ empty: { app: 190, 'webkit-webcontent': 150, 'webkit-gpu': 38, 'webkit-networking': 7.1 }, small: { app: 0, 'webkit-webcontent': 0, 'webkit-gpu': 0, 'webkit-networking': 0 }, medium: { app: 262, 'webkit-webcontent': 238, 'webkit-gpu': 41, 'webkit-networking': 7.8 }, large: { app: 340, 'webkit-webcontent': 395, 'webkit-gpu': 45, 'webkit-networking': 8.6 } }),
    v2: byDs({ empty: { app: 39, 'webkit-webcontent': 95, 'webkit-gpu': 27, 'webkit-networking': 6.8, daemon: 8.2 }, small: { app: 0, 'webkit-webcontent': 0, 'webkit-gpu': 0, 'webkit-networking': 0, daemon: 0 }, medium: { app: 41, 'webkit-webcontent': 142, 'webkit-gpu': 29, 'webkit-networking': 7.1, daemon: 17.3 }, large: { app: 44, 'webkit-webcontent': 260, 'webkit-gpu': 30, 'webkit-networking': 7.3, daemon: 42.1 } }),
  };
  for (const d of knobs.desktopDatasets) {
    for (const a of ['v1', 'v2'] as const) {
      const rr = roles[a][d] as Record<string, number>;
      const runs = a === 'v2' && d === 'empty' ? n - 1 : n;
      const byRole: Record<string, number[]> = {};
      for (const [role, v] of Object.entries(rr)) byRole[role] = draw(runs, v, 0.03, { digits: 1 });
      const totals = Array.from({ length: runs }, (_, i) => Number(Object.values(byRole).reduce((s, xs) => s + xs[i]!, 0).toFixed(1)));
      add(r, 'launch', a, d, 'app_process_ms', 'ms', draw(runs, a === 'v1' ? 162 : 141, 0.08));
      add(r, 'launch', a, d, 'webcontent_spawn_ms', 'ms', draw(runs, a === 'v1' ? 1850 + (d === 'large' ? 900 : 0) : 312, 0.06));
      add(r, 'launch', a, d, 'window_visible_ms', 'ms', draw(runs, a === 'v1' ? 418 : 381, 0.06));
      add(r, 'steady-state', a, d, 'footprint_15s_mib', 'MiB', totals.map((x) => Number((x * 0.93).toFixed(1))));
      add(r, 'steady-state', a, d, 'footprint_end_mib', 'MiB', totals, 'lower', { byRole });
      const cpu = a === 'v1' ? byDs({ empty: 2.1, small: 0, medium: 3.5, large: 6.0 })[d] : byDs({ empty: 2.9, small: 0, medium: 0.7, large: 1.6 })[d];
      add(r, 'steady-state', a, d, 'cpu_percent_mean', 'percent', draw(runs, cpu, 0.07));
      add(r, 'steady-state', a, d, 'idle_wakeups_per_s', 'count', draw(runs, a === 'v1' ? 180 : 95, 0.06, { digits: 1 }));
      for (let run = 0; run < runs; run++) {
        const pts: Array<[number, number]> = [];
        for (let t = 0; t <= knobs.desktop.durationSec; t++) {
          const ramp = Math.min(1, t / (a === 'v1' ? 9 : 4));
          const v = totals[run]! * (0.35 + 0.65 * ramp) * (1 + 0.006 * normal()) + (a === 'v1' && t % 30 < 3 && t > 5 ? 14 : 0);
          pts.push([t * 1000, Number(v.toFixed(1))]);
        }
        r.series!.push({ app: a, dataset: d, scenario: `steady-state#${run + 1}`, name: 'footprint_mib', unit: 'MiB', points: pts });
      }
      if (runs < n) r.failures.push({ app: a, dataset: d, scenario: 'launch', error: 'window did not become visible within 180000 ms (run 2)' });
    }
  }
  r.notes.push('V1 desktop: /Applications/Ivy Tendril.app (CFBundleShortVersionString 1.2.4, .NET 10.0.12), launched with open -n --args --desktop');
  r.notes.push('V2 desktop: target/release/bundle/macos/Tendril.app adopting an external daemon (TENDRIL_SKIP_SERVICE_PROVISION=1)');
  r.notes.push('window sizes: V1 1800x1200, V2 1280x800');
  results.push(r);
}

// ---------------------------------------------------------------------------------------------
// run.json

const env = {
  capturedAt: '2026-09-22T08:59:41.207+02:00',
  hostname: 'bench-host',
  machine: { model: 'Mac16,5', cpu: 'Apple M4 Max', logicalCpus: 16, physicalCpus: 16, perfCores: 12, efficiencyCores: 4, memBytes: 51_539_607_552, pageSize: 16384 },
  os: { productName: 'macOS', productVersion: '27.0', buildVersion: '26A5289h', kernel: '27.0.0', arch: 'arm64' },
  power: { source: 'AC Power', raw: null, lowPowerMode: '0', powerMode: '0' },
  thermal: { warning: false, raw: null },
  loadavg: [1.21, 1.65, 2.02],
  uptime: '9:00  up 3 days,  1:12, 4 users, load averages: 1.21 1.65 2.02',
  memoryPressure: { freePercent: 61, raw: null },
  topProcesses: [
    { pid: 511, cpu: 12.4, rssKiB: 402_112, command: '/Applications/Slack.app/Contents/MacOS/Slack' },
    { pid: 822, cpu: 6.1, rssKiB: 188_004, command: '/System/Library/CoreServices/WindowServer' },
    { pid: 1301, cpu: 3.3, rssKiB: 96_480, command: '/usr/libexec/mds_stores' },
    { pid: 4242, cpu: 2.0, rssKiB: 81_220, command: 'node' },
    { pid: 97, cpu: 0.9, rssKiB: 22_004, command: '/usr/libexec/logd' },
  ],
  tools: {
    node: 'v26.0.0',
    pnpm: '11.25.0',
    rustc: 'rustc 1.98.1 (e9d1b0b3a 2026-08-06)',
    cargo: 'cargo 1.98.1 (a7e6d9f1c 2026-07-30)',
    dotnet: '10.0.203',
    dotnetRuntimes: 'Microsoft.NETCore.App 10.0.7',
    git: 'git version 2.50.1',
    cc: 'Apple clang version 21.0.0 (clang-2100.0.1.1)',
    gh: 'gh version 2.80.0 (2026-08-20)',
    brotli: 'brotli 1.1.0',
    gzip: 'Apple gzip 479',
    xcodeSelect: '/Library/Developer/CommandLineTools',
  },
  playwright: { version: '1.63.0', chromium: { revision: '1243', version: '153.0.8010.12' }, headlessShell: { revision: '1243', version: '153.0.8010.12' } },
  apps: {
    v1: {
      ref: 'v1.2.4',
      expectedSha: V1_SHA,
      cloneSha: V1_SHA,
      cloneDirty: 0,
      binaries: [
        { path: '/Users/bench/Desktop/tendril-benchmark/builds/v1-publish/Ivy.Tendril', exists: true, bytes: 165_963_484, version: '1.2.4', frameworks: [{ name: 'Microsoft.NETCore.App', version: '10.0.7' }, { name: 'Microsoft.AspNetCore.App', version: '10.0.7' }], appBundleVersion: null },
        { path: '/Applications/Ivy Tendril.app/Contents/MacOS/Ivy.Tendril', exists: true, bytes: 165_830_496, version: '1.2.4', frameworks: [{ name: 'Microsoft.NETCore.App', version: '10.0.12' }, { name: 'Microsoft.AspNetCore.App', version: '10.0.12' }], appBundleVersion: '1.2.4' },
      ],
    },
    v2: { ref: V2_REF_DEFAULT, cloneSha: V2_REF_DEFAULT, cloneDirty: 0, bin: '/Users/bench/Desktop/tendril-benchmark/ivy-tendril-v2/target/release/tendril', binBytes: 38_940_096, version: 'tendril 0.1.0', distPresent: true },
  },
  harness: { node: 'v26.0.0', pid: 4242, argv: ['run', '--profile', 'full', '--quiet-load', '2'], benchSha: '0f3c2a9d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39', benchDirty: 0 },
  scrubbedVarsPresent: ['TENDRIL_HOME'],
};

const suiteStatus: Record<string, string> = {};
for (const r of results) suiteStatus[r.suite] = r.failures.length ? 'failures' : 'ok';

const info: RunInfo = {
  runId: RUN_ID,
  profile: PROFILE,
  createdAt: '2026-09-22T08:59:40.012+02:00',
  updatedAt: results[results.length - 1]!.finishedAt,
  status: 'complete',
  suitesRequested: results.map((r) => r.suite),
  datasets: ['empty', 'small', 'medium', 'large'],
  apps: ['v1', 'v2'],
  pins: { v1Ref: 'v1.2.4', v1Sha: V1_SHA, v2Ref: V2_REF_DEFAULT, v2Sha: V2_REF_DEFAULT },
  env,
  buildInfo: {
    createdAt: '2026-09-22T08:12:40.551+02:00',
    v1: { ref: 'v1.2.4', sha: V1_SHA, serverBinary: '/Users/bench/Desktop/tendril-benchmark/builds/v1-publish/Ivy.Tendril', desktopApp: '/Applications/Ivy Tendril.app', installer: 'IvyTendril-1.2.4-osx-arm64.pkg' },
    v2: { sha: V2_REF_DEFAULT, cargoProfile: 'release', tauriBundle: 'target/release/bundle/macos/Tendril.app', dmg: 'target/release/bundle/dmg/Tendril_0.1.0_aarch64.dmg', shim: 'builds/v2-shim/target/release/v2shim' },
  },
  options: { synthetic: true, quietLoad: 2, quietTimeoutSec: 600, datasetOverride: null, apps: ['v1', 'v2'], knobs },
  invocations: [
    { argv: ['run', '--profile', 'full', '--quiet-load', '2'], startedAt: '2026-09-22T08:59:40.012+02:00', finishedAt: results[results.length - 1]!.finishedAt, status: 'complete', suites: results.map((r) => r.suite), suiteStatus },
  ],
  suiteStatus,
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'results'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'run.json'), `${JSON.stringify(info, null, 2)}\n`);
for (const r of results) fs.writeFileSync(path.join(OUT, 'results', `${r.suite}.json`), `${JSON.stringify(r)}\n`);
let total = 0;
for (const f of fs.readdirSync(path.join(OUT, 'results'))) total += fs.statSync(path.join(OUT, 'results', f)).size;
process.stdout.write(`wrote ${results.length} suite fixtures (${results.reduce((s, r) => s + r.metrics.length, 0)} metrics, ${(total / 1e6).toFixed(2)} MB) to ${OUT}\n`);
