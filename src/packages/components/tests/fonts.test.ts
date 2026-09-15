import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { readCssInlined } from "./read-css.ts";

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

  // The font tokens live in the shared `tokens.css` that both entry points import, so these read
  // each stylesheet with its relative imports inlined.
  test("globals.css defines --font-sans containing Geist Variable and --font-mono containing Geist Mono Variable", () => {
    const globalsCss = readCssInlined(globalsCssPath);

    expect(globalsCss).toMatch(/--font-sans:[^;]*Geist Variable[^;]*;/);
    expect(globalsCss).toMatch(/--font-mono:[^;]*Geist Mono Variable[^;]*;/);
    expect(globalsCss).toContain("--font-family-mono: var(--font-mono);");
    expect(globalsCss).toContain("--font-family-sans: var(--font-sans);");
  });

  test("index.css defines --font-sans containing Geist Variable and --font-mono containing Geist Mono Variable", () => {
    const indexCss = readCssInlined(indexCssPath);

    expect(indexCss).toMatch(/--font-sans:[^;]*Geist Variable[^;]*;/);
    expect(indexCss).toMatch(/--font-mono:[^;]*Geist Mono Variable[^;]*;/);
    expect(indexCss).toContain("--font-family-mono: var(--font-mono);");
    expect(indexCss).toContain("--font-family-sans: var(--font-sans);");
  });

  // The cross-file "same Geist variable families" assertion that used to live here is now part of
  // the broader token parity suite in `style-token-parity.test.ts`, which covers --font-sans,
  // --font-serif and --font-mono rather than just the two.

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
