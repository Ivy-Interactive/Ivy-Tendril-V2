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
  waitForPageReady: vi.fn().mockResolvedValue(undefined),
}));

import { checkA11y, configureAxe, injectAxe } from "axe-playwright";
import mainConfig from "../.storybook/main.ts";
import previewConfig from "../.storybook/preview.tsx";
import testRunnerConfig from "../.storybook/test-runner.ts";

describe("Storybook Configuration", () => {
  it("registers the docs and a11y addons in main.ts", () => {
    expect(mainConfig).toBeDefined();
    expect(mainConfig.stories).toBeDefined();
    expect(mainConfig.framework).toEqual({
      name: "@storybook/react-vite",
      options: {},
    });

    const addons = mainConfig.addons ?? [];
    expect(addons).toContain("@storybook/addon-docs");
    expect(addons).toContain("@storybook/addon-a11y");
    // Storybook 9 deleted `addon-essentials` and moved interactions into core. Listing either
    // again is not a no-op - it makes Storybook fail to resolve the addon at startup.
    expect(addons).not.toContain("@storybook/addon-essentials");
    expect(addons).not.toContain("@storybook/addon-interactions");
  });

  it("configures a11y and backgrounds parameters in preview.tsx", () => {
    expect(previewConfig).toBeDefined();
    expect(previewConfig.parameters).toBeDefined();
    expect(previewConfig.parameters?.a11y).toBeDefined();
    expect(previewConfig.parameters?.backgrounds).toBeDefined();
    // SB9's backgrounds format: an `options` map keyed by the value the global takes, replacing
    // the old `values` array. The chosen key moved to `initialGlobals.backgrounds.value`.
    expect(previewConfig.parameters?.backgrounds?.options).toEqual(
      expect.objectContaining({
        light: expect.objectContaining({ value: "#ffffff" }),
        dark: expect.objectContaining({ value: "#0a0a0a" }),
      }),
    );
    expect(previewConfig.initialGlobals?.backgrounds).toEqual({ value: "light" });
  });

  it("supplies globalTypes defaults through initialGlobals in preview.tsx", () => {
    // `globalTypes.defaultValue` stopped being read in SB9; a default left only there silently
    // becomes undefined, which would strand the theme/density decorator on its fallbacks.
    for (const globalType of Object.values(previewConfig.globalTypes ?? {})) {
      expect(globalType).not.toHaveProperty("defaultValue");
    }
    expect(previewConfig.initialGlobals?.theme).toBe("light");
    expect(previewConfig.initialGlobals?.density).toBe("Medium");
  });

  it("configures test runner hooks for axe accessibility audits in test-runner.ts", async () => {
    expect(testRunnerConfig).toBeDefined();
    expect(typeof testRunnerConfig.preVisit).toBe("function");
    expect(typeof testRunnerConfig.postVisit).toBe("function");
    expect(testRunnerConfig.preVisit).toHaveLength(2);
    expect(testRunnerConfig.postVisit).toHaveLength(2);

    const mockPage = {} as any;
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

    if (testRunnerConfig.preVisit) {
      await testRunnerConfig.preVisit(mockPage, mockContext as any);
      expect(injectAxe).toHaveBeenCalledWith(mockPage);
    }

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

  it("throws axe audit violations by default", async () => {
    vi.clearAllMocks();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockPage = {} as any;
    const mockContext = {
      id: "test--violation",
      title: "Test",
      name: "Violation",
      parameters: {
        a11y: {},
      },
    };

    const violationError = new Error("Found 2 accessibility violations");
    vi.mocked(checkA11y).mockRejectedValueOnce(violationError);

    if (testRunnerConfig.postVisit) {
      await expect(testRunnerConfig.postVisit(mockPage, mockContext as any)).rejects.toThrow(
        "Found 2 accessibility violations",
      );
      expect(warnSpy).not.toHaveBeenCalled();
    }

    warnSpy.mockRestore();
  });

  it("catches axe audit violations and logs a warning via console.warn without throwing when failOnViolation is false", async () => {
    vi.clearAllMocks();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mockPage = {} as any;
    const mockContext = {
      id: "test--opted-out-violation",
      title: "Test",
      name: "Opted Out Violation",
      parameters: {
        a11y: {
          failOnViolation: false,
        },
      },
    };

    const violationError = new Error("Opted-out accessibility violation");
    vi.mocked(checkA11y).mockRejectedValueOnce(violationError);

    if (testRunnerConfig.postVisit) {
      await expect(testRunnerConfig.postVisit(mockPage, mockContext as any)).resolves.not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("test--opted-out-violation"));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Opted-out accessibility violation"),
      );
    }

    warnSpy.mockRestore();
  });
});
