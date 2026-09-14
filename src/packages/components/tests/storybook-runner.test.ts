import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import mainConfig from "../.storybook/main.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface PackageManifest {
  scripts?: Record<string, string>;
}

const packageJson = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
) as PackageManifest;

/** Story globs in main.ts are relative to `.storybook/`, so match candidates the same way. */
function matchesStoryGlobs(relativeToConfigDir: string): boolean {
  const globs = (mainConfig.stories ?? []) as string[];
  return globs.some((glob) => path.matchesGlob(relativeToConfigDir, glob));
}

describe("Storybook dev server runner", () => {
  it("exports a valid StorybookConfig using the react-vite framework", () => {
    expect(mainConfig).toBeDefined();
    expect(mainConfig.framework).toEqual({
      name: "@storybook/react-vite",
      options: {},
    });
  });

  it("disables telemetry so the dev server never prompts interactively", () => {
    expect(mainConfig.core).toBeDefined();
    // `core` is a PresetValue union that also admits a loader function, so narrow before reading it.
    expect((mainConfig.core as { disableTelemetry?: boolean }).disableTelemetry).toBe(true);
  });

  it("registers the @ path alias to src/ via viteFinal", async () => {
    expect(typeof mainConfig.viteFinal).toBe("function");

    const result = await mainConfig.viteFinal!({ resolve: { alias: { "~": "/somewhere/else" } } }, {
      configType: "DEVELOPMENT",
    } as never);

    const alias = result.resolve?.alias as Record<string, string>;
    expect(alias["@"]).toBe(path.resolve(repoRoot, "src"));
    expect(alias["~"]).toBe("/somewhere/else");
  });

  it("preserves an array-shaped resolve.alias when merging in the @ alias", async () => {
    const result = await mainConfig.viteFinal!(
      { resolve: { alias: [{ find: "~", replacement: "/somewhere/else" }] } },
      { configType: "DEVELOPMENT" } as never,
    );

    const alias = result.resolve?.alias as { find: string; replacement: string }[];
    expect(alias).toEqual([
      { find: "~", replacement: "/somewhere/else" },
      { find: "@", replacement: path.resolve(repoRoot, "src") },
    ]);
  });

  it("defines non-interactive storybook dev server scripts in package.json", () => {
    const scripts = packageJson.scripts ?? {};

    expect(scripts.storybook).toBe("tsx scripts/storybook-dev.ts");
    expect(scripts["storybook:dev"]).toBe(scripts.storybook);
    expect(scripts["build-storybook"]).toBe("storybook build");
  });

  it("configures the dev server for non-blocking startup on a loopback port", () => {
    // The port is pinned to the first free slot in 6006..6015 so the URL is bookmarkable, which the
    // wrapper does by probing 127.0.0.1 itself - Storybook's own probe checks a different host and
    // so hard-fails with EADDRINUSE on a held port. The flags therefore live in the wrapper source,
    // not in the package.json script.
    const wrapper = readFileSync(path.join(repoRoot, "scripts", "storybook-dev.ts"), "utf8");

    // --ci suppresses telemetry/port prompts and stops the browser from being opened.
    expect(wrapper).toContain("--ci");
    // Loopback only - never expose the dev server on every network interface.
    expect(wrapper).toContain("127.0.0.1");
    // --exact-port would exit(-1) silently on the very probe disagreement this wrapper works around.
    expect(wrapper).not.toContain("--exact-port");
  });

  it("discovers the ported Tendril component stories", () => {
    for (const story of [
      "../src/components/ContentInput/ContentInput.stories.tsx",
      "../src/components/BadgeSelect/BadgeSelect.stories.tsx",
      "../src/components/SortableVerificationList/SortableVerificationList.stories.tsx",
    ]) {
      expect(matchesStoryGlobs(story), `expected ${story} to match a stories glob`).toBe(true);
    }
  });

  it("does not match component sources or test files", () => {
    expect(matchesStoryGlobs("../src/components/BadgeSelect/BadgeSelect.test.tsx")).toBe(false);
    expect(matchesStoryGlobs("../src/components/BadgeSelect/BadgeSelect.tsx")).toBe(false);
  });
});
