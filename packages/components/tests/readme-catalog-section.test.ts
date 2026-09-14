import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

describe("README Catalog Section Structure", () => {
  // Use dirname + fileURLToPath instead of new URL(..., import.meta.url) because
  // Vite rewrites new URL() expressions in a way that breaks path resolution in tests
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const readmePath = resolve(rootDir, "README.md");
  const readmeContent = readFileSync(readmePath, "utf8");
  const lines = readmeContent.split("\n");

  const catalogLabels = [
    "Foundation",
    "UI Primitives",
    "Renderers",
    "Tendril Shell",
    "Tendril Widgets",
    "Inputs & Controls",
    "Specialized Components",
  ];

  it("has exactly one Visual Catalog Structure heading", () => {
    const catalogHeadings = lines.filter((line) => line.trim() === "### Visual Catalog Structure");
    expect(catalogHeadings).toHaveLength(1);
  });

  it("has catalog bullets directly under the Visual Catalog Structure heading", () => {
    const catalogHeadingIndex = lines.findIndex(
      (line) => line.trim() === "### Visual Catalog Structure",
    );
    expect(catalogHeadingIndex).toBeGreaterThan(-1);

    // Find the next H2/H3/H4 heading after the catalog heading
    const nextHeadingIndex = lines.findIndex(
      (line, idx) => idx > catalogHeadingIndex && /^#{2,4} /.test(line),
    );
    expect(nextHeadingIndex).toBeGreaterThan(catalogHeadingIndex);

    const catalogSection = lines.slice(catalogHeadingIndex, nextHeadingIndex);

    // The section should contain the intro sentence
    const hasIntro = catalogSection.some((line) =>
      line.includes("The Storybook catalog is organized into the following sections:"),
    );
    expect(hasIntro).toBe(true);

    // The section should contain exactly 7 bullets starting with "- **"
    const bullets = catalogSection.filter((line) => line.startsWith("- **"));
    expect(bullets).toHaveLength(7);

    // Each catalog label should appear in the section
    for (const label of catalogLabels) {
      const hasLabel = catalogSection.some((line) => line.includes(label));
      if (!hasLabel) {
        throw new Error(
          `Catalog label "${label}" not found in Visual Catalog Structure section. ` +
            `The bullets may have drifted out of their section.`,
        );
      }
    }
  });

  it("has no catalog bullets orphaned between CI heading and Development heading", () => {
    const ciHeadingIndex = lines.findIndex((line) => line.trim() === "#### CI");
    const devHeadingIndex = lines.findIndex(
      (line) => line.trim() === "## Development & Quality Gates",
    );

    expect(ciHeadingIndex).toBeGreaterThan(-1);
    expect(devHeadingIndex).toBeGreaterThan(ciHeadingIndex);

    const betweenSection = lines.slice(ciHeadingIndex, devHeadingIndex);
    const orphanedBullets = betweenSection.filter((line) => {
      if (!line.startsWith("- **")) return false;
      return catalogLabels.some((label) => line.includes(label));
    });

    if (orphanedBullets.length > 0) {
      throw new Error(
        `Found ${orphanedBullets.length} catalog bullet(s) orphaned between "#### CI" and "## Development & Quality Gates". ` +
          `The Visual Catalog Structure bullets have drifted out of their section.`,
      );
    }

    expect(orphanedBullets).toHaveLength(0);
  });
});
