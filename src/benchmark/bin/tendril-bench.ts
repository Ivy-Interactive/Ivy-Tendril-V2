#!/usr/bin/env node
// Tendril V1 vs V2 benchmark CLI. Run from the repo root:
//   node src/benchmark/bin/tendril-bench.ts <setup|datasets|run|report|doctor|clean> [flags]
//
// setup, datasets and report live in modules owned by other parts of the project; they are imported
// lazily so that a missing or broken one only breaks its own command.

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { AppAdapter } from '../apps/types.ts';
import {
  BENCH_ROOT,
  DATASET_NAMES,
  DEFAULT_WORKSPACE,
  PROFILE_NAMES,
  PROFILES,
  V1_REF,
  V1_SHA,
  V2_REF_DEFAULT,
  isDatasetName,
  isProfileName,
  workspacePaths,
  type CommandContext,
  type DatasetName,
} from '../lib/config.ts';
import { captureEnv, memoryFreePercent, type EnvCapture } from '../lib/env.ts';
import { createLogger, errorMessage, errorText, localIso } from '../lib/log.ts';
import { freePort, helperPids, installExitHandlers, isAlive, onInterrupt, setDefaultLogDir, stopAll } from '../lib/proc.ts';
import { ProcStat, ensureProcstat } from '../lib/procstat.ts';
import {
  APP_IDS,
  initRunDir,
  listRuns,
  makeRunId,
  readJson,
  readRunInfo,
  runDirFor,
  updateRunInfo,
  writeRunInfo,
  type RunInfo,
  type RunStatus,
} from '../lib/results.ts';
import { SUITE_NAMES, createContext, loadAdapters, resolveSuites, runSuites, type SuiteStatus } from '../suites/index.ts';

const USAGE = `Tendril V1 vs V2 benchmark

usage: node src/benchmark/bin/tendril-bench.ts <command> [flags]

commands:
  setup      clone/checkout/build everything, write build-info.json      (build/setup.ts)
  datasets   generate, migrate and snapshot the dataset homes             (datasets/index.ts)
  run        run benchmark suites into <ws>/runs/<runId>/
  report     generate benchmark.md, charts and committed results          (report/generate.ts)
  doctor     print the environment and check tools, builds and datasets
  clean      remove per-run homes, temp files and leftovers (dry run unless --yes)

common flags:
  --workspace <dir>      benchmark workspace (default ${DEFAULT_WORKSPACE})
  --profile quick|full   iteration counts and durations (default full)
  --v2-ref <sha>         V2 commit under test (default ${V2_REF_DEFAULT.slice(0, 12)})

setup flags:
  --only a,b             only these steps (or the groups v1, v2, clone)
  --skip a,b             skip these steps
  --force                rebuild even when a step's stamp says it is up to date
  --smoke                also run the opt-in smoke test (puts a V2 window on screen)
  --list                 print every step and whether it is up to date, then exit

datasets flags:
  --dataset a,b          only these datasets (default all four)
  --force                rebuild even when the fingerprint matches

run flags:
  --suite a,b|all        ${SUITE_NAMES.join(', ')} (default all)
  --dataset a,b          ${DATASET_NAMES.join(', ')} (default: per profile)
  --app v1,v2            (default both)
  --run-id <id>          resume/append into an existing run
  --quiet-load <float>   before each suite wait until 1-min load < this (default 0 = no wait)
  --quiet-timeout <s>    give up waiting after this many seconds (default 600)

report flags:
  --run <runId>          (default: latest complete run)
  --out <file.md>        where to write the report; charts/ and results/<runId>/ go next to it
                         (default src/benchmark/benchmark.md; inside the run dir, results are
                         linked rather than copied)
  --analysis <file.md>   hand-written analysis to inject (default src/benchmark/analysis.md)
  --fixtures             render the synthetic fixtures in report/fixtures instead of a run
                         (default out: <ws>/runs/fixtures-report/benchmark.md)

doctor flags:
  --json                 machine-readable output on stdout

clean flags:
  --homes                remove runs/*/homes of runs that are not running
  --run <runId>          remove that whole run directory
  --tmp                  remove leftover *.tmp-* files
  --leftovers            stop processes still running from a workspace home/binary
  --yes                  actually do it (otherwise only print what would happen)
`;

// ---------------------------------------------------------------------------------------------
// Flags

const OPTIONS = {
  workspace: { type: 'string' },
  profile: { type: 'string' },
  'v2-ref': { type: 'string' },
  suite: { type: 'string' },
  dataset: { type: 'string' },
  app: { type: 'string' },
  'run-id': { type: 'string' },
  run: { type: 'string' },
  'quiet-load': { type: 'string' },
  'quiet-timeout': { type: 'string' },
  json: { type: 'boolean' },
  yes: { type: 'boolean' },
  homes: { type: 'boolean' },
  tmp: { type: 'boolean' },
  leftovers: { type: 'boolean' },
  verbose: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

type Flags = Record<string, string | boolean | undefined>;

class UsageError extends Error {
  override name = 'UsageError';
}

function list(v: string | boolean | undefined): string[] | null {
  if (typeof v !== 'string') return null;
  const items = v.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : null;
}

function num(v: string | boolean | undefined, name: string, dflt: number): number {
  if (v === undefined) return dflt;
  const n = Number(v);
  if (typeof v !== 'string' || !Number.isFinite(n) || n < 0) throw new UsageError(`--${name} must be a non-negative number`);
  return n;
}


// ---------------------------------------------------------------------------------------------
// Delegated commands

const DELEGATES: Record<string, { file: string; exports: string[]; owner: string }> = {
  setup: { file: 'build/setup.ts', exports: ['main', 'setup', 'run', 'default'], owner: 'build' },
  datasets: { file: 'datasets/index.ts', exports: ['main', 'datasets', 'run', 'default'], owner: 'adapters' },
  report: { file: 'report/generate.ts', exports: ['main', 'report', 'generate', 'run', 'default'], owner: 'report' },
};

async function delegate(ctx: CommandContext): Promise<number> {
  const d = DELEGATES[ctx.command]!;
  const file = path.join(BENCH_ROOT, d.file);
  if (!fs.existsSync(file)) {
    ctx.log.error(`\`${ctx.command}\` is implemented by src/benchmark/${d.file}, which does not exist yet (part: ${d.owner}).`);
    return 1;
  }
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch (e) {
    ctx.log.error(`\`${ctx.command}\`: failed to load src/benchmark/${d.file}: ${errorText(e)}`);
    return 1;
  }
  const name = d.exports.find((n) => typeof mod[n] === 'function');
  if (!name) {
    ctx.log.error(`src/benchmark/${d.file} must export one of ${d.exports.join(', ')} as a function taking a CommandContext (exports: ${Object.keys(mod).join(', ') || 'none'})`);
    return 1;
  }
  const r = await (mod[name] as (c: CommandContext) => unknown)(ctx);
  return typeof r === 'number' ? r : 0;
}

// ---------------------------------------------------------------------------------------------
// run

async function cmdRun(ctx: CommandContext): Promise<number> {
  const { flags, paths, ws, profile, v2Ref } = ctx;
  // Validate everything before creating a run directory, so a typo leaves no trace.
  const suites = resolveSuites(typeof flags.suite === 'string' ? flags.suite : 'all');
  const dsList = list(flags.dataset);
  let datasetOverride: DatasetName[] | null = null;
  if (dsList) {
    const bad = dsList.filter((d) => !isDatasetName(d));
    if (bad.length) throw new UsageError(`unknown dataset(s): ${bad.join(', ')} (known: ${DATASET_NAMES.join(', ')})`);
    datasetOverride = DATASET_NAMES.filter((d) => dsList.includes(d));
  }
  const appList = list(flags.app) ?? [...APP_IDS];
  const badApps = appList.filter((a) => !(APP_IDS as readonly string[]).includes(a));
  if (badApps.length) throw new UsageError(`unknown app(s): ${badApps.join(', ')} (known: ${APP_IDS.join(', ')})`);
  const apps = APP_IDS.filter((a) => appList.includes(a));
  const quietLoad = num(flags['quiet-load'], 'quiet-load', 0);
  const quietTimeoutSec = num(flags['quiet-timeout'], 'quiet-timeout', 600);

  const resumeId = typeof flags['run-id'] === 'string' ? flags['run-id'] : null;
  if (resumeId && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(resumeId)) throw new UsageError(`--run-id must be a plain directory name`);
  const runId = resumeId ?? makeRunId(profile);
  const runDir = runDirFor(ws, runId);
  const existing = fs.existsSync(path.join(runDir, 'run.json')) ? readRunInfo(runDir) : null;
  if (existing && existing.profile !== profile) {
    throw new UsageError(`run ${runId} was started with --profile ${existing.profile}; resume it with the same profile`);
  }
  if (existing?.status === 'running') {
    const pid = (existing.env as { harness?: { pid?: number } }).harness?.pid;
    if (pid && pid !== process.pid && isAlive(pid)) throw new UsageError(`run ${runId} is still running in pid ${pid}`);
  }

  const dirs = initRunDir(ws, runId);
  const log = ctx.log;
  log.setFile(path.join(dirs.logs, 'harness.log'));
  setDefaultLogDir(dirs.logs);
  log.info(`run ${runId}: profile ${profile}, suites ${suites.join(',')}, apps ${apps.join(',')}, datasets ${datasetOverride?.join(',') ?? '(profile default)'}`);
  installExitHandlers(log);
  // An idle Mac goes to system sleep (and turns the display off, which locks the screen) while a
  // run waits on timers: a 20 s window then lasts 15 minutes and the desktop windows are occluded.
  // caffeinate holds display, idle and system sleep assertions for as long as this process lives.
  const caffeinate = keepAwake(log);

  const procstat = await ProcStat.open({ bin: paths.procstatBin, log: log.child('procstat') });
  const invocationStart = localIso();
  let info: RunInfo;
  try {
    const env = await captureEnv({ paths, scratchHome: path.join(dirs.homes, 'env-probe'), v2Ref, log });
    const buildInfo = readJson<unknown>(paths.buildInfo);
    const inv = { argv: process.argv.slice(2), startedAt: invocationStart, status: 'running' as RunStatus, suites: [...suites], env: env as unknown as Record<string, unknown> };
    if (existing) {
      info = existing;
      info.status = 'running';
      info.suitesRequested = [...new Set([...info.suitesRequested, ...suites])];
      info.env = { ...(env as unknown as Record<string, unknown>) };
      info.invocations.push(inv);
      log.info(`resuming run ${runId} (${existing.invocations.length} earlier invocation(s))`);
    } else {
      info = {
        runId,
        profile,
        createdAt: invocationStart,
        updatedAt: invocationStart,
        status: 'running',
        suitesRequested: [...suites],
        datasets: datasetOverride ?? [...new Set([...PROFILES[profile].serverDatasets, ...PROFILES[profile].desktopDatasets, ...PROFILES[profile].cliDatasets])],
        apps,
        pins: { v1Ref: V1_REF, v1Sha: env.apps.v1.cloneSha ?? V1_SHA, v2Ref, v2Sha: env.apps.v2.cloneSha },
        env: env as unknown as Record<string, unknown>,
        buildInfo,
        options: { quietLoad, quietTimeoutSec, datasetOverride, apps, knobs: PROFILES[profile], keptAwake: caffeinate !== null },
        invocations: [inv],
      };
    }
    info.buildInfo = buildInfo;
    writeRunInfo(runDir, info);
    if (env.apps.v2.cloneSha && env.apps.v2.cloneSha !== v2Ref && !env.apps.v2.cloneSha.startsWith(v2Ref)) {
      log.warn(`V2 clone is at ${env.apps.v2.cloneSha}, not the pinned ${v2Ref}: run \`setup\` or pass --v2-ref`);
    }
    if (env.apps.v1.cloneSha && env.apps.v1.cloneSha !== V1_SHA) log.warn(`V1 clone is at ${env.apps.v1.cloneSha}, expected ${V1_SHA} (${V1_REF})`);
  } catch (e) {
    await procstat.close();
    throw e;
  }

  const markInterrupted = onInterrupt(() => {
    try {
      updateRunInfo(runDir, (i) => {
        i.status = 'interrupted';
        const last = i.invocations[i.invocations.length - 1];
        if (last) {
          last.status = 'interrupted';
          last.finishedAt = localIso();
        }
      });
    } catch {
      // Best effort while exiting.
    }
  });

  let statuses: Record<string, SuiteStatus> = {};
  let fatal: unknown = null;
  try {
    let adapters: AppAdapter[] = [];
    let adapterError: string | null = null;
    try {
      adapters = await loadAdapters(apps, { ws, paths, v2Ref, procstat, log: log.child('apps') });
    } catch (e) {
      adapterError = errorMessage(e);
      const needApps = suites.filter((s) => s !== 'size');
      if (needApps.length) log.error(`cannot build app adapters: ${adapterError}; suites ${needApps.join(', ')} will be recorded as skipped`);
    }
    const suiteCtx = createContext({ ws, paths, runId, runDir, profile, datasetOverride, apps: adapters, procstat, log, v2Ref });
    statuses = await runSuites(suiteCtx, { suites, quietLoad, quietTimeoutSec, adapterError });
  } catch (e) {
    fatal = e;
    log.error(`run aborted: ${errorText(e)}`);
  } finally {
    await stopAll(log);
    await procstat.close();
    markInterrupted();
    caffeinate?.kill('SIGTERM');
  }

  const final = updateRunInfo(runDir, (i) => {
    const all = i.suiteStatus ?? {};
    const done = i.suitesRequested.every((s) => all[s] === 'ok' || all[s] === 'failures');
    i.status = fatal ? 'failed' : done ? 'complete' : 'partial';
    const last = i.invocations[i.invocations.length - 1];
    if (last) {
      last.finishedAt = localIso();
      last.status = fatal ? 'failed' : Object.values(statuses).every((s) => s === 'ok' || s === 'failures') ? 'complete' : 'partial';
      last.suiteStatus = statuses;
    }
  });
  const summary = Object.entries(statuses)
    .map(([s, st]) => `${s}=${st}`)
    .join(' ');
  log.info(`run ${runId} ${final.status}: ${summary || '(no suites ran)'}`);
  log.info(`results in ${path.join(runDir, 'results')}`);
  if (fatal) return 1;
  return Object.values(statuses).every((s) => s === 'ok' || s === 'failures') ? 0 : 1;
}

/** `caffeinate -dims -w <this pid>`: no display, idle or system sleep while the run lives. */
function keepAwake(log: CommandContext['log']): ChildProcess | null {
  try {
    const c = spawn('/usr/bin/caffeinate', ['-d', '-i', '-m', '-s', '-w', String(process.pid)], { stdio: 'ignore' });
    c.on('error', (e) => log.warn(`caffeinate failed: ${errorMessage(e)}; the Mac may sleep during the run`));
    c.unref();
    if (c.pid) helperPids.add(c.pid);
    return c;
  } catch (e) {
    log.warn(`caffeinate failed: ${errorMessage(e)}; the Mac may sleep during the run`);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// doctor

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** Required for `run` to work at all (vs. only some suites). */
  required: boolean;
}

function exists(p: string): boolean {
  return fs.existsSync(p);
}

async function cmdDoctor(ctx: CommandContext): Promise<number> {
  const { paths, v2Ref, log } = ctx;
  // Inside the workspace (not $TMPDIR) so every file the harness makes stays in one place.
  fs.mkdirSync(paths.runs, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(paths.runs, '.doctor-'));
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string, required = false) => checks.push({ name, ok, detail, required });
  let env: EnvCapture | null = null;
  try {
    env = await captureEnv({ paths, scratchHome: path.join(scratch, 'home'), v2Ref, log });

    add('workspace', exists(paths.ws), paths.ws, true);
    const v1 = env.apps.v1;
    add('V1 clone', v1.cloneSha === V1_SHA, v1.cloneSha ? `${paths.v1Clone} @ ${v1.cloneSha.slice(0, 12)}${v1.cloneSha === V1_SHA ? ` (${V1_REF})` : ` (expected ${V1_SHA.slice(0, 12)})`}${v1.cloneDirty ? `, ${v1.cloneDirty} modified file(s)` : ''}` : `missing: ${paths.v1Clone}`);
    const v2 = env.apps.v2;
    const v2Match = !!v2.cloneSha && (v2.cloneSha === v2Ref || v2.cloneSha.startsWith(v2Ref));
    add('V2 clone', v2Match, v2.cloneSha ? `${paths.v2Clone} @ ${v2.cloneSha.slice(0, 12)}${v2Match ? '' : ` (expected ${v2Ref.slice(0, 12)})`}${v2.cloneDirty ? `, ${v2.cloneDirty} modified file(s)` : ''}` : `missing: ${paths.v2Clone}`);
    for (const b of v1.binaries) {
      if (!b.exists) {
        add(`V1 binary ${b.path}`, false, 'missing');
        continue;
      }
      const fw = b.frameworks.map((f) => `${f.name} ${f.version}`).join(', ') || 'frameworks unknown';
      add(`V1 binary ${b.path}`, b.version === '1.2.4', `${b.bytes?.toLocaleString('en-US')} B, Tendril ${b.version ?? '?'}${b.appBundleVersion ? `, app ${b.appBundleVersion}` : ''}, ${fw}${b.error ? `, error: ${b.error}` : ''}`);
    }
    add('V2 tendril binary', v2.binBytes !== null, v2.binBytes !== null ? `${paths.v2Bin} (${v2.binBytes.toLocaleString('en-US')} B, ${v2.version ?? 'version unknown'})` : `missing: ${paths.v2Bin}`);
    add('V2 dist', v2.distPresent, paths.v2Dist);
    add('V2 IPC shim', exists(paths.v2ShimBin), paths.v2ShimBin);
    try {
      await ensureProcstat(paths.procstatBin, log);
      const ps = await ProcStat.open({ bin: paths.procstatBin, log });
      const s = await ps.sample([process.pid]);
      await ps.close();
      add('procstat helper', s.procs[0]?.ok === true, `${paths.procstatBin} (sampled this node process: footprint ${((s.procs[0]?.phys_footprint ?? 0) / 1048576).toFixed(1)} MiB)`, true);
    } catch (e) {
      add('procstat helper', false, errorMessage(e), true);
    }
    add('build-info.json', exists(paths.buildInfo), paths.buildInfo);
    for (const d of DATASET_NAMES) {
      const v1d = path.join(paths.datasets, d, 'v1');
      const v2d = path.join(paths.datasets, d, 'v2');
      add(`dataset ${d}`, exists(v1d) && exists(v2d), `${exists(v1d) ? 'v1' : 'no v1'}, ${exists(v2d) ? 'v2' : 'no v2'} in ${path.join(paths.datasets, d)}`);
    }
    add('empty CLAUDE_CONFIG_DIR', !exists(paths.emptyClaudeConfig) || fs.readdirSync(paths.emptyClaudeConfig).length === 0, paths.emptyClaudeConfig, true);

    const pw = env.playwright;
    let chromiumPath: string | null = null;
    try {
      const { chromium } = (await import('playwright')) as typeof import('playwright');
      chromiumPath = chromium.executablePath();
    } catch {
      chromiumPath = null;
    }
    add('playwright', !!pw.version, pw.version ? `playwright ${pw.version}, chromium ${pw.chromium?.version ?? '?'} (r${pw.chromium?.revision ?? '?'}), headless shell r${pw.headlessShell?.revision ?? '?'}` : 'playwright not resolvable from the repo root', false);
    add('chromium executable', !!chromiumPath && exists(chromiumPath), chromiumPath ?? 'unknown');
    const headlessShellDir = pw.headlessShell ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright', `chromium_headless_shell-${pw.headlessShell.revision}`) : null;
    add('chromium headless shell', !!headlessShellDir && exists(headlessShellDir), headlessShellDir ?? 'unknown');

    const t = env.tools;
    const tool = (n: string, required = false) => add(`tool ${n}`, !!t[n], t[n]?.split('\n')[0] ?? 'not found', required);
    for (const n of ['node', 'cc']) tool(n, true);
    for (const n of ['pnpm', 'rustc', 'cargo', 'dotnet', 'git', 'gh', 'brotli', 'gzip']) tool(n);
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    add('node >= 26 (type stripping)', nodeMajor >= 26, process.version, true);
    try {
      const port = await freePort();
      add('free loopback port', true, `got ${port}`, true);
    } catch (e) {
      add('free loopback port', false, errorMessage(e), true);
    }
    const mp = await memoryFreePercent();
    const la = os.loadavg();
    add('machine quiet (1-min load < 2)', la[0]! < 2, `load ${la.map((x) => x.toFixed(2)).join(' ')}; memory free ${mp.freePercent ?? '?'}%`);
    add('on AC power', env.power.source === 'AC Power', env.power.source ?? 'unknown');
    add('no thermal warning', env.thermal.warning === false, env.thermal.warning === null ? 'unknown' : env.thermal.warning ? 'warning recorded' : 'none recorded');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  const requiredFailed = checks.filter((c) => c.required && !c.ok);
  if (ctx.flags.json) {
    process.stdout.write(`${JSON.stringify({ env, checks, ok: requiredFailed.length === 0 }, null, 2)}\n`);
  } else {
    const e = env!;
    const lines: string[] = [];
    lines.push('Environment');
    lines.push(`  machine   ${e.machine.model} / ${e.machine.cpu} / ${e.machine.logicalCpus} CPUs (${e.machine.perfCores ?? '?'}P + ${e.machine.efficiencyCores ?? '?'}E) / ${(e.machine.memBytes / 2 ** 30).toFixed(0)} GiB`);
    lines.push(`  os        ${e.os.productName} ${e.os.productVersion} (${e.os.buildVersion}), Darwin ${e.os.kernel}, ${e.os.arch}`);
    lines.push(`  power     ${e.power.source ?? 'unknown'}${e.power.lowPowerMode !== null ? `, lowpowermode ${e.power.lowPowerMode}` : ''}${e.power.powerMode !== null ? `, powermode ${e.power.powerMode}` : ''}`);
    lines.push(`  load      ${e.loadavg.map((x) => x.toFixed(2)).join(' ')}; memory free ${e.memoryPressure.freePercent ?? '?'}%`);
    lines.push(`  uptime    ${e.uptime ?? 'unknown'}`);
    lines.push(`  busiest   ${e.topProcesses.slice(0, 5).map((p) => `${path.basename(p.command)} ${p.cpu}%`).join(', ')}`);
    if (e.scrubbedVarsPresent.length) lines.push(`  scrubbed  ${e.scrubbedVarsPresent.join(', ')} (set in this shell; removed for every child)`);
    lines.push('');
    lines.push('Checks');
    const w = Math.max(...checks.map((c) => c.name.length));
    for (const c of checks) lines.push(`  ${c.ok ? 'ok  ' : c.required ? 'FAIL' : 'warn'}  ${c.name.padEnd(w)}  ${c.detail}`);
    lines.push('');
    lines.push(requiredFailed.length ? `${requiredFailed.length} required check(s) failed.` : 'All required checks passed.');
    process.stdout.write(`${lines.join('\n')}\n`);
  }
  return requiredFailed.length ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// clean

async function cmdClean(ctx: CommandContext): Promise<number> {
  const { flags, paths, log } = ctx;
  const doIt = flags.yes === true;
  const verb = doIt ? 'removing' : 'would remove';
  let acted = false;
  const runs = listRuns(paths.ws);
  const isRunning = (info: RunInfo | null) => {
    if (info?.status !== 'running') return false;
    const pid = (info.env as { harness?: { pid?: number } }).harness?.pid;
    return !!pid && isAlive(pid);
  };

  if (flags.homes) {
    acted = true;
    for (const r of runs) {
      const homes = path.join(r.dir, 'homes');
      if (!fs.existsSync(homes)) continue;
      if (isRunning(r.info)) {
        log.info(`skipping ${r.runId}: still running`);
        continue;
      }
      log.info(`${verb} ${homes}`);
      if (doIt) fs.rmSync(homes, { recursive: true, force: true });
    }
  }
  if (typeof flags.run === 'string') {
    acted = true;
    const r = runs.find((x) => x.runId === flags.run);
    if (!r) throw new UsageError(`no run ${flags.run} in ${paths.runs}`);
    if (isRunning(r.info)) throw new UsageError(`run ${r.runId} is still running`);
    log.info(`${verb} ${r.dir}`);
    if (doIt) fs.rmSync(r.dir, { recursive: true, force: true });
  }
  if (flags.tmp) {
    acted = true;
    const walk = (dir: string, depth: number) => {
      if (depth > 4 || !fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory() && e.name !== 'homes') walk(p, depth + 1);
        else if (e.isFile() && /\.tmp-\d+$/.test(e.name)) {
          log.info(`${verb} ${p}`);
          if (doIt) fs.rmSync(p, { force: true });
        }
      }
    };
    walk(paths.runs, 0);
    walk(paths.binDir, 0);
  }
  if (flags.leftovers) {
    acted = true;
    // Only processes whose command line points into this workspace: those are ours by construction.
    const { execFileSync } = await import('node:child_process');
    const ps = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const mine = new Set([process.pid, process.ppid]);
    const hits = ps
      .split('\n')
      .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
      .filter((m): m is RegExpMatchArray => !!m && !mine.has(Number(m[1])) && m[3]!.includes(paths.ws) && !m[3]!.includes('tendril-bench.ts'));
    if (!hits.length) log.info('no leftover processes reference the workspace');
    for (const m of hits) {
      log.info(`${doIt ? 'stopping' : 'would stop'} pid ${m[1]}: ${m[3]!.slice(0, 160)}`);
      if (doIt) {
        try {
          process.kill(Number(m[1]), 'SIGTERM');
        } catch {
          // Already gone.
        }
      }
    }
  }
  if (!acted) {
    process.stdout.write('clean: pick at least one of --homes, --run <id>, --tmp, --leftovers (add --yes to act)\n');
    return 2;
  }
  if (!doIt) log.info('dry run: pass --yes to act');
  return 0;
}

// ---------------------------------------------------------------------------------------------
// main

async function main(argv: string[]): Promise<number> {
  const command = argv[0];
  const rest = argv.slice(1);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return command ? 0 : 2;
  }
  const known = ['setup', 'datasets', 'run', 'report', 'doctor', 'clean'];
  if (!known.includes(command)) {
    process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
    return 2;
  }
  let flags: Flags;
  try {
    // Non-strict: delegated commands may define flags of their own.
    flags = parseArgs({ args: rest, options: OPTIONS, strict: false, allowPositionals: true }).values as Flags;
  } catch (e) {
    process.stderr.write(`${errorMessage(e)}\n`);
    return 2;
  }
  if (flags.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const log = createLogger({ level: flags.verbose ? 'debug' : undefined });
  try {
    const profileFlag = typeof flags.profile === 'string' ? flags.profile : 'full';
    if (!isProfileName(profileFlag)) throw new UsageError(`unknown profile ${profileFlag} (known: ${PROFILE_NAMES.join(', ')})`);
    const ws = path.resolve(typeof flags.workspace === 'string' ? flags.workspace : DEFAULT_WORKSPACE);
    const v2Ref = typeof flags['v2-ref'] === 'string' ? flags['v2-ref'] : V2_REF_DEFAULT;
    const ctx: CommandContext = { command, ws, paths: workspacePaths(ws), argv: rest, flags, profile: profileFlag, v2Ref, log };
    switch (command) {
      case 'run':
        return await cmdRun(ctx);
      case 'doctor':
        return await cmdDoctor(ctx);
      case 'clean':
        return await cmdClean(ctx);
      default:
        return await delegate(ctx);
    }
  } catch (e) {
    if (e instanceof UsageError || (e instanceof Error && /^unknown suite/.test(e.message))) {
      log.error(e.message);
      return 2;
    }
    log.error(errorText(e));
    return 1;
  }
}

// A forgotten socket or timer in some suite must not leave a finished run hanging: exit once the
// event loop has had a moment to flush (the timer is unref'd, so a clean loop exits sooner).
const finish = (code: number) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 2000).unref();
};
main(process.argv.slice(2)).then(finish, (e) => {
  process.stderr.write(`${errorText(e)}\n`);
  finish(1);
});
