import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlanDetailView } from "../src/views/PlanDetailView";
import { bridge } from "../src/api/bridge";
import { planDetail, planGit, verification } from "./fixtures/plan.fixture";
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("plan switch", () => {
  it("returns to the Plan tab, as V1 does with selectedTab.Set(PlanTab)", async () => {
    const { rerender } = render(<PlanDetailView plan={draft()} />);

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("Repositories")).toBeInTheDocument();

    rerender(<PlanDetailView plan={draft({ id: "00022" })} />);

    await waitFor(() => expect(screen.queryByText("Repositories")).not.toBeInTheDocument());
    // Back on the Plan tab, which is the only one that renders the revision body.
    expect(screen.getByRole("heading", { level: 2, name: "Problem" })).toBeInTheDocument();
  });

  it("keeps the open tab when the same plan is merely refetched", async () => {
    const plan = draft();
    const { rerender } = render(<PlanDetailView plan={plan} />);

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    // A fresh object for the same plan: V1 keys this block on the plan's id precisely so "that must
    // not throw the reader back to the first tab".
    rerender(<PlanDetailView plan={{ ...plan }} />);

    expect(screen.getByText("Repositories")).toBeInTheDocument();
  });

  it("closes an open execute guard so its Proceed cannot answer for the new plan", async () => {
    vi.spyOn(bridge, "getRepoStatus").mockResolvedValue(DIRTY);
    const onExecute = vi.fn();
    const { rerender } = render(<PlanDetailView plan={draft()} onExecute={onExecute} />);

    fireEvent.click(screen.getByRole("button", { name: "Execute Plan" }));
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

    expect(screen.getByTestId("plan-in-flight-notice")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Execute Plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Discard Plan/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reset to Draft/ })).not.toBeInTheDocument();
  });

  it("treats a running ExecutePlan job as mid-flight even while the plan still reads Draft", () => {
    render(<PlanDetailView plan={draft()} jobs={[job({ type: "ExecutePlan" })]} />);

    expect(screen.getByTestId("plan-in-flight-notice")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Execute Plan" })).not.toBeInTheDocument();
  });

  // `DraftActions`: `.Menu("Expand", ..., disabled: ctx.HasActiveExpandJob)`.
  it("disables Expand while an ExpandPlan job is running, and nothing else", () => {
    render(<PlanDetailView plan={draft()} jobs={[job({ type: "ExpandPlan" })]} />);

    expect(screen.getByRole("button", { name: "Expand Plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Split Plan" })).toBeEnabled();
  });

  it("disables Split while a SplitPlan job is running", () => {
    render(<PlanDetailView plan={draft()} jobs={[job({ type: "SplitPlan" })]} />);

    expect(screen.getByRole("button", { name: "Split Plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Expand Plan" })).toBeEnabled();
  });

  it("ignores a job belonging to another plan", () => {
    render(<PlanDetailView plan={draft()} jobs={[job({ planId: "00099" })]} />);

    expect(screen.getByRole("button", { name: "Expand Plan" })).toBeEnabled();
    expect(screen.queryByTestId("plan-in-flight-notice")).not.toBeInTheDocument();
  });

  // V1's `HasActiveJob` counts Running/Queued/Pending only.
  it("ignores a job that has already finished", () => {
    render(<PlanDetailView plan={draft()} jobs={[job({ status: "Completed" })]} />);

    expect(screen.getByRole("button", { name: "Expand Plan" })).toBeEnabled();
  });
});

describe("optimistic transitions", () => {
  it("moves the plan to Creating the moment Execute is dispatched", async () => {
    const onExecute = vi.fn();
    render(<PlanDetailView plan={draft()} onExecute={onExecute} />);

    fireEvent.click(screen.getByRole("button", { name: "Execute Plan" }));

    await waitFor(() => expect(onExecute).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("plan-state-badge")).toHaveTextContent("Creating"),
    );
    // And so stops offering to execute it again.
    expect(screen.queryByRole("button", { name: "Execute Plan" })).not.toBeInTheDocument();
  });

  it("takes the guess back when the dispatch is refused", async () => {
    const onExecute = vi.fn().mockRejectedValue(new Error("daemon unreachable"));
    render(<PlanDetailView plan={draft()} onExecute={onExecute} />);

    fireEvent.click(screen.getByRole("button", { name: "Execute Plan" }));

    await waitFor(() => expect(screen.getByTestId("plan-action-error")).toBeInTheDocument());
    expect(screen.getByTestId("plan-state-badge")).toHaveTextContent("Draft");
    expect(screen.getByRole("button", { name: "Execute Plan" })).toBeInTheDocument();
  });

  it("drops the guess once the service reports a state of its own", async () => {
    const onExecute = vi.fn();
    const plan = draft();
    const { rerender } = render(<PlanDetailView plan={plan} onExecute={onExecute} />);

    fireEvent.click(screen.getByRole("button", { name: "Execute Plan" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Execute Plan" }));

    const button = await screen.findByRole("button", { name: "Checking..." });
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

describe("git state", () => {
  it("re-reads the plan's git state when the plan changes underneath", async () => {
    const getPlanGit = vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());
    const plan = draft({ updated: "2026-09-07T10:41:11Z" });
    const { rerender } = render(<PlanDetailView plan={plan} />);

    await waitFor(() => expect(getPlanGit).toHaveBeenCalledTimes(1));

    // A job wrote to the plan: same id, new timestamp. V1 revalidates its plan content query here.
    rerender(<PlanDetailView plan={{ ...plan, updated: "2026-09-07T11:00:00Z" }} />);

    await waitFor(() => expect(getPlanGit).toHaveBeenCalledTimes(2));
  });

  it("does not re-read for a refetch that changed nothing", async () => {
    const getPlanGit = vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());
    const plan = draft({ updated: "2026-09-07T10:41:11Z" });
    const { rerender } = render(<PlanDetailView plan={plan} />);

    await waitFor(() => expect(getPlanGit).toHaveBeenCalledTimes(1));
    rerender(<PlanDetailView plan={{ ...plan }} />);

    expect(getPlanGit).toHaveBeenCalledTimes(1);
  });
});
