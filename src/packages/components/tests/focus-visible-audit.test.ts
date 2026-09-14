import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vite-plus/test";

describe("Shell/AgentViewer Focus-Visible Styling Audit", () => {
  const shellCssPath = resolve(__dirname, "..", "src/components/Shell/shell.css");
  const shellCss = readFileSync(shellCssPath, "utf-8");
  const agentOutputCssPath = resolve(
    __dirname,
    "..",
    "src/components/AgentViewer/agent-output.css",
  );
  const agentOutputCss = readFileSync(agentOutputCssPath, "utf-8");

  const cases: Array<{ file: string; css: string; selector: string }> = [
    { file: "shell.css", css: shellCss, selector: ".tsh-tab-main" },
    { file: "shell.css", css: shellCss, selector: ".tsh-tab-close" },
    { file: "agent-output.css", css: agentOutputCss, selector: ".aov-tool-header" },
    { file: "agent-output.css", css: agentOutputCss, selector: ".aov-tool-group-header" },
  ];

  for (const { file, css, selector } of cases) {
    test(`${file} declares a ${selector}:focus-visible rule with an outline`, () => {
      const focusVisibleSelector = `${selector}:focus-visible`;
      expect(css).toContain(focusVisibleSelector);
      const escaped = focusVisibleSelector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
      expect(match).not.toBeNull();
      expect(match?.[1]).toMatch(/outline:/);
    });

    test(`${file} does not introduce a bare ${selector}:focus selector`, () => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(css).not.toMatch(new RegExp(`${escaped}:focus\\s*[,{]`));
    });
  }
});
