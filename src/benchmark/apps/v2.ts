// Tendril V2 (Rust): the `tendril serve` daemon owns the data and the REST/WS API; the desktop app
// (Tauri, `tendril-app`) is a separate process that talks to it. The daemon does not serve the
// frontend, so the Chromium runs go through the IPC shim (builds/v2-shim), which serves the built
// dist and answers the page's Tauri `invoke()`s with the app's real cmd_* functions.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BENCH_ROOT, TIMEOUTS, type WorkspacePaths } from '../lib/config.ts';
import type { Logger } from '../lib/log.ts';
import { appEnv, descendants, freePort, isAlive, registerCleanup, spawnLogged, waitForHttp, waitForHttpDetailed } from '../lib/proc.ts';
import {
  apiScenarios,
  assertDesktopHome,
  bundleVersion,
  emptyCwd,
  hasConnectionTo,
  launchApp,
  navBadge,
  navButton,
  nextTag,
  pickString,
  processEnvContains,
  quitApp,
  readBuildInfo,
  readMaster,
  runOnce,
  tail,
  webkitProcesses,
} from './common.ts';
import type { AdapterOptions, AppAdapter, DesktopHandle, ServerHandle, UiHandle, UiSelectors } from './types.ts';

/** The browser init script emulating `window.__TAURI_INTERNALS__` (owned by the build part). */
export const SHIM_INIT_SCRIPT = path.join(BENCH_ROOT, 'v2-shim', 'init.js');
/** Written by a release Tendril.app that provisions its launchd service; must never appear. */
const LAUNCH_AGENT = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.spacecorps.tendril.service.plist');

// ---------------------------------------------------------------------------------------------
// Resolution

export interface V2Resolution {
  bin: string;
  binSource: string;
  dist: string;
  shimBin: string;
  shimInit: string;
  app: string | null;
  appSource: string;
  cloneSha: string | null;
  notes: string[];
}

export function resolveV2(paths: WorkspacePaths, log: Logger): V2Resolution {
  const notes: string[] = [];
  const bi = readBuildInfo(paths);
  const pick = (keys: string[], envVar: string, fallback: string, what: string): [string, string] => {
    const fromEnv = process.env[envVar];
    if (fromEnv) return [fromEnv, `env ${envVar}`];
    const p = pickString(bi, keys);
    if (p && fs.existsSync(p.value)) return [p.value, `build-info.json ${p.key}`];
    if (p) notes.push(`build-info.json ${p.key} = ${p.value} (${what}) does not exist; using ${fallback}`);
    return [fallback, 'default workspace path'];
  };
  const [bin, binSource] = pick(['v2.bin', 'artifacts.v2Bin'], 'TENDRIL_BENCH_V2_BIN', paths.v2Bin, 'daemon binary');
  const [dist] = pick(['v2.dist', 'artifacts.v2Dist'], 'TENDRIL_BENCH_V2_DIST', paths.v2Dist, 'frontend dist');
  const [shimBin] = pick(['v2.shimBin', 'artifacts.v2ShimBin', 'v2.shim.bin'], 'TENDRIL_BENCH_V2_SHIM', paths.v2ShimBin, 'IPC shim');
  const [shimInit] = pick(['v2.shimInit', 'artifacts.v2ShimInit', 'v2.shim.initScript'], 'TENDRIL_BENCH_V2_SHIM_INIT', SHIM_INIT_SCRIPT, 'shim init script');
  // `setup` copies the bundle to artifacts/v2 (its canonical place); the target dir is the fallback.
  const artifactApp = path.join(paths.artifactsV2, 'Tendril.app');
  const targetApp = path.join(paths.v2Clone, 'target', 'release', 'bundle', 'macos', 'Tendril.app');
  const defaultApp = fs.existsSync(path.join(artifactApp, 'Contents', 'MacOS', 'tendril-app')) ? artifactApp : targetApp;
  const [appPath, appSource] = pick(['v2.appPath', 'artifacts.v2App'], 'TENDRIL_BENCH_V2_APP', defaultApp, 'desktop app');
  const app = fs.existsSync(path.join(appPath, 'Contents', 'MacOS', 'tendril-app')) ? appPath : null;
  let cloneSha: string | null = null;
  try {
    cloneSha = execFileSync('git', ['-C', paths.v2Clone, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    cloneSha = null;
  }
  for (const n of notes) log.warn(`v2: ${n}`);
  return { bin, binSource, dist, shimBin, shimInit, app, appSource: app ? appSource : 'none', cloneSha, notes };
}

// ---------------------------------------------------------------------------------------------
// UI markers

/**
 * V2 view markers (data-testid). Caveat for suites: `plans-empty` and `review-empty` render while
 * the plan list is still `[]`, before `cmd_list_plans` returns, so on a dataset that has plans only a
 * `content` probe means ready (use the dataset manifest to know which kind to expect).
 */
export const V2_UI: UiSelectors = {
  shell: '.tsh-root',
  navButton,
  navBadge,
  ready: {
    // PlansView auto-opens the highest-id Draft by navigating to /plan-<id> (same rule as V1).
    plans: {
      anyOf: [
        { selector: '[data-testid="plan-detail-view"] .pws-root .pws-title', state: 'visible', kind: 'content' },
        { selector: '[data-testid="plans-empty"]', state: 'visible', kind: 'empty' },
      ],
    },
    jobs: {
      anyOf: [
        { selector: '[data-testid="jobs-table"] tr[data-row-id]', state: 'visible', kind: 'content' },
        { selector: '[data-testid="jobs-empty"]', state: 'visible', kind: 'empty' },
      ],
      noneOf: ['[data-testid="jobs-table"] [aria-busy="true"]'],
    },
    dashboard: {
      anyOf: [{ selector: '.tdb-kpis', state: 'visible', kind: 'content' }],
      noneOf: ['[data-testid="tdb-kpis-skeleton"]'],
    },
    review: {
      anyOf: [
        { selector: '[data-testid="review-view"] [data-testid^="review-tab-"]', state: 'visible', kind: 'content' },
        { selector: '[data-testid="review-empty"]', state: 'visible', kind: 'empty' },
      ],
    },
    recommendations: {
      anyOf: [
        { selector: '[data-testid="recommendations-view"] [data-testid="recommendation-title"]', state: 'visible', kind: 'content' },
        { selector: '[data-testid="recommendations-empty"]', state: 'visible', kind: 'empty' },
      ],
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Adapter

const STDERR_MARKERS: Array<[string, RegExp]> = [
  ['watcherRegistered', /Filesystem watcher registered (\d+)/],
  ['plansSynced', /Synced (\d+) plan folder/],
  ['recommendationsRebuilt', /Rebuilt recommendations projection: (\d+) row\(s\) from (\d+) plan/],
];

export async function createV2Adapter(opts: AdapterOptions): Promise<AppAdapter> {
  const { paths, procstat } = opts;
  const log = opts.log.child('v2');
  const res = resolveV2(paths, log);
  const bin = res.bin;
  if (!fs.existsSync(bin)) throw new Error(`V2 binary missing: ${bin} (run \`setup\`)`);
  if (res.cloneSha && !res.cloneSha.startsWith(opts.v2Ref) && !opts.v2Ref.startsWith(res.cloneSha)) {
    log.warn(`V2 clone is at ${res.cloneSha}, not the pinned ${opts.v2Ref}`);
  }
  const shortSha = (res.cloneSha ?? opts.v2Ref).slice(0, 8);
  log.info(`daemon ${bin} (${res.binSource}); dist ${res.dist}; shim ${fs.existsSync(res.shimBin) ? res.shimBin : `${res.shimBin} (missing)`}; app ${res.app ?? 'none'}`);

  const env = (home: string) => appEnv(home, paths);

  async function startServer(o: { home: string; runDir: string; mode: 'web' }): Promise<ServerHandle> {
    const port = await freePort();
    const tag = nextTag();
    const baseUrl = `http://127.0.0.1:${port}`;
    const sp = spawnLogged({
      cmd: bin,
      // --home before the subcommand (it is a global flag); CWD empty so stub promptwares are
      // deployed exactly as under a launchd install (see emptyCwd).
      args: ['--home', path.resolve(o.home), 'serve', '--host', '127.0.0.1', '--port', String(port)],
      cwd: emptyCwd(o.runDir),
      env: env(o.home),
      logDir: path.join(o.runDir, 'logs'),
      logPrefix: `v2-server-${path.basename(o.home)}-${tag}`,
      log,
    });
    const bail = () => (sp.exitInfo ? `V2 daemon exited (code ${sp.exitInfo.code}, signal ${sp.exitInfo.signal}); see ${sp.stderrPath}` : null);
    try {
      // /api/health only answers once reconcile (sync + recommendations rebuild) has finished; the
      // `>>>` stdout line and .master's port appear earlier, while requests would still hang.
      const health = await waitForHttpDetailed(`${baseUrl}/api/health`, { timeoutMs: TIMEOUTS.startupMs, bail });
      const readyMs = health.t - sp.spawnAt;
      const master = readMaster(o.home);
      const secret = typeof master?.secret === 'string' ? master.secret : null;
      if (!secret) throw new Error(`V2 .master in ${o.home} has no secret (${master ? 'keys: ' + Object.keys(master).join(',') : 'missing'})`);
      if (Number(master!.pid) !== sp.pid || Number(master!.port) !== port) {
        throw new Error(`V2 .master names pid ${String(master!.pid)} port ${String(master!.port)}, expected ${sp.pid} / ${port}`);
      }
      let healthBody: unknown = null;
      try {
        healthBody = JSON.parse(health.body);
      } catch {
        healthBody = health.body.slice(0, 200);
      }
      const phases: Record<string, unknown> = {};
      const bound = sp.lines().find((l) => l.line.includes('>>> Tendril Server running on'));
      if (bound) phases.boundMs = Math.round(bound.t - sp.spawnAt);
      for (const [key, re] of STDERR_MARKERS) {
        const hit = sp.lines().find((l) => re.test(l.line));
        if (!hit) continue;
        const m = hit.line.match(re)!;
        phases[key] = { ms: Math.round(hit.t - sp.spawnAt), values: m.slice(1).map(Number) };
      }
      const meta: Record<string, unknown> = {
        bin,
        binSource: res.binSource,
        cloneSha: res.cloneSha,
        health: healthBody,
        healthAttempts: health.attempts,
        master: { pid: master!.pid, port: master!.port, scheme: master!.scheme, version: master!.version, schemaVersion: master!.schemaVersion },
        phases,
        promptwares: 'stub (empty CWD, TENDRIL_PROMPTWARES unset: what a launchd install deploys)',
      };
      const auth = { Authorization: `Bearer ${secret}` };
      let stopped = false;
      return {
        app: 'v2',
        pid: sp.pid,
        port,
        baseUrl,
        home: o.home,
        // One signal covers both: the daemon serves nothing until its data is synced.
        timings: { spawnAt: sp.spawnAt, httpReadyMs: readyMs, dataReadyMs: readyMs },
        authHeaders: () => ({ ...auth }),
        pids: async () => [sp.pid, ...(await descendants(sp.pid, procstat))].filter(isAlive),
        stop: async () => {
          if (stopped) return;
          stopped = true;
          const r = await sp.stop({ procstat });
          meta.stop = { forced: r.forced, ms: Math.round(r.ms), survivors: r.survivors };
          // MasterGuard::drop removes the claim on a clean exit.
          if (fs.existsSync(path.join(o.home, '.master'))) {
            meta.masterLeftBehind = true;
            log.warn(`V2 left ${path.join(o.home, '.master')} behind after stopping (forced: ${r.forced})`);
          }
        },
        logs: { stdout: sp.stdoutPath, stderr: sp.stderrPath },
        meta,
      };
    } catch (e) {
      await sp.stop({ procstat });
      throw e;
    }
  }

  async function startUi(server: ServerHandle, runDir: string): Promise<UiHandle> {
    if (server.app !== 'v2') throw new Error(`V2 startUi got a ${server.app} server`);
    if (!fs.existsSync(res.shimBin)) throw new Error(`V2 IPC shim missing: ${res.shimBin} (run \`setup\`)`);
    if (!fs.existsSync(path.join(res.dist, 'index.html'))) throw new Error(`V2 dist missing: ${res.dist}/index.html (run \`setup\`)`);
    if (!fs.existsSync(res.shimInit)) throw new Error(`V2 shim init script missing: ${res.shimInit}`);
    const initScript = fs.readFileSync(res.shimInit, 'utf8');
    if (!isAlive(server.pid)) throw new Error(`V2 daemon ${server.pid} is not running`);
    // The shim's bridges read .master once at startup (so it must follow the daemon, and be restarted
    // with it), and the host's UI state store reads this file.
    fs.rmSync(path.join(server.home, 'ui_state.json'), { force: true });
    const port = await freePort();
    const sp = spawnLogged({
      cmd: res.shimBin,
      args: [res.dist, String(port), '--home', path.resolve(server.home), '--host', '127.0.0.1'],
      cwd: emptyCwd(runDir),
      env: env(server.home),
      logDir: path.join(runDir, 'logs'),
      logPrefix: `v2-shim-${path.basename(server.home)}-${nextTag()}`,
      log,
    });
    const url = `http://127.0.0.1:${port}/`;
    try {
      const bail = () => (sp.exitInfo ? `V2 shim exited (code ${sp.exitInfo.code}, signal ${sp.exitInfo.signal}): ${tail(sp.lines().map((l) => l.line).join('\n'), 3)}` : null);
      const t = await waitForHttp(url, { timeoutMs: 60_000, bail });
      // The shim logs one JSON line describing what it wired up (before it binds, so it is already
      // here or never coming); it must be bridged to *this* daemon.
      const infoLine = await sp.onLine(/^v2shim: \{/, { stream: 'stderr', timeoutMs: 1000 }).catch(() => null);
      let info: Record<string, unknown> | null = null;
      try {
        info = infoLine ? (JSON.parse(infoLine.line.slice('v2shim: '.length)) as Record<string, unknown>) : null;
      } catch {
        info = null;
      }
      const bridged = (info?.master as Record<string, unknown> | null | undefined)?.pid;
      if (info && Number(bridged) !== server.pid) throw new Error(`V2 shim bridged to daemon pid ${String(bridged)}, expected ${server.pid}`);
      let stopped = false;
      const meta: Record<string, unknown> = {
        shimBin: res.shimBin,
        dist: res.dist,
        initScript: res.shimInit,
        readyMs: Math.round(t - sp.spawnAt),
        daemonPid: server.pid,
        bridges: info?.bridges ?? null,
        registeredCommands: info?.registered ?? null,
        stubbedCommands: info?.stubbed ?? null,
        role: 'IPC shim (stand-in for the tendril-app host; not the Tauri binary)',
      };
      return {
        url,
        initScript,
        extraProcesses: async () => (isAlive(sp.pid) ? [{ role: 'v2-shim', pid: sp.pid }] : []),
        stop: async () => {
          if (stopped) return;
          stopped = true;
          await sp.stop({ procstat });
        },
        meta,
      };
    } catch (e) {
      await sp.stop({ procstat });
      throw e;
    }
  }

  async function launchDesktop(o: { home: string; runDir: string; appHome?: (daemon: ServerHandle) => Promise<string> }): Promise<DesktopHandle> {
    if (!res.app) throw new Error(`V2 Tendril.app not built (looked in ${paths.artifactsV2} and ${path.join(paths.v2Clone, 'target/release/bundle/macos')}; run \`setup\`)`);
    const app = res.app;
    const exe = path.join(app, 'Contents', 'MacOS', 'tendril-app');
    assertDesktopHome('V2', o.home);
    const agentBefore = fs.existsSync(LAUNCH_AGENT);
    fs.rmSync(path.join(o.home, 'ui_state.json'), { force: true });
    // The app reads .master once at setup to start its WebSocket bridge and never retries, so the
    // daemon must be healthy first; the app never starts one itself (provisioning is disabled below).
    const server = await startServer({ home: o.home, runDir: o.runDir, mode: 'web' });
    let appHome = o.home;
    if (o.appHome) {
      try {
        appHome = await o.appHome(server);
        assertDesktopHome('V2', appHome);
        fs.rmSync(path.join(appHome, 'ui_state.json'), { force: true });
      } catch (e) {
        await server.stop();
        throw e;
      }
    }
    const tag = nextTag();
    const launchEnv = {
      TENDRIL_HOME: path.resolve(appHome),
      CLAUDE_CONFIG_DIR: paths.emptyClaudeConfig,
      // Without these a release build copies ~250 MB of sidecars into <home>/bin and registers a
      // launchd agent that starts a second daemon on port 5010.
      TENDRIL_SKIP_SERVICE_PROVISION: '1',
      TENDRIL_SKIP_SERVICE_AUTOSTART: '1',
    };
    let launch;
    try {
      launch = await launchApp({
        app,
        exe,
        env: launchEnv,
        logDir: path.join(o.runDir, 'logs'),
        logPrefix: `v2-desktop-${path.basename(o.home)}-${tag}`,
        procstat,
        timeoutMs: TIMEOUTS.desktopLaunchMs,
        log,
      });
    } catch (e) {
      await server.stop();
      throw e;
    }
    const appPid = launch.appPid;
    const meta: Record<string, unknown> = {
      app,
      home: o.home,
      appSource: res.appSource,
      version: await bundleVersion(app),
      daemonPid: server.pid,
      daemonPort: server.port,
      daemonReadyMs: Math.round(server.timings.httpReadyMs),
      appHome: appHome === o.home ? undefined : appHome,
      openMs: Math.round(launch.openMs),
      pidSeenMs: Math.round(launch.pidSeenAt - launch.launchedAt),
      stdout: launch.stdoutPath,
      stderr: launch.stderrPath,
    };
    const quit = () => quitApp({ appPid, procstat, signals: ['SIGTERM'], graceMs: 10_000, log });
    const unregister = registerCleanup(async () => {
      await quit();
      await server.stop();
    });
    const envOk = await processEnvContains(appPid, `TENDRIL_HOME=${launchEnv.TENDRIL_HOME}`);
    meta.envVerified = envOk;
    if (envOk === false) {
      unregister();
      await server.stop();
      throw new Error(`new tendril-app pid ${appPid} does not carry TENDRIL_HOME=${launchEnv.TENDRIL_HOME}; refusing to treat it as the benchmark instance`);
    }
    let stopped = false;
    return {
      appPid,
      launchedAt: launch.launchedAt,
      backendSpawnedAt: server.timings.spawnAt,
      roots: async () => {
        const wk = await webkitProcesses(procstat, appPid);
        return [{ role: 'app', pid: appPid }, ...wk.map((w) => ({ role: w.role, pid: w.pid })), { role: 'daemon', pid: server.pid }];
      },
      stop: async () => {
        if (stopped) return;
        stopped = true;
        // Adoption check once the measurements are over: the WS bridge holds a connection to the daemon.
        meta.adoptedDaemon = await hasConnectionTo(appPid, server.port);
        meta.quit = await quit();
        await server.stop();
        meta.daemonStop = server.meta?.stop;
        unregister();
        const agentAfter = fs.existsSync(LAUNCH_AGENT);
        meta.launchAgentCreated = !agentBefore && agentAfter;
        meta.provisionedBin = fs.existsSync(path.join(o.home, 'bin')) || fs.existsSync(path.join(appHome, 'bin'));
        if (meta.launchAgentCreated) log.error(`${LAUNCH_AGENT} appeared during the V2 desktop run: provisioning was not disabled`);
      },
      meta,
    };
  }

  async function migrate(home: string): Promise<void> {
    const r = await runOnce({
      cmd: bin,
      args: ['--home', path.resolve(home), 'db', 'migrate'],
      env: env(home),
      cwd: emptyCwd(path.join(paths.logs, 'migrate')),
      logDir: path.join(paths.logs, 'migrate'),
      logPrefix: `v2-migrate-${path.basename(path.dirname(home))}-${path.basename(home)}-${nextTag()}`,
      timeoutMs: TIMEOUTS.cliRunMs,
      log,
    });
    if (r.code !== 0) throw new Error(`V2 db migrate failed (exit ${r.code ?? r.signal}):\n${tail(`${r.stdout}\n${r.stderr}`)}`);
  }

  return {
    id: 'v2',
    label: `Tendril V2 (${shortSha})`,
    migrate,
    startServer,
    startUi,
    launchDesktop,
    cli: { bin, env },
    api: apiScenarios('/api/health'),
    ui: V2_UI,
    meta: {
      bin,
      binSource: res.binSource,
      binBytes: fs.statSync(bin).size,
      cloneSha: res.cloneSha,
      dist: res.dist,
      shimBin: res.shimBin,
      shimInit: res.shimInit,
      shimPresent: fs.existsSync(res.shimBin),
      app: res.app,
      appSource: res.appSource,
      notes: res.notes,
    },
  };
}
