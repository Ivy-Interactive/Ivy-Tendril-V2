import path from "node:path";
import type { TestRunnerConfig } from "@storybook/test-runner";
import { getStoryContext, waitForPageReady } from "@storybook/test-runner";
import { checkA11y, configureAxe, injectAxe } from "axe-playwright";
import { toMatchImageSnapshot } from "jest-image-snapshot";
import { readStoryGlobals } from "./globals";

// `expect` is Jest's global inside the Storybook test runner; this project's tsconfig does not
// include the jest types, so declare the surface used here. The matcher itself stays untyped and is
// reached behind the @ts-expect-error below.
declare const expect: {
  (received: unknown): unknown;
  extend: (matchers: Record<string, unknown>) => void;
};

/** Read per call rather than once at import time, so a test can flip it between cases. */
const isVisualRun = () => process.env.STORYBOOK_VISUAL_REGRESSION === "true";

const snapshotsDir = path.join(process.cwd(), ".storybook", "__image_snapshots__");

// Neutralises everything that would otherwise make two screenshots of the same story differ:
// running animations and transitions, blinking text carets, and smooth scrolling.
const FREEZE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    animation-play-state: paused !important;
    transition: none !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
  }
`;

const config: TestRunnerConfig = {
  setup() {
    expect.extend({ toMatchImageSnapshot });
  },
  async preVisit(page) {
    if (isVisualRun()) {
      return;
    }

    await injectAxe(page as any);
  },
  async postVisit(page, context) {
    const storyContext = await getStoryContext(page, context);

    // The accessibility pass and the visual pass are mutually exclusive. An axe violation throws
    // before a screenshot could be taken, which would leave that story without a baseline; CI runs
    // the two passes as separate jobs instead.
    if (!isVisualRun()) {
      if (storyContext.parameters?.a11y?.disable) {
        return;
      }

      await configureAxe(page as any, {
        rules: storyContext.parameters?.a11y?.config?.rules,
      });

      await checkA11y(page as any, "#storybook-root", {
        detailedReport: true,
        detailedReportOptions: {
          html: true,
        },
        axeOptions: storyContext.parameters?.a11y?.options,
      });

      return;
    }

    if (storyContext.parameters?.visual?.disable) {
      return;
    }

    // Wait for webfonts and network idle first, then freeze: injecting the CSS earlier would
    // suppress the very work this call waits on.
    await waitForPageReady(page);
    await page.addStyleTag({ content: FREEZE_CSS });
    await page.waitForTimeout(100);

    const rootElement = await page.$("#storybook-root");
    if (!rootElement) {
      throw new Error(`No #storybook-root element found for story ${storyContext.id}`);
    }

    const image = await rootElement.screenshot();
    const { theme = "light", density = "Medium" } = readStoryGlobals(storyContext);

    // @ts-expect-error jest-image-snapshot matchers extended on expect
    expect(image).toMatchImageSnapshot({
      customSnapshotsDir: snapshotsDir,
      customSnapshotIdentifier: `${storyContext.id}-${theme}-${density.toLowerCase()}`,
      customDiffDir: path.join(snapshotsDir, "__diff_output__"),
      failureThreshold: 0.01,
      failureThresholdType: "percent",
    });
  },
};

export default config;
