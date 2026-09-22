// Suite registry and runner. Suites run one at a time (they measure the same machine), each wrapped
// so a crash becomes a SuiteResult with failures instead of ending the run, and each followed by a
// leak check so one suite's leftover daemon can never skew the next suite's numbers.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import type { AdapterOptions, AppAdapter } from '../apps/types.ts';
import { PROFILES, type DatasetName, type ProfileKnobs, type ProfileName, type WorkspacePaths } from '../lib/config.ts';
import { loadSampler, quiesce } from '../lib/env.ts';
import { errorMessage, errorText, localIso, type Logger } from '../lib/log.ts';
import { liveProcesses, stopAll } from '../lib/proc.ts';
import type { ProcStat } from '../lib/procstat.ts';
import {
  APP_IDS,
  newSuiteResult,
  runDirs,
  updateRunInfo,
  validateSuiteResult,
  writeSuiteResult,
  type AppId,
  type RunDirs,
  type SuiteResult,
} from '../lib/results.ts';

const SUITES_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Execution order for `--suite all`: no-process suites first, the heaviest (desktop) last. */
export const SUITE_NAMES = ['size', 'cli', 'startup', 'idle', 'api', 'ui', 'network', 'desktop'] as const;
export type SuiteName = (typeof SUITE_NAMES)[number];

/** Suites that never start an app, so they can run even when the adapters fail to load. */
export const SUITES_WITHOUT_APPS: ReadonlySet<string> = new Set(['size']);

export function isSuiteName(s: string): s is SuiteName {
  return (SUITE_NAMES as readonly string[]).includes(s);
}

/** `all` or a comma list; unknown names are an error (listing the known ones). */
export function resolveSuites(spec: string | undefined): SuiteName[] {
  const raw = (spec ?? 'all').split(',').map((s) => s.trim()).filter(Boolean);
  if (raw.length === 0 || raw.includes('all')) return [...SUITE_NAMES];
  const unknown = raw.filter((s) => !isSuiteName(s));
  if (unknown.length) throw new Error(`unknown suite(s): ${unknown.join(', ')} (known: ${SUITE_NAMES.join(', ')}, all)`);
  // Keep the canonical order regardless of how they were listed, and drop duplicates.
  return SUITE_NAMES.filter((s) => raw.includes(s));
}

// ---------------------------------------------------------------------------------------------
// Context

export interface InterleaveOk<A, T> {
  app: A;
  i: number;
  ok: true;
  value: T;
}
export interface InterleaveErr<A> {
  app: A;
  i: number;
  ok: false;
  error: unknown;
}
export type InterleaveOutcome<A, T> = InterleaveOk<A, T> | InterleaveErr<A>;

export type Interleave = <A, T>(iterations: number, apps: readonly A[], fn: (app: A, i: number) => Promise<T>) => Promise<Array<InterleaveOutcome<A, T>>>;

export interface SuiteContext {
  ws: string;
  paths: WorkspacePaths;
  runId: string;
  runDir: string;
  dirs: RunDirs;
  profile: ProfileName;
  /** Every iteration count and duration for this profile. */
  knobs: ProfileKnobs;
  /** Datasets for the server suites (startup, idle, api, ui): --dataset or the profile default. */
  datasets: DatasetName[];
  /** Datasets for the desktop suite: --dataset or the profile default. */
  desktopDatasets: DatasetName[];
  /** Datasets for the cli suite: --dataset or the profile default. */
  cliDatasets: DatasetName[];
  /** In fixed order v1, v2 (filtered by --app). */
  apps: AppAdapter[];
  procstat: ProcStat;
  log: Logger;
  /** ABBA interleaving (v1, v2, v2, v1, ...) to cancel linear drift between the apps. */
  interleave: Interleave;
  v2Ref: string;
}

export interface SuiteModule {
  run(ctx: SuiteContext): Promise<SuiteResult>;
}

/**
 * The run order for `iterations` rounds: even rounds in the given order, odd rounds reversed
 * (A B, B A, A B, ...). With two apps each sees the same mean position, so a linear drift in machine
 * state (thermal, caches, background load) cancels out of the comparison.
 */
export function abbaSchedule<A>(iterations: number, apps: readonly A[]): Array<{ app: A; i: number }> {
  const out: Array<{ app: A; i: number }> = [];
  for (let i = 0; i < iterations; i++) {
    const order = i % 2 === 0 ? apps : [...apps].reverse();
    for (const app of order) out.push({ app, i });
  }
  return out;
}

/** A failed interleaved call, kept so the runner can record it if the suite did not. */
export interface InterleaveFailure {
  app: string;
  i: number;
  message: string;
}

function appIdOf(app: unknown): string {
  return typeof app === 'object' && app && 'id' in app ? String((app as { id: unknown }).id) : String(app);
}

/**
 * Runs `fn(app, i)` in ABBA order, sequentially. A failing call is logged and returned as
 * `{ok: false, error}`; the rest still run, so one timeout never costs the other samples. Suites
 * should turn failed outcomes into SuiteResult failures with their dataset and scenario; any the
 * suite leaves unrecorded are added by the runner (via `sink`) so none is silently dropped.
 */
export function makeInterleave(log: Logger, sink?: InterleaveFailure[]): Interleave {
  return async <A, T>(iterations: number, apps: readonly A[], fn: (app: A, i: number) => Promise<T>) => {
    const out: Array<InterleaveOutcome<A, T>> = [];
    for (const { app, i } of abbaSchedule(iterations, apps)) {
      try {
        out.push({ app, i, ok: true, value: await fn(app, i) });
      } catch (error) {
        const id = appIdOf(app);
        log.warn(`iteration ${i} for ${id} failed: ${errorMessage(error)}`);
        sink?.push({ app: id, i, message: errorMessage(error) });
        out.push({ app, i, ok: false, error });
      }
    }
    return out;
  };
}

// ---------------------------------------------------------------------------------------------
// Loading

export type LoadedSuite = { ok: true; module: SuiteModule; file: string } | { ok: false; reason: string; file: string };

export async function loadSuite(name: string, dir: string = SUITES_DIR): Promise<LoadedSuite> {
  const file = path.join(dir, `${name}.ts`);
  if (!fs.existsSync(file)) return { ok: false, reason: `suite module ${path.relative(process.cwd(), file)} does not exist`, file };
  try {
    const mod = (await import(pathToFileURL(file).href)) as Partial<SuiteModule>;
    if (typeof mod.run !== 'function') return { ok: false, reason: `${name}.ts does not export run(ctx)`, file };
    return { ok: true, module: mod as SuiteModule, file };
  } catch (e) {
    return { ok: false, reason: `failed to import ${name}.ts: ${errorText(e)}`, file };
  }
}

type AdapterFactory = (ids: AppId[], opts: AdapterOptions) => Promise<AppAdapter[]> | AppAdapter[];

/** Builds adapters through apps/index.ts (owned by the adapters part), in v1, v2 order. */
export async function loadAdapters(ids: AppId[], opts: AdapterOptions): Promise<AppAdapter[]> {
  const file = path.join(SUITES_DIR, '..', 'apps', 'index.ts');
  if (!fs.existsSync(file)) throw new Error(`apps/index.ts does not exist yet (it must export createAdapters(ids, opts))`);
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  const factory = (mod.createAdapters ?? mod.loadAdapters ?? mod.getAdapters) as AdapterFactory | undefined;
  if (typeof factory !== 'function') {
    throw new Error(`apps/index.ts must export createAdapters(ids: AppId[], opts: AdapterOptions): Promise<AppAdapter[]> (exports: ${Object.keys(mod).join(', ')})`);
  }
  const adapters = await factory(ids, opts);
  const byId = new Map(adapters.map((a) => [a.id, a]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`apps/index.ts returned no adapter for: ${missing.join(', ')}`);
  return APP_IDS.filter((id) => ids.includes(id)).map((id) => byId.get(id)!);
}

// ---------------------------------------------------------------------------------------------
// Running

export interface ContextOptions {
  ws: string;
  paths: WorkspacePaths;
  runId: string;
  runDir: string;
  profile: ProfileName;
  datasetOverride: DatasetName[] | null;
  apps: AppAdapter[];
  procstat: ProcStat;
  log: Logger;
  v2Ref: string;
}

export function createContext(o: ContextOptions): SuiteContext {
  const knobs = PROFILES[o.profile];
  return {
    ws: o.ws,
    paths: o.paths,
    runId: o.runId,
    runDir: o.runDir,
    dirs: runDirs(o.runDir),
    profile: o.profile,
    knobs,
    datasets: o.datasetOverride ?? knobs.serverDatasets,
    desktopDatasets: o.datasetOverride ?? knobs.desktopDatasets,
    cliDatasets: o.datasetOverride ?? knobs.cliDatasets,
    apps: o.apps,
    procstat: o.procstat,
    log: o.log,
    interleave: makeInterleave(o.log),
    v2Ref: o.v2Ref,
  };
}

export type SuiteStatus = 'ok' | 'failures' | 'crashed' | 'missing' | 'skipped';

export interface RunSuitesOptions {
  suites: readonly string[];
  /** 0 disables quiescing. */
  quietLoad: number;
  quietTimeoutSec: number;
  /** When set, why the adapters could not be built (suites that need apps are then skipped). */
  adapterError?: string | null;
  /** Where suite modules live (tests point this at fixtures). */
  suiteDir?: string;
}

function crashResult(ctx: SuiteContext, suite: string, reason: string, startedAt: string): SuiteResult {
  const r = newSuiteResult(suite, ctx.runId, ctx.profile);
  r.startedAt = startedAt;
  r.notes.push(`suite did not complete: ${reason.split('\n')[0]}`);
  // The failure is per app because the report groups failures by app; a suite-level crash hit both.
  const apps: AppId[] = ctx.apps.length ? ctx.apps.map((a) => a.id) : [...APP_IDS];
  for (const app of apps) r.failures.push({ app, dataset: null, scenario: '(suite)', error: reason });
  return r;
}

/**
 * Runs the suites in order and writes each result as soon as it exists. Returns the status per
 * suite and records it in run.json.
 */
export async function runSuites(ctx: SuiteContext, opts: RunSuitesOptions): Promise<Record<string, SuiteStatus>> {
  const statuses: Record<string, SuiteStatus> = {};
  for (const name of opts.suites) {
    const log = ctx.log.child(name);
    const interleaveFailures: InterleaveFailure[] = [];
    const suiteCtx: SuiteContext = { ...ctx, log, interleave: makeInterleave(log, interleaveFailures) };
    let quietWaitMs = 0;
    const preNotes: string[] = [];
    if (opts.quietLoad > 0) {
      const q = await quiesce(opts.quietLoad, opts.quietTimeoutSec, log);
      quietWaitMs = q.waitedMs;
      if (!q.reached) preNotes.push(`load did not drop below ${opts.quietLoad} within ${opts.quietTimeoutSec} s (1-min load ${q.loadavg[0]!.toFixed(2)} at start)`);
    }

    const startedAt = localIso();
    // The monotonic clock stops while the Mac sleeps and the wall clock does not: their drift is
    // how long the machine slept during the suite (timers and windows were stretched by that much).
    const wall0 = Date.now();
    const mono0 = performance.now();
    const loadavgStart = os.loadavg();
    const sampler = loadSampler();
    log.info(`suite ${name} starting (profile ${ctx.profile}, load ${loadavgStart.map((x) => x.toFixed(2)).join(' ')})`);

    let result: SuiteResult;
    let status: SuiteStatus;
    if (opts.adapterError && !SUITES_WITHOUT_APPS.has(name)) {
      result = crashResult(suiteCtx, name, `skipped: app adapters unavailable: ${opts.adapterError}`, startedAt);
      status = 'skipped';
    } else {
      const loaded = await loadSuite(name, opts.suiteDir);
      if (!loaded.ok) {
        log.error(loaded.reason);
        result = crashResult(suiteCtx, name, loaded.reason, startedAt);
        status = 'missing';
      } else {
        try {
          result = await loaded.module.run(suiteCtx);
          if (!result || typeof result !== 'object' || !Array.isArray(result.metrics)) throw new Error('run(ctx) did not return a SuiteResult');
          result.notes ??= [];
          result.failures ??= [];
          status = result.failures.length ? 'failures' : 'ok';
        } catch (e) {
          log.error(`suite ${name} crashed: ${errorText(e)}`);
          result = crashResult(suiteCtx, name, `crashed: ${errorText(e)}`, startedAt);
          status = 'crashed';
        }
      }
    }

    const loadSamples = sampler.stop();
    const sleptMs = Date.now() - wall0 - (performance.now() - mono0);
    // The runner owns load bookkeeping so every suite reports it the same way; a suite that
    // recorded its own start/end keeps them.
    result.suite = name;
    result.runId = ctx.runId;
    result.profile = ctx.profile;
    result.startedAt ||= startedAt;
    result.finishedAt = localIso();
    result.env ??= { loadavgStart, loadavgEnd: [] };
    if (!result.env.loadavgStart?.length) result.env.loadavgStart = loadavgStart;
    result.env.loadavgEnd = os.loadavg();
    if (!result.env.loadSamples?.length) result.env.loadSamples = loadSamples;
    result.env.quietWaitMs = quietWaitMs;
    result.notes.unshift(...preNotes);
    if (sleptMs > 5000) {
      const msg = `WARNING: the machine slept for about ${Math.round(sleptMs / 1000)} s during this suite (wall clock ran ahead of the monotonic clock); samples spanning the sleep are not valid`;
      log.warn(msg);
      result.notes.unshift(msg);
    }

    // Interleaved iterations that failed but never made it into `failures` would vanish from the
    // report; record them here (matching by app and error text).
    const unrecorded = interleaveFailures.filter(
      (f) => !result.failures.some((r) => r.app === f.app && r.error.includes(f.message)),
    );
    for (const f of unrecorded) {
      const app = (APP_IDS as readonly string[]).includes(f.app) ? (f.app as AppId) : null;
      if (app) result.failures.push({ app, dataset: null, scenario: `(interleaved iteration ${f.i})`, error: f.message });
    }
    if (unrecorded.length) {
      result.notes.push(`${unrecorded.length} failed interleaved iteration(s) were not recorded by the suite; the runner added them to failures`);
      if (status === 'ok') status = 'failures';
    }

    for (const p of validateSuiteResult(result)) {
      log.warn(p);
      result.notes.push(`validation: ${p}`);
    }
    if (status === 'ok' && result.metrics.length === 0) result.notes.push('suite produced no metrics');

    // Anything still running now leaked out of the suite: stop it and say so in the result.
    const leaked = liveProcesses();
    if (leaked.length) {
      const msg = `leaked ${leaked.length} process(es) past the end of the suite: ${leaked.map((l) => l.label).join(', ')} (stopped by the runner)`;
      log.warn(msg);
      result.notes.push(msg);
    }
    await stopAll(log);

    const file = writeSuiteResult(ctx.runDir, result);
    statuses[name] = status;
    log.info(`suite ${name} ${status}: ${result.metrics.length} metric(s), ${result.failures.length} failure(s) -> ${path.relative(ctx.ws, file)}`);
    try {
      updateRunInfo(ctx.runDir, (info) => {
        info.suiteStatus = { ...(info.suiteStatus ?? {}), [name]: status };
      });
    } catch (e) {
      log.warn(`could not update run.json: ${errorMessage(e)}`);
    }
  }
  return statuses;
}
