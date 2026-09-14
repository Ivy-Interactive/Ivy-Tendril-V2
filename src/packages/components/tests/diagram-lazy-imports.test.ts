import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("diagram lazy imports", () => {
  it("src/lib/diagram.ts has no static import of mermaid or @hpcc-js/wasm-graphviz", () => {
    const content = readFileSync(join(repoRoot, "src", "lib", "diagram.ts"), "utf-8");
    const staticMermaid = /^import\s.*["']mermaid["'];?$/m;
    const staticGraphviz = /^import\s.*["']@hpcc-js\/wasm-graphviz["'];?$/m;
    expect(content).not.toMatch(staticMermaid);
    expect(content).not.toMatch(staticGraphviz);
    expect(content).toContain('await import("mermaid")');
    expect(content).toContain('await import("@hpcc-js/wasm-graphviz")');
  });

  it("sanitizeSvg and applyFontToSvg are each defined exactly once under src/", () => {
    const rendererFiles = [
      "src/components/MermaidRenderer.tsx",
      "src/components/GraphvizRenderer.tsx",
      "src/components/PlanMarkdown/MermaidRenderer.tsx",
      "src/components/PlanMarkdown/GraphvizRenderer.tsx",
    ];

    for (const relativePath of rendererFiles) {
      const content = readFileSync(join(repoRoot, relativePath), "utf-8");
      expect(content).not.toMatch(/\bconst sanitizeSvg\s*=/);
      expect(content).not.toMatch(/\bconst applyFontToSvg\s*=/);
    }

    const diagramLib = readFileSync(join(repoRoot, "src", "lib", "diagram.ts"), "utf-8");
    expect(diagramLib).toMatch(/export const sanitizeSvg\s*=/);
    expect(diagramLib).toMatch(/export const applyFontToSvg\s*=/);
  });
});
