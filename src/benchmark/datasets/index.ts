// Dataset templates: build them once per workspace (`tendril-bench datasets`), restore a pristine
// copy before every server start (restoreHome).
//
// Layout under <ws>/datasets:
//   repos/<project>/            fixture git repos referenced by every dataset's config.yaml
//   <name>/v1/  <name>/v2/      template homes: shared config.yaml + Plans/, plus that app's own
//                               migrated tendril.db holding the same job rows
//   <name>/manifest.json        counts, content hashes, ids suites can rely on (see DatasetManifest)
//
// Each app gets its own template because each creates its DB with its own migrate command (V1's
// v25 schema vs V2's v25 plus nullable extras) and because a live home must never be shared: both
// apps rewrite files on startup. The shared part is verified byte-and-mtime identical in both.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createAdapters } from '../apps/index.ts';
import type { AppAdapter } from '../apps/types.ts';
import {
  DATASET_NAMES,
  DATASETS,
  PLAN_STATES,
  REAL_TENDRIL_HOME,
  isDatasetName,
  type CommandContext,
  type DatasetName,
  type DatasetSpec,
  type PlanState,
  type WorkspacePaths,
} from '../lib/config.ts';
import { errorMessage, localIso, nullLogger, type Logger } from '../lib/log.ts';
import { installExitHandlers, run, stopAll } from '../lib/proc.ts';
import { ProcStat } from '../lib/procstat.ts';
import { APP_IDS, type AppId } from '../lib/results.ts';
import {
  GENERATOR_VERSION,
  dbFacts,
  ensureRepos,
  hashTree,
  insertJobs,
  planJobs,
  projectNames,
  sha256,
  sharedContent,
  writeTemplate,
  type DbFacts,
  type PlanRecord,
  type TreeHash,
} from './generate.ts';

// ---------------------------------------------------------------------------------------------
// Manifest

export interface AppTemplateInfo {
  /** Absolute template home (restore copies from here). */
  home: string;
  /** Binary that ran the migrate, and its size/mtime then (restoreHome warns when it changes). */
  bin: string;
  binBytes: number | null;
  binMtimeMs: number | null;
  migrateMs: number;
  db: DbFacts;
  /** Whole template (every file, with mtimes). */
  tree: TreeHash;
  /** Entries the migrate created that are not part of the template (the app recreates them). */
  pruned: string[];
}

export interface DatasetManifest {
  name: DatasetName;
  generatorVersion: number;
  /** Hash of everything the template depends on; a mismatch means `datasets` rebuilds it. */
  fingerprint: string;
  builtAt: string;
  buildMs: number;
  spec: DatasetSpec;
  reposDir: string;
  repos: Record<string, string>;
  counts: {
    plans: number;
    jobs: number;
    projects: number;
    revisions: number;
    byState: Record<PlanState, number>;
    /** What both apps' Plans nav badge shows: Draft + Blocked (no Blocked plans are generated). */
    plansQueue: number;
    /** What both apps' Review nav badge shows: Review + Failed. */
    reviewQueue: number;
    jobStatuses: Record<string, number>;
  };
  /** config.yaml + Plans/**, identical (bytes and mtimes) in the v1 and v2 templates. */
  shared: TreeHash;
  /** sha256 of the job rows inserted into both DBs. */
  jobsSha256: string;
  ids: {
    firstPlanId: string | null;
    lastPlanId: string | null;
    /**
     * The Draft both UIs open on their own when the Plans page loads (the highest-id Draft: V1
     * PlanSelectionHelper and V2 resolvePlanSelection both take the first of an id-descending queue).
     */
    autoOpenedDraftId: string | null;
    /** Draft plans safe to toggle for push tests: every Draft except the auto-opened one, highest id first. */
    pushTargets: string[];
    /** A Draft near the middle of the id range, for `plans.update` (also in pushTargets). */
    updatePlanId: string | null;
    /** The plan nearest the middle of the id range, for `plans.get`. */
    getPlanId: string | null;
    /** The most recent job: always within V1's in-memory window of the newest 100 jobs. */
    jobId: string | null;
    firstJobId: string | null;
    lastJobId: string | null;
  };
  /** One row per plan: [id, state, folder]. */
  plans: Array<[string, PlanState, string]>;
  apps: Record<AppId, AppTemplateInfo>;
}

export function datasetDir(paths: WorkspacePaths, name: DatasetName): string {
  return path.join(paths.datasets, name);
}

export function templateHome(paths: WorkspacePaths, name: DatasetName, app: AppId): string {
  return path.join(datasetDir(paths, name), app);
}

export function reposDir(paths: WorkspacePaths): string {
  return path.join(paths.datasets, 'repos');
}

export function manifestPath(paths: WorkspacePaths, name: DatasetName): string {
  return path.join(datasetDir(paths, name), 'manifest.json');
}

export function loadManifest(paths: WorkspacePaths, name: DatasetName): DatasetManifest | null {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(paths, name), 'utf8')) as DatasetManifest;
  } catch {
    return null;
  }
}

/** The manifest, or an error telling the user to build the datasets. */
export function requireManifest(paths: WorkspacePaths, name: DatasetName): DatasetManifest {
  const m = loadManifest(paths, name);
  if (!m) throw new Error(`dataset ${name} is not built (${manifestPath(paths, name)} missing): run \`node src/benchmark/bin/tendril-bench.ts datasets\``);
  return m;
}

/**
 * Why a template may no longer match the binaries on disk (null when it does). The schema a migrate
 * creates only changes with the app's migrations, so this is a warning, not an error.
 */
export function staleReason(m: DatasetManifest, app: AppId): string | null {
  const a = m.apps[app];
  if (!a) return 'manifest has no entry for this app';
  if (m.generatorVersion !== GENERATOR_VERSION) return `built by generator v${m.generatorVersion}, current is v${GENERATOR_VERSION}`;
  if (a.binBytes == null || a.binMtimeMs == null) return null;
  try {
    const st = fs.statSync(a.bin);
    if (st.size !== a.binBytes || Math.round(st.mtimeMs) !== a.binMtimeMs) return `migrated by ${a.bin} as it was at ${new Date(a.binMtimeMs).toISOString()}; it has been rebuilt since`;
  } catch {
    return `${a.bin} no longer exists`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Restore

export interface RestoredHome {
  home: string;
  dataset: DatasetName;
  app: AppId;
  manifest: DatasetManifest;
  ms: number;
}

/**
 * Files an app writes at runtime that must not carry over into the next start: the master claim
 * (V2 refuses a foreign one, V1 turns non-master), the Tauri host's persisted UI state, V1's config
 * backup, and V2's managed-service log.
 */
export const RESET_FILES = ['.master', 'ui_state.json', 'config.yaml.backup', path.join('Logs', 'service.log')];

/**
 * Exact copy of a directory tree with every mtime kept (V2's incremental sync and watcher order
 * depend on them). `cp -c` makes APFS clones: near-instant, byte-identical, and with no dirty pages
 * left to be written back while the app under test starts. macOS's rsync (openrsync) was not used
 * because it truncates mtimes to whole seconds.
 */
export async function copyTree(src: string, dst: string): Promise<void> {
  if (fs.existsSync(dst)) throw new Error(`copyTree: ${dst} already exists`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  await run('/bin/cp', ['-c', '-R', '-p', src, dst], { timeoutMs: 600_000 });
}

/**
 * Reads every file once so a restored home starts from a warm page cache. Clones share blocks
 * with the template but not its cached pages, so without this the first start of each app would
 * also measure however much of the tree the disk cache happened to hold.
 */
export function warmTree(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const buf = Buffer.allocUnsafe(1 << 20);
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const fd = fs.openSync(p, 'r');
        try {
          let n: number;
          while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) bytes += n;
        } finally {
          fs.closeSync(fd);
        }
        files++;
      }
    }
  };
  walk(dir);
  return { files, bytes };
}

/**
 * Where desktop-run homes go: outside every privacy-protected folder (the workspace is on
 * ~/Desktop). A desktop app launched through LaunchServices needs the user's consent to read
 * ~/Desktop, and the V2 Tendril.app blocks on that prompt (see apps/common.ts tccProtectedRoot).
 * One directory per run; delete it with removeDesktopHomes when the suite is done.
 */
export function desktopHomesRoot(runDir: string): string {
  return path.join(os.homedir(), 'Library', 'Caches', 'tendril-benchmark', path.basename(path.resolve(runDir)), 'homes');
}

/** Deletes a run's desktop homes (and the per-run directory above them). */
export function removeDesktopHomes(runDir: string): void {
  fs.rmSync(path.dirname(desktopHomesRoot(runDir)), { recursive: true, force: true });
}

/**
 * A pristine copy of `<ws>/datasets/<dataset>/<app>` at `<runDir>/homes/<app>-<dataset>[-<suffix>]`
 * (or under `homesRoot`, which desktop runs need: see desktopHomesRoot). The previous copy is
 * deleted first rather than synced over, so nothing an app wrote can survive into the next
 * measurement. Every mtime is kept and the files are pre-read (see copyTree, warmTree). Only call
 * this with the app stopped.
 */
export async function restoreHome(o: { paths: WorkspacePaths; dataset: DatasetName; app: AppId; runDir: string; homesRoot?: string; suffix?: string; warm?: boolean; log?: Logger }): Promise<RestoredHome> {
  const t0 = performance.now();
  const manifest = requireManifest(o.paths, o.dataset);
  const src = templateHome(o.paths, o.dataset, o.app);
  if (!fs.existsSync(path.join(src, 'config.yaml'))) throw new Error(`template ${src} is incomplete: rebuild with \`datasets --force --dataset ${o.dataset}\``);
  const stale = staleReason(manifest, o.app);
  if (stale) (o.log ?? nullLogger).warn(`dataset ${o.dataset}/${o.app}: ${stale}; run \`datasets\` to rebuild it`);
  const homesDir = path.resolve(o.homesRoot ?? path.join(o.runDir, 'homes'));
  const name = `${o.app}-${o.dataset}${o.suffix ? `-${o.suffix.replace(/[^A-Za-z0-9_.-]/g, '_')}` : ''}`;
  const home = path.join(homesDir, name);
  if (path.dirname(home) !== homesDir || path.resolve(home) === path.resolve(REAL_TENDRIL_HOME)) throw new Error(`refusing to restore into ${home}`);
  fs.mkdirSync(homesDir, { recursive: true });
  fs.rmSync(home, { recursive: true, force: true });
  await copyTree(src, home);
  for (const f of RESET_FILES) fs.rmSync(path.join(home, f), { force: true });
  if (o.warm ?? true) warmTree(home);
  const ms = performance.now() - t0;
  (o.log ?? nullLogger).debug(`restored ${o.app}/${o.dataset} -> ${home} in ${ms.toFixed(0)} ms`);
  return { home, dataset: o.dataset, app: o.app, manifest, ms };
}

// ---------------------------------------------------------------------------------------------
// Build

function fileFingerprint(p: string): string {
  try {
    const st = fs.statSync(p);
    return `${p}:${st.size}:${Math.round(st.mtimeMs)}`;
  } catch {
    return `${p}:missing`;
  }
}

function fingerprintOf(spec: DatasetSpec, paths: WorkspacePaths, adapters: AppAdapter[]): string {
  const bins = adapters.map((a) => `${a.id}=${fileFingerprint(a.cli.bin)}`);
  return sha256(JSON.stringify({ generatorVersion: GENERATOR_VERSION, spec, repos: reposDir(paths), bins }));
}

function selectIds(plans: readonly PlanRecord[], jobIds: readonly string[]): DatasetManifest['ids'] {
  const drafts = plans.filter((p) => p.state === 'Draft').sort((a, b) => b.n - a.n);
  const auto = drafts[0] ?? null;
  const pushTargets = drafts.slice(1).map((p) => p.id);
  const mid = plans.length ? plans[Math.floor((plans.length - 1) / 2)]! : null;
  const midN = mid?.n ?? 0;
  const update = drafts
    .slice(1)
    .slice()
    .sort((a, b) => Math.abs(a.n - midN) - Math.abs(b.n - midN) || a.n - b.n)[0];
  return {
    firstPlanId: plans[0]?.id ?? null,
    lastPlanId: plans.at(-1)?.id ?? null,
    autoOpenedDraftId: auto?.id ?? null,
    pushTargets,
    updatePlanId: update?.id ?? null,
    getPlanId: mid?.id ?? null,
    jobId: jobIds.at(-1) ?? null,
    firstJobId: jobIds[0] ?? null,
    lastJobId: jobIds.at(-1) ?? null,
  };
}

/** Everything in a freshly migrated template that is neither shared content nor the database. */
const KEEP_TOP = new Set(['config.yaml', 'Plans', 'tendril.db', 'Jobs']);

function prune(home: string): string[] {
  const pruned: string[] = [];
  for (const e of fs.readdirSync(home)) {
    if (KEEP_TOP.has(e)) continue;
    pruned.push(e);
    fs.rmSync(path.join(home, e), { recursive: true, force: true });
  }
  return pruned.sort();
}

export interface BuildOptions {
  paths: WorkspacePaths;
  name: DatasetName;
  adapters: AppAdapter[];
  force?: boolean;
  log: Logger;
}

export type BuildOutcome = { status: 'built' | 'up-to-date'; manifest: DatasetManifest };

/**
 * Builds one dataset into a scratch directory next to the final one and swaps it in with renames,
 * so a reader never sees a half-built template. Up to date (same fingerprint, same shared hash on
 * disk) means nothing is rebuilt unless `force`.
 */
export async function buildDataset(o: BuildOptions): Promise<BuildOutcome> {
  const { paths, name, log } = o;
  const spec = DATASETS[name];
  const byId = new Map(o.adapters.map((a) => [a.id, a]));
  for (const id of APP_IDS) if (!byId.has(id)) throw new Error(`building dataset ${name} needs the ${id} adapter`);
  const fingerprint = fingerprintOf(spec, paths, o.adapters);
  const finalDir = datasetDir(paths, name);

  const existing = loadManifest(paths, name);
  if (existing && !o.force && existing.fingerprint === fingerprint) {
    const stale = APP_IDS.filter((id) => {
      const home = templateHome(paths, name, id);
      return !fs.existsSync(path.join(home, 'tendril.db')) || hashTree(home, sharedContent).withTimes !== existing.shared.withTimes;
    });
    if (!stale.length) return { status: 'up-to-date', manifest: existing };
    log.warn(`dataset ${name}: template(s) ${stale.join(', ')} no longer match the manifest; rebuilding`);
  }

  const t0 = performance.now();
  fs.mkdirSync(paths.datasets, { recursive: true });
  const buildDir = path.join(paths.datasets, `.build-${name}-${process.pid}`);
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  try {
    const repos = await ensureRepos(reposDir(paths), projectNames(spec));
    const tpl = path.join(buildDir, 'template');
    const tw = performance.now();
    const t = writeTemplate(tpl, spec, repos);
    const shared = hashTree(tpl, sharedContent);
    log.info(`dataset ${name}: wrote ${t.plans.length} plans (${shared.files} files, ${(shared.bytes / 1e6).toFixed(1)} MB) in ${((performance.now() - tw) / 1000).toFixed(1)} s`);
    const rows = planJobs(spec, t.plans);

    const apps = {} as Record<AppId, AppTemplateInfo>;
    for (const id of APP_IDS) {
      const adapter = byId.get(id)!;
      const home = path.join(buildDir, id);
      await copyTree(tpl, home);
      const tm = performance.now();
      await adapter.migrate(home);
      const migrateMs = performance.now() - tm;
      // The migrate must leave the shared part alone; if an app rewrote a plan or config.yaml the two
      // templates would differ and every comparison built on them would be unfair.
      const after = hashTree(home, sharedContent);
      if (after.withTimes !== shared.withTimes) {
        throw new Error(`${id} migrate modified config.yaml or Plans/ in ${home} (content ${after.content === shared.content ? 'same' : 'changed'}, mtimes changed)`);
      }
      const pruned = prune(home);
      insertJobs(home, rows);
      const db = dbFacts(home);
      if (db.jobs !== rows.length) throw new Error(`${id} template DB has ${db.jobs} jobs, expected ${rows.length}`);
      if (db.plans !== 0) throw new Error(`${id} template DB already holds ${db.plans} plan rows; the first start must do the full sync`);
      if (!db.tables.includes('Jobs')) throw new Error(`${id} migrate did not create the Jobs table`);
      // After a TRUNCATE checkpoint and close SQLite normally deletes these; a non-empty WAL would
      // hold committed pages, so it is an error rather than something to delete.
      const wal = path.join(home, 'tendril.db-wal');
      if (fs.existsSync(wal) && fs.statSync(wal).size > 0) throw new Error(`${wal} is not empty after the checkpoint`);
      for (const junk of ['tendril.db-wal', 'tendril.db-shm']) fs.rmSync(path.join(home, junk), { force: true });
      const binStat = fs.statSync(adapter.cli.bin);
      apps[id] = { home: templateHome(paths, name, id), bin: adapter.cli.bin, binBytes: binStat.size, binMtimeMs: Math.round(binStat.mtimeMs), migrateMs: Math.round(migrateMs), db, tree: hashTree(home), pruned };
      log.info(`dataset ${name}: ${id} migrated in ${(migrateMs / 1000).toFixed(1)} s (user_version ${db.userVersion}, ${db.jobs} jobs${pruned.length ? `, pruned ${pruned.join(' ')}` : ''})`);
    }
    fs.rmSync(tpl, { recursive: true, force: true });
    if (apps.v1.db.userVersion !== apps.v2.db.userVersion) {
      log.warn(`dataset ${name}: schema user_version differs (v1 ${apps.v1.db.userVersion}, v2 ${apps.v2.db.userVersion})`);
    }

    const byState = Object.fromEntries(PLAN_STATES.map((s) => [s, t.plans.filter((p) => p.state === s).length])) as Record<PlanState, number>;
    const jobStatuses: Record<string, number> = {};
    for (const r of rows) jobStatuses[r.Status] = (jobStatuses[r.Status] ?? 0) + 1;
    const manifest: DatasetManifest = {
      name,
      generatorVersion: GENERATOR_VERSION,
      fingerprint,
      builtAt: localIso(),
      buildMs: 0,
      spec,
      reposDir: reposDir(paths),
      repos,
      counts: {
        plans: t.plans.length,
        jobs: rows.length,
        projects: t.projects.length,
        revisions: t.plans.length * spec.revisionsPerPlan,
        byState,
        plansQueue: byState.Draft,
        reviewQueue: byState.Review + byState.Failed,
        jobStatuses,
      },
      shared,
      jobsSha256: sha256(JSON.stringify(rows)),
      ids: selectIds(t.plans, rows.map((r) => r.Id)),
      plans: t.plans.map((p) => [p.id, p.state, p.folder]),
      apps,
    };
    manifest.buildMs = Math.round(performance.now() - t0);
    fs.writeFileSync(path.join(buildDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    // Swap: old -> trash, build -> final, then delete the trash.
    const trash = path.join(paths.datasets, `.old-${name}-${process.pid}`);
    fs.rmSync(trash, { recursive: true, force: true });
    if (fs.existsSync(finalDir)) fs.renameSync(finalDir, trash);
    fs.renameSync(buildDir, finalDir);
    fs.rmSync(trash, { recursive: true, force: true });
    return { status: 'built', manifest };
  } catch (e) {
    fs.rmSync(buildDir, { recursive: true, force: true });
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// `datasets` command

function parseList(v: string | boolean | undefined): string[] | null {
  if (typeof v !== 'string') return null;
  const xs = v.split(',').map((s) => s.trim()).filter(Boolean);
  return xs.length ? xs : null;
}

export async function main(ctx: CommandContext): Promise<number> {
  const { paths, log } = ctx;
  const requested = parseList(ctx.flags.dataset) ?? [...DATASET_NAMES];
  const bad = requested.filter((d) => !isDatasetName(d));
  if (bad.length) {
    log.error(`unknown dataset(s): ${bad.join(', ')} (known: ${DATASET_NAMES.join(', ')})`);
    return 2;
  }
  const names = DATASET_NAMES.filter((d) => requested.includes(d));
  const force = ctx.flags.force === true;
  installExitHandlers(log);
  fs.mkdirSync(paths.logs, { recursive: true });
  log.setFile(path.join(paths.logs, 'datasets.log'));

  const procstat = await ProcStat.open({ bin: paths.procstatBin, log: log.child('procstat') });
  let failures = 0;
  try {
    const adapters = await createAdapters([...APP_IDS], { ws: ctx.ws, paths, v2Ref: ctx.v2Ref, procstat, log: log.child('apps') });
    const rows: string[] = [];
    for (const name of names) {
      try {
        const r = await buildDataset({ paths, name, adapters, force, log: log.child(name) });
        const m = r.manifest;
        rows.push(
          `${name.padEnd(7)} ${r.status.padEnd(10)} plans ${String(m.counts.plans).padStart(5)} (Draft ${m.counts.byState.Draft}, Review+Failed ${m.counts.reviewQueue}) ` +
            `jobs ${String(m.counts.jobs).padStart(4)}  shared ${m.shared.content.slice(0, 12)}  v1 uv${m.apps.v1.db.userVersion} v2 uv${m.apps.v2.db.userVersion}  ` +
            `auto-open ${m.ids.autoOpenedDraftId ?? '-'} update ${m.ids.updatePlanId ?? '-'} get ${m.ids.getPlanId ?? '-'} job ${m.ids.jobId ?? '-'}`,
        );
      } catch (e) {
        failures++;
        log.error(`dataset ${name} failed: ${errorMessage(e)}`);
        rows.push(`${name.padEnd(7)} FAILED     ${errorMessage(e).split('\n')[0]}`);
      }
    }
    process.stdout.write(`${rows.join('\n')}\n`);
  } finally {
    await stopAll(log);
    await procstat.close();
  }
  return failures ? 1 : 0;
}
