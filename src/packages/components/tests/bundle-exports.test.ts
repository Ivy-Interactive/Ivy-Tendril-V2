import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("Bundle Exports and Code-Splitting", () => {
  const tendrilMjsPath = join(repoRoot, "dist", "tendril.mjs");

  it("verifies dist/tendril.mjs exists", () => {
    expect(existsSync(tendrilMjsPath)).toBe(true);
  });

  it("does not contain static imports of pdfjs-dist", () => {
    const content = readFileSync(tendrilMjsPath, "utf-8");
    const staticPdfJs =
      /import\s+(?:(?:\*\s+as\s+\w+|\{[^}]*\}|\w+)\s+from\s+)?["']pdfjs-dist["'];?/g;
    expect(content).not.toMatch(staticPdfJs);
  });

  it("does not contain static imports of pdfjs worker url", () => {
    const content = readFileSync(tendrilMjsPath, "utf-8");
    const staticWorker =
      /import\s+(?:(?:\*\s+as\s+\w+|\{[^}]*\}|\w+)\s+from\s+)?["']pdfjs-dist\/build\/pdf\.worker\.mjs\?url["'];?/g;
    expect(content).not.toMatch(staticWorker);
  });

  it("does not contain static imports of refractor/all", () => {
    const content = readFileSync(tendrilMjsPath, "utf-8");
    const staticRefractorAll =
      /import\s+(?:(?:\*\s+as\s+\w+|\{[^}]*\}|\w+)\s+from\s+)?["']refractor\/all["'];?/g;
    expect(content).not.toMatch(staticRefractorAll);
  });

  it("uses refractor/core instead of refractor/all", () => {
    const content = readFileSync(tendrilMjsPath, "utf-8");
    expect(content).toContain('from "refractor/core"');
  });

  it("does not statically import the diagram renderer chunk", () => {
    const content = readFileSync(tendrilMjsPath, "utf-8");
    const staticDiagramRenderer = /from\s+["']\.\/(?:Mermaid|Graphviz)Renderer-[\w-]+\.mjs["']/;
    expect(content).not.toMatch(staticDiagramRenderer);
  });
});
