import { describe, expect, it } from "vitest";
import mainConfig from "../.storybook/main.ts";

describe("Storybook viteFinal code splitting configuration", () => {
  it("exports a viteFinal function", () => {
    expect(typeof mainConfig.viteFinal).toBe("function");
  });

  it("preserves Storybook's build configuration", async () => {
    const stub = {
      resolve: { alias: { existing: "/somewhere" } },
      build: {
        rollupOptions: {
          input: ["virtual:/@storybook/builder-vite/vite-app.js"],
          preserveEntrySignatures: "exports-only" as const,
          output: { format: "es" as const },
        },
      },
    };

    const result = await mainConfig.viteFinal!(stub as any, {} as any);

    expect(result.build?.rollupOptions?.input).toEqual([
      "virtual:/@storybook/builder-vite/vite-app.js",
    ]);
    expect(result.build?.rollupOptions?.preserveEntrySignatures).toBe("exports-only");
    const output = result.build?.rollupOptions?.output;
    if (!Array.isArray(output)) {
      expect(output?.format).toBe("es");
    }
  });

  it("sets chunkSizeWarningLimit to 1200", async () => {
    const stub = { build: { rollupOptions: {} } };
    const result = await mainConfig.viteFinal!(stub as any, {} as any);
    expect(result.build?.chunkSizeWarningLimit).toBe(1200);
  });

  it("does not introduce a rolldownOptions key", async () => {
    const stub = { build: { rollupOptions: {} } };
    const result = await mainConfig.viteFinal!(stub as any, {} as any);
    expect(result.build).not.toHaveProperty("rolldownOptions");
  });

  it("preserves existing alias and adds @ alias", async () => {
    const stub = {
      resolve: { alias: { existing: "/somewhere" } },
      build: { rollupOptions: {} },
    };

    const result = await mainConfig.viteFinal!(stub as any, {} as any);

    const alias = result.resolve?.alias as any;
    expect(alias).toHaveProperty("existing", "/somewhere");
    expect(alias).toHaveProperty("@");
    expect(alias?.["@"]).toMatch(/src$/);
  });

  it("defines all expected chunk groups", async () => {
    const stub = { build: { rollupOptions: {} } };
    const result = await mainConfig.viteFinal!(stub as any, {} as any);

    const output = result.build?.rollupOptions?.output as any;
    const codeSplitting = Array.isArray(output) ? output[0]?.codeSplitting : output?.codeSplitting;

    expect(codeSplitting).toBeDefined();
    expect(codeSplitting?.groups).toBeDefined();

    const groupNames = codeSplitting?.groups?.map((g: any) => g.name) ?? [];
    expect(groupNames).toContain("vendor-diagrams");
    expect(groupNames).toContain("vendor-charts");
    expect(groupNames).toContain("vendor-pdfjs");
    expect(groupNames).toContain("vendor-react");
    expect(groupNames).toContain("vendor-syntax");
    expect(groupNames).toContain("vendor-markdown");
    expect(groupNames).toContain("vendor-icons");
    expect(groupNames).toContain("vendor-storybook");
    expect(groupNames).toContain("vendor");
    expect(groupNames).toContain("plan-markdown");
  });

  it("matches module IDs to the correct groups", async () => {
    const stub = { build: { rollupOptions: {} } };
    const result = await mainConfig.viteFinal!(stub as any, {} as any);

    const output = result.build?.rollupOptions?.output as any;
    const codeSplitting = Array.isArray(output) ? output[0]?.codeSplitting : output?.codeSplitting;
    const groups = codeSplitting?.groups ?? [];

    const findGroup = (id: string) => {
      // Sort by priority descending, matching Rolldown's behavior
      const sorted = [...groups].sort((a, b) => (b.priority || 0) - (a.priority || 0));
      return sorted.find((g: any) => {
        if (!g.test) return false;
        // Handle both RegExp (.test method) and function (direct call)
        return typeof g.test === "function" ? g.test(id) : g.test.test(id);
      });
    };

    // Test with forward slashes (Unix-style paths)
    expect(findGroup("/repo/node_modules/mermaid/dist/mermaid.core.mjs")?.name).toBe(
      "vendor-diagrams",
    );
    expect(findGroup("/repo/node_modules/pdfjs-dist/build/pdf.mjs")?.name).toBe("vendor-pdfjs");
    expect(findGroup("/repo/node_modules/echarts/lib/echarts.js")?.name).toBe("vendor-charts");
    expect(findGroup("/repo/node_modules/zrender/lib/zrender.js")?.name).toBe("vendor-charts");
    expect(findGroup("/repo/node_modules/echarts-for-react/lib/core.js")?.name).toBe(
      "vendor-charts",
    );
    expect(findGroup("/repo/node_modules/react-dom/client.js")?.name).toBe("vendor-react");
    expect(findGroup("/repo/node_modules/refractor/lang/tsx.js")?.name).toBe("vendor-syntax");
    expect(findGroup("/repo/node_modules/date-fns/parse.js")?.name).toBe("vendor");

    // Test with backslashes (Windows-style paths)
    expect(findGroup("C:\\repo\\node_modules\\mermaid\\dist\\mermaid.core.mjs")?.name).toBe(
      "vendor-diagrams",
    );
  });

  it("maintains correct group priority ordering", async () => {
    const stub = { build: { rollupOptions: {} } };
    const result = await mainConfig.viteFinal!(stub as any, {} as any);

    const output = result.build?.rollupOptions?.output as any;
    const codeSplitting = Array.isArray(output) ? output[0]?.codeSplitting : output?.codeSplitting;
    const groups = codeSplitting?.groups ?? [];

    const diagramsGroup = groups.find((g: any) => g.name === "vendor-diagrams");
    const vendorGroup = groups.find((g: any) => g.name === "vendor");

    expect(diagramsGroup?.priority).toBeGreaterThan(vendorGroup?.priority ?? 0);
  });

  it("correctly filters PlanMarkdown shared modules", async () => {
    const stub = { build: { rollupOptions: {} } };
    const result = await mainConfig.viteFinal!(stub as any, {} as any);

    const output = result.build?.rollupOptions?.output as any;
    const codeSplitting = Array.isArray(output) ? output[0]?.codeSplitting : output?.codeSplitting;
    const groups = codeSplitting?.groups ?? [];

    const planMarkdownGroup = groups.find((g: any) => g.name === "plan-markdown");
    expect(planMarkdownGroup).toBeDefined();

    const testFn = planMarkdownGroup?.test;
    expect(typeof testFn).toBe("function");

    // Should match shared PlanMarkdown modules
    expect(testFn?.("src/components/PlanMarkdown/annotationUtils.ts")).toBe(true);
    expect(testFn?.("src/components/PlanMarkdown/CodeBlock.tsx")).toBe(true);

    // Should NOT match renderer modules (they import heavy lazy-loaded deps)
    expect(testFn?.("src/components/PlanMarkdown/MermaidRenderer.tsx")).toBe(false);
    expect(testFn?.("src/components/PlanMarkdown/GraphvizRenderer.tsx")).toBe(false);
  });
});
