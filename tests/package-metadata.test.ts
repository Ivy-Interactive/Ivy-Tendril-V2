import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("Package Metadata", () => {
  const packageJsonPath = join(repoRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

  it("has correct SpaceCorps repository, homepage, and bugs metadata", () => {
    expect(packageJson.name).toBe("@spacecorps/components-storybook");
    expect(packageJson.author).toBe("SpaceCorps");
    expect(packageJson.homepage).toBe("https://github.com/SpaceCorps/components-storybook#readme");
    expect(packageJson.bugs).toEqual({
      url: "https://github.com/SpaceCorps/components-storybook/issues",
    });
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/SpaceCorps/components-storybook.git",
    });
  });

  it("sets initial semver version", () => {
    expect(packageJson.version).toBe("0.1.0");
  });

  it("configures bump script using bumpp", () => {
    expect(packageJson.scripts?.bump).toBeDefined();
    expect(packageJson.scripts.bump).toContain("bumpp");
  });

  it("contains no leftover template placeholder values", () => {
    const rawContent = readFileSync(packageJsonPath, "utf-8");
    expect(rawContent).not.toContain("Author Name");
    expect(rawContent).not.toContain("author.name@mail.com");
    expect(rawContent).not.toContain("https://github.com/author/library");
  });
});
