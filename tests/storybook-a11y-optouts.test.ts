import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface A11yOptOut {
  file: string;
  line: number;
  type: "disable" | "failOnViolation";
  hasComment: boolean;
  commentText?: string;
}

function findA11yOptOuts(): A11yOptOut[] {
  const srcDir = path.join(repoRoot, "src");
  const allEntries = readdirSync(srcDir, { recursive: true, encoding: "utf8" });
  const storyFiles = allEntries.filter(
    (f) => f.endsWith(".stories.tsx") || f.endsWith(".stories.ts"),
  );

  const optOuts: A11yOptOut[] = [];

  for (const relativePath of storyFiles) {
    const fullPath = path.join(srcDir, relativePath);
    const content = readFileSync(fullPath, "utf8");
    const lines = content.split("\n");

    let insideA11yBlock = false;
    let a11yBlockIndent = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect start of a11y parameters block: a11y: {
      if (/^\s*a11y:\s*\{/.test(line)) {
        insideA11yBlock = true;
        a11yBlockIndent = line.search(/\S/);
      }

      const isDisable = /disable:\s*true/.test(line);
      const isFailFalse = /failOnViolation:\s*false/.test(line);

      if ((isDisable || isFailFalse) && insideA11yBlock) {
        // Look backwards for a preceding comment (within 10 lines above)
        let hasComment = false;
        let commentText = "";

        for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
          const prevLine = lines[j].trim();
          if (prevLine.startsWith("//") || prevLine.startsWith("/*") || prevLine.endsWith("*/")) {
            hasComment = true;
            commentText = prevLine;
            break;
          }
          // If we hit another story declaration or export, stop looking
          if (/^export\s+const/.test(prevLine)) {
            break;
          }
        }

        optOuts.push({
          file: relativePath,
          line: i + 1,
          type: isDisable ? "disable" : "failOnViolation",
          hasComment,
          commentText,
        });
      }

      // Check if we exited the a11y block
      if (insideA11yBlock && /^\s*\},?/.test(line) && line.search(/\S/) <= a11yBlockIndent) {
        insideA11yBlock = false;
      }
    }
  }

  return optOuts;
}

describe("Storybook Accessibility Opt-Outs Hygiene", () => {
  it("requires every a11y suppression to have a preceding explanation comment", () => {
    const optOuts = findA11yOptOuts();

    for (const optOut of optOuts) {
      expect(
        optOut.hasComment,
        `Accessibility opt-out (${optOut.type}) in ${optOut.file}:${optOut.line} is missing a preceding explanation comment: every a11y suppression must document why it cannot meet accessibility standards.`,
      ).toBe(true);
    }
  });

  it("verifies expected opt-out list is audited and minimal", () => {
    const optOuts = findA11yOptOuts();

    // Currently only WebViewer external iframe has an approved opt-out
    expect(optOuts.length).toBe(1);
    expect(optOuts[0].file).toContain("WebViewer.stories.tsx");
    expect(optOuts[0].type).toBe("disable");
    expect(optOuts[0].hasComment).toBe(true);
  });
});
