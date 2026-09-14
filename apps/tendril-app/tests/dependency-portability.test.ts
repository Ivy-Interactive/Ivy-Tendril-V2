import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
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

  it("pins the components-storybook checkout in CI to a full commit SHA", () => {
    const workflow = readFile(".github/workflows/ci.yml");
    const stepMatch = workflow.match(
      /- name: Checkout components-storybook\n(?:(?!\n {6}- name:)[\s\S])*/,
    );

    expect(
      stepMatch,
      "could not find the 'Checkout components-storybook' step in ci.yml",
    ).not.toBeNull();

    const step = stepMatch![0];
    const refMatch = step.match(/^\s*ref:\s*(\S+)\s*$/m);

    expect(refMatch?.[1], "pin components-storybook to a full commit SHA").toMatch(
      /^[0-9a-f]{40}$/,
    );
  });

  it("compiles cleanly with tsc --noEmit without type errors", () => {
    expect(() => {
      execSync("pnpm exec tsc --noEmit", {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf-8",
      });
    }).not.toThrow();
  }, 30000);

  it("configures repository secret authentication for the components-storybook checkout in CI", () => {
    const workflow = readFile(".github/workflows/ci.yml");
    const stepMatch = workflow.match(
      /- name: Checkout components-storybook\n(?:(?!\n {6}- name:)[\s\S])*/,
    );

    expect(
      stepMatch,
      "could not find the 'Checkout components-storybook' step in ci.yml",
    ).not.toBeNull();

    const step = stepMatch![0];
    const authMatch = step.match(
      /^\s*(?:token|ssh-key):\s*\${{\s*secrets\.(COMPONENTS_STORYBOOK_[A-Z0-9_]+)\s*}}\s*$/m,
    );

    expect(
      authMatch,
      "expected components-storybook checkout to configure repository secret authentication (token or ssh-key referencing secrets.COMPONENTS_STORYBOOK_*)",
    ).not.toBeNull();
  });
});
