import React, { Suspense, act } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DashboardView } from "../src/views/DashboardView";
import { planSummary } from "./fixtures/plan.fixture";
import type { PlanSummary, Job } from "../src/types/api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
      <Suspense
        fallback={
          <div data-testid="test-fallback-spinner">Loading dashboard...</div>
        }
      >
        <DashboardView
          plans={mockPlans}
          jobs={mockJobs}
          onSelectPlan={() => {}}
          onSelectJob={() => {}}
        />
      </Suspense>
    );

    expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    expect(screen.getByText("Tendril Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Active Split Plan")).toBeInTheDocument();
    expect(
      screen.getByText("Autonomous Pipeline Health and Execution Metrics")
    ).toBeInTheDocument();
  });

  it("renders lazy-loaded DashboardView within a Suspense boundary when resolved", async () => {
    const importPromise = import("../src/views/DashboardView");
    const LazyDashboard = React.lazy(async () => {
      const mod = await importPromise;
      return { default: mod.DashboardView };
    });

    render(
      <Suspense
        fallback={
          <div data-testid="lazy-fallback-spinner">Loading dynamic view...</div>
        }
      >
        <LazyDashboard
          plans={mockPlans}
          jobs={mockJobs}
          onSelectPlan={() => {}}
          onSelectJob={() => {}}
        />
      </Suspense>
    );

    await act(async () => {
      await importPromise;
    });

    expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    expect(screen.getByText("Tendril Dashboard")).toBeInTheDocument();
  });

  it("produces isolated vendor chunks and code-split view chunks in the build output", () => {
    const distAssetsDir = path.resolve(__dirname, "../dist/assets");
    expect(
      fs.existsSync(distAssetsDir),
      "dist/assets must exist (run pnpm build before testing)"
    ).toBe(true);

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
      const found = assetFiles.some(
        (file) => file.startsWith(chunkPrefix) && file.endsWith(".js")
      );
      expect(
        found,
        `Expected chunk starting with ${chunkPrefix} in dist/assets`
      ).toBe(true);
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
      const found = assetFiles.some(
        (file) => file.startsWith(viewName) && file.endsWith(".js")
      );
      expect(
        found,
        `Expected lazy view chunk for ${viewName} in dist/assets`
      ).toBe(true);
    }

    // Find the main index.html entry chunk referenced by dist/index.html
    const indexPath = path.resolve(__dirname, "../dist/index.html");
    expect(fs.existsSync(indexPath)).toBe(true);
    const indexHtml = fs.readFileSync(indexPath, "utf8");
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
