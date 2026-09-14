import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

describe("Storybook Scripts Configuration", () => {
  const rootDir = resolve(__dirname, "..");
  const packageJsonPath = resolve(rootDir, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const readmePath = resolve(rootDir, "README.md");
  const readmeContent = readFileSync(readmePath, "utf8");

  it("defines test-storybook:install script with playwright install chromium", () => {
    expect(packageJson.scripts["test-storybook:install"]).toBeDefined();
    expect(packageJson.scripts["test-storybook:install"]).toContain("playwright install");
    expect(packageJson.scripts["test-storybook:install"]).toContain("chromium");
  });

  it("defines test-storybook:install:ci script with --with-deps flag", () => {
    expect(packageJson.scripts["test-storybook:install:ci"]).toBeDefined();
    expect(packageJson.scripts["test-storybook:install:ci"]).toContain("--with-deps");
    expect(packageJson.scripts["test-storybook:install:ci"]).toContain("playwright install");
    expect(packageJson.scripts["test-storybook:install:ci"]).toContain("chromium");
  });

  it("declares playwright as a direct devDependency with exact version pin", () => {
    expect(packageJson.devDependencies.playwright).toBeDefined();
    const specifier = packageJson.devDependencies.playwright;
    expect(specifier).not.toMatch(/^[\^~]/);
    expect(specifier).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("preserves existing test-storybook and test-storybook:ci scripts", () => {
    expect(packageJson.scripts["test-storybook"]).toBeDefined();
    expect(packageJson.scripts["test-storybook:ci"]).toBeDefined();
  });

  it("documents test-storybook:install in README.md", () => {
    expect(readmeContent).toContain("test-storybook:install");
  });
});
