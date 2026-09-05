import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface ProjectLockfile {
  overrides?: Record<string, string>;
  packages?: Record<string, unknown>;
}

/**
 * `pnpm-lock.yaml` can hold more than one YAML document: when the pnpm on PATH differs from the
 * `devEngines.packageManager` pin, pnpm prepends a document that locks only the package manager
 * itself. The project graph is the document carrying `overrides`.
 */
function selectProjectLockfile(source: string): ProjectLockfile {
  const documents = parseAllDocuments(source).map((document) => document.toJS() as ProjectLockfile);
  const project = documents.find((document) => document.overrides !== undefined);
  if (!project?.packages) {
    throw new Error(
      `no pnpm-lock.yaml document has an "overrides" key (${documents.length} document(s) parsed)`,
    );
  }
  return project;
}

function readProjectLockfile(): ProjectLockfile {
  return selectProjectLockfile(readFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "utf8"));
}

describe("playwright lockfile deduplication", () => {
  it("has exactly one playwright-core@1.63.0 package declaration", () => {
    const { packages } = readProjectLockfile();
    const declarations = Object.keys(packages ?? {}).filter((key) =>
      key.startsWith("playwright-core@"),
    );
    expect(declarations).toEqual(["playwright-core@1.63.0"]);
  });

  it("has exactly one playwright@1.63.0 package declaration", () => {
    const { packages } = readProjectLockfile();
    const declarations = Object.keys(packages ?? {}).filter((key) => key.startsWith("playwright@"));
    expect(declarations).toEqual(["playwright@1.63.0"]);
  });

  it("has no 1.62.1 playwright dependencies", () => {
    const lockfile = readFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "utf8");
    expect(lockfile).not.toContain("playwright: 1.62.1");
    expect(lockfile).not.toContain("playwright-core: 1.62.1");
  });

  it("pins playwright-core to 1.63.0 in pnpm-workspace.yaml overrides", () => {
    const workspace = readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
    expect(workspace).toContain("playwright-core@*: 1.63.0");
  });

  it("removes all 'page as any' casts from test-runner.ts", () => {
    const testRunner = readFileSync(path.join(repoRoot, ".storybook/test-runner.ts"), "utf8");
    expect(testRunner).not.toContain("page as any");
    expect(testRunner).toContain("injectAxe(page)");
    expect(testRunner).toContain("configureAxe(page,");
    expect(testRunner).toContain("checkA11y(page,");
  });

  it("selects the project lockfile from both single-document and two-document shapes", () => {
    // Single-document lockfile
    const singleDoc = `---
lockfileVersion: '9.0'

overrides:
  playwright@*: 1.63.0

packages:
  playwright@1.63.0:
    resolution: {}

snapshots:
  playwright@1.63.0: {}
`;

    // Two-document lockfile: packageManagerDependencies first, project second
    const twoDoc = `---
lockfileVersion: '9.0'

importers:
  .:
    packageManagerDependencies:
      pnpm:
        specifier: 11.25.0
        version: 11.25.0

packages:
  pnpm@11.25.0:
    resolution: {}

snapshots:
  pnpm@11.25.0: {}

---
lockfileVersion: '9.0'

overrides:
  playwright@*: 1.63.0

packages:
  playwright@1.63.0:
    resolution: {}

snapshots:
  playwright@1.63.0: {}
`;

    const singleResult = selectProjectLockfile(singleDoc);
    const twoResult = selectProjectLockfile(twoDoc);

    // Both should return the same project packages
    expect(Object.keys(singleResult.packages ?? {})).toEqual(["playwright@1.63.0"]);
    expect(Object.keys(twoResult.packages ?? {})).toEqual(["playwright@1.63.0"]);

    // Both should have the same overrides
    expect(singleResult.overrides).toEqual({ "playwright@*": "1.63.0" });
    expect(twoResult.overrides).toEqual({ "playwright@*": "1.63.0" });
  });
});
