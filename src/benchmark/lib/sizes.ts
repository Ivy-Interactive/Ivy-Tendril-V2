// Byte counting for the size suite. Sizes are apparent bytes (lstat size of regular files), never
// `du`: block rounding and APFS clones/compression would make the numbers depend on the disk rather
// than on what ships. Compressed sizes use Node's zlib (gzip level 9, brotli quality 11 and 9), per
// file, which is how assets travel over HTTP; they can differ from the gzip/brotli CLIs by a few
// bytes per file.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ---------------------------------------------------------------------------------------------
// Files and directories

/** Size of one file (follows a symlink to its target; throws if it is not a regular file). */
export function fileBytes(p: string): number {
  const st = fs.statSync(p);
  if (!st.isFile()) throw new Error(`${p} is not a regular file`);
  return st.size;
}

export interface FileEntry {
  /** Path relative to the walked root, with forward slashes. */
  rel: string;
  abs: string;
  bytes: number;
}

export interface DirTotals {
  bytes: number;
  files: number;
  symlinks: number;
  dirs: number;
}

export type Exclude = RegExp | ((rel: string) => boolean);

function excluded(rel: string, exclude: Exclude[] | undefined): boolean {
  if (!exclude) return false;
  return exclude.some((e) => (typeof e === 'function' ? e(rel) : e.test(rel)));
}

/**
 * Every regular file under `dir`, sorted by relative path. Symlinks are not followed (and not
 * counted: a bundle's symlinked frameworks would otherwise count twice). `exclude` patterns match
 * the relative path of files and directories alike.
 */
export function listFiles(dir: string, opts: { exclude?: Exclude[] } = {}): FileEntry[] {
  const out: FileEntry[] = [];
  const walk = (abs: string, rel: string) => {
    const entries = fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (excluded(r, opts.exclude)) continue;
      const a = path.join(abs, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(a, r);
      else if (e.isFile()) out.push({ rel: r, abs: a, bytes: fs.lstatSync(a).size });
    }
  };
  walk(dir, '');
  return out;
}

/** Apparent bytes and counts of a tree (regular files only; symlinks counted separately). */
export function dirBytes(dir: string, opts: { exclude?: Exclude[] } = {}): DirTotals {
  const t: DirTotals = { bytes: 0, files: 0, symlinks: 0, dirs: 0 };
  const walk = (abs: string, rel: string) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (excluded(r, opts.exclude)) continue;
      const a = path.join(abs, e.name);
      if (e.isSymbolicLink()) t.symlinks++;
      else if (e.isDirectory()) {
        t.dirs++;
        walk(a, r);
      } else if (e.isFile()) {
        t.files++;
        t.bytes += fs.lstatSync(a).size;
      }
    }
  };
  walk(dir, '');
  return t;
}

// ---------------------------------------------------------------------------------------------
// Compression

export function gzipBytes(buf: Buffer, level = 9): number {
  return zlib.gzipSync(buf, { level }).length;
}

export function brotliBytes(buf: Buffer, quality = 11): number {
  return zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  }).length;
}

export interface CompressedSizes {
  raw: number;
  gzip9: number;
  brotli11: number;
  brotli9: number;
}

export function compressedSizes(buf: Buffer): CompressedSizes {
  return { raw: buf.length, gzip9: gzipBytes(buf, 9), brotli11: brotliBytes(buf, 11), brotli9: brotliBytes(buf, 9) };
}

export interface GroupSizes extends CompressedSizes {
  files: number;
  /** Per file, sorted by path, so a report can show what dominates. */
  perFile: Array<{ name: string } & CompressedSizes>;
}

/** Sums per-file compressed sizes over a group of files (each file compressed on its own). */
export function groupSizes(files: ReadonlyArray<string | { name: string; data: Buffer }>): GroupSizes {
  const perFile = files
    .map((f) => (typeof f === 'string' ? { name: f, ...compressedSizes(fs.readFileSync(f)) } : { name: f.name, ...compressedSizes(f.data) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const sum = (k: keyof CompressedSizes) => perFile.reduce((s, f) => s + f[k], 0);
  return { files: perFile.length, raw: sum('raw'), gzip9: sum('gzip9'), brotli11: sum('brotli11'), brotli9: sum('brotli9'), perFile };
}

// ---------------------------------------------------------------------------------------------
// Frontend: eager closure

/**
 * A static import of a sibling chunk in minified Vite/Rolldown output: `from"./x.js"` or
 * `import"./x.js"`. Dynamic `import("./x.js")` has a paren in between and does not match, which is
 * the point. This is the V2 repo's own definition (src/apps/tendril-app/tests/code-splitting.test.tsx).
 */
export const STATIC_CHUNK_IMPORT = /(?:from|import)\s*"\.\/([^"]+\.js)"/g;

export interface EagerClosure {
  /** Relative to the assets dir, entry first, then in discovery (BFS) order. */
  files: string[];
  bytes: number;
}

/**
 * The entry chunk plus its transitive static imports: everything the browser must have evaluated
 * before the entry's own code runs. `entryFile` is relative to `distAssetsDir` (or absolute).
 */
export function eagerClosure(distAssetsDir: string, entryFile: string): EagerClosure {
  const entry = path.isAbsolute(entryFile) ? path.relative(distAssetsDir, entryFile) : entryFile;
  const reached = new Set<string>([entry]);
  const queue = [entry];
  let bytes = 0;
  while (queue.length) {
    const rel = queue.shift()!;
    const buf = fs.readFileSync(path.join(distAssetsDir, rel));
    // Count the bytes on disk, and scan as latin1 so a stray invalid UTF-8 sequence cannot shift
    // anything (the import pattern is pure ASCII).
    bytes += buf.length;
    const src = buf.toString('latin1');
    for (const m of src.matchAll(STATIC_CHUNK_IMPORT)) {
      // Chunks import siblings relative to themselves; all chunks live flat in assets/.
      const next = path.posix.join(path.posix.dirname(rel), m[1]!);
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return { files: [...reached], bytes };
}

export interface IndexHtmlRefs {
  /** `<script type="module" src>` entries. */
  moduleScripts: string[];
  /** Classic `<script src>` entries. */
  scripts: string[];
  modulePreloads: string[];
  stylesheets: string[];
  /** `<link rel="preload" as="font">`. */
  fontPreloads: string[];
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? null) : null;
}

/** Asset references in an index.html, as written (e.g. `/assets/index-abc.js`). */
export function indexHtmlRefs(html: string): IndexHtmlRefs {
  const refs: IndexHtmlRefs = { moduleScripts: [], scripts: [], modulePreloads: [], stylesheets: [], fontPreloads: [] };
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attr(tag, 'src');
    if (!src) continue;
    if ((attr(tag, 'type') ?? '').toLowerCase() === 'module') refs.moduleScripts.push(src);
    else refs.scripts.push(src);
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    const href = attr(tag, 'href');
    if (!href) continue;
    if (rel === 'modulepreload') refs.modulePreloads.push(href);
    else if (rel === 'stylesheet') refs.stylesheets.push(href);
    else if (rel === 'preload' && (attr(tag, 'as') ?? '').toLowerCase() === 'font') refs.fontPreloads.push(href);
  }
  return refs;
}

/** Resolves an index.html reference (`/assets/x.js`, `./assets/x.js`) against the dist root. */
export function resolveDistRef(distRoot: string, ref: string): string {
  const clean = ref.split(/[?#]/)[0]!.replace(/^\.?\//, '');
  return path.join(distRoot, clean);
}

// ---------------------------------------------------------------------------------------------
// .NET single-file bundles (V1's Ivy.Tendril)

/** Marker the .NET host embeds right after the 8-byte bundle header offset. */
const BUNDLE_SIGNATURE = Buffer.from([
  0x8b, 0x12, 0x02, 0xb9, 0x6a, 0x61, 0x20, 0x38, 0x72, 0x7b, 0x93, 0x02, 0x14, 0xd7, 0xa0, 0x32, 0x13, 0xf5, 0xb9, 0xe6, 0xef, 0xae,
  0x33, 0x18, 0xee, 0x3b, 0x2d, 0xce, 0x24, 0xb3, 0x6a, 0xae,
]);

export const BUNDLE_FILE_TYPES = ['Unknown', 'Assembly', 'NativeBinary', 'DepsJson', 'RuntimeConfigJson', 'Symbols'] as const;

export interface BundleEntry {
  offset: number;
  size: number;
  /** 0 when stored uncompressed (the case for Tendril's bundle). */
  compressedSize: number;
  type: string;
  path: string;
}

export interface BundleManifest {
  file: string;
  fileSize: number;
  major: number;
  minor: number;
  bundleId: string;
  headerOffset: number;
  /** Bytes before the first embedded file: the native host (singlefilehost with coreclr). */
  hostPrefixBytes: number;
  entries: BundleEntry[];
}

function findSignature(fd: number, fileSize: number): number {
  const chunk = 8 * 1024 * 1024;
  const buf = Buffer.alloc(chunk + BUNDLE_SIGNATURE.length);
  let carry = 0;
  for (let pos = 0; pos < fileSize; pos += chunk) {
    const n = fs.readSync(fd, buf, carry, chunk, pos);
    if (n <= 0) break;
    const hay = buf.subarray(0, carry + n);
    const i = hay.indexOf(BUNDLE_SIGNATURE);
    if (i >= 0) return pos - carry + i;
    // Keep the tail so a signature straddling two chunks is still found.
    carry = Math.min(BUNDLE_SIGNATURE.length - 1, hay.length);
    hay.copy(buf, 0, hay.length - carry);
  }
  return -1;
}

/**
 * Parses the manifest of a .NET single-file bundle (format v2+; v6 adds compressed sizes). Reads
 * only the host's signature area and the manifest, not the whole 160 MB file.
 */
export function parseSingleFileBundle(file: string): BundleManifest {
  const fd = fs.openSync(file, 'r');
  try {
    const fileSize = fs.fstatSync(fd).size;
    const sig = findSignature(fd, fileSize);
    if (sig < 8) throw new Error(`${file}: no .NET single-file bundle signature`);
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, sig - 8);
    const headerOffset = Number(head.readBigInt64LE(0));
    if (headerOffset <= 0 || headerOffset >= fileSize) throw new Error(`${file}: bundle header offset ${headerOffset} out of range`);
    const manifest = Buffer.alloc(Math.min(fileSize - headerOffset, 4 * 1024 * 1024));
    fs.readSync(fd, manifest, 0, manifest.length, headerOffset);
    let p = 0;
    const i32 = () => {
      const v = manifest.readInt32LE(p);
      p += 4;
      return v;
    };
    const i64 = () => {
      const v = Number(manifest.readBigInt64LE(p));
      p += 8;
      return v;
    };
    const str = () => {
      // 7-bit encoded length prefix (BinaryWriter.Write(string)).
      let len = 0;
      let shift = 0;
      for (;;) {
        const b = manifest[p++]!;
        len |= (b & 0x7f) << shift;
        shift += 7;
        if (b < 0x80) break;
      }
      const s = manifest.toString('utf8', p, p + len);
      p += len;
      return s;
    };
    const major = i32();
    const minor = i32();
    const count = i32();
    const bundleId = str();
    if (major >= 2) {
      // deps.json offset/size, runtimeconfig.json offset/size, flags.
      p += 8 * 4 + 8;
    }
    const entries: BundleEntry[] = [];
    for (let k = 0; k < count; k++) {
      const offset = i64();
      const size = i64();
      const compressedSize = major >= 6 ? i64() : 0;
      const t = manifest[p++]!;
      entries.push({ offset, size, compressedSize, type: BUNDLE_FILE_TYPES[t] ?? String(t), path: str() });
    }
    const hostPrefixBytes = entries.reduce((m, e) => Math.min(m, e.offset), fileSize);
    return { file, fileSize, major, minor, bundleId, headerOffset, hostPrefixBytes, entries };
  } finally {
    fs.closeSync(fd);
  }
}

/** Bytes of one bundled file (entries stored compressed are inflated). */
export function readBundleEntry(manifest: BundleManifest, entry: BundleEntry): Buffer {
  const len = entry.compressedSize || entry.size;
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(manifest.file, 'r');
  try {
    fs.readSync(fd, buf, 0, len, entry.offset);
  } finally {
    fs.closeSync(fd);
  }
  return entry.compressedSize ? zlib.inflateRawSync(buf) : buf;
}
