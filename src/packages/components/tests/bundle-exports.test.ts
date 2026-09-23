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

  // The highlighter's import can land in a chunk the entry shares with `dialogs.mjs` (the sheets
  // render markdown too), so look through the chunks tendril.mjs imports statically as well.
  it("uses refractor/core instead of refractor/all", () => {
    const entry = readFileSync(tendrilMjsPath, "utf-8");
    const chunks = [...entry.matchAll(/from\s+["']\.\/([\w.-]+\.mjs)["']/g)].map((m) =>
      readFileSync(join(repoRoot, "dist", m[1]), "utf-8"),
    );
    expect([entry, ...chunks].some((content) => content.includes('from "refractor/core"'))).toBe(
      true,
    );
  });

  // CodeBlock and ErrorDisplay both render the Prism highlighter, and both are
  // eagerly reachable from the tendril entrypoint, so a static import here pulls
  // react-syntax-highlighter and the whole refractor language set onto the
  // consuming app's initial load. Both load it through lazyWithRetry instead.
  it("does not contain static imports of react-syntax-highlighter", () => {
    const content = readFileSync(tendrilMjsPath, "utf-8");
    const staticHighlighter =
      /import\s+(?:(?:\*\s+as\s+\w+|\{[^}]*\}|\w+)\s+from\s+)?["']react-syntax-highlighter["'];?/g;
    expect(content).not.toMatch(staticHighlighter);
  });

  it("does not statically import the diagram renderer chunk", () => {
    const content = readFileSync(tendrilMjsPath, "utf-8");
    const staticDiagramRenderer = /from\s+["']\.\/(?:Mermaid|Graphviz)Renderer-[\w-]+\.mjs["']/;
    expect(content).not.toMatch(staticDiagramRenderer);
  });

  // echarts is around a megabyte, so the chart components have their own entrypoint. Nothing an
  // application loads eagerly may reach it.
  describe("echarts stays on the charts entrypoint", () => {
    const eagerEntrypoints = ["ui", "tendril", "index", "renderers", "theme", "diagrams"];

    for (const entry of eagerEntrypoints) {
      it(`dist/${entry}.mjs does not import echarts`, () => {
        const path = join(repoRoot, "dist", `${entry}.mjs`);
        expect(existsSync(path), path).toBe(true);

        const content = readFileSync(path, "utf-8");
        const staticEcharts =
          /import\s+(?:(?:\*\s+as\s+\w+|\{[^}]*\}|\w+)\s+from\s+)?["']echarts(?:-for-react)?["'];?/g;
        expect(content).not.toMatch(staticEcharts);
        // Not even a lazy `import("echarts")` or a re-export should appear here.
        expect(content).not.toContain("echarts");
      });
    }

    it("dist/charts.mjs is where echarts-for-react is imported", () => {
      const chartsMjsPath = join(repoRoot, "dist", "charts.mjs");
      expect(existsSync(chartsMjsPath)).toBe(true);

      const content = readFileSync(chartsMjsPath, "utf-8");
      expect(content).toContain('from "echarts-for-react"');
    });
  });
});
