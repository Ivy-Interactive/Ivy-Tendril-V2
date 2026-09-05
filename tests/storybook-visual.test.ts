import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("axe-playwright", () => ({
  injectAxe: vi.fn().mockResolvedValue(undefined),
  configureAxe: vi.fn().mockResolvedValue(undefined),
  checkA11y: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@storybook/test-runner", () => ({
  getStoryContext: vi.fn().mockImplementation((_page, context) => Promise.resolve(context)),
  waitForPageReady: vi.fn().mockResolvedValue(undefined),
}));

import { waitForPageReady } from "@storybook/test-runner";
import { checkA11y, configureAxe, injectAxe } from "axe-playwright";
import visualConfig from "../.storybook/test-runner.ts";
import webViewerMeta from "../src/components/WebViewer/WebViewer.stories.tsx";
import calendarMeta from "../src/stories/calendar.stories.tsx";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface PackageManifest {
  scripts?: Record<string, string>;
}

const packageJson = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
) as PackageManifest;

/** `expect` is a Jest global inside the real test runner; here it is Vitest's, untyped by tsconfig. */
const globalScope = globalThis as unknown as { expect: unknown };

interface SnapshotCall {
  received: unknown;
  options: Record<string, unknown>;
}

/**
 * Swaps the global `expect` for a stub that records `toMatchImageSnapshot` calls, so the matcher
 * options can be inspected without a real image comparison.
 */
async function captureSnapshotCalls(run: () => Promise<void>): Promise<SnapshotCall[]> {
  const calls: SnapshotCall[] = [];
  const original = globalScope.expect;

  globalScope.expect = (received: unknown) => ({
    toMatchImageSnapshot(options: Record<string, unknown>) {
      calls.push({ received, options });
    },
  });

  try {
    await run();
  } finally {
    globalScope.expect = original;
  }

  return calls;
}

function createPage(order: string[]) {
  const rootElement = {
    screenshot: vi.fn().mockResolvedValue(Buffer.from("png")),
  };

  vi.mocked(waitForPageReady).mockImplementation(() => {
    order.push("waitForPageReady");
    return Promise.resolve();
  });

  return {
    page: {
      addStyleTag: vi.fn().mockImplementation((options: { content: string }) => {
        order.push(
          `addStyleTag:${options.content.includes("animation: none") ? "freeze" : "other"}`,
        );
        return Promise.resolve();
      }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      $: vi.fn().mockImplementation((selector: string) => {
        order.push(`$:${selector}`);
        return Promise.resolve(rootElement);
      }),
    },
    rootElement,
  };
}

describe("Storybook visual regression runner", () => {
  beforeAll(() => {
    vi.stubEnv("STORYBOOK_VISUAL_REGRESSION", "true");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.mocked(waitForPageReady).mockClear();
    vi.mocked(injectAxe).mockClear();
    vi.mocked(configureAxe).mockClear();
    vi.mocked(checkA11y).mockClear();
  });

  it("registers the jest-image-snapshot matcher from setup()", () => {
    expect(typeof visualConfig.setup).toBe("function");

    const original = globalScope.expect;
    try {
      visualConfig.setup?.();
      const globalExpect = globalScope.expect as (received: unknown) => Record<string, unknown>;
      expect(typeof globalExpect(Buffer.from("png")).toMatchImageSnapshot).toBe("function");
    } finally {
      globalScope.expect = original;
    }
  });

  it("skips axe entirely on a visual run and waits for the page before screenshotting", async () => {
    const order: string[] = [];
    const { page, rootElement } = createPage(order);

    await visualConfig.preVisit?.(page as never, { id: "x", title: "X", name: "x" });
    expect(injectAxe).not.toHaveBeenCalled();

    const calls = await captureSnapshotCalls(async () => {
      await visualConfig.postVisit?.(page as never, {
        id: "ui-button--default",
        title: "UI/Button",
        name: "Default",
      });
    });

    expect(configureAxe).not.toHaveBeenCalled();
    expect(checkA11y).not.toHaveBeenCalled();

    // The frozen CSS must go in after waitForPageReady, or it would suppress the very
    // font-loading work that call waits on.
    expect(waitForPageReady).toHaveBeenCalledWith(page);
    expect(order).toEqual(["waitForPageReady", "addStyleTag:freeze", "$:#storybook-root"]);

    expect(page.waitForTimeout).toHaveBeenCalledWith(100);
    expect(rootElement.screenshot).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it("writes baselines to .storybook/__image_snapshots__ with a theme and density identifier", async () => {
    const order: string[] = [];
    const { page } = createPage(order);

    const calls = await captureSnapshotCalls(async () => {
      await visualConfig.postVisit?.(page as never, {
        id: "ui-button--default",
        title: "UI/Button",
        name: "Default",
      });
    });

    const options = calls[0]!.options;
    expect(String(options.customSnapshotsDir).replace(/\\/g, "/")).toMatch(
      /\.storybook\/__image_snapshots__$/,
    );
    expect(String(options.customDiffDir).replace(/\\/g, "/")).toMatch(
      /\.storybook\/__image_snapshots__\/__diff_output__$/,
    );
    expect(options.customSnapshotIdentifier).toBe("ui-button--default-light-medium");
    expect(options.failureThreshold).toBe(0.01);
    expect(options.failureThresholdType).toBe("percent");
  });

  it("derives the identifier from the story globals when they are set", async () => {
    const order: string[] = [];
    const { page } = createPage(order);

    const calls = await captureSnapshotCalls(async () => {
      await visualConfig.postVisit?.(
        page as never,
        {
          id: "foundation-typography--dark",
          title: "Foundation/Typography",
          name: "Dark",
          globals: { theme: "dark", density: "Large" },
        } as never,
      );
    });

    expect(calls[0]!.options.customSnapshotIdentifier).toBe(
      "foundation-typography--dark-dark-large",
    );
  });

  it("takes no screenshot for a story with parameters.visual.disable", async () => {
    const order: string[] = [];
    const { page, rootElement } = createPage(order);

    const calls = await captureSnapshotCalls(async () => {
      await visualConfig.postVisit?.(
        page as never,
        {
          id: "ui-calendar--default",
          title: "UI/Calendar",
          name: "Default",
          parameters: { visual: { disable: true } },
        } as never,
      );
    });

    expect(waitForPageReady).not.toHaveBeenCalled();
    expect(page.$).not.toHaveBeenCalled();
    expect(rootElement.screenshot).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});

describe("Nondeterministic story opt-outs", () => {
  it("opts UI/Calendar out of visual regression", () => {
    expect(calendarMeta.parameters?.visual?.disable).toBe(true);
  });

  it("opts Components/WebViewer out of visual regression while keeping fullscreen layout", () => {
    expect(webViewerMeta.parameters?.visual?.disable).toBe(true);
    expect(webViewerMeta.parameters?.layout).toBe("fullscreen");
  });
});

describe("Visual regression package scripts", () => {
  const scripts = packageJson.scripts ?? {};

  it("defines test-storybook:visual:ci against the static build", () => {
    const script = scripts["test-storybook:visual:ci"];
    expect(script).toBeDefined();
    expect(script).toContain("STORYBOOK_VISUAL_REGRESSION=true");
    expect(script).toContain("storybook-static");
    expect(script).toContain("-a 127.0.0.1");
    expect(script).not.toContain("--updateSnapshot");
  });

  it("defines test-storybook:visual:update:ci against the static build", () => {
    const script = scripts["test-storybook:visual:update:ci"];
    expect(script).toBeDefined();
    expect(script).toContain("STORYBOOK_VISUAL_REGRESSION=true");
    expect(script).toContain("storybook-static");
    expect(script).toContain("-a 127.0.0.1");
    expect(script).toContain("--updateSnapshot");
  });

  it("leaves the dev-server visual scripts untouched", () => {
    expect(scripts["test-storybook:visual"]).toBe(
      "cross-env STORYBOOK_VISUAL_REGRESSION=true test-storybook",
    );
    expect(scripts["test-storybook:visual:update"]).toBe(
      "cross-env STORYBOOK_VISUAL_REGRESSION=true test-storybook --updateSnapshot",
    );
  });
});
