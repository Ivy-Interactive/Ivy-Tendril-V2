import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlanGit } from "../src/views/PlanGit";
import { PlanDetailView } from "../src/views/PlanDetailView";
import { bridge } from "../src/api/bridge";
import { commitRow, planDetail, planGit, worktreeSection } from "./fixtures/plan.fixture";
import { bridgeError } from "./fixtures/recommendation.fixture";

const LOST = commitRow({
  hash: "dead000000000000000000000000000000000001",
  shortHash: "dead000",
  title: "Add the thing nobody pushed",
  fileCount: 2,
});

describe("PlanGit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("groups the plan's commits under the worktree that made them", async () => {
    vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());

    render(<PlanGit planId="00021" />);

    await waitFor(() => expect(screen.getByText("Tendril-App")).toBeInTheDocument());
    expect(screen.getByText("tendril/00021-BuildDesktopOperator")).toBeInTheDocument();
    expect(screen.getByText("Add the plan Git tab")).toBeInTheDocument();
    expect(screen.getByText("3 files")).toBeInTheDocument();
    expect(screen.getByText(/main @ 9990000/)).toBeInTheDocument();
    // A commit under a worktree is reachable by definition, so it carries no status badge.
    expect(screen.queryByText("Reachable")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("warns prominently when a recorded commit is reachable from no ref", async () => {
    vi.spyOn(bridge, "getPlanGit").mockResolvedValue(
      planGit({
        worktrees: [],
        unassociatedCommits: [LOST],
        unassociatedCommitRefStatus: { [LOST.hash]: "Unreachable" },
      }),
    );

    render(<PlanGit planId="00021" />);

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert).toHaveTextContent(/Lost work: 1 commit is not reachable/i);
    expect(alert).toHaveTextContent(/next git gc/i);
    // The warning names the commit, so the operator can go and rescue it.
    expect(alert).toHaveTextContent("dead000");
    expect(alert).toHaveTextContent("Add the thing nobody pushed");
  });

  it("counts every commit at risk, whether unreachable or missing outright", async () => {
    const missing = commitRow({
      hash: "beef000000000000000000000000000000000002",
      shortHash: "beef000",
      title: "",
      fileCount: undefined,
    });
    vi.spyOn(bridge, "getPlanGit").mockResolvedValue(
      planGit({
        worktrees: [],
        unassociatedCommits: [LOST, missing],
        unassociatedCommitRefStatus: {
          [LOST.hash]: "Unreachable",
          [missing.hash]: "Missing",
        },
      }),
    );

    render(<PlanGit planId="00021" />);

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert).toHaveTextContent(/Lost work: 2 commits are not reachable/i);
    expect(screen.getAllByText("Lost work")).toHaveLength(2);
    expect(screen.getAllByText("Missing")).toHaveLength(2);
    // A hash no repo could resolve still shows as a row rather than vanishing.
    expect(screen.getAllByText("(unresolved commit)").length).toBeGreaterThan(0);
  });

  it("lists a commit no worktree accounts for without warning when a ref still holds it", async () => {
    vi.spyOn(bridge, "getPlanGit").mockResolvedValue(
      planGit({
        worktrees: [],
        unassociatedCommits: [LOST],
        unassociatedCommitRefStatus: { [LOST.hash]: "Reachable" },
      }),
    );

    render(<PlanGit planId="00021" />);

    await waitFor(() => expect(screen.getByText("Commits without a worktree")).toBeInTheDocument());
    expect(screen.getByText("Reachable")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("flags a worktree with uncommitted changes", async () => {
    vi.spyOn(bridge, "getPlanGit").mockResolvedValue(
      planGit({ worktrees: [worktreeSection({ hasUncommittedChanges: true })] }),
    );

    render(<PlanGit planId="00021" />);

    await waitFor(() => expect(screen.getByText("Uncommitted changes")).toBeInTheDocument());
  });

  it("reports a plan with no worktrees and no commits as having nothing to show", async () => {
    vi.spyOn(bridge, "getPlanGit").mockResolvedValue(
      planGit({ worktrees: [], unassociatedCommits: [] }),
    );

    render(<PlanGit planId="00021" />);

    await waitFor(() =>
      expect(screen.getByText("No worktrees or commits recorded")).toBeInTheDocument(),
    );
  });

  it("shows the bridge error instead of an empty tab when the daemon cannot answer", async () => {
    vi.spyOn(bridge, "getPlanGit").mockRejectedValue(
      bridgeError({ code: "PLAN_GIT_FAILED", message: "Failed to get plan git data" }),
    );

    render(<PlanGit planId="00021" />);

    await waitFor(() =>
      expect(screen.getByText(/Failed to get plan git data/)).toBeInTheDocument(),
    );
    expect(screen.queryByText("No worktrees or commits recorded")).not.toBeInTheDocument();
  });

  it("re-asks the daemon on refresh", async () => {
    const get = vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());

    render(<PlanGit planId="00021" />);

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});

describe("PlanDetailView Git tab", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the Git tab and surfaces the unreachable-commit warning", async () => {
    vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([]);
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([]);
    const get = vi.spyOn(bridge, "getPlanGit").mockResolvedValue(
      planGit({
        worktrees: [],
        unassociatedCommits: [LOST],
        unassociatedCommitRefStatus: { [LOST.hash]: "Unreachable" },
      }),
    );

    render(<PlanDetailView plan={planDetail({ id: "00021" })} />);

    // Nothing is fetched until the tab is opened: answering the question runs git per worktree.
    expect(get).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Git" }));

    await waitFor(() => expect(get).toHaveBeenCalledWith("00021"));
    expect(await waitFor(() => screen.getByRole("alert"))).toHaveTextContent(
      /Lost work: 1 commit/i,
    );
  });
});
