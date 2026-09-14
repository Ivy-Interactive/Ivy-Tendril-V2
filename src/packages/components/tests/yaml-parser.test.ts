import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("YAML parser selection", () => {
  it("should declare exactly yaml (not js-yaml) in package.json", () => {
    const packageJsonPath = join(__dirname, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
    };

    const yamlParsers = ["js-yaml", "yaml"].filter((parser) => parser in allDeps);

    expect(yamlParsers).toEqual(["yaml"]);
  });

  it("should not declare @types/js-yaml in any dependency section", () => {
    const packageJsonPath = join(__dirname, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
    };

    expect(allDeps).not.toHaveProperty("@types/js-yaml");
  });

  it("should only have yaml as the runtime YAML parser in dependencies", () => {
    const packageJsonPath = join(__dirname, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    expect(packageJson.dependencies).toHaveProperty("yaml");
    expect(packageJson.dependencies).not.toHaveProperty("js-yaml");
  });
});
