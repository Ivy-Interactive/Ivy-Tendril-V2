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
    expect(mainConfig.core?.disableTelemetry).toBe(true);
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

    expect(scripts.storybook).toBe("storybook dev --ci --host 127.0.0.1");
    expect(scripts["storybook:dev"]).toBe(scripts.storybook);
    expect(scripts["build-storybook"]).toBe("storybook build");
  });

  it("configures the dev server for non-blocking startup on a loopback port", () => {
    const scripts = packageJson.scripts ?? {};

    for (const script of [scripts.storybook, scripts["storybook:dev"]]) {
      // --ci suppresses telemetry/port prompts and stops the browser from being opened.
      expect(script).toContain("--ci");
      // Loopback only — never expose the dev server on every network interface.
      expect(script).toContain("--host 127.0.0.1");
      // No pinned port: a pinned port makes startup fail with EADDRINUSE when a previous
      // review session still holds it, so let Storybook pick a free port and print the URL.
      expect(script).not.toMatch(/(^|\s)(-p|--port)(\s|=)/);
      expect(script).not.toContain("--exact-port");
    }
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

  it("discovers MDX docs pages but not test files", () => {
    expect(matchesStoryGlobs("../src/stories/Introduction.mdx")).toBe(true);
    expect(matchesStoryGlobs("../src/components/BadgeSelect/BadgeSelect.test.tsx")).toBe(false);
    expect(matchesStoryGlobs("../src/components/BadgeSelect/BadgeSelect.tsx")).toBe(false);
  });
});
