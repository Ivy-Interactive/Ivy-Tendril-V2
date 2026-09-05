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

    expect(devDeps["@fontsource/geist-sans"]).toBeDefined();
    expect(devDeps["@fontsource/geist-mono"]).toBeDefined();

    expect(deps["@fontsource/geist-sans"]).toBeUndefined();
    expect(deps["@fontsource/geist-mono"]).toBeUndefined();
  });

  test("preview.tsx imports the required font stylesheets", () => {
    const previewContent = readFileSync(previewPath, "utf-8");

    const expectedImports = [
      "@fontsource/geist-sans/400.css",
      "@fontsource/geist-sans/500.css",
      "@fontsource/geist-sans/600.css",
      "@fontsource/geist-sans/700.css",
      "@fontsource/geist-mono/400.css",
      "@fontsource/geist-mono/500.css",
      "@fontsource/geist-mono/600.css",
      "@fontsource/geist-mono/700.css",
    ];

    for (const fontImport of expectedImports) {
      expect(previewContent).toContain(fontImport);
    }
  });

  test("globals.css defines --font-sans containing Geist and --font-mono containing Geist Mono", () => {
    const globalsCss = readFileSync(globalsCssPath, "utf-8");

    expect(globalsCss).toMatch(/--font-sans:[^;]*Geist[^;]*;/);
    expect(globalsCss).toMatch(/--font-mono:[^;]*Geist Mono[^;]*;/);
    expect(globalsCss).toContain("--font-family-mono: var(--font-mono);");
    expect(globalsCss).toContain("--font-family-sans: var(--font-sans);");
  });

  test("index.css defines --font-sans containing Geist and --font-mono containing Geist Mono", () => {
    const indexCss = readFileSync(indexCssPath, "utf-8");

    expect(indexCss).toMatch(/--font-sans:[^;]*Geist[^;]*;/);
    expect(indexCss).toMatch(/--font-mono:[^;]*Geist Mono[^;]*;/);
    expect(indexCss).toContain("--font-family-mono: var(--font-mono);");
    expect(indexCss).toContain("--font-family-sans: var(--font-sans);");
  });
});
