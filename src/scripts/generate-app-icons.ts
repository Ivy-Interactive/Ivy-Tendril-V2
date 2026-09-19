#!/usr/bin/env node
/**
 * Regenerates the Tauri desktop icon set for the Tendril app.
 *
 *   pnpm tsx src/scripts/generate-app-icons.ts            # regenerate the set
 *   pnpm tsx src/scripts/generate-app-icons.ts --check    # verify, rewrite nothing
 *
 * Why this script exists
 * ----------------------
 * The icon set under `src/apps/tendril-app/src-tauri/icons/` is binary, so it
 * cannot be reviewed by reading the diff. This script is the provenance record:
 * every committed icon is reproducible from `app-icon.svg` by running it.
 *
 * How it works
 * ------------
 * 1. The source is a *vector* mark (`app-icon.svg`), so every raster size is
 *    rendered from the vector rather than resampled from a small bitmap.
 * 2. The mark in the brand SVG is framed full-bleed: its viewBox is cropped so
 *    tightly that the artwork touches the top and bottom edges. An app icon
 *    drawn edge-to-edge looks oversized next to its neighbours in the macOS
 *    Dock. So we measure the mark's true bounds with a high-resolution probe
 *    render, then emit a wrapper SVG that centres the mark in a square canvas
 *    at CONTENT_FRACTION of the canvas size. This is done in vector space, so
 *    no fidelity is lost.
 * 3. `tauri icon` renders the wrapper to the full set, including the multi-
 *    resolution macOS `.icns` and the Windows `.ico`.
 * 4. Mobile and Microsoft-Store outputs are pruned: this app only bundles
 *    nsis/msi/dmg/app/deb/appimage, and unreferenced binaries are noise.
 * 5. The result is verified: correct dimensions, a transparent (not opaque)
 *    background, non-uniform pixels (a solid square is the bug this replaces),
 *    and an `.icns` carrying the whole 16..1024 ladder.
 *
 * No network access is required; the Tauri CLI is resolved from node_modules.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appDir = path.join(repoRoot, "src/apps/tendril-app");
export const iconsDir = path.join(appDir, "src-tauri/icons");
const sourceSvgPath = path.join(iconsDir, "app-icon.svg");
const brandSvgPath = path.join(repoRoot, "src/extensions/vscode/resources/icon.svg");
const tauriCli = path.join(appDir, "node_modules/.bin/tauri");

/** Square canvas the mark is composed onto, in SVG user units. */
const CANVAS = 1024;
/** Fraction of the canvas the mark spans; 0.8 leaves a 10% margin per side. */
const CONTENT_FRACTION = 0.8;
/** Probe render size used to measure the mark's true bounds. */
const PROBE_SIZE = 2048;

/** Files `tauri icon` emits that this desktop-only app does not bundle. */
const PRUNE_DIRS = ["android", "ios"];
const PRUNE_FILE_PATTERN = /^(Square\d+x\d+Logo|StoreLogo)\.png$/;

/** The icons that are committed, and that `bundle.icon` must list. */
export const EXPECTED_ICONS = [
  { file: "32x32.png", width: 32, height: 32 },
  { file: "64x64.png", width: 64, height: 64 },
  { file: "128x128.png", width: 128, height: 128 },
  { file: "128x128@2x.png", width: 256, height: 256 },
  { file: "icon.png", width: 512, height: 512 },
] as const;

/**
 * Every `.icns` slot Apple expects, as OSType codes. A single-size `.icns` is
 * accepted by the bundler but renders blurry in Finder and wrong in the Dock,
 * so the full ladder is asserted rather than assumed.
 */
export const EXPECTED_ICNS_TYPES = [
  "is32", // 16x16 (classic 1-bit-mask pair)
  "s8mk",
  "il32", // 32x32 (classic)
  "l8mk",
  "ic11", // 16x16@2x
  "ic12", // 32x32@2x
  "ic07", // 128x128
  "ic13", // 128x128@2x
  "ic08", // 256x256
  "ic14", // 256x256@2x
  "ic09", // 512x512
  "ic10", // 512x512@2x (1024x1024)
] as const;

export interface DecodedPng {
  width: number;
  height: number;
  channels: number;
  /** Interleaved 8-bit samples, `channels` per pixel. */
  data: Buffer;
}

/**
 * Minimal PNG decoder for 8-bit non-interlaced RGB/RGBA/grey images, which is
 * everything `tauri icon` emits. Avoids adding an image dependency just to
 * assert that the icons are not a flat colour.
 */
export function decodePng(buffer: Buffer): DecodedPng {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature)) {
    throw new Error("not a PNG");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const bitDepth = body[8];
      const colorType = body[9];
      const interlace = body[12];
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
      if (interlace !== 0) throw new Error("interlaced PNG unsupported");
      const channelsByColorType: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
      channels = channelsByColorType[colorType] ?? 0;
      if (!channels) throw new Error(`unsupported colour type ${colorType}`);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(body));
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);

  // Undo the per-scanline filters (PNG spec section 9).
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);

    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      const v = line[x];
      switch (filter) {
        case 0:
          cur[x] = v;
          break;
        case 1:
          cur[x] = (v + a) & 0xff;
          break;
        case 2:
          cur[x] = (v + b) & 0xff;
          break;
        case 3:
          cur[x] = (v + ((a + b) >> 1)) & 0xff;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          cur[x] = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default:
          throw new Error(`unknown PNG filter ${filter}`);
      }
    }
  }

  return { width, height, channels, data: out };
}

export interface PngStats {
  width: number;
  height: number;
  hasAlpha: boolean;
  /** True when every pixel is identical, i.e. a flat placeholder square. */
  uniform: boolean;
  /** Alpha of the four corner pixels; 0 means a transparent background. */
  cornerAlpha: number[];
  /** Bounds of pixels with alpha above the threshold, or null when empty. */
  bounds: { x0: number; y0: number; x1: number; y1: number } | null;
}

export function inspectPng(buffer: Buffer, alphaThreshold = 8): PngStats {
  const { width, height, channels, data } = decodePng(buffer);
  const hasAlpha = channels === 2 || channels === 4;
  const alphaIndex = channels - 1;

  let uniform = true;
  const first = data.subarray(0, channels);
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (uniform) {
        for (let c = 0; c < channels; c++) {
          if (data[i + c] !== first[c]) {
            uniform = false;
            break;
          }
        }
      }
      const alpha = hasAlpha ? data[i + alphaIndex] : 255;
      if (alpha > alphaThreshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }

  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];

  return {
    width,
    height,
    hasAlpha,
    uniform,
    cornerAlpha: corners.map(([x, y]) =>
      hasAlpha ? data[(y * width + x) * channels + alphaIndex] : 255,
    ),
    bounds: x1 < 0 ? null : { x0, y0, x1, y1 },
  };
}

export interface IcnsEntry {
  type: string;
  byteLength: number;
  /** Pixel size when the slot holds a PNG; null for the classic raw slots. */
  pixels: number | null;
}

/** Reads the `.icns` table of contents so its resolutions can be asserted. */
export function listIcnsEntries(buffer: Buffer): IcnsEntry[] {
  if (buffer.toString("latin1", 0, 4) !== "icns") {
    throw new Error("not an ICNS file");
  }
  const entries: IcnsEntry[] = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("latin1", offset, offset + 4);
    const length = buffer.readUInt32BE(offset + 4);
    if (length < 8) break;
    const body = buffer.subarray(offset + 8, offset + length);
    let pixels: number | null = null;
    if (body.subarray(0, 4).toString("latin1") === "\x89PNG") {
      pixels = body.readUInt32BE(16);
    }
    entries.push({ type, byteLength: length, pixels });
    offset += length;
  }
  return entries;
}

function parseViewBox(svg: string): { x: number; y: number; w: number; h: number } {
  const match = svg.match(/viewBox\s*=\s*"([^"]+)"/);
  if (!match) throw new Error("source SVG has no viewBox");
  const [x, y, w, h] = match[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if ([x, y, w, h].some((n) => !Number.isFinite(n))) {
    throw new Error(`unparsable viewBox: ${match[1]}`);
  }
  return { x, y, w, h };
}

function innerMarkup(svg: string): string {
  const open = svg.indexOf(">", svg.indexOf("<svg"));
  const close = svg.lastIndexOf("</svg>");
  if (open < 0 || close < 0) throw new Error("malformed SVG");
  return svg.slice(open + 1, close).trim();
}

function run(cli: string, args: string[]): void {
  execFileSync(cli, args, { cwd: appDir, stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Renders the source once at high resolution and converts the opaque-pixel
 * bounds back into SVG user units.
 */
function measureMarkBounds(
  svgPath: string,
  viewBox: { x: number; y: number; w: number; h: number },
  tmpDir: string,
): { x0: number; y0: number; w: number; h: number } {
  const probeDir = path.join(tmpDir, "probe");
  fs.mkdirSync(probeDir, { recursive: true });
  run(tauriCli, ["icon", "-p", String(PROBE_SIZE), "-o", probeDir, svgPath]);

  const probePng = path.join(probeDir, `${PROBE_SIZE}x${PROBE_SIZE}.png`);
  const { bounds } = inspectPng(fs.readFileSync(probePng));
  if (!bounds) throw new Error("source SVG rendered to an empty image");

  // Bounds are inclusive pixel indices; add one to reach the trailing edge.
  return {
    x0: viewBox.x + (bounds.x0 / PROBE_SIZE) * viewBox.w,
    y0: viewBox.y + (bounds.y0 / PROBE_SIZE) * viewBox.h,
    w: ((bounds.x1 + 1 - bounds.x0) / PROBE_SIZE) * viewBox.w,
    h: ((bounds.y1 + 1 - bounds.y0) / PROBE_SIZE) * viewBox.h,
  };
}

/** Centres the mark in a square canvas with a uniform margin, in vector space. */
export function buildPaddedSvg(
  inner: string,
  mark: { x0: number; y0: number; w: number; h: number },
): string {
  const scale = (CANVAS * CONTENT_FRACTION) / Math.max(mark.w, mark.h);
  const tx = (CANVAS - mark.w * scale) / 2 - mark.x0 * scale;
  const ty = (CANVAS - mark.h * scale) / 2 - mark.y0 * scale;
  const round = (n: number) => Number(n.toFixed(4));

  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by src/scripts/generate-app-icons.ts. Do not edit by hand. -->
<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
 <g transform="translate(${round(tx)} ${round(ty)}) scale(${round(scale)})">
${inner
  .split("\n")
  .map((line) => `  ${line.trim()}`)
  .join("\n")}
 </g>
</svg>
`;
}

function verify(): string[] {
  const problems: string[] = [];

  for (const { file, width, height } of EXPECTED_ICONS) {
    const filePath = path.join(iconsDir, file);
    if (!fs.existsSync(filePath)) {
      problems.push(`${file}: missing`);
      continue;
    }
    const stats = inspectPng(fs.readFileSync(filePath));
    if (stats.width !== width || stats.height !== height) {
      problems.push(`${file}: expected ${width}x${height}, got ${stats.width}x${stats.height}`);
    }
    if (stats.uniform) {
      problems.push(`${file}: every pixel is identical (placeholder square)`);
    }
    if (!stats.hasAlpha) {
      problems.push(`${file}: no alpha channel`);
    } else if (stats.cornerAlpha.some((a) => a !== 0)) {
      problems.push(`${file}: opaque background (corner alpha ${stats.cornerAlpha.join(",")})`);
    }
  }

  const icnsPath = path.join(iconsDir, "icon.icns");
  if (!fs.existsSync(icnsPath)) {
    problems.push("icon.icns: missing");
  } else {
    const types = new Set(listIcnsEntries(fs.readFileSync(icnsPath)).map((e) => e.type));
    const missing = EXPECTED_ICNS_TYPES.filter((t) => !types.has(t));
    if (missing.length) {
      problems.push(`icon.icns: missing resolution slots ${missing.join(", ")}`);
    }
  }

  const icoPath = path.join(iconsDir, "icon.ico");
  if (!fs.existsSync(icoPath)) {
    problems.push("icon.ico: missing");
  } else if (fs.readFileSync(icoPath).length < 2048) {
    problems.push("icon.ico: implausibly small, likely a placeholder");
  }

  return problems;
}

function report(): void {
  console.log(`\nicons in ${path.relative(repoRoot, iconsDir)}:`);
  for (const { file } of EXPECTED_ICONS) {
    const stats = inspectPng(fs.readFileSync(path.join(iconsDir, file)));
    const b = stats.bounds;
    const margin = b ? Math.min(b.x0, b.y0, stats.width - 1 - b.x1, stats.height - 1 - b.y1) : 0;
    console.log(
      `  ${file.padEnd(15)} ${`${stats.width}x${stats.height}`.padEnd(9)}` +
        ` alpha=${stats.hasAlpha ? "yes" : "no"} cornerAlpha=${stats.cornerAlpha[0]}` +
        ` minMargin=${margin}px`,
    );
  }

  const entries = listIcnsEntries(fs.readFileSync(path.join(iconsDir, "icon.icns")));
  console.log(`\nicon.icns carries ${entries.length} slots:`);
  for (const e of entries) {
    console.log(
      `  ${e.type}  ${String(e.byteLength).padStart(7)} bytes  ` +
        (e.pixels ? `${e.pixels}x${e.pixels} PNG` : "classic raw/mask"),
    );
  }
}

function main(): void {
  const checkOnly = process.argv.includes("--check");

  if (!checkOnly) {
    if (!fs.existsSync(tauriCli)) {
      throw new Error(
        `Tauri CLI not found at ${tauriCli}. Run \`pnpm install\` first (no network needed if the store is warm).`,
      );
    }
    if (!fs.existsSync(sourceSvgPath)) {
      throw new Error(`source art missing: ${sourceSvgPath}`);
    }

    // The vendored copy is the build input; warn if the brand mark has moved on.
    if (fs.existsSync(brandSvgPath)) {
      const vendored = fs.readFileSync(sourceSvgPath, "utf8");
      const brand = fs.readFileSync(brandSvgPath, "utf8");
      if (vendored !== brand) {
        console.warn(
          `warning: ${path.relative(repoRoot, sourceSvgPath)} differs from ` +
            `${path.relative(repoRoot, brandSvgPath)}; the app icon may be out of date.`,
        );
      }
    }

    const svg = fs.readFileSync(sourceSvgPath, "utf8");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tendril-icons-"));
    try {
      const mark = measureMarkBounds(sourceSvgPath, parseViewBox(svg), tmpDir);
      console.log(
        `measured mark bounds in source units: ` +
          `x0=${mark.x0.toFixed(2)} y0=${mark.y0.toFixed(2)} ` +
          `w=${mark.w.toFixed(2)} h=${mark.h.toFixed(2)}`,
      );

      const paddedPath = path.join(tmpDir, "app-icon-padded.svg");
      fs.writeFileSync(paddedPath, buildPaddedSvg(innerMarkup(svg), mark));

      run(tauriCli, ["icon", "-o", iconsDir, paddedPath]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // Drop outputs this desktop-only app never bundles.
    for (const dir of PRUNE_DIRS) {
      fs.rmSync(path.join(iconsDir, dir), { recursive: true, force: true });
    }
    for (const entry of fs.readdirSync(iconsDir)) {
      if (PRUNE_FILE_PATTERN.test(entry)) {
        fs.rmSync(path.join(iconsDir, entry));
      }
    }
  }

  const problems = verify();
  if (problems.length) {
    console.error("\nicon verification failed:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  report();
  console.log(`\nall icon checks passed${checkOnly ? " (check only, nothing rewritten)" : ""}.`);
}

const invokedDirectly =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main();
}
