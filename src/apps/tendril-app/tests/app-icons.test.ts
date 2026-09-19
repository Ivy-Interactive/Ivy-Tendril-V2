import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  EXPECTED_ICNS_TYPES,
  EXPECTED_ICONS,
  buildPaddedSvg,
  iconsDir,
  inspectPng,
  listIcnsEntries,
} from "../../../scripts/generate-app-icons";

const srcTauriDir = path.join(__dirname, "..", "src-tauri");
const tauriConfPath = path.join(srcTauriDir, "tauri.conf.json");

interface TauriConf {
  bundle: { icon: string[] };
}

const readConf = (): TauriConf => JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));

describe("desktop app icons", () => {
  // The bug this guards: every icon was a flat #1E293B square, so the app
  // showed a plain grey tile in the Dock.
  it.each(EXPECTED_ICONS)("$file is real artwork, not a flat placeholder", ({ file }) => {
    const stats = inspectPng(fs.readFileSync(path.join(iconsDir, file)));
    expect(stats.uniform).toBe(false);
  });

  it.each(EXPECTED_ICONS)("$file has the expected dimensions", ({ file, width, height }) => {
    const stats = inspectPng(fs.readFileSync(path.join(iconsDir, file)));
    expect([stats.width, stats.height]).toEqual([width, height]);
  });

  // A white or grey box behind the mark looks identical to the placeholder bug.
  it.each(EXPECTED_ICONS)("$file has a transparent background", ({ file }) => {
    const stats = inspectPng(fs.readFileSync(path.join(iconsDir, file)));
    expect(stats.hasAlpha).toBe(true);
    expect(stats.cornerAlpha).toEqual([0, 0, 0, 0]);
  });

  // Full-bleed artwork looks oversized in the Dock next to other apps.
  it.each(EXPECTED_ICONS)("$file keeps a margin around the mark", ({ file }) => {
    const stats = inspectPng(fs.readFileSync(path.join(iconsDir, file)));
    const bounds = stats.bounds;
    expect(bounds).not.toBeNull();
    if (!bounds) return;

    const margins = [
      bounds.x0,
      bounds.y0,
      stats.width - 1 - bounds.x1,
      stats.height - 1 - bounds.y1,
    ];
    // ~10% per side; allow a pixel of slack for anti-aliasing at small sizes.
    const minExpected = Math.floor(stats.width * 0.1) - 1;
    for (const margin of margins) {
      expect(margin).toBeGreaterThanOrEqual(minExpected);
    }
  });

  describe("icon.icns", () => {
    const entries = listIcnsEntries(fs.readFileSync(path.join(iconsDir, "icon.icns")));

    // A single-size .icns still bundles, but renders blurry in Finder and
    // wrong in the Dock. Assert the whole 16..1024 ladder is present.
    it.each(EXPECTED_ICNS_TYPES)("carries the %s slot", (type) => {
      expect(entries.map((e) => e.type)).toContain(type);
    });

    it("embeds PNG slots from 32 up to 1024 pixels", () => {
      const pixelSizes = entries
        .map((e) => e.pixels)
        .filter((p): p is number => p !== null)
        .sort((a, b) => a - b);
      expect(pixelSizes).toEqual([32, 64, 128, 256, 256, 512, 512, 1024]);
    });
  });

  describe("icon.ico", () => {
    const ico = fs.readFileSync(path.join(iconsDir, "icon.ico"));

    it("declares multiple embedded sizes", () => {
      expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(5);
    });

    it("includes a 256x256 entry", () => {
      const count = ico.readUInt16LE(4);
      const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16] || 256);
      expect(sizes).toContain(256);
    });
  });

  describe("tauri.conf.json bundle.icon", () => {
    it("lists every generated icon file", () => {
      const listed = readConf().bundle.icon;
      const generated = fs
        .readdirSync(iconsDir)
        .filter((f) => /\.(png|icns|ico)$/.test(f))
        .map((f) => `icons/${f}`)
        .sort();
      expect([...listed].sort()).toEqual(generated);
    });

    it("resolves every entry relative to src-tauri/", () => {
      for (const entry of readConf().bundle.icon) {
        expect(fs.existsSync(path.join(srcTauriDir, entry))).toBe(true);
      }
    });

    it("includes the platform bundle icons macOS and Windows need", () => {
      const listed = readConf().bundle.icon;
      expect(listed).toContain("icons/icon.icns");
      expect(listed).toContain("icons/icon.ico");
    });
  });

  describe("source art", () => {
    it("keeps a vector source alongside the generated rasters", () => {
      const svg = fs.readFileSync(path.join(iconsDir, "app-icon.svg"), "utf8");
      expect(svg).toContain("<svg");
      // No opaque backdrop behind the mark.
      expect(svg).not.toMatch(/<rect[^>]*\bfill="#?(fff|ffffff|white)"/i);
    });
  });

  describe("buildPaddedSvg", () => {
    it("centres a wide mark on a square canvas", () => {
      const svg = buildPaddedSvg('<path d="M0 0"/>', { x0: 0, y0: 0, w: 400, h: 200 });
      const match = svg.match(/translate\((-?[\d.]+) (-?[\d.]+)\) scale\(([\d.]+)\)/);
      expect(match).not.toBeNull();
      if (!match) return;

      const [, tx, ty, scale] = match.map(Number);
      // Longest side (400) scales to 80% of 1024.
      expect(400 * scale).toBeCloseTo(819.2, 1);
      // Centred: equal margins on each axis.
      expect(tx).toBeCloseTo((1024 - 400 * scale) / 2, 1);
      expect(ty).toBeCloseTo((1024 - 200 * scale) / 2, 1);
    });

    it("offsets a mark whose bounds do not start at the origin", () => {
      const svg = buildPaddedSvg('<path d="M0 0"/>', { x0: 50, y0: 20, w: 200, h: 200 });
      const match = svg.match(/translate\((-?[\d.]+) (-?[\d.]+)\) scale\(([\d.]+)\)/);
      expect(match).not.toBeNull();
      if (!match) return;

      const [, tx, ty, scale] = match.map(Number);
      // The mark's own origin is subtracted so it lands centred.
      expect(tx).toBeCloseTo((1024 - 200 * scale) / 2 - 50 * scale, 1);
      expect(ty).toBeCloseTo((1024 - 200 * scale) / 2 - 20 * scale, 1);
    });
  });
});
