// The contract between suites and the two apps. Suites only ever talk to an AppAdapter, so every
// V1/V2 difference (binaries, readiness, auth, selectors, request shapes) lives in apps/v1.ts and
// apps/v2.ts and nowhere else.

import type { WorkspacePaths } from '../lib/config.ts';
import type { Logger } from '../lib/log.ts';
import type { ProcStat } from '../lib/procstat.ts';
import type { AppId } from '../lib/results.ts';

export type { AppId } from '../lib/results.ts';

// ---------------------------------------------------------------------------------------------
// Handles

export interface ServerHandle {
  app: AppId;
  pid: number;
  port: number;
  baseUrl: string;
  home: string;
  /** spawnAt is performance.now() just before spawn; the two durations are relative to it. */
  timings: { spawnAt: number; httpReadyMs: number; dataReadyMs: number };
  /** V1 {} ; V2 {Authorization: 'Bearer <secret from .master>'} (re-read after every start). */
  authHeaders(): Record<string, string>;
  /** Server process + descendants. */
  pids(): Promise<number[]>;
  stop(): Promise<void>;
  /** Paths of the captured stdout/stderr logs. */
  logs: { stdout: string; stderr: string };
  /**
   * Adapter facts worth recording with a result: which binary served, startup phase markers seen in
   * the logs, `.master` checks. Optional and informational; suites may copy it into Metric.meta.
   */
  meta?: Record<string, unknown>;
}

/** What Chromium opens. */
export interface UiHandle {
  url: string;
  /** V2: [{role:'v2-shim', pid}]; V1: []. */
  extraProcesses(): Promise<Array<{ role: string; pid: number }>>;
  /** V2: contents of v2-shim/init.js, added with context.addInitScript. */
  initScript?: string;
  stop(): Promise<void>;
  /** Optional adapter facts (shim binary, dist dir, ...). */
  meta?: Record<string, unknown>;
}

export interface DesktopHandle {
  appPid: number;
  /** app, webkit-webcontent, webkit-gpu, webkit-networking, (V2) daemon ... */
  roots(): Promise<Array<{ role: string; pid: number }>>;
  /** performance.now() when the launch command was issued. */
  launchedAt: number;
  /**
   * performance.now() when the app's backend was started: the same as launchedAt for V1 (its server
   * runs inside the app process), the daemon's spawn for V2 (the adapter starts it and waits for its
   * health before the launch command). A cold launch of V2 is timed from here.
   */
  backendSpawnedAt: number;
  stop(): Promise<void>;
  /** Optional adapter facts (which .app, pid discovery, quit details once stopped, ...). */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// API scenarios

/**
 * Identical requests on both apps unless noted (framework floor: V1 GET /api/ping, V2 GET
 * /api/health). Response bytes are recorded because V2's list returns full PlanFile objects while
 * V1's returns a thin summary.
 */
export type ApiScenario = 'health' | 'plans.list' | 'plans.filter' | 'plans.get' | 'projects.list' | 'jobs.get' | 'plans.update';

export const API_SCENARIOS: readonly ApiScenario[] = ['health', 'plans.list', 'plans.filter', 'plans.get', 'projects.list', 'jobs.get', 'plans.update'];

export interface ApiRequestContext {
  /** 5-digit plan id as used in URLs (`00037`). */
  planId: string;
  jobId: string;
  /**
   * Iteration index. `plans.update` alternates on it: even -> Icebox, odd -> Draft, so a run of
   * writes leaves the plan where it started. Optional only for backwards compatibility with the
   * spec's `{planId, jobId}` shape; suites always pass it.
   */
  i?: number;
}

export interface ApiRequest {
  method: string;
  /** Path plus query, relative to ServerHandle.baseUrl (`/api/plans?limit=50`). */
  path: string;
  body?: unknown;
}

// ---------------------------------------------------------------------------------------------
// UI selectors

/** Nav targets of the shared Tendril shell (`button.tsh-nav-item[data-menu-item=...]`). */
export type NavTarget = 'plans' | 'jobs' | 'dashboard' | 'review' | 'recommendations';

export interface ReadyProbe {
  selector: string;
  /**
   * Playwright wait state. `attached` exists for V1's jobs grid, whose accessibility cells are in the
   * DOM but invisible (waiting for `visible` times out).
   */
  state: 'visible' | 'attached';
  /** Whether this probe means real content or the view's empty state (recorded as meta). */
  kind: 'content' | 'empty';
}

/**
 * A view counts as ready when ANY probe in `anyOf` matches, EVERY probe in `allOf` matches, and none
 * of `noneOf` (loading skeletons) is present. Selectors are Playwright selectors, so `:has()` and
 * `>>` work too.
 */
export interface ReadyCondition {
  anyOf: ReadyProbe[];
  allOf?: ReadyProbe[];
  noneOf?: string[];
}

export interface UiSelectors {
  /** App shell root (`.tsh-root`). */
  shell: string;
  /** `button.tsh-nav-item[data-menu-item="<target>"]`. */
  navButton(target: NavTarget): string;
  /** `.tsh-nav-badge` inside the nav button (push probes watch the plans badge). */
  navBadge(target: NavTarget): string;
  /**
   * Ready condition per view. `plans` is the initial landing view after `goto('/')`: the plan
   * workspace title, or the empty state when the dataset has no plans.
   */
  ready: Record<NavTarget, ReadyCondition>;
}

// ---------------------------------------------------------------------------------------------
// Adapter

export interface AppAdapter {
  id: AppId;
  /** 'Tendril V1 (v1.2.4)' / 'Tendril V2 (<short sha>)'. */
  label: string;
  /** Run the app's own DB migrate on a template home. */
  migrate(home: string): Promise<void>;
  startServer(opts: { home: string; runDir: string; mode: 'web' }): Promise<ServerHandle>;
  startUi(server: ServerHandle, runDir: string): Promise<UiHandle>;
  /**
   * `appHome` (V2 only) gives the app process a different TENDRIL_HOME from its daemon's, prepared
   * once the daemon is healthy: the network suite uses it to put a byte-counting proxy between the
   * real Tauri host and the daemon (a shadow home whose .master names the proxy). V1 ignores it.
   */
  launchDesktop(opts: { home: string; runDir: string; appHome?: (daemon: ServerHandle) => Promise<string> }): Promise<DesktopHandle>;
  cli: { bin: string; env(home: string): Record<string, string> };
  api: Record<ApiScenario, (ctx: ApiRequestContext) => ApiRequest>;
  ui: UiSelectors;
  /** Optional adapter facts: resolved binaries/apps and why each was chosen. */
  meta?: Record<string, unknown>;
}

/**
 * What the harness hands apps/index.ts when it builds adapters. apps/index.ts is expected to export
 * `createAdapters(ids: AppId[], opts: AdapterOptions): Promise<AppAdapter[]>` (bin/tendril-bench.ts
 * also accepts `loadAdapters`/`getAdapters` with the same signature).
 */
export interface AdapterOptions {
  ws: string;
  paths: WorkspacePaths;
  /** Full V2 sha under test. */
  v2Ref: string;
  procstat: ProcStat;
  log: Logger;
}
