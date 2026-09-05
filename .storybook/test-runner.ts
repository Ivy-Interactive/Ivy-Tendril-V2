import type { TestRunnerConfig } from "@storybook/test-runner";
import { getStoryContext } from "@storybook/test-runner";
import { checkA11y, configureAxe, injectAxe } from "axe-playwright";
import { readStoryGlobals } from "./globals";

const config: TestRunnerConfig = {
  async preVisit(page, _context) {
    await injectAxe(page);
  },
  async postVisit(page, context) {
    const storyContext = await getStoryContext(page, context);

    if (storyContext.parameters?.a11y?.disable) {
      return;
    }

    await configureAxe(page, {
      rules: storyContext.parameters?.a11y?.config?.rules,
    });

    await checkA11y(page, "#storybook-root", {
      detailedReport: true,
      detailedReportOptions: {
        html: true,
      },
      axeOptions: storyContext.parameters?.a11y?.options,
    });

    if (storyContext.parameters?.visual?.disable) {
      return;
    }

    if (process.env.STORYBOOK_VISUAL_REGRESSION === "true") {
      const rootElement = await page.$("#storybook-root");
      if (rootElement) {
        const image = await rootElement.screenshot();
        const { theme = "light", density = "Medium" } = readStoryGlobals(storyContext);
        const snapshotIdentifier = `${storyContext.id}-${theme}-${density.toLowerCase()}`;

        expect(image).toMatchImageSnapshot({
          customSnapshotIdentifier: snapshotIdentifier,
          failureThreshold: 0.01,
          failureThresholdType: "percent",
        });
      }
    }
  },
};

export default config;
