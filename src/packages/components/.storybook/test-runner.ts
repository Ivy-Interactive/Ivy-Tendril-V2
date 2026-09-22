import path from "node:path";
import type { TestRunnerConfig } from "@storybook/test-runner";
import { getStoryContext, waitForPageReady } from "@storybook/test-runner";
import { checkA11y, configureAxe, injectAxe } from "axe-playwright";
import { toMatchImageSnapshot } from "jest-image-snapshot";
import { DEFAULT_LOCALE } from "../src/i18n/locales";
import { readStoryGlobals } from "./globals";

// `expect` is Jest's global inside the Storybook test runner. tsconfig.json lists
// "jest-image-snapshot" in `types`, which brings in both the jest globals and the
// toMatchImageSnapshot matcher, so nothing needs declaring or suppressing here.

/** Read per call rather than once at import time, so a test can flip it between cases. */
const isVisualRun = () => process.env.STORYBOOK_VISUAL_REGRESSION === "true";

const snapshotsDir = path.join(process.cwd(), ".storybook", "__image_snapshots__");

/**
 * Settle time between freezing the page and screenshotting it. Stories that lazy-load their renderer
 * keep working after `waitForPageReady` resolves, so they can ask for longer through
 * `parameters.visual.settleDelay`.
 */
const DEFAULT_SETTLE_DELAY_MS = 100;

/**
 * How long to wait for a story's `parameters.visual.waitForSelector`. A canvas renderer signals that
 * it has painted by setting an attribute, which is a far tighter gate than a fixed delay.
 */
const WAIT_FOR_SELECTOR_TIMEOUT_MS = 15_000;

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
  async preVisit(page, _context) {
    if (isVisualRun()) {
      return;
    }

    await injectAxe(page);
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

      await configureAxe(page, {
        rules: storyContext.parameters?.a11y?.config?.rules,
      });

      try {
        await checkA11y(page, "#storybook-root", {
          detailedReport: true,
          detailedReportOptions: {
            html: true,
          },
          axeOptions: storyContext.parameters?.a11y?.options,
        });
      } catch (error) {
        if (storyContext.parameters?.a11y?.failOnViolation === false) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(
            `[a11y warning] Accessibility violation in story "${storyContext.id}":\n${message}`,
          );
          return;
        }

        throw error;
      }

      return;
    }

    if (storyContext.parameters?.visual?.disable) {
      return;
    }

    // Wait for webfonts and network idle first, then freeze: injecting the CSS earlier would
    // suppress the very work this call waits on.
    await waitForPageReady(page);

    // A story whose renderer paints to a canvas can name the marker it sets when it is done, so the
    // settle delay below starts from "finished drawing" rather than from "network idle".
    const waitForSelector = storyContext.parameters?.visual?.waitForSelector;
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: WAIT_FOR_SELECTOR_TIMEOUT_MS });
    }

    await page.addStyleTag({ content: FREEZE_CSS });
    await page.waitForTimeout(
      storyContext.parameters?.visual?.settleDelay ?? DEFAULT_SETTLE_DELAY_MS,
    );

    const rootElement = await page.$("#storybook-root");
    if (!rootElement) {
      throw new Error(`No #storybook-root element found for story ${storyContext.id}`);
    }

    const image = await rootElement.screenshot();
    const {
      theme = "light",
      density = "Medium",
      locale = DEFAULT_LOCALE,
    } = readStoryGlobals(storyContext);
    // English keeps the identifier it always had, so the existing baselines stay valid; a run in
    // another language gets baselines of its own rather than failing against the English ones.
    const localeSuffix = locale === DEFAULT_LOCALE ? "" : `-${locale}`;

    expect(image).toMatchImageSnapshot({
      customSnapshotsDir: snapshotsDir,
      customSnapshotIdentifier: `${storyContext.id}-${theme}-${density.toLowerCase()}${localeSuffix}`,
      customDiffDir: path.join(snapshotsDir, "__diff_output__"),
      failureThreshold: 0.01,
      failureThresholdType: "percent",
    });
  },
};

export default config;
