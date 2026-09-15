import React, { Suspense, act } from "react";
import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { DashboardView } from "../src/views/DashboardView";
import { planSummary } from "./fixtures/plan.fixture";
import type { PlanSummary, Job } from "../src/types/api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const distAssetsDir = path.join(repoRoot, "dist", "assets");
const distIndexHtml = path.join(repoRoot, "dist", "index.html");

/** Ceiling on the Vite entry chunk (`dist/assets/index-*.js`).
 *
 * Measured 2026-09-14 at d6d7a48: 718,210 bytes, 78.3% of this ceiling. The monolithic
 * baseline before the split in plan 00564 was 3,461,242 bytes, so this is still a ~79%
 * reduction. Measure from a build run outside vitest (`pnpm --filter
 * @ivy-interactive/tendril-app build`) - a build inherited from vitest sees NODE_ENV=test
 * and bundles development React, which inflates the entry chunk by ~28 kB.
 *
 * This number is not a size target, it is the regression guard on the `codeSplitting`
 * group priorities documented in vite.config.ts. The failures it exists to catch move
 * hundreds of KB at once - 1,802,771 bytes eager with `vendor-react` below `vendor-syntax`,
 * 4,290,781 bytes with the non-working `manualChunks` function form - so a ceiling anywhere
 * in this range still trips instantly on a priority mistake. It was raised from 700 kB
 * (716,800 bytes) after organic feature-porting growth overran it by 1,410 bytes and made
 * main CI red on three consecutive commits: the entry chunk was verified to hold no
 * heavyweight, all nine vendor chunks and every lazy view chunk were still separate, and
 * eager JS was 1,383,007 bytes of the 1.6 MB budget below.
 *
 * Before raising it again: check what became eager (the second budget below and the
 * `mustBeLazy` list in the next test), not just this number. */
const ENTRY_CHUNK_BUDGET_BYTES = 896 * 1024;

/** Usage above this fraction of the budget prints a warning, so the next breach is
 * caught in a green run instead of turning main CI red. At the 2026-09-14 measurement
 * this fires at 825,753 bytes, roughly 107 kB of growth away. */
const ENTRY_CHUNK_WARN_RATIO = 0.9;

// The third test below reads dist/, which vitest never builds itself. If dist/
// is missing, or older than the sources it was built from, rebuild it here so
// the test is self-sufficient on a fresh worktree instead of depending on a
// prior `pnpm build` invocation. Rebuild failures are recorded (not thrown)
// so the two render-only tests in this file, which never touch dist/, still
// run when the build step fails or is skipped.
let buildError: string | null = null;

function newestMtimeUnder(dir: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const mtimeMs = entry.isDirectory() ? newestMtimeUnder(full) : fs.statSync(full).mtimeMs;
    if (mtimeMs > newest) newest = mtimeMs;
  }
  return newest;
}

function distIsMissingOrStale(): boolean {
  if (!fs.existsSync(distIndexHtml) || !fs.existsSync(distAssetsDir)) return true;

  const distMtime = fs.statSync(distIndexHtml).mtimeMs;
  const inputMtimes = [
    newestMtimeUnder(path.join(repoRoot, "src")),
    fs.statSync(path.join(repoRoot, "index.html")).mtimeMs,
    fs.statSync(path.join(repoRoot, "vite.config.ts")).mtimeMs,
    fs.statSync(path.join(repoRoot, "package.json")).mtimeMs,
  ];
  if (Math.max(...inputMtimes) > distMtime) return true;

  // Belt-and-suspenders: a dist built from a config predating the manual
  // chunk split has no vendor-*.js files even though nothing looks stale
  // by mtime alone (this is exactly what produced the confusing
  // "vendor-refractor" failure this test used to raise).
  const assetFiles = fs.readdirSync(distAssetsDir);
  return !assetFiles.some((file) => file.startsWith("vendor-") && file.endsWith(".js"));
}

beforeAll(() => {
  if (!distIsMissingOrStale()) return;
  try {
    execFileSync("pnpm", ["build"], { cwd: repoRoot, stdio: "inherit", timeout: 300_000 });
  } catch (error) {
    buildError = error instanceof Error ? error.message : String(error);
  }
}, 300_000);

describe("Code-Splitting & Suspense Boundaries", () => {
  const mockPlans: PlanSummary[] = [
    planSummary({
      id: "00010",
      title: "Active Split Plan",
      state: "Executing",
      project: "Tendril-App",
      level: "Feature",
    }),
    planSummary({
      id: "00020",
      title: "Completed Split Plan",
      state: "Completed",
      project: "Tendril-App",
      level: "Bug",
    }),
  ];

  const mockJobs: Job[] = [
    {
      id: "00101",
      type: "ExecutePlan",
      planId: "00010",
      planTitle: "Active Split Plan",
      project: "Tendril-App",
      status: "Running",
      cost: 0.12,
      tokens: 24000,
    },
  ];

  it("renders DashboardView correctly within a Suspense boundary", () => {
    render(
      <Suspense fallback={<div data-testid="test-fallback-spinner">Loading dashboard...</div>}>
        <DashboardView plans={mockPlans} jobs={mockJobs} onSelectJob={() => {}} />
      </Suspense>,
    );

    expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    expect(screen.getByText("Tendril Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Active Split Plan")).toBeInTheDocument();
    expect(
      screen.getByText("Autonomous Pipeline Health and Execution Metrics"),
    ).toBeInTheDocument();
  });

  it("renders lazy-loaded DashboardView within a Suspense boundary when resolved", async () => {
    const importPromise = import("../src/views/DashboardView");
    const LazyDashboard = React.lazy(async () => {
      const mod = await importPromise;
      return { default: mod.DashboardView };
    });

    render(
      <Suspense fallback={<div data-testid="lazy-fallback-spinner">Loading dynamic view...</div>}>
        <LazyDashboard plans={mockPlans} jobs={mockJobs} onSelectJob={() => {}} />
      </Suspense>,
    );

    await act(async () => {
      await importPromise;
    });

    expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    expect(screen.getByText("Tendril Dashboard")).toBeInTheDocument();
  });

  it("produces isolated vendor chunks and code-split view chunks in the build output", () => {
    if (buildError !== null || distIsMissingOrStale()) {
      throw new Error(
        "dist/ is missing or stale relative to vite.config.ts - run pnpm build" +
          (buildError ? ` (automatic rebuild in beforeAll also failed: ${buildError})` : ""),
      );
    }

    const assetFiles = fs.readdirSync(distAssetsDir);

    // Check required vendor manual chunks
    const requiredVendorChunks = [
      // The refractor registry is split from the language packs: the registry is
      // imported synchronously by PlanDiffView, the packs are dynamically imported
      // one at a time, and a chunk is one loading unit.
      "vendor-refractor-core",
      "vendor-syntax",
      "vendor-pdfjs",
      "vendor-diff",
      "vendor-mermaid",
      "vendor-graphviz",
      "vendor-katex",
      "vendor-react",
    ];

    for (const chunkPrefix of requiredVendorChunks) {
      const found = assetFiles.some((file) => file.startsWith(chunkPrefix) && file.endsWith(".js"));
      expect(found, `Expected chunk starting with ${chunkPrefix} in dist/assets`).toBe(true);
    }

    // Check dynamic view chunks
    const viewChunks = [
      "DashboardView",
      "PlansView",
      "PlanDetailView",
      "JobSessionView",
      "ReviewView",
      "SettingsView",
      "ChatView",
      "InboxView",
    ];

    for (const viewName of viewChunks) {
      const found = assetFiles.some((file) => file.startsWith(viewName) && file.endsWith(".js"));
      expect(found, `Expected lazy view chunk for ${viewName} in dist/assets`).toBe(true);
    }

    // Find the main index.html entry chunk referenced by dist/index.html
    expect(fs.existsSync(distIndexHtml)).toBe(true);
    const indexHtml = fs.readFileSync(distIndexHtml, "utf8");
    const scriptMatch = indexHtml.match(/src="\/assets\/(index-[^"]+\.js)"/);
    expect(scriptMatch).not.toBeNull();

    const entryChunkFileName = scriptMatch![1];
    const entryChunkPath = path.join(distAssetsDir, entryChunkFileName);
    expect(fs.existsSync(entryChunkPath)).toBe(true);

    const entryStat = fs.statSync(entryChunkPath);
    const overage = entryStat.size - ENTRY_CHUNK_BUDGET_BYTES;
    const overagePercent = ((overage / ENTRY_CHUNK_BUDGET_BYTES) * 100).toFixed(2);
    const usagePercent = ((entryStat.size / ENTRY_CHUNK_BUDGET_BYTES) * 100).toFixed(1);

    // Written straight to stderr, not via console.warn: vitest defaults to
    // silent: "passed-only", which discards a passing test's console output and only
    // replays it if the test fails. A console.warn here would therefore appear only
    // once the budget is already blown, which is the one run where it adds nothing.
    if (entryStat.size > ENTRY_CHUNK_BUDGET_BYTES * ENTRY_CHUNK_WARN_RATIO) {
      process.stderr.write(
        `WARNING: entry chunk ${entryChunkFileName} is ${entryStat.size} bytes, ${usagePercent}% ` +
          `of the ${ENTRY_CHUNK_BUDGET_BYTES}-byte budget - check what became eager ` +
          `before raising it\n`,
      );
    }

    expect(
      entryStat.size,
      `entry chunk ${entryChunkFileName} is ${entryStat.size} bytes, over the ` +
        `${ENTRY_CHUNK_BUDGET_BYTES}-byte budget by ${overage} bytes (${overagePercent}%)`,
    ).toBeLessThan(ENTRY_CHUNK_BUDGET_BYTES);
  });

  it("keeps the diagram and syntax-highlighter chunks off the initial load", () => {
    if (buildError !== null || distIsMissingOrStale()) {
      throw new Error(
        "dist/ is missing or stale relative to vite.config.ts - run pnpm build" +
          (buildError ? ` (automatic rebuild in beforeAll also failed: ${buildError})` : ""),
      );
    }

    const indexHtml = fs.readFileSync(distIndexHtml, "utf8");
    const entry = indexHtml.match(/src="\/assets\/([^"]+\.js)"/)?.[1];
    expect(entry, "no entry script in dist/index.html").toBeDefined();

    // The rel and href attributes appear in either order depending on the emitter,
    // so match both forms and de-duplicate.
    const preloads = [
      ...indexHtml.matchAll(/rel="modulepreload"[^>]*href="\/assets\/([^"]+\.js)"/g),
      ...indexHtml.matchAll(/href="\/assets\/([^"]+\.js)"[^>]*rel="modulepreload"/g),
    ].map((match) => match[1]);
    const eager = [...new Set([entry!, ...preloads])];

    // These are the heavyweights this app must never fetch up front: two diagram
    // renderers, the Prism language packs and the PDF viewer. Each is reached only
    // through a dynamic import(), so a name appearing here means a static edge
    // crept back into the eager graph - most likely a shared dependency absorbed
    // into the chunk by a codeSplitting group with too low a priority.
    const mustBeLazy = ["vendor-mermaid", "vendor-graphviz", "vendor-syntax", "vendor-pdfjs"];
    for (const chunkPrefix of mustBeLazy) {
      const leaked = eager.filter((file) => file.startsWith(chunkPrefix));
      expect(
        leaked,
        `${chunkPrefix} must not be in the initial load (entry or modulepreload), found: ${leaked.join(", ")}`,
      ).toEqual([]);
    }

    const eagerBytes = eager.reduce(
      (total, file) => total + fs.statSync(path.join(distAssetsDir, file)).size,
      0,
    );

    // Baseline before this split: 4,893,138 bytes of eager JS, of which
    // vendor-mermaid alone was 3,092,317. After: ~1,200,000. The 1.6 MB ceiling
    // leaves headroom for the still-eager vendor-katex (259,052 bytes, tracked as
    // a separate recommendation) and for ordinary app growth. A failure here is a
    // regression, not a signal to raise the number - check what became eager first.
    expect(
      eagerBytes,
      `eager JS is ${eagerBytes} bytes across ${eager.length} chunks: ${eager.join(", ")}`,
    ).toBeLessThan(1.6 * 1024 * 1024);
  });
});
