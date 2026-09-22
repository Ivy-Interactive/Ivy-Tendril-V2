// `report`: turns a run's raw results into benchmark.md, SVG charts and a committed copy of the raw
// JSON. Nothing in the report is typed by hand except analysis.md, which is injected verbatim when
// its front matter names this run.
//
//   node src/benchmark/bin/tendril-bench.ts report [--run <runId>] [--out <file.md>] [--analysis <file.md>]
//   node src/benchmark/bin/tendril-bench.ts report --fixtures [--out <file.md>]
//
// The output is a pure function of the inputs: bootstrap resampling is seeded per metric, ordering
// follows the results files, and no clock or locale is read, so regenerating from the same results
// gives byte-identical markdown and SVG.
//
// Suites own their metric names. The per-suite tables and the appendix render every metric generically;
// only the headline and the curated charts look for specific names (the ones in the spec), and each
// of those silently drops out when its metric is absent rather than guessing. What they look for:
//
//   startup  scenarios first-start / warm-start; data_ready_ms, http_ready_ms, footprint_at_ready_mib
//   idle     footprint_mean_mib, cpu_percent_mean; series whose name or scenario contains "footprint"
//   api      scenarios plans.list, plans.get, plans.update (or the literal request line); latency_ms
//            with meta.responseBytes; load levels as "<scenario>@c<N>" (or meta.concurrency) with
//            throughput_rps, server_peak_footprint_mib, server_cpu_s (+ meta.requests or
//            meta.durationSec for the derived CPU per request)
//   ui       cold-load (content_ready_ms and the other *_ms milestones), navigate:<view> and
//            nav-under-load:<view> (nav_first_ms, nav_ms), push-rest / push-fs, *_footprint_mib
//   desktop  footprint_end_mib with meta.byRole (numbers, arrays, or procstat Agg objects), *_ms
//            launch milestones, footprint series
//   cli      "plan list" wall_ms, peak_footprint_mib
//   size     dataset null, 'bytes' (+ bytes_gzip9, bytes_brotli11), scenarios installer,
//            installed-app, frontend/eager-js...; component breakdowns as "<parent>/<name>" or
//            meta.parent (optional meta.group), or meta.components on the parent
//
// Any metric may set meta.deterministic (compared exactly, like sizes).

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  BENCH_ROOT,
  DATASETS,
  DATASET_NAMES,
  LOAD_SAMPLE_MS,
  PROFILES,
  READY_POLL_MS,
  REPO_ROOT,
  SCRUBBED_ENV_VARS,
  TIMEOUTS,
  V1_REF,
  V1_SHA,
  isProfileName,
  type CommandContext,
  type ProfileKnobs,
} from '../lib/config.ts';
import { latestCompleteRun, listRuns, readRunInfo, readSuiteResults, runDirFor, type AppId, type Metric, type RunInfo, type SeriesEntry, type SuiteResult } from '../lib/results.ts';
import { SIGNIFICANCE_P, bootstrapMedianCI, fmtInt, mannWhitneyU, normalSf, ratioCI, seedFrom, summarize, type CI, type MwuResult, type Summary } from '../lib/stats.ts';
import {
  advantageChart,
  groupedBarChart,
  lineChart,
  stackedBarChart,
  timeSeriesChart,
  MAX_COMPONENTS,
  type AdvantageRow,
  type BarGroup,
  type LinePoint,
  type SeriesKey,
} from './charts.ts';

// ---------------------------------------------------------------------------------------------
// Constants that define the statistics (also printed in the methodology, so they cannot drift)

const BOOT_ITERS = 2000;
const ALPHA = 0.05;
/** Significant differences smaller than this are reported as "within 5%" rather than a win. */
const PRACTICAL = 0.05;
/**
 * Below this many samples a percentile bootstrap interval is just the sample range and would
 * overstate what is known, so tables show the range instead and charts draw no whisker.
 */
const MIN_CI_N = 5;
/** Deterministic measurements (file sizes) differing by less than this are "the same". */
const EXACT_SAME = 0.01;
/** Coefficient of variation above which a set of repeated runs is flagged as noisy. */
const NOISY_CV = 0.25;
/** From this many samples (per-request latencies), noise is judged by the median's interval instead. */
const LARGE_N = 50;
/** Relative width of the median's 95% interval above which a large sample set is flagged. */
const WIDE_CI = 0.2;
/** 1-minute load average at the start of a suite at or above which the suite is flagged. */
const LOAD_FLAG = 2;

const SUITE_ORDER = ['size', 'cli', 'startup', 'idle', 'api', 'ui', 'network', 'desktop'];
const APPS: readonly AppId[] = ['v1', 'v2'];
const FIXTURES_DIR = path.join(BENCH_ROOT, 'report', 'fixtures');

// ---------------------------------------------------------------------------------------------
// Entry point

export async function main(ctx: CommandContext): Promise<number> {
  const { values } = parseArgs({
    args: ctx.argv,
    options: {
      run: { type: 'string' },
      fixtures: { type: 'boolean' },
      out: { type: 'string' },
      analysis: { type: 'string' },
      workspace: { type: 'string' },
      profile: { type: 'string' },
      'v2-ref': { type: 'string' },
      verbose: { type: 'boolean' },
    },
    strict: false,
    allowPositionals: true,
  });
  const log = ctx.log;
  const fixtures = values.fixtures === true;
  if (fixtures && typeof values.run === 'string') {
    log.error('pass either --run or --fixtures, not both');
    return 2;
  }

  let runDir: string;
  if (fixtures) {
    runDir = FIXTURES_DIR;
  } else if (typeof values.run === 'string') {
    runDir = runDirFor(ctx.ws, values.run);
    if (!fs.existsSync(path.join(runDir, 'run.json'))) {
      log.error(`no run ${values.run} in ${ctx.paths.runs} (runs: ${listRuns(ctx.ws).map((r) => r.runId).join(', ') || 'none'})`);
      return 2;
    }
  } else {
    const latest = latestCompleteRun(ctx.ws);
    if (!latest) {
      const all = listRuns(ctx.ws);
      log.error(`no complete run in ${ctx.paths.runs}; pass --run <runId>${all.length ? ` (runs: ${all.map((r) => `${r.runId} [${r.info?.status ?? '?'}]`).join(', ')})` : ''}`);
      return 2;
    }
    runDir = latest.dir;
  }

  const info = readRunInfo(runDir);
  if (!info) {
    log.error(`no run.json in ${runDir}`);
    return 2;
  }
  const results = readSuiteResults(runDir);
  if (!results.length) log.warn(`run ${info.runId} has no suite results yet; the report will only describe the setup`);

  // A fixture report must never land on the committed report by accident.
  const defaultOut = fixtures ? path.join(ctx.paths.runs, 'fixtures-report', 'benchmark.md') : path.join(BENCH_ROOT, 'benchmark.md');
  const outFile = path.resolve(typeof values.out === 'string' ? values.out : defaultOut);
  const outDir = path.dirname(outFile);
  const analysisFile = path.resolve(typeof values.analysis === 'string' ? values.analysis : path.join(BENCH_ROOT, 'analysis.md'));

  const t0 = performance.now();
  const model = buildModel(info, results, { fixtures, runDir });
  const doc = render(model, { analysisFile, outDir, fixtures });

  // Charts: write the new set, then remove SVGs a previous report left behind.
  const chartsDir = path.join(outDir, 'charts');
  fs.mkdirSync(chartsDir, { recursive: true });
  const written = new Set<string>();
  for (const c of doc.charts) {
    fs.writeFileSync(path.join(chartsDir, c.file), c.svg);
    written.add(c.file);
  }
  for (const f of fs.readdirSync(chartsDir)) {
    if (f.endsWith('.svg') && !written.has(f)) fs.rmSync(path.join(chartsDir, f));
  }

  // Raw results next to the report (JSON only), copied byte for byte.
  if (!fixtures) {
    const dest = path.join(outDir, 'results', info.runId);
    fs.mkdirSync(path.join(dest, 'results'), { recursive: true });
    fs.copyFileSync(path.join(runDir, 'run.json'), path.join(dest, 'run.json'));
    const srcResults = path.join(runDir, 'results');
    const keep = new Set<string>();
    for (const f of fs.existsSync(srcResults) ? fs.readdirSync(srcResults).filter((x) => x.endsWith('.json')).sort() : []) {
      fs.copyFileSync(path.join(srcResults, f), path.join(dest, 'results', f));
      keep.add(f);
    }
    for (const f of fs.readdirSync(path.join(dest, 'results'))) if (!keep.has(f)) fs.rmSync(path.join(dest, 'results', f));
    const others = fs.readdirSync(path.join(outDir, 'results')).filter((d) => d !== info.runId);
    if (others.length) log.warn(`${path.join(outDir, 'results')} also holds results of other runs (${others.join(', ')}); benchmark.md only describes ${info.runId}`);
  }

  fs.writeFileSync(outFile, doc.markdown);
  log.info(`report for run ${info.runId}${fixtures ? ' (synthetic fixtures)' : ''}: ${model.cmps.length} comparisons, ${doc.charts.length} charts, ${(performance.now() - t0).toFixed(0)} ms`);
  log.info(`wrote ${outFile}`);
  log.info(`wrote ${doc.charts.length} SVG(s) to ${chartsDir}`);
  for (const w of doc.warnings) log.warn(w);
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Model: every (suite, scenario, dataset, metric) with its per-app statistics and the comparison

interface Side {
  m: Metric;
  s: Summary;
  ci: CI;
}

type VerdictKind = 'better' | 'ns' | 'same' | 'one-sided' | 'no-data';
/**
 * test: Mann-Whitney U can reach p < SIGNIFICANCE_P with these sample sizes; exact: deterministic
 * measurements (sizes); few: too few samples for any test to reach the threshold (n = 1, or for
 * example 2 or 3 runs per app), so the comparison is by value.
 */
type Basis = 'test' | 'exact' | 'few';

interface Verdict {
  kind: VerdictKind;
  winner: AppId | null;
  basis: Basis;
  /** Smallest sample count of the two apps. */
  minN: number;
  p: number | null;
  /** How many times better V2 is than V1 (<1: V1 better), with the CI mapped from the ratio CI. */
  adv: number | null;
  advLo: number | null;
  advHi: number | null;
}

interface Cmp {
  id: string;
  suite: string;
  scenario: string;
  dataset: string | null;
  metric: string;
  unit: string;
  better: 'lower' | 'higher';
  v1: Side | null;
  v2: Side | null;
  ratio: CI | null;
  mwu: MwuResult | null;
  verdict: Verdict;
  failures: Record<AppId, number>;
  /** Order keys (first appearance in the suite file). */
  order: [number, number, number];
}

interface Model {
  info: RunInfo;
  runDir: string;
  fixtures: boolean;
  results: Map<string, SuiteResult>;
  suites: string[];
  cmps: Cmp[];
  bySuite: Map<string, Cmp[]>;
  knobs: ProfileKnobs | null;
  labels: Record<AppId, string>;
  /** Children of size artifacts (component breakdowns), excluded from the generic size tables. */
  sizeChildren: Map<string, ChildEntry[]>;
  childIds: Set<string>;
}

interface ChildEntry {
  app: AppId;
  name: string;
  group: string | null;
  bytes: number;
}

function datasetRank(d: string | null): number {
  if (d === null) return -1;
  const i = (DATASET_NAMES as readonly string[]).indexOf(d);
  return i >= 0 ? i : 100;
}

function isDeterministic(m: Metric, suite: string): boolean {
  return suite === 'size' || m.meta?.deterministic === true;
}

function sideOf(m: Metric, seedKey: string): Side {
  const xs = m.samples.filter((x) => Number.isFinite(x));
  return { m, s: summarize(xs), ci: bootstrapMedianCI(xs, { iters: BOOT_ITERS, alpha: ALPHA, seed: seedFrom(seedKey) }) };
}

/**
 * The smallest two-sided p-value a Mann-Whitney U test can produce for these sample sizes (complete
 * separation). With 2 runs per app it is 0.33 and with 3 it is 0.10, so no difference could ever be
 * "significant" at 0.01 and the report must not call a real difference "not significant".
 */
export function minAchievableP(n1: number, n2: number): number {
  if (n1 < 1 || n2 < 1) return 1;
  if (n1 <= 8 && n2 <= 8) {
    let comb = 1;
    for (let i = 1; i <= n1; i++) comb = (comb * (n2 + i)) / i;
    return Math.min(1, 2 / comb);
  }
  const sigma = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  const z = (n1 * n2 - (n1 * n2) / 2 - 0.5) / sigma;
  return Math.min(1, 2 * normalSf(z));
}

function verdictOf(c: Omit<Cmp, 'verdict'>, deterministic: boolean): Verdict {
  const none: Verdict = { kind: 'no-data', winner: null, basis: 'test', minN: 0, p: null, adv: null, advLo: null, advHi: null };
  if (!c.v1 || !c.v2) return { ...none, kind: c.v1 || c.v2 ? 'one-sided' : 'no-data' };
  if (c.v1.s.n === 0 || c.v2.s.n === 0) return none;
  const a = c.v1.s.median;
  const b = c.v2.s.median;
  const lowerBetter = c.better === 'lower';
  // Advantage of V2: >1 means V2 is better by that factor.
  let adv: number;
  if (a === b) adv = 1;
  else if (lowerBetter) adv = b === 0 ? Infinity : a / b;
  else adv = a === 0 ? Infinity : b / a;
  let advLo: number | null = null;
  let advHi: number | null = null;
  if (c.ratio && Number.isFinite(c.ratio.lo) && Number.isFinite(c.ratio.hi) && c.ratio.iters > 0 && hasCi(c.v1) && hasCi(c.v2)) {
    if (lowerBetter) {
      advLo = c.ratio.hi > 0 ? 1 / c.ratio.hi : null;
      advHi = c.ratio.lo > 0 ? 1 / c.ratio.lo : null;
    } else {
      advLo = c.ratio.lo;
      advHi = c.ratio.hi;
    }
  }
  const winner: AppId | null = adv > 1 ? 'v2' : adv < 1 ? 'v1' : null;
  const rel = Number.isFinite(adv) && adv > 0 ? Math.abs(Math.log(adv)) : Infinity;
  const minN = Math.min(c.v1.s.n, c.v2.s.n);
  const base = { minN, adv, advLo, advHi };
  if (deterministic) {
    const same = a === b || rel < Math.log(1 + EXACT_SAME);
    return { ...base, kind: same ? 'same' : 'better', winner: same ? null : winner, basis: 'exact', p: null };
  }
  const practicallySame = rel < Math.log(1 + PRACTICAL);
  if (minAchievableP(c.v1.s.n, c.v2.s.n) >= SIGNIFICANCE_P) {
    if (practicallySame) return { ...base, kind: 'same', winner: null, basis: 'few', p: null };
    if (minN === 1) return { ...base, kind: 'better', winner, basis: 'few', p: null };
    // With a handful of runs the strongest available evidence is complete separation: every run
    // of one app beat every run of the other.
    const separated = c.mwu !== null && (c.mwu.U1 === 0 || c.mwu.U1 === c.v1.s.n * c.v2.s.n);
    return { ...base, kind: separated ? 'better' : 'ns', winner: separated ? winner : null, basis: 'few', p: c.mwu?.p ?? null };
  }
  const p = c.mwu?.p ?? NaN;
  if (!(p < SIGNIFICANCE_P)) return { ...base, kind: 'ns', winner: null, basis: 'test', p: Number.isFinite(p) ? p : null };
  return { ...base, kind: practicallySame ? 'same' : 'better', winner: practicallySame ? null : winner, basis: 'test', p };
}

function buildModel(info: RunInfo, results: SuiteResult[], o: { fixtures: boolean; runDir: string }): Model {
  const bySuiteResult = new Map<string, SuiteResult>();
  for (const r of results) bySuiteResult.set(r.suite, r);
  const suites = [...bySuiteResult.keys()].sort((a, b) => {
    const ia = SUITE_ORDER.indexOf(a);
    const ib = SUITE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a < b ? -1 : a > b ? 1 : 0);
  });

  const { children, childIds } = sizeBreakdowns(bySuiteResult.get('size'));

  const cmps: Cmp[] = [];
  suites.forEach((suite, si) => {
    const r = bySuiteResult.get(suite)!;
    const scenarioOrder = new Map<string, number>();
    const metricOrder = new Map<string, number>();
    const groups = new Map<string, Metric[]>();
    for (const m of withDerived(r.metrics)) {
      if (!scenarioOrder.has(m.scenario)) scenarioOrder.set(m.scenario, scenarioOrder.size);
      if (!metricOrder.has(m.metric)) metricOrder.set(m.metric, metricOrder.size);
      const k = `${m.scenario}\u0000${m.dataset ?? ''}\u0000${m.metric}`;
      const g = groups.get(k);
      if (g) g.push(m);
      else groups.set(k, [m]);
    }
    for (const ms of groups.values()) {
      const first = ms[0]!;
      const id = `${suite}|${first.scenario}|${first.dataset ?? '-'}|${first.metric}`;
      const pick = (app: AppId) => ms.find((m) => m.app === app) ?? null;
      const m1 = pick('v1');
      const m2 = pick('v2');
      const v1 = m1 ? sideOf(m1, `${id}|v1`) : null;
      const v2 = m2 ? sideOf(m2, `${id}|v2`) : null;
      const fin = (m: Metric | null) => (m ? m.samples.filter((x) => Number.isFinite(x)) : []);
      const ratio = v1 && v2 && v1.s.n && v2.s.n ? ratioCI(fin(m1), fin(m2), { iters: BOOT_ITERS, alpha: ALPHA, seed: seedFrom(`${id}|ratio`) }) : null;
      const mwu = v1 && v2 && v1.s.n >= 2 && v2.s.n >= 2 ? mannWhitneyU(fin(m1), fin(m2)) : null;
      const failures: Record<AppId, number> = { v1: 0, v2: 0 };
      for (const f of r.failures) {
        if (f.scenario === first.scenario && (f.dataset ?? null) === (first.dataset ?? null) && (f.app === 'v1' || f.app === 'v2')) failures[f.app]++;
      }
      const base: Omit<Cmp, 'verdict'> = {
        id,
        suite,
        scenario: first.scenario,
        dataset: first.dataset ?? null,
        metric: first.metric,
        unit: String(first.unit),
        better: first.better === 'higher' ? 'higher' : 'lower',
        v1,
        v2,
        ratio,
        mwu,
        failures,
        order: [si, scenarioOrder.get(first.scenario)!, metricOrder.get(first.metric)!],
      };
      cmps.push({ ...base, verdict: verdictOf(base, isDeterministic(first, suite)) });
    }
  });
  cmps.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || datasetRank(a.dataset) - datasetRank(b.dataset) || cmpStr(a.dataset ?? '', b.dataset ?? '') || a.order[2] - b.order[2]);
  const bySuite = new Map<string, Cmp[]>();
  for (const c of cmps) {
    const l = bySuite.get(c.suite);
    if (l) l.push(c);
    else bySuite.set(c.suite, [c]);
  }

  const knobsRaw = (info.options as { knobs?: ProfileKnobs } | undefined)?.knobs;
  const knobs = knobsRaw && typeof knobsRaw === 'object' ? knobsRaw : isProfileName(info.profile) ? PROFILES[info.profile] : null;
  const v2Sha = info.pins?.v2Sha ?? info.pins?.v2Ref ?? '';
  const labels: Record<AppId, string> = {
    v1: `V1 ${info.pins?.v1Ref ?? V1_REF}`,
    v2: `V2 ${v2Sha ? v2Sha.slice(0, 7) : 'dev'}`,
  };
  return { info, runDir: o.runDir, fixtures: o.fixtures, results: bySuiteResult, suites, cmps, bySuite, knobs, labels, sizeChildren: children, childIds };
}

/**
 * Server CPU over a fixed load window grows with the work done, so an app that serves 20x more
 * requests "uses more CPU". CPU per request is the comparable number; it is derived (and labelled
 * so) when the suite recorded how many requests the window served.
 */
function withDerived(metrics: Metric[]): Metric[] {
  const out: Metric[] = [];
  for (const m of metrics) {
    out.push(m);
    if (m.metric !== 'server_cpu_s') continue;
    let requests = metaNumber(m, ['requests', 'okRequests', 'ok', 'completed']);
    if (requests === null) {
      const tp = metrics.find((x) => x.metric === 'throughput_rps' && x.scenario === m.scenario && x.app === m.app && x.dataset === m.dataset);
      const dur = metaNumber(tp ?? m, ['durationSec', 'duration_s']);
      const rps = tp?.samples.find((x) => Number.isFinite(x));
      if (dur !== null && rps !== undefined) requests = rps * dur;
    }
    if (!requests || requests <= 0) continue;
    out.push({
      ...m,
      metric: 'server_cpu_ms_per_request',
      unit: 'ms',
      samples: m.samples.map((x) => (x * 1000) / requests!),
      meta: { ...(m.meta ?? {}), derived: 'server_cpu_s x 1000 / requests served in the window', requests },
    });
  }
  return out;
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Size breakdowns: a child is a 'bytes' metric whose meta.parent names another scenario, or whose
// scenario is "<parent>/<name>" (also ":" or " > ") for an existing parent scenario. A parent may
// instead carry meta.components {name: bytes}.

const CHILD_SEPARATORS = ['/', ':', ' > '];

function sizeBreakdowns(r: SuiteResult | undefined): { children: Map<string, ChildEntry[]>; childIds: Set<string> } {
  const children = new Map<string, ChildEntry[]>();
  const childIds = new Set<string>();
  if (!r) return { children, childIds };
  const byteMetrics = r.metrics.filter((m) => m.metric === 'bytes');
  const scenarios = [...new Set(byteMetrics.map((m) => m.scenario))];
  const add = (parent: string, e: ChildEntry) => {
    const l = children.get(parent);
    if (l) l.push(e);
    else children.set(parent, [e]);
  };
  for (const m of byteMetrics) {
    const metaParent = typeof m.meta?.parent === 'string' ? m.meta.parent : null;
    let parent: string | null = metaParent && scenarios.includes(metaParent) && metaParent !== m.scenario ? metaParent : null;
    let name = m.scenario;
    if (!parent) {
      let best = '';
      for (const s of scenarios) {
        if (s === m.scenario || s.length <= best.length) continue;
        const sep = CHILD_SEPARATORS.find((x) => m.scenario.startsWith(s + x));
        if (sep) best = s;
      }
      if (best) parent = best;
    }
    if (!parent) continue;
    const sep = CHILD_SEPARATORS.find((x) => m.scenario.startsWith(parent + x));
    if (sep) name = m.scenario.slice(parent.length + sep.length);
    if (typeof m.meta?.component === 'string') name = m.meta.component;
    const bytes = m.samples.find((x) => Number.isFinite(x));
    if (bytes === undefined) continue;
    add(parent, { app: m.app, name, group: typeof m.meta?.group === 'string' ? m.meta.group : null, bytes });
    childIds.add(`size|${m.scenario}|${m.dataset ?? '-'}|${m.metric}`);
  }
  for (const m of byteMetrics) {
    const comps = m.meta?.components;
    if (!comps || typeof comps !== 'object' || children.has(m.scenario)) continue;
    const groups = (m.meta?.componentGroups ?? {}) as Record<string, unknown>;
    for (const [name, v] of Object.entries(comps as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) add(m.scenario, { app: m.app, name, group: typeof groups[name] === 'string' ? (groups[name] as string) : null, bytes: v });
    }
  }
  return { children, childIds };
}

/** Like-for-like grouping for app bundles whose component names differ between V1 and V2. */
function classifyComponent(name: string): string {
  const s = name.toLowerCase();
  if (/dotnet|powershell|\bsdk\b|toolchain|runtime pack/.test(s)) return 'bundled toolchains';
  if (/ivy-agent|opencode|sidecar|\bagent\b/.test(s)) return 'agent sidecar';
  if (/update/.test(s)) return 'updater';
  if (/ivy\.tendril$|tendril-app|(^|\/)tendril$|core|dylib|native|\.so$/.test(s)) return 'core app';
  return 'other';
}

// ---------------------------------------------------------------------------------------------
// Formatting (fixed, locale-independent)

const MIB = 1024 * 1024;

function digits(v: number, unit: string): number {
  const a = Math.abs(v);
  switch (unit) {
    case 'ms':
      return a < 1 ? 3 : a < 10 ? 2 : a < 100 ? 1 : 0;
    case 'MiB':
      return a < 1 ? 2 : 1;
    case 'bytes':
      return a < 1e6 ? 3 : a < 1e8 ? 2 : 1;
    // Display-only unit for byte metrics too small for MB (the network section): v is still bytes.
    case 'KB':
      return a < 1e4 ? 1 : 0;
    case 'count':
      return Number.isInteger(v) ? 0 : a < 10 ? 2 : 1;
    case 'percent':
      return a < 10 ? 2 : 1;
    case 'req/s':
      return a < 100 ? 1 : 0;
    case 'cpu_s':
      return a < 1 ? 3 : a < 10 ? 2 : 1;
    default:
      return a < 1 ? 3 : a < 10 ? 2 : a < 100 ? 1 : 0;
  }
}

/** The number alone, in the report's unit for this kind of metric (bytes become MB). */
function num(v: number, unit: string, d?: number): string {
  if (!Number.isFinite(v)) return 'n/a';
  const x = unit === 'bytes' ? v / 1e6 : unit === 'KB' ? v / 1e3 : v;
  return fmtInt(x, d ?? digits(v, unit));
}

function hasCi(side: Side | null | undefined): boolean {
  return !!side && side.s.n >= MIN_CI_N && side.ci.iters > 0 && Number.isFinite(side.ci.lo) && Number.isFinite(side.ci.hi);
}

function unitText(unit: string): string {
  switch (unit) {
    case 'bytes':
      return 'MB';
    case 'percent':
      return '%';
    case 'cpu_s':
      return 'CPU s';
    case 'count':
      return '';
    default:
      return unit;
  }
}

function withUnit(v: number, unit: string): string {
  if (!Number.isFinite(v)) return 'n/a';
  // A few hundred bytes (network idle traffic, a push) would print as "0.000 MB".
  if (unit === 'bytes' && v !== 0 && Math.abs(v) < 1e4) return fmtPayload(v);
  const u = unitText(unit);
  if (!u) return num(v, unit);
  return unit === 'percent' ? `${num(v, unit)}%` : `${num(v, unit)} ${u}`;
}

/** "median [lo, hi]" with one precision for all three; "median (min to max)" for 2 to 4 samples. */
function ciText(side: Side, unit: string): string {
  const { ci, s } = side;
  if (s.n === 0) return 'n/a';
  if (s.n === 1) return num(s.median, unit);
  const d = digits(s.median, unit);
  if (!hasCi(side)) return `${num(s.median, unit, d)} (${num(s.min, unit, d)} to ${num(s.max, unit, d)})`;
  return `${num(s.median, unit, d)} [${num(ci.lo, unit, d)}, ${num(ci.hi, unit, d)}]`;
}

function fmtFactor(f: number): string {
  if (!Number.isFinite(f)) return 'n/a';
  return f >= 100 ? f.toFixed(0) : f >= 1.1 ? f.toFixed(1) : f.toFixed(2);
}

const WORDS: Record<string, [string, string]> = {
  ms: ['faster', 'slower'],
  MiB: ['less', 'more'],
  bytes: ['smaller', 'larger'],
  cpu_s: ['less CPU', 'more CPU'],
  count: ['fewer', 'more'],
  percent: ['lower', 'higher'],
};

/** "V2 3.2x faster" style, always from V2's point of view. */
function diffWords(c: Cmp): string {
  if (!c.v1 || !c.v2) return c.v1 ? 'V1 only' : c.v2 ? 'V2 only' : 'n/a';
  const a = c.v1.s.median;
  const b = c.v2.s.median;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'n/a';
  if (a === b) return 'identical';
  if (a === 0) return c.unit === 'bytes' ? 'V1 has none' : 'V1 = 0';
  if (b === 0) return c.unit === 'bytes' ? 'V2 has none' : 'V2 = 0';
  const r = b / a;
  if (c.verdict.kind === 'same') return 'about the same';
  const lowerBetter = c.better === 'lower';
  if (lowerBetter) {
    const [good, bad] = /cpu/i.test(c.metric) ? WORDS.cpu_s! : WORDS[c.unit] ?? ['lower', 'higher'];
    return r < 1 ? `V2 ${fmtFactor(1 / r)}x ${good}` : `V2 ${fmtFactor(r)}x ${bad}`;
  }
  return r > 1 ? `V2 ${fmtFactor(r)}x higher` : `V2 ${fmtFactor(1 / r)}x lower`;
}

function improvementWords(c: Cmp): [string, string] {
  if (c.better === 'lower') return /cpu/i.test(c.metric) ? WORDS.cpu_s! : (WORDS[c.unit] ?? ['lower', 'higher']);
  return c.unit === 'req/s' ? ['more throughput', 'less throughput'] : ['higher', 'lower'];
}

/**
 * The "Improvement" column every comparison table carries: how many times better V2 is than V1,
 * worded from V2's side ("13x faster", "6.1x slower") so a regression reads as one without doing
 * arithmetic on a ratio, with the 95% interval of that factor where one exists.
 */
function improvementText(c: Cmp): string {
  if (!c.v1 || !c.v2) return c.v1 ? 'V1 only' : c.v2 ? 'V2 only' : 'n/a';
  const a = c.v1.s.median;
  const b = c.v2.s.median;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'n/a';
  if (a === b) return '1x (identical)';
  if (a === 0) return c.unit === 'bytes' ? 'V1 has none' : 'V1 = 0';
  if (b === 0) return c.unit === 'bytes' ? 'V2 has none' : 'V2 = 0';
  const v = c.verdict;
  const adv = v.adv ?? (c.better === 'lower' ? a / b : b / a);
  const [good, bad] = improvementWords(c);
  const v2Better = adv >= 1;
  const factor = v2Better ? adv : 1 / adv;
  let ci = '';
  if (v.advLo !== null && v.advHi !== null && Number.isFinite(v.advLo) && Number.isFinite(v.advHi) && v.advLo > 0) {
    const lo = v2Better ? v.advLo : 1 / v.advHi;
    const hi = v2Better ? v.advHi : 1 / v.advLo;
    ci = ` [${fmtFactor(lo)}, ${fmtFactor(hi)}]`;
  }
  const text = `${fmtFactor(factor)}x ${v2Better ? good : bad}${ci}`;
  return v.kind === 'same' ? `${text} (about the same)` : text;
}

/** "; every run, n=3" / "; n=1" for comparisons decided without a test. */
function fewNote(c: Cmp): string {
  const v = c.verdict;
  if (v.basis !== 'few') return '';
  if (v.kind === 'better') return v.minN === 1 ? '; n=1' : `; every run, n=${v.minN}`;
  return `; n=${v.minN}`;
}

function pText(c: Cmp): string {
  const v = c.verdict;
  if (v.basis === 'exact') return 'exact';
  if (v.basis === 'few') return `no test (n=${v.minN})`;
  if (v.p === null) return 'n/a';
  return v.p < 0.001 ? '<0.001' : v.p.toFixed(3);
}

function betterText(c: Cmp): string {
  const v = c.verdict;
  const name = (a: AppId) => a.toUpperCase();
  switch (v.kind) {
    case 'better':
      if (v.basis !== 'few') return `**${name(v.winner!)}**`;
      return v.minN === 1 ? `${name(v.winner!)} (n=1)` : `${name(v.winner!)} (every run)`;
    case 'same':
      return v.basis === 'exact' ? 'same' : 'within 5%';
    case 'ns':
      return v.basis === 'few' ? 'unclear' : 'n.s.';
    case 'one-sided':
      return c.v1 ? 'V1 only' : 'V2 only';
    default:
      return 'n/a';
  }
}

function dsLabel(d: string | null): string {
  if (d === null) return '-';
  const spec = (DATASETS as Record<string, { plans: number } | undefined>)[d];
  return spec ? `${d} (${fmtInt(spec.plans)})` : d;
}

function dsLong(d: string | null): string {
  if (d === null) return '';
  const spec = (DATASETS as Record<string, { plans: number; jobs: number } | undefined>)[d];
  return spec ? `${d}, ${fmtInt(spec.plans)} plans` : d;
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function code(s: string): string {
  return `\`${s.replace(/`/g, "'")}\``;
}

/** Home directories are shortened so a committed report does not carry the user name. */
function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~').replace(/^\/private\/tmp\/[^ ]*/, '<tmp>');
}

function table(head: string[], align: Array<'l' | 'r' | 'c'>, rows: string[][]): string {
  const sep = align.map((a) => (a === 'r' ? '---:' : a === 'c' ? ':---:' : '---'));
  return [`| ${head.join(' | ')} |`, `| ${sep.join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

function timeOf(iso: string | undefined): string {
  if (!iso) return '?';
  const m = iso.match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1]! : iso;
}

function durationText(a: string | undefined, b: string | undefined): string {
  if (!a || !b) return '?';
  const ms = Date.parse(b) - Date.parse(a);
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

function metaNumber(m: Metric | undefined | null, keys: string[]): number | null {
  if (!m?.meta) return null;
  for (const k of keys) {
    const v = m.meta[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

const RESPONSE_BYTES_KEYS = ['responseBytes', 'bytesPerResponse', 'response_bytes', 'responseBytesMedian', 'bytes'];

function fmtPayload(b: number): string {
  if (b < 1000) return `${fmtInt(b)} B`;
  if (b < 1e6) return `${fmtInt(b / 1000, b < 10_000 ? 1 : 0)} KB`;
  return `${fmtInt(b / 1e6, 2)} MB`;
}

// ---------------------------------------------------------------------------------------------
// Metric vocabulary (labels only; unknown metrics fall back to their raw name)

const METRIC_LABELS: Record<string, string> = {
  http_ready_ms: 'HTTP ready',
  data_ready_ms: 'Data ready',
  footprint_at_ready_mib: 'Footprint at ready',
  peak_footprint_startup_mib: 'Peak footprint during startup',
  cpu_s_to_ready: 'CPU time to ready',
  footprint_10s_mib: 'Footprint at +10 s',
  footprint_15s_mib: 'Footprint at +15 s',
  footprint_end_mib: 'Footprint at end',
  footprint_mean_mib: 'Mean footprint',
  footprint_mib: 'Footprint',
  cpu_percent_mean: 'Mean CPU (% of one core)',
  idle_wakeups_per_s: 'Idle wakeups per second',
  rss_mib: 'RSS (context only)',
  latency_ms: 'Latency',
  ttfb_ms: 'Time to first byte',
  latency_ms_per_kb: 'Latency per KB of response (derived)',
  throughput_rps: 'Throughput (2xx responses)',
  error_rate: 'Error rate',
  server_peak_footprint_mib: 'Server peak footprint',
  server_cpu_s: 'Server CPU time',
  server_cpu_ms_per_request: 'Server CPU per request (derived)',
  dom_content_loaded_ms: 'DOMContentLoaded',
  load_ms: 'Load event',
  shell_visible_ms: 'Shell visible',
  content_ready_ms: 'Content ready',
  transfer_bytes: 'Transferred bytes',
  request_count: 'Requests',
  js_heap_used_mib: 'JS heap used',
  dom_nodes: 'DOM nodes',
  nav_first_ms: 'Navigation, first visit',
  nav_ms: 'Navigation, revisit',
  push_latency_ms: 'Push latency',
  renderer_footprint_mib: 'Page renderer footprint',
  browser_tree_footprint_mib: 'Browser tree footprint',
  server_tree_footprint_mib: 'Server tree footprint',
  app_process_ms: 'App process started',
  webcontent_spawn_ms: 'WebContent process spawned',
  window_visible_ms: 'Window visible',
  wall_ms: 'Wall time',
  peak_footprint_mib: 'Peak footprint',
  bytes: 'Size',
  bytes_gzip9: 'Size, gzip -9',
  bytes_brotli11: 'Size, brotli 11',
  bytes_brotli9: 'Size, brotli 9',
  files: 'Files',
  ...networkLabels(),
};

/**
 * Network suite metrics: `net_*` is loopback socket traffic of the shipped architecture (V1
 * browser <-> server, V2 host <-> daemon), `ui_*` what the page exchanges with its backend (V2:
 * browser <-> IPC shim, which is in-process IPC in the real app).
 */
function networkLabels(): Record<string, string> {
  const out: Record<string, string> = {};
  const parts: Record<string, string> = {
    total_bytes: 'total bytes',
    down_bytes: 'bytes received (server to client)',
    up_bytes: 'bytes sent (client to server)',
    asset_bytes: 'asset bytes (document, JS, CSS, fonts, images)',
    data_bytes: 'data bytes (everything but assets)',
    ws_bytes: 'WebSocket bytes',
    requests: 'HTTP requests',
    ws_messages: 'WebSocket messages',
    connections: 'TCP connections opened',
    bytes_per_min: 'bytes per minute',
    down_bytes_per_min: 'bytes received per minute',
    requests_per_min: 'HTTP requests per minute',
    ws_messages_per_min: 'WebSocket messages per minute',
  };
  for (const [k, v] of Object.entries(parts)) {
    out[`net_${k}`] = `Loopback socket traffic: ${v}`;
    out[`ui_${k}`] = `UI to backend: ${v}`;
  }
  out.ext_bytes_in = 'External bytes received';
  out.ext_bytes_out = 'External bytes sent';
  out.ext_connections = 'External TCP connections';
  return out;
}

/** Metric label for use mid-sentence: first letter lowered unless it starts an acronym (HTTP, CPU, JS). */
function lowerLabel(metric: string): string {
  const l = metricLabel(metric);
  return /^[A-Z]{2}/.test(l) ? l : l.charAt(0).toLowerCase() + l.slice(1);
}

function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric.replace(/_(ms|mib|pct|s|rps)$/i, '').replace(/_/g, ' ');
}

const SUITE_TITLES: Record<string, string> = {
  size: 'Bundle and install size',
  cli: 'One-shot CLI',
  startup: 'Server startup',
  idle: 'Idle server',
  api: 'HTTP API',
  ui: 'Web UI in headless Chromium',
  network: 'Network traffic',
  desktop: 'Desktop apps (WKWebView)',
};

function suiteTitle(s: string): string {
  return SUITE_TITLES[s] ?? s;
}

function anchor(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/ /g, '-');
}

// ---------------------------------------------------------------------------------------------
// Lookups

function datasetsOf(model: Model, suite: string): string[] {
  const ds = [...new Set((model.bySuite.get(suite) ?? []).map((c) => c.dataset).filter((d): d is string => d !== null))];
  return ds.sort((a, b) => datasetRank(a) - datasetRank(b) || cmpStr(a, b));
}

/** The dataset a suite's headline numbers use: medium, else small, else whatever ran. */
function primaryDataset(model: Model, suite: string): string | null {
  const ds = datasetsOf(model, suite);
  for (const p of ['medium', 'small', 'large', 'empty']) if (ds.includes(p)) return p;
  return ds[0] ?? null;
}

function largestDataset(model: Model, suite: string): string | null {
  const ds = datasetsOf(model, suite).filter((d) => d !== 'empty');
  return ds[ds.length - 1] ?? datasetsOf(model, suite)[0] ?? null;
}

interface Find {
  scenario?: RegExp | string;
  metric: RegExp | string;
  dataset?: string | null;
}

function matches(v: string, p: RegExp | string | undefined): boolean {
  if (p === undefined) return true;
  return typeof p === 'string' ? v === p : p.test(v);
}

function findAll(model: Model, suite: string, f: Find): Cmp[] {
  return (model.bySuite.get(suite) ?? []).filter(
    (c) => matches(c.scenario, f.scenario) && matches(c.metric, f.metric) && (f.dataset === undefined || c.dataset === f.dataset),
  );
}

function findOne(model: Model, suite: string, f: Find): Cmp | null {
  const all = findAll(model, suite, f);
  return all.find((c) => c.v1 && c.v2) ?? all[0] ?? null;
}

/** Concurrency level encoded in a scenario ("plans.list@c8", "plans.list c=8", "plans.list x8") or its meta. */
function concurrencyOf(c: Cmp): number | null {
  const meta = metaNumber(c.v1?.m ?? c.v2?.m, ['concurrency', 'c']);
  if (meta !== null) return meta;
  // Only API scenario names encode a load level; elsewhere a trailing number is an id ("plan get 37").
  if (c.suite !== 'api') return null;
  const m = c.scenario.match(/(?:@c?|\bc=?|\bx|\s)(\d+)$/i);
  return m ? Number(m[1]) : null;
}

function baseScenario(s: string): string {
  return s.replace(/\s*(?:@c?\d+|\bc=?\d+|\bx\d+)$/i, '').trim();
}

// ---------------------------------------------------------------------------------------------
// Rendering

interface Chart {
  file: string;
  svg: string;
  alt: string;
}

interface RenderOptions {
  analysisFile: string;
  outDir: string;
  fixtures: boolean;
}

interface Doc {
  markdown: string;
  charts: Chart[];
  warnings: string[];
}

interface HeadlineRow {
  area: string;
  label: string;
  conc: number | null;
  c: Cmp;
}

function render(model: Model, o: RenderOptions): Doc {
  const charts: Chart[] = [];
  const warnings: string[] = [];
  const addChart = (file: string, svg: string, alt: string): string => {
    charts.push({ file, svg, alt });
    return `![${alt}](charts/${file})`;
  };
  const headline = headlineRows(model);
  const out: string[] = [];
  const { info } = model;

  out.push(`# Tendril V1 vs V2: responsiveness, memory and size`);
  out.push('');
  out.push(`<!-- Generated by \`node src/benchmark/bin/tendril-bench.ts report${o.fixtures ? ' --fixtures' : ` --run ${info.runId}`}\` from the raw results. Do not edit by hand: edit analysis.md or the harness and regenerate. -->`);
  out.push('');
  if (model.fixtures || (info.options as { synthetic?: unknown } | undefined)?.synthetic === true) {
    out.push('> [!WARNING]');
    out.push('> **Synthetic data.** This report was generated from the fixtures in `src/benchmark/report/fixtures/`, which exist to develop the report. None of these numbers were measured. Do not cite them.');
    out.push('');
  }
  out.push(runLine(model));
  out.push('');

  out.push('## Summary');
  out.push('');
  out.push(...summaryBlock(model, headline));
  out.push('');

  out.push('## Headline results');
  out.push('');
  out.push(...headlineBlock(model, headline, addChart));
  out.push('');

  out.push('## Contents');
  out.push('');
  const toc = ['Test environment', 'Methodology', 'Results', ...model.suites.map((s) => `${suiteTitle(s)}`), 'Findings', 'Threats to validity', 'How to reproduce', 'Appendix'];
  for (const t of toc) {
    const indent = model.suites.map(suiteTitle).includes(t) ? '  ' : '';
    out.push(`${indent}- [${t}](#${anchor(t)})`);
  }
  out.push('');

  out.push('## Test environment');
  out.push('');
  out.push(...environmentBlock(model));
  out.push('');

  out.push('## Methodology');
  out.push('');
  out.push(...methodologyBlock(model));
  out.push('');

  out.push('## Results');
  out.push('');
  out.push(`Every table gives medians with a 95% bootstrap confidence interval in brackets. "Improvement (V2 vs V1)" says how many times better or worse V2 is than V1, from V2's side ("13x faster", "2.4x less", "6.1x slower"), computed from the medians, with the 95% bootstrap interval of that factor in brackets where the samples allow one. "p" is the two-sided Mann-Whitney U p-value, and "Better" names the app that is better with p < ${SIGNIFICANCE_P} and a difference of at least ${PRACTICAL * 100}% ("n.s." when not significant, "within 5%" when significant but smaller). With 2 to 4 samples, parentheses give the range of the samples instead of an interval. Where the sample is too small for any test to reach p < ${SIGNIFICANCE_P}, "p" says "no test" and "Better" says "n=1", "every run" or "unclear" (see [Statistics](#methodology)). Full distributions are in the [appendix](#appendix).`);
  out.push('');
  const missingSuites = (info.suitesRequested ?? []).filter((s) => !model.results.has(s));
  if (missingSuites.length) {
    out.push(`> [!NOTE]`);
    out.push(`> No results for: ${missingSuites.map(code).join(', ')} (status: ${missingSuites.map((s) => `${s} ${info.suiteStatus?.[s] ?? 'not run'}`).join(', ')}).`);
    out.push('');
  }
  for (const s of model.suites) {
    out.push(`### ${suiteTitle(s)}`);
    out.push('');
    out.push(...suiteBlock(model, s, addChart));
    out.push('');
  }

  out.push('## Findings');
  out.push('');
  out.push(...findingsBlock(model, headline));
  out.push('');
  out.push('### Analysis');
  out.push('');
  const a = analysisBlock(model, o.analysisFile);
  if (a.warning) warnings.push(a.warning);
  out.push(...a.lines);
  out.push('');

  out.push('## Threats to validity');
  out.push('');
  out.push(...threatsBlock(model));
  out.push('');

  out.push('## How to reproduce');
  out.push('');
  out.push(...reproduceBlock(model));
  out.push('');

  out.push('## Appendix');
  out.push('');
  out.push(...appendixBlock(model));

  const markdown = `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
  if (markdown.includes('\u2014')) warnings.push('the report contains an em dash (U+2014), probably from a suite note or analysis.md');
  return { markdown, charts, warnings };
}

function runLine(model: Model): string {
  const { info } = model;
  const env = info.env as Record<string, unknown>;
  const machine = get(env, 'machine.cpu') ?? get(env, 'machine.model') ?? 'unknown machine';
  const osv = [get(env, 'os.productName'), get(env, 'os.productVersion')].filter(Boolean).join(' ');
  const v2 = info.pins?.v2Sha ?? info.pins?.v2Ref ?? '?';
  const v1 = info.pins?.v1Sha ?? V1_SHA;
  return [
    `**Run** ${code(info.runId)}`,
    `**profile** ${code(info.profile)}`,
    `**status** ${info.status}`,
    `**machine** ${machine}${osv ? `, ${osv}` : ''}`,
    `**V1** ${info.pins?.v1Ref ?? V1_REF} (${String(v1).slice(0, 7)})`,
    `**V2** ${String(v2).slice(0, 7)}`,
    `**started** ${info.createdAt?.slice(0, 16).replace('T', ' ') ?? '?'}`,
  ].join(' · ');
}

function get(obj: unknown, p: string): string | null {
  let cur: unknown = obj;
  for (const k of p.split('.')) {
    if (!cur || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[k];
  }
  if (cur === null || cur === undefined) return null;
  return typeof cur === 'string' ? cur : typeof cur === 'number' || typeof cur === 'boolean' ? String(cur) : null;
}

function getAny(obj: unknown, p: string): unknown {
  let cur: unknown = obj;
  for (const k of p.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

// ---------------------------------------------------------------------------------------------
// Headline

interface HeadlineSpec {
  area: 'Responsiveness' | 'Memory' | 'Size' | 'Network';
  label: string;
  suite: string;
  scenario?: RegExp;
  metric: RegExp;
  dataset: 'primary' | 'largest' | null;
  /** Pick the scenario with the highest concurrency among the matches. */
  maxConcurrency?: boolean;
}

const HEADLINES: HeadlineSpec[] = [
  { area: 'Responsiveness', label: 'Cold start to data ready', suite: 'startup', scenario: /first/i, metric: /^data_ready_ms$/, dataset: 'primary' },
  { area: 'Responsiveness', label: 'Cold start to data ready', suite: 'startup', scenario: /first/i, metric: /^data_ready_ms$/, dataset: 'largest' },
  { area: 'Responsiveness', label: 'Warm restart to data ready', suite: 'startup', scenario: /warm/i, metric: /^data_ready_ms$/, dataset: 'primary' },
  { area: 'Responsiveness', label: 'API: list 50 plans', suite: 'api', scenario: /^(plans\.list|GET \/api\/plans\?limit=50)$/, metric: /^latency_ms$/, dataset: 'primary' },
  { area: 'Responsiveness', label: 'API: list 50 plans', suite: 'api', scenario: /^(plans\.list|GET \/api\/plans\?limit=50)$/, metric: /^latency_ms$/, dataset: 'largest' },
  { area: 'Responsiveness', label: 'API: get one plan', suite: 'api', scenario: /^(plans\.get|GET \/api\/plans\/\S+)$/, metric: /^latency_ms$/, dataset: 'primary' },
  { area: 'Responsiveness', label: 'API: update a plan field', suite: 'api', scenario: /^(plans\.update|PUT \/api\/plans\/\S+)$/, metric: /^latency_ms$/, dataset: 'primary' },
  { area: 'Responsiveness', label: 'API throughput: list plans', suite: 'api', scenario: /plans\.list|GET \/api\/plans\?/, metric: /^throughput_rps$/, dataset: 'primary', maxConcurrency: true },
  { area: 'Responsiveness', label: 'UI cold load to content', suite: 'ui', scenario: /cold/i, metric: /^content_ready_ms$/, dataset: 'primary' },
  { area: 'Responsiveness', label: 'UI navigation to Jobs, revisit', suite: 'ui', scenario: /^nav(?:igat\w*)?\W*jobs$/i, metric: /^nav_ms$/, dataset: 'primary' },
  { area: 'Responsiveness', label: 'Push: REST write to UI badge', suite: 'ui', scenario: /push.?rest/i, metric: /latency/, dataset: 'primary' },
  { area: 'Responsiveness', label: 'CLI: plan list', suite: 'cli', scenario: /plan list/i, metric: /^wall_ms$/, dataset: 'primary' },
  { area: 'Memory', label: 'Idle server footprint', suite: 'idle', metric: /^(footprint_mean|mean_footprint)_mib$/, dataset: 'primary' },
  { area: 'Memory', label: 'Idle server footprint', suite: 'idle', metric: /^(footprint_mean|mean_footprint)_mib$/, dataset: 'largest' },
  { area: 'Memory', label: 'Idle server CPU', suite: 'idle', metric: /^cpu_percent_mean$/, dataset: 'primary' },
  { area: 'Memory', label: 'Server peak footprint, API load', suite: 'api', scenario: /plans\.list|GET \/api\/plans\?/, metric: /^server_peak_footprint_mib$/, dataset: 'primary', maxConcurrency: true },
  { area: 'Memory', label: 'Page renderer footprint after UI flows', suite: 'ui', metric: /^renderer_footprint_mib$/, dataset: 'primary' },
  { area: 'Memory', label: 'Desktop app, whole process tree', suite: 'desktop', metric: /^(tree_)?footprint_(end|final)_mib$/, dataset: 'primary' },
  { area: 'Size', label: 'Installer download', suite: 'size', scenario: /^installer$/i, metric: /^bytes$/, dataset: null },
  { area: 'Size', label: 'Installed app', suite: 'size', scenario: /^installed[- ]app$/i, metric: /^bytes$/, dataset: null },
  { area: 'Size', label: 'Eager frontend JS, brotli 11', suite: 'size', scenario: /eager.?js/i, metric: /^bytes_brotli11$/, dataset: null },
  // Loopback socket bytes of the shipped architecture: V1 browser <-> server, V2 host <-> daemon.
  { area: 'Network', label: 'Loopback bytes: UI cold load', suite: 'network', scenario: /^cold-load$/, metric: /^net_total_bytes$/, dataset: 'primary' },
  { area: 'Network', label: 'Loopback bytes: one push, received', suite: 'network', scenario: /^push$/, metric: /^net_down_bytes$/, dataset: 'primary' },
  { area: 'Network', label: 'Loopback bytes per minute: idle UI', suite: 'network', scenario: /^idle$/, metric: /^net_bytes_per_min$/, dataset: 'primary' },
  { area: 'Network', label: 'Loopback bytes: scripted session', suite: 'network', scenario: /^session$/, metric: /^net_total_bytes$/, dataset: 'primary' },
];

function headlineRows(model: Model): HeadlineRow[] {
  const rows: HeadlineRow[] = [];
  const seen = new Set<string>();
  for (const h of HEADLINES) {
    const ds = h.dataset === 'primary' ? primaryDataset(model, h.suite) : h.dataset === 'largest' ? largestDataset(model, h.suite) : null;
    let cands = findAll(model, h.suite, { scenario: h.scenario, metric: h.metric, dataset: h.dataset === null ? undefined : ds }).filter((c) => c.v1 && c.v2);
    if (h.maxConcurrency) {
      const withC = cands.filter((c) => concurrencyOf(c) !== null);
      if (withC.length) {
        const max = Math.max(...withC.map((c) => concurrencyOf(c)!));
        cands = withC.filter((c) => concurrencyOf(c) === max);
      }
    } else {
      // Prefer the plain scenario over concurrency variants of it.
      const plain = cands.filter((c) => concurrencyOf(c) === null);
      if (plain.length) cands = plain;
    }
    const c = cands[0];
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    rows.push({ area: h.area, label: h.label, conc: h.maxConcurrency ? concurrencyOf(c) : null, c });
  }
  return rows;
}

function headlineLabel(r: HeadlineRow, short = false): string {
  const extra = [r.conc !== null ? `c=${r.conc}` : null, r.c.dataset ? (short ? r.c.dataset : dsLong(r.c.dataset)) : null].filter(Boolean);
  return extra.length ? `${r.label} (${extra.join(', ')})` : r.label;
}

function summaryBlock(model: Model, rows: HeadlineRow[]): string[] {
  const out: string[] = [];
  if (!rows.length) {
    out.push('No headline metric has results for both apps yet, so there is nothing to summarize. The per-suite sections below show whatever was measured.');
    return out;
  }
  const isWin = (r: HeadlineRow, a: AppId) => r.c.verdict.kind === 'better' && r.c.verdict.winner === a;
  const isTie = (r: HeadlineRow) => r.c.verdict.kind === 'ns' || r.c.verdict.kind === 'same';
  const v2 = rows.filter((r) => isWin(r, 'v2'));
  const v1 = rows.filter((r) => isWin(r, 'v1'));
  const tie = rows.filter(isTie);
  const few = rows.filter((r) => r.c.verdict.basis === 'few');
  out.push(
    `**Of ${rows.length} headline comparisons, V2 is better in ${v2.length}, V1 is better in ${v1.length}, and ${tie.length} show no clear difference.** ` +
      `"Better" means a two-sided Mann-Whitney U test at p < ${SIGNIFICANCE_P} and at least ${PRACTICAL * 100}% apart; sizes are exact.` +
      (few.length
        ? ` ${few.length} of them rest on too few runs for such a test (for example n=1 or 2 to 3 runs per app); those are decided by value and marked "every run" (every run of the better app beat every run of the other) or "n=1".`
        : ''),
  );
  out.push('');
  const phrase = (r: HeadlineRow) => {
    const c = r.c;
    return `${headlineLabel(r)}: ${withUnit(c.v1!.s.median, c.unit)} vs ${withUnit(c.v2!.s.median, c.unit)} (${diffWords(c)}${fewNote(c)})`;
  };
  for (const area of ['Responsiveness', 'Memory', 'Size', 'Network'] as const) {
    const ar = rows.filter((r) => r.area === area);
    if (!ar.length) continue;
    const wins2 = ar.filter((r) => isWin(r, 'v2')).sort((a, b) => (b.c.verdict.adv ?? 0) - (a.c.verdict.adv ?? 0));
    const wins1 = ar.filter((r) => isWin(r, 'v1'));
    const ties = ar.filter(isTie);
    out.push(`- **${area}**: V2 better in ${wins2.length} of ${ar.length}, V1 better in ${wins1.length}.`);
    if (wins2.length) out.push(`  - Largest V2 advantages: ${wins2.slice(0, 3).map(phrase).join('; ')}.`);
    if (wins1.length) out.push(`  - V1 better: ${wins1.map(phrase).join('; ')}.`);
    if (ties.length) out.push(`  - No clear difference: ${ties.map(phrase).join('; ')}.`);
  }
  const failures = [...model.results.values()].reduce((s, r) => s + r.failures.length, 0);
  const st = model.info.suiteStatus ?? {};
  const bad = (model.info.suitesRequested ?? []).filter((s) => !model.results.has(s) || (st[s] && st[s] !== 'ok' && st[s] !== 'failures'));
  out.push('');
  if (bad.length) {
    out.push('> [!IMPORTANT]');
    out.push(`> Incomplete run: ${bad.map((s) => `${code(s)} ${model.results.has(s) ? st[s] : `has no results (${st[s] ?? 'not run'})`}`).join(', ')}. Conclusions above cover only the suites that ran.`);
    out.push('');
  }
  out.push(
    `Run status: **${model.info.status}**, ${model.suites.length} suite(s) with results, ${fmtInt(model.cmps.length)} compared metrics, ${failures} recorded failure(s)` +
      `${failures ? ' (see [Findings](#findings))' : ''}. How the numbers were produced and what can bias them: [Methodology](#methodology) and [Threats to validity](#threats-to-validity).`,
  );
  return out;
}

function headlineBlock(model: Model, rows: HeadlineRow[], addChart: (f: string, svg: string, alt: string) => string): string[] {
  const out: string[] = [];
  if (!rows.length) {
    out.push('_No headline metrics available in this run._');
    return out;
  }
  const t: string[][] = [];
  for (const r of rows) {
    const c = r.c;
    t.push([
      r.area,
      mdEscape(headlineLabel(r)),
      withUnit(c.v1!.s.median, c.unit),
      withUnit(c.v2!.s.median, c.unit),
      improvementText(c),
      pText(c),
      betterText(c),
    ]);
  }
  out.push(table(['Area', 'Metric', 'V1 median', 'V2 median', 'Improvement (V2 vs V1) [95% CI]', 'p', 'Better'], ['l', 'l', 'r', 'r', 'l', 'r', 'c'], t));
  out.push('');
  const advRows: AdvantageRow[] = [];
  for (const area of ['Responsiveness', 'Memory', 'Size', 'Network']) {
    const ar = rows.filter((r) => r.area === area);
    if (!ar.length) continue;
    advRows.push({ label: area, heading: true });
    for (const r of ar) {
      const v = r.c.verdict;
      const adv = v.adv !== null && Number.isFinite(v.adv) && v.adv > 0 ? v.adv : undefined;
      const win = v.kind === 'better' ? (v.winner as SeriesKey) : null;
      advRows.push({
        label: headlineLabel(r, true),
        advantage: adv,
        lo: v.advLo ?? undefined,
        hi: v.advHi ?? undefined,
        winner: win,
        untested: v.basis === 'few',
        valueText: adv === undefined ? diffWords(r.c) : adv >= 1 ? `V2 ${fmtFactor(adv)}x` : `V1 ${fmtFactor(1 / adv)}x`,
      });
    }
  }
  const svg = advantageChart({
    title: 'How much better is V2 than V1?',
    subtitle: `Ratio of medians, oriented so that right of "equal" is always better for V2 (faster, smaller, less memory, more throughput). Filled: significant (p < ${SIGNIFICANCE_P}, at least ${PRACTICAL * 100}% apart) or an exact size. Open ring: decided by value on too few runs to test.`,
    rows: advRows,
    labels: { v1: 'V1', v2: 'V2' },
  });
  out.push(addChart('headline.svg', svg, 'Headline: factor by which V2 is better or worse than V1, per metric, log scale'));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Environment

function environmentBlock(model: Model): string[] {
  const { info } = model;
  const env = info.env ?? {};
  const out: string[] = [];
  const rows: string[][] = [];
  const add = (k: string, v: string | null) => {
    if (v) rows.push([k, mdEscape(v)]);
  };
  const mem = Number(get(env, 'machine.memBytes'));
  add(
    'Machine',
    [
      [get(env, 'machine.cpu'), get(env, 'machine.model') ? `(${get(env, 'machine.model')})` : null].filter(Boolean).join(' '),
      get(env, 'machine.logicalCpus') ? `${get(env, 'machine.logicalCpus')} CPUs${get(env, 'machine.perfCores') ? ` (${get(env, 'machine.perfCores')} performance + ${get(env, 'machine.efficiencyCores') ?? '?'} efficiency)` : ''}` : null,
      Number.isFinite(mem) && mem > 0 ? `${fmtInt(mem / 2 ** 30)} GiB memory` : null,
    ]
      .filter(Boolean)
      .join(', '),
  );
  add('OS', [[get(env, 'os.productName'), get(env, 'os.productVersion'), get(env, 'os.buildVersion') ? `(${get(env, 'os.buildVersion')})` : null].filter(Boolean).join(' '), get(env, 'os.kernel') ? `Darwin ${get(env, 'os.kernel')}` : null, get(env, 'os.arch')].filter(Boolean).join(', '));
  add('Power', [get(env, 'power.source'), get(env, 'power.lowPowerMode') !== null ? `low power mode ${get(env, 'power.lowPowerMode') === '0' ? 'off' : get(env, 'power.lowPowerMode')}` : null].filter(Boolean).join(', '));
  const therm = getAny(env, 'thermal.warning');
  add('Thermal', therm === false ? 'no thermal warning recorded' : therm === true ? 'thermal warning recorded' : 'unknown');
  const la = getAny(env, 'loadavg');
  if (Array.isArray(la)) add('Load at run start (1/5/15 min)', `${la.map((x) => Number(x).toFixed(2)).join(' / ')}${get(env, 'memoryPressure.freePercent') ? `; memory free ${get(env, 'memoryPressure.freePercent')}%` : ''}`);
  const tools = (getAny(env, 'tools') ?? {}) as Record<string, unknown>;
  const tool = (k: string) => (typeof tools[k] === 'string' ? (tools[k] as string).split('\n')[0]! : null);
  add('Node / pnpm', [tool('node'), tool('pnpm') ? `pnpm ${tool('pnpm')}` : null].filter(Boolean).join(', '));
  add('Rust (V2 toolchain)', [tool('rustc'), tool('cargo')].filter(Boolean).join(', '));
  add('.NET SDK on the host', tool('dotnet'));
  const pw = get(env, 'playwright.version');
  if (pw) add('Playwright / Chromium', `playwright ${pw}, Chromium ${get(env, 'playwright.chromium.version') ?? '?'} (r${get(env, 'playwright.chromium.revision') ?? '?'}), headless shell r${get(env, 'playwright.headlessShell.revision') ?? '?'}`);
  add('Compressors', [tool('gzip'), tool('brotli')].filter(Boolean).join(', '));
  const v1Sha = info.pins?.v1Sha ?? get(env, 'apps.v1.cloneSha');
  add('V1 under test', `${info.pins?.v1Ref ?? V1_REF} at ${code(String(v1Sha ?? '?'))}${get(env, 'apps.v1.cloneDirty') && get(env, 'apps.v1.cloneDirty') !== '0' ? `, clone has ${get(env, 'apps.v1.cloneDirty')} modified file(s)` : ''}`);
  const bins = getAny(env, 'apps.v1.binaries');
  if (Array.isArray(bins)) {
    for (const b of bins as Array<Record<string, unknown>>) {
      if (!b || b.exists !== true) continue;
      const fw = Array.isArray(b.frameworks) ? (b.frameworks as Array<{ name: string; version: string }>).map((f) => `${f.name.replace('Microsoft.', '')} ${f.version}`).join(', ') : '';
      add('V1 binary', `${code(shortPath(String(b.path)))}: ${typeof b.bytes === 'number' ? `${fmtInt(b.bytes)} B` : '?'}, Tendril ${b.version ?? '?'}${fw ? `, bundles ${fw}` : ''}`);
    }
  }
  const v2Sha = info.pins?.v2Sha ?? get(env, 'apps.v2.cloneSha');
  add('V2 under test', `${code(String(v2Sha ?? info.pins?.v2Ref ?? '?'))}${get(env, 'apps.v2.cloneDirty') && get(env, 'apps.v2.cloneDirty') !== '0' ? `, clone has ${get(env, 'apps.v2.cloneDirty')} modified file(s)` : ''}${get(env, 'apps.v2.version') ? `, ${code(get(env, 'apps.v2.version')!)}` : ''}`);
  const v2b = get(env, 'apps.v2.binBytes');
  if (v2b) add('V2 binary', `${code(shortPath(get(env, 'apps.v2.bin') ?? 'tendril'))}: ${fmtInt(Number(v2b))} B`);
  add('Harness', [get(env, 'harness.benchSha') ? `benchmark at ${code(get(env, 'harness.benchSha')!.slice(0, 12))}` : null, get(env, 'harness.benchDirty') && get(env, 'harness.benchDirty') !== '0' ? `${get(env, 'harness.benchDirty')} uncommitted file(s) in src/benchmark` : null].filter(Boolean).join(', '));
  out.push(table(['Item', 'Value'], ['l', 'l'], rows));
  out.push('');

  const top = getAny(env, 'topProcesses');
  if (Array.isArray(top) && top.length) {
    const busy = (top as Array<{ cpu?: number; command?: string }>)
      .slice(0, 5)
      .map((p) => `${path.basename(String(p.command ?? '?'))} ${Number(p.cpu ?? 0).toFixed(1)}%`)
      .join(', ');
    out.push(`Busiest processes when the run started (CPU % of one core): ${mdEscape(busy)}.`);
    out.push('');
  }

  const bi = info.buildInfo;
  if (bi && typeof bi === 'object') {
    const flat = flatten(bi as Record<string, unknown>, '', 2).slice(0, 40);
    if (flat.length) {
      out.push('<details><summary>Build info (<code>build-info.json</code> at run start)</summary>');
      out.push('');
      out.push(table(['Key', 'Value'], ['l', 'l'], flat.map(([k, v]) => [code(k), mdEscape(shortPath(v))])));
      out.push('');
      out.push('</details>');
      out.push('');
    }
  } else {
    out.push('_No build-info.json was present when the run started._');
    out.push('');
  }

  out.push(`**Load during each suite.** The 1-minute load average is recorded at the start and end of each suite and every ${LOAD_SAMPLE_MS / 1000} s in between. Background load cannot be removed, only recorded; suites that started at or above ${LOAD_FLAG} (or the run's \`--quiet-load\` threshold) are flagged in the findings.`);
  out.push('');
  const lrows: string[][] = [];
  for (const s of model.suites) {
    const r = model.results.get(s)!;
    const ls = r.env?.loadSamples ?? [];
    const med = ls.length ? summarize(ls).median : NaN;
    const max = ls.length ? Math.max(...ls) : NaN;
    lrows.push([
      s,
      info.suiteStatus?.[s] ?? (r.failures.length ? 'failures' : 'ok'),
      timeOf(r.startedAt),
      durationText(r.startedAt, r.finishedAt),
      `${fmtLoad(r.env?.loadavgStart?.[0])} → ${fmtLoad(r.env?.loadavgEnd?.[0])}`,
      `${fmtLoad(med)} / ${fmtLoad(max)}`,
      secondsText(r.env?.quietWaitMs ?? 0),
      String(r.metrics.length),
      String(r.failures.length),
    ]);
  }
  if (lrows.length) out.push(table(['Suite', 'Status', 'Started', 'Duration', 'Load start → end', 'Load median / max', 'Quiet wait', 'Metrics', 'Failures'], ['l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r'], lrows));
  return out;
}

function secondsText(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

function fmtLoad(x: number | undefined): string {
  return x === undefined || !Number.isFinite(x) ? '?' : x.toFixed(2);
}

function flatten(o: Record<string, unknown>, prefix: string, depth: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      if (depth > 0) out.push(...flatten(v as Record<string, unknown>, key, depth - 1));
    } else if (Array.isArray(v)) {
      if (v.every((x) => typeof x !== 'object')) out.push([key, v.join(', ')]);
    } else out.push([key, String(v)]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Methodology (generated from the profile and config so it always matches what ran)

function methodologyBlock(model: Model): string[] {
  const out: string[] = [];
  const k = model.knobs;
  const { info } = model;
  out.push(`**Apps.** V1 is Tendril ${info.pins?.v1Ref ?? V1_REF} (C#/.NET 10, Ivy Framework); V2 is the Rust daemon (axum) plus the Tauri 2 desktop shell with a React/Vite frontend, built from source at the pinned commit. The server suites run V1 as \`Ivy.Tendril --web\` and V2 as \`tendril serve\`. Each app gets its own copy of the same generated dataset, migrated by the app's own migration command, in an isolated home.`);
  out.push('');
  out.push(`**Datasets.** Generated deterministically (seed ${DATASETS.small.seed}), ${DATASETS.small.revisionsPerPlan} revisions of about ${fmtInt(DATASETS.small.revisionBytes / 1024)} KB per plan, state mix ${Object.entries(DATASETS.small.stateMix).map(([s, p]) => `${s} ${p}%`).join(', ')}.`);
  out.push('');
  const used = new Set<string>();
  for (const c of model.cmps) if (c.dataset) used.add(c.dataset);
  out.push(table(['Dataset', 'Plans', 'Jobs', 'Projects', 'Used in this run'], ['l', 'r', 'r', 'r', 'l'], DATASET_NAMES.map((d) => [d, fmtInt(DATASETS[d].plans), fmtInt(DATASETS[d].jobs), fmtInt(DATASETS[d].projects), used.has(d) ? 'yes' : 'no'])));
  out.push('');
  if (k) {
    out.push(`**Iteration counts** (profile \`${info.profile}\`):`);
    out.push('');
    const rows: string[][] = [
      ['server suites: datasets', k.serverDatasets.join(', ')],
      ['desktop: datasets', k.desktopDatasets.join(', ')],
      ['cli: datasets', (k.cliDatasets ?? []).join(', ')],
      ['startup: first starts / warm restarts per dataset and app', `${k.startup.firstStartRuns} / ${k.startup.warmRuns}`],
      ['idle: runs x duration', `${k.idle.runs} x ${k.idle.durationSec} s`],
      ['api: sequential warmup / timed requests per scenario', `${k.api.seqWarmup} / ${k.api.seqSamples}`],
      ['api: concurrency levels x duration', `[${k.api.concurrency.join(', ')}] x ${k.api.concurrencyDurationSec} s (latency samples capped at ${fmtInt(k.api.maxLatencySamples)})`],
      ['ui: cold loads / navigation cycles / REST pushes / file pushes / cycles under load', `${k.ui.coldLoads} / ${k.ui.navCycles} / ${k.ui.pushSamples} / ${k.ui.fsPushSamples} / ${k.ui.navUnderLoadCycles}`],
      ['desktop: warmup + measured runs x duration', `${k.desktop.warmupRuns} + ${k.desktop.runs} x ${k.desktop.durationSec} s`],
      ['cli: warmup / measured runs', `${k.cli.warmup} / ${k.cli.runs}`],
    ];
    // Runs recorded before the network suite existed carry knobs without it.
    const nk = (k as Partial<ProfileKnobs>).network;
    if (nk) rows.push(['network: cold loads / pushes / idle windows / sessions (pushes each) / desktop sampling', `${nk.coldLoads} / ${nk.pushSamples} / ${nk.idleWindows} x ${nk.idleWindowSec} s / ${nk.sessions} (${nk.sessionPushes}) / ${nk.desktopIdleSec} s`]);
    const ov = (info.options ?? {}) as Record<string, unknown>;
    if (Array.isArray(ov.datasetOverride) && ov.datasetOverride.length) rows.push(['dataset override (--dataset)', (ov.datasetOverride as string[]).join(', ')]);
    if (typeof ov.quietLoad === 'number' && ov.quietLoad > 0) rows.push(['quiesce before each suite', `until 1-min load < ${ov.quietLoad} (at most ${ov.quietTimeoutSec ?? '?'} s)`]);
    out.push(table(['Knob', 'Value'], ['l', 'l'], rows));
    out.push('');
  }
  out.push('**Order.** Suites run one at a time: size, cli, startup, idle, api, ui, network, desktop. Repeated measurements of the two apps are interleaved in ABBA order (V1, V2, V2, V1, ...), so a linear drift in machine state (thermals, caches, background load) affects both equally.');
  out.push('');
  out.push('**Memory.** Read with `proc_pid_rusage(RUSAGE_INFO_V4)` by a small native helper (identical to `footprint -p` for both apps).');
  out.push('- `footprint`: sum of `ri_phys_footprint` over the process set (dirty + compressed + swapped + IOKit-owned memory). This is the headline memory number: what Activity Monitor shows as "Memory" and what the kernel uses for jetsam limits, and it means the same thing for a .NET process, a Rust process, WebKit XPC services and Chromium helpers. Reported in MiB (2^20 bytes).');
  out.push('- `peak footprint`: sum of per-process `ri_interval_max_phys_footprint` after resetting the interval at the start of the scenario. A sum of per-process peaks is an upper bound on the simultaneous peak.');
  out.push('- `rss`: sum of resident sizes, for context only (double-counts shared clean pages, misses compressed memory).');
  out.push('- Process sets: the server process and all its descendants; for the desktop apps also the WebKit processes whose responsible pid is the app (they are not its children), and for V2 the daemon.');
  out.push('');
  out.push(`**CPU** is user + system time from the same call, as CPU-seconds or as the mean percent of one core over a window. Idle wakeups are package idle plus interrupt wakeups per second.`);
  out.push('');
  out.push(`**Latency** is measured from just before the request is issued to the last byte of the body, on a keep-alive connection, uncompressed (no \`Accept-Encoding\`). Readiness is polled every ${READY_POLL_MS} ms: HTTP ready is the first successful health response (V1 \`GET /api/ping\`, V2 \`GET /api/health\`); data ready is V1's \`Initial sync complete\` log line, and for V2 the same as HTTP ready (its health endpoint only answers after the initial sync). Throughput is a closed loop of \`c\` workers counting 2xx responses per second.`);
  out.push('');
  out.push(`**UI** timings come from headless Chromium (Playwright). V1 serves its own web UI; V2's frontend runs against the real daemon through an IPC shim that executes the real Tauri command handlers (one extra loopback hop per command). Push latency is measured in the page with a MutationObserver on the plans badge, against the wall-clock time the write was issued.`);
  out.push('');
  out.push(`**Sizes** are apparent bytes (\`lstat\` sizes of regular files, symlinks not followed), never \`du\`; reported in MB (10^6 bytes) with exact bytes in the appendix. Compressed sizes are per file (gzip level 9, brotli quality 11).`);
  out.push('');
  out.push(`**Statistics.** Medians with ${fmtInt((1 - ALPHA) * 100)}% percentile-bootstrap intervals (${fmtInt(BOOT_ITERS)} resamples, seeded per metric, so the report is reproducible byte for byte). V2 vs V1 is the ratio of medians with a bootstrap interval that resamples both groups. A difference counts when a two-sided Mann-Whitney U test gives p < ${SIGNIFICANCE_P} (exact distribution for up to 8 samples per side without ties, otherwise the normal approximation with tie and continuity correction) **and** the medians differ by at least ${PRACTICAL * 100}%. Some metrics have too few samples for that test to ever reach p < ${SIGNIFICANCE_P} (one sample per app, or fewer than 5 runs per app: the smallest possible p is ${minAchievableP(2, 2).toFixed(2)} with 2 runs and ${minAchievableP(3, 3).toFixed(2)} with 3); they are decided by value and labelled "n=1", or "every run" when every run of the better app beat every run of the other (with 2 or more runs and no such separation the result is "unclear"). File sizes are exact (a difference of at least ${EXACT_SAME * 100}% counts). Repeated runs with a coefficient of variation above ${NOISY_CV}, and per-request samples whose median has a 95% interval wider than ${WIDE_CI * 100}% of it, are flagged as noisy.`);
  out.push('');
  out.push(`**Timeouts** are results, not retries: startup ${fmtInt(TIMEOUTS.startupMs / 1000)} s, UI waits ${fmtInt(TIMEOUTS.uiWaitMs / 1000)} s, HTTP requests ${fmtInt(TIMEOUTS.httpRequestMs / 1000)} s, desktop launch ${fmtInt(TIMEOUTS.desktopLaunchMs / 1000)} s, CLI ${fmtInt(TIMEOUTS.cliRunMs / 1000)} s. A failed sample is recorded with its error and the remaining samples still run.`);
  out.push('');
  out.push(`**Isolation.** Every app process gets a per-run \`TENDRIL_HOME\` and an empty \`CLAUDE_CONFIG_DIR\`; these variables are removed from every child environment: ${SCRUBBED_ENV_VARS.map(code).join(' ')}. Ports are free loopback ports. Load is sampled every ${LOAD_SAMPLE_MS / 1000} s.`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Per-suite sections

function suiteIntro(model: Model, suite: string): string {
  const k = model.knobs;
  switch (suite) {
    case 'size':
      return 'No processes are started. V1 is measured from the signed v1.2.4 release installer and its installed app; V2 from the `.app`/`.dmg` built at the pinned commit. Frontend groups are split into what loads before the shell renders ("eager") and everything shipped.';
    case 'cli':
      return `One-shot commands of each app's CLI against a dataset home${k ? ` (${k.cli.warmup} unmeasured + ${k.cli.runs} measured runs per command)` : ''}: wall time from spawn to exit and the peak physical footprint of the process. Only semantically equivalent commands are compared.`;
    case 'startup':
      return `Server start from a freshly restored home ("first start") and restart on the already-synced home ("warm start")${k ? `, ${k.startup.firstStartRuns} and ${k.startup.warmRuns} runs per dataset and app` : ''}, interleaved. Readiness is polled every ${READY_POLL_MS} ms.`;
    case 'idle':
      return `The server alone, no clients${k ? `, ${k.idle.runs} run(s) of ${k.idle.durationSec} s per dataset and app` : ''}, sampled every second after ready; means, CPU and wakeups are over the window after +10 s. Both apps rescan plans periodically, so windows are long enough to include rescans.`;
    case 'api':
      return `One server per dataset and app. Sequential latency per scenario on one keep-alive connection${k ? ` (${k.api.seqWarmup} warmup + ${k.api.seqSamples} timed requests)` : ''}, then closed-loop load${k ? ` at c = ${k.api.concurrency.join(', ')} for ${k.api.concurrencyDurationSec} s each` : ''}. **Payloads differ**: V2's plan list returns full plan objects including the latest revision text, V1's a thin summary; response sizes are shown next to latency.`;
    case 'ui':
      return `Headless Chromium, same flags and viewport for both. Cold load in a fresh browser context, navigation between views (first visit and revisits), push latency from a REST write and from a file edit to the UI, navigation under background API load, and memory after the flows. The V2 frontend runs through the IPC shim, so V2 page timings include one loopback hop per command and the shim's memory is not the Tauri host's.`;
    case 'network':
      return networkIntro(model);
    case 'desktop':
      return `The real desktop apps, both rendering with WKWebView${k ? `, ${k.desktop.warmupRuns} discarded warmup + ${k.desktop.runs} measured launch(es) of ${k.desktop.durationSec} s per dataset` : ''}. The process set is the app, its WebKit processes (found by responsible pid) and, for V2, the daemon. Window sizes differ (V1 1800x1200, V2 1280x800).`;
    default:
      return '';
  }
}

function suiteBlock(model: Model, suite: string, addChart: (f: string, svg: string, alt: string) => string): string[] {
  const r = model.results.get(suite)!;
  const out: string[] = [];
  const intro = suiteIntro(model, suite);
  if (intro) {
    out.push(intro);
    out.push('');
  }
  const ls = r.env?.loadSamples ?? [];
  out.push(
    `_Ran ${timeOf(r.startedAt)} to ${timeOf(r.finishedAt)} (${durationText(r.startedAt, r.finishedAt)}), status ${model.info.suiteStatus?.[suite] ?? (r.failures.length ? 'failures' : 'ok')}, 1-min load ${fmtLoad(r.env?.loadavgStart?.[0])} at start, ${ls.length ? `max ${fmtLoad(Math.max(...ls))}` : 'no samples'}; ${r.metrics.length} metrics, ${r.failures.length} failure(s)._`,
  );
  out.push('');

  const chartLines = suiteCharts(model, suite, addChart);
  if (chartLines.length) {
    out.push(...chartLines);
    out.push('');
  }

  if (suite === 'size') out.push(...sizeTables(model));
  else if (suite === 'network') out.push(...networkTables(model));
  else out.push(...genericTables(model, suite));

  if (r.failures.length) {
    out.push('');
    out.push(`**Failures (${r.failures.length}).**`);
    out.push('');
    out.push(...failureList(r.failures, 8));
  }
  if (r.notes.length) {
    out.push('');
    out.push(`<details><summary>Harness notes (${r.notes.length})</summary>`);
    out.push('');
    for (const n of r.notes) out.push(`- ${mdEscape(n)}`);
    out.push('');
    out.push('</details>');
  }
  return out;
}

function failureList(failures: SuiteResult['failures'], limit: number): string[] {
  const groups = new Map<string, { app: string; dataset: string | null; scenario: string; errors: string[] }>();
  for (const f of failures) {
    const k = `${f.app}|${f.dataset ?? ''}|${f.scenario}`;
    const g = groups.get(k) ?? { app: f.app, dataset: f.dataset, scenario: f.scenario, errors: [] };
    g.errors.push(f.error);
    groups.set(k, g);
  }
  const out: string[] = [];
  let i = 0;
  for (const g of groups.values()) {
    if (i++ >= limit) {
      out.push(`- ... ${groups.size - limit} more group(s) in [Appendix C](#c-failures).`);
      break;
    }
    const first = (g.errors[0] ?? '').split('\n')[0]!.slice(0, 200);
    out.push(`- ${g.app.toUpperCase()}, ${code(g.scenario)}${g.dataset ? ` on ${g.dataset}` : ''}: ${g.errors.length} failure(s); first: ${code(first)}`);
  }
  return out;
}

/** Tables for every metric of a suite: one per metric name, rows by scenario and dataset. */
function genericTables(model: Model, suite: string): string[] {
  const cmps = model.bySuite.get(suite) ?? [];
  const out: string[] = [];
  const metricOrder: string[] = [];
  for (const c of cmps) if (!metricOrder.includes(c.metric)) metricOrder.push(c.metric);
  for (const metric of metricOrder) {
    const all = cmps.filter((c) => c.metric === metric);
    const plain = all.filter((c) => concurrencyOf(c) === null || suite !== 'api');
    const conc = suite === 'api' ? all.filter((c) => concurrencyOf(c) !== null) : [];
    for (const [set, suffix] of [
      [plain, ''],
      [conc, ' under concurrent load'],
    ] as Array<[Cmp[], string]>) {
      if (!set.length) continue;
      const unit = set[0]!.unit;
      const u = unitText(unit);
      const label = metricLabel(metric);
      out.push(`**${label}${suffix}**${u && !label.includes(u) ? ` (${u})` : ''}, ${set[0]!.better} is better:`);
      out.push('');
      out.push(comparisonTable(set, { showScenario: new Set(set.map((c) => c.scenario)).size > 1 || suite === 'api' }));
      out.push('');
    }
  }
  return out;
}

/** `scenarioHeader`/`scenarioText` let a table label its rows by something other than the scenario (the network section lists metrics). */
function comparisonTable(set: Cmp[], o: { showScenario: boolean; scenarioHeader?: string; scenarioText?: (c: Cmp) => string; valueUnit?: 'KB' }): string {
  const unit = o.valueUnit && set[0]!.unit === 'bytes' ? o.valueUnit : set[0]!.unit;
  const anyDs = set.some((c) => c.dataset !== null);
  const multi = set.some((c) => (c.v1?.s.n ?? 0) > 1 || (c.v2?.s.n ?? 0) > 1);
  const tails = unit === 'ms' && set.some((c) => (c.v1?.s.n ?? 0) >= 10 || (c.v2?.s.n ?? 0) >= 10);
  const payload = set.some((c) => metaNumber(c.v1?.m, RESPONSE_BYTES_KEYS) !== null || metaNumber(c.v2?.m, RESPONSE_BYTES_KEYS) !== null);
  const head: string[] = [];
  const align: Array<'l' | 'r' | 'c'> = [];
  const col = (h: string, a: 'l' | 'r' | 'c') => {
    head.push(h);
    align.push(a);
  };
  if (o.showScenario) col(o.scenarioHeader ?? 'Scenario', 'l');
  if (anyDs) col('Dataset', 'l');
  if (multi) col('n (V1 / V2)', 'r');
  const anyCi = set.some((c) => hasCi(c.v1) || hasCi(c.v2));
  const spread = anyCi ? '[95% CI]' : '(range)';
  col(multi ? `V1 median ${spread}` : 'V1', 'r');
  col(multi ? `V2 median ${spread}` : 'V2', 'r');
  if (tails) {
    col('V1 p90 / p99', 'r');
    col('V2 p90 / p99', 'r');
  }
  if (payload) col('Response (V1 / V2)', 'r');
  col('Improvement (V2 vs V1)', 'l');
  if (multi) col('p', 'r');
  col('Better', 'c');
  const rows = set.map((c) => {
    const row: string[] = [];
    if (o.showScenario) row.push(o.scenarioText ? o.scenarioText(c) : code(c.scenario));
    if (anyDs) row.push(dsLabel(c.dataset));
    if (multi) {
      const nf = (a: AppId) => {
        const side = c[a];
        const f = c.failures[a];
        return `${side ? side.s.n : 0}${f ? ` (+${f} failed)` : ''}`;
      };
      row.push(`${nf('v1')} / ${nf('v2')}`);
    }
    row.push(c.v1 ? ciText(c.v1, unit) : 'n/a');
    row.push(c.v2 ? ciText(c.v2, unit) : 'n/a');
    if (tails) {
      for (const a of APPS) {
        const s = c[a]?.s;
        row.push(s && s.n >= 10 ? `${num(s.p90, unit)} / ${num(s.p99, unit)}` : '');
      }
    }
    if (payload) {
      const b1 = metaNumber(c.v1?.m, RESPONSE_BYTES_KEYS);
      const b2 = metaNumber(c.v2?.m, RESPONSE_BYTES_KEYS);
      row.push(`${b1 !== null ? fmtPayload(b1) : '?'} / ${b2 !== null ? fmtPayload(b2) : '?'}`);
    }
    row.push(improvementText(c));
    if (multi) row.push(pText(c));
    row.push(betterText(c));
    return row;
  });
  return table(head, align, rows);
}

// ---------------------------------------------------------------------------------------------
// Network section

/** Leg prefixes of the network suite and their table-row labels (the prefix is in the heading). */
const NET_LEG_PREFIX = /^(Loopback socket traffic|UI to backend): /;

/** Network scenarios in the order a session goes through them (a dataset without pushes would otherwise list them last). */
function netOrder(set: Cmp[]): Cmp[] {
  const rank = (s: string) => (s === 'cold-load' ? 0 : s.startsWith('nav:') ? 1 : s === 'push' ? 2 : s === 'idle' ? 3 : s === 'session' ? 4 : 5);
  return set
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c.scenario) - rank(b.c.scenario) || a.i - b.i)
    .map((x) => x.c);
}

function networkIntro(model: Model): string {
  const k = (model.knobs as Partial<ProfileKnobs> | null)?.network;
  return [
    'How many bytes each architecture moves over sockets while its UI is used, counted on the wire by a byte-counting TCP proxy that follows HTTP/1.1 and WebSocket framing: application-layer bytes (HTTP heads and bodies, WebSocket frames, SSE streams), TCP/IP headers excluded. The two apps put their sockets in different places, so there are two legs:',
    '',
    "- **Loopback socket traffic** (`net_*`, the headline numbers): everything that really crosses a socket in the shipped architecture. **V1**: the page and the V1 server, over loopback HTTP (assets and API) and SignalR WebSockets; the V1 desktop app's WKWebView talks to the same local server the same way. **V2**: the Tauri host and the daemon, over loopback REST, one WebSocket and one SSE change stream. The host is played by the IPC shim, which runs the real `tendril-app` command handlers and bridges; it reaches the daemon through the proxy via a shadow `TENDRIL_HOME` whose `.master` names the proxy's port (the daemon's own `.master` is left alone).",
    "- **UI to backend** (`ui_*`): what the page exchanges with whatever serves it. For V1 it is the same leg as above. For V2 it is Chromium and the shim: IPC messages plus the frontend assets. **In the real V2 app none of this touches a socket**: Tauri IPC is in-process and the assets load from the app bundle. It is shown to compare how much data each UI moves, not as network traffic.",
    '',
    `Scenarios${k ? ` (${k.coldLoads} cold loads, ${k.pushSamples} pushes, ${k.idleWindows} idle window(s) of ${k.idleWindowSec} s and ${k.sessions} session(s) per dataset and app)` : ''}: \`cold-load\` (fresh browser context until the traffic settles after content), \`nav:<view>\` (first visit of each view in that context), \`push\` (a REST state change sent straight to the server, not through the proxy, and what the UI side then receives), \`idle\` (a settled page left alone, per minute) and \`session\` (load, every view and a few pushes, as one total). A window closes once no byte has moved on either leg for 1.5 s, so background traffic inside it (V2's 5 s job poll, SignalR keep-alives) is included; \`idle\` measures that background alone. Assets are what the browser requests as a document, script, style, font or image; data is everything else. Byte counts barely vary between runs, so most differences below are exact rather than statistical.`,
  ].join('\n');
}

function networkTables(model: Model): string[] {
  const out: string[] = [];
  const cmps = model.bySuite.get('network') ?? [];
  if (!cmps.length) return out;
  const prim = primaryDataset(model, 'network');
  const pick = (metrics: string[], scenario: RegExp, ds: string | null | undefined) =>
    metrics.flatMap((m) => netOrder(cmps.filter((c) => c.metric === m && scenario.test(c.scenario) && (ds === undefined || c.dataset === ds))));
  // Byte counts here run from a few hundred bytes (a push) to megabytes (a cold load): KB fits both.
  const byMetric = (set: Cmp[]) => comparisonTable(set, { showScenario: true, scenarioHeader: 'Metric', scenarioText: (c) => metricLabel(c.metric).replace(NET_LEG_PREFIX, ''), valueUnit: 'KB' });
  const block = (heading: string, text: string, tables: Array<string | null>) => {
    const ts = tables.filter((t): t is string => !!t);
    if (!ts.length) return;
    out.push(`**${heading}**${text ? ` ${text}` : ''}`);
    out.push('');
    for (const t of ts) out.push(t, '');
  };
  const orNull = (set: Cmp[], f: (s: Cmp[]) => string) => (set.length ? f(set) : null);
  const byScenario = (s: Cmp[]) => comparisonTable(s, { showScenario: true, valueUnit: 'KB' });
  const scen = /^(cold-load|nav:.*|push|session)$/;

  block('Loopback socket traffic per scenario', '(KB = 1,000 bytes, both directions; lower is better):', [orNull(pick(['net_total_bytes'], scen, undefined), byScenario)]);
  if (prim) {
    block(`What a cold load puts on the loopback (${dsLong(prim)}):`, 'bytes in KB.', [
      orNull(pick(['net_asset_bytes', 'net_data_bytes', 'net_ws_bytes', 'net_down_bytes', 'net_up_bytes'], /^cold-load$/, prim), byMetric),
      orNull(pick(['net_requests', 'net_ws_messages', 'net_connections'], /^cold-load$/, prim), byMetric),
    ]);
    block(`One push on the loopback (${dsLong(prim)}):`, 'The state change itself goes straight to the server; these are the bytes (in KB) it causes between the server side and the UI side until the badge has changed and traffic has settled.', [
      orNull(pick(['net_down_bytes', 'net_up_bytes', 'net_total_bytes'], /^push$/, prim), byMetric),
      orNull(pick(['net_requests', 'net_ws_messages', 'net_connections'], /^push$/, prim), byMetric),
    ]);
  }
  block('Idle UI:', 'a settled page left alone; KB per minute on the loopback, per dataset.', [
    orNull(pick(['net_bytes_per_min'], /^idle$/, undefined), (s) => comparisonTable(s, { showScenario: false, valueUnit: 'KB' })),
    prim ? orNull(pick(['net_requests_per_min', 'net_ws_messages_per_min'], /^idle$/, prim), byMetric) : null,
  ]);
  block('UI to backend per scenario', "(KB). V1: the same leg as above. V2: Chromium and the IPC shim, which in the real app is in-process IPC plus assets from the bundle, not a socket.", [
    orNull(pick(['ui_total_bytes'], scen, undefined), byScenario),
    prim ? orNull(pick(['ui_asset_bytes', 'ui_data_bytes'], /^cold-load$/, prim), byMetric) : null,
    orNull(pick(['ui_bytes_per_min'], /^idle$/, undefined), (s) => comparisonTable(s, { showScenario: false, valueUnit: 'KB' })),
  ]);

  if (prim) {
    const rows: string[][] = [];
    for (const [scenario, suffix] of [
      ['cold-load', 'total_bytes'],
      ['push', 'total_bytes'],
      ['idle', 'bytes_per_min'],
    ] as const) {
      for (const leg of ['net', 'ui'] as const) {
        const c = cmps.find((x) => x.scenario === scenario && x.dataset === prim && x.metric === `${leg}_${suffix}`);
        for (const app of APPS) {
          const ps = (c?.[app]?.m.meta?.perSample as Array<Record<string, unknown>> | undefined)?.[0];
          if (!ps || ps.sameAs) continue;
          const routes = (ps.routes as Array<{ route: string; requests: number; up: number; down: number }> | undefined) ?? [];
          const top = routes.slice(0, 4).map((r) => `${code(r.route)} ${fmtPayload(r.up + r.down)}${r.requests ? ` (${r.requests} req)` : ''}`);
          rows.push([code(scenario), leg === 'net' ? 'loopback' : 'UI to backend', app.toUpperCase(), top.join('; ') || 'nothing']);
        }
      }
    }
    if (rows.length) {
      out.push(`**Where the bytes go** (${dsLong(prim)}, first sample of each scenario, largest routes first; idle is per window, not per minute). Routes collapse ids; \`asset .js\` is every JavaScript file.`);
      out.push('');
      out.push(table(['Scenario', 'Leg', 'App', 'Largest routes'], ['l', 'l', 'c', 'l'], rows));
      out.push('');
    }
  }

  const ext = cmps.filter((c) => c.scenario === 'desktop-external');
  if (ext.length) {
    out.push('**External traffic of the real desktop apps**, sampled with `nettop` (non-loopback TCP only) from launch. A lower bound: `nettop` sees only sockets still open at a 1 s sample.');
    out.push('');
    for (const unit of ['bytes', 'count']) {
      const set = ext.filter((c) => c.unit === unit);
      if (set.length) out.push(byMetric(set), '');
    }
    for (const app of APPS) {
      const m = ext.find((c) => c.metric === 'ext_bytes_in')?.[app]?.m;
      const eps = (m?.meta?.perSample as Array<Record<string, unknown>> | undefined)?.[0]?.endpoints as Array<{ process: string; remote: string; name: string | null; bytesIn: number; bytesOut: number }> | undefined;
      if (!eps) continue;
      out.push(`- ${app.toUpperCase()}: ${eps.length ? eps.slice(0, 6).map((e) => `${code(e.name ?? e.remote)} from ${code(e.process)}, ${fmtPayload(e.bytesIn)} in / ${fmtPayload(e.bytesOut)} out`).join('; ') : 'no external connection seen'}`);
    }
    out.push('');
  }
  return out;
}

function sizeTables(model: Model): string[] {
  const cmps = (model.bySuite.get('size') ?? []).filter((c) => !model.childIds.has(c.id));
  const out: string[] = [];
  const metricOrder: string[] = [];
  for (const c of cmps) if (!metricOrder.includes(c.metric)) metricOrder.push(c.metric);
  // Sizes and their compressed variants read best side by side: one table, one row per artifact.
  const byteMetrics = metricOrder.filter((m) => /^bytes/.test(m));
  const scenarios: string[] = [];
  for (const c of cmps) if (/^bytes/.test(c.metric) && !scenarios.includes(c.scenario)) scenarios.push(c.scenario);
  if (scenarios.length) {
    const rows: string[][] = [];
    for (const s of scenarios) {
      for (const m of byteMetrics) {
        const c = cmps.find((x) => x.scenario === s && x.metric === m);
        if (!c) continue;
        const mb = (side: Side | null) => (!side ? 'n/a' : side.s.median === 0 ? 'none' : num(side.s.median, 'bytes'));
        rows.push([
          m === 'bytes' ? code(s) : '',
          m === 'bytes' ? 'raw' : m.replace(/^bytes_?/, '').replace('gzip9', 'gzip -9').replace('brotli11', 'brotli 11').replace('brotli9', 'brotli 9'),
          mb(c.v1),
          mb(c.v2),
          improvementText(c),
          betterText(c),
        ]);
      }
    }
    out.push('**Sizes** (MB = 10^6 bytes; exact bytes in [Appendix B](#b-exact-sizes)), smaller is better:');
    out.push('');
    out.push(table(['Artifact', 'Encoding', 'V1 (MB)', 'V2 (MB)', 'Improvement (V2 vs V1)', 'Better'], ['l', 'l', 'r', 'r', 'l', 'c'], rows));
    out.push('');
  }
  for (const m of metricOrder.filter((x) => !/^bytes/.test(x))) {
    const set = cmps.filter((c) => c.metric === m);
    out.push(`**${metricLabel(m)}**:`);
    out.push('');
    out.push(comparisonTable(set, { showScenario: true }));
    out.push('');
  }
  for (const [parent, kids] of model.sizeChildren) {
    const parentCmp = (model.bySuite.get('size') ?? []).find((c) => c.scenario === parent && c.metric === 'bytes');
    out.push(`**Breakdown of ${code(parent)}**:`);
    out.push('');
    const rows: string[][] = [];
    const grouped = kids.some((k) => k.group);
    for (const app of APPS) {
      const ks = kids.filter((k) => k.app === app).sort((a, b) => b.bytes - a.bytes);
      if (!ks.length) continue;
      const total = parentCmp?.[app]?.s.median ?? ks.reduce((s, k) => s + k.bytes, 0);
      for (const k of ks) {
        const row = [app.toUpperCase(), code(k.name)];
        if (grouped) row.push(k.group ?? 'other');
        row.push(num(k.bytes, 'bytes'), total > 0 ? `${((k.bytes / total) * 100).toFixed(1)}%` : '');
        rows.push(row);
      }
    }
    out.push(grouped ? table(['App', 'Component', 'Group', 'MB', 'Share'], ['l', 'l', 'l', 'r', 'r'], rows) : table(['App', 'Component', 'MB', 'Share'], ['l', 'l', 'r', 'r'], rows));
    out.push('');
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Charts per suite (curated; each one needs its metrics and silently drops out without them)

const TAGS = { v1: 'V1', v2: 'V2' } as const;

function seriesDefs(model: Model): Array<{ key: SeriesKey; label: string; tag: string }> {
  return APPS.map((a) => ({ key: a as SeriesKey, label: model.labels[a], tag: TAGS[a] }));
}

function barValue(side: Side | null, unit: string): { value: number; lo?: number; hi?: number; label: string } | null {
  if (!side || side.s.n === 0) return null;
  const scale = unit === 'bytes' ? 1e6 : 1;
  const v = side.s.median / scale;
  const ci = hasCi(side);
  return { value: v, lo: ci ? side.ci.lo / scale : undefined, hi: ci ? side.ci.hi / scale : undefined, label: withUnit(side.s.median, unit) };
}

function missingText(c: Cmp | undefined, app: AppId): string | undefined {
  if (!c) return undefined;
  if (c.failures[app]) return `failed (${c.failures[app]})`;
  const side = c[app];
  if (side && side.s.n > 0 && side.s.median === 0) return c.unit === 'bytes' ? 'none' : '0';
  return undefined;
}

function barsFor(model: Model, cmps: Array<{ label: string; c: Cmp | undefined }>): BarGroup[] {
  return cmps.map(({ label, c }) => ({
    label,
    values: APPS.map((a) => {
      const bv = c ? barValue(c[a], c.unit) : null;
      return bv && bv.value > 0 ? bv : null;
    }),
    missing: APPS.map((a) => missingText(c, a)),
  }));
}

function axisUnit(unit: string): string {
  switch (unit) {
    case 'bytes':
      return 'MB (10^6 bytes)';
    case 'MiB':
      return 'MiB';
    case 'ms':
      return 'milliseconds';
    case 'percent':
      return '% of one core';
    case 'req/s':
      return 'requests per second';
    case 'cpu_s':
      return 'CPU seconds';
    default:
      return unit;
  }
}

function fmtAxis(unit: string): (v: number) => string {
  return (v: number) => withUnit(unit === 'bytes' ? v * 1e6 : v, unit);
}

function lineOverDatasets(model: Model, suite: string, f: Find, title: string, subtitle: string): string | null {
  const ds = datasetsOf(model, suite);
  if (ds.length < 2) return null;
  const cs = ds.map((d) => findAll(model, suite, { ...f, dataset: d }).find((c) => concurrencyOf(c) === null) ?? findAll(model, suite, { ...f, dataset: d })[0]);
  if (cs.filter(Boolean).length < 2) return null;
  const unit = cs.find(Boolean)!.unit;
  const series = seriesDefs(model).map((s) => ({
    ...s,
    values: cs.map((c): LinePoint | null => {
      const side = c?.[s.key];
      if (!side || side.s.n === 0) return null;
      const ci = hasCi(side);
      return { value: side.s.median, lo: ci ? side.ci.lo : undefined, hi: ci ? side.ci.hi : undefined };
    }),
  }));
  if (series.every((s) => s.values.every((v) => v === null))) return null;
  return lineChart({
    title,
    subtitle,
    xLabels: ds,
    xSublabels: ds.map((d) => {
      const spec = (DATASETS as Record<string, { plans: number } | undefined>)[d];
      return spec ? `${fmtInt(spec.plans)} plans` : '';
    }),
    series,
    yLabel: axisUnit(unit),
    format: (v) => withUnit(v, unit),
  });
}

function suiteCharts(model: Model, suite: string, addChart: (f: string, svg: string, alt: string) => string): string[] {
  const out: string[] = [];
  const push = (file: string, svg: string | null, alt: string) => {
    if (svg) out.push(addChart(file, svg, alt), '');
  };
  const prim = primaryDataset(model, suite);
  const large = largestDataset(model, suite);
  const cmps = model.bySuite.get(suite) ?? [];
  const note = 'Bars are medians; whiskers are 95% bootstrap intervals.';

  switch (suite) {
    case 'size': {
      const top = cmps.filter((c) => c.metric === 'bytes' && !model.childIds.has(c.id));
      const isFront = (s: string) => /front|eager|\bjs\b|css|font|sourcemap|\bmaps?\b|wireframe|proxy|webviewer/i.test(s);
      const artifacts = top.filter((c) => !isFront(c.scenario));
      if (artifacts.length) {
        push(
          'size-artifacts.svg',
          groupedBarChart({
            title: 'Distribution and install size',
            subtitle: 'Apparent bytes (sum of file sizes). Missing bars: the app has no such artifact.',
            series: seriesDefs(model),
            groups: barsFor(model, artifacts.map((c) => ({ label: c.scenario, c }))),
            axisLabel: 'MB (10^6 bytes)',
            format: fmtAxis('bytes'),
            scale: 'log',
          }),
          'Distribution and install sizes, V1 vs V2, log scale',
        );
      }
      const front = top.filter((c) => isFront(c.scenario));
      if (front.length) {
        const groups: Array<{ label: string; c: Cmp | undefined }> = [];
        for (const c of front) {
          groups.push({ label: `${c.scenario}, raw`, c });
          for (const [m, l] of [['bytes_brotli11', 'brotli 11']] as const) {
            const v = cmps.find((x) => x.scenario === c.scenario && x.metric === m);
            if (v) groups.push({ label: `${c.scenario}, ${l}`, c: v });
          }
        }
        push(
          'size-frontend.svg',
          groupedBarChart({
            title: 'Frontend payload',
            subtitle: 'Eager = loaded before the Tendril shell can render (V1: Ivy entry closure plus the Tendril widgets bundle). Raw and brotli 11 per file; gzip -9 is in the table.',
            series: seriesDefs(model),
            groups: barsFor(model, groups),
            axisLabel: 'MB (10^6 bytes)',
            format: fmtAxis('bytes'),
            scale: 'auto',
          }),
          'Frontend payload sizes, raw and compressed, V1 vs V2',
        );
      }
      let bi = 0;
      for (const [parent, kids] of model.sizeChildren) {
        const svg = breakdownChart(model, parent, kids);
        if (svg) push(`size-breakdown-${++bi}.svg`, svg, `Composition of ${parent}`);
      }
      break;
    }
    case 'cli': {
      for (const [metric, file, title] of [
        [/^wall_ms$/, 'cli-wall.svg', 'CLI wall time per command'],
        [/^peak_footprint_mib$/, 'cli-memory.svg', 'CLI peak memory per command'],
      ] as const) {
        const set = cmps.filter((c) => metric.test(c.metric));
        if (!set.length) continue;
        push(
          file,
          groupedBarChart({
            title,
            subtitle: `${note} Dataset in brackets.`,
            series: seriesDefs(model),
            groups: barsFor(model, set.map((c) => ({ label: c.dataset ? `${c.scenario} (${c.dataset})` : c.scenario, c }))),
            axisLabel: axisUnit(set[0]!.unit),
            format: fmtAxis(set[0]!.unit),
          }),
          title,
        );
      }
      break;
    }
    case 'startup': {
      const has = (m: RegExp) => cmps.some((c) => m.test(c.metric));
      const readyMetric = has(/^data_ready_ms$/) ? /^data_ready_ms$/ : /^http_ready_ms$/;
      const readyName = has(/^data_ready_ms$/) ? 'data ready' : 'HTTP ready';
      push('startup-first.svg', lineOverDatasets(model, suite, { scenario: /first/i, metric: readyMetric }, `Cold start to ${readyName} by dataset size`, 'Freshly restored home; median of the runs, whiskers are 95% bootstrap intervals. The x axis is ordinal.'), `Cold start time vs dataset size`);
      push('startup-warm.svg', lineOverDatasets(model, suite, { scenario: /warm/i, metric: readyMetric }, `Warm restart to ${readyName} by dataset size`, 'Restart on an already-synced home.'), `Warm restart time vs dataset size`);
      push('startup-footprint.svg', lineOverDatasets(model, suite, { scenario: /first/i, metric: /^footprint_at_ready_mib$/ }, 'Server footprint at ready (cold start)', 'Physical footprint of the server process tree when it first reports ready.'), 'Footprint at ready vs dataset size');
      break;
    }
    case 'idle': {
      const r = model.results.get(suite)!;
      for (const d of [...new Set([prim, large])].filter((x): x is string => !!x)) {
        const svg = seriesChart(model, r.series ?? [], d, /footprint/i, `Idle server footprint over time (${dsLong(d)})`, 'Physical footprint of the server process tree, sampled every second after ready.', 'seconds since ready', [{ x: 10, label: 'window starts' }]);
        push(`idle-footprint-${d}.svg`, svg, `Idle footprint over time, ${d} dataset`);
      }
      push('idle-scaling.svg', lineOverDatasets(model, suite, { metric: /^footprint_mean_mib$/ }, 'Mean idle footprint by dataset size', 'Mean over the window after +10 s; median of the runs.'), 'Mean idle footprint vs dataset size');
      push('idle-cpu.svg', lineOverDatasets(model, suite, { metric: /^cpu_percent_mean$/ }, 'Mean idle CPU by dataset size', 'Percent of one core over the window after +10 s, including periodic rescans.'), 'Mean idle CPU vs dataset size');
      break;
    }
    case 'api': {
      if (prim) {
        const seq = cmps.filter((c) => c.dataset === prim && c.metric === 'latency_ms' && concurrencyOf(c) === null);
        if (seq.length) {
          push(
            `api-sequential-${prim}.svg`,
            groupedBarChart({
              title: `Sequential API latency (${dsLong(prim)})`,
              subtitle: `One keep-alive connection, uncompressed. Response size per request in brackets (V1 / V2): payloads differ. ${note}`,
              series: seriesDefs(model),
              groups: barsFor(
                model,
                seq.map((c) => {
                  const b1 = metaNumber(c.v1?.m, RESPONSE_BYTES_KEYS);
                  const b2 = metaNumber(c.v2?.m, RESPONSE_BYTES_KEYS);
                  return { label: `${c.scenario}${b1 !== null || b2 !== null ? `  (${b1 !== null ? fmtPayload(b1) : '?'} / ${b2 !== null ? fmtPayload(b2) : '?'})` : ''}`, c };
                }),
              ),
              axisLabel: 'milliseconds',
              format: fmtAxis('ms'),
            }),
            'Sequential API latency per scenario',
          );
        }
      }
      push('api-list-scaling.svg', lineOverDatasets(model, suite, { scenario: /^(plans\.list|GET \/api\/plans\?limit=50)$/, metric: /^latency_ms$/ }, 'List 50 plans: latency by dataset size', 'Sequential requests; median and 95% bootstrap interval.'), 'Plan list latency vs dataset size');
      if (prim) {
        for (const [metric, file, title, sub] of [
          [/^throughput_rps$/, 'api-throughput.svg', `Throughput under closed-loop load (${dsLong(prim)})`, 'Successful responses per second with c concurrent workers; higher is better. The load generator is one Node process.'],
          [/^server_peak_footprint_mib$/, 'api-peak-memory.svg', `Server peak footprint under load (${dsLong(prim)})`, 'Sum of per-process interval peaks of the server tree during each concurrency run.'],
        ] as const) {
          const set = cmps.filter((c) => c.dataset === prim && metric.test(c.metric) && concurrencyOf(c) !== null);
          if (!set.length) continue;
          push(
            file,
            groupedBarChart({
              title,
              subtitle: sub,
              series: seriesDefs(model),
              groups: barsFor(model, set.map((c) => ({ label: `${baseScenario(c.scenario)}, c=${concurrencyOf(c)}`, c }))),
              axisLabel: axisUnit(set[0]!.unit),
              format: fmtAxis(set[0]!.unit),
              scale: 'linear',
            }),
            title,
          );
        }
      }
      break;
    }
    case 'ui': {
      if (prim) {
        const cold = cmps.filter((c) => c.dataset === prim && /cold/i.test(c.scenario) && c.unit === 'ms');
        if (cold.length) {
          push(
            `ui-cold-load-${prim}.svg`,
            groupedBarChart({
              title: `Cold load milestones (${dsLong(prim)})`,
              subtitle: `Fresh browser context, time from navigation start. ${note}`,
              series: seriesDefs(model),
              groups: barsFor(model, cold.map((c) => ({ label: metricLabel(c.metric), c }))),
              axisLabel: 'milliseconds',
              format: fmtAxis('ms'),
              scale: 'linear',
            }),
            'UI cold load milestones',
          );
        }
      }
      push('ui-content-scaling.svg', lineOverDatasets(model, suite, { scenario: /cold/i, metric: /^content_ready_ms$/ }, 'Cold load to content by dataset size', 'Plan workspace title (or the empty state) visible.'), 'UI content ready vs dataset size');
      if (prim) {
        const nav = cmps.filter((c) => c.dataset === prim && /^nav(?:igat\w*)?\W/i.test(c.scenario) && !/under.?load/i.test(c.scenario) && /^nav(_first)?_ms$/.test(c.metric));
        if (nav.length) {
          push(
            `ui-navigation-${prim}.svg`,
            groupedBarChart({
              title: `Navigation between views (${dsLong(prim)})`,
              subtitle: `Click on the nav item to the view's ready marker. ${note}`,
              series: seriesDefs(model),
              groups: barsFor(model, nav.map((c) => ({ label: `${c.scenario.replace(/^nav(?:igat\w*)?\W*/i, '')}, ${c.metric === 'nav_first_ms' ? 'first visit' : 'revisit'}`, c }))),
              axisLabel: 'milliseconds',
              format: fmtAxis('ms'),
            }),
            'UI navigation latency per view',
          );
        }
        const load = cmps.filter((c) => c.dataset === prim && /under.?load/i.test(c.scenario) && /_ms$/.test(c.metric));
        if (load.length) {
          push(
            `ui-nav-under-load-${prim}.svg`,
            groupedBarChart({
              title: `Navigation under background API load (${dsLong(prim)})`,
              subtitle: `Plan list at c=4 plus one plan update every 500 ms while navigating. ${note}`,
              series: seriesDefs(model),
              groups: barsFor(model, load.map((c) => ({ label: `${c.scenario.replace(/^nav\w*[- ]under[- ]load\W*/i, '') || c.scenario}, ${lowerLabel(c.metric)}`, c }))),
              axisLabel: 'milliseconds',
              format: fmtAxis('ms'),
            }),
            'UI navigation under load',
          );
        }
      }
      const push2 = cmps.filter((c) => /push/i.test(c.scenario) && c.unit === 'ms');
      if (push2.length) {
        push(
          'ui-push.svg',
          groupedBarChart({
            title: 'Push latency: change to UI badge update',
            subtitle: `REST: PUT /api/plans/<id> to badge change. File: plan.yaml rewritten on disk; includes each app's file-watcher debounce. ${note}`,
            series: seriesDefs(model),
            groups: barsFor(model, push2.map((c) => ({ label: `${c.scenario}${c.dataset ? ` (${c.dataset})` : ''}`, c }))),
            axisLabel: 'milliseconds',
            format: fmtAxis('ms'),
            scale: 'linear',
          }),
          'Push latency by trigger and dataset',
        );
      }
      if (prim) {
        const mem = cmps.filter((c) => c.dataset === prim && c.unit === 'MiB' && /footprint/.test(c.metric) && !/cold/i.test(c.scenario));
        if (mem.length) {
          push(
            `ui-memory-${prim}.svg`,
            groupedBarChart({
              title: `Memory after the UI flows (${dsLong(prim)})`,
              subtitle: 'Physical footprint. V2 server tree = daemon + IPC shim (the shim stands in for the Tauri host and is not tendril-app).',
              series: seriesDefs(model),
              groups: barsFor(model, mem.map((c) => ({ label: `${metricLabel(c.metric)}${/blank/i.test(c.scenario) ? ' (about:blank baseline)' : ''}`, c }))),
              axisLabel: 'MiB',
              format: fmtAxis('MiB'),
              scale: 'linear',
            }),
            'Memory after UI flows',
          );
        }
      }
      {
        const server = cmps.filter((c) => /^server_tree_footprint/.test(c.metric) && (roleMap(c.v1?.m) || roleMap(c.v2?.m)));
        const svg = roleBreakdownChart(model, server, 'Server-side memory after the UI flows, by process', 'V1: the Ivy.Tendril server. V2: the daemon plus the IPC shim that stands in for the Tauri host (the real tendril-app is measured in the desktop suite).');
        if (svg) push('ui-server-roles.svg', svg, 'Server-side memory after UI flows by process');
      }
      break;
    }
    case 'network': {
      const legNote = 'V1: page and V1 server. V2: Tauri host (IPC shim running the real command handlers) and daemon.';
      if (prim) {
        const byScen = (metric: string, re: RegExp) => netOrder(cmps.filter((c) => c.dataset === prim && c.metric === metric && re.test(c.scenario)));
        const scen = byScen('net_total_bytes', /^(cold-load|nav:.*|push|session)$/);
        if (scen.length) {
          push(
            `network-scenarios-${prim}.svg`,
            groupedBarChart({
              title: `Loopback socket traffic per scenario (${dsLong(prim)})`,
              subtitle: `Bytes in both directions until the traffic settled. ${legNote} Log scale. ${note}`,
              series: seriesDefs(model),
              groups: barsFor(model, scen.map((c) => ({ label: c.scenario, c }))),
              axisLabel: axisUnit('bytes'),
              format: fmtAxis('bytes'),
              scale: 'log',
            }),
            'Loopback socket bytes per UI scenario, V1 vs V2, log scale',
          );
        }
        const comp = ['net_asset_bytes', 'net_data_bytes', 'net_ws_bytes'].flatMap((m) => byScen(m, /^cold-load$/));
        if (comp.length) {
          push(
            `network-cold-load-${prim}.svg`,
            groupedBarChart({
              title: `What a cold load puts on the loopback (${dsLong(prim)})`,
              subtitle: `Assets: documents, scripts, styles, fonts, images. Data: everything else (API, IPC bridges, WebSocket, SSE); WebSocket bytes are part of data. ${legNote} Log scale.`,
              series: seriesDefs(model),
              groups: barsFor(model, comp.map((c) => ({ label: metricLabel(c.metric).replace(/^Loopback socket traffic: /, ''), c }))),
              axisLabel: axisUnit('bytes'),
              format: fmtAxis('bytes'),
              scale: 'log',
            }),
            'Cold load loopback bytes split into assets and data',
          );
        }
        const ui = byScen('ui_total_bytes', /^(cold-load|nav:.*|push|session)$/);
        if (ui.length) {
          push(
            `network-ui-leg-${prim}.svg`,
            groupedBarChart({
              title: `UI to backend per scenario (${dsLong(prim)})`,
              subtitle: 'V1: page and V1 server (the same leg as the loopback chart). V2: page and IPC shim, which in the real app is in-process IPC plus bundled assets, not a socket. Log scale.',
              series: seriesDefs(model),
              groups: barsFor(model, ui.map((c) => ({ label: c.scenario, c }))),
              axisLabel: axisUnit('bytes'),
              format: fmtAxis('bytes'),
              scale: 'log',
            }),
            'UI to backend bytes per scenario, V1 vs V2, log scale',
          );
        }
      }
      push('network-idle.svg', lineOverDatasets(model, suite, { scenario: /^idle$/, metric: /^net_bytes_per_min$/ }, 'Idle UI: loopback bytes per minute by dataset size', `A settled page left alone. ${legNote}`), 'Idle loopback bytes per minute vs dataset size');
      break;
    }
    case 'desktop': {
      const r = model.results.get(suite)!;
      for (const d of [...new Set([prim, large])].filter((x): x is string => !!x)) {
        const svg = seriesChart(model, r.series ?? [], d, /footprint/i, `Desktop app footprint over time (${dsLong(d)})`, 'Whole process tree: app, its WebKit processes and (V2) the daemon.', 'seconds since launch', [{ x: 15, label: '+15 s' }]);
        push(`desktop-footprint-${d}.svg`, svg, `Desktop footprint over time, ${d} dataset`);
      }
      const roles = cmps.filter((c) => /footprint/.test(c.metric) && (roleMap(c.v1?.m) || roleMap(c.v2?.m)));
      const pick = roles.filter((c) => /end/.test(c.metric));
      const svg = roleBreakdownChart(model, pick.length ? pick : roles, 'Desktop footprint by process role', 'Median over runs of each role at the end of the window, stacked; the label is their sum (the whole-tree median is in the table).');
      if (svg) push('desktop-roles.svg', svg, 'Desktop footprint by process role');
      if (prim) {
        const launch = cmps.filter((c) => c.dataset === prim && c.unit === 'ms');
        if (launch.length) {
          push(
            `desktop-launch-${prim}.svg`,
            groupedBarChart({
              title: `Desktop launch milestones (${dsLong(prim)})`,
              subtitle: `From the launch command. ${note}`,
              series: seriesDefs(model),
              groups: barsFor(model, launch.map((c) => ({ label: metricLabel(c.metric), c }))),
              axisLabel: 'milliseconds',
              format: fmtAxis('ms'),
            }),
            'Desktop launch milestones',
          );
        }
      }
      break;
    }
    default:
      break;
  }
  return out;
}

function breakdownChart(model: Model, parent: string, kids: ChildEntry[]): string | null {
  const apps = APPS.filter((a) => kids.some((k) => k.app === a));
  if (!apps.length) return null;
  const names = [...new Set(kids.map((k) => k.name))];
  const hasGroups = kids.some((k) => k.group);
  const keyOf = (k: ChildEntry) => (hasGroups ? k.group ?? 'other' : names.length <= MAX_COMPONENTS + 1 ? k.name : classifyComponent(k.name));
  const parentCmp = (model.bySuite.get('size') ?? []).find((c) => c.scenario === parent && c.metric === 'bytes');
  const rows = apps.map((a) => {
    const seg: Record<string, number> = {};
    for (const k of kids.filter((x) => x.app === a)) seg[keyOf(k)] = (seg[keyOf(k)] ?? 0) + k.bytes / 1e6;
    const sum = Object.values(seg).reduce((s, v) => s + v, 0);
    const total = parentCmp?.[a]?.s.median;
    // Whatever the components do not account for still belongs in the bar, as "other".
    if (total !== undefined && total / 1e6 - sum > 0.005 * (total / 1e6)) seg.other = (seg.other ?? 0) + (total / 1e6 - sum);
    return { label: model.labels[a], segments: seg };
  });
  let keys = [...new Set(rows.flatMap((r) => Object.keys(r.segments)))];
  const totalOf = (k: string) => rows.reduce((s, r) => s + (r.segments[k] ?? 0), 0);
  keys.sort((a, b) => totalOf(b) - totalOf(a) || cmpStr(a, b));
  const nonOther = keys.filter((k) => k !== 'other');
  if (nonOther.length > MAX_COMPONENTS) {
    const fold = nonOther.slice(MAX_COMPONENTS);
    for (const r of rows) {
      for (const f of fold) {
        if (r.segments[f]) r.segments.other = (r.segments.other ?? 0) + r.segments[f]!;
        delete r.segments[f];
      }
    }
    keys = [...nonOther.slice(0, MAX_COMPONENTS), 'other'];
  }
  return stackedBarChart({
    title: `What is inside: ${parent}`,
    subtitle: 'Apparent bytes per component group; segments are labelled where they fit, exact values are in the table below.',
    keys: keys.map((k) => ({ key: k, label: k })),
    rows,
    axisLabel: 'MB (10^6 bytes)',
    format: (v) => withUnit(v * 1e6, 'bytes'),
  });
}

/**
 * Per-role breakdown from a metric's meta.byRole (or meta.roles). Accepts what suites are likely to
 * store: numbers in the metric's unit, arrays of them (one per run; the median is used), or
 * procstat Agg objects / arrays of them (footprint in bytes). Anything above 1e5 is taken to be
 * bytes, since no process role has a footprint of 100 GiB.
 */
function roleMap(m: Metric | undefined | null): Record<string, number> | null {
  const raw = m?.meta?.byRole ?? m?.meta?.roles;
  if (!raw || typeof raw !== 'object') return null;
  const peak = /peak/i.test(m!.metric);
  const scalar = (v: unknown): number | null => {
    let x: unknown = v;
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      const o = x as Record<string, unknown>;
      x = peak ? (o.peakFootprint ?? o.footprint) : (o.footprint ?? o.phys_footprint ?? o.value);
    }
    if (typeof x !== 'number' || !Number.isFinite(x)) return null;
    return m!.unit === 'MiB' && x > 1e5 ? x / MIB : x;
  };
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      const xs = v.map(scalar).filter((x): x is number => x !== null);
      if (xs.length) out[k] = summarize(xs).median;
    } else {
      const x = scalar(v);
      if (x !== null) out[k] = x;
    }
  }
  return Object.keys(out).length ? out : null;
}

const ROLE_ORDER = ['app', 'server', 'daemon', 'v2-shim', 'webkit-webcontent', 'webkit-gpu', 'webkit-networking'];

const ROLE_LABELS: Record<string, string> = {
  app: 'app process',
  server: 'server',
  daemon: 'V2 daemon',
  'v2-shim': 'IPC shim (stand-in, not tendril-app)',
  'webkit-webcontent': 'WebKit WebContent',
  'webkit-gpu': 'WebKit GPU',
  'webkit-networking': 'WebKit Networking',
  'webkit-other': 'WebKit (other)',
};

function roleBreakdownChart(model: Model, cmps: Cmp[], title: string, subtitle: string): string | null {
  const rows: Array<{ label: string; segments: Record<string, number> }> = [];
  for (const c of cmps) {
    for (const a of APPS) {
      const rm = roleMap(c[a]?.m);
      if (rm) rows.push({ label: `${TAGS[a]}${c.dataset ? `, ${c.dataset}` : ''}`, segments: rm });
    }
  }
  if (!rows.length) return null;
  let keys = [...new Set(rows.flatMap((r) => Object.keys(r.segments)))];
  keys.sort((a, b) => {
    const ia = ROLE_ORDER.indexOf(a);
    const ib = ROLE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || cmpStr(a, b);
  });
  if (keys.filter((k) => k !== 'other').length > MAX_COMPONENTS) {
    const keep = keys.filter((k) => k !== 'other').slice(0, MAX_COMPONENTS);
    for (const r of rows) {
      for (const k of Object.keys(r.segments)) {
        if (!keep.includes(k)) {
          r.segments.other = (r.segments.other ?? 0) + r.segments[k]!;
          if (k !== 'other') delete r.segments[k];
        }
      }
    }
    keys = [...keep, 'other'];
  }
  return stackedBarChart({ title, subtitle, keys: keys.map((k) => ({ key: k, label: ROLE_LABELS[k] ?? k })), rows, axisLabel: 'MiB', format: (v) => withUnit(v, 'MiB') });
}

/** Normalizes one series entry into runs of [seconds, MiB] (splitting where time restarts). */
function seriesRuns(e: SeriesEntry): Array<Array<[number, number]>> {
  const pts = e.points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!pts.length) return [];
  const runs: Array<Array<[number, number]>> = [[]];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && pts[i]![0] < pts[i - 1]![0]) runs.push([]);
    runs[runs.length - 1]!.push(pts[i]!);
  }
  const unit = e.unit.toLowerCase();
  const valScale = unit === 'bytes' || unit === 'b' ? 1 / MIB : unit === 'kib' ? 1 / 1024 : 1;
  return runs.map((r) => {
    const t0 = r[0]![0];
    const span = r[r.length - 1]![0] - t0;
    // Timestamps may be seconds or milliseconds, absolute or relative; anything spanning more than
    // 5000 units for a benchmark window is milliseconds.
    const tScale = span > 5000 ? 1 / 1000 : 1;
    const step = Math.max(1, Math.ceil(r.length / 400));
    return r.filter((_, i) => i % step === 0 || i === r.length - 1).map(([t, v]) => [(t - t0) * tScale, v * valScale] as [number, number]);
  });
}

function seriesChart(model: Model, series: SeriesEntry[], dataset: string, name: RegExp, title: string, subtitle: string, xLabel: string, markers: Array<{ x: number; label: string }>): string | null {
  const matching = series.filter((s) => s.dataset === dataset && (name.test(s.name) || name.test(s.scenario)));
  if (!matching.length) return null;
  // One series name only (prefer whole-tree footprint over per-role series if a suite writes both).
  const names = [...new Set(matching.map((s) => s.name))];
  const chosen = names.find((n) => /total|tree/.test(n)) ?? names.find((n) => n === 'footprint_mib') ?? names[0]!;
  const use = matching.filter((s) => s.name === chosen);
  const defs = seriesDefs(model)
    .map((d) => ({ ...d, runs: use.filter((s) => s.app === d.key).flatMap(seriesRuns) }))
    .filter((d) => d.runs.length);
  if (!defs.length) return null;
  return timeSeriesChart({ title, subtitle, series: defs, xLabel, yLabel: 'MiB', format: (v) => withUnit(v, 'MiB'), markers });
}

// ---------------------------------------------------------------------------------------------
// Findings

function findingsBlock(model: Model, headline: HeadlineRow[]): string[] {
  const out: string[] = [];
  out.push('Detected automatically from the results; the hand-written interpretation follows under [Analysis](#analysis).');
  out.push('');
  const items: string[] = [];

  // Suites that did not complete.
  const status = model.info.suiteStatus ?? {};
  for (const s of model.info.suitesRequested ?? []) {
    const st = status[s];
    const r = model.results.get(s);
    if (!r) items.push(`**Suite ${code(s)} has no results** (status: ${st ?? 'not run'}); nothing in this report covers it.`);
    else if (st && st !== 'ok' && st !== 'failures') {
      const why = r.notes.find((n) => /did not complete|skipped|missing|crash/i.test(n));
      items.push(`**Suite ${code(s)} ${st}**${why ? `: ${mdEscape(why)}` : ''}. Its ${r.metrics.length} metric(s) are reported as far as they go.`);
    }
  }

  // Failures and timeouts.
  const allFailures = model.suites.flatMap((s) => model.results.get(s)!.failures.map((f) => ({ ...f, suite: s })));
  if (allFailures.length) {
    const timeouts = allFailures.filter((f) => /timeout|timed out|exceeded/i.test(f.error));
    const suiteLevel = allFailures.filter((f) => f.scenario === '(suite)');
    const bySuite = new Map<string, number>();
    for (const f of allFailures) bySuite.set(f.suite, (bySuite.get(f.suite) ?? 0) + 1);
    items.push(
      `**${allFailures.length} recorded failure(s)** (${timeouts.length} timeout(s)${suiteLevel.length ? `, ${suiteLevel.length} for a whole suite` : ''}): ${[...bySuite].map(([s, nn]) => `${s} ${nn}`).join(', ')}. Failed samples are excluded from the statistics and listed per suite and in [Appendix C](#c-failures); a timeout is itself a result (the app did not get there within the limit).`,
    );
    for (const s of model.suites) {
      const r = model.results.get(s)!;
      if (r.failures.length) items.push(...failureList(r.failures, 4).map((l) => `  ${l.replace(/^- /, `- ${s}: `)}`));
    }
  }

  // Load.
  const logical = Number(get(model.info.env, 'machine.logicalCpus')) || 0;
  const quiet = Number((model.info.options as { quietLoad?: number } | undefined)?.quietLoad ?? 0);
  for (const s of model.suites) {
    const r = model.results.get(s)!;
    const start = r.env?.loadavgStart?.[0];
    const samples = r.env?.loadSamples ?? [];
    const max = samples.length ? Math.max(...samples) : NaN;
    const threshold = quiet > 0 ? quiet : LOAD_FLAG;
    const notReached = r.notes.find((n) => /did not drop below/.test(n));
    if ((start !== undefined && start >= threshold) || notReached) {
      items.push(`**Suite ${code(s)} started under load**: 1-min load ${fmtLoad(start)} at start (threshold ${threshold}${logical ? ` on ${logical} CPUs` : ''}), max ${fmtLoad(max)} during the suite.${notReached ? ` Quiesce: ${mdEscape(notReached)}.` : ''} Treat small differences in this suite with caution.`);
    }
  }

  // Noisy metrics. CV only means "noisy" for repeated runs; across hundreds of per-request
  // latencies it measures the shape of the tail, so large sets are judged by the median's interval.
  const noisy: string[] = [];
  for (const c of model.cmps) {
    for (const a of APPS) {
      const side = c[a];
      if (!side) continue;
      const s = side.s;
      const where = `${c.suite} ${code(c.scenario)}${c.dataset ? ` on ${c.dataset}` : ''}, ${a.toUpperCase()} ${lowerLabel(c.metric)}`;
      if (s.n >= 3 && s.n < LARGE_N && s.cv > NOISY_CV) noisy.push(`${where}: CV ${s.cv.toFixed(2)} over ${s.n} runs`);
      else if (s.n >= LARGE_N && s.median > 0 && (side.ci.hi - side.ci.lo) / s.median > WIDE_CI) noisy.push(`${where}: 95% interval of the median spans ${(((side.ci.hi - side.ci.lo) / s.median) * 100).toFixed(0)}% of it (n=${s.n})`);
    }
  }
  if (noisy.length) {
    items.push(`**${noisy.length} noisy measurement(s)** (repeated runs with CV > ${NOISY_CV}, or a median whose interval is wider than ${WIDE_CI * 100}% of it); medians and rank tests are robust to noise, but treat small differences here with care:`);
    for (const nz of noisy.slice(0, 12)) items.push(`  - ${nz}`);
    if (noisy.length > 12) items.push(`  - ... ${noisy.length - 12} more (see the CV column in the appendix)`);
  }

  // Where V1 is better (fairness: the report must show these as prominently as V2's wins).
  const v1wins = model.cmps.filter((c) => c.verdict.kind === 'better' && c.verdict.winner === 'v1' && !model.childIds.has(c.id));
  if (v1wins.length) {
    items.push(`**V1 is better in ${v1wins.length} comparison(s):**`);
    // Repeated wins of one metric (the same thing at several datasets or load levels) collapse into one line.
    const groups = new Map<string, Cmp[]>();
    for (const c of v1wins) {
      const k = `${c.suite}|${c.metric}|${baseScenario(c.scenario)}`;
      const g = groups.get(k);
      if (g) g.push(c);
      else groups.set(k, [c]);
    }
    let shown = 0;
    for (const g of groups.values()) {
      if (shown++ >= 20) {
        items.push(`  - ... more in the tables`);
        break;
      }
      const c = g[0]!;
      if (g.length < 3) {
        for (const x of g) items.push(`  - ${x.suite} ${code(x.scenario)}${x.dataset ? ` on ${x.dataset}` : ''}, ${lowerLabel(x.metric)}: ${withUnit(x.v1!.s.median, x.unit)} vs ${withUnit(x.v2!.s.median, x.unit)} (${diffWords(x)}${fewNote(x)})`);
        continue;
      }
      const facts = g.map((x) => x.verdict.adv ?? 1).filter((x) => Number.isFinite(x) && x > 0).map((x) => 1 / x);
      const where = g.map((x) => `${x.scenario}${x.dataset ? ` ${x.dataset}` : ''}`);
      const fixedWindow = c.metric === 'server_cpu_s' && model.cmps.some((x) => x.metric === 'server_cpu_ms_per_request')
        ? '; this is CPU over a fixed load window, which grows with the requests served, so compare the derived CPU per request in the API tables'
        : '';
      items.push(`  - ${c.suite} ${code(baseScenario(c.scenario))}, ${lowerLabel(c.metric)}, ${g.length} cases (${where.slice(0, 6).join(', ')}${where.length > 6 ? ', ...' : ''}): V1 better by ${fmtFactor(Math.min(...facts))}x to ${fmtFactor(Math.max(...facts))}x${g.some((x) => x.verdict.basis === 'few') ? ' (some n=1)' : ''}${fixedWindow}`);
    }
  } else {
    items.push('**V1 is not better in any compared metric.**');
  }

  const nsCount = model.cmps.filter((c) => c.verdict.kind === 'ns').length;
  const sameCount = model.cmps.filter((c) => c.verdict.kind === 'same').length;
  if (nsCount || sameCount) items.push(`**${nsCount} comparison(s) are not significant** (p >= ${SIGNIFICANCE_P}) and **${sameCount} are within ${PRACTICAL * 100}%** (or identical sizes); they are marked "n.s." and "within 5%" in the tables.`);

  // Winner flips across datasets.
  const flips: string[] = [];
  const byKey = new Map<string, Cmp[]>();
  for (const c of model.cmps) {
    if (c.dataset === null) continue;
    const k = `${c.suite}|${c.scenario}|${c.metric}`;
    const l = byKey.get(k);
    if (l) l.push(c);
    else byKey.set(k, [c]);
  }
  for (const [k, cs] of byKey) {
    const winners = cs.filter((c) => c.verdict.kind === 'better' && c.verdict.basis !== 'few');
    const w = new Set(winners.map((c) => c.verdict.winner));
    if (w.size > 1) {
      const [suite, scenario, metric] = k.split('|');
      flips.push(`${suite} ${code(scenario!)} ${lowerLabel(metric!)}: ${winners.map((c) => `${c.dataset} ${c.verdict.winner!.toUpperCase()}`).join(', ')}`);
    }
  }
  if (flips.length) {
    items.push(`**The better app changes with dataset size** in ${flips.length} case(s):`);
    for (const f of flips.slice(0, 12)) items.push(`  - ${f}`);
  }

  // Scaling: growth from the smallest non-empty to the largest dataset.
  const scaling: Array<{ text: string; spread: number }> = [];
  for (const [k, cs] of byKey) {
    if (cs.some((c) => concurrencyOf(c) !== null)) continue;
    const nonEmpty = cs.filter((c) => c.dataset !== 'empty' && c.v1 && c.v2).sort((a, b) => datasetRank(a.dataset) - datasetRank(b.dataset));
    if (nonEmpty.length < 2) continue;
    const lo = nonEmpty[0]!;
    const hi = nonEmpty[nonEmpty.length - 1]!;
    if (lo.unit !== 'ms' && lo.unit !== 'MiB') continue;
    const g1 = hi.v1!.s.median / lo.v1!.s.median;
    const g2 = hi.v2!.s.median / lo.v2!.s.median;
    if (!Number.isFinite(g1) || !Number.isFinite(g2) || g1 <= 0 || g2 <= 0) continue;
    const spread = Math.max(g1 / g2, g2 / g1);
    if (spread >= 3 && Math.max(g1, g2) >= 3) {
      const [suite, scenario, metric] = k.split('|');
      scaling.push({ spread, text: `${suite} ${code(scenario!)} ${lowerLabel(metric!)} from ${lo.dataset} to ${hi.dataset}: V1 x${fmtFactor(g1)}, V2 x${fmtFactor(g2)}` });
    }
  }
  if (scaling.length) {
    scaling.sort((a, b) => b.spread - a.spread || cmpStr(a.text, b.text));
    items.push(`**The apps scale differently** (growth of the median with dataset size differs by 3x or more):`);
    for (const s of scaling.slice(0, 12)) items.push(`  - ${s.text}`);
  }

  // Payload asymmetry.
  const payloadGroups = new Map<string, string[]>();
  for (const c of model.cmps) {
    const b1 = metaNumber(c.v1?.m, RESPONSE_BYTES_KEYS);
    const b2 = metaNumber(c.v2?.m, RESPONSE_BYTES_KEYS);
    if (!b1 || !b2 || Math.max(b1 / b2, b2 / b1) < 10 || concurrencyOf(c) !== null) continue;
    const k = `${code(c.scenario)}: V1 ${fmtPayload(b1)}, V2 ${fmtPayload(b2)} per response`;
    const g = payloadGroups.get(k) ?? [];
    if (c.dataset) g.push(c.dataset);
    payloadGroups.set(k, g);
  }
  const payload = [...payloadGroups].map(([k, d]) => `${k}${d.length ? ` (${d.join(', ')})` : ''}`);
  if (payload.length) {
    items.push(`**Response sizes differ by 10x or more**, so these latencies compare different amounts of work:`);
    for (const p of payload.slice(0, 10)) items.push(`  - ${p}`);
  }

  // One-sided metrics.
  const oneSided = model.cmps.filter((c) => c.verdict.kind === 'one-sided' && !model.childIds.has(c.id));
  if (oneSided.length) {
    items.push(`**${oneSided.length} metric(s) exist for only one app** (not compared): ${oneSided.slice(0, 10).map((c) => `${c.suite} ${code(c.scenario)} ${c.metric} (${c.v1 ? 'V1' : 'V2'})`).join(', ')}${oneSided.length > 10 ? ', ...' : ''}.`);
  }

  // Harness notes that point at measurement problems.
  const flagged = model.suites.flatMap((s) => model.results.get(s)!.notes.filter((n) => /validation:|leaked|removed .* non-finite|merged with a later invocation/i.test(n)).map((n) => `${s}: ${n}`));
  if (flagged.length) {
    items.push(`**Harness notes worth checking:**`);
    for (const f of flagged.slice(0, 10)) items.push(`  - ${mdEscape(f)}`);
  }

  // Headline rows resting on one run.
  const few = headline.filter((r) => r.c.verdict.basis === 'few');
  if (few.length) items.push(`**${few.length} headline metric(s) rest on too few runs for a significance test**: ${few.map((r) => `${headlineLabel(r)} (n=${r.c.verdict.minN})`).join('; ')}. They are decided by value (and, with 2 or more runs, only when every run of one app beat every run of the other).`);

  for (const it of items) out.push(it.startsWith('  ') ? it : `- ${it}`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// analysis.md

function analysisBlock(model: Model, file: string): { lines: string[]; warning?: string } {
  const inRepo = path.relative(REPO_ROOT, file);
  const rel = inRepo.startsWith('..') || path.isAbsolute(inRepo) ? shortPath(file) : inRepo;
  if (!fs.existsSync(file)) {
    return { lines: ['> [!NOTE]', `> No hand-written analysis yet (${code(rel)} does not exist). Write one with front matter \`runId: ${model.info.runId}\` and regenerate.`] };
  }
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const front: Record<string, string> = {};
  if (fm) {
    for (const l of fm[1]!.split('\n')) {
      const m = l.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
      if (m) front[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
    }
  }
  const body = (fm ? raw.slice(fm[0].length) : raw).trim();
  if (front.runId !== model.info.runId) {
    const why = front.runId ? `was written for run ${code(front.runId)}` : 'has no `runId` in its front matter';
    return {
      lines: ['> [!WARNING]', `> ${code(rel)} ${why}, not for this run (${code(model.info.runId)}), so it is not included. Update it for this run's numbers and set \`runId: ${model.info.runId}\`.`],
      warning: `analysis.md ${front.runId ? `is for run ${front.runId}` : 'has no runId'}; not injected (report is for ${model.info.runId})`,
    };
  }
  // Demote headings by three levels so the analysis nests under "### Analysis" (fenced code, where
  // a leading # is a shell comment, is left alone).
  let fenced = false;
  const lines = body.split('\n').map((l) => {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    const m = !fenced && l.match(/^(#{1,6}) (.*)$/);
    return m ? `${'#'.repeat(Math.min(6, m[1]!.length + 3))} ${m[2]}` : l;
  });
  return { lines: [`_Hand-written for this run (${code(rel)}), included verbatim._`, '', ...lines] };
}

// ---------------------------------------------------------------------------------------------
// Threats to validity

function threatsBlock(model: Model): string[] {
  const out: string[] = [];
  const env = model.info.env ?? {};
  const items: string[] = [];
  items.push('**The V2 UI runs through an IPC shim, not the Tauri host.** The shim executes the real `tendril-app` command handlers but adds one loopback HTTP hop per command, and its memory is not `tendril-app` memory (the desktop suite measures the real app).');
  items.push('**Blink is not WKWebView.** UI timings come from headless Chromium for both apps; the desktop apps render with WKWebView, where only process-level start and memory are measured.');
  items.push('**Desktop windows differ in size** (V1 1800x1200, V2 1280x800), which changes WebKit layer and backing-store memory.');
  items.push("**API payloads differ.** V2's plan list returns full plan objects including the latest revision text, V1's a thin summary; latency is shown next to response bytes, and neither app is asked to do the other's work.");
  items.push('**Build provenance differs.** V1 is the signed v1.2.4 release (or a local publish of the same tag); V2 is built from source at the pinned commit with the default release profile. Neither is the other\'s shipping artifact type.');
  const bins = getAny(env, 'apps.v1.binaries');
  if (Array.isArray(bins)) {
    const withFw = (bins as Array<Record<string, unknown>>).filter((b) => b?.exists === true && Array.isArray(b.frameworks) && (b.frameworks as unknown[]).length);
    const versions = new Set(withFw.map((b) => (b.frameworks as Array<{ version: string }>).map((f) => f.version).join('/')));
    if (versions.size > 1) {
      items.push(`**The V1 binaries on this machine bundle different .NET runtimes** (${withFw.map((b) => `${code(shortPath(String(b.path)))}: ${(b.frameworks as Array<{ name: string; version: string }>).map((f) => f.version).join(', ')}`).join('; ')}); results depend on which one served each suite (see the suite notes).`);
    }
  }
  items.push('**Peak footprint of a process set is a sum of per-process peaks**, an upper bound on the simultaneous peak.');
  items.push('**V1 startup spawns short-lived child processes** (login shells, `which`, `sort`, ...); they are part of its process tree and are counted in startup CPU and memory.');
  items.push('**V2 starts from an empty working directory**, so it deploys stub promptwares (as a launchd-managed install would).');
  const loads = model.suites.map((s) => model.results.get(s)!.env?.loadSamples ?? []).flat();
  if (loads.length) {
    const sm = summarize(loads);
    items.push(`**Machine noise.** Other processes shared the machine: the 1-minute load average during the suites had median ${sm.median.toFixed(2)} and max ${sm.max.toFixed(2)}${get(env, 'machine.logicalCpus') ? ` on ${get(env, 'machine.logicalCpus')} CPUs` : ''}. ABBA interleaving cancels linear drift, not bursts.`);
  }
  const k = model.knobs;
  if (k && model.info.profile !== 'full') items.push(`**This is a \`${model.info.profile}\` run**: small sample counts (for example ${k.startup.firstStartRuns} cold starts and ${k.ui.coldLoads} cold UI loads per dataset and app) make most differences untestable at p < ${SIGNIFICANCE_P}.`);
  const few = model.cmps.filter((c) => c.verdict.basis === 'few');
  if (few.length) {
    const bySuite = new Map<string, number>();
    for (const c of few) bySuite.set(c.suite, (bySuite.get(c.suite) ?? 0) + 1);
    items.push(
      `**${few.length} comparison(s) have too few samples for a Mann-Whitney U test to ever reach p < ${SIGNIFICANCE_P}** (${[...bySuite].map(([s2, n2]) => `${s2} ${n2}`).join(', ')}): with 2 runs per app the smallest possible p is ${minAchievableP(2, 2).toFixed(2)}, with 3 it is ${minAchievableP(3, 3).toFixed(2)}, and at least 5 per app are needed. ` +
        'These are decided by value and marked "n=1" or "every run"; more runs per app (the profile knobs) would make them testable.',
    );
  }
  const dirty = [get(env, 'apps.v1.cloneDirty'), get(env, 'apps.v2.cloneDirty')].map((x) => Number(x ?? 0));
  if (dirty.some((d) => d > 0)) items.push(`**A clone under test had local modifications** (V1 ${dirty[0]}, V2 ${dirty[1]} file(s)).`);
  if (model.results.has('network')) {
    items.push("**Network bytes: what is and is not a socket.** V2's loopback numbers come from the IPC shim standing in for the Tauri host (it runs the real command handlers and bridges, so its daemon traffic is the app's, but the UI driving it is Blink, not WKWebView). V2's UI-to-backend numbers are IPC and bundled assets that never touch a socket in the real app. Counts are application-layer bytes on loopback (no TCP/IP headers, no TLS), and a scenario window includes whatever background traffic ran during it. External traffic from `nettop` is a lower bound.");
  }
  items.push('**Warm WebKit caches for V1 desktop runs.** The user\'s real V1 WebKit data directory is never wiped, so V1 desktop runs may start with a warm cache.');
  for (const it of items) out.push(`- ${it}`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Reproduce

function reproduceBlock(model: Model): string[] {
  const { info } = model;
  const out: string[] = [];
  const bench = get(info.env, 'harness.benchSha');
  const v2 = info.pins?.v2Sha ?? info.pins?.v2Ref ?? '<sha>';
  out.push(`On an Apple Silicon Mac with Node 26, pnpm, Rust (the V2 repo's toolchain), .NET 10, \`gh\` and Xcode command line tools, from the repo root${bench ? ` at ${code(bench.slice(0, 12))}` : ''}:`);
  out.push('');
  out.push('```sh');
  out.push('node src/benchmark/bin/tendril-bench.ts doctor');
  out.push(`node src/benchmark/bin/tendril-bench.ts setup --v2-ref ${v2}`);
  out.push('node src/benchmark/bin/tendril-bench.ts datasets');
  const inv = (info.invocations ?? []).map((i) => i.argv.join(' '));
  if (inv.length) for (const a of inv) out.push(`node src/benchmark/bin/tendril-bench.ts ${a}`);
  else out.push(`node src/benchmark/bin/tendril-bench.ts run --profile ${info.profile} --quiet-load 2`);
  out.push(`node src/benchmark/bin/tendril-bench.ts report --run <runId>`);
  out.push('```');
  out.push('');
  out.push(`The \`run\` line${inv.length > 1 ? 's are' : ' is'} exactly what produced this run${inv.length > 1 ? ' (a resumed run has one line per invocation)' : ''}. The pins are V1 ${code(info.pins?.v1Ref ?? V1_REF)} (${code(String(info.pins?.v1Sha ?? V1_SHA))}) and V2 ${code(String(v2))}; \`setup\` clones and builds both into the workspace and records what it built in \`build-info.json\`. Raw results of this run are in ${model.fixtures ? '`src/benchmark/report/fixtures/`' : `[\`results/${info.runId}/\`](results/${info.runId}/)`}, and \`report --run\` regenerates this file byte for byte from them.`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Appendix

function appendixBlock(model: Model): string[] {
  const out: string[] = [];
  out.push('### A. Full statistics');
  out.push('');
  out.push('Every metric, per app: sample count, distribution and coefficient of variation (CV = sd / mean). Values in the unit named in the metric column (sizes in MB).');
  out.push('');
  for (const s of model.suites) {
    const cmps = model.bySuite.get(s) ?? [];
    if (!cmps.length) continue;
    out.push(`<details><summary>${mdEscape(suiteTitle(s))} (${cmps.length} metrics)</summary>`);
    out.push('');
    const rows: string[][] = [];
    for (const c of cmps) {
      for (const a of APPS) {
        const side = c[a];
        if (!side) continue;
        const x = side.s;
        const u = c.unit;
        rows.push([
          code(c.scenario),
          c.dataset ?? '-',
          `${c.metric}${unitText(u) ? ` (${unitText(u)})` : ''}`,
          a.toUpperCase(),
          String(x.n),
          num(x.min, u),
          num(x.p5, u),
          num(x.p25, u),
          num(x.median, u),
          num(x.p75, u),
          num(x.p90, u),
          num(x.p95, u),
          num(x.p99, u),
          num(x.max, u),
          num(x.mean, u),
          x.n > 1 ? num(x.sd, u) : '',
          x.n > 1 && Number.isFinite(x.cv) ? x.cv.toFixed(3) : '',
        ]);
      }
    }
    out.push(table(['Scenario', 'Dataset', 'Metric', 'App', 'n', 'min', 'p5', 'p25', 'median', 'p75', 'p90', 'p95', 'p99', 'max', 'mean', 'sd', 'CV'], ['l', 'l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'], rows));
    out.push('');
    out.push('</details>');
    out.push('');
  }

  out.push('### B. Exact sizes');
  out.push('');
  const size = model.results.get('size');
  if (size) {
    const rows: string[][] = [];
    const seen = new Map<string, Record<AppId, number | null>>();
    for (const m of size.metrics) {
      if (!/^bytes/.test(m.metric)) continue;
      const k = `${m.scenario}\u0000${m.metric}`;
      const e = seen.get(k) ?? { v1: null, v2: null };
      const v = m.samples.find((x) => Number.isFinite(x));
      if (v !== undefined) e[m.app] = v;
      seen.set(k, e);
    }
    for (const [k, e] of seen) {
      const [scenario, metric] = k.split('\u0000');
      let imp = '';
      if (e.v1 !== null && e.v2 !== null) {
        if (e.v1 === e.v2) imp = '1x (identical)';
        else if (e.v1 === 0) imp = 'V1 has none';
        else if (e.v2 === 0) imp = 'V2 has none';
        else imp = e.v2 < e.v1 ? `${fmtFactor(e.v1 / e.v2)}x smaller` : `${fmtFactor(e.v2 / e.v1)}x larger`;
      }
      rows.push([code(scenario!), metric!, e.v1 === null ? '' : fmtInt(e.v1), e.v2 === null ? '' : fmtInt(e.v2), imp]);
    }
    out.push(table(['Artifact', 'Metric', 'V1 bytes', 'V2 bytes', 'Improvement (V2 vs V1)'], ['l', 'l', 'r', 'r', 'l'], rows));
    const digests = size.metrics.filter((m) => typeof m.meta?.sha256 === 'string');
    if (digests.length) {
      out.push('');
      out.push('Digests:');
      out.push('');
      for (const m of digests) out.push(`- ${m.app.toUpperCase()} ${code(m.scenario)}${typeof m.meta?.file === 'string' ? ` (${code(path.basename(m.meta.file))})` : ''}: sha256 ${code(String(m.meta!.sha256))}`);
    }
  } else {
    out.push('_The size suite did not run._');
  }
  out.push('');

  out.push('### C. Failures');
  out.push('');
  const failRows: string[][] = [];
  for (const s of model.suites) {
    for (const f of model.results.get(s)!.failures) failRows.push([s, f.app.toUpperCase(), f.dataset ?? '-', code(f.scenario), mdEscape(f.error.split('\n')[0]!.slice(0, 300))]);
  }
  out.push(failRows.length ? table(['Suite', 'App', 'Dataset', 'Scenario', 'Error (first line)'], ['l', 'l', 'l', 'l', 'l'], failRows) : '_No failures were recorded._');
  out.push('');

  out.push('### D. Harness notes');
  out.push('');
  let anyNotes = false;
  for (const s of model.suites) {
    const notes = model.results.get(s)!.notes;
    if (!notes.length) continue;
    anyNotes = true;
    out.push(`**${s}**`);
    out.push('');
    for (const n of notes) out.push(`- ${mdEscape(n)}`);
    out.push('');
  }
  if (!anyNotes) {
    out.push('_No notes were recorded._');
    out.push('');
  }

  out.push('### E. Run metadata');
  out.push('');
  const { info } = model;
  const rows: string[][] = [
    ['Run id', code(info.runId)],
    ['Profile', code(info.profile)],
    ['Status', info.status],
    ['Created / updated', `${info.createdAt} / ${info.updatedAt}`],
    ['Suites requested', (info.suitesRequested ?? []).join(', ')],
    ['Suite status', Object.entries(info.suiteStatus ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')],
    ['Datasets', (info.datasets ?? []).join(', ')],
    ['Apps', (info.apps ?? []).join(', ')],
    ['Pins', `V1 ${info.pins?.v1Ref ?? ''} ${code(String(info.pins?.v1Sha ?? ''))}; V2 ${code(String(info.pins?.v2Sha ?? info.pins?.v2Ref ?? ''))}`],
  ];
  out.push(table(['Item', 'Value'], ['l', 'l'], rows));
  out.push('');
  const inv = info.invocations ?? [];
  if (inv.length) {
    out.push(table(['Invocation', 'Started', 'Finished', 'Status', 'Suites'], ['l', 'l', 'l', 'l', 'l'], inv.map((i) => [code(i.argv.join(' ')), i.startedAt, i.finishedAt ?? '', i.status, Object.entries(i.suiteStatus ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || i.suites.join(', ')])));
  }
  return out;
}

export default main;
