/**
 * The wallpaper V1 hangs off an empty page.
 *
 * `Apps/Views/NoContentView.cs` is title + description + an optional `cta`, and the `cta` is what
 * makes it a wallpaper rather than a line of text:
 *
 * ```csharp
 * // Apps/Plans/ContentView.cs
 * var processView = Context.UseTendrilProcess();
 * ...
 * return new NoContentView("No plans", "Plans you create will appear here", processView);
 *
 * // Apps/Review/ContentView.cs
 * return new NoContentView("No plans to review", "Completed plans will appear here for review", processView);
 * ```
 *
 * `Hooks/UseTendrilProcess.cs` builds that `processView` as a `CreatePlanDialogLauncher` around a
 * `TendrilProcessViewer` fed from `TendrilProcessStatusService`, with `OnCreate` opening the Create
 * Plan dialog and `OnDrafts`/`OnReview`/`OnJobs` navigating.
 *
 * The other apps that reach `NoContentView` pass **no** `cta` — `Apps/Icebox/ContentView.cs`,
 * `Apps/Recommendations/ContentView.cs` and both branches in `Apps/Inbox/ContentView.cs` — so the
 * absence of a wallpaper there is as much a decision as its presence on Plans and Review.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlansView } from "../src/views/PlansView";
import { ReviewView } from "../src/views/ReviewView";
import { IceboxView } from "../src/views/IceboxView";
import { RecommendationsView } from "../src/views/RecommendationsView";
import { sidebarListStore } from "../src/state/sidebarListStore";
import { bridge } from "../src/api/bridge";
import { planSummary } from "./fixtures/plan.fixture";
import { job } from "./fixtures/job.fixture";
import type { PlanSummary } from "../src/types/api";

/** Nothing for the Plans page to list (Draft/Blocked), but plenty for the pipeline to count. */
const noDrafts: PlanSummary[] = [
  planSummary({ id: "00050", title: "In review", state: "Review" }),
  planSummary({ id: "00051", title: "Also in review", state: "Review" }),
];

const drafts: PlanSummary[] = [planSummary({ id: "00009", title: "A draft", state: "Draft" })];

beforeEach(() => {
  sidebarListStore.resetForTesting();
  vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
  vi.spyOn(bridge, "getPlan").mockResolvedValue(undefined as never);
  vi.spyOn(bridge, "listDiffComments").mockResolvedValue([]);
  vi.spyOn(bridge, "getProjectReviewActions").mockResolvedValue([]);
  vi.spyOn(bridge, "getVerificationReport").mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Plans page's wallpaper", () => {
  it("draws the process pipeline under V1's empty-state copy", () => {
    render(<PlansView plans={noDrafts} onSelectPlan={vi.fn()} />);

    expect(screen.getByText("No plans")).toBeInTheDocument();
    expect(screen.getByText("Plans you create will appear here")).toBeInTheDocument();
    expect(screen.getByTestId("process-wallpaper")).toBeInTheDocument();
    // `.OnCreate(open)`: the New Plan box is the pipeline's first stage.
    expect(screen.getByRole("button", { name: /New Plan/ })).toBeInTheDocument();
  });

  it("draws no wallpaper once there is a plan to open", async () => {
    render(<PlansView plans={drafts} onSelectPlan={vi.fn()} />);

    await waitFor(() => expect(sidebarListStore.getState()?.items).toHaveLength(1));
    expect(screen.queryByTestId("process-wallpaper")).not.toBeInTheDocument();
    expect(screen.queryByText("No plans")).not.toBeInTheDocument();
  });

  /**
   * The counts are `TendrilProcessStatusService.Compute`'s, i.e. every plan and job there is - not
   * the page's own Draft/Blocked list. A Plans page with nothing to list still reports the two plans
   * waiting in Review, which is the whole point of showing the pipeline on an empty page.
   */
  it("counts the whole process, not the page's own list", () => {
    render(<PlansView plans={noDrafts} onSelectPlan={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Review\s*2/ })).toBeInTheDocument();
    // Nothing is a Draft, so the Plans box carries no count badge at all.
    expect(screen.getByRole("button", { name: /^Plans$/ })).toBeInTheDocument();
  });

  it("opens the Create Plan dialog and navigates as `UseTendrilProcess` wires it", () => {
    const onNewPlan = vi.fn();
    const onNavigate = vi.fn();
    render(
      <PlansView
        plans={noDrafts}
        onSelectPlan={vi.fn()}
        onNewPlan={onNewPlan}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /New Plan/ }));
    expect(onNewPlan).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Review\s*2/ }));
    expect(onNavigate).toHaveBeenCalledWith("review");

    fireEvent.click(screen.getByRole("button", { name: /^Plans$/ }));
    expect(onNavigate).toHaveBeenCalledWith("plans");
  });

  /** `activeJobs.Count(j => j.Type == ExecutePlan)`: the arrows are jobs in flight, and go to Jobs. */
  it("labels the in-flight arrows from the job list and sends them to Jobs", () => {
    const onNavigate = vi.fn();
    const { container } = render(
      <PlansView
        plans={noDrafts}
        jobs={[job({ id: "j1", type: "ExecutePlan", planId: "00099", status: "Running" })]}
        onSelectPlan={vi.fn()}
        onNavigate={onNavigate}
      />,
    );

    const arrow = container.querySelector(".tpv-arrow-label");
    expect(arrow).not.toBeNull();
    expect(arrow).toHaveTextContent("1");

    fireEvent.click(arrow as Element);
    expect(onNavigate).toHaveBeenCalledWith("jobs");
  });
});

describe("the Review page's wallpaper", () => {
  it("draws the same pipeline under V1's review-queue copy", () => {
    render(
      <ReviewView
        plans={[planSummary({ id: "00003", title: "A draft", state: "Draft" })]}
        onSelectPlan={vi.fn()}
      />,
    );

    expect(screen.getByText("No plans to review")).toBeInTheDocument();
    expect(screen.getByText("Completed plans will appear here for review")).toBeInTheDocument();
    expect(screen.getByTestId("process-wallpaper")).toBeInTheDocument();
  });

  it("draws no wallpaper once there is a plan to triage", async () => {
    render(
      <ReviewView
        plans={[planSummary({ id: "00031", title: "Newest review", state: "Review" })]}
        onSelectPlan={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("Newest review")).toBeInTheDocument());
    expect(screen.queryByTestId("process-wallpaper")).not.toBeInTheDocument();
  });

  it("opens the Create Plan dialog from the wallpaper", () => {
    const onNewPlan = vi.fn();
    render(
      <ReviewView
        plans={[planSummary({ id: "00003", title: "A draft", state: "Draft" })]}
        onSelectPlan={vi.fn()}
        onNewPlan={onNewPlan}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /New Plan/ }));
    expect(onNewPlan).toHaveBeenCalled();
  });
});

describe("the apps V1 gives no call to action", () => {
  it("leaves the Icebox's empty state as title and description alone", () => {
    render(<IceboxView plans={[]} onSelectPlan={vi.fn()} />);

    expect(screen.getByTestId("icebox-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("process-wallpaper")).not.toBeInTheDocument();
  });

  it("leaves the Recommendations page's empty state the same way", async () => {
    vi.spyOn(bridge, "listCrossPlanRecommendations").mockResolvedValue([]);

    render(<RecommendationsView onSelectPlan={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("recommendations-empty")).toBeInTheDocument());
    expect(screen.queryByTestId("process-wallpaper")).not.toBeInTheDocument();
  });
});
