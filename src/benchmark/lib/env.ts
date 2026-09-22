// What the machine and the software under test looked like when a run happened, plus load
// sampling and quiescing. Every probe is best-effort: a missing tool is recorded as null, never a
// crash, because an environment capture that aborts a two-hour run helps nobody.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { LOAD_SAMPLE_MS, REPO_ROOT, SCRUBBED_ENV_VARS, V1_REF, V1_SHA, V2_REF_DEFAULT, type WorkspacePaths } from './config.ts';
import { localIso, nullLogger, type Logger } from './log.ts';
import { cleanEnv, sleep } from './proc.ts';
import { parseSingleFileBundle, readBundleEntry } from './sizes.ts';

const execFileP = promisify(execFile);

/** stdout of a command, trimmed, or null if it is missing, fails or times out. */
async function out(cmd: string, args: string[] = [], opts: { timeoutMs?: number; env?: Record<string, string>; cwd?: string; allowFail?: boolean } = {}): Promise<string | null> {
  try {
    const r = await execFileP(cmd, args, { timeout: opts.timeoutMs ?? 15_000, env: opts.env ?? cleanEnv(), cwd: opts.cwd, maxBuffer: 16 * 1024 * 1024 });
    // Some tools (Apple gzip) print their version on stderr.
    return String(r.stdout).trim() || String(r.stderr).trim();
  } catch (e) {
    if (opts.allowFail) {
      const so = (e as { stdout?: unknown }).stdout;
      if (so) return String(so).trim();
    }
    return null;
  }
}

const firstLine = (s: string | null): string | null => (s ? (s.split('\n')[0] ?? '').trim() || null : null);

async function sysctl(key: string): Promise<string | null> {
  return out('/usr/sbin/sysctl', ['-n', key]);
}

// ---------------------------------------------------------------------------------------------
// Types

export interface V1BinaryInfo {
  path: string;
  exists: boolean;
  bytes: number | null;
  /** Tendril version from the bundle's deps.json (`Ivy.Tendril/<version>`). */
  version: string | null;
  /** Frameworks the self-contained bundle carries (from its runtimeconfig.json). */
  frameworks: Array<{ name: string; version: string }>;
  /** CFBundleShortVersionString when the binary sits inside a .app. */
  appBundleVersion: string | null;
  error?: string;
}

export interface EnvCapture {
  capturedAt: string;
  hostname: string;
  machine: {
    model: string | null;
    cpu: string | null;
    logicalCpus: number;
    physicalCpus: number | null;
    perfCores: number | null;
    efficiencyCores: number | null;
    memBytes: number;
    pageSize: number | null;
  };
  os: { productName: string | null; productVersion: string | null; buildVersion: string | null; kernel: string; arch: string };
  power: { source: string | null; raw: string | null; lowPowerMode: string | null; powerMode: string | null };
  thermal: { warning: boolean | null; raw: string | null };
  loadavg: number[];
  uptime: string | null;
  memoryPressure: { freePercent: number | null; raw: string | null };
  /** Busiest processes at capture time, to explain noise in the report. */
  topProcesses: Array<{ pid: number; cpu: number; rssKiB: number; command: string }>;
  tools: Record<string, string | null>;
  playwright: { version: string | null; chromium: { revision: string; version: string } | null; headlessShell: { revision: string; version: string } | null };
  apps: {
    v1: { ref: string; expectedSha: string; cloneSha: string | null; cloneDirty: number | null; binaries: V1BinaryInfo[] };
    v2: { ref: string; cloneSha: string | null; cloneDirty: number | null; bin: string; binBytes: number | null; version: string | null; distPresent: boolean };
  };
  harness: { node: string; pid: number; argv: string[]; benchSha: string | null; benchDirty: number | null };
  /** Env vars of this process that the scrubber removes from children, recorded as present/absent only. */
  scrubbedVarsPresent: string[];
}

// ---------------------------------------------------------------------------------------------
// Probes

function readPlaywright(): EnvCapture['playwright'] {
  const res: EnvCapture['playwright'] = { version: null, chromium: null, headlessShell: null };
  try {
    const req = createRequire(path.join(REPO_ROOT, 'package.json'));
    const pkgPath = req.resolve('playwright/package.json');
    res.version = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string }).version;
    // pnpm lays playwright-core next to playwright; its browsers.json pins the browser builds.
    const real = fs.realpathSync(path.dirname(pkgPath));
    const browsersJson = path.join(path.dirname(real), 'playwright-core', 'browsers.json');
    const b = JSON.parse(fs.readFileSync(browsersJson, 'utf8')) as { browsers: Array<{ name: string; revision: string; browserVersion?: string }> };
    const pick = (n: string) => {
      const e = b.browsers.find((x) => x.name === n);
      return e ? { revision: e.revision, version: e.browserVersion ?? 'unknown' } : null;
    };
    res.chromium = pick('chromium');
    res.headlessShell = pick('chromium-headless-shell');
  } catch {
    // Leave nulls: doctor reports them as missing.
  }
  return res;
}

async function gitInfo(dir: string): Promise<{ sha: string | null; dirty: number | null }> {
  if (!fs.existsSync(path.join(dir, '.git'))) return { sha: null, dirty: null };
  const sha = await out('git', ['-C', dir, 'rev-parse', 'HEAD']);
  const st = await out('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=no']);
  return { sha, dirty: st === null ? null : st.split('\n').filter(Boolean).length };
}

/** Version and bundled runtime of a V1 single-file binary, read from the bundle (never executed). */
export async function v1BinaryInfo(bin: string): Promise<V1BinaryInfo> {
  const info: V1BinaryInfo = { path: bin, exists: fs.existsSync(bin), bytes: null, version: null, frameworks: [], appBundleVersion: null };
  if (!info.exists) return info;
  try {
    info.bytes = fs.statSync(bin).size;
    const m = parseSingleFileBundle(bin);
    const deps = m.entries.find((e) => e.type === 'DepsJson');
    if (deps) {
      const j = JSON.parse(readBundleEntry(m, deps).toString('utf8')) as { targets?: Record<string, Record<string, unknown>> };
      for (const t of Object.values(j.targets ?? {})) {
        const k = Object.keys(t).find((x) => x.startsWith('Ivy.Tendril/'));
        if (k) {
          info.version = k.slice('Ivy.Tendril/'.length);
          break;
        }
      }
    }
    const rc = m.entries.find((e) => e.type === 'RuntimeConfigJson');
    if (rc) {
      const j = JSON.parse(readBundleEntry(m, rc).toString('utf8')) as {
        runtimeOptions?: { includedFrameworks?: Array<{ name: string; version: string }>; framework?: { name: string; version: string }; frameworks?: Array<{ name: string; version: string }> };
      };
      const ro = j.runtimeOptions ?? {};
      info.frameworks = ro.includedFrameworks ?? ro.frameworks ?? (ro.framework ? [ro.framework] : []);
    }
  } catch (e) {
    info.error = (e as Error).message;
  }
  const appMatch = bin.match(/^(.*\.app)\/Contents\/MacOS\/[^/]+$/);
  if (appMatch) {
    info.appBundleVersion = await out('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(appMatch[1]!, 'Contents', 'Info.plist')]);
  }
  return info;
}

/** Candidate V1 binaries: the self-built publish, the expanded release pkg, the installed app. */
export function v1BinaryCandidates(paths: WorkspacePaths): string[] {
  const found = new Set<string>([paths.v1PublishBin]);
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || !fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) walk(p, depth + 1);
      else if (e.isFile() && e.name === 'Ivy.Tendril' && p.includes('.app/Contents/MacOS/')) found.add(p);
    }
  };
  try {
    walk(paths.artifactsV1, 0);
  } catch {
    // Unreadable artifact dirs just yield fewer candidates.
  }
  found.add('/Applications/Ivy Tendril.app/Contents/MacOS/Ivy.Tendril');
  return [...found];
}

async function topProcesses(n = 12): Promise<EnvCapture['topProcesses']> {
  const s = await out('/bin/ps', ['-Ao', 'pid=,pcpu=,rss=,comm=', '-r']);
  if (!s) return [];
  return s
    .split('\n')
    .slice(0, n)
    .map((l) => {
      const m = l.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
      return m ? { pid: Number(m[1]), cpu: Number(m[2]), rssKiB: Number(m[3]), command: m[4]! } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

export async function memoryFreePercent(): Promise<{ freePercent: number | null; raw: string | null }> {
  const raw = await out('/usr/bin/memory_pressure', ['-Q']);
  const m = raw?.match(/free percentage:\s*(\d+)%/);
  return { freePercent: m ? Number(m[1]) : null, raw };
}

/**
 * Snapshot of machine, OS, power, load and every tool/app version that matters. `scratchHome` is an
 * isolated TENDRIL_HOME for the one app command it runs (`tendril --version`).
 */
export async function captureEnv(opts: { paths: WorkspacePaths; scratchHome: string; v2Ref?: string; log?: Logger }): Promise<EnvCapture> {
  const log = opts.log ?? nullLogger;
  const { paths } = opts;
  fs.mkdirSync(opts.scratchHome, { recursive: true });

  const [model, cpu, physical, perf, eff, pageSize] = await Promise.all([
    sysctl('hw.model'),
    sysctl('machdep.cpu.brand_string'),
    sysctl('hw.physicalcpu'),
    sysctl('hw.perflevel0.physicalcpu'),
    sysctl('hw.perflevel1.physicalcpu'),
    sysctl('hw.pagesize'),
  ]);
  const swVers = await out('/usr/bin/sw_vers');
  const sw = (k: string) => swVers?.match(new RegExp(`${k}:\\s*(.+)`))?.[1]?.trim() ?? null;
  const batt = await out('/usr/bin/pmset', ['-g', 'batt']);
  const pmset = await out('/usr/bin/pmset', ['-g']);
  const therm = await out('/usr/bin/pmset', ['-g', 'therm']);
  const pmKey = (k: string) => pmset?.match(new RegExp(`^\\s*${k}\\s+(\\S+)`, 'm'))?.[1] ?? null;

  const tools: Record<string, string | null> = {
    node: process.version,
    pnpm: await out('pnpm', ['--version'], { cwd: REPO_ROOT }),
    rustc: await out('rustc', ['-V'], { cwd: paths.v2Clone && fs.existsSync(paths.v2Clone) ? paths.v2Clone : undefined }),
    cargo: await out('cargo', ['-V'], { cwd: paths.v2Clone && fs.existsSync(paths.v2Clone) ? paths.v2Clone : undefined }),
    dotnet: await out('dotnet', ['--version']),
    dotnetRuntimes: await out('dotnet', ['--list-runtimes']),
    git: await out('git', ['--version']),
    cc: firstLine(await out('cc', ['--version'])),
    gh: firstLine(await out('gh', ['--version'])),
    brotli: await out('brotli', ['--version']),
    gzip: firstLine(await out('gzip', ['--version'])),
    xcodeSelect: await out('xcode-select', ['-p']),
  };

  const v1Git = await gitInfo(paths.v1Clone);
  const v2Git = await gitInfo(paths.v2Clone);
  const v1Bins = await Promise.all(v1BinaryCandidates(paths).map(v1BinaryInfo));
  let v2Version: string | null = null;
  if (fs.existsSync(paths.v2Bin)) {
    // clap answers --version before touching the home, but the home is isolated regardless.
    v2Version = await out(paths.v2Bin, ['--home', opts.scratchHome, '--version'], {
      env: cleanEnv({ TENDRIL_HOME: opts.scratchHome }),
      cwd: opts.scratchHome,
    });
    if (!v2Version) v2Version = await out(paths.v2Bin, ['--version'], { env: cleanEnv({ TENDRIL_HOME: opts.scratchHome }), cwd: opts.scratchHome });
  }
  const bench = await gitInfo(REPO_ROOT).catch(() => ({ sha: null, dirty: null }));
  const benchStatus = await out('git', ['-C', REPO_ROOT, 'status', '--porcelain', '--', 'src/benchmark']);

  const env: EnvCapture = {
    capturedAt: localIso(),
    hostname: os.hostname(),
    machine: {
      model,
      cpu,
      logicalCpus: os.cpus().length,
      physicalCpus: physical ? Number(physical) : null,
      perfCores: perf ? Number(perf) : null,
      efficiencyCores: eff ? Number(eff) : null,
      memBytes: os.totalmem(),
      pageSize: pageSize ? Number(pageSize) : null,
    },
    os: { productName: sw('ProductName'), productVersion: sw('ProductVersion'), buildVersion: sw('BuildVersion'), kernel: os.release(), arch: os.arch() },
    power: {
      source: batt?.match(/drawing from '([^']+)'/)?.[1] ?? null,
      raw: batt,
      lowPowerMode: pmKey('lowpowermode'),
      powerMode: pmKey('powermode'),
    },
    thermal: {
      warning: therm === null ? null : !/No thermal warning level has been recorded/.test(therm),
      raw: therm,
    },
    loadavg: os.loadavg(),
    uptime: await out('/usr/bin/uptime'),
    memoryPressure: await memoryFreePercent(),
    topProcesses: await topProcesses(),
    tools,
    playwright: readPlaywright(),
    apps: {
      v1: { ref: V1_REF, expectedSha: V1_SHA, cloneSha: v1Git.sha, cloneDirty: v1Git.dirty, binaries: v1Bins },
      v2: {
        ref: opts.v2Ref ?? V2_REF_DEFAULT,
        cloneSha: v2Git.sha,
        cloneDirty: v2Git.dirty,
        bin: paths.v2Bin,
        binBytes: fs.existsSync(paths.v2Bin) ? fs.statSync(paths.v2Bin).size : null,
        version: v2Version,
        distPresent: fs.existsSync(path.join(paths.v2Dist, 'index.html')),
      },
    },
    harness: {
      node: process.version,
      pid: process.pid,
      argv: process.argv.slice(2),
      benchSha: bench.sha,
      benchDirty: benchStatus === null ? null : benchStatus.split('\n').filter(Boolean).length,
    },
    scrubbedVarsPresent: Object.keys(process.env).filter((k) => SCRUBBED_ENV_VARS.includes(k)),
  };
  log.debug(`environment captured: ${env.machine.model} ${env.os.productVersion} load ${env.loadavg.map((x) => x.toFixed(2)).join(' ')}`);
  return env;
}

// ---------------------------------------------------------------------------------------------
// Load

export interface LoadSampler {
  readonly samples: number[];
  /** Stops sampling (taking one final sample) and returns the 1-minute loadavg samples. */
  stop(): number[];
}

/** Records the 1-minute load average every `intervalMs` (default 5 s) until stopped. */
export function loadSampler(intervalMs: number = LOAD_SAMPLE_MS): LoadSampler {
  const samples: number[] = [os.loadavg()[0]!];
  const timer = setInterval(() => samples.push(os.loadavg()[0]!), intervalMs);
  timer.unref();
  let stopped = false;
  return {
    samples,
    stop() {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
        samples.push(os.loadavg()[0]!);
      }
      return samples.slice();
    },
  };
}

export interface QuiesceResult {
  reached: boolean;
  waitedMs: number;
  loadavg: number[];
}

/**
 * Waits (up to `timeoutSec`) until the 1-minute load average drops below `threshold`. The 1-minute
 * figure is an exponentially damped average, so a burst that just ended still takes a minute or so
 * to decay; the wait is recorded either way.
 */
export async function quiesce(threshold: number, timeoutSec: number, log: Logger = nullLogger): Promise<QuiesceResult> {
  const t0 = Date.now();
  if (!(threshold > 0)) return { reached: true, waitedMs: 0, loadavg: os.loadavg() };
  let announced = false;
  for (;;) {
    const la = os.loadavg();
    if (la[0]! < threshold) {
      if (announced) log.info(`load settled at ${la[0]!.toFixed(2)} after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      return { reached: true, waitedMs: Date.now() - t0, loadavg: la };
    }
    if (Date.now() - t0 >= timeoutSec * 1000) {
      log.warn(`load still ${la[0]!.toFixed(2)} (>= ${threshold}) after ${timeoutSec} s; continuing anyway`);
      return { reached: false, waitedMs: Date.now() - t0, loadavg: la };
    }
    if (!announced) {
      log.info(`waiting for 1-min load ${la[0]!.toFixed(2)} to drop below ${threshold} (up to ${timeoutSec} s)`);
      announced = true;
    }
    // The kernel updates loadavg every 5 s; never sleep past the deadline.
    await sleep(Math.max(100, Math.min(5000, timeoutSec * 1000 - (Date.now() - t0))));
  }
}
