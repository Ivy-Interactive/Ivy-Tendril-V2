import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { PlanDetailView } from "../src/views/PlanDetailView";
import { bridge } from "../src/api/bridge";
import { chatApi } from "../src/api/chatApi";
import { plansStore } from "../src/state/plansStore";
import { planDetail, planGit, planSummary, verification } from "./fixtures/plan.fixture";
import type { Job, PlanDetail, RepoStatus } from "../src/types/api";

/**
 * The plan detail page's state machine: what a plan switch forgets, what a running job forbids, and
 * what the page believes between pressing a button and the service confirming it.
 *
 * V1's authority for all of it is `Apps/Plans/ContentView.cs` (the plan-change block and
 * `TransitionPlanOptimistically`), `Apps/Plans/DraftActions.cs` (the active-job guards) and
 * `PlansApp.Build` (which simply never lists a plan a job already owns).
 */

const DIRTY: RepoStatus[] = [
  { path: "/repos/Tendril-App", isDirty: true, changes: [" M src/App.tsx"], changeCount: 1 },
];

function draft(overrides: Partial<PlanDetail> = {}): PlanDetail {
  return planDetail({
    id: "00021",
    state: "Draft",
    revisionCount: 2,
    dependsOn: [],
    latestRevisionContent: "# Plan\n\n## Problem\n",
    ...overrides,
  });
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    type: "ExpandPlan",
    planId: "00021",
    project: "Tendril-App",
    status: "Running",
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([]);
  vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
  vi.spyOn(bridge, "listPullRequests").mockResolvedValue([]);
  vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());
  vi.spyOn(bridge, "getRepoStatus").mockResolvedValue([]);
  vi.spyOn(bridge, "listAnnotations").mockResolvedValue([]);
  vi.spyOn(bridge, "listProjects").mockResolvedValue([]);
  // The workspace's Chat slot looks for the plan's own session on mount.
  vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
});

/**
 * Opens the workspace's overflow menu.
 *
 * `DraftActions` puts "Update and Share as icons, everything else in the overflow menu", so Expand,
 * Split, Delete and the rest are `role="menuitem"` inside a menu that has to be opened first — they
 * are no longer toolbar buttons.
 */
const openWorkspaceMenu = () => {
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("plan switch", () => {
  it("returns to the Plan tab, as V1 does with selectedTab.Set(PlanTab)", async () => {
    const { rerender } = render(<PlanDetailView plan={draft()} />);

    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("Repositories")).toBeInTheDocument();

    rerender(<PlanDetailView plan={draft({ id: "00022" })} />);

    await waitFor(() => expect(screen.queryByText("Repositories")).not.toBeInTheDocument());
    // Back on the Plan tab, which is the only one that renders the revision body.
    expect(screen.getByRole("heading", { level: 2, name: "Problem" })).toBeInTheDocument();
  });

  it("keeps the open tab when the same plan is merely refetched", async () => {
    const plan = draft();
    const { rerender } = render(<PlanDetailView plan={plan} />);

    fireEvent.click(screen.getByRole("tab", { name: "Details" }));

    // A fresh object for the same plan: V1 keys this block on the plan's id precisely so "that must
    // not throw the reader back to the first tab".
    rerender(<PlanDetailView plan={{ ...plan }} />);

    expect(screen.getByText("Repositories")).toBeInTheDocument();
  });

  it("closes an open execute guard so its Proceed cannot answer for the new plan", async () => {
    vi.spyOn(bridge, "getRepoStatus").mockResolvedValue(DIRTY);
    const onExecute = vi.fn();
    const { rerender } = render(<PlanDetailView plan={draft()} onExecute={onExecute} />);

    fireEvent.click(screen.getByRole("button", { name: /^Execute Plan/ }));
    expect(await screen.findByTestId("dirty-repo-dialog")).toBeInTheDocument();

    rerender(<PlanDetailView plan={draft({ id: "00022" })} onExecute={onExecute} />);

    await waitFor(() => expect(screen.queryByTestId("dirty-repo-dialog")).not.toBeInTheDocument());
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("closes an open lifecycle dialog across a switch", async () => {
    const { rerender } = render(<PlanDetailView plan={draft()} />);

    fireEvent.click(screen.getByRole("button", { name: "Update Plan…" }));
    expect(await screen.findByTestId("update-plan-dialog")).toBeInTheDocument();

    rerender(<PlanDetailView plan={draft({ id: "00022" })} />);

    await waitFor(() => expect(screen.queryByTestId("update-plan-dialog")).not.toBeInTheDocument());
  });
});

describe("a job already holds the plan", () => {
  it("offers no plan-writing action while the plan is mid-flight", () => {
    render(<PlanDetailView plan={draft({ state: "Executing" })} />);

    expect(screen.queryByRole("button", { name: /^Execute Plan/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Discard Plan/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reset to Draft/ })).not.toBeInTheDocument();
  });

  it("treats a running ExecutePlan job as mid-flight even while the plan still reads Draft", () => {
    render(<PlanDetailView plan={draft()} jobs={[job({ type: "ExecutePlan" })]} />);

    expect(screen.queryByRole("button", { name: /^Execute Plan/ })).not.toBeInTheDocument();
  });

  // `DraftActions`: `.Menu("Expand", ..., disabled: ctx.HasActiveExpandJob)`.
  it("disables Expand while an ExpandPlan job is running, and nothing else", () => {
    render(<PlanDetailView plan={draft()} jobs={[job({ type: "ExpandPlan" })]} />);

    openWorkspaceMenu();
    expect(screen.getByRole("menuitem", { name: /^Expand Plan/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /^Split Plan/ })).toBeEnabled();
  });

  it("disables Split while a SplitPlan job is running", () => {
    render(<PlanDetailView plan={draft()} jobs={[job({ type: "SplitPlan" })]} />);

    openWorkspaceMenu();
    expect(screen.getByRole("menuitem", { name: /^Split Plan/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /^Expand Plan/ })).toBeEnabled();
  });

  it("ignores a job belonging to another plan", () => {
    render(<PlanDetailView plan={draft()} jobs={[job({ planId: "00099" })]} />);

    openWorkspaceMenu();
    expect(screen.getByRole("menuitem", { name: /^Expand Plan/ })).toBeEnabled();
  });

  // V1's `HasActiveJob` counts Running/Queued/Pending only.
  it("ignores a job that has already finished", () => {
    render(<PlanDetailView plan={draft()} jobs={[job({ status: "Completed" })]} />);

    openWorkspaceMenu();
    expect(screen.getByRole("menuitem", { name: /^Expand Plan/ })).toBeEnabled();
  });
});

describe("optimistic transitions", () => {
  it("moves the plan to Creating the moment Execute is dispatched", async () => {
    const onExecute = vi.fn();
    render(<PlanDetailView plan={draft()} onExecute={onExecute} />);

    fireEvent.click(screen.getByRole("button", { name: /^Execute Plan/ }));

    await waitFor(() => expect(onExecute).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("plan-state-badge")).toHaveTextContent("Creating"),
    );
    // And so stops offering to execute it again.
    expect(screen.queryByRole("button", { name: /^Execute Plan/ })).not.toBeInTheDocument();
  });

  it("takes the guess back when the dispatch is refused", async () => {
    const onExecute = vi.fn().mockRejectedValue(new Error("daemon unreachable"));
    render(<PlanDetailView plan={draft()} onExecute={onExecute} />);

    fireEvent.click(screen.getByRole("button", { name: /^Execute Plan/ }));

    await waitFor(() => expect(screen.getByTestId("plan-action-error")).toBeInTheDocument());
    expect(screen.getByTestId("plan-state-badge")).toHaveTextContent("Draft");
    expect(screen.getByRole("button", { name: /^Execute Plan/ })).toBeInTheDocument();
  });

  it("drops the guess once the service reports a state of its own", async () => {
    const onExecute = vi.fn();
    const plan = draft();
    const { rerender } = render(<PlanDetailView plan={plan} onExecute={onExecute} />);

    fireEvent.click(screen.getByRole("button", { name: /^Execute Plan/ }));
    await waitFor(() =>
      expect(screen.getByTestId("plan-state-badge")).toHaveTextContent("Creating"),
    );

    rerender(<PlanDetailView plan={{ ...plan, state: "Executing" }} onExecute={onExecute} />);

    expect(screen.getByTestId("plan-state-badge")).toHaveTextContent("Executing");
  });
});

describe("preflight", () => {
  it("goes dead while the checks run, so one click cannot dispatch twice", async () => {
    let releaseRepoStatus: (value: RepoStatus[]) => void = () => {};
    vi.spyOn(bridge, "getRepoStatus").mockReturnValue(
      new Promise<RepoStatus[]>((resolve) => {
        releaseRepoStatus = resolve;
      }),
    );
    const onExecute = vi.fn();
    render(<PlanDetailView plan={draft()} onExecute={onExecute} />);

    fireEvent.click(screen.getByRole("button", { name: /^Execute Plan/ }));

    const button = await screen.findByRole("button", { name: /^Checking\.\.\./ });
    expect(button).toBeDisabled();

    // A second click while it is checking must not start a second chain.
    fireEvent.click(button);
    releaseRepoStatus([]);

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
  });
});

describe("legacy state names", () => {
  it("offers the Review actions on a plan still recorded as ReadyForReview", () => {
    const legacy = {
      ...draft({ verifications: [verification("RustTest", "Pass")] }),
      state: "ReadyForReview",
    } as unknown as PlanDetail;

    render(<PlanDetailView plan={legacy} />);

    expect(screen.getByTestId("plan-state-badge")).toHaveTextContent("Review");
    expect(screen.getByRole("button", { name: "Create PR" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Retry Plan" })).toBeEnabled();
  });
});

describe("the failure callout", () => {
  it("quotes the plan's last failed job when no verification explains it", () => {
    render(
      <PlanDetailView
        plan={draft({ state: "Failed", verifications: [verification("RustTest", "Pass")] })}
        jobs={[
          job({
            id: "job-old",
            type: "ExecutePlan",
            status: "Failed",
            statusMessage: "stale",
            completedAt: "2026-09-01T00:00:00Z",
          }),
          job({
            id: "job-new",
            type: "ExecutePlan",
            status: "Failed",
            statusMessage: "Agent exited before writing a summary",
            completedAt: "2026-09-08T00:00:00Z",
          }),
        ]}
      />,
    );

    expect(screen.getByTestId("plan-failure-reason")).toHaveTextContent(
      "Agent exited before writing a summary",
    );
  });

  it("falls back to V1's wording with nothing to quote", () => {
    render(
      <PlanDetailView
        plan={draft({ state: "Failed", verifications: [verification("RustTest", "Pass")] })}
      />,
    );

    expect(screen.getByTestId("plan-failure-reason")).toHaveTextContent(
      "No details available. Check the job logs.",
    );
  });
});

/**
 * These read git state, so they use a plan under **review**.
 *
 * The Git tab, and with it this fetch, now exists only for `Review`/`Failed` plans: everything the
 * tab renders (worktrees, commit reachability, PRs) is state an execution produced, and a Draft
 * paid for a git shell-out in every repo whose only visible effect was the tab flickering in
 * unlabelled and then gaining its count. `draft()` no longer fetches at all, which the first case
 * below pins.
 */
describe("git state", () => {
  const reviewed = (overrides: Partial<PlanDetail> = {}) =>
    draft({ state: "Review", ...overrides });

  it("does not read git state for a draft, which has no Git tab", async () => {
    const getPlanGit = vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());
    render(<PlanDetailView plan={draft({ updated: "2026-09-07T10:41:11Z" })} />);

    await waitFor(() => expect(screen.getByRole("tab", { name: "Details" })).toBeInTheDocument());
    expect(getPlanGit).not.toHaveBeenCalled();
  });

  it("re-reads the plan's git state when the plan changes underneath", async () => {
    const getPlanGit = vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());
    const plan = reviewed({ updated: "2026-09-07T10:41:11Z" });
    const { rerender } = render(<PlanDetailView plan={plan} />);

    await waitFor(() => expect(getPlanGit).toHaveBeenCalledTimes(1));

    // A job wrote to the plan: same id, new timestamp. V1 revalidates its plan content query here.
    rerender(<PlanDetailView plan={{ ...plan, updated: "2026-09-07T11:00:00Z" }} />);

    await waitFor(() => expect(getPlanGit).toHaveBeenCalledTimes(2));
  });

  it("does not re-read for a refetch that changed nothing", async () => {
    const getPlanGit = vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());
    const plan = reviewed({ updated: "2026-09-07T10:41:11Z" });
    const { rerender } = render(<PlanDetailView plan={plan} />);

    await waitFor(() => expect(getPlanGit).toHaveBeenCalledTimes(1));
    rerender(<PlanDetailView plan={{ ...plan }} />);

    expect(getPlanGit).toHaveBeenCalledTimes(1);
  });
});

/**
 * Discard is gone. It was one of two near-identical "get rid of this plan" actions and the
 * confusing one: it read as a delete but only wrote `state: Skipped`. Delete is the one that stays,
 * and the Skipped transition survives inside its dialog as "Move to Skipped".
 */
describe("the discard action is gone", () => {
  it("offers no Discard anywhere in a Draft plan's actions", () => {
    render(<PlanDetailView plan={draft()} />);
    openWorkspaceMenu();

    expect(screen.queryByRole("menuitem", { name: /Discard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Discard/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("discard-plan-dialog")).not.toBeInTheDocument();
  });

  it("offers no Discard for a plan in Review either, where V1 puts it", () => {
    render(<PlanDetailView plan={draft({ state: "Review" })} />);
    openWorkspaceMenu();

    expect(screen.queryByRole("menuitem", { name: /Discard/i })).not.toBeInTheDocument();
  });

  it("reaches Skipped through the delete dialog instead", async () => {
    const updateField = vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);
    render(<PlanDetailView plan={draft()} />);
    openWorkspaceMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Delete Plan/ }));
    const dialog = await screen.findByTestId("delete-plan-dialog");
    fireEvent.click(within(dialog).getByTestId("dialog-skip"));

    // Four arguments because the dialog writes through `plansStore.transitionPlanOptimistic`, which
    // passes `allowFailedVerifications` on for the callers that set it.
    await waitFor(() =>
      expect(updateField).toHaveBeenCalledWith("00021", "state", "Skipped", undefined),
    );
  });
});

/**
 * `Apps/Review/ReviewActions.cs`: `.Menu("ResetToDraft", "Reset to Draft", Icons.RotateCcw, ..., "r")`
 * then the danger item. V1's danger item is Discard; with that removed, Delete takes the slot — which
 * is what the Review page is asked to offer alongside Reset to Draft.
 */
describe("a plan in Review", () => {
  it("offers Reset to Draft and Delete Plan, in that order, with Delete as the danger item", async () => {
    render(<PlanDetailView plan={draft({ state: "Review" })} />);
    openWorkspaceMenu();

    const items = screen.getAllByRole("menuitem").map((i) => i.textContent ?? "");
    const reset = items.findIndex((label) => /Reset to Draft/.test(label));
    const del = items.findIndex((label) => /Delete Plan/.test(label));
    expect(reset).toBeGreaterThanOrEqual(0);
    expect(del).toBeGreaterThan(reset);
  });

  it("opens the delete confirm from the Review menu", async () => {
    render(<PlanDetailView plan={draft({ state: "Review" })} />);
    openWorkspaceMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Delete Plan/ }));

    expect(await screen.findByTestId("delete-plan-dialog")).toBeInTheDocument();
  });

  it("opens the Reset to Draft confirm from the Review menu", async () => {
    render(<PlanDetailView plan={draft({ state: "Review" })} />);
    openWorkspaceMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Reset to Draft/ }));

    expect(await screen.findByTestId("reset-to-draft-dialog")).toBeInTheDocument();
  });

  /**
   * Reset is an arrival, not a departure, and this page reports it as one.
   *
   * Every other lifecycle answer here calls `onPlanChanged`, which the shell answers by opening the
   * next plan in the queue — right for Skipped, Icebox and a partial delivery, and wrong for Reset,
   * which puts the plan back at Draft so the operator can start it again. Routed through
   * `onPlanChanged` it closed the plan the operator had just asked to work on.
   */
  it("reports a reset on its own callback rather than as a queue departure", async () => {
    const resetPlan = vi.spyOn(bridge, "resetPlan").mockResolvedValue(undefined);
    vi.spyOn(bridge, "listPlans").mockResolvedValue([]);
    const onPlanReset = vi.fn();
    const onPlanChanged = vi.fn();

    render(
      <PlanDetailView
        plan={draft({ state: "Review" })}
        onPlanReset={onPlanReset}
        onPlanChanged={onPlanChanged}
      />,
    );
    openWorkspaceMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Reset to Draft/ }));
    const dialog = await screen.findByTestId("reset-to-draft-dialog");
    fireEvent.click(within(dialog).getByTestId("dialog-confirm"));

    await waitFor(() => expect(onPlanReset).toHaveBeenCalledWith("00021"));
    expect(onPlanChanged).not.toHaveBeenCalled();
    // And through the store, so the row is Draft in `state.plans` before any list read comes back.
    expect(resetPlan).toHaveBeenCalledWith("00021");
  });

  /**
   * The Complete path the user's "does not get removed instantly" report landed on. The dialog used
   * to call `bridge.updatePlanField` itself, which left the store believing the plan was still in
   * Review — so the review queue, its sidebar list and the nav badge all went on counting it.
   */
  it("completes a partial delivery through the store, so the row leaves the queue at once", async () => {
    const updateField = vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);
    // The store's own reconcile fires a list read, and the daemon has not finished committing: it
    // still calls the plan Review. The pin is what has to outlast that, or the row goes back into the
    // review queue a moment after leaving it.
    vi.spyOn(bridge, "listPlans").mockResolvedValue([
      planSummary({ id: "00021", state: "Review" }),
    ]);
    plansStore.setPlans([planSummary({ id: "00021", state: "Review" })]);

    render(
      <PlanDetailView
        plan={draft({
          state: "Review",
          verifications: [verification("RustBuild", "Fail")],
        })}
      />,
    );
    // `AddPrimaryAction`'s Review set puts this beside Create PR as a secondary action, not in the
    // overflow menu, and offers it only for a plan with a failing verification.
    fireEvent.click(await screen.findByRole("button", { name: /Accept Partial Delivery/ }));
    const dialog = await screen.findByTestId("partial-delivery-dialog");
    fireEvent.click(within(dialog).getByTestId("dialog-confirm"));

    // The flag the dialog exists to send still goes with it.
    await waitFor(() =>
      expect(updateField).toHaveBeenCalledWith("00021", "state", "Completed", true),
    );
    await waitFor(() =>
      expect(plansStore.getState().plans.find((p) => p.id === "00021")?.state).toBe("Completed"),
    );
    plansStore.setPlans([]);
  });
});
