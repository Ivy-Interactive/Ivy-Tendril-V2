// Suite 2, cli: one-shot CLI commands, wall time and peak memory per invocation.
//
// Each command runs under native/cliexec, which posix_spawns it, waits for the exit without reaping
// (so the zombie's rusage_info is still readable) and reports wall time, the process's lifetime peak
// phys_footprint and its CPU (including children it reaped itself). Node cannot do this: libuv reaps
// a child the moment it exits, so its counters are gone before any sampler could read them.
//
// Only semantically equivalent commands are compared (syntax checked against both CLIs' --help):
//   --version               print the version and exit
//   plan list               the command as a user types it, on a home the app has already synced.
//                           V1 scans every Plans/*/plan.yaml; V2 reads its SQLite DB (which is why
//                           the home must be synced first: the dataset template's DB has no plans).
//   plan list (disk scan)   `plan list --plans-dir <home>/Plans`: both apps scan the plan files.
//   plan get                `plan get <id>` (reads that plan's plan.yaml on both).
// Neither CLI talks to a running server for these commands, and no server runs while they are timed.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BENCH_ROOT, TIMEOUTS, type DatasetName } from '../lib/config.ts';
import { errorMessage, type Logger } from '../lib/log.ts';
import { registerCleanup, run as runTool, sleep, TimeoutError } from '../lib/proc.ts';
import { newSuiteResult, type AppId, type SuiteResult } from '../lib/results.ts';
import type { AppAdapter } from '../apps/types.ts';
import { emptyCwd } from '../apps/common.ts';
import { restoreHome, type DatasetManifest } from '../datasets/index.ts';
import type { SuiteContext } from './index.ts';
import { checkCliLinks, cliLinkState, isTimeout, medianOf, Recorder, round, toMiB } from './csi-shared.ts';

const CLIEXEC_SOURCE = path.join(BENCH_ROOT, 'native', 'cliexec.c');

/** What native/cliexec writes (see its header comment). */
interface CliexecResult {
  ok: boolean;
  error?: string;
  pid: number;
  exit_code: number | null;
  signal: number | null;
  wall_ns: number;
  spawn_ns: number;
  life_ns: number;
  rusage_ok: boolean;
  rusage_err: number;
  peak_footprint: number;
  user_ns: number;
  system_ns: number;
  child_user_ns: number;
  child_system_ns: number;
  max_rss: number;
  instructions: number;
  pageins: number;
}

interface CliRun {
  res: CliexecResult;
  stdout: string;
  stdoutBytes: number;
  stderrTail: string;
}

/** Compiles native/cliexec when missing or older than its source (temp file + rename, race-safe). */
async function ensureCliexec(binDir: string, log: Logger): Promise<string> {
  const bin = path.join(binDir, 'cliexec');
  const src = fs.statSync(CLIEXEC_SOURCE);
  try {
    if (fs.statSync(bin).mtimeMs >= src.mtimeMs) return bin;
  } catch {
    // missing: build it
  }
  fs.mkdirSync(binDir, { recursive: true });
  const tmp = `${bin}.tmp-${process.pid}`;
  const args = ['-O2', '-Wall', '-o', tmp, CLIEXEC_SOURCE];
  log.info(`compiling cliexec: cc ${args.join(' ')}`);
  try {
    await runTool('cc', args, { timeoutMs: 120_000 });
    fs.renameSync(tmp, bin);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`failed to compile ${CLIEXEC_SOURCE}: ${errorMessage(e)}`);
  }
  return bin;
}

/**
 * One measured invocation. stdout/stderr go to files, not pipes: a pipe the harness drains late
 * (a busy event loop) would block a chatty command and inflate its wall time.
 */
async function runCli(o: { cliexec: string; bin: string; args: string[]; env: Record<string, string>; cwd: string; dir: string; tag: string }): Promise<CliRun> {
  if (!o.env.TENDRIL_HOME) throw new Error('refusing to run an app CLI without an isolated TENDRIL_HOME');
  const resultFile = path.join(o.dir, `${o.tag}.result.json`);
  const outFile = path.join(o.dir, `${o.tag}.stdout.txt`);
  const errFile = path.join(o.dir, `${o.tag}.stderr.txt`);
  fs.rmSync(resultFile, { force: true });
  const outFd = fs.openSync(outFile, 'w');
  const errFd = fs.openSync(errFile, 'w');
  let child;
  try {
    child = spawn(o.cliexec, [resultFile, o.bin, ...o.args], { cwd: o.cwd, env: o.env, stdio: ['ignore', outFd, errFd], detached: true });
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
  const pid = child.pid;
  if (pid === undefined) throw new Error(`could not spawn ${o.cliexec}`);
  const killGroup = () => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // already gone
    }
  };
  const unregister = registerCleanup(killGroup);
  let timer: NodeJS.Timeout | undefined;
  try {
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), TIMEOUTS.cliRunMs);
    });
    const r = await Promise.race([exited, timeout]);
    if (r === 'timeout') {
      killGroup();
      throw new TimeoutError(`${path.basename(o.bin)} ${o.args.join(' ')}: no exit within ${TIMEOUTS.cliRunMs} ms`);
    }
    if (r.code !== 0) throw new Error(`cliexec exited ${r.code ?? r.signal} for ${path.basename(o.bin)} ${o.args.join(' ')}: ${fs.readFileSync(errFile, 'utf8').slice(-400)}`);
  } finally {
    clearTimeout(timer);
    unregister();
  }
  const res = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as CliexecResult;
  if (!res.ok) throw new Error(`cliexec: ${res.error ?? 'measurement failed'}`);
  const stdout = fs.readFileSync(outFile, 'utf8');
  const stderrTail = fs.readFileSync(errFile, 'utf8').slice(-400);
  if (res.exit_code !== 0 || res.signal !== null) {
    throw new Error(`${path.basename(o.bin)} ${o.args.join(' ')} exited ${res.exit_code ?? `on signal ${res.signal}`}: ${(stderrTail || stdout.slice(-400)).trim()}`);
  }
  if (!res.rusage_ok) throw new Error(`proc_pid_rusage failed on the exited command (errno ${res.rusage_err})`);
  return { res, stdout, stdoutBytes: Buffer.byteLength(stdout), stderrTail };
}

// ---------------------------------------------------------------------------------------------

interface CliCommand {
  scenario: string;
  args(home: string): string[];
  /** Where each app gets its answer from (recorded as meta). */
  source: Record<AppId, string>;
  /** Throws when the output is not a correct answer (a fast wrong answer must not count). */
  check(out: string, m: DatasetManifest): { rows?: number };
}

/** Table rows of `plan list` on both CLIs start with the 5-digit plan id. */
function planRows(out: string): number {
  return out.split('\n').filter((l) => /^\s*\d{5}\b/.test(l)).length;
}

function commands(m: DatasetManifest): CliCommand[] {
  const listCheck = (out: string, man: DatasetManifest) => {
    const rows = planRows(out);
    if (rows !== man.counts.plans) throw new Error(`listed ${rows} plan(s), the dataset has ${man.counts.plans}`);
    return { rows };
  };
  const out: CliCommand[] = [
    {
      scenario: '--version',
      args: () => ['--version'],
      source: {
        v1: 'nothing on disk beyond config.yaml: builds the CLI service container and ConfigService, then prints the assembly version',
        v2: 'nothing: clap prints the version before any command code runs',
      },
      check: (o) => {
        if (!/\d+\.\d+\.\d+/.test(o)) throw new Error(`no version in output: ${o.slice(0, 200)}`);
        return {};
      },
    },
    {
      scenario: 'plan list',
      args: () => ['plan', 'list'],
      source: { v1: 'scans every Plans/*/plan.yaml (line scan of 4 fields)', v2: 'SQLite tendril.db (filled by the daemon)' },
      check: listCheck,
    },
    {
      scenario: 'plan list (disk scan)',
      args: (home) => ['plan', 'list', '--plans-dir', path.join(home, 'Plans')],
      source: { v1: 'scans every Plans/*/plan.yaml (line scan of 4 fields)', v2: 'scans every Plans/*/plan.yaml (full parse into PlanFile)' },
      check: listCheck,
    },
  ];
  const id = m.ids.getPlanId;
  if (id) {
    out.push({
      scenario: 'plan get',
      args: () => ['plan', 'get', id],
      source: { v1: `Plans/<${id} folder>/plan.yaml (parsed, re-serialised)`, v2: `Plans/<${id} folder>/plan.yaml (parsed, printed raw)` },
      check: (o) => {
        if (!/^state:/m.test(o)) throw new Error(`no plan YAML in output: ${o.slice(0, 200)}`);
        return {};
      },
    });
  }
  return out;
}

interface Collected {
  wall: number[];
  /** Runs that did not exit within TIMEOUTS.cliRunMs (censored at the limit). */
  timedOut: number;
  peak: number[];
  cpu: number[];
  childCpu: number[];
  spawn: number[];
  maxRss: number[];
  stdoutBytes: number[];
  rows: number[];
  warmupWall: number[];
}

function emptyCollected(): Collected {
  return { wall: [], timedOut: 0, peak: [], cpu: [], childCpu: [], spawn: [], maxRss: [], stdoutBytes: [], rows: [], warmupWall: [] };
}

export async function run(ctx: SuiteContext): Promise<SuiteResult> {
  const r = newSuiteResult('cli', ctx.runId, ctx.profile);
  const rec = new Recorder(r);
  const log = ctx.log;
  const links = cliLinkState();
  const { warmup, runs } = ctx.knobs.cli;
  const cliexec = await ensureCliexec(ctx.paths.binDir, log);
  const outDir = path.join(ctx.dirs.logs, 'cli');
  fs.mkdirSync(outDir, { recursive: true });
  r.notes.push(
    `measured with ${path.relative(ctx.ws, cliexec)}: wall = posix_spawn to exit; peak = the command process's lifetime max phys_footprint (its children, such as V1's short-lived which probes, are not included); cpu = user + system of the process plus the children it reaped (childCpuSMedian in meta)`,
  );

  for (const dataset of ctx.cliDatasets as DatasetName[]) {
    // One home per app, synced by one start/stop of the app's own server: V2's `plan list` reads
    // the DB the daemon fills, and both apps finish initialising a home on first start (V1 deploys
    // promptwares and creates its folders), which a user's CLI never pays for.
    const homes = new Map<AppId, string>();
    let manifest: DatasetManifest | null = null;
    for (const app of ctx.apps) {
      try {
        const h = await restoreHome({ paths: ctx.paths, dataset, app: app.id, runDir: ctx.runDir, suffix: 'cli', log });
        manifest = h.manifest;
        const server = await app.startServer({ home: h.home, runDir: ctx.runDir, mode: 'web' });
        const readyMs = Math.max(server.timings.httpReadyMs, server.timings.dataReadyMs);
        await server.stop();
        log.info(`${app.id}/${dataset}: home synced by one server start (ready in ${readyMs.toFixed(0)} ms)`);
        homes.set(app.id, h.home);
      } catch (e) {
        log.warn(`${app.id}/${dataset}: could not prepare the CLI home: ${errorMessage(e)}`);
        rec.fail(app.id, dataset, '(home sync)', e);
      }
    }
    if (!manifest) continue;
    const apps = ctx.apps.filter((a) => homes.has(a.id));
    if (!apps.length) continue;

    for (const cmd of commands(manifest)) {
      const got = new Map<AppId, Collected>(apps.map((a) => [a.id, emptyCollected()]));
      const argvShown = new Map<AppId, string>();
      const outcomes = await ctx.interleave(warmup + runs, apps, async (app: AppAdapter, i: number) => {
        const home = homes.get(app.id)!;
        const args = cmd.args(home);
        argvShown.set(app.id, [path.basename(app.cli.bin), ...args].join(' ').replaceAll(home, '<home>'));
        const res = await runCli({
          cliexec,
          bin: app.cli.bin,
          args,
          env: app.cli.env(home),
          cwd: emptyCwd(ctx.runDir),
          dir: outDir,
          tag: `${app.id}-${dataset}-${cmd.scenario.replace(/[^A-Za-z0-9]+/g, '_')}`,
        }).catch((e: unknown) => {
          if (i >= warmup && isTimeout(e)) got.get(app.id)!.timedOut++;
          throw e;
        });
        const checked = cmd.check(res.stdout, manifest!);
        const c = got.get(app.id)!;
        const wallMs = res.res.wall_ns / 1e6;
        if (i < warmup) {
          c.warmupWall.push(round(wallMs));
          return;
        }
        c.wall.push(round(wallMs));
        c.peak.push(round(toMiB(res.res.peak_footprint), 4));
        c.cpu.push(round((res.res.user_ns + res.res.system_ns + res.res.child_user_ns + res.res.child_system_ns) / 1e9, 6));
        c.childCpu.push(round((res.res.child_user_ns + res.res.child_system_ns) / 1e9, 6));
        c.spawn.push(round(res.res.spawn_ns / 1e6, 3));
        c.maxRss.push(res.res.max_rss);
        c.stdoutBytes.push(res.stdoutBytes);
        if (checked.rows !== undefined) c.rows.push(checked.rows);
        // Give the machine a moment between back-to-back process launches (dyld and page-cache
        // work from the previous one can still be settling).
        await sleep(50);
      });
      for (const o of outcomes) if (!o.ok) rec.fail(o.app.id, dataset, cmd.scenario, o.error);

      for (const app of apps) {
        const c = got.get(app.id)!;
        const meta: Record<string, unknown> = {
          argv: argvShown.get(app.id),
          source: cmd.source[app.id],
          talksToServer: false,
          serverRunning: false,
          homeState: 'synced: one start/stop of the app server on the restored template',
          warmupRuns: warmup,
          warmupWallMs: c.warmupWall,
          stdoutBytes: medianOf(c.stdoutBytes),
          rows: c.rows.length ? medianOf(c.rows) : undefined,
          spawnMsMedian: medianOf(c.spawn),
          maxRssBytesMedian: medianOf(c.maxRss),
          bin: app.cli.bin,
        };
        rec.metric({ scenario: cmd.scenario, app: app.id, dataset, metric: 'wall_ms', unit: 'ms', samples: c.wall, censored: c.timedOut ? Array.from({ length: c.timedOut }, () => TIMEOUTS.cliRunMs) : undefined, meta });
        rec.metric({ scenario: cmd.scenario, app: app.id, dataset, metric: 'peak_footprint_mib', unit: 'MiB', samples: c.peak, meta: { what: 'lifetime max phys_footprint of the command process' } });
        rec.metric({ scenario: cmd.scenario, app: app.id, dataset, metric: 'cpu_s', unit: 'cpu_s', samples: c.cpu, meta: { childCpuSMedian: medianOf(c.childCpu) } });
        log.info(`${cmd.scenario} ${app.id}/${dataset}: wall median ${medianOf(c.wall)?.toFixed(1)} ms, peak ${medianOf(c.peak)?.toFixed(1)} MiB (n=${c.wall.length})`);
      }
    }
  }

  checkCliLinks(links, r, log);
  return r;
}
