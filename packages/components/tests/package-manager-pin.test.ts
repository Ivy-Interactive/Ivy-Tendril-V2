import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Both entries pnpm 11 writes into the leading lockfile document when it locks itself. */
const LOCKED_PACKAGE_MANAGERS = ["pnpm", "@pnpm/exe"] as const;

interface PackageManagerPin {
  specifier?: string;
  version?: string;
}

interface PackageManagerLockfile {
  importers?: Record<string, { packageManagerDependencies?: Record<string, PackageManagerPin> }>;
}

interface Manifest {
  packageManager?: string;
  devEngines?: { packageManager?: { name?: string; version?: string } };
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as Manifest;
}

/**
 * `pnpm-lock.yaml` holds two YAML documents while pnpm locks the package manager itself: pnpm
 * 11.25.0 prepends a document carrying `packageManagerDependencies`, and any older pnpm removes it
 * without putting it back. Select that document by key, never by index — the file is
 * single-document whenever it was last written by a pnpm that did not lock itself, and
 * `YAML.parse()` throws outright on the multi-document form.
 */
function selectPackageManagerPins(source: string): Record<string, PackageManagerPin> {
  const documents = parseAllDocuments(source).map(
    (document) => document.toJS() as PackageManagerLockfile,
  );
  const pins = documents
    .map((document) => document.importers?.["."]?.packageManagerDependencies)
    .find((candidate) => candidate !== undefined);
  if (pins === undefined) {
    throw new Error(
      `no pnpm-lock.yaml document carries importers["."].packageManagerDependencies ` +
        `(${documents.length} document(s) parsed) — the leading package-manager document was ` +
        `stripped, which is what a bare "pnpm install" under a pnpm older than the pinned one ` +
        `does. Restore it with "corepack pnpm@11.25.0 install".`,
    );
  }
  return pins;
}

describe("package manager pin", () => {
  it("pins packageManager to the devEngines version in package.json", () => {
    const manifest = readManifest();
    const pinned = manifest.devEngines?.packageManager;

    expect(pinned?.name).toBe("pnpm");
    expect(pinned?.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.packageManager).toBe(`pnpm@${pinned?.version ?? ""}`);
  });

  it("keeps pnpm and @pnpm/exe locked to that version in pnpm-lock.yaml", () => {
    const version = readManifest().devEngines?.packageManager?.version;
    const pins = selectPackageManagerPins(
      readFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "utf8"),
    );

    for (const name of LOCKED_PACKAGE_MANAGERS) {
      const pin = pins[name];
      expect(
        pin,
        `pnpm-lock.yaml has no packageManagerDependencies entry for "${name}"`,
      ).toBeDefined();
      expect(pin?.specifier).toBe(version);
      expect(pin?.version).toBe(version);
    }
  });

  it("no longer claims the leading lockfile document returns on the next install", () => {
    const agents = readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");

    expect(agents).not.toContain("will return on the next");
  });
});
