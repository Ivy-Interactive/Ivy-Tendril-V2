// Single source of truth for what is benchmarked (pins, datasets) and how hard (profiles). Suites
// must take every iteration count, duration and timeout from here so a `quick` run and a `full` run
// differ only in these numbers.

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from './log.ts';

// ---------------------------------------------------------------------------------------------
// Pins

export const V1_REF = 'v1.2.4';
/** The commit v1.2.4 points at; `setup` verifies the clone is exactly here. */
export const V1_SHA = 'f6b1de3dc299a4153d44e08409fe3aa6390f542b';
/** Default V2 commit under test; overridable with `--v2-ref` (the final run re-pins). */
export const V2_REF_DEFAULT = '2959bbb30050948c3e54bedc99323fc331f9ddf1';
export const V1_REPO = 'https://github.com/Ivy-Interactive/Ivy-Tendril.git';
export const V2_REPO = 'https://github.com/Ivy-Interactive/Ivy-Tendril-V2.git';
/** The GitHub release that provides the signed V1 installer used for size and desktop runs. */
export const V1_RELEASE_REPO = 'Ivy-Interactive/Ivy-Tendril';
export const V1_PKG_ASSET = 'IvyTendril-1.2.4-osx-arm64.pkg';

// ---------------------------------------------------------------------------------------------
// Locations

/** `src/benchmark` in the repo this file lives in. */
export const BENCH_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The repo root (where `node_modules` with playwright lives). */
export const REPO_ROOT = path.resolve(BENCH_ROOT, '..', '..');

export const DEFAULT_WORKSPACE =
  process.env.TENDRIL_BENCH_WORKSPACE ?? path.join(os.homedir(), 'Desktop', 'tendril-benchmark');

/** The user's real Tendril home. Nothing the harness starts may ever point at it. */
export const REAL_TENDRIL_HOME = path.join(os.homedir(), '.tendril');

export interface WorkspacePaths {
  ws: string;
  v1Clone: string;
  v2Clone: string;
  builds: string;
  v1Publish: string;
  /** Self-built single-file V1 (fallback server binary when the release payload does not run). */
  v1PublishBin: string;
  v2Bin: string;
  v2Dist: string;
  v2ShimDir: string;
  v2ShimBin: string;
  binDir: string;
  procstatBin: string;
  artifacts: string;
  artifactsV1: string;
  artifactsV2: string;
  buildInfo: string;
  datasets: string;
  runs: string;
  logs: string;
  /** Empty dir handed to both apps as CLAUDE_CONFIG_DIR so neither reads real credentials. */
  emptyClaudeConfig: string;
}

export function workspacePaths(ws: string = DEFAULT_WORKSPACE): WorkspacePaths {
  const abs = path.resolve(ws);
  const v2Clone = path.join(abs, 'ivy-tendril-v2');
  const builds = path.join(abs, 'builds');
  const binDir = path.join(builds, 'bin');
  return {
    ws: abs,
    v1Clone: path.join(abs, 'ivy-tendril-v1'),
    v2Clone,
    builds,
    v1Publish: path.join(builds, 'v1-publish'),
    v1PublishBin: path.join(builds, 'v1-publish', 'Ivy.Tendril'),
    v2Bin: path.join(v2Clone, 'target', 'release', 'tendril'),
    v2Dist: path.join(v2Clone, 'src', 'apps', 'tendril-app', 'dist'),
    v2ShimDir: path.join(builds, 'v2-shim'),
    v2ShimBin: path.join(builds, 'v2-shim', 'target', 'release', 'v2shim'),
    binDir,
    procstatBin: path.join(binDir, 'procstat'),
    artifacts: path.join(abs, 'artifacts'),
    artifactsV1: path.join(abs, 'artifacts', 'v1'),
    artifactsV2: path.join(abs, 'artifacts', 'v2'),
    buildInfo: path.join(abs, 'build-info.json'),
    datasets: path.join(abs, 'datasets'),
    runs: path.join(abs, 'runs'),
    logs: path.join(abs, 'logs'),
    emptyClaudeConfig: path.join(abs, 'empty-claude-config'),
  };
}

// ---------------------------------------------------------------------------------------------
// Process hygiene

/**
 * Removed from every child environment. `~/.zshrc` exports TENDRIL_HOME=~/.tendril, and the rest
 * change ports, auth, TLS, logging or GC mode in ways that would make the two apps incomparable
 * (or point them at the user's real data).
 */
export const SCRUBBED_ENV_VARS: readonly string[] = [
  'TENDRIL_HOME',
  'TENDRIL_CONFIG',
  'TENDRIL_PLANS',
  'PORT',
  'HOST',
  'VERBOSE',
  'BASE_PATH',
  'IVY_TLS',
  'TENDRIL_NOT_MASTER',
  'TENDRIL_BETA',
  'TENDRIL_AUTH_PASSWORD',
  'BasicAuth__Users',
  'RUST_LOG',
  'DOTNET_gcServer',
  'DOTNET_GCHeapHardLimit',
  'DOTNET_TieredPGO',
];

/** Ports other tools on this machine own (AirPlay, dev servers, Storybook). Never hand these out. */
export const FORBIDDEN_PORTS: readonly number[] = [5000, 5010, 5173, 6041, 7000];

// ---------------------------------------------------------------------------------------------
// Datasets

export const DATASET_NAMES = ['empty', 'small', 'medium', 'large'] as const;
export type DatasetName = (typeof DATASET_NAMES)[number];

export const PLAN_STATES = ['Draft', 'Review', 'Completed', 'Failed', 'Skipped', 'Icebox'] as const;
export type PlanState = (typeof PLAN_STATES)[number];

/** Percent of plans per state; sums to 100. */
export const STATE_MIX: Readonly<Record<PlanState, number>> = {
  Draft: 30,
  Review: 15,
  Completed: 35,
  Failed: 5,
  Skipped: 5,
  Icebox: 10,
};

export interface DatasetSpec {
  name: DatasetName;
  plans: number;
  jobs: number;
  projects: number;
  revisionsPerPlan: number;
  /** Approximate bytes per revision markdown file. */
  revisionBytes: number;
  seed: number;
  stateMix: Readonly<Record<PlanState, number>>;
}

function dataset(name: DatasetName, plans: number, jobs: number, projects: number): DatasetSpec {
  return { name, plans, jobs, projects, revisionsPerPlan: 2, revisionBytes: 8 * 1024, seed: 42, stateMix: STATE_MIX };
}

export const DATASETS: Readonly<Record<DatasetName, DatasetSpec>> = {
  empty: dataset('empty', 0, 0, 1),
  small: dataset('small', 50, 50, 3),
  medium: dataset('medium', 300, 200, 5),
  large: dataset('large', 1500, 500, 8),
};

export function isDatasetName(s: string): s is DatasetName {
  return (DATASET_NAMES as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------------------------
// Profiles

export const PROFILE_NAMES = ['quick', 'full'] as const;
export type ProfileName = (typeof PROFILE_NAMES)[number];

export interface ProfileKnobs {
  name: ProfileName;
  /** Datasets for the server-side suites (startup, idle, api, ui, network). */
  serverDatasets: DatasetName[];
  desktopDatasets: DatasetName[];
  cliDatasets: DatasetName[];
  startup: { firstStartRuns: number; warmRuns: number };
  idle: {
    runs: number;
    /**
     * Seconds after ready before the measured window opens. Both apps run one-off work after start
     * (V1: pricing fetch at +15 s, cost backfill at +60 s; V2: PR sync at +30 s, model enrichment),
     * so an earlier window measures the tail of startup, not idle. That phase is reported separately.
     */
    settleSec: number;
    /** Length of the measured window after `settleSec`. */
    durationSec: number;
  };
  api: {
    /**
     * Independent server instances per app and dataset (fresh home, fresh process), run in ABBA
     * order. The instance, not the request, is the replicate: requests on one server share its JIT
     * state, caches and background timers, so pooling them alone would overstate the precision.
     */
    instances: number;
    /** Sequential warmup requests per scenario and instance (beyond .NET's 30-call tier-up threshold). */
    seqWarmup: number;
    /** Timed sequential requests per scenario and instance. */
    seqSamples: number;
    concurrency: number[];
    /** Length of one timed load window; every instance runs each level once. */
    concurrencyDurationSec: number;
    /** Latency samples per concurrency run are systematically subsampled to at most this many. */
    maxLatencySamples: number;
  };
  ui: {
    /** Independent server + browser sessions per app and dataset, in ABBA order (see api.instances). */
    instances: number;
    /** The counts below are per app and dataset, split as evenly as possible across the instances. */
    coldLoads: number;
    navCycles: number;
    pushSamples: number;
    fsPushSamples: number;
    navUnderLoadCycles: number;
  };
  desktop: { warmupRuns: number; runs: number; durationSec: number };
  cli: { warmup: number; runs: number };
  network: {
    /** Page loads in a fresh browser context, each followed by one first-visit pass over the views. */
    coldLoads: number;
    /** REST state toggles on a warm page, each counted until the traffic it caused has settled. */
    pushSamples: number;
    /** Consecutive idle windows on a warm page (one bytes-per-minute sample each). */
    idleWindows: number;
    idleWindowSec: number;
    /** Scripted sessions: load, visit every view, `sessionPushes` pushes, counted as one total. */
    sessions: number;
    sessionPushes: number;
    /** Seconds of nettop sampling of each real desktop app for external traffic; 0 skips it. */
    desktopIdleSec: number;
    /**
     * Seconds the real V2 Tendril.app is watched through a proxy in front of its daemon, to check
     * the IPC shim's host <-> daemon traffic against the real host's; 0 skips the check.
     */
    realHostSec: number;
  };
}

export const PROFILES: Readonly<Record<ProfileName, ProfileKnobs>> = {
  quick: {
    name: 'quick',
    serverDatasets: ['empty', 'small'],
    desktopDatasets: ['small'],
    cliDatasets: ['small'],
    startup: { firstStartRuns: 2, warmRuns: 3 },
    idle: { runs: 1, settleSec: 20, durationSec: 20 },
    api: { instances: 1, seqWarmup: 100, seqSamples: 50, concurrency: [1, 8], concurrencyDurationSec: 3, maxLatencySamples: 5000 },
    ui: { instances: 1, coldLoads: 2, navCycles: 2, pushSamples: 4, fsPushSamples: 2, navUnderLoadCycles: 2 },
    desktop: { warmupRuns: 1, runs: 1, durationSec: 30 },
    cli: { warmup: 1, runs: 5 },
    network: { coldLoads: 3, pushSamples: 4, idleWindows: 2, idleWindowSec: 30, sessions: 2, sessionPushes: 2, desktopIdleSec: 45, realHostSec: 30 },
  },
  full: {
    name: 'full',
    serverDatasets: ['empty', 'small', 'medium', 'large'],
    desktopDatasets: ['empty', 'medium', 'large'],
    cliDatasets: ['small', 'large'],
    startup: { firstStartRuns: 5, warmRuns: 10 },
    // 5 runs so Mann-Whitney U can reach p < 0.01 (the smallest two-sided p with 5 vs 5 is 0.008).
    // The window opens 120 s after ready, past both apps' one-off startup work, and 45 s spans at
    // least one of both apps' 30 s rescans.
    idle: { runs: 5, settleSec: 120, durationSec: 45 },
    // 3 instances x 100 timed requests = 300 per scenario; each instance runs every load level once,
    // so every level has 3 independent repeats.
    api: { instances: 3, seqWarmup: 100, seqSamples: 100, concurrency: [1, 8, 32], concurrencyDurationSec: 5, maxLatencySamples: 5000 },
    // Pushes are capped where V1 is slow: its file pushes wait for a 30 s rescan, and on large its
    // REST pushes often do too.
    ui: { instances: 3, coldLoads: 9, navCycles: 6, pushSamples: 10, fsPushSamples: 5, navUnderLoadCycles: 6 },
    // 5 runs, not the spec's 3: Mann-Whitney U cannot reach p < 0.01 with 3 vs 3 (the smallest
    // two-sided exact p is 0.10).
    desktop: { warmupRuns: 1, runs: 5, durationSec: 60 },
    cli: { warmup: 3, runs: 20 },
    // Bytes are near-deterministic, so 5 loads are plenty for a median; idle windows are 60 s so
    // each spans V1's 30 s plan rescan and several of V2's 5 s job polls. The desktop window runs
    // past V1's +15 s model-pricing fetch.
    network: { coldLoads: 5, pushSamples: 10, idleWindows: 3, idleWindowSec: 60, sessions: 3, sessionPushes: 4, desktopIdleSec: 90, realHostSec: 45 },
  },
};

/** `total` items split over `parts` instances as evenly as possible (earlier instances get the extra). */
export function shareOf(total: number, parts: number, index: number): number {
  const p = Math.max(1, parts);
  return Math.floor(total / p) + (index < total % p ? 1 : 0);
}

export function isProfileName(s: string): s is ProfileName {
  return (PROFILE_NAMES as readonly string[]).includes(s);
}

/**
 * Generous on purpose: V1 at `large` is slow, and a timeout is recorded as a result rather than
 * retried, so a tight limit would turn "slow" into "missing".
 */
export const TIMEOUTS = {
  startupMs: 300_000,
  uiWaitMs: 120_000,
  httpRequestMs: 60_000,
  stopGraceMs: 5_000,
  desktopLaunchMs: 180_000,
  cliRunMs: 300_000,
} as const;

/** How often readiness endpoints are polled while timing startup. */
export const READY_POLL_MS = 5;
/** loadavg sampling cadence recorded into every SuiteResult. */
export const LOAD_SAMPLE_MS = 5_000;

// ---------------------------------------------------------------------------------------------
// Commands

/**
 * What bin/tendril-bench.ts hands a delegated command module (build/setup.ts, datasets/index.ts,
 * report/generate.ts). The module exports `main(ctx: CommandContext): Promise<number | void>` (the
 * CLI also accepts `setup`/`datasets`/`report`/`generate`/`run`/`default`); a number is the exit code.
 */
export interface CommandContext {
  command: string;
  ws: string;
  paths: WorkspacePaths;
  /** Arguments after the command name, unparsed (modules may parse flags of their own). */
  argv: string[];
  /** The CLI's parsed flags; unknown `--x y` flags are kept as strings or booleans. */
  flags: Record<string, string | boolean | undefined>;
  profile: ProfileName;
  /** Full V2 sha under test (--v2-ref or V2_REF_DEFAULT). */
  v2Ref: string;
  log: Logger;
}
