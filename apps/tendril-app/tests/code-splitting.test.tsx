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
      "vendor-refractor",
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
    // Monolithic baseline was 3.38 MB (3,461,242 bytes).
    // The entry chunk must be dramatically reduced (< 700 kB).
    expect(entryStat.size).toBeLessThan(700 * 1024);
  });
});
