import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { resolveStorybookRoot } from "../scripts/storybook-path.mjs";

const repoRoot = path.resolve(__dirname, "..");
const readFile = (relativePath: string) =>
  fs.readFileSync(path.resolve(repoRoot, relativePath), "utf-8");

const walkFiles = (dir: string): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
};

describe("Dependency portability", () => {
  it("declares a packageManager field in package.json", () => {
    const pkg = JSON.parse(readFile("package.json"));
    expect(typeof pkg.packageManager).toBe("string");
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  });

  it.each(["package.json", "vite.config.ts", "vitest.config.ts", "tsconfig.json"])(
    "contains no local absolute path in %s",
    (relativePath) => {
      const content = readFile(relativePath);
      expect(content).not.toMatch(/\/Users\//);
    },
  );

  it("imports components-storybook only via the scoped @spacecorps package", () => {
    const files = [
      ...walkFiles(path.resolve(repoRoot, "src")),
      ...walkFiles(path.resolve(repoRoot, "tests")),
    ];

    const unscopedImports: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const matches = content.match(/["']components-storybook[^"']*["']/g) ?? [];
      for (const match of matches) {
        if (!match.includes("@spacecorps/components-storybook")) {
          unscopedImports.push(`${path.relative(repoRoot, file)}: ${match}`);
        }
      }
    }

    expect(unscopedImports).toEqual([]);
  });

  it("has every declared dependency installed", () => {
    const pkg = JSON.parse(readFile("package.json"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    const missing = Object.entries(deps)
      .filter(([, specifier]) => !String(specifier).startsWith("link:"))
      .map(([name]) => name)
      .filter(
        (name) => !fs.existsSync(path.resolve(repoRoot, "node_modules", name, "package.json")),
      );

    expect(missing, `missing packages: ${missing.join(", ")} — run pnpm install`).toEqual([]);
  });

  it.each(["vite.config.ts", "vitest.config.ts"])(
    "does not hardcode the components-storybook dist path in %s",
    (relativePath) => {
      const content = readFile(relativePath);
      expect(content).not.toMatch(/components-storybook\/dist/);
    },
  );

  it("resolves a built components-storybook checkout", () => {
    const root = resolveStorybookRoot();
    expect(fs.existsSync(path.join(root, "dist", "tendril.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(root, "dist", "style.css"))).toBe(true);
  });
});
