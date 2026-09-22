// Suite 7, desktop: the real desktop apps, both of which render with the system WKWebView through
// wry. V1 is the signed /Applications/Ivy Tendril.app (v1.2.4); V2 is the Tendril.app built from the
// pinned sha, adopting a daemon the adapter starts first. This is the only suite that measures the
// real Tauri host (tendril-app) and the WebKit processes both apps really run, so it answers "what
// does each app cost on this machine while it sits open", plus process-level launch milestones.
//
// Per dataset: one discarded warmup launch per app (it pages the binaries in and warms each app's
// WebKit caches, so the first measured run is not a cold-disk outlier), then `runs` measured launches
// interleaved ABBA. Each launch restores a pristine home outside ~/Desktop (see desktopHomesRoot: a
// LaunchServices app reading ~/Desktop needs a privacy consent and V2 blocks on it), samples the whole
// process set once a second for `durationSec` seconds from the launch command, then quits the app and
// proves nothing it started is still running.
//
// Timing sources, chosen so a slow harness under load cannot inflate them:
//   app_process_ms       kernel start time of the app process (proc_pidinfo) minus the launch command
//   webcontent_spawn_ms  kernel start time of the first WebContent process the app is responsible for
//   window_visible_ms    first poll (every WINDOW_POLL_MS) that sees an on-screen, layer-0 window of
//                        the app larger than 200x200 pt. Polling covers every window owner from before
//                        the launch, so the adapter's own checks after it finds the pid cost nothing.
//                        Every AppKit app (not just these two) owns an off-screen 500x500 window, and
//                        both own off-screen 33 pt menu-bar strips; neither passes the filter.
//
// A locked screen changes the measurement: the loginwindow shield covers (occludes) the app windows, so
// WebKit throttles them, and new windows were observed to come up at 90% of their size (V2 1152x721 pt
// instead of 1280x800, V1 810x566 instead of 900x628, a plain AppKit probe likewise). Each run records
// whether the screen was locked and the suite says so in its notes.

import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { webkitProcesses } from '../apps/common.ts';
import type { AppAdapter, DesktopHandle } from '../apps/types.ts';
import type { DatasetName } from '../lib/config.ts';
import { desktopHomesRoot, removeDesktopHomes, restoreHome } from '../datasets/index.ts';
import { errorMessage, type Logger } from '../lib/log.ts';
import { isAlive, sleep } from '../lib/proc.ts';
import { MiB, Sampler, type ProcInfo, type ProcStat, type WindowInfo } from '../lib/procstat.ts';
import { newSuiteResult, type AppId, type Metric, type SeriesEntry, type SuiteResult, type Unit } from '../lib/results.ts';
import { median } from '../lib/stats.ts';
import type { SuiteContext } from './index.ts';

const execFileP = promisify(execFile);

/** Resolution of window_visible_ms. */
const WINDOW_POLL_MS = 25;
/** Sampling cadence of the footprint/CPU time series. */
const SAMPLE_MS = 1000;
/** "Settled" point: footprint_15s_mib is read here, and CPU/wakeups are averaged from here to the end. */
const SETTLE_SEC = 15;
/** A warmup only needs the app fully up; it is quit this long after launch (or the run length, if shorter). */
const WARMUP_SEC = 15;
/** A qualifying main window: AppKit's off-screen helper window is 500x500 and the menu-bar strips 33 pt high. */
const MIN_WINDOW_PT = 200;

// ---------------------------------------------------------------------------------------------
// Window watcher

interface WindowSeen {
  /** performance.now() when the poll that first saw it returned. */
  t: number;
  w: number;
  h: number;
  id: number;
}

function isMainWindow(w: WindowInfo): boolean {
  return w.onscreen && w.layer === 0 && w.w > MIN_WINDOW_PT && w.h > MIN_WINDOW_PT;
}

/** Whether the lock screen (loginwindow's full-screen shield, far above layer 0) is up. */
async function screenLocked(ps: ProcStat): Promise<boolean | null> {
  try {
    const all = await ps.windows([]);
    return all.some((w) => w.owner === 'loginwindow' && w.onscreen && w.layer >= 1000 && w.w >= 1000 && w.h >= 600);
  } catch {
    return null;
  }
}

/**
 * Polls on-screen windows of every owner until the target pid (unknown until the launch returns) has
 * a qualifying window. Starting before the launch means the time spent finding and verifying the pid
 * never delays the observation.
 */
function watchWindows(ps: ProcStat, log: Logger): {
  setTarget(pid: number): void;
  waitFor(deadlinePerf: number): Promise<WindowSeen | null>;
  stop(): Promise<void>;
  stats(): { polls: number; errors: number };
} {
  const first = new Map<number, WindowSeen>();
  let target: number | null = null;
  let stopped = false;
  let polls = 0;
  let errors = 0;
  let deadline = Infinity;
  const loop = (async () => {
    while (!stopped) {
      const t0 = performance.now();
      if (t0 > deadline) break;
      try {
        const wins = await ps.windows(target === null ? [] : [target]);
        const t = performance.now();
        polls++;
        for (const w of wins) if (isMainWindow(w) && !first.has(w.pid)) first.set(w.pid, { t, w: w.w, h: w.h, id: w.id });
      } catch (e) {
        if (errors++ === 0) log.warn(`window poll failed: ${errorMessage(e)}`);
      }
      if (target !== null && first.has(target)) break;
      await sleep(Math.max(0, WINDOW_POLL_MS - (performance.now() - t0)));
    }
  })();
  return {
    setTarget(pid) {
      target = pid;
    },
    async waitFor(deadlinePerf) {
      deadline = deadlinePerf;
      await loop;
      return target !== null ? (first.get(target) ?? null) : null;
    },
    async stop() {
      stopped = true;
      await loop;
    },
    stats: () => ({ polls, errors }),
  };
}

// ---------------------------------------------------------------------------------------------
// Leftover check

interface Leftover {
  pid: number;
  name: string;
  why: string;
}

/**
 * Everything this launch could have left behind: any pid we sampled that is still the same process,
 * any WebKit process still attributed to the (now dead) app pid, and any process whose environment
 * carries this launch's TENDRIL_HOME (the app, the daemon, and anything either of them spawned). Other
 * sessions run the same bundles, so names alone would find their processes, not ours.
 */
async function findLeftovers(ps: ProcStat, home: string, appPid: number, tracked: Map<number, number | null>): Promise<Leftover[]> {
  const out = new Map<number, Leftover>();
  const table = await ps.listAll();
  const byPid = new Map(table.map((p) => [p.pid, p]));
  for (const [pid, startUs] of tracked) {
    // Only pids whose start time we recorded while they were ours: a pid that exited earlier may have
    // been recycled by someone else's process by now.
    const p = byPid.get(pid);
    if (startUs === null || !p || p.start_us !== startUs || !isAlive(pid)) continue;
    out.set(pid, { pid, name: p.name, why: 'sampled during the run' });
  }
  // Attribution by responsible pid is only ours while the app pid has not been handed to a new process.
  const appGone = !isAlive(appPid) || out.has(appPid);
  for (const w of appGone ? await webkitProcesses(ps, appPid).catch(() => []) : []) {
    if (!out.has(w.pid)) out.set(w.pid, { pid: w.pid, name: w.name, why: `WebKit process still attributed to app pid ${appPid}` });
  }
  try {
    const { stdout } = await execFileP('/bin/ps', ['-wwEax', '-o', 'pid=,command='], { maxBuffer: 256 * 1024 * 1024, timeout: 30_000 });
    const needle = `TENDRIL_HOME=${home}`;
    for (const line of String(stdout).split('\n')) {
      const i = line.indexOf(needle);
      if (i < 0) continue;
      const next = line[i + needle.length];
      if (next !== undefined && next !== ' ') continue; // a longer path that merely starts with ours
      const pid = Number.parseInt(line.trim(), 10);
      if (!Number.isInteger(pid) || pid === process.pid || out.has(pid) || !isAlive(pid)) continue;
      out.set(pid, { pid, name: byPid.get(pid)?.name ?? '?', why: 'environment carries this run\'s TENDRIL_HOME' });
    }
  } catch (e) {
    out.set(-1, { pid: -1, name: 'ps', why: `environment scan failed: ${errorMessage(e)}` });
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------------------------
// One launch

interface Point {
  /** Seconds since the launch command. */
  sec: number;
  total: number;
  byRole: Record<string, number>;
}

interface RunRecord {
  app: AppId;
  dataset: DatasetName;
  i: number;
  warmup: boolean;
  appProcessMs: number | null;
  pidSeenMs: number | null;
  webcontentSpawnMs: number | null;
  /** Every WebContent process the app was responsible for, ms after launch (V1 runs three). */
  webcontentStartsMs: number[];
  windowVisibleMs: number | null;
  windowFirst: { w: number; h: number } | null;
  /** Qualifying windows at the end of the window, in points. */
  windowsEnd: Array<{ w: number; h: number }>;
  windowPolls: number;
  /** The lock screen was up at the start or the end of the run (null: could not tell). */
  screenLocked: boolean | null;
  /** Seconds between the launch command and the sampler's first point. */
  samplerOffsetSec: number;
  durationSec: number;
  fp15: Point | null;
  fpEnd: Point | null;
  countsEnd: Record<string, number>;
  fpMeanMiB: number | null;
  peakMiB: number;
  peakByRole: Record<string, number>;
  rssEndMiB: number | null;
  cpuPercent: number | null;
  cpuPercentByRole: Record<string, number>;
  cpuSecondsToSettle: number | null;
  wakeupsPerSec: number | null;
  series: { total: Array<[number, number]>; byRole: Record<string, Array<[number, number]>>; cpu: Array<[number, number]> };
  processesEnd: Array<{ role: string; name: string; pid: number; footprintMiB: number }>;
  adapter: Record<string, unknown>;
  leftovers: Leftover[];
  samplerErrors: string[];
  home: string;
}

const round = (x: number, d = 1): number => Math.round(x * 10 ** d) / 10 ** d;

async function launchOnce(ctx: SuiteContext, app: AppAdapter, dataset: DatasetName, i: number, warmup: boolean): Promise<RunRecord> {
  const ps = ctx.procstat;
  const log = ctx.log.child(`${app.id}/${dataset}${warmup ? '/warmup' : `#${i + 1}`}`);
  const durationSec = warmup ? Math.min(WARMUP_SEC, ctx.knobs.desktop.durationSec) : ctx.knobs.desktop.durationSec;
  const restored = await restoreHome({ paths: ctx.paths, dataset, app: app.id, runDir: ctx.runDir, homesRoot: desktopHomesRoot(ctx.runDir), suffix: 'desktop', log });
  const home = restored.home;

  const lockedBefore = await screenLocked(ps);
  if (lockedBefore) log.warn('the screen is locked: app windows are occluded by the lock screen, so WebKit throttles them and the numbers are not representative');
  const windows = watchWindows(ps, log);
  let handle: DesktopHandle;
  try {
    handle = await app.launchDesktop({ home, runDir: ctx.runDir });
  } catch (e) {
    await windows.stop();
    throw e;
  }
  const appPid = handle.appPid;
  // Kernel process start times are wall clock; the launch was stamped on the monotonic clock.
  const launchEpochMs = Date.now() - (performance.now() - handle.launchedAt);
  const sinceLaunchMs = (startUs: number | null): number | null => (startUs === null ? null : startUs / 1000 - launchEpochMs);
  windows.setTarget(appPid);
  const endAt = handle.launchedAt + durationSec * 1000;
  log.info(`launched pid ${appPid}; sampling for ${durationSec} s`);

  const sampler = new Sampler(ps, () => handle.roots(), { intervalMs: SAMPLE_MS, expandEveryMs: SAMPLE_MS, resetAtStart: true, log });
  let rec: RunRecord | null = null;
  let tableEnd: ProcInfo[] = [];
  let windowSeen: WindowSeen | null = null;
  let windowsEnd: WindowInfo[] = [];
  let lockedAfter: boolean | null = null;
  const tracked = new Map<number, number | null>();
  try {
    await sampler.start();
    windowSeen = await windows.waitFor(endAt);
    await sleep(Math.max(0, endAt - performance.now()));
    await sampler.stop();
    tableEnd = await ps.listAll();
    windowsEnd = (await ps.windows([appPid]).catch(() => [])).filter(isMainWindow);
    lockedAfter = await screenLocked(ps);
  } finally {
    await windows.stop();
    await sampler.stop().catch(() => undefined);
    const startOf = new Map(tableEnd.map((p) => [p.pid, p.start_us]));
    for (const pt of sampler.points) for (const pid of pt.procs.keys()) tracked.set(pid, startOf.get(pid) ?? null);
    try {
      await handle.stop();
    } catch (e) {
      log.error(`stop failed: ${errorMessage(e)}`);
    }
  }
  const leftovers = await findLeftovers(ps, home, appPid, tracked);
  for (const l of leftovers.filter((x) => x.pid > 0)) {
    log.error(`leftover after quitting: pid ${l.pid} ${l.name} (${l.why}); killing it`);
    try {
      process.kill(l.pid, 'SIGKILL');
    } catch {
      // Gone in the meantime.
    }
  }

  const pts = sampler.points;
  if (!pts.length) throw new Error(`no samples taken (${sampler.errors.join('; ') || 'sampler never ran'})`);
  const offsetSec = (pts[0]!.t - handle.launchedAt) / 1000;
  const roles = sampler.roles();
  const pointOf = (idx: number): Point => {
    const pt = pts[idx]!;
    const byRole: Record<string, number> = {};
    for (const r of roles) byRole[r] = 0;
    let total = 0;
    for (const p of pt.procs.values()) {
      byRole[p.role] = (byRole[p.role] ?? 0) + p.footprint / MiB;
      total += p.footprint / MiB;
    }
    return { sec: pt.sec + offsetSec, total, byRole };
  };
  const idxAt = (secSinceLaunch: number): number | null => {
    const k = pts.findIndex((p) => p.sec + offsetSec >= secSinceLaunch - 1e-6);
    return k < 0 ? null : k;
  };
  const idx15 = idxAt(SETTLE_SEC);
  const lastIdx = pts.length - 1;
  const fpEnd = pointOf(lastIdx);
  const countsEnd: Record<string, number> = {};
  for (const p of pts[lastIdx]!.procs.values()) countsEnd[p.role] = (countsEnd[p.role] ?? 0) + 1;
  const settleFrom = SETTLE_SEC - offsetSec;
  const cpuPercentByRole: Record<string, number> = {};
  const peakByRole: Record<string, number> = {};
  for (const r of roles) {
    const c = sampler.cpuPercent(settleFrom, Infinity, r);
    if (c !== null) cpuPercentByRole[r] = round(c, 2);
    peakByRole[r] = round(sampler.peakFootprint(r) / MiB);
  }
  const cpuToSettle = idx15 === null ? null : sampler.delta('cpu_ns', 0, pts[idx15]!.sec) / 1e9;

  // Time series: whole tree, per role, and CPU % of one core between consecutive points.
  const total: Array<[number, number]> = [];
  const byRoleSeries: Record<string, Array<[number, number]>> = {};
  const cpu: Array<[number, number]> = [];
  for (let k = 0; k < pts.length; k++) {
    const p = pointOf(k);
    const sec = round(p.sec, 3);
    total.push([sec, round(p.total, 2)]);
    for (const r of roles) (byRoleSeries[r] ??= []).push([sec, round(p.byRole[r] ?? 0, 2)]);
    if (k > 0) {
      const c = sampler.cpuPercent(pts[k - 1]!.sec, pts[k]!.sec);
      if (c !== null) cpu.push([sec, round(c, 2)]);
    }
  }

  // WebContent processes: kernel start times (from the process table at the end, or mapped from the
  // helper's mach clock for any that exited before then).
  const machToPerfMs = pts[0]!.t - pts[0]!.t_ns / 1e6;
  const wcStarts: number[] = [];
  const seenWc = new Set<number>();
  for (const pt of pts) {
    for (const [pid, p] of pt.procs) {
      if (p.role !== 'webkit-webcontent' || seenWc.has(pid)) continue;
      seenWc.add(pid);
      const fromTable = sinceLaunchMs(tableEnd.find((x) => x.pid === pid)?.start_us ?? null);
      const ms = fromTable ?? (p.start_ns ? p.start_ns / 1e6 + machToPerfMs - handle.launchedAt : null);
      if (ms !== null) wcStarts.push(round(ms, 1));
    }
  }
  wcStarts.sort((a, b) => a - b);
  const appStartUs = tableEnd.find((x) => x.pid === appPid)?.start_us ?? null;
  const appPoint = pts.find((pt) => pt.procs.has(appPid))?.procs.get(appPid);
  const appProcessMs = sinceLaunchMs(appStartUs) ?? (appPoint?.start_ns ? appPoint.start_ns / 1e6 + machToPerfMs - handle.launchedAt : null);
  const pidSeenMs = typeof handle.meta?.pidSeenMs === 'number' ? handle.meta.pidSeenMs : null;

  const processesEnd = [...pts[lastIdx]!.procs.entries()]
    .map(([pid, p]) => ({ role: p.role, name: p.name, pid, footprintMiB: round(p.footprint / MiB) }))
    .sort((a, b) => a.role.localeCompare(b.role) || b.footprintMiB - a.footprintMiB);

  rec = {
    app: app.id,
    dataset,
    i,
    warmup,
    appProcessMs: appProcessMs === null ? null : round(appProcessMs, 1),
    pidSeenMs,
    webcontentSpawnMs: wcStarts[0] ?? null,
    webcontentStartsMs: wcStarts,
    windowVisibleMs: windowSeen ? round(windowSeen.t - handle.launchedAt, 1) : null,
    windowFirst: windowSeen ? { w: windowSeen.w, h: windowSeen.h } : null,
    windowsEnd: windowsEnd.map((w) => ({ w: w.w, h: w.h })),
    windowPolls: windows.stats().polls,
    screenLocked: lockedBefore === true || lockedAfter === true ? true : lockedBefore === null && lockedAfter === null ? null : false,
    samplerOffsetSec: round(offsetSec, 3),
    durationSec: round(fpEnd.sec, 2),
    fp15: idx15 === null ? null : pointOf(idx15),
    fpEnd,
    countsEnd,
    fpMeanMiB: sampler.mean('footprint', settleFrom) === null ? null : sampler.mean('footprint', settleFrom)! / MiB,
    peakMiB: sampler.peakFootprint() / MiB,
    peakByRole,
    rssEndMiB: sampler.valueAt(Infinity, 'resident') === null ? null : sampler.valueAt(Infinity, 'resident')! / MiB,
    cpuPercent: sampler.cpuPercent(settleFrom),
    cpuPercentByRole,
    cpuSecondsToSettle: cpuToSettle,
    wakeupsPerSec: sampler.wakeupsPerSec(settleFrom),
    series: { total, byRole: byRoleSeries, cpu },
    processesEnd,
    adapter: handle.meta ?? {},
    leftovers,
    samplerErrors: sampler.errors,
    home,
  };
  log.info(
    `pid@${fmt(rec.appProcessMs)} ms, WebContent@${fmt(rec.webcontentSpawnMs)} ms, window@${fmt(rec.windowVisibleMs)} ms` +
      ` ${rec.windowFirst ? `${rec.windowFirst.w}x${rec.windowFirst.h} pt` : ''}; footprint +${SETTLE_SEC}s ${fmt(rec.fp15?.total ?? null)} MiB,` +
      ` end ${fmt(fpEnd.total)} MiB (${Object.entries(fpEnd.byRole).map(([r, v]) => `${r} ${v.toFixed(0)}`).join(', ')}); CPU ${fmt(rec.cpuPercent, 2)}%`,
  );
  if (!windowSeen) throw new Error(`no on-screen window larger than ${MIN_WINDOW_PT}x${MIN_WINDOW_PT} pt within ${durationSec} s of launch (footprint at end ${fpEnd.total.toFixed(0)} MiB)`);
  return rec;
}

function fmt(x: number | null, d = 0): string {
  return x === null || !Number.isFinite(x) ? 'n/a' : x.toFixed(d);
}

// ---------------------------------------------------------------------------------------------
// Suite

export async function run(ctx: SuiteContext): Promise<SuiteResult> {
  const result = newSuiteResult('desktop', ctx.runId, ctx.profile);
  const { runs, warmupRuns, durationSec } = ctx.knobs.desktop;
  const apps = ctx.apps;
  result.notes.push(
    `Each launch: pristine home restored outside ~/Desktop (${desktopHomesRoot(ctx.runDir).replace(/\/[^/]+\/homes$/, '/<runId>/homes')}), ` +
      `${warmupRuns} discarded warmup launch(es) per app and dataset (quit ${Math.min(WARMUP_SEC, durationSec)} s after launch), ` +
      `then ${runs} measured launch(es) of ${durationSec} s interleaved ABBA. Process set sampled every ${SAMPLE_MS} ms: the app and its descendants, ` +
      'the WebKit XPC processes whose responsible pid is the app, and (V2) the daemon the adapter started before the app. ' +
      `CPU and wakeups are averaged from +${SETTLE_SEC} s to the end. Windows are kept visible (no open -g); other windows on screen may occlude them.`,
  );
  for (const a of apps) {
    const m = a.meta ?? {};
    if (a.id === 'v1') result.notes.push(`V1 desktop app: ${String(m.desktopApp)} (${String(m.desktopSource ?? '')}, version ${String(m.desktopVersion ?? '?')}), launched with open -n -F --args --desktop --port <free> and IVY_TLS=0 (the shipped app uses TLS); quit with SIGINT (SIGTERM does not exit it).`);
    if (a.id === 'v2') result.notes.push(`V2 desktop app: ${String(m.app)} (${String(m.appSource ?? '')}), launched with open -n -F and TENDRIL_SKIP_SERVICE_PROVISION=1, TENDRIL_SKIP_SERVICE_AUTOSTART=1 after its daemon (tendril serve) answered /api/health; the daemon is part of the measured set (role daemon).`);
  }

  const records: RunRecord[] = [];
  try {
    for (const dataset of ctx.desktopDatasets) {
      for (let w = 0; w < warmupRuns; w++) {
        for (const app of apps) {
          try {
            const r = await launchOnce(ctx, app, dataset, w, true);
            result.notes.push(`warmup ${app.id}/${dataset}: window at ${fmt(r.windowVisibleMs)} ms, footprint ${fmt(r.fpEnd?.total ?? null)} MiB after ${fmt(r.durationSec)} s (discarded)`);
            noteRunProblems(result, r);
          } catch (e) {
            // A failed warmup is not a missing sample, but it is worth knowing about.
            result.notes.push(`warmup ${app.id}/${dataset} failed: ${errorMessage(e)}`);
          }
        }
      }
      const outcomes = await ctx.interleave(runs, apps, (app, i) => launchOnce(ctx, app, dataset, i, false));
      for (const o of outcomes) {
        if (o.ok) {
          records.push(o.value);
          noteRunProblems(result, o.value);
        } else {
          result.failures.push({ app: o.app.id, dataset, scenario: `launch#${o.i + 1}`, error: errorMessage(o.error) });
        }
      }
    }
  } finally {
    removeDesktopHomes(ctx.runDir);
  }

  for (const dataset of ctx.desktopDatasets) {
    for (const app of apps) {
      const rs = records.filter((r) => r.dataset === dataset && r.app === app.id).sort((a, b) => a.i - b.i);
      if (rs.length) emit(result, app.id, dataset, rs);
    }
  }
  windowSizeNote(result, records);
  const locked = records.filter((r) => r.screenLocked);
  if (locked.length) {
    result.notes.push(
      `WARNING: the screen was locked during ${locked.length} of ${records.length} measured run(s) (${locked.map((r) => `${r.app}/${r.dataset} run ${r.i + 1}`).join(', ')}). ` +
        'The lock screen occludes the app windows (WebKit throttles occluded views) and new windows came up at 90% size, so memory and CPU are not representative of an app in use. Rerun with the screen unlocked.',
    );
  }
  return result;
}

function noteRunProblems(result: SuiteResult, r: RunRecord): void {
  const tag = `${r.app}/${r.dataset}${r.warmup ? ' warmup' : ` run ${r.i + 1}`}`;
  const real = r.leftovers.filter((l) => l.pid > 0);
  if (real.length) {
    const msg = `left ${real.length} process(es) running after quit, killed: ${real.map((l) => `${l.pid} ${l.name} (${l.why})`).join('; ')}`;
    result.failures.push({ app: r.app, dataset: r.dataset, scenario: r.warmup ? 'cleanup (warmup)' : `cleanup#${r.i + 1}`, error: msg });
  }
  for (const l of r.leftovers.filter((x) => x.pid <= 0)) result.notes.push(`${tag}: ${l.why}`);
  if (r.samplerErrors.length) result.notes.push(`${tag}: ${r.samplerErrors.length} sampler error(s), first: ${r.samplerErrors[0]}`);
  const a = r.adapter;
  if (a.envVerified === null) result.notes.push(`${tag}: could not read the app's environment to confirm TENDRIL_HOME`);
  if (r.app === 'v2' && a.adoptedDaemon === false) result.notes.push(`${tag}: tendril-app held no connection to the benchmark daemon at the end of the run`);
  if (r.app === 'v2' && a.launchAgentCreated === true) result.notes.push(`${tag}: a Tendril LaunchAgent appeared during the run (provisioning was not disabled)`);
  if (r.app === 'v2' && a.provisionedBin === true) result.notes.push(`${tag}: <home>/bin was provisioned during the run`);
  if (r.app === 'v1' && a.masterMatches === false) result.notes.push(`${tag}: <home>/.master did not name the launched app pid`);
  const quit = a.quit as { forced?: boolean; webkitForced?: number[] } | undefined;
  if (quit?.forced) result.notes.push(`${tag}: the app had to be SIGKILLed`);
  if (quit?.webkitForced?.length) result.notes.push(`${tag}: ${quit.webkitForced.length} WebKit process(es) outlived the app by 10 s and were killed`);
}

function emit(result: SuiteResult, app: AppId, dataset: DatasetName, rs: RunRecord[]): void {
  const push = (scenario: string, metric: string, unit: Unit, values: Array<number | null>, meta?: Record<string, unknown>): void => {
    const samples = values.filter((v): v is number => v !== null && Number.isFinite(v));
    if (samples.length < values.length) {
      const missing = values.map((v, k) => (v === null || !Number.isFinite(v) ? rs[k]!.i + 1 : null)).filter((x) => x !== null);
      result.failures.push({ app, dataset, scenario, error: `${metric}: no value in run(s) ${missing.join(', ')}` });
    }
    if (!samples.length) return;
    result.metrics.push({ suite: 'desktop', scenario, app, dataset, metric, unit, samples, better: 'lower', ...(meta ? { meta } : {}) } satisfies Metric);
  };
  const roles = [...new Set(rs.flatMap((r) => Object.keys(r.fpEnd?.byRole ?? {})))].sort();
  const byRoleOf = (pick: (r: RunRecord) => Record<string, number> | undefined, d = 1): Record<string, number[]> => {
    const out: Record<string, number[]> = {};
    for (const role of roles) out[role] = rs.map((r) => round(pick(r)?.[role] ?? 0, d));
    return out;
  };

  push('launch', 'app_process_ms', 'ms', rs.map((r) => r.appProcessMs), {
    definition: 'launch command (open -n -F) to the kernel start time of the app process',
    pidSeenMs: rs.map((r) => r.pidSeenMs),
    ...(app === 'v2' ? { daemonReadyMs: rs.map((r) => r.adapter.daemonReadyMs ?? null), daemonNote: 'the V2 daemon is started and healthy before the launch command; not included' } : {}),
  });
  push('launch', 'webcontent_spawn_ms', 'ms', rs.map((r) => r.webcontentSpawnMs), {
    definition: 'launch command to the kernel start time of the first WebKit WebContent process the app is responsible for',
    allWebContentStartsMs: rs.map((r) => r.webcontentStartsMs),
  });
  push('launch', 'window_visible_ms', 'ms', rs.map((r) => r.windowVisibleMs), {
    definition: `launch command to the first poll that sees an on-screen layer-0 window of the app larger than ${MIN_WINDOW_PT}x${MIN_WINDOW_PT} pt`,
    resolutionMs: WINDOW_POLL_MS,
    windowFirstPt: rs.map((r) => r.windowFirst),
    windowPolls: rs.map((r) => r.windowPolls),
  });

  const common = { durationSec: rs.map((r) => r.durationSec), samplerOffsetSec: rs.map((r) => r.samplerOffsetSec) };
  push('steady-state', 'footprint_15s_mib', 'MiB', rs.map((r) => (r.fp15 ? round(r.fp15.total, 2) : null)), {
    definition: `phys_footprint summed over the process set at +${SETTLE_SEC} s after the launch command`,
    byRole: byRoleOf((r) => r.fp15?.byRole),
  });
  push('steady-state', 'footprint_end_mib', 'MiB', rs.map((r) => (r.fpEnd ? round(r.fpEnd.total, 2) : null)), {
    definition: 'phys_footprint summed over the process set at the end of the window',
    byRole: byRoleOf((r) => r.fpEnd?.byRole),
    processCount: byRoleOf((r) => r.countsEnd, 0),
    windowEndPt: rs.map((r) => r.windowsEnd),
    screenLocked: rs.map((r) => r.screenLocked),
    processes: rs.map((r) => r.processesEnd),
    ...common,
  });
  push('steady-state', 'footprint_mean_mib', 'MiB', rs.map((r) => (r.fpMeanMiB === null ? null : round(r.fpMeanMiB, 2))), {
    definition: `mean of the whole-tree footprint samples from +${SETTLE_SEC} s to the end`,
  });
  push('steady-state', 'peak_footprint_mib', 'MiB', rs.map((r) => round(r.peakMiB, 2)), {
    definition: 'sum of per-process interval-max phys_footprint over the window (upper bound on the simultaneous peak)',
    byRole: byRoleOf((r) => r.peakByRole),
  });
  push('steady-state', 'rss_end_mib', 'MiB', rs.map((r) => (r.rssEndMiB === null ? null : round(r.rssEndMiB, 2))), {
    definition: 'resident size summed over the process set at the end (context only: double-counts shared pages)',
  });
  push('steady-state', 'cpu_percent_mean', 'percent', rs.map((r) => (r.cpuPercent === null ? null : round(r.cpuPercent, 3))), {
    definition: `CPU time of the process set from +${SETTLE_SEC} s to the end, as percent of one core`,
    byRole: byRoleOf((r) => r.cpuPercentByRole, 2),
  });
  push('steady-state', 'idle_wakeups_per_s', 'count', rs.map((r) => (r.wakeupsPerSec === null ? null : round(r.wakeupsPerSec, 2))), {
    definition: `package idle + interrupt wakeups of the process set per second, from +${SETTLE_SEC} s to the end`,
  });
  push('launch', 'cpu_s_to_15s', 'cpu_s', rs.map((r) => (r.cpuSecondsToSettle === null ? null : round(r.cpuSecondsToSettle, 3))), {
    definition: `CPU seconds the process set used from the first sample to +${SETTLE_SEC} s (the launch work)`,
  });

  for (const r of rs) {
    const scenario = `steady-state#${r.i + 1}`;
    const s = (name: string, unit: string, points: Array<[number, number]>): SeriesEntry => ({ app, dataset, scenario, name, unit, points });
    result.series!.push(s('footprint_mib', 'MiB', r.series.total));
    for (const [role, pts] of Object.entries(r.series.byRole)) result.series!.push(s(`footprint_mib:${role}`, 'MiB', pts));
    result.series!.push(s('cpu_percent', 'percent', r.series.cpu));
  }
}

/** The window-size confound, from what was actually on screen. */
function windowSizeNote(result: SuiteResult, records: RunRecord[]): void {
  const parts: string[] = [];
  for (const app of ['v1', 'v2'] as const) {
    const sizes = records.filter((r) => r.app === app).flatMap((r) => r.windowsEnd.map((w) => `${w.w}x${w.h}`));
    if (!sizes.length) continue;
    const counts = new Map<string, number>();
    for (const s of sizes) counts.set(s, (counts.get(s) ?? 0) + 1);
    const list = [...counts].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} pt (${n}x)`);
    parts.push(`${app.toUpperCase()} ${list.join(', ')}`);
  }
  if (!parts.length) return;
  const area = (app: AppId): number | null => {
    const a = records.filter((r) => r.app === app).flatMap((r) => r.windowsEnd.map((w) => w.w * w.h));
    return a.length ? median(a) : null;
  };
  const a1 = area('v1');
  const a2 = area('v2');
  const which = a1 !== null && a2 !== null && a1 !== a2 ? ` V${a1 < a2 ? 1 : 2} has the smaller window (${(Math.min(a1, a2) / Math.max(a1, a2) * 100).toFixed(0)}% of the other's area), so its WebKit backing stores are smaller.` : '';
  result.notes.push(`window sizes observed at the end of each measured run (points; 2x pixels on a Retina display): ${parts.join('; ')}.${which} Each app opens at its own default size; resizing from outside needs Accessibility access, which is not granted.`);
}

