import { afterEach, describe, expect, it, vi } from "vite-plus/test";

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

import { readStoryGlobals } from "../.storybook/globals";
import testRunnerConfig from "../.storybook/test-runner";
import previewConfig from "../.storybook/preview";

describe("Storybook Globals Typing", () => {
  describe("readStoryGlobals", () => {
    it("returns empty object for empty input", () => {
      expect(readStoryGlobals({})).toEqual({});
    });

    it("returns empty object for undefined globals", () => {
      expect(readStoryGlobals({ globals: undefined })).toEqual({});
    });

    it("returns empty object for undefined input", () => {
      expect(readStoryGlobals(undefined)).toEqual({});
    });

    it("returns the globals object unchanged for valid input", () => {
      const globals = { theme: "dark" as const, density: "Small" as const };
      expect(readStoryGlobals({ globals })).toEqual(globals);
    });
  });

  describe("test-runner postVisit with visual regression", () => {
    const originalEnv = process.env.STORYBOOK_VISUAL_REGRESSION;

    afterEach(() => {
      process.env.STORYBOOK_VISUAL_REGRESSION = originalEnv;
      vi.clearAllMocks();
    });

    it("generates snapshot identifier with custom theme and density", async () => {
      process.env.STORYBOOK_VISUAL_REGRESSION = "true";

      const mockImage = Buffer.from("fake-image");
      const mockRootElement = {
        screenshot: vi.fn().mockResolvedValue(mockImage),
      };
      const mockPage = {
        $: vi.fn().mockResolvedValue(mockRootElement),
      } as any;

      const mockMatcher = vi.fn();
      (global as any).expect = Object.assign(
        (_value: any) => ({
          toMatchImageSnapshot: mockMatcher,
        }),
        expect,
      );

      const mockContext = {
        id: "button--primary",
        parameters: {},
        globals: { theme: "dark", density: "Small" },
      };

      if (testRunnerConfig.postVisit) {
        await testRunnerConfig.postVisit(mockPage, mockContext as any);
      }

      expect(mockMatcher).toHaveBeenCalledWith({
        customSnapshotIdentifier: "button--primary-dark-small",
        failureThreshold: 0.01,
        failureThresholdType: "percent",
      });
    });

    it("uses default light theme and medium density when globals are absent", async () => {
      process.env.STORYBOOK_VISUAL_REGRESSION = "true";

      const mockImage = Buffer.from("fake-image");
      const mockRootElement = {
        screenshot: vi.fn().mockResolvedValue(mockImage),
      };
      const mockPage = {
        $: vi.fn().mockResolvedValue(mockRootElement),
      } as any;

      const mockMatcher = vi.fn();
      (global as any).expect = Object.assign(
        (_value: any) => ({
          toMatchImageSnapshot: mockMatcher,
        }),
        expect,
      );

      const mockContext = {
        id: "button--secondary",
        parameters: {},
      };

      if (testRunnerConfig.postVisit) {
        await testRunnerConfig.postVisit(mockPage, mockContext as any);
      }

      expect(mockMatcher).toHaveBeenCalledWith({
        customSnapshotIdentifier: "button--secondary-light-medium",
        failureThreshold: 0.01,
        failureThresholdType: "percent",
      });
    });
  });

  describe("preview decorator with globals", () => {
    it("renders with dark theme and small density", () => {
      const decorators = previewConfig.decorators;
      expect(decorators).toBeDefined();
      expect(Array.isArray(decorators)).toBe(true);

      if (Array.isArray(decorators) && decorators.length > 0) {
        const decorator = decorators[0] as any;
        const MockStory = () => null;
        const context = {
          globals: { theme: "dark", density: "Small" },
        };

        const result = decorator(MockStory, context);
        expect(result).toBeDefined();
      }
    });

    it("renders with default light theme and medium density when globals are absent", () => {
      const decorators = previewConfig.decorators;
      expect(decorators).toBeDefined();
      expect(Array.isArray(decorators)).toBe(true);

      if (Array.isArray(decorators) && decorators.length > 0) {
        const decorator = decorators[0] as any;
        const MockStory = () => null;
        const context = {};

        const result = decorator(MockStory, context);
        expect(result).toBeDefined();
      }
    });
  });
});
