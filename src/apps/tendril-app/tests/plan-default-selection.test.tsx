import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PlansView, resolvePlanSelection } from "../src/views/PlansView";
import { ReviewView } from "../src/views/ReviewView";
import { sidebarListStore } from "../src/state/sidebarListStore";
import { bridge } from "../src/api/bridge";
import { planSummary } from "./fixtures/plan.fixture";
import { job } from "./fixtures/job.fixture";
import type { PlanSummary } from "../src/types/api";

/**
 * Opening an app lands on a plan, not on an empty pane.
 *
 * V1's authority is `Helpers/PlanSelectionHelper.cs`, called from `PlansApp.Build` and
 * `ReviewApp.Build` on **every** build — not just at mount:
 *
 * ```csharp
 * if (currentSelected == null && currentPlans.Count > 0 && string.IsNullOrEmpty(argPlanId))
 *     return (currentPlans[0], currentPlans[0].FolderName);
 * ```
 *
 * Both callers build `currentPlans` with `.OrderByDescending(p => p.Id)`, so `currentPlans[0]` is the
 * **highest id**: the latest plan, and only ever one from that app's own filtered list — Draft or
 * Blocked for Plans, Review or Failed for Review, in both cases minus the plans a job still holds.
 * An empty list selects nothing, which is what puts V1 on its `NoContentView`.
 */

const drafts: PlanSummary[] = [
  planSummary({ id: "00003", title: "Third draft", state: "Draft" }),
  planSummary({ id: "00001", title: "First draft", state: "Draft" }),
  planSummary({ id: "00009", title: "Newest draft", state: "Draft" }),
];

const reviewable: PlanSummary[] = [
  planSummary({ id: "00012", title: "Older review", state: "Review" }),
  planSummary({ id: "00031", title: "Newest review", state: "Review" }),
  planSummary({ id: "00020", title: "Failed run", state: "Failed" }),
];

describe("resolvePlanSelection", () => {
  const list = [
    planSummary({ id: "00040", title: "40" }),
    planSummary({ id: "00039", title: "39" }),
    planSummary({ id: "00038", title: "38" }),
  ];

  // `ResolveSelection_OnInitialMountWithoutArgs_SelectsFirstPlan` (V1's own test).
  it("selects the first plan of a newest-first list when nothing is saved", () => {
    expect(resolvePlanSelection(list, null)?.id).toBe("00040");
  });

  // `ResolveSelection_WhenNewPlanPrepended_PreservesCurrentlySelectedPlan`.
  it("keeps the saved plan while it is still in the list, even after a newer one arrives", () => {
    expect(resolvePlanSelection(list, "00039")?.id).toBe("00039");
  });

  // `ResolveSelection_OnInitialMountWithArgs_SelectsSpecifiedPlan`, whose id arrives without the
  // folder suffix; V1 also matches `p.Id.ToString() == saved`.
  it("matches a saved id spelled as a bare number or as a folder name", () => {
    expect(resolvePlanSelection(list, "39")?.id).toBe("00039");
    expect(resolvePlanSelection(list, "00039-SomePlan")?.id).toBe("00039");
  });

  // `ResolveSelection_WhenSelectedPlanDeletedOrMoved_FallsBackToAdjacentPlan`.
  it("falls back to whatever now sits at the saved plan's index", () => {
    const remaining = [list[0], list[2]];
    expect(resolvePlanSelection(remaining, "00039", list)?.id).toBe("00038");
  });

  // `ResolveSelection_WhenSelectedPlanAtEndOfListDeleted_FallsBackToLastRemainingPlan`.
  it("clamps that index to the end of a shorter list", () => {
    const remaining = [list[0], list[1]];
    expect(resolvePlanSelection(remaining, "00038", list)?.id).toBe("00039");
  });

  it("falls back to the newest plan when the saved one was never in the previous list either", () => {
    expect(resolvePlanSelection(list, "00099")?.id).toBe("00040");
  });

  // `ResolveSelection_WhenAllPlansDeleted_ReturnsNull`.
  it("selects nothing when there is nothing to select", () => {
    expect(resolvePlanSelection([], "00040", list)).toBeNull();
    expect(resolvePlanSelection([], null)).toBeNull();
  });
});

describe("the Plans app's default selection", () => {
  beforeEach(() => {
    sidebarListStore.resetForTesting();
  });

  /**
   * V2 renders the plan under its own `plan-<id>` page rather than inside this one, so V1's
   * "hand `currentPlans[0]` to the content view" is this page opening it.
   */
  it("opens the newest Draft plan on arrival", async () => {
    const onSelectPlan = vi.fn();
    render(<PlansView plans={drafts} onSelectPlan={onSelectPlan} />);

    await waitFor(() => expect(onSelectPlan).toHaveBeenCalledWith("00009"));
    expect(onSelectPlan).toHaveBeenCalledTimes(1);
    expect(sidebarListStore.getState()?.selectedId).toBe("00009");
  });

  // `PlansApp.Build` filters to `Draft or Blocked` before selecting, so a Review or Completed plan is
  // never what this page opens on however new it is.
  it("never opens a plan that is not on this page's list", async () => {
    const onSelectPlan = vi.fn();
    render(
      <PlansView
        plans={[
          ...drafts,
          planSummary({ id: "00050", title: "In review", state: "Review" }),
          planSummary({ id: "00051", title: "Done", state: "Completed" }),
        ]}
        onSelectPlan={onSelectPlan}
      />,
    );

    await waitFor(() => expect(onSelectPlan).toHaveBeenCalledWith("00009"));
  });

  // `.Where(p => !activePlanFolders.Contains(p.FolderPath))`: a plan an agent is rewriting is not
  // offered, and so is not what the page lands on either.
  it("skips a plan a job still holds", async () => {
    const onSelectPlan = vi.fn();
    render(
      <PlansView
        plans={drafts}
        jobs={[job({ id: "j1", planId: "00009", status: "Queued" })]}
        onSelectPlan={onSelectPlan}
      />,
    );

    await waitFor(() => expect(onSelectPlan).toHaveBeenCalledWith("00003"));
  });

  // A first render before the plan list has arrived must still land on a plan once it does.
  it("opens the newest plan once a list that arrives late has arrived", async () => {
    const onSelectPlan = vi.fn();
    const { rerender } = render(<PlansView plans={[]} onSelectPlan={onSelectPlan} />);

    expect(onSelectPlan).not.toHaveBeenCalled();
    expect(screen.getByText("No plans")).toBeInTheDocument();

    rerender(<PlansView plans={drafts} onSelectPlan={onSelectPlan} />);

    await waitFor(() => expect(onSelectPlan).toHaveBeenCalledWith("00009"));
  });

  // `NoContentView("No plans", "Plans you create will appear here")` and nothing opened.
  it("opens nothing and shows V1's empty state when no plan is applicable", async () => {
    const onSelectPlan = vi.fn();
    render(
      <PlansView
        plans={[planSummary({ id: "00050", title: "In review", state: "Review" })]}
        onSelectPlan={onSelectPlan}
      />,
    );

    expect(screen.getByText("No plans")).toBeInTheDocument();
    expect(screen.getByText("Plans you create will appear here")).toBeInTheDocument();
    await waitFor(() => expect(sidebarListStore.getState()?.items).toHaveLength(0));
    expect(onSelectPlan).not.toHaveBeenCalled();
  });

  // The saved plan wins over the newest one, which is `ResolveSelection`'s first branch and what makes
  // a plan opened from elsewhere stay open.
  it("opens the plan the host already had selected rather than the newest", async () => {
    const onSelectPlan = vi.fn();
    render(<PlansView plans={drafts} selectedPlanId="00001" onSelectPlan={onSelectPlan} />);

    await waitFor(() => expect(onSelectPlan).toHaveBeenCalledWith("00001"));
    expect(onSelectPlan).not.toHaveBeenCalledWith("00009");
  });

  // `onSelectPlan` is a fresh closure on every host render, and each call is a history entry.
  it("opens the resolved plan once, however often the host re-renders", async () => {
    const first = vi.fn();
    const { rerender } = render(<PlansView plans={drafts} onSelectPlan={first} />);
    await waitFor(() => expect(first).toHaveBeenCalledWith("00009"));

    const second = vi.fn();
    rerender(<PlansView plans={[...drafts]} onSelectPlan={second} />);
    rerender(<PlansView plans={[...drafts]} onSelectPlan={second} />);

    expect(second).not.toHaveBeenCalled();
  });
});

describe("the Review app's default selection", () => {
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

  it("shows the newest plan in the queue on arrival, not an empty pane", async () => {
    render(<ReviewView plans={reviewable} onSelectPlan={() => {}} />);

    await waitFor(() => expect(screen.getByText("Newest review")).toBeInTheDocument());
    // `.Meta($"{currentIndex + 1}/{allPlans.Count} plans")` — the first of three.
    expect(screen.getByText("1/3 plans")).toBeInTheDocument();
    expect(sidebarListStore.getState()?.selectedId).toBe("00031");
  });

  // V1's `ReviewAppArgs.PlanId`, which is what a row click and a deep link both carry.
  it("shows the plan the address names when it names one", async () => {
    render(<ReviewView plans={reviewable} selectedPlanId="00020" onSelectPlan={() => {}} />);

    await waitFor(() => expect(screen.getByText("Failed run")).toBeInTheDocument());
    expect(sidebarListStore.getState()?.selectedId).toBe("00020");
  });

  // `ResolveSelection`'s fallback: an id that names nothing in the queue lands on the newest plan
  // rather than on nothing.
  it("falls back to the newest plan when the address names one that has left the queue", async () => {
    render(<ReviewView plans={reviewable} selectedPlanId="00777" onSelectPlan={() => {}} />);

    await waitFor(() => expect(screen.getByText("Newest review")).toBeInTheDocument());
  });

  // `NoContentView("No plans to review", "Completed plans will appear here for review")`.
  it("shows V1's empty state when no plan is waiting on a review decision", () => {
    render(
      <ReviewView
        plans={[planSummary({ id: "00003", title: "A draft", state: "Draft" })]}
        onSelectPlan={() => {}}
      />,
    );

    expect(screen.getByText("No plans to review")).toBeInTheDocument();
    expect(screen.getByText("Completed plans will appear here for review")).toBeInTheDocument();
  });

  // `.Where(p => !activePlanFolders.Contains(p.FolderPath))`: a plan under a queued retry is not
  // triageable, so it is not what the page lands on.
  it("skips a plan a job still holds", async () => {
    render(
      <ReviewView
        plans={reviewable}
        jobs={[job({ id: "j1", planId: "00031", status: "Blocked" })]}
        onSelectPlan={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByText("Failed run")).toBeInTheDocument());
    expect(sidebarListStore.getState()?.selectedId).toBe("00020");
  });

  it("lands on a plan once a queue that arrives late has arrived", async () => {
    const { rerender } = render(<ReviewView plans={[]} onSelectPlan={() => {}} />);

    expect(screen.getByText("No plans to review")).toBeInTheDocument();

    rerender(<ReviewView plans={reviewable} onSelectPlan={() => {}} />);

    await waitFor(() => expect(screen.getByText("Newest review")).toBeInTheDocument());
  });
});
