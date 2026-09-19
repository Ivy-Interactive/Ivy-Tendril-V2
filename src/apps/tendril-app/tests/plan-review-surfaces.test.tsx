import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PlanDetailView } from "../src/views/PlanDetailView";
import { isReviewState } from "../src/views/PlansView";
import { bridge } from "../src/api/bridge";
import { chatApi } from "../src/api/chatApi";
import { planDetail, planGit } from "./fixtures/plan.fixture";
import { recommendation } from "./fixtures/recommendation.fixture";
import type { PlanDetail } from "../src/types/api";

/**
 * Which plan states carry the diff and the recommendations.
 *
 * V1 has **two** plan pages and these two surfaces exist on only one of them.
 * `Apps/Plans/ContentView.Build` — the page a Draft or Blocked plan opens on — builds its tab strip as
 *
 * ```csharp
 * var tabs = new List<PlanTabDto> { new(PlanTab, "Plan"), new(DetailsTab, "Details") };
 * ...
 * if (gitItemCount > 0) tabs.Add(new PlanTabDto(GitTab, "Git", gitItemCount.ToString()));
 * ```
 *
 * and never adds a Changes or a Recommendations tab. `Apps/Review/ContentView.BuildPage` is where both
 * exist, each behind its own non-empty gate:
 *
 * ```csharp
 * var changesCount = planData.AllChanges?.Files.Count ?? 0;
 * if (changesCount > 0)     tabs.Add(new PlanTabDto(ChangesTab, "Changes", changesCount.ToString()));
 * if (pendingRecs.Count > 0) tabs.Add(new PlanTabDto(RecommendationsTab, "Recommendations", ...));
 * ```
 *
 * and `ReviewApp.Build` only ever hands that page
 * `.Where(p => p.Status is PlanStatus.Review or PlanStatus.Failed)`. `PlanSearchDialog.ResolveTarget`
 * states the same partition from the other side.
 *
 * V2 has one page for every plan, so the partition has to be a gate on the plan's state.
 */

function plan(overrides: Partial<PlanDetail> = {}): PlanDetail {
  return planDetail({
    id: "00021",
    state: "Draft",
    revisionCount: 3,
    dependsOn: [],
    relatedPlans: [],
    commits: [],
    prs: [],
    recommendations: [],
    latestRevisionContent: "# Plan\n\n## Problem\n",
    ...overrides,
  });
}

const PENDING_REC = recommendation({ title: "Cache the diff", state: "Pending" });

beforeEach(() => {
  vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([]);
  vi.spyOn(bridge, "listRecommendations").mockResolvedValue([PENDING_REC]);
  vi.spyOn(bridge, "listPullRequests").mockResolvedValue([]);
  vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());
  vi.spyOn(bridge, "getRepoStatus").mockResolvedValue([]);
  vi.spyOn(bridge, "listAnnotations").mockResolvedValue([]);
  vi.spyOn(bridge, "listProjects").mockResolvedValue([]);
  vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const diffTab = () => screen.queryByRole("tab", { name: "Diff View" });
const recsTab = () => screen.queryByRole("tab", { name: /^Recommendations/ });

describe("isReviewState", () => {
  // `ReviewApp.Build`: `.Where(p => p.Status is PlanStatus.Review or PlanStatus.Failed)`.
  it("is the pair of states V1's Review app owns", () => {
    expect(isReviewState("Review")).toBe(true);
    expect(isReviewState("Failed")).toBe(true);
  });

  // `PlansApp.Build` owns these, and its content view has neither surface.
  it("excludes the states the Plans app owns, and the rest", () => {
    for (const state of ["Draft", "Blocked", "Creating", "Updating", "Executing", "Icebox"]) {
      expect(isReviewState(state)).toBe(false);
    }
    // Completed plans are reachable in V2 (through the plan search dialog) and reachable through
    // nothing at all in V1 — `PlanSearchDialog.ResolveTarget` returns null for them. Their pending
    // recommendations are what the Recommendations app lists
    // (`RecommendationsApp.Build`: `r.SourcePlanStatus == PlanStatus.Completed`), so this page is not
    // where V1 shows them either.
    expect(isReviewState("Completed")).toBe(false);
    expect(isReviewState("Skipped")).toBe(false);
  });

  // `LEGACY_LIFECYCLE_STATES`: a plan.yaml written before the rename still says `ReadyForReview`.
  it("accepts the legacy spelling of Review", () => {
    expect(isReviewState("ReadyForReview")).toBe(true);
  });

  it("treats an absent state as not reviewable", () => {
    expect(isReviewState(undefined)).toBe(false);
  });
});

describe("the plan page's diff and recommendations tabs", () => {
  it("offers neither on a Draft plan, which is V1's Plans page", async () => {
    render(<PlanDetailView plan={plan({ state: "Draft" })} />);

    // The fetch that would populate the recommendations has to land before this means anything.
    await waitFor(() => expect(bridge.listRecommendations).toHaveBeenCalled());

    expect(screen.getByRole("tab", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Details" })).toBeInTheDocument();
    expect(diffTab()).not.toBeInTheDocument();
    expect(recsTab()).not.toBeInTheDocument();
  });

  it("offers neither on a Blocked plan, which is on the same page", async () => {
    render(<PlanDetailView plan={plan({ state: "Blocked" })} />);

    await waitFor(() => expect(bridge.listRecommendations).toHaveBeenCalled());

    expect(diffTab()).not.toBeInTheDocument();
    expect(recsTab()).not.toBeInTheDocument();
  });

  it("offers both on a plan in Review", async () => {
    render(<PlanDetailView plan={plan({ state: "Review" })} />);

    await waitFor(() => expect(recsTab()).toBeInTheDocument());
    expect(diffTab()).toBeInTheDocument();
  });

  // `ReviewApp.Build`'s queue is Review **or Failed**: a failed execution needs the same decision a
  // passing one does, and it has the same changes to read.
  it("offers both on a Failed plan, because V1's Review page holds those too", async () => {
    render(<PlanDetailView plan={plan({ state: "Failed" })} />);

    await waitFor(() => expect(recsTab()).toBeInTheDocument());
    expect(diffTab()).toBeInTheDocument();
  });

  it("offers both on a plan still recorded under the legacy `ReadyForReview` name", async () => {
    // The legacy name is not in `PlanLifecycleState` — that is the point: nothing rewrites a
    // plan.yaml on read, so the value arrives off the wire as a state this union does not list.
    const legacy = { ...plan(), state: "ReadyForReview" } as unknown as PlanDetail;
    render(<PlanDetailView plan={legacy} />);

    await waitFor(() => expect(recsTab()).toBeInTheDocument());
    expect(diffTab()).toBeInTheDocument();
  });

  /**
   * `BuildPage`: "Only surface the Changes tab once there are actual file changes — no point showing
   * an empty 'No commits yet.' tab before any work has landed." V2's diff compares two revisions of
   * the plan, so its empty case is a plan with one revision.
   */
  it("hides the diff on a reviewable plan with a single revision", async () => {
    render(<PlanDetailView plan={plan({ state: "Review", revisionCount: 1 })} />);

    await waitFor(() => expect(recsTab()).toBeInTheDocument());
    expect(diffTab()).not.toBeInTheDocument();
  });

  it("hides the diff when the plan reports no revision count at all", async () => {
    render(<PlanDetailView plan={plan({ state: "Review", revisionCount: undefined })} />);

    await waitFor(() => expect(recsTab()).toBeInTheDocument());
    expect(diffTab()).not.toBeInTheDocument();
  });

  /**
   * `ContentView.LaunchExecute` moves the plan to `Creating` before the job starts
   * (`TransitionPlanOptimistically`), and every gate on the page reads that optimistic state. A plan
   * on its way to executing is on the Plans page, so the review surfaces go with it.
   */
  it("drops both when the plan moves out of Review", async () => {
    const { rerender } = render(<PlanDetailView plan={plan({ state: "Review" })} />);

    await waitFor(() => expect(recsTab()).toBeInTheDocument());

    rerender(<PlanDetailView plan={plan({ state: "Executing", updated: "later" })} />);

    await waitFor(() => expect(recsTab()).not.toBeInTheDocument());
    expect(diffTab()).not.toBeInTheDocument();
  });
});
