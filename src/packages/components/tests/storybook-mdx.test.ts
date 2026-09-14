import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import mainConfig from "../.storybook/main.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mdxFilesUnderSrc(): string[] {
  return readdirSync(path.join(repoRoot, "src"), { recursive: true, encoding: "utf8" }).filter(
    (entry) => entry.endsWith(".mdx"),
  );
}

describe("Storybook MDX docs glob", () => {
  it("declares the .mdx glob only when an .mdx page actually exists", () => {
    const globs = (mainConfig.stories ?? []) as string[];
    const hasMdxGlob = globs.some((glob) => glob.endsWith(".mdx"));
    const mdxFiles = mdxFilesUnderSrc();

    // An .mdx glob matching nothing makes Storybook warn on every dev-server start and build;
    // an .mdx page not covered by a glob is silently invisible in the sidebar.
    expect(
      hasMdxGlob,
      hasMdxGlob
        ? "main.ts globs *.mdx but src/ has no .mdx files — Storybook will warn on startup"
        : `src/ has .mdx files (${mdxFiles.join(", ")}) but main.ts does not glob them`,
    ).toBe(mdxFiles.length > 0);
  });

  it("finds no .mdx pages yet, so the glob is correctly absent", () => {
    expect(mdxFilesUnderSrc()).toEqual([]);
    expect((mainConfig.stories ?? []) as string[]).toEqual([
      "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    ]);
  });
});
