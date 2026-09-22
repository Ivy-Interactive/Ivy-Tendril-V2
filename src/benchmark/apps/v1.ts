// Tendril V1 (v1.2.4, C#/.NET + Ivy): one self-contained `Ivy.Tendril` process serves the REST API,
// the SignalR UI and (with --desktop) a WKWebView window. Everything V1-specific the suites need is
// here: which binary, how to start and stop it, what "ready" means, and its UI markers.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TIMEOUTS, V1_REF, type WorkspacePaths } from '../lib/config.ts';
import { v1BinaryInfo, type V1BinaryInfo } from '../lib/env.ts';
import type { Logger } from '../lib/log.ts';
import { appEnv, descendants, freePort, isAlive, registerCleanup, spawnLogged, waitFor, waitForHttp } from '../lib/proc.ts';
import {
  apiScenarios,
  assertDesktopHome,
  bundleVersion,
  emptyCwd,
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

/** The signed release the user has installed; `~/.local/bin/tendril` already points into it. */
export const RELEASE_APP = '/Applications/Ivy Tendril.app';
const RELEASE_VERSION = V1_REF.replace(/^v/, '');

// ---------------------------------------------------------------------------------------------
// Binary resolution

/**
 * What V1 would do to the user's `tendril` CLI symlink if started from `bin`. Every V1 start from an
 * `.app/Contents/MacOS/` path runs PathHelper.EnsureCliSymlink, which (re)points
 * /usr/local/bin/tendril or ~/.local/bin/tendril at itself. Starting a second copy of the app (say
 * the expanded release pkg under artifacts/) would silently repoint the user's CLI, so such a binary
 * is only used when the symlink V1 would settle on already points at it. Null = no side effect.
 */
export function symlinkSideEffect(bin: string): string | null {
  if (!bin.includes('.app/Contents/MacOS/')) return null;
  let real: string;
  try {
    real = fs.realpathSync(bin);
  } catch {
    return `cannot resolve ${bin}`;
  }
  const writable = (d: string) => {
    try {
      fs.accessSync(d, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  };
  // Same order as EnsureCliSymlink: the first directory where it succeeds (or finds its own link) wins.
  for (const dir of ['/usr/local/bin', path.join(os.homedir(), '.local', 'bin')]) {
    const link = path.join(dir, 'tendril');
    if (fs.existsSync(link)) {
      let target: string | null = null;
      try {
        target = fs.realpathSync(link);
      } catch {
        target = null;
      }
      if (target === real) return null;
      if (writable(dir)) return `would repoint ${link} (now -> ${target ?? 'unresolvable'}) at ${bin}`;
      continue;
    }
    if (fs.existsSync(dir) ? writable(dir) : writable(path.dirname(dir))) return `would create ${link} -> ${bin}`;
  }
  return null;
}

export interface V1Resolution {
  serverBin: string;
  serverSource: string;
  serverInfo: V1BinaryInfo;
  desktopApp: string | null;
  desktopSource: string;
  desktopVersion: string | null;
  notes: string[];
}

function sameFile(a: string, b: string): boolean {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    if (sa.size !== sb.size) return false;
    // Size equality of two 166 MB single-file bundles is not proof; compare the bytes.
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

/**
 * Server binary: TENDRIL_BENCH_V1_BIN, else what `setup` recorded in build-info.json, else the
 * self-built publish. Desktop app: TENDRIL_BENCH_V1_APP, else build-info, else the installed
 * release when it is v1.2.4. Any `.app` candidate that would touch the user's CLI symlink is
 * swapped for the installed release when that is byte-identical, otherwise dropped.
 */
export async function resolveV1(paths: WorkspacePaths, log: Logger): Promise<V1Resolution> {
  const notes: string[] = [];
  const bi = readBuildInfo(paths);
  const releaseExe = path.join(RELEASE_APP, 'Contents', 'MacOS', 'Ivy.Tendril');

  let serverBin = paths.v1PublishBin;
  let serverSource = 'fallback: builds/v1-publish (self-built from the v1.2.4 tag)';
  const fromBi = pickString(bi, ['v1.serverBin', 'artifacts.v1ServerBin', 'v1.selection.server.bin']);
  if (process.env.TENDRIL_BENCH_V1_BIN) {
    serverBin = process.env.TENDRIL_BENCH_V1_BIN;
    serverSource = 'env TENDRIL_BENCH_V1_BIN';
  } else if (fromBi && fs.existsSync(fromBi.value)) {
    serverBin = fromBi.value;
    serverSource = `build-info.json ${fromBi.key}`;
  } else if (fromBi) {
    notes.push(`build-info.json ${fromBi.key} = ${fromBi.value} does not exist; using ${serverBin}`);
  }
  const effect = symlinkSideEffect(serverBin);
  if (effect) {
    if (serverBin !== releaseExe && fs.existsSync(releaseExe) && !symlinkSideEffect(releaseExe) && sameFile(serverBin, releaseExe)) {
      notes.push(`${serverBin} ${effect}; using the byte-identical installed release ${releaseExe} instead`);
      serverBin = releaseExe;
      serverSource += ' (same bytes, run from the installed release to leave the user CLI symlink alone)';
    } else {
      notes.push(`${serverBin} ${effect}; using ${paths.v1PublishBin} instead`);
      serverBin = paths.v1PublishBin;
      serverSource = 'fallback: builds/v1-publish (the recorded binary would modify the user CLI symlink)';
    }
  }
  const serverInfo = await v1BinaryInfo(serverBin);

  let desktopApp: string | null = null;
  let desktopSource = 'none';
  const appBi = pickString(bi, ['v1.desktopApp', 'artifacts.v1DesktopApp', 'v1.selection.desktop.app']);
  const candidates: Array<{ app: string; source: string }> = [];
  if (process.env.TENDRIL_BENCH_V1_APP) candidates.push({ app: process.env.TENDRIL_BENCH_V1_APP, source: 'env TENDRIL_BENCH_V1_APP' });
  if (appBi) candidates.push({ app: appBi.value, source: `build-info.json ${appBi.key}` });
  candidates.push({ app: RELEASE_APP, source: 'installed release' });
  let desktopVersion: string | null = null;
  for (const c of candidates) {
    const exe = path.join(c.app, 'Contents', 'MacOS', 'Ivy.Tendril');
    if (!fs.existsSync(exe)) {
      if (c.source !== 'installed release') notes.push(`${c.source}: ${exe} missing`);
      continue;
    }
    const v = await bundleVersion(c.app);
    if (v !== RELEASE_VERSION) {
      notes.push(`${c.source}: ${c.app} is version ${v ?? 'unknown'}, not ${RELEASE_VERSION}`);
      continue;
    }
    const fx = symlinkSideEffect(exe);
    if (fx) {
      notes.push(`${c.source}: ${c.app} ${fx}; skipped`);
      continue;
    }
    desktopApp = c.app;
    desktopSource = c.source;
    desktopVersion = v;
    break;
  }
  for (const n of notes) log.warn(`v1: ${n}`);
  return { serverBin, serverSource, serverInfo, desktopApp, desktopSource, desktopVersion, notes };
}

// ---------------------------------------------------------------------------------------------
// UI markers

/** The active content pane: V1 keeps session tabs as extra panes. */
const PANE = '.tsh-frame-pane[data-active="true"]';

export const V1_UI: UiSelectors = {
  shell: '.tsh-root',
  navButton,
  navBadge,
  ready: {
    // The default app auto-selects the highest-id Draft and renders its workspace.
    plans: {
      anyOf: [
        { selector: `${PANE} .pws-root .pws-title`, state: 'visible', kind: 'content' },
        { selector: `${PANE} h3:has-text("No plans")`, state: 'visible', kind: 'empty' },
      ],
    },
    // Glide renders the grid on a canvas; its accessibility cells are in the DOM but invisible, so
    // they must be awaited as `attached`. The canvas alone is present before any data (and is all an
    // empty job list shows), which is why it only counts as the empty-state probe.
    jobs: {
      anyOf: [
        { selector: `${PANE} td[role="gridcell"]`, state: 'attached', kind: 'content' },
        { selector: `${PANE} canvas[data-testid="data-grid-canvas"]`, state: 'visible', kind: 'empty' },
      ],
    },
    dashboard: {
      anyOf: [{ selector: `${PANE} .tdb-kpis`, state: 'visible', kind: 'content' }],
      noneOf: [`${PANE} :text("Loading Dashboard Data")`],
    },
    review: {
      anyOf: [
        { selector: `${PANE} .pws-root .pws-title`, state: 'visible', kind: 'content' },
        { selector: `${PANE} :text("No plans to review")`, state: 'visible', kind: 'empty' },
      ],
    },
    // The generated datasets carry no recommendations, so only the empty state is ever expected.
    recommendations: {
      anyOf: [
        { selector: `${PANE} .tsh-section-item`, state: 'visible', kind: 'content' },
        { selector: `${PANE} :text("No recommendations")`, state: 'visible', kind: 'empty' },
      ],
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Adapter

export async function createV1Adapter(opts: AdapterOptions): Promise<AppAdapter> {
  const { paths, procstat } = opts;
  const log = opts.log.child('v1');
  const res = await resolveV1(paths, log);
  const bin = res.serverBin;
  if (!res.serverInfo.exists) throw new Error(`V1 binary missing: ${bin} (run \`setup\`)`);
  if (res.serverInfo.version && res.serverInfo.version !== RELEASE_VERSION) {
    throw new Error(`V1 binary ${bin} is Tendril ${res.serverInfo.version}, not ${RELEASE_VERSION}`);
  }
  const frameworks = res.serverInfo.frameworks.map((f) => `${f.name} ${f.version}`);
  log.info(`server binary ${bin} (${res.serverSource}; ${frameworks.join(', ') || 'runtime unknown'}); desktop app ${res.desktopApp ?? 'none'} (${res.desktopSource})`);

  const env = (home: string) => appEnv(home, paths, { IVY_TLS: '0' });

  async function startServer(o: { home: string; runDir: string; mode: 'web' }): Promise<ServerHandle> {
    const port = await freePort();
    const tag = nextTag();
    const baseUrl = `http://127.0.0.1:${port}`;
    const sp = spawnLogged({
      cmd: bin,
      // --port rather than PORT=: the env var also makes Kestrel bind every interface.
      args: ['--web', '--port', String(port)],
      cwd: emptyCwd(o.runDir),
      env: env(o.home),
      logDir: path.join(o.runDir, 'logs'),
      logPrefix: `v1-server-${path.basename(o.home)}-${tag}`,
      log,
    });
    const bail = () => (sp.exitInfo ? `V1 server exited (code ${sp.exitInfo.code}, signal ${sp.exitInfo.signal}); see ${sp.stdoutPath}` : null);
    // Registered before the HTTP wait so a line printed early is never missed.
    const dataLine = sp.onLine(/Initial sync complete/, { timeoutMs: TIMEOUTS.startupMs });
    dataLine.catch(() => {});
    try {
      const httpT = await waitForHttp(`${baseUrl}/api/ping`, { timeoutMs: TIMEOUTS.startupMs, bail });
      const data = await dataLine;
      const synced = data.line.match(/Synced (\d+) plans in (\d+)\s*ms/);
      // The console logger is asynchronous: this line can reach stdout after the first request is
      // already answered, so give it a moment rather than reading only what has arrived.
      const listen = await sp.onLine(/Now listening on:?\s*https?:\/\//, { timeoutMs: 3000 }).catch(() => null);
      const scheme = listen?.line.match(/(https?):\/\//)?.[1] ?? null;
      if (scheme && scheme !== 'http') throw new Error(`V1 is serving ${scheme}, expected plain http (IVY_TLS=0)`);
      // .master gets its port at ApplicationStarted; the heartbeat writer may lag the first request.
      const master = await waitFor(
        () => {
          const m = readMaster(o.home);
          return m && Number(m.port) === port ? m : null;
        },
        { timeoutMs: 5000, intervalMs: 25, description: 'V1 .master' },
      ).then(
        (r) => r.value,
        () => readMaster(o.home),
      );
      if (master && master.scheme && master.scheme !== 'http') throw new Error(`V1 .master says scheme ${String(master.scheme)}, expected http`);
      const meta: Record<string, unknown> = {
        bin,
        binSource: res.serverSource,
        runtime: frameworks,
        scheme: scheme ?? master?.scheme ?? null,
        listenLine: listen?.line ?? null,
        initialSync: synced ? { plans: Number(synced[1]), ms: Number(synced[2]) } : null,
        master: master ? { pid: master.pid, port: master.port, scheme: master.scheme } : null,
        masterMatches: master ? Number(master.pid) === sp.pid && Number(master.port) === port : false,
      };
      if (!meta.masterMatches) log.warn(`V1 .master in ${o.home} does not name pid ${sp.pid} / port ${port}: ${JSON.stringify(master)}`);
      let stopped = false;
      return {
        app: 'v1',
        pid: sp.pid,
        port,
        baseUrl,
        home: o.home,
        timings: { spawnAt: sp.spawnAt, httpReadyMs: httpT - sp.spawnAt, dataReadyMs: data.t - sp.spawnAt },
        authHeaders: () => ({}),
        pids: async () => [sp.pid, ...(await descendants(sp.pid, procstat))].filter(isAlive),
        stop: async () => {
          if (stopped) return;
          stopped = true;
          const r = await sp.stop({ procstat });
          meta.stop = { forced: r.forced, ms: Math.round(r.ms), survivors: r.survivors };
          if (fs.existsSync(path.join(o.home, '.master'))) meta.masterLeftBehind = true;
        },
        logs: { stdout: sp.stdoutPath, stderr: sp.stderrPath },
        meta,
      };
    } catch (e) {
      await sp.stop({ procstat });
      throw e;
    }
  }

  async function startUi(server: ServerHandle): Promise<UiHandle> {
    if (server.app !== 'v1') throw new Error(`V1 startUi got a ${server.app} server`);
    // V1 serves its own UI; the page is the server.
    return { url: `${server.baseUrl}/`, extraProcesses: async () => [], stop: async () => {}, meta: { servedBy: 'v1-server' } };
  }

  async function launchDesktop(o: { home: string; runDir: string }): Promise<DesktopHandle> {
    if (!res.desktopApp) throw new Error(`no usable V1 desktop app (${res.notes.join('; ') || `${RELEASE_APP} missing`})`);
    const app = res.desktopApp;
    const exe = path.join(app, 'Contents', 'MacOS', 'Ivy.Tendril');
    // Same rule for both apps even though V1 has a Desktop grant here: identical conditions.
    assertDesktopHome('V1', o.home);
    appEnv(o.home, paths); // validates the home and the empty CLAUDE_CONFIG_DIR
    fs.rmSync(path.join(o.home, '.master'), { force: true });
    const port = await freePort();
    const tag = nextTag();
    // LaunchServices does not pass our environment through; only these --env entries reach the app.
    const launchEnv = { TENDRIL_HOME: path.resolve(o.home), CLAUDE_CONFIG_DIR: paths.emptyClaudeConfig, IVY_TLS: '0' };
    const launch = await launchApp({
      app,
      exe,
      env: launchEnv,
      // --port: desktop mode scans upward for a free port from 5010 otherwise.
      args: ['--desktop', '--port', String(port)],
      logDir: path.join(o.runDir, 'logs'),
      logPrefix: `v1-desktop-${path.basename(o.home)}-${tag}`,
      procstat,
      timeoutMs: TIMEOUTS.desktopLaunchMs,
      log,
    });
    const appPid = launch.appPid;
    const meta: Record<string, unknown> = {
      app,
      home: o.home,
      appSource: res.desktopSource,
      version: res.desktopVersion,
      tls: false,
      requestedPort: port,
      openMs: Math.round(launch.openMs),
      pidSeenMs: Math.round(launch.pidSeenAt - launch.launchedAt),
      stdout: launch.stdoutPath,
      stderr: launch.stderrPath,
    };
    // SIGINT first: V1 maps Ctrl-C to Environment.Exit(0). SIGTERM only stops the .NET host, which
    // then waits for Main, and Main is blocked in the native window loop (observed: no exit in 10 s).
    const quit = () => quitApp({ appPid, procstat, signals: ['SIGINT', 'SIGTERM'], graceMs: 10_000, log });
    const unregister = registerCleanup(async () => {
      await quit();
    });
    const envOk = await processEnvContains(appPid, `TENDRIL_HOME=${launchEnv.TENDRIL_HOME}`);
    meta.envVerified = envOk;
    if (envOk === false) {
      // Not ours (the user may have started the same app at the same moment): never touch it.
      unregister();
      throw new Error(`new ${path.basename(exe)} pid ${appPid} does not carry TENDRIL_HOME=${launchEnv.TENDRIL_HOME}; refusing to treat it as the benchmark instance`);
    }
    let stopped = false;
    return {
      appPid,
      launchedAt: launch.launchedAt,
      backendSpawnedAt: launch.launchedAt,
      roots: async () => {
        const wk = await webkitProcesses(procstat, appPid);
        return [{ role: 'app', pid: appPid }, ...wk.map((w) => ({ role: w.role, pid: w.pid }))];
      },
      stop: async () => {
        if (stopped) return;
        stopped = true;
        const m = readMaster(o.home);
        meta.master = m ? { pid: m.pid, port: m.port, scheme: m.scheme } : null;
        meta.masterMatches = m ? Number(m.pid) === appPid : false;
        meta.quit = await quit();
        unregister();
      },
      meta,
    };
  }

  async function migrate(home: string): Promise<void> {
    const r = await runOnce({
      cmd: bin,
      args: ['db-migrate'],
      env: env(home),
      cwd: emptyCwd(path.join(paths.logs, 'migrate')),
      logDir: path.join(paths.logs, 'migrate'),
      logPrefix: `v1-migrate-${path.basename(path.dirname(home))}-${path.basename(home)}-${nextTag()}`,
      timeoutMs: TIMEOUTS.cliRunMs,
      log,
    });
    if (r.code !== 0) throw new Error(`V1 db-migrate failed (exit ${r.code ?? r.signal}):\n${tail(`${r.stdout}\n${r.stderr}`)}`);
    if (!/version 25|up to date/i.test(r.stdout)) log.warn(`V1 db-migrate output did not mention the schema version:\n${tail(r.stdout, 4)}`);
  }

  return {
    id: 'v1',
    label: `Tendril V1 (${V1_REF})`,
    migrate,
    startServer,
    startUi,
    launchDesktop,
    cli: { bin, env },
    api: apiScenarios('/api/ping'),
    ui: V1_UI,
    meta: {
      serverBin: bin,
      serverSource: res.serverSource,
      serverBytes: res.serverInfo.bytes,
      serverVersion: res.serverInfo.version,
      runtime: frameworks,
      desktopApp: res.desktopApp,
      desktopSource: res.desktopSource,
      desktopVersion: res.desktopVersion,
      notes: res.notes,
    },
  };
}
