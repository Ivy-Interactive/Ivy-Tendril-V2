import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vite-plus/test";

describe("Geist and Geist Mono Font Assets & Configuration", () => {
  const rootDir = resolve(__dirname, "..");
  const packageJsonPath = resolve(rootDir, "package.json");
  const previewPath = resolve(rootDir, ".storybook/preview.tsx");
  const globalsCssPath = resolve(rootDir, "src/styles/globals.css");
  const indexCssPath = resolve(rootDir, "src/styles/index.css");

  test("font packages are declared in devDependencies and not runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    const devDeps = pkg.devDependencies || {};
    const deps = pkg.dependencies || {};

    expect(devDeps["@fontsource-variable/geist"]).toBeDefined();
    expect(devDeps["@fontsource-variable/geist-mono"]).toBeDefined();

    expect(deps["@fontsource-variable/geist"]).toBeUndefined();
    expect(deps["@fontsource-variable/geist-mono"]).toBeUndefined();
  });

  test("preview.tsx imports the required font stylesheets", () => {
    const previewContent = readFileSync(previewPath, "utf-8");

    const expectedImports = ["@fontsource-variable/geist", "@fontsource-variable/geist-mono"];

    for (const fontImport of expectedImports) {
      expect(previewContent).toContain(fontImport);
    }

    // Ensure old static imports are removed
    expect(previewContent).not.toContain("@fontsource/geist-sans");
    expect(previewContent).not.toContain("@fontsource/geist-mono");
  });

  test("globals.css defines --font-sans containing Geist Variable and --font-mono containing Geist Mono Variable", () => {
    const globalsCss = readFileSync(globalsCssPath, "utf-8");

    expect(globalsCss).toMatch(/--font-sans:[^;]*Geist Variable[^;]*;/);
    expect(globalsCss).toMatch(/--font-mono:[^;]*Geist Mono Variable[^;]*;/);
    expect(globalsCss).toContain("--font-family-mono: var(--font-mono);");
    expect(globalsCss).toContain("--font-family-sans: var(--font-sans);");
  });

  test("index.css defines --font-sans containing Geist Variable and --font-mono containing Geist Mono Variable", () => {
    const indexCss = readFileSync(indexCssPath, "utf-8");

    expect(indexCss).toMatch(/--font-sans:[^;]*Geist Variable[^;]*;/);
    expect(indexCss).toMatch(/--font-mono:[^;]*Geist Mono Variable[^;]*;/);
    expect(indexCss).toContain("--font-family-mono: var(--font-mono);");
    expect(indexCss).toContain("--font-family-sans: var(--font-sans);");
  });

  test("globals.css and index.css declare the same Geist variable families", () => {
    const families = (css: string) =>
      [/--font-sans:\s*([^;]+);/.exec(css)?.[1], /--font-mono:\s*([^;]+);/.exec(css)?.[1]].map(
        (v) => v?.replace(/\s+/g, " ").trim(),
      );

    expect(families(readFileSync(globalsCssPath, "utf-8"))).toEqual(
      families(readFileSync(indexCssPath, "utf-8")),
    );
  });

  test("agent-output.css names Geist Mono Variable", () => {
    const agentOutputCssPath = resolve(rootDir, "src/components/AgentViewer/agent-output.css");
    const agentOutputCss = readFileSync(agentOutputCssPath, "utf-8");

    expect(agentOutputCss).toContain("Geist Mono Variable");
  });

  test("plan-markdown.css names Geist Mono Variable", () => {
    const planMarkdownCssPath = resolve(rootDir, "src/components/PlanMarkdown/plan-markdown.css");
    const planMarkdownCss = readFileSync(planMarkdownCssPath, "utf-8");

    expect(planMarkdownCss).toContain("Geist Mono Variable");
  });
});
