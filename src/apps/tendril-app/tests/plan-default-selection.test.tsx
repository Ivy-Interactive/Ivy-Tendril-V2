import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PlansView, resolvePlanSelection } from "../src/views/PlansView";
import { ReviewView } from "../src/views/ReviewView";
import { sidebarListStore } from "../src/state/sidebarListStore";
import { plansStore } from "../src/state/plansStore";
import { bridge } from "../src/api/bridge";
import { planDetail, planSummary } from "./fixtures/plan.fixture";
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

  /**
   * The keep-the-index branch, reached the way the app reaches it: not by calling
   * `resolvePlanSelection` with a hand-written `previousPlans`, but by shortening the queue a mounted
   * page is already holding.
   *
   * The unit tests above pass that argument in directly, so they passed just as well while the page
   * never supplied it — `resolvePlanSelection(listPlans, selectedId)` defaulted `previousPlans` to
   * `[]`, `findIndex` returned -1, and every plan that left the queue sent the selection to
   * `plans[0]`. Branch 2 was unreachable in the product and fully covered in the suite at the same
   * time, which is the gap this closes: the page has to remember the previous list across renders,
   * and only a re-render can show that it does.
   */
  it("advances to the plan at the departing plan's index rather than back to the newest", async () => {
    const onSelectPlan = vi.fn();
    // Newest first: 00009, 00003, 00001. The page opens on 00009 and the operator moves to 00003.
    const { rerender } = render(
      <PlansView plans={drafts} selectedPlanId="00003" onSelectPlan={onSelectPlan} />,
    );
    await waitFor(() => expect(onSelectPlan).toHaveBeenCalledWith("00003"));
    onSelectPlan.mockClear();

    // 00003 leaves the queue, as a delete or an execute takes it out.
    rerender(
      <PlansView
        plans={drafts.filter((plan) => plan.id !== "00003")}
        selectedPlanId="00003"
        onSelectPlan={onSelectPlan}
      />,
    );

    // Index 1 of the shortened [00009, 00001] is 00001 — the next plan down. Bouncing to 00009 would
    // mean re-deciding a plan the operator has already worked past every time they clear one.
    await waitFor(() => expect(onSelectPlan).toHaveBeenCalledWith("00001"));
    expect(onSelectPlan).not.toHaveBeenCalledWith("00009");
  });

  it("clamps to the end of the queue when the last plan in it leaves", async () => {
    const onSelectPlan = vi.fn();
    const { rerender } = render(
      <PlansView plans={drafts} selectedPlanId="00001" onSelectPlan={onSelectPlan} />,
    );
    await waitFor(() => expect(onSelectPlan).toHaveBeenCalledWith("00001"));
    onSelectPlan.mockClear();

    rerender(
      <PlansView
        plans={drafts.filter((plan) => plan.id !== "00001")}
        selectedPlanId="00001"
        onSelectPlan={onSelectPlan}
      />,
    );

    // `Math.Min(oldIndex, count - 1)`: index 2 does not exist in a two-plan queue, so the last does.
    await waitFor(() => expect(onSelectPlan).toHaveBeenCalledWith("00003"));
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

  /**
   * Keep-the-index has to survive the renders *after* the one that shortened the queue.
   *
   * A plan can leave this queue without the page deciding it — a job takes it, or another surface
   * moves it — so the address keeps naming it while the host's own list no longer does, and the page
   * re-renders in that state as often as the host re-renders. The previous queue is therefore held
   * until the selection is one the queue holds again: released on the first of those renders, the
   * departed plan's index is gone from both lists by the second, and `ResolveSelection` takes its
   * third branch back to the top of the queue — the reviewer, two renders after finishing a plan,
   * finds themselves at a plan they already worked past.
   */
  it("holds the index across the later renders, not just the one that shortened the queue", async () => {
    // The queue is [00031, 00020, 00012] newest-first, and the plan that leaves is the **middle**
    // one: keep-the-index answers 00012 and the fallback answers 00031, so the two branches
    // disagree and which one ran is visible. Removing the first plan would hide the bug, since
    // index 0 is also what the fallback returns.
    const shortened = reviewable.filter((plan) => plan.id !== "00020");
    const { rerender } = render(
      <ReviewView plans={reviewable} selectedPlanId="00020" onSelectPlan={() => {}} />,
    );
    await waitFor(() => expect(screen.getByText("Failed run")).toBeInTheDocument());

    rerender(<ReviewView plans={shortened} selectedPlanId="00020" onSelectPlan={() => {}} />);
    await waitFor(() => expect(screen.getByText("Older review")).toBeInTheDocument());

    // The host re-renders again with the same queue and the same stale address, which is the render
    // the ref must not have advanced past.
    rerender(<ReviewView plans={[...shortened]} selectedPlanId="00020" onSelectPlan={() => {}} />);

    await waitFor(() => expect(sidebarListStore.getState()?.selectedId).toBe("00012"));
    expect(screen.getByText("Older review")).toBeInTheDocument();
    expect(screen.queryByText("Newest review")).not.toBeInTheDocument();
  });

  it("lands on a plan once a queue that arrives late has arrived", async () => {
    const { rerender } = render(<ReviewView plans={[]} onSelectPlan={() => {}} />);

    expect(screen.getByText("No plans to review")).toBeInTheDocument();

    rerender(<ReviewView plans={reviewable} onSelectPlan={() => {}} />);

    await waitFor(() => expect(screen.getByText("Newest review")).toBeInTheDocument());
  });
});

/**
 * The other half of `ResolveSelection`: what a **primary CTA** leaves selected.
 *
 * V1's rule is one rule for both apps — `PlanSelectionHelper.ResolveSelection` keeps the *index*, so
 * the plan that took the departing plan's place is what opens next, clamped to the end of a shorter
 * list and selecting nothing only when the list is empty. V2 states it once as `nextAfterRemoval`
 * (see `tests/optimistic-actions.test.ts` for the rule itself); these are the two pages driving it
 * through a real click, which is where a CTA that left the operator on a deleted plan — or bounced
 * them back to the top of the queue — would still show.
 */

/**
 * The shell's half of the contract, in miniature: the host owns the list, and a decision that takes a
 * plan out of its queue takes it out of that list. That is exactly what `plansStore`'s optimistic
 * mutators now do to `state.plans` on the click rather than a `listPlans` round trip later, so a host
 * that drops the plan on `onPlanChanged` is what the page sees in the app.
 */
function ReviewHost({
  plans: seed,
  addressedPlanId,
}: {
  plans: PlanSummary[];
  addressedPlanId?: string;
}) {
  const [plans, setPlans] = useState(seed);
  return (
    <ReviewView
      plans={plans}
      selectedPlanId={addressedPlanId}
      onSelectPlan={() => {}}
      onPlanChanged={(planId) => setPlans((current) => current.filter((p) => p.id !== planId))}
    />
  );
}

describe("the Review app after a primary CTA", () => {
  beforeEach(() => {
    sidebarListStore.resetForTesting();
    plansStore.setPlans([]);
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "listDiffComments").mockResolvedValue([]);
    vi.spyOn(bridge, "getProjectReviewActions").mockResolvedValue([]);
    vi.spyOn(bridge, "getVerificationReport").mockResolvedValue(undefined as never);
    // A plan with no commits and no PRs is `AddPrimaryAction`'s third branch, which is the CTA under
    // test: Complete Plan. With the detail unloaded the count is unknown and the CTA holds at Create
    // PR, so the page has to be given one.
    vi.spyOn(bridge, "getPlan").mockImplementation(async (id: string) =>
      planDetail({ id, state: "Review", commits: [], prs: [] }),
    );
    // Both CTAs go through `plansStore`, which reconciles with a list read of its own afterwards.
    vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);
    vi.spyOn(bridge, "deletePlan").mockResolvedValue(undefined);
    vi.spyOn(bridge, "listPlans").mockResolvedValue([]);
  });

  afterEach(() => {
    // The store is a module singleton shared with the rest of the worker, and these two CTAs leave a
    // tombstone and a pinned state in it; an explicit seed is what clears both.
    plansStore.setPlans([]);
    vi.restoreAllMocks();
  });

  // The queue is `[00031, 00020, 00012]` newest-first, so completing the middle plan opens the one
  // **after** it. The fallback branch would open 00031 instead, which is the bug this pins down: the
  // reviewer working down a queue is sent back to its top by their own decision.
  it("opens the next plan in the queue when the current one is completed", async () => {
    render(<ReviewHost plans={reviewable} addressedPlanId="00020" />);

    fireEvent.click(await screen.findByRole("button", { name: /complete plan/i }));

    await waitFor(() => expect(screen.getByText("Older review")).toBeInTheDocument());
    expect(screen.queryByText("Failed run")).not.toBeInTheDocument();
    expect(screen.queryByText("Newest review")).not.toBeInTheDocument();
    // `.Meta($"{currentIndex + 1}/{allPlans.Count} plans")` — the second of the two that are left.
    expect(screen.getByText("2/2 plans")).toBeInTheDocument();
    expect(sidebarListStore.getState()?.selectedId).toBe("00012");
  });

  // Delete is the other CTA the operator reaches from this page, through the overflow menu and the
  // confirm; `DeletePlanDialog`'s three exits all resolve the selection the same way.
  it("opens the next plan in the queue when the current one is deleted", async () => {
    render(<ReviewHost plans={reviewable} addressedPlanId="00031" />);

    await waitFor(() => expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete Plan/ }));
    const dialog = await screen.findByTestId("delete-plan-dialog");
    fireEvent.click(within(dialog).getByTestId("dialog-confirm"));

    await waitFor(() => expect(screen.getByText("Failed run")).toBeInTheDocument());
    expect(screen.queryByText("Newest review")).not.toBeInTheDocument();
    expect(sidebarListStore.getState()?.selectedId).toBe("00020");
  });

  // `ResolveSelection` returns null on an empty list, which is what puts V1 on its `NoContentView`:
  // the last decision in a queue ends on the empty state, not on the plan that was just triaged.
  it("leaves nothing selected once the last plan in the queue is completed", async () => {
    render(<ReviewHost plans={[reviewable[1]]} />);

    fireEvent.click(await screen.findByRole("button", { name: /complete plan/i }));

    await waitFor(() => expect(screen.getByText("No plans to review")).toBeInTheDocument());
    expect(screen.queryByText("Newest review")).not.toBeInTheDocument();
    expect(sidebarListStore.getState()?.items ?? []).toHaveLength(0);
  });
});

/**
 * The Plans page's own half of the same rule, in the case the two re-render tests above do not
 * reach: the queue running out.
 *
 * Keep-the-index and the clamp are already driven through this page by "advances to the plan at the
 * departing plan's index" and "clamps to the end of the queue"; what is left is
 * `ResolveSelection_WhenAllPlansDeleted_ReturnsNull` seen from the page — the CTA that clears the
 * last draft has to land on the empty state rather than re-open the plan it just cleared.
 */
describe("the Plans app when the last plan leaves the list", () => {
  beforeEach(() => {
    sidebarListStore.resetForTesting();
  });

  it("opens nothing once the last plan in the list is gone", async () => {
    const onSelectPlan = vi.fn();
    const only = drafts[1];
    const { rerender } = render(
      <PlansView plans={[only]} selectedPlanId={only.id} onSelectPlan={onSelectPlan} />,
    );
    await waitFor(() => expect(onSelectPlan).toHaveBeenCalledWith(only.id));
    onSelectPlan.mockClear();

    // What `removePlanOptimistic` does to the shell's list on the click that confirmed the delete.
    rerender(<PlansView plans={[]} selectedPlanId={only.id} onSelectPlan={onSelectPlan} />);

    expect(screen.getByText("No plans")).toBeInTheDocument();
    await waitFor(() => expect(sidebarListStore.getState()?.items).toHaveLength(0));
    expect(onSelectPlan).not.toHaveBeenCalled();
  });
});
