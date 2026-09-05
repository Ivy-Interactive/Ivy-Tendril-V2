import type { TestRunnerConfig } from "@storybook/test-runner";
import { getStoryContext } from "@storybook/test-runner";
import { checkA11y, configureAxe, injectAxe } from "axe-playwright";

const config: TestRunnerConfig = {
  async preVisit(page) {
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
        const theme = storyContext.globals?.theme || "light";
        const density = storyContext.globals?.density || "medium";
        const snapshotIdentifier = `${storyContext.id}-${theme}-${density.toLowerCase()}`;

        // @ts-expect-error jest-image-snapshot matchers extended on expect
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
