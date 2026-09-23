// The result schema every suite writes, the run directory layout, and readers for the report.
//
// <ws>/runs/<runId>/
//   run.json               RunInfo: env capture, pins, build-info, profile, argv, invocations
//   results/<suite>.json   SuiteResult per suite
//   homes/                 per-run app homes (restored from dataset snapshots)
//   logs/                  harness.log plus one stdout/stderr pair per spawned process

import fs from 'node:fs';
import path from 'node:path';
import { localIso } from './log.ts';

export type AppId = 'v1' | 'v2';
export const APP_IDS: readonly AppId[] = ['v1', 'v2'];

export type Unit = 'ms' | 'MiB' | 'bytes' | 'count' | 'percent' | 'req/s' | 'cpu_s';

export interface Metric {
  /** 'startup' */
  suite: string;
  /** 'first-start' | 'warm-start' | 'GET /api/plans?limit=50' ... */
  scenario: string;
  app: AppId;
  /** 'empty' | ... | null for dataset-independent metrics (size). */
  dataset: string | null;
  /** 'http_ready_ms' | 'footprint_mib' | 'bytes' ... */
  metric: string;
  unit: Unit;
  /** Raw samples (one element for deterministic metrics like a file size). */
  samples: number[];
  /**
   * Samples that never completed (a timeout, or the app failing so the event could not happen), as
   * lower bounds in the metric's unit: the true value is at least this. A timeout is a result, so the
   * report ranks these with the samples (as values at their bound) instead of dropping them, which
   * would keep only an app's faster runs. Only meaningful where lower is better.
   */
  censored?: number[];
  /**
   * The independent instance (server process, browser session, launch) each sample came from,
   * parallel to `samples`. Samples of one instance are not independent of each other, so the report
   * resamples instances before samples when it builds an interval (hierarchical bootstrap).
   */
  instance?: number[];
  better: 'lower' | 'higher';
  /** Response bytes, errors, notes, per-role breakdown, ... */
  meta?: Record<string, unknown>;
}

export interface SeriesEntry {
  app: AppId;
  dataset: string | null;
  scenario: string;
  name: string;
  unit: string;
  points: Array<[number, number]>;
}

export interface FailureEntry {
  app: AppId;
  dataset: string | null;
  scenario: string;
  error: string;
}

export interface SuiteEnv {
  loadavgStart: number[];
  loadavgEnd: number[];
  loadSamples?: number[];
  quietWaitMs?: number;
}

export interface SuiteResult {
  suite: string;
  runId: string;
  profile: string;
  startedAt: string;
  finishedAt: string;
  env: SuiteEnv;
  metrics: Metric[];
  /** Time series (idle/desktop). */
  series?: SeriesEntry[];
  /** Anomalies, skipped items, failures: never silently drop anything. */
  notes: string[];
  failures: FailureEntry[];
}

export type RunStatus = 'running' | 'complete' | 'partial' | 'failed' | 'interrupted';

export interface Invocation {
  argv: string[];
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  suites: string[];
  /** Per suite: 'ok' | 'failures' (completed with recorded failures) | 'crashed' | 'missing' | 'skipped'. */
  suiteStatus?: Record<string, string>;
  /** Environment captured when this invocation started (RunInfo.env is the latest one). */
  env?: Record<string, unknown>;
}

export interface RunInfo {
  runId: string;
  profile: string;
  createdAt: string;
  updatedAt: string;
  status: RunStatus;
  suitesRequested: string[];
  datasets: string[];
  apps: AppId[];
  pins: { v1Ref: string; v1Sha: string | null; v2Ref: string; v2Sha: string | null };
  /** EnvCapture from lib/env.ts (typed loosely here so the report never depends on env.ts). */
  env: Record<string, unknown>;
  /** Contents of <ws>/build-info.json at run start (null when missing). */
  buildInfo: unknown;
  options: Record<string, unknown>;
  invocations: Invocation[];
  /** Latest status per suite across all invocations: 'ok' | 'failures' | 'crashed' | 'missing' | 'skipped'. */
  suiteStatus?: Record<string, string>;
}

// ---------------------------------------------------------------------------------------------
// Run ids and directories

/** `YYYYMMDD-HHMMSS-<profile>` in local time. */
export function makeRunId(profile: string, d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${profile}`;
}

export const RUN_ID_RE = /^\d{8}-\d{6}-[A-Za-z0-9_-]+$/;

export function runDirFor(ws: string, runId: string): string {
  return path.join(ws, 'runs', runId);
}

export interface RunDirs {
  root: string;
  homes: string;
  logs: string;
  results: string;
}

export function runDirs(runDir: string): RunDirs {
  return { root: runDir, homes: path.join(runDir, 'homes'), logs: path.join(runDir, 'logs'), results: path.join(runDir, 'results') };
}

export function initRunDir(ws: string, runId: string): RunDirs {
  const d = runDirs(runDirFor(ws, runId));
  for (const p of [d.root, d.homes, d.logs, d.results]) fs.mkdirSync(p, { recursive: true });
  return d;
}

// ---------------------------------------------------------------------------------------------
// JSON I/O

/** Write-then-rename, so a crash never leaves a truncated results file for the report to choke on. */
export function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`cannot read ${file}: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Building suite results

export function newSuiteResult(suite: string, runId: string, profile: string): SuiteResult {
  return {
    suite,
    runId,
    profile,
    startedAt: localIso(),
    finishedAt: '',
    env: { loadavgStart: [], loadavgEnd: [] },
    metrics: [],
    series: [],
    notes: [],
    failures: [],
  };
}

export function metricKey(m: Pick<Metric, 'scenario' | 'app' | 'dataset' | 'metric'>): string {
  return `${m.scenario}\u0000${m.app}\u0000${m.dataset ?? ''}\u0000${m.metric}`;
}

function seriesKey(s: Pick<SeriesEntry, 'app' | 'dataset' | 'scenario' | 'name'>): string {
  return `${s.scenario}\u0000${s.app}\u0000${s.dataset ?? ''}\u0000${s.name}`;
}

/**
 * Structural checks before writing. Non-finite samples (NaN would silently become null in JSON)
 * are removed and reported in notes; anything else that is malformed is reported, not fixed.
 */
export function validateSuiteResult(r: SuiteResult): string[] {
  const problems: string[] = [];
  for (const m of r.metrics) {
    const id = `${m.scenario}/${m.app}/${m.dataset ?? '-'}/${m.metric}`;
    if (!Array.isArray(m.samples)) {
      problems.push(`metric ${id}: samples is not an array`);
      m.samples = [];
      continue;
    }
    const bad = m.samples.filter((x) => typeof x !== 'number' || !Number.isFinite(x)).length;
    if (bad) {
      const keep = m.samples.map((x) => typeof x === 'number' && Number.isFinite(x));
      if (Array.isArray(m.instance) && m.instance.length === m.samples.length) m.instance = m.instance.filter((_, k) => keep[k]);
      m.samples = m.samples.filter((_, k) => keep[k]);
      problems.push(`metric ${id}: removed ${bad} non-finite sample(s)`);
    }
    if (m.censored !== undefined && (!Array.isArray(m.censored) || m.censored.some((x) => typeof x !== 'number' || !Number.isFinite(x)))) {
      problems.push(`metric ${id}: censored is not an array of finite numbers; dropped`);
      delete m.censored;
    }
    if (m.instance !== undefined && (!Array.isArray(m.instance) || m.instance.length !== m.samples.length)) {
      problems.push(`metric ${id}: instance does not match samples (${Array.isArray(m.instance) ? m.instance.length : 'not an array'} vs ${m.samples.length}); dropped`);
      delete m.instance;
    }
    if (m.samples.length === 0 && !m.censored?.length) problems.push(`metric ${id}: no samples`);
    if (m.suite !== r.suite) problems.push(`metric ${id}: suite is "${m.suite}", expected "${r.suite}"`);
  }
  const seen = new Map<string, number>();
  for (const m of r.metrics) seen.set(metricKey(m), (seen.get(metricKey(m)) ?? 0) + 1);
  for (const [k, n] of seen) if (n > 1) problems.push(`metric ${k.split('\u0000').join('/')} appears ${n} times`);
  return problems;
}

/**
 * Writes `<runDir>/results/<suite>.json`. When the file exists (a resumed run), the two are merged:
 * a metric or series with the same key is replaced by the new one (the rerun supersedes it), others
 * are kept; old failures for an (app, dataset, scenario) that the new invocation produced results or
 * failures for are dropped as superseded; notes accumulate; the time span and load samples widen.
 */
export function writeSuiteResult(runDir: string, result: SuiteResult): string {
  const file = path.join(runDirs(runDir).results, `${result.suite}.json`);
  const old = readJson<SuiteResult>(file);
  let out = result;
  if (old) {
    const newKeys = new Set(result.metrics.map(metricKey));
    const replaced = old.metrics.filter((m) => newKeys.has(metricKey(m))).length;
    const touched = new Set<string>([
      ...result.metrics.map((m) => `${m.app}\u0000${m.dataset ?? ''}\u0000${m.scenario}`),
      ...result.failures.map((f) => `${f.app}\u0000${f.dataset ?? ''}\u0000${f.scenario}`),
    ]);
    const newSeries = new Set((result.series ?? []).map(seriesKey));
    out = {
      ...result,
      startedAt: old.startedAt < result.startedAt ? old.startedAt : result.startedAt,
      env: {
        loadavgStart: old.env?.loadavgStart ?? result.env.loadavgStart,
        loadavgEnd: result.env.loadavgEnd,
        loadSamples: [...(old.env?.loadSamples ?? []), ...(result.env.loadSamples ?? [])],
        quietWaitMs: (old.env?.quietWaitMs ?? 0) + (result.env.quietWaitMs ?? 0),
      },
      metrics: [...old.metrics.filter((m) => !newKeys.has(metricKey(m))), ...result.metrics],
      series: [...(old.series ?? []).filter((s) => !newSeries.has(seriesKey(s))), ...(result.series ?? [])],
      notes: [
        ...old.notes,
        `merged with a later invocation started ${result.startedAt} (${result.metrics.length} metric(s), ${replaced} replaced)`,
        ...result.notes,
      ],
      failures: [
        ...old.failures.filter((f) => !touched.has(`${f.app}\u0000${f.dataset ?? ''}\u0000${f.scenario}`)),
        ...result.failures,
      ],
    };
  }
  writeJsonAtomic(file, out);
  return file;
}

/** Every suite result of a run, ordered by suite name. */
export function readSuiteResults(runDir: string): SuiteResult[] {
  const dir = runDirs(runDir).results;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readJson<SuiteResult>(path.join(dir, f)))
    .filter((r): r is SuiteResult => r !== null);
}

// ---------------------------------------------------------------------------------------------
// run.json

export function writeRunInfo(runDir: string, info: RunInfo): string {
  const file = path.join(runDir, 'run.json');
  writeJsonAtomic(file, { ...info, updatedAt: localIso() });
  return file;
}

export function readRunInfo(runDir: string): RunInfo | null {
  return readJson<RunInfo>(path.join(runDir, 'run.json'));
}

/** Read-modify-write of run.json (the harness is the only writer of a given run). */
export function updateRunInfo(runDir: string, fn: (info: RunInfo) => void): RunInfo {
  const info = readRunInfo(runDir);
  if (!info) throw new Error(`no run.json in ${runDir}`);
  fn(info);
  writeRunInfo(runDir, info);
  return info;
}

export interface RunListing {
  runId: string;
  dir: string;
  info: RunInfo | null;
  suites: string[];
}

/** All runs in the workspace, oldest first (run ids sort chronologically). */
export function listRuns(ws: string): RunListing[] {
  const root = path.join(ws, 'runs');
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && RUN_ID_RE.test(d.name))
    .map((d) => d.name)
    .sort()
    .map((runId) => {
      const dir = path.join(root, runId);
      const resultsDir = runDirs(dir).results;
      const suites = fs.existsSync(resultsDir)
        ? fs
            .readdirSync(resultsDir)
            .filter((f) => f.endsWith('.json'))
            .map((f) => f.slice(0, -5))
            .sort()
        : [];
      let info: RunInfo | null = null;
      try {
        info = readRunInfo(dir);
      } catch {
        info = null;
      }
      return { runId, dir, info, suites };
    });
}

/** The newest run whose last invocation finished with status 'complete'. */
export function latestCompleteRun(ws: string): RunListing | null {
  const runs = listRuns(ws).filter((r) => r.info?.status === 'complete');
  return runs.length ? runs[runs.length - 1]! : null;
}
