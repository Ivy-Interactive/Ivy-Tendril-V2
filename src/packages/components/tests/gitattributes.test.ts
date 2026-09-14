import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

// Resolved in two steps rather than `new URL("../.gitattributes", import.meta.url)`, which Vite
// rewrites into an asset URL that `fileURLToPath` then rejects.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gitattributesPath = resolve(repoRoot, ".gitattributes");

describe(".gitattributes", () => {
  it("exists at the repo root", () => {
    expect(() => readFileSync(gitattributesPath, "utf8")).not.toThrow();
  });

  it("contains a rule for '*' that sets both text=auto and eol=lf", () => {
    const content = readFileSync(gitattributesPath, "utf8");
    const lines = content.split("\n").map((line) => line.trim());

    // Find the line with the '*' pattern
    const starLine = lines.find((line) => {
      // Skip comments and empty lines
      if (line.startsWith("#") || line === "") return false;
      // Check if this line starts with '*' (the pattern)
      return line.startsWith("*") && !line.startsWith("*.");
    });

    expect(starLine).toBeDefined();
    expect(starLine).toMatch(/\btext=auto\b/);
    expect(starLine).toMatch(/\beol=lf\b/);
  });

  it("places the '*' rule before any narrower patterns", () => {
    const content = readFileSync(gitattributesPath, "utf8");
    const lines = content.split("\n").map((line) => line.trim());

    // Find indices of the '*' rule and any narrower patterns (e.g., '*.png')
    let starIndex = -1;
    const narrowerIndices: number[] = [];

    lines.forEach((line, index) => {
      if (line.startsWith("#") || line === "") return;

      if (line.startsWith("*") && !line.startsWith("*.")) {
        starIndex = index;
      } else if (line.match(/^\S+\s/)) {
        // A line starting with a non-whitespace pattern followed by space is a rule
        narrowerIndices.push(index);
      }
    });

    // If there are no narrower patterns, skip this assertion
    if (narrowerIndices.length === 0) {
      expect(true).toBe(true);
      return;
    }

    // Otherwise, verify that '*' comes before all narrower patterns
    expect(starIndex).toBeGreaterThan(-1);
    for (const narrowerIndex of narrowerIndices) {
      expect(starIndex).toBeLessThan(narrowerIndex);
    }
  });
});
