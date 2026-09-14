import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

// Resolved in two steps rather than `new URL("../.vite-hooks/pre-commit", import.meta.url)`,
// which Vite rewrites into an asset URL that `fileURLToPath` then rejects.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preCommitPath = resolve(repoRoot, ".vite-hooks/pre-commit");
const agentsMdPath = resolve(repoRoot, "AGENTS.md");

describe(".vite-hooks/pre-commit", () => {
  it("invokes vp staged with --no-stash", () => {
    const content = readFileSync(preCommitPath, "utf8");
    // Assert the pattern /vp staged(?!\s+--no-stash)/ does NOT match, so a second unflagged
    // invocation fails the test too
    expect(content).toMatch(/vp staged\s+--no-stash/);
    expect(content).not.toMatch(/vp staged(?!\s+--no-stash)/);
  });

  it("does not contain --no-hide-partially-staged", () => {
    const content = readFileSync(preCommitPath, "utf8");
    expect(content).not.toContain("--no-hide-partially-staged");
  });

  it("does not contain --hide-unstaged", () => {
    const content = readFileSync(preCommitPath, "utf8");
    expect(content).not.toContain("--hide-unstaged");
  });

  it("names lint-staged_unstaged.patch in the failure branch", () => {
    const content = readFileSync(preCommitPath, "utf8");
    expect(content).toContain("lint-staged_unstaged.patch");
  });
});

describe("AGENTS.md", () => {
  it("has ## Git Hooks section after <!--VITE PLUS END-->", () => {
    const content = readFileSync(agentsMdPath, "utf8");
    const endMarkerIndex = content.indexOf("<!--VITE PLUS END-->");
    const gitHooksIndex = content.indexOf("## Git Hooks");

    expect(endMarkerIndex).toBeGreaterThan(-1);
    expect(gitHooksIndex).toBeGreaterThan(-1);
    expect(gitHooksIndex).toBeGreaterThan(endMarkerIndex);
  });

  it("Git Hooks section mentions --no-stash", () => {
    const content = readFileSync(agentsMdPath, "utf8");
    const gitHooksIndex = content.indexOf("## Git Hooks");
    expect(gitHooksIndex).toBeGreaterThan(-1);

    // Find the next section header after ## Git Hooks
    const nextSectionIndex = content.indexOf("## ", gitHooksIndex + 1);
    const gitHooksSection =
      nextSectionIndex > -1
        ? content.substring(gitHooksIndex, nextSectionIndex)
        : content.substring(gitHooksIndex);

    expect(gitHooksSection).toContain("--no-stash");
  });
});
