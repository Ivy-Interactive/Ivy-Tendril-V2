import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { aliasEntries, srcDir } from "../config/alias.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A config recomputing the alias base directory itself — the drift this plan removes. */
const localSrcResolve = /path\.resolve\([^)]*["'](?:\.\.?\/)?src["']\s*\)/;

interface TsConfig {
  compilerOptions?: { paths?: Record<string, string[]> };
}

describe("shared @ alias", () => {
  it("resolves srcDir to the repo's src directory", () => {
    expect(srcDir).toBe(path.resolve(repoRoot, "src"));
    expect(existsSync(srcDir)).toBe(true);
  });

  it("exposes a single @ entry pointing at srcDir", () => {
    expect(aliasEntries).toEqual({ "@": srcDir });
  });

  it("is the only place the alias base directory is computed", () => {
    for (const file of ["vite.config.ts", ".storybook/main.ts"]) {
      const source = readFileSync(path.join(repoRoot, file), "utf8");
      expect(source, `${file} should import the shared alias`).toContain("config/alias.ts");
      expect(localSrcResolve.test(source), `${file} should not recompute the base dir`).toBe(false);
    }
  });

  it("keeps the test config merged in vite.config.ts", () => {
    const vitestConfigPath = path.join(repoRoot, "vitest.config.ts");
    expect(
      existsSync(vitestConfigPath),
      "vitest.config.ts should not exist — it was merged into vite.config.ts",
    ).toBe(false);

    const viteSource = readFileSync(path.join(repoRoot, "vite.config.ts"), "utf8");
    expect(viteSource, "vite.config.ts should have a test block").toContain("test: {");
    expect(viteSource, "vite.config.ts should declare jsdom environment").toContain(
      'environment: "jsdom"',
    );
    expect(viteSource, "vite.config.ts should declare setupFiles").toContain("setupFiles:");
  });

  it("keeps tsconfig paths in step with the shared alias", () => {
    const raw = readFileSync(path.join(repoRoot, "tsconfig.json"), "utf8");
    const target = (JSON.parse(raw) as TsConfig).compilerOptions?.paths?.["@/*"]?.[0];
    expect(target).toBeDefined();
    expect(path.resolve(repoRoot, target!.replace(/\/\*$/, ""))).toBe(srcDir);
  });
});
