import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("axe-playwright", () => ({
  injectAxe: vi.fn().mockResolvedValue(undefined),
  configureAxe: vi.fn().mockResolvedValue(undefined),
  checkA11y: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@storybook/test-runner", () => ({
  getStoryContext: vi.fn().mockImplementation((_page, context) => {
    return Promise.resolve(context);
  }),
}));

import { checkA11y, configureAxe, injectAxe } from "axe-playwright";
import mainConfig from "../.storybook/main.ts";
import previewConfig from "../.storybook/preview.tsx";
import testRunnerConfig from "../.storybook/test-runner.ts";

describe("Storybook Configuration", () => {
  it("registers essential, a11y, and interactions addons in main.ts", () => {
    expect(mainConfig).toBeDefined();
    expect(mainConfig.stories).toBeDefined();
    expect(mainConfig.framework).toEqual({
      name: "@storybook/react-vite",
      options: {},
    });

    const addons = mainConfig.addons ?? [];
    expect(addons).toContain("@storybook/addon-essentials");
    expect(addons).toContain("@storybook/addon-a11y");
    expect(addons).toContain("@storybook/addon-interactions");
  });

  it("configures a11y and backgrounds parameters in preview.tsx", () => {
    expect(previewConfig).toBeDefined();
    expect(previewConfig.parameters).toBeDefined();
    expect(previewConfig.parameters?.a11y).toBeDefined();
    expect(previewConfig.parameters?.backgrounds).toBeDefined();
    expect(previewConfig.parameters?.backgrounds?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "light", value: "#ffffff" }),
        expect.objectContaining({ name: "dark", value: "#0a0a0a" }),
      ]),
    );
  });

  it("configures test runner hooks for axe accessibility audits in test-runner.ts", async () => {
    expect(testRunnerConfig).toBeDefined();
    expect(typeof testRunnerConfig.preVisit).toBe("function");
    expect(typeof testRunnerConfig.postVisit).toBe("function");

    const mockPage = {} as any;
    if (testRunnerConfig.preVisit) {
      await testRunnerConfig.preVisit(mockPage);
      expect(injectAxe).toHaveBeenCalledWith(mockPage);
    }

    const mockContext = {
      id: "foundation-themeprovider--default",
      title: "Foundation/ThemeProvider",
      name: "Default",
      parameters: {
        a11y: {
          config: { rules: [{ id: "color-contrast", enabled: true }] },
          options: { runOnly: ["wcag2a", "wcag2aa"] },
        },
      },
    };

    if (testRunnerConfig.postVisit) {
      await testRunnerConfig.postVisit(mockPage, mockContext as any);
      expect(configureAxe).toHaveBeenCalledWith(mockPage, {
        rules: [{ id: "color-contrast", enabled: true }],
      });
      expect(checkA11y).toHaveBeenCalledWith(mockPage, "#storybook-root", {
        detailedReport: true,
        detailedReportOptions: {
          html: true,
        },
        axeOptions: { runOnly: ["wcag2a", "wcag2aa"] },
      });
    }
  });

  it("skips axe checks in test-runner postVisit when a11y is disabled", async () => {
    vi.clearAllMocks();
    const mockPage = {} as any;
    const mockContextDisabled = {
      id: "test--disabled",
      title: "Test",
      name: "Disabled",
      parameters: {
        a11y: {
          disable: true,
        },
      },
    };

    if (testRunnerConfig.postVisit) {
      await testRunnerConfig.postVisit(mockPage, mockContextDisabled as any);
      expect(configureAxe).not.toHaveBeenCalled();
      expect(checkA11y).not.toHaveBeenCalled();
    }
  });
});
