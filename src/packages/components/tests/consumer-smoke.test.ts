import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

// Import from built dist artifact to test consumer behavior
import {
  TendrilShell,
  PlanMarkdown,
  PlanDiffView,
  AgentViewer,
  TendrilProcessViewer,
  ContentInput,
  BadgeSelect,
  SortableVerificationList,
  TendrilDashboard,
  TendrilQuestions,
} from "../dist/tendril.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("Consumer Smoke Verification", () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));

  it("verifies package packing succeeds with pnpm pack", () => {
    const packOutput = execSync("pnpm pack --dry-run", {
      cwd: repoRoot,
      encoding: "utf-8",
    });
    expect(packOutput).toContain("@ivy-interactive/components");
    expect(packOutput).toContain("dist/style.css");
    expect(packOutput).toContain("dist/tendril.mjs");
    expect(packOutput).toContain("dist/tendril.d.mts");
  });

  it("verifies all declared export map targets exist on disk", () => {
    const exportsMap = packageJson.exports as Record<
      string,
      string | { import?: string; types?: string }
    >;

    expect(exportsMap["."]).toBeDefined();
    expect(exportsMap["./tendril"]).toBeDefined();
    expect(exportsMap["./ui"]).toBeDefined();
    expect(exportsMap["./renderers"]).toBeDefined();
    expect(exportsMap["./style.css"]).toBeDefined();

    const expectedFiles = [
      "dist/index.mjs",
      "dist/index.d.mts",
      "dist/tendril.mjs",
      "dist/tendril.d.mts",
      "dist/ui.mjs",
      "dist/ui.d.mts",
      "dist/renderers.mjs",
      "dist/renderers.d.mts",
      "dist/style.css",
    ];

    for (const file of expectedFiles) {
      const fullPath = join(repoRoot, file);
      expect(existsSync(fullPath), `Expected ${file} to exist on disk`).toBe(true);
      const stats = statSync(fullPath);
      expect(stats.size).toBeGreaterThan(0);
    }
  });

  it("verifies dist/style.css contains essential design tokens", () => {
    const cssContent = readFileSync(join(repoRoot, "dist/style.css"), "utf-8");
    expect(cssContent.length).toBeGreaterThan(1000);
    expect(cssContent).toContain("--primary");
    expect(cssContent).toContain("--font-sans");
    expect(cssContent).toContain("--font-mono");
  });

  describe("Smoke renders Tendril widgets from built artifact", () => {
    const noopHandler = () => {};

    it("renders TendrilShell", () => {
      const { container } = render(
        React.createElement(TendrilShell, {
          id: "smoke-shell",
          eventHandler: noopHandler,
          slots: {
            Content: React.createElement("div", null, "Shell Content"),
          },
        }),
      );
      expect(container.querySelector(".tsh-root, [class*='tsh-']")).not.toBeNull();
    });

    it("renders PlanMarkdown", () => {
      const { container } = render(
        React.createElement(PlanMarkdown, {
          id: "smoke-markdown",
          content: "# Smoke Header\n\nSmoke paragraph content.",
        }),
      );
      expect(container.querySelector(".pmv-markdown, .pmv-root")).not.toBeNull();
      expect(container.textContent).toContain("Smoke Header");
    });

    it("renders PlanDiffView", () => {
      const { container } = render(
        React.createElement(PlanDiffView, {
          id: "smoke-diff",
          diff: "--- a/test.txt\n+++ b/test.txt\n@@ -1 +1 @@\n-old\n+new\n",
        }),
      );
      expect(container.querySelector(".diff, [class*='diff']")).not.toBeNull();
    });

    it("renders AgentViewer", () => {
      const { container } = render(
        React.createElement(AgentViewer, {
          id: "smoke-agent",
          eventHandler: noopHandler,
          events: [],
        }),
      );
      expect(container.querySelector(".aov-root, [class*='aov-']")).not.toBeNull();
    });

    it("renders TendrilProcessViewer", () => {
      const { container } = render(
        React.createElement(TendrilProcessViewer, {
          id: "smoke-process",
          eventHandler: noopHandler,
        }),
      );
      expect(container).not.toBeNull();
    });

    it("renders ContentInput", () => {
      const { container } = render(
        React.createElement(ContentInput, {
          id: "smoke-input",
        }),
      );
      expect(container.querySelector(".content-input, textarea, input")).not.toBeNull();
    });

    it("renders BadgeSelect", () => {
      const { container } = render(
        React.createElement(BadgeSelect, {
          id: "smoke-badge-select",
          options: [{ label: "Choice A", value: "a" }],
        }),
      );
      expect(container.querySelector(".bselect, [class*='bselect']")).not.toBeNull();
    });

    it("renders SortableVerificationList", () => {
      const { container } = render(
        React.createElement(SortableVerificationList, {
          id: "smoke-verifications",
          itemsJson: "[]",
        }),
      );
      expect(container.querySelector(".svl-container, [class*='svl-']")).not.toBeNull();
    });

    it("renders TendrilDashboard", () => {
      const { container } = render(
        React.createElement(TendrilDashboard, {
          id: "smoke-dashboard",
          eventHandler: noopHandler,
          greeting: "Hello SpaceCorps",
        }),
      );
      expect(container.querySelector(".tdb-dashboard, [class*='tdb-']")).not.toBeNull();
      expect(container.textContent).toContain("Hello SpaceCorps");
    });

    it("renders TendrilQuestions", () => {
      const { container } = render(
        React.createElement(TendrilQuestions, {
          id: "smoke-questions",
          eventHandler: noopHandler,
          content: "- id: q1\n  title: Proceed?\n  options:\n    - title: Yes\n      value: yes",
        }),
      );
      expect(container.querySelector(".tq-root, [class*='tq-']")).not.toBeNull();
      expect(container.textContent).toContain("Proceed?");
    });
  });
});
