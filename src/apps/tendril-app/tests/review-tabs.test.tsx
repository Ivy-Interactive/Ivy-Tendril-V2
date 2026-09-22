import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ReviewView } from "../src/views/ReviewView";
import { sidebarListStore } from "../src/state/sidebarListStore";
import { bridge } from "../src/api/bridge";
import { planDetail, planGit, planSummary, worktreeSection } from "./fixtures/plan.fixture";
import { recommendation } from "./fixtures/recommendation.fixture";

const reviewPlan = planSummary({
  id: "00021",
  title: "Build Desktop Operator Experience",
  state: "Review",
});

beforeEach(() => {
  sidebarListStore.resetForTesting();
  vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
  vi.spyOn(bridge, "getPlan").mockResolvedValue(planDetail({ id: "00021" }));
  vi.spyOn(bridge, "listDiffComments").mockResolvedValue([]);
  vi.spyOn(bridge, "getVerificationReport").mockResolvedValue({
    name: "PreExecution",
    result: "Pass",
    content: "",
  });
  vi.spyOn(bridge, "getPlanSummary").mockResolvedValue("# Plan Summary\nAll tests passed.");
  vi.spyOn(bridge, "getPlanGit").mockResolvedValue(
    planGit({ worktrees: [worktreeSection()] }),
  );
  vi.spyOn(bridge, "getPlanChanges").mockResolvedValue({
    files: [
      {
        filePath: "src/main.rs",
        diff: "@@ -1,3 +1,4 @@\n+println!(\"hello\");\n",
        additions: 1,
        deletions: 0,
      },
    ],
    rawDiff: "",
    totalAdditions: 3,
    totalDeletions: 0,
  });
  vi.spyOn(bridge, "getPlanArtifacts").mockResolvedValue({
    screenshots: ["/path/to/screenshot1.png"],
    other: ["/path/to/output.log"],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReviewView tabs", () => {
  it("defaults to Summary tab and renders summary markdown", async () => {
    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("review-tab-summary")).toBeInTheDocument();
    });
    expect(screen.getByText("All tests passed.")).toBeInTheDocument();
  });

  it("renders fallback note in Summary tab when summary is empty", async () => {
    vi.spyOn(bridge, "getPlanSummary").mockResolvedValue("");

    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("review-tab-summary")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/No summary is found for this plan/i),
    ).toBeInTheDocument();
  });

  it("can switch to and render Plan tab", async () => {
    render(
      <ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="plan" />,
    );

    const planTab = await screen.findByTestId("review-tab-plan");
    expect(
      within(planTab).getByRole("heading", { name: "Build Desktop Operator Experience" }),
    ).toBeInTheDocument();
  });

  it("can switch to and render Details tab", async () => {
    render(
      <ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="details" />,
    );

    const detailsTab = await screen.findByTestId("review-tab-details");
    expect(within(detailsTab).getByText("00021")).toBeInTheDocument();
    expect(within(detailsTab).getByText("/repos/Tendril-App")).toBeInTheDocument();
    expect(within(detailsTab).getByText("abc1234")).toBeInTheDocument();
  });

  it("can switch to and render Git tab with badge", async () => {
    render(
      <ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="git" />,
    );

    const gitTab = await screen.findByTestId("review-tab-git");
    await waitFor(() => {
      expect(within(gitTab).getByText("Tendril-App")).toBeInTheDocument();
    });
  });

  it("can switch to and render Changes tab with diffs", async () => {
    render(
      <ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="changes" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("review-tab-changes")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getAllByText(/main\.rs/).length).toBeGreaterThan(0);
    });
  });

  it("can switch to and render Artifacts tab with screenshots and other files", async () => {
    render(
      <ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} initialTab="artifacts" />,
    );

    const artifactsTab = await screen.findByTestId("review-tab-artifacts");
    await waitFor(() => {
      expect(within(artifactsTab).getByText("screenshot1.png")).toBeInTheDocument();
      expect(within(artifactsTab).getByText("output.log")).toBeInTheDocument();
    });
  });

  it("can switch to and render Recommendations tab", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([
      recommendation({ title: "Audit security headers" }),
    ]);

    render(
      <ReviewView
        plans={[reviewPlan]}
        onSelectPlan={() => {}}
        initialTab="recommendations"
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("review-tab-recommendations"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Audit security headers")).toBeInTheDocument();
  });

  it("switches tabs when tab items are clicked", async () => {
    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("review-tab-summary")).toBeInTheDocument();
    });

    // Click Details tab
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    await waitFor(() => {
      expect(screen.getByTestId("review-tab-details")).toBeInTheDocument();
    });

    // Click Plan tab
    fireEvent.click(screen.getByRole("tab", { name: "Plan" }));
    await waitFor(() => {
      expect(screen.getByTestId("review-tab-plan")).toBeInTheDocument();
    });
  });
});
