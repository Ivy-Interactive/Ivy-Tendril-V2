// Suite 1, size: what each app ships and installs, in exact apparent bytes. No app process is
// started. V1 is measured from the signed v1.2.4 release installer and the app inside it; V2 from the
// .app and .dmg that `setup` built at the pinned commit, plus the dist that app embeds.
//
// Every number is a single deterministic sample (samples: [bytes], meta.deterministic). Scenario
// names follow report/generate.ts: top-level artifacts (`installer`, `installed-app`, like-for-like
// rows such as `core-app` and `agent-sidecar`), frontend groups under `frontend/...` with gzip -9 and
// brotli 11 variants, and component breakdowns as children that carry meta.parent (and meta.group,
// the like-for-like category the report stacks them by). Children only ever carry the plain `bytes`
// metric, because the report treats a child's compressed variants as top-level rows.
//
// Frontend sizes need the files themselves. V2's are on disk (dist/). V1's live as manifest
// resources inside Ivy.dll and Ivy.Tendril.Widgets.dll, which in turn live inside the Ivy.Tendril
// single-file bundle: the suite slices the DLLs out of the bundle (lib/sizes.ts parses the
// manifest), dumps their resources with tools/resdump.cs (`dotnet run`, metadata only, nothing is
// loaded or executed), and re-checks every dumped resource against the SHA-256 the tool recorded.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { BENCH_ROOT, V1_PKG_ASSET, V1_REF, V1_RELEASE_REPO } from '../lib/config.ts';
import { errorMessage } from '../lib/log.ts';
import { cleanEnv, run as runTool } from '../lib/proc.ts';
import { APP_IDS, newSuiteResult, readJson, type AppId, type Metric, type SuiteResult } from '../lib/results.ts';
import {
  dirBytes,
  eagerClosure,
  fileBytes,
  indexHtmlRefs,
  listFiles,
  parseSingleFileBundle,
  readBundleEntry,
  resolveDistRef,
  type BundleEntry,
  type FileEntry,
} from '../lib/sizes.ts';
import type { SuiteContext } from './index.ts';

const SUITE = 'size';
const RESDUMP = path.join(BENCH_ROOT, 'tools', 'resdump.cs');

/**
 * V1 figures from the research brief (research/bundles.md), measured by hand on the same v1.2.4
 * release. V1 is a fixed, signed release, so any difference means the measurement changed, not the
 * app; the suite notes each one. V2 has no such table: it is rebuilt at whatever commit is pinned.
 */
const V1_RESEARCH: Readonly<Record<string, number>> = {
  installer: 388_890_560,
  'installed-app': 1_167_911_573,
  'installed-app/Resources/dotnet': 651_300_995,
  'installed-app/Resources/PowerShell': 196_209_555,
  'installed-app/MacOS/Ivy.Tendril': 165_830_496,
  'installed-app/MacOS/ivy-agent': 138_823_456,
  'installed-app/MacOS/UpdateMac': 7_529_712,
  'Ivy.Tendril single-file bundle/native host (singlefilehost, coreclr linked in)': 10_506_240,
  'Ivy.Tendril single-file bundle/.NET shared framework': 98_548_304,
  'Ivy.Tendril single-file bundle/Ivy framework': 22_048_768,
  'Ivy.Tendril single-file bundle/Tendril assemblies': 13_453_472,
  'Ivy.Tendril single-file bundle/third-party NuGet': 20_220_944,
  'frontend/eager-js': 11_910_132,
  'frontend/eager-css': 331_583,
  'frontend/preloaded-fonts': 358_460,
  'frontend/all-js': 20_569_145,
  'frontend/fonts': 1_431_408,
  'frontend/sourcemaps': 5_263_944,
  'frontend/webviewer-proxy-assets': 198_760,
};

const FONT_EXT = /\.(woff2?|ttf|otf|eot)$/i;
const JS_EXT = /\.m?js$/i;
const MAP_EXT = /\.map$/i;
/** Never part of what ships, whichever tree it turns up in. */
const JUNK = [/(^|\/)\.DS_Store$/, /(^|\/)\.build-stamp$/];

// ---------------------------------------------------------------------------------------------
// Compression: per file, gzip level 9 and brotli quality 11 (9 on request), with exactly the
// options lib/sizes.ts uses. Async so the libuv pool compresses several files at once (brotli 11
// over ~40 MB of JS is the slow part of this suite), and cached by content hash because the groups
// overlap (eager JS is a subset of all JS).

interface Packed {
  raw: number;
  gzip9: number;
  brotli11: number;
}

function gzipAsync(buf: Buffer): Promise<number> {
  return new Promise((resolve, reject) => zlib.gzip(buf, { level: 9 }, (e, out) => (e ? reject(e) : resolve(out.length))));
}

function brotliAsync(buf: Buffer, quality: number): Promise<number> {
  const params = { [zlib.constants.BROTLI_PARAM_QUALITY]: quality, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length };
  return new Promise((resolve, reject) => zlib.brotliCompress(buf, { params }, (e, out) => (e ? reject(e) : resolve(out.length))));
}

class Compressor {
  private packed = new Map<string, Promise<Packed>>();
  private br9 = new Map<string, Promise<number>>();

  private static key(buf: Buffer): string {
    return crypto.createHash('sha256').update(buf).digest('hex');
  }

  sizes(buf: Buffer): Promise<Packed> {
    const k = Compressor.key(buf);
    let p = this.packed.get(k);
    if (!p) {
      p = Promise.all([gzipAsync(buf), brotliAsync(buf, 11)]).then(([gzip9, brotli11]) => ({ raw: buf.length, gzip9, brotli11 }));
      this.packed.set(k, p);
    }
    return p;
  }

  brotli9(buf: Buffer): Promise<number> {
    const k = Compressor.key(buf);
    let p = this.br9.get(k);
    if (!p) {
      p = brotliAsync(buf, 9);
      this.br9.set(k, p);
    }
    return p;
  }
}

/** A shipped frontend file, named by the path it is served under (or its logical resource path). */
interface Blob {
  name: string;
  data: Buffer;
}

interface GroupTotals extends Packed {
  files: number;
  /** The largest files, so the report and a reader can see what dominates. */
  largest: Array<{ name: string } & Packed>;
}

async function totals(c: Compressor, blobs: readonly Blob[]): Promise<GroupTotals> {
  const per = await Promise.all(blobs.map(async (b) => ({ name: b.name, ...(await c.sizes(b.data)) })));
  const sum = (k: keyof Packed) => per.reduce((s, f) => s + f[k], 0);
  const largest = [...per].sort((a, b) => b.raw - a.raw || (a.name < b.name ? -1 : 1)).slice(0, 12);
  return { files: per.length, raw: sum('raw'), gzip9: sum('gzip9'), brotli11: sum('brotli11'), largest };
}

const rawBytes = (blobs: readonly Blob[]) => blobs.reduce((s, b) => s + b.data.length, 0);

function sha256File(file: string): string {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(8 * 1024 * 1024);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

const sha256 = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------------------------------------
// Metric emission

class Emit {
  readonly r: SuiteResult;
  constructor(r: SuiteResult) {
    this.r = r;
  }

  private push(app: AppId, scenario: string, metric: string, unit: Metric['unit'], value: number, meta: Record<string, unknown>): void {
    if (!Number.isFinite(value)) throw new Error(`${app} ${scenario} ${metric}: not a number (${value})`);
    this.r.metrics.push({ suite: SUITE, scenario, app, dataset: null, metric, unit, samples: [value], better: 'lower', meta: { deterministic: true, ...meta } });
  }

  bytes(app: AppId, scenario: string, value: number, meta: Record<string, unknown> = {}): void {
    this.push(app, scenario, 'bytes', 'bytes', value, meta);
  }

  count(app: AppId, scenario: string, metric: string, value: number, meta: Record<string, unknown> = {}): void {
    this.push(app, scenario, metric, 'count', value, meta);
  }

  /** A breakdown row: `<parent>/<name>`, plain bytes only (see the header comment). */
  child(app: AppId, parent: string, name: string, value: number, group: string | null, meta: Record<string, unknown> = {}): void {
    this.bytes(app, `${parent}/${name}`, value, { parent, component: name, ...(group ? { group } : {}), ...meta });
  }

  /** A frontend group: raw, gzip -9 and brotli 11 as three metrics of one scenario. */
  group(app: AppId, scenario: string, g: GroupTotals, meta: Record<string, unknown> = {}): void {
    const common = { files: g.files, ...meta };
    this.bytes(app, scenario, g.raw, { ...common, largest: g.largest });
    this.push(app, scenario, 'bytes_gzip9', 'bytes', g.gzip9, common);
    this.push(app, scenario, 'bytes_brotli11', 'bytes', g.brotli11, common);
  }
}

// ---------------------------------------------------------------------------------------------
// Inputs

interface BuildInfo {
  artifacts?: Record<string, unknown>;
  v1?: { releasePkg?: Record<string, unknown> };
  v2?: { clone?: { sha?: string }; app?: Record<string, unknown>; cli?: Record<string, unknown>; sidecars?: Record<string, unknown> };
  [k: string]: unknown;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

interface Inputs {
  v1Pkg: string;
  v1App: string;
  v1Clone: string;
  v2App: string;
  v2Dmg: string | null;
  v2Dist: string;
  v2Clone: string;
  v2Sha: string | null;
  info: BuildInfo | null;
}

function resolveInputs(ctx: SuiteContext): Inputs {
  const info = readJson<BuildInfo>(ctx.paths.buildInfo);
  const a = info?.artifacts ?? {};
  const v2Clone = ctx.paths.v2Clone;
  let v2Dmg = str(a.v2Dmg);
  if (!v2Dmg && fs.existsSync(ctx.paths.artifactsV2)) {
    const d = fs.readdirSync(ctx.paths.artifactsV2).filter((f) => f.endsWith('.dmg')).sort();
    v2Dmg = d.length ? path.join(ctx.paths.artifactsV2, d[d.length - 1]!) : null;
  }
  return {
    v1Pkg: str(a.v1Pkg) ?? path.join(ctx.paths.artifactsV1, V1_PKG_ASSET),
    v1App: str(a.v1PkgApp) ?? path.join(ctx.paths.artifactsV1, 'pkg-expanded', '1.pkg', 'Payload', 'Ivy Tendril.app'),
    v1Clone: ctx.paths.v1Clone,
    v2App: str(a.v2App) ?? path.join(ctx.paths.artifactsV2, 'Tendril.app'),
    v2Dmg,
    v2Dist: str(a.v2Dist) ?? ctx.paths.v2Dist,
    v2Clone,
    v2Sha: info?.v2?.clone?.sha ?? null,
    info,
  };
}

/**
 * The release pkg is normally fetched by `setup`; the spec also lets this suite fetch it. Only the
 * download is done here (verified against GitHub's digest): expanding it is setup's job, because
 * the expanded app is also what the server suites choose their V1 binary from.
 */
async function ensureV1Pkg(ctx: SuiteContext, pkg: string, notes: string[]): Promise<void> {
  if (fs.existsSync(pkg)) return;
  ctx.log.info(`${pkg} missing: downloading ${V1_PKG_ASSET} from ${V1_RELEASE_REPO} ${V1_REF}`);
  const dir = path.dirname(pkg);
  const tmp = fs.mkdtempSync(path.join(dir, '.dl-'));
  try {
    await runTool('gh', ['release', 'download', V1_REF, '-R', V1_RELEASE_REPO, '-p', V1_PKG_ASSET, '-D', tmp], { timeoutMs: 30 * 60_000 });
    const got = path.join(tmp, V1_PKG_ASSET);
    const view = await runTool('gh', ['release', 'view', V1_REF, '-R', V1_RELEASE_REPO, '--json', 'assets']);
    const asset = (JSON.parse(view.stdout) as { assets: Array<{ name: string; digest?: string }> }).assets.find((x) => x.name === V1_PKG_ASSET);
    const want = asset?.digest?.replace(/^sha256:/, '') ?? null;
    const have = sha256File(got);
    if (want && want !== have) throw new Error(`downloaded ${V1_PKG_ASSET} has sha256 ${have}, GitHub says ${want}`);
    fs.renameSync(got, pkg);
    notes.push(`downloaded ${V1_PKG_ASSET} (sha256 ${have}${want ? ', matches the GitHub digest' : ', GitHub published no digest'})`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function stripX(src: string, outDir: string): Promise<number> {
  const out = path.join(outDir, `${path.basename(src)}.strip-x`);
  // -o leaves the input alone; strip warns on stderr that the signature is invalidated, which is
  // expected for a size-only copy.
  await runTool('strip', ['-x', '-o', out, src], { timeoutMs: 120_000 });
  const n = fileBytes(out);
  fs.rmSync(out, { force: true });
  return n;
}

/** Sums files of a tree by the first matching component; the rest is `other`. */
function componentize(files: FileEntry[], rules: Array<{ name: string; group: string; test: (rel: string) => boolean }>) {
  const comps = rules.map((r) => ({ ...r, bytes: 0, files: 0, members: [] as Array<{ rel: string; bytes: number }> }));
  const other = { bytes: 0, files: 0, members: [] as Array<{ rel: string; bytes: number }> };
  for (const f of files) {
    const c = comps.find((x) => x.test(f.rel)) ?? other;
    c.bytes += f.bytes;
    c.files++;
    c.members.push({ rel: f.rel, bytes: f.bytes });
  }
  return { comps, other };
}

const topMembers = (m: Array<{ rel: string; bytes: number }>, n = 8) => [...m].sort((a, b) => b.bytes - a.bytes).slice(0, n);

// ---------------------------------------------------------------------------------------------
// V1

interface V1Frontend {
  indexHtml: Blob;
  /** `assets/<file>`, as served under / (and written to disk for the closure walk). */
  assets: Blob[];
  /** `widgets/<Name>/<file>`: Ivy's external widgets (lazy), maps included. */
  widgets: Blob[];
  /** Other Ivy frontend files next to index.html (icons). */
  rootFiles: Blob[];
  tendrilJs: Blob;
  tendrilCss: Blob;
  proxy: Blob[];
  distDir: string;
  resdumpRuntime: string | null;
  /** Resources that are not frontend (prompts, detector data, icons for the OS), for the record. */
  nonFrontend: Array<{ assembly: string; name: string; size: number }>;
  dllSha256: Record<string, string>;
}

interface ResdumpManifest {
  runtime?: string;
  assemblies: Array<{
    file: string;
    assembly: string | null;
    error?: string;
    resources: Array<{ name: string; embedded: boolean; size?: number; sha256?: string; file?: string }>;
  }>;
}

async function dumpV1Frontend(ctx: SuiteContext, bundleFile: string, entries: BundleEntry[], work: string): Promise<V1Frontend> {
  const manifest = parseSingleFileBundle(bundleFile);
  const dllDir = path.join(work, 'dlls');
  const resDir = path.join(work, 'resources');
  fs.mkdirSync(dllDir, { recursive: true });
  const wanted = ['Ivy.dll', 'Ivy.Tendril.Widgets.dll'];
  const dllSha256: Record<string, string> = {};
  const dlls: string[] = [];
  for (const name of wanted) {
    const e = entries.find((x) => x.path === name);
    if (!e) throw new Error(`${name} is not in the ${path.basename(bundleFile)} bundle`);
    const buf = readBundleEntry(manifest, e);
    if (buf.length !== e.size) throw new Error(`${name}: read ${buf.length} bytes, manifest says ${e.size}`);
    const out = path.join(dllDir, name);
    fs.writeFileSync(out, buf);
    dllSha256[name] = sha256(buf);
    dlls.push(out);
  }

  ctx.log.info(`dumping manifest resources of ${wanted.join(', ')} with tools/resdump.cs (first run compiles it)`);
  await runTool('dotnet', ['run', RESDUMP, '--', resDir, ...dlls], {
    cwd: work,
    timeoutMs: 600_000,
    env: cleanEnv({ DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' }),
  });
  const m = readJson<ResdumpManifest>(path.join(resDir, 'manifest.json'));
  if (!m) throw new Error('resdump wrote no manifest.json');

  const byAsm = new Map<string, Blob[]>();
  const nonFrontend: V1Frontend['nonFrontend'] = [];
  for (const a of m.assemblies) {
    if (a.error) throw new Error(`resdump: ${path.basename(a.file)}: ${a.error}`);
    const list: Blob[] = [];
    for (const r of a.resources) {
      if (!r.embedded || !r.file) throw new Error(`resdump: ${a.assembly}: resource ${r.name} is not embedded`);
      const data = fs.readFileSync(path.join(resDir, r.file));
      if (data.length !== r.size || sha256(data) !== r.sha256) throw new Error(`resdump: ${r.name}: dumped bytes do not match the recorded size/sha256`);
      list.push({ name: r.name, data });
    }
    byAsm.set(a.assembly ?? path.basename(a.file), list);
  }
  const ivy = byAsm.get('Ivy');
  const widgetsAsm = byAsm.get('Ivy.Tendril.Widgets');
  if (!ivy || !widgetsAsm) throw new Error(`resdump did not report both assemblies (got ${[...byAsm.keys()].join(', ')})`);

  // Ivy.csproj embeds frontend/dist/** as `Ivy.<path with / as .>`, and the external widgets as
  // `Ivy.widgets.<Name>.<file>`. Vite writes assets/ flat, so `Ivy.assets.<rest>` is always
  // assets/<rest> even when the file name itself has dots (tslib.es6-*.js); widget names have none.
  let indexHtml: Blob | null = null;
  const assets: Blob[] = [];
  const widgets: Blob[] = [];
  const rootFiles: Blob[] = [];
  for (const b of ivy) {
    if (b.name === 'Ivy.index.html') indexHtml = { name: 'index.html', data: b.data };
    else if (b.name.startsWith('Ivy.assets.')) assets.push({ name: `assets/${b.name.slice('Ivy.assets.'.length)}`, data: b.data });
    else if (b.name.startsWith('Ivy.widgets.')) {
      const rest = b.name.slice('Ivy.widgets.'.length);
      const dot = rest.indexOf('.');
      widgets.push({ name: `widgets/${rest.slice(0, dot)}/${rest.slice(dot + 1)}`, data: b.data });
    } else if (/^Ivy\.[^.]+\.svg$/.test(b.name)) rootFiles.push({ name: b.name.slice('Ivy.'.length), data: b.data });
    else if (b.data.length > 0) nonFrontend.push({ assembly: 'Ivy', name: b.name, size: b.data.length });
  }
  if (!indexHtml) throw new Error('Ivy.dll has no Ivy.index.html resource');
  const pick = (n: string): Blob => {
    const b = widgetsAsm.find((x) => x.name === n);
    if (!b) throw new Error(`Ivy.Tendril.Widgets.dll has no ${n} resource`);
    return b;
  };
  const tendrilJs = { name: 'ivy-tendril-widgets.js', data: pick('Ivy.Tendril.Widgets.frontend.dist.ivy-tendril-widgets.js').data };
  const tendrilCss = { name: 'ivy-tendril-widgets.css', data: pick('Ivy.Tendril.Widgets.frontend.dist.ivy-tendril-widgets.css').data };
  const proxy = widgetsAsm
    .filter((b) => b.name.startsWith('Ivy.Tendril.Widgets.proxy-assets.'))
    .map((b) => ({ name: `proxy-assets/${b.name.slice('Ivy.Tendril.Widgets.proxy-assets.'.length)}`, data: b.data }));
  for (const b of widgetsAsm) {
    if (b.name.startsWith('Ivy.Tendril.Widgets.proxy-assets.') || b.name.startsWith('Ivy.Tendril.Widgets.frontend.dist.')) continue;
    nonFrontend.push({ assembly: 'Ivy.Tendril.Widgets', name: b.name, size: b.data.length });
  }

  // The closure walk reads files, so lay the Ivy dist out the way it is served.
  const distDir = path.join(work, 'ivy-dist');
  for (const b of [indexHtml, ...assets, ...rootFiles]) {
    const p = path.join(distDir, b.name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, b.data);
  }
  return { indexHtml, assets, widgets, rootFiles, tendrilJs, tendrilCss, proxy, distDir, resdumpRuntime: m.runtime ?? null, nonFrontend, dllSha256 };
}

interface DepsJson {
  targets: Record<string, Record<string, { runtime?: Record<string, unknown>; native?: Record<string, unknown>; resources?: Record<string, unknown> }>>;
}

/** Which deps.json library each bundled file came from (by bundle-relative path, then by file name). */
function libraryOfEntry(deps: DepsJson): (p: string) => string | null {
  const byPath = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const [tfm, libs] of Object.entries(deps.targets)) {
    // The RID-specific target is the one a self-contained publish resolves against.
    if (!tfm.includes('/')) continue;
    for (const [lib, v] of Object.entries(libs)) {
      for (const k of [...Object.keys(v.runtime ?? {}), ...Object.keys(v.native ?? {}), ...Object.keys(v.resources ?? {})]) {
        byPath.set(k, lib);
        byName.set(path.posix.basename(k), lib);
      }
    }
  }
  return (p) => byPath.get(p) ?? byName.get(path.posix.basename(p)) ?? null;
}

async function measureV1(ctx: SuiteContext, e: Emit, c: Compressor, inp: Inputs, work: string, notes: string[]): Promise<void> {
  const fail = (scenario: string, err: unknown) => {
    ctx.log.warn(`v1 ${scenario}: ${errorMessage(err)}`);
    e.r.failures.push({ app: 'v1', dataset: null, scenario, error: errorMessage(err) });
  };

  // Installer.
  try {
    await ensureV1Pkg(ctx, inp.v1Pkg, notes);
    const rp = inp.info?.v1?.releasePkg ?? {};
    const digest = sha256File(inp.v1Pkg);
    const gh = str(rp.githubDigest)?.replace(/^sha256:/, '') ?? null;
    if (gh && gh !== digest) notes.push(`V1 pkg sha256 ${digest} does not match the GitHub digest ${gh} recorded by setup`);
    e.bytes('v1', 'installer', fileBytes(inp.v1Pkg), {
      file: inp.v1Pkg,
      sha256: digest,
      githubDigestMatches: gh ? gh === digest : null,
      format: 'flat pkg (xar) with a gzip cpio payload, built by Velopack vpk pack',
      release: `${V1_RELEASE_REPO} ${V1_REF}`,
    });
  } catch (err) {
    fail('installer', err);
  }

  // Installed app (the expanded pkg payload) and its components.
  const contents = path.join(inp.v1App, 'Contents');
  let appBin: string | null = null;
  let dylibs: FileEntry[] = [];
  try {
    if (!fs.existsSync(contents)) throw new Error(`${inp.v1App} does not exist (run \`setup --only v1-pkg\`)`);
    const files = listFiles(inp.v1App);
    const t = dirBytes(inp.v1App);
    const sum = files.reduce((s, f) => s + f.bytes, 0);
    if (sum !== t.bytes || files.length !== t.files) throw new Error(`listFiles (${sum} B, ${files.length}) and dirBytes (${t.bytes} B, ${t.files}) disagree`);
    // The installed copy should be the same bytes; say so when it is not (Velopack adds nothing).
    const installed = '/Applications/Ivy Tendril.app';
    let installedCopy: Record<string, unknown> | null = null;
    if (fs.existsSync(installed)) {
      const it = dirBytes(installed);
      installedCopy = { path: installed, bytes: it.bytes, files: it.files, sameTotals: it.bytes === t.bytes && it.files === t.files };
      if (!installedCopy.sameTotals) notes.push(`${installed} (${it.bytes} B, ${it.files} files) differs from the v1.2.4 pkg payload (${t.bytes} B, ${t.files} files); the suite measures the pkg payload`);
    }
    e.bytes('v1', 'installed-app', t.bytes, { path: inp.v1App, files: t.files, symlinks: t.symlinks, source: 'expanded v1.2.4 pkg payload (pkgutil --expand-full)', installedCopy });
    e.count('v1', 'installed-app', 'files', t.files);

    const { comps, other } = componentize(files, [
      { name: 'Resources/dotnet', group: 'bundled toolchains', test: (r) => r.startsWith('Contents/Resources/dotnet/') },
      { name: 'Resources/PowerShell', group: 'bundled toolchains', test: (r) => r.startsWith('Contents/Resources/PowerShell/') },
      { name: 'MacOS/Ivy.Tendril', group: 'core app', test: (r) => r === 'Contents/MacOS/Ivy.Tendril' },
      { name: 'MacOS/ivy-agent', group: 'agent sidecar', test: (r) => r === 'Contents/MacOS/ivy-agent' },
      { name: 'MacOS/UpdateMac', group: 'updater', test: (r) => r === 'Contents/MacOS/UpdateMac' },
      { name: 'MacOS/native dylibs', group: 'core app', test: (r) => /^Contents\/MacOS\/[^/]+\.dylib$/.test(r) },
    ]);
    for (const k of comps) {
      if (!k.files) throw new Error(`component ${k.name} not found in ${inp.v1App}`);
      e.child('v1', 'installed-app', k.name, k.bytes, k.group, { files: k.files, ...(k.files > 1 ? { largest: topMembers(k.members) } : {}) });
    }
    e.child('v1', 'installed-app', 'other', other.bytes, 'other', { files: other.files, largest: topMembers(other.members) });

    const get = (n: string) => comps.find((k) => k.name === n)!;
    appBin = path.join(contents, 'MacOS', 'Ivy.Tendril');
    dylibs = files.filter((f) => /^Contents\/MacOS\/[^/]+\.dylib$/.test(f.rel));
    const core = get('MacOS/Ivy.Tendril').bytes + get('MacOS/native dylibs').bytes;
    const binSha = sha256File(appBin);
    e.bytes('v1', 'installed-app-after-first-launch', t.bytes, { note: 'V1 copies nothing on first launch (it only points a tendril symlink in ~/.local/bin or /usr/local/bin at the app)' });
    e.bytes('v1', 'core-app', core, {
      parts: { 'MacOS/Ivy.Tendril': get('MacOS/Ivy.Tendril').bytes, 'MacOS/native dylibs': get('MacOS/native dylibs').bytes },
      note: 'the self-contained single-file app (runtime, server, UI host, frontend) plus the native libraries beside it (webview host, SQLite, pty, ...)',
    });
    e.bytes('v1', 'agent-sidecar', get('MacOS/ivy-agent').bytes, { file: 'Contents/MacOS/ivy-agent', version: 'ivy-agent 0.1.5 (Bun-compiled)' });
    e.bytes('v1', 'bundled-toolchains', get('Resources/dotnet').bytes + get('Resources/PowerShell').bytes, {
      parts: { 'Resources/dotnet (.NET SDK 10.0.100)': get('Resources/dotnet').bytes, 'Resources/PowerShell (7.4.2)': get('Resources/PowerShell').bytes },
    });
    e.bytes('v1', 'updater', get('MacOS/UpdateMac').bytes, { file: 'Contents/MacOS/UpdateMac', note: 'Velopack updater (universal x86_64 + arm64)' });
    e.bytes('v1', 'server-binary', get('MacOS/Ivy.Tendril').bytes, { file: appBin, sha256: binSha, note: 'one self-contained .NET single-file executable; it is also the desktop UI host' });
  } catch (err) {
    fail('installed-app', err);
  }

  // strip -x copies (informational). Ivy.Tendril cannot be stripped: the single-file bundle is
  // appended after the Mach-O image, and strip rewrites the image without it (165.8 MB -> 8.8 MB,
  // a host with no app). Only the native dylibs beside it are stripped.
  if (appBin && dylibs.length) {
    try {
      const sdir = path.join(work, 'strip');
      fs.mkdirSync(sdir, { recursive: true });
      const per: Record<string, number> = {};
      for (const d of dylibs) per[path.basename(d.abs)] = await stripX(d.abs, sdir);
      const stripped = Object.values(per).reduce((s, v) => s + v, 0);
      e.bytes('v1', 'core-app (strip -x, informational)', fileBytes(appBin) + stripped, {
        informational: true,
        strippedDylibs: per,
        note: 'Ivy.Tendril counted unstripped: strip would drop its appended single-file bundle',
      });
    } catch (err) {
      fail('core-app (strip -x, informational)', err);
    }
  }

  // Single-file bundle breakdown and the frontend inside it.
  if (!appBin) return;
  let entries: BundleEntry[] = [];
  const bundleScenario = 'Ivy.Tendril single-file bundle';
  try {
    const m = parseSingleFileBundle(appBin);
    entries = m.entries;
    const depsEntry = m.entries.find((x) => x.type === 'DepsJson');
    if (!depsEntry) throw new Error('bundle has no deps.json');
    const deps = JSON.parse(readBundleEntry(m, depsEntry).toString('utf8')) as DepsJson;
    const libOf = libraryOfEntry(deps);
    const cats = new Map<string, { bytes: number; files: number; members: Array<{ rel: string; bytes: number }> }>();
    const unknownLib: string[] = [];
    for (const x of m.entries) {
      const onDisk = x.compressedSize || x.size;
      const lib = libOf(x.path);
      const base = path.posix.basename(x.path);
      let cat: string;
      if (x.type === 'DepsJson' || x.type === 'RuntimeConfigJson' || /^Ivy\.Tendril/.test(base)) cat = 'Tendril assemblies';
      else if (lib?.startsWith('runtimepack.')) cat = '.NET shared framework';
      // By file name, not by package: Ivy.SystemTextJson.JsonDiffPatch is an Ivy-published fork of
      // a third-party library and ships as SystemTextJson.JsonDiffPatch.dll.
      else if (/^Ivy\./.test(base)) cat = 'Ivy framework';
      else cat = 'third-party NuGet';
      if (!lib && x.type !== 'DepsJson' && x.type !== 'RuntimeConfigJson') unknownLib.push(x.path);
      const k = cats.get(cat) ?? { bytes: 0, files: 0, members: [] };
      k.bytes += onDisk;
      k.files++;
      k.members.push({ rel: x.path, bytes: onDisk });
      cats.set(cat, k);
    }
    if (unknownLib.length) notes.push(`V1 bundle: ${unknownLib.length} entr(ies) not listed in deps.json, classified by name: ${unknownLib.slice(0, 5).join(', ')}`);
    const inEntries = m.entries.reduce((s, x) => s + (x.compressedSize || x.size), 0);
    const tail = m.fileSize - m.hostPrefixBytes - inEntries;
    e.bytes('v1', bundleScenario, m.fileSize, {
      file: appBin,
      bundleVersion: `${m.major}.${m.minor}`,
      entries: m.entries.length,
      compressedEntries: m.entries.filter((x) => x.compressedSize > 0).length,
      bundleId: m.bundleId,
    });
    e.child('v1', bundleScenario, 'native host (singlefilehost, coreclr linked in)', m.hostPrefixBytes, 'runtime');
    const order: Array<[string, string]> = [
      ['.NET shared framework', 'runtime'],
      ['Ivy framework', 'framework'],
      ['Tendril assemblies', 'app'],
      ['third-party NuGet', 'third-party'],
    ];
    for (const [name, group] of order) {
      const k = cats.get(name);
      if (!k) continue;
      e.child('v1', bundleScenario, name, k.bytes, group, { files: k.files, largest: topMembers(k.members) });
    }
    e.child('v1', bundleScenario, 'manifest, padding and signature', tail, 'other');
  } catch (err) {
    fail(bundleScenario, err);
    return;
  }

  try {
    const fe = await dumpV1Frontend(ctx, appBin, entries, path.join(work, 'v1-frontend'));
    await v1FrontendMetrics(ctx, e, c, fe, inp, notes);
  } catch (err) {
    fail('frontend', err);
  }
}

async function v1FrontendMetrics(ctx: SuiteContext, e: Emit, c: Compressor, fe: V1Frontend, inp: Inputs, notes: string[]): Promise<void> {
  const refs = indexHtmlRefs(fe.indexHtml.data.toString('utf8'));
  if (refs.moduleScripts.length !== 1) throw new Error(`Ivy index.html has ${refs.moduleScripts.length} module scripts, expected 1`);
  const assetsDir = path.join(fe.distDir, 'assets');
  const entry = resolveDistRef(fe.distDir, refs.moduleScripts[0]!);
  const closure = eagerClosure(assetsDir, entry);
  const byName = new Map(fe.assets.map((b) => [b.name, b]));
  const ivyEager = closure.files.map((f) => byName.get(`assets/${f}`)!);
  const preloads = new Set(refs.modulePreloads.map((r) => path.relative(assetsDir, resolveDistRef(fe.distDir, r))));
  const closureSet = new Set(closure.files.slice(1));
  const sameAsPreloads = preloads.size === closureSet.size && [...preloads].every((p) => closureSet.has(p));
  if (!sameAsPreloads) notes.push(`V1 Ivy eager closure (${closure.files.length} files) differs from index.html's modulepreload list (${preloads.size} + entry)`);

  const eagerJs = [...ivyEager, fe.tendrilJs];
  const cssRefs = refs.stylesheets.map((r) => `assets/${path.relative(assetsDir, resolveDistRef(fe.distDir, r))}`);
  const eagerCss = [...cssRefs.map((n) => byName.get(n)!), fe.tendrilCss];
  if (eagerCss.some((b) => !b)) throw new Error(`Ivy index.html links a stylesheet that is not embedded: ${cssRefs.join(', ')}`);
  const fontRefs = refs.fontPreloads.map((r) => `assets/${path.relative(assetsDir, resolveDistRef(fe.distDir, r))}`);
  const preFonts = fontRefs.map((n) => byName.get(n)!);
  if (preFonts.some((b) => !b)) throw new Error('Ivy index.html preloads a font that is not embedded');

  const widgetsNoMap = fe.widgets.filter((b) => !MAP_EXT.test(b.name));
  const maps = [...fe.assets, ...fe.widgets].filter((b) => MAP_EXT.test(b.name));
  const assetsNoMap = fe.assets.filter((b) => !MAP_EXT.test(b.name));
  const shipped = [fe.indexHtml, ...fe.rootFiles, ...assetsNoMap, ...widgetsNoMap, fe.tendrilJs, fe.tendrilCss, ...fe.proxy];
  const allJs = shipped.filter((b) => JS_EXT.test(b.name));
  const allCss = shipped.filter((b) => /\.css$/i.test(b.name));
  const fonts = shipped.filter((b) => FONT_EXT.test(b.name));

  const provenance: Record<string, unknown> = { resdumpRuntime: fe.resdumpRuntime, dllSha256: fe.dllSha256 };
  // Provenance checks the research made by hand: Ivy.dll is the NuGet ivy 1.4.0 package, and the
  // widgets bundle is what the v1.2.4 clone's frontend build produces.
  const nugetIvy = path.join(os.homedir(), '.nuget', 'packages', 'ivy', '1.4.0', 'lib', 'net10.0', 'Ivy.dll');
  if (fs.existsSync(nugetIvy)) provenance.ivyDllIdenticalToNuget_1_4_0 = sha256File(nugetIvy) === fe.dllSha256['Ivy.dll'];
  const cloneWidgets = path.join(inp.v1Clone, 'src', 'Ivy.Tendril.Widgets', 'frontend', 'dist', 'ivy-tendril-widgets.js');
  if (fs.existsSync(cloneWidgets)) provenance.widgetsJsIdenticalToCloneBuild = sha256File(cloneWidgets) === sha256(fe.tendrilJs.data);

  e.group('v1', 'frontend/eager-js', await totals(c, eagerJs), {
    entry: path.basename(entry),
    ivyClosureFiles: closure.files.length,
    closureEqualsModulepreloads: sameAsPreloads,
    note: 'Ivy entry chunk plus its static-import closure, plus the Tendril widgets IIFE: the root shell (TendrilShell) is an external widget, so it loads before the Tendril UI can paint',
    ...provenance,
  });
  e.child('v1', 'frontend/eager-js', 'Ivy entry closure', rawBytes(ivyEager), 'framework', { files: ivyEager.length });
  e.child('v1', 'frontend/eager-js', 'Tendril widgets IIFE', fe.tendrilJs.data.length, 'app', { files: 1 });
  e.group('v1', 'frontend/eager-css', await totals(c, eagerCss), { members: eagerCss.map((b) => b.name) });
  e.group('v1', 'frontend/preloaded-fonts', await totals(c, preFonts), { members: preFonts.map((b) => b.name) });
  e.group('v1', 'frontend/index-html', await totals(c, [fe.indexHtml]), { note: 'as embedded; the server injects a few meta/theme tags when it serves it' });

  const ivyAssetJs = assetsNoMap.filter((b) => JS_EXT.test(b.name));
  const ivyWidgetJs = widgetsNoMap.filter((b) => JS_EXT.test(b.name));
  e.group('v1', 'frontend/all-js', await totals(c, allJs), { note: 'every shipped JS file: Ivy assets (eager and lazy), Ivy external widgets, the Tendril widgets bundle, webviewer proxy assets' });
  e.child('v1', 'frontend/all-js', 'Ivy assets/*.js', rawBytes(ivyAssetJs), 'framework', { files: ivyAssetJs.length });
  e.child('v1', 'frontend/all-js', 'Ivy external widgets', rawBytes(ivyWidgetJs), 'framework', { files: ivyWidgetJs.length });
  e.child('v1', 'frontend/all-js', 'Tendril widgets IIFE', fe.tendrilJs.data.length, 'app', { files: 1 });
  e.child('v1', 'frontend/all-js', 'webviewer proxy assets', rawBytes(fe.proxy.filter((b) => JS_EXT.test(b.name))), 'webviewer', { files: fe.proxy.length });
  e.group('v1', 'frontend/all-css', await totals(c, allCss));
  e.group('v1', 'frontend/fonts', await totals(c, fonts), { note: 'woff2 does not compress further' });
  e.group('v1', 'frontend/sourcemaps', await totals(c, maps), { note: 'embedded in Ivy.dll next to the external widgets; the Tendril widgets map is not embedded' });
  e.group('v1', 'frontend/total-shipped', await totals(c, shipped), { note: 'every frontend file shipped, source maps excluded' });
  e.bytes('v1', 'frontend/as-embedded-in-binary', rawBytes(shipped) + rawBytes(maps), {
    informational: true,
    note: 'frontend bytes the binary carries: stored uncompressed as manifest resources, source maps included, and served uncompressed (no response compression in Ivy)',
  });
  e.group('v1', 'frontend/webviewer-proxy-assets', await totals(c, fe.proxy), { members: fe.proxy.map((b) => b.name) });

  if (fe.nonFrontend.length) {
    notes.push(`V1: non-frontend resources left out of the frontend groups: ${fe.nonFrontend.map((r) => `${r.name} (${r.size} B)`).join(', ')}`);
  }
  ctx.log.info(`v1 frontend: eager JS ${rawBytes(eagerJs)} B (${ivyEager.length} Ivy chunks + widgets IIFE), all JS ${rawBytes(allJs)} B`);
}

// ---------------------------------------------------------------------------------------------
// V2

function distBlobs(dist: string): Blob[] {
  return listFiles(dist, { exclude: JUNK }).map((f) => ({ name: f.rel, data: fs.readFileSync(f.abs) }));
}

/** Packs the wireframe payload the way tendril-wireframe's build.rs does, to size it without cargo. */
function wireframePayloadBytes(artifacts: string): { bytes: number; files: number; contentBytes: number } {
  // build.rs walks every file under artifacts/ (no exclusions) and writes, per entry, a u32 path
  // length, the UTF-8 path, a u64 body length and the body.
  const walk = (dir: string, rel: string, out: Array<{ rel: string; bytes: number }>) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      const abs = path.join(dir, d.name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) walk(abs, r, out);
      else if (st.isFile()) out.push({ rel: r, bytes: st.size });
    }
  };
  const files: Array<{ rel: string; bytes: number }> = [];
  walk(artifacts, '', files);
  const contentBytes = files.reduce((s, f) => s + f.bytes, 0);
  const bytes = files.reduce((s, f) => s + 4 + Buffer.byteLength(f.rel, 'utf8') + 8 + f.bytes, 0);
  return { bytes, files: files.length, contentBytes };
}

async function measureV2(ctx: SuiteContext, e: Emit, c: Compressor, inp: Inputs, work: string, notes: string[]): Promise<void> {
  const fail = (scenario: string, err: unknown) => {
    ctx.log.warn(`v2 ${scenario}: ${errorMessage(err)}`);
    e.r.failures.push({ app: 'v2', dataset: null, scenario, error: errorMessage(err) });
  };
  const built = inp.v2Sha ? `built by setup at ${inp.v2Sha.slice(0, 12)}` : 'built by setup';

  try {
    if (!inp.v2Dmg || !fs.existsSync(inp.v2Dmg)) throw new Error(`no V2 .dmg in ${ctx.paths.artifactsV2} (run \`setup --only v2-app\`)`);
    const dmgInfo = (inp.info?.v2?.app?.dmg ?? {}) as Record<string, unknown>;
    e.bytes('v2', 'installer', fileBytes(inp.v2Dmg), {
      file: inp.v2Dmg,
      sha256: sha256File(inp.v2Dmg),
      format: `${str(dmgInfo.format) ?? 'UDZO'} disk image (zlib), ${str(dmgInfo.kind) === 'hdiutil' ? 'hdiutil fallback' : 'made by tauri build'}`,
      source: built,
    });
  } catch (err) {
    fail('installer', err);
  }

  const macos = path.join(inp.v2App, 'Contents', 'MacOS');
  const bins = { app: path.join(macos, 'tendril-app'), cli: path.join(macos, 'tendril'), opencode: path.join(macos, 'opencode') };
  let haveApp = false;
  try {
    if (!fs.existsSync(macos)) throw new Error(`${inp.v2App} does not exist (run \`setup --only v2-app\`)`);
    const files = listFiles(inp.v2App);
    const t = dirBytes(inp.v2App);
    const { comps, other } = componentize(files, [
      { name: 'MacOS/tendril-app', group: 'core app', test: (r) => r === 'Contents/MacOS/tendril-app' },
      { name: 'MacOS/tendril', group: 'core app', test: (r) => r === 'Contents/MacOS/tendril' },
      { name: 'MacOS/opencode', group: 'agent sidecar', test: (r) => r === 'Contents/MacOS/opencode' },
    ]);
    for (const k of comps) if (!k.files) throw new Error(`${k.name} not found in ${inp.v2App}`);
    const get = (n: string) => comps.find((k) => k.name === n)!.bytes;
    e.bytes('v2', 'installed-app', t.bytes, { path: inp.v2App, files: t.files, symlinks: t.symlinks, source: built });
    e.count('v2', 'installed-app', 'files', t.files);
    for (const k of comps) e.child('v2', 'installed-app', k.name, k.bytes, k.group, { files: k.files });
    e.child('v2', 'installed-app', 'other', other.bytes, 'other', { files: other.files, largest: topMembers(other.members) });

    // First launch (release builds) copies both sidecars into <home>/bin and registers autostart
    // against that copy (tendril-core service::provision, CLI_BINARY and OPENCODE_BINARY).
    e.bytes('v2', 'installed-app-after-first-launch', t.bytes + get('MacOS/tendril') + get('MacOS/opencode'), {
      parts: { 'Tendril.app': t.bytes, '<home>/bin/tendril': get('MacOS/tendril'), '<home>/bin/opencode': get('MacOS/opencode') },
      note: 'first launch copies tendril and opencode into <home>/bin (plus a small .provisioned stamp, not counted)',
    });
    e.bytes('v2', 'core-app', get('MacOS/tendril-app') + get('MacOS/tendril'), {
      parts: { 'MacOS/tendril-app': get('MacOS/tendril-app'), 'MacOS/tendril': get('MacOS/tendril') },
      note: 'Tauri host with the frontend embedded (brotli 9) plus the daemon/CLI; Rust links statically, so there are no separate native libraries',
    });
    const opencode = (inp.info?.v2?.sidecars as { opencode?: { version?: unknown } } | undefined)?.opencode;
    e.bytes('v2', 'agent-sidecar', get('MacOS/opencode'), { file: 'Contents/MacOS/opencode', version: `opencode ${str(opencode?.version) ?? '(version unknown)'} (Bun-compiled)` });
    e.bytes('v2', 'bundled-toolchains', 0, { note: 'V2 bundles no SDK or shell' });
    e.bytes('v2', 'updater', 0, { note: 'tauri-plugin-updater is not a dependency; no updater ships' });
    e.bytes('v2', 'server-binary', get('MacOS/tendril'), { file: bins.cli, sha256: sha256File(bins.cli), note: 'daemon and CLI (cargo build --release --bin tendril)' });
    const hostBuf = fs.readFileSync(bins.app);
    const entry = str(inp.info?.v2?.app?.distEntry);
    e.bytes('v2', 'ui-host-binary', hostBuf.length, {
      file: bins.app,
      sha256: sha256(hostBuf),
      embedsDistEntry: entry ? hostBuf.includes(Buffer.from(`/assets/${entry}`)) : null,
      note: 'Tauri desktop host; V1 has no separate one (Ivy.Tendril is also its desktop host)',
    });
    haveApp = true;
  } catch (err) {
    fail('installed-app', err);
  }

  if (haveApp) {
    try {
      const sdir = path.join(work, 'strip');
      fs.mkdirSync(sdir, { recursive: true });
      const sCli = await stripX(bins.cli, sdir);
      const sApp = await stripX(bins.app, sdir);
      e.bytes('v2', 'core-app (strip -x, informational)', sCli + sApp, { informational: true, parts: { 'tendril (strip -x)': sCli, 'tendril-app (strip -x)': sApp } });
      e.bytes('v2', 'server-binary (strip -x, informational)', sCli, { informational: true, note: 'Cargo defaults strip debuginfo only; strip -x also drops local symbols' });
      e.bytes('v2', 'ui-host-binary (strip -x, informational)', sApp, { informational: true });
    } catch (err) {
      fail('core-app (strip -x, informational)', err);
    }
  }

  // Frontend (dist) and the other web payloads compiled into the binaries.
  let dist: Blob[] = [];
  try {
    if (!fs.existsSync(path.join(inp.v2Dist, 'index.html'))) throw new Error(`${inp.v2Dist}/index.html does not exist (run \`setup --only v2-frontend\`)`);
    dist = distBlobs(inp.v2Dist);
    const html = dist.find((b) => b.name === 'index.html')!;
    const refs = indexHtmlRefs(html.data.toString('utf8'));
    if (refs.moduleScripts.length !== 1) throw new Error(`V2 index.html has ${refs.moduleScripts.length} module scripts, expected 1`);
    const assetsDir = path.join(inp.v2Dist, 'assets');
    const entry = resolveDistRef(inp.v2Dist, refs.moduleScripts[0]!);
    const closure = eagerClosure(assetsDir, entry);
    const byName = new Map(dist.map((b) => [b.name, b]));
    const eager = closure.files.map((f) => byName.get(`assets/${f}`)!);
    const preloads = new Set(refs.modulePreloads.map((r) => path.relative(assetsDir, resolveDistRef(inp.v2Dist, r))));
    const closureSet = new Set(closure.files.slice(1));
    const sameAsPreloads = preloads.size === closureSet.size && [...preloads].every((p) => closureSet.has(p));
    if (!sameAsPreloads) notes.push(`V2 eager closure (${closure.files.length} files) differs from index.html's modulepreload list (${preloads.size} + entry)`);
    const rel = (r: string) => path.relative(inp.v2Dist, resolveDistRef(inp.v2Dist, r)).split(path.sep).join('/');
    const css = refs.stylesheets.map((r) => byName.get(rel(r)));
    const fontsPre = refs.fontPreloads.map((r) => byName.get(rel(r)));
    if (css.some((b) => !b) || fontsPre.some((b) => !b)) throw new Error('V2 index.html references a file missing from dist');

    const webviewerDir = path.join(inp.v2Clone, 'src', 'crates', 'tendril-server', 'assets', 'webviewer');
    const webviewer = ['agent.js', 'snapdom.mjs', 'sw.js'].map((f) => ({ name: `webviewer/${f}`, data: fs.readFileSync(path.join(webviewerDir, f)) }));
    const noMap = dist.filter((b) => !MAP_EXT.test(b.name));
    const maps = dist.filter((b) => MAP_EXT.test(b.name));
    const distJs = noMap.filter((b) => /\.js$/i.test(b.name));
    const distMjs = noMap.filter((b) => /\.mjs$/i.test(b.name));
    const allJs = [...distJs, ...distMjs, ...webviewer];

    e.group('v2', 'frontend/eager-js', await totals(c, eager), {
      entry: path.basename(entry),
      closureFiles: closure.files.length,
      closureEqualsModulepreloads: sameAsPreloads,
      note: 'entry chunk plus its static-import closure (the definition in tests/code-splitting.test.tsx)',
    });
    e.child('v2', 'frontend/eager-js', 'entry closure', closure.bytes, 'app', { files: eager.length });
    e.group('v2', 'frontend/eager-css', await totals(c, css as Blob[]), { members: (css as Blob[]).map((b) => b.name) });
    e.group('v2', 'frontend/preloaded-fonts', await totals(c, fontsPre as Blob[]), { note: fontsPre.length ? undefined : 'index.html preloads no fonts' });
    e.group('v2', 'frontend/index-html', await totals(c, [html]));
    e.group('v2', 'frontend/all-js', await totals(c, allJs), { note: 'every shipped JS file: dist assets (eager and lazy), the pdf.js worker (.mjs), webviewer assets compiled into tendril' });
    e.child('v2', 'frontend/all-js', 'dist assets/*.js', rawBytes(distJs), 'app', { files: distJs.length });
    e.child('v2', 'frontend/all-js', 'dist *.mjs (pdf.js worker)', rawBytes(distMjs), 'app', { files: distMjs.length, members: distMjs.map((b) => b.name) });
    e.child('v2', 'frontend/all-js', 'webviewer proxy assets', rawBytes(webviewer), 'webviewer', { files: webviewer.length });
    e.group('v2', 'frontend/all-css', await totals(c, noMap.filter((b) => /\.css$/i.test(b.name))));
    e.group('v2', 'frontend/fonts', await totals(c, noMap.filter((b) => FONT_EXT.test(b.name))), { note: 'none preloaded' });
    e.group('v2', 'frontend/sourcemaps', await totals(c, maps), { note: maps.length ? undefined : 'the production build emits no source maps' });
    e.group('v2', 'frontend/total-shipped', await totals(c, [...noMap, ...webviewer]), { note: 'every frontend file shipped (dist plus webviewer assets), source maps excluded' });
    // tauri-codegen brotli-compresses each dist file at quality 9 in release builds and embeds the
    // result; the webviewer assets are include_bytes!, i.e. raw. Node's brotli is the reference C
    // encoder, tauri uses the Rust port, and tauri injects CSP hashes into index.html first, so
    // this is close to, not exactly, the bytes in __TEXT.
    const br9 = (await Promise.all(dist.map((b) => c.brotli9(b.data)))).reduce((s, n) => s + n, 0);
    e.bytes('v2', 'frontend/as-embedded-in-binary', br9 + rawBytes(webviewer), {
      informational: true,
      parts: { 'dist, brotli 9 per file (tauri-codegen)': br9, 'webviewer assets, raw (include_bytes!)': rawBytes(webviewer) },
      note: 'frontend bytes the binaries carry; approximate for the dist part (see the suite source)',
    });
    e.group('v2', 'frontend/webviewer-proxy-assets', await totals(c, webviewer), { members: webviewer.map((b) => b.name), note: 'compiled into tendril (tendril-server webviewer)' });
    ctx.log.info(`v2 frontend: eager JS ${closure.bytes} B (${closure.files.length} chunks), all JS ${rawBytes(allJs)} B`);
  } catch (err) {
    fail('frontend', err);
  }

  try {
    const artifacts = path.join(inp.v2Clone, 'src', 'crates', 'tendril-wireframe', 'artifacts');
    if (!fs.existsSync(artifacts)) throw new Error(`${artifacts} does not exist (run \`setup --only v2-wireframe\`)`);
    const w = wireframePayloadBytes(artifacts);
    // Cross-check against what cargo actually packed, when a build dir holds it.
    const buildDir = path.join(inp.v2Clone, 'target', 'release', 'build');
    const packed = fs.existsSync(buildDir)
      ? fs.readdirSync(buildDir).filter((d) => d.startsWith('tendril-wireframe-')).map((d) => path.join(buildDir, d, 'out', 'payload.bin')).filter((p) => fs.existsSync(p))
      : [];
    const packedSizes = packed.map((p) => fileBytes(p));
    if (packedSizes.length && !packedSizes.includes(w.bytes)) notes.push(`V2 wireframe payload computed as ${w.bytes} B but target/release holds ${packedSizes.join(', ')} B`);
    e.bytes('v2', 'frontend/wireframe-payload', w.bytes, {
      files: w.files,
      contentBytes: w.contentBytes,
      matchesCargoPayload: packedSizes.length ? packedSizes.includes(w.bytes) : null,
      note: 'vendor JS bundle, CSS, fonts, type definitions and component manifest for wireframe prototypes, embedded uncompressed in tendril (include_bytes!); V1 v1.2.4 has no counterpart',
    });
  } catch (err) {
    fail('frontend/wireframe-payload', err);
  }
}

// ---------------------------------------------------------------------------------------------

function crossCheckV1(r: SuiteResult, notes: string[]): void {
  const got = new Map(r.metrics.filter((m) => m.app === 'v1' && m.metric === 'bytes').map((m) => [m.scenario, m.samples[0]!]));
  const diffs: string[] = [];
  let same = 0;
  for (const [k, want] of Object.entries(V1_RESEARCH)) {
    const v = got.get(k);
    if (v === undefined) continue;
    if (v === want) same++;
    else diffs.push(`${k}: ${v} B vs ${want} B in the research`);
  }
  if (diffs.length) notes.push(`V1 differs from the research measurements of the same release: ${diffs.join('; ')}`);
  else if (same) notes.push(`V1: all ${same} figures that the research also measured match it to the byte`);
}

export async function run(ctx: SuiteContext): Promise<SuiteResult> {
  const r = newSuiteResult(SUITE, ctx.runId, ctx.profile);
  const e = new Emit(r);
  const c = new Compressor();
  const apps = new Set<AppId>(ctx.apps.length ? ctx.apps.map((a) => a.id) : APP_IDS);
  const inp = resolveInputs(ctx);
  if (!inp.info) r.notes.push(`no ${ctx.paths.buildInfo}: artifact paths fall back to the workspace defaults`);
  // Scratch space under the run dir (never the shared artifacts), removed afterwards.
  const work = fs.mkdtempSync(path.join(ctx.runDir, '.size-work-'));
  const t0 = performance.now();
  try {
    const v1Notes: string[] = [];
    const v2Notes: string[] = [];
    if (apps.has('v1')) await measureV1(ctx, e, c, inp, work, v1Notes);
    if (apps.has('v2')) await measureV2(ctx, e, c, inp, work, v2Notes);
    if (apps.has('v1')) crossCheckV1(r, v1Notes);
    r.notes.push(...v1Notes, ...v2Notes);
    r.notes.push(
      'sizes are apparent bytes of regular files (symlinks not followed, never du); compressed sizes are per file (Node zlib: gzip level 9, brotli quality 11), which can differ from the gzip/brotli CLIs by a few bytes per file',
      "V2's cargo target dirs (including the IPC shim's, which holds tauri-build's copies of the sidecars) are never walked: only the bundled .app, the .dmg and the dist are counted",
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  ctx.log.info(`size: ${r.metrics.length} metric(s), ${r.failures.length} failure(s) in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  return r;
}
