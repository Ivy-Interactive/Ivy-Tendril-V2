import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlanDetailView } from "../src/views/PlanDetailView";
import { PlanVerifications } from "../src/views/PlanVerifications";
import { bridge } from "../src/api/bridge";
import {
  commitRow,
  planDetail,
  planGit,
  prStatus,
  verification,
  worktreeSection,
} from "./fixtures/plan.fixture";
import { recommendation, bridgeError } from "./fixtures/recommendation.fixture";

describe("PlanDetailView and PlanVerifications interactive controls", () => {
  const testPlan = planDetail({
    id: "00021",
    title: "Build Desktop Operator Experience",
    state: "Review",
    verifications: [
      verification("RustClippy", "Pass"),
      verification("RustTest", "Fail"),
      verification("CheckResult", "Pending"),
    ],
    recommendations: [
      recommendation({
        title: "Tauri WebDriver E2E Automation",
        description: "Drive the packaged app with tauri-driver.",
        impact: "Medium",
        state: "Pending",
      }),
    ],
  });

  beforeEach(() => {
    vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([]);
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue(testPlan.recommendations);
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([]);
    vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders recommendations cards and switches to recommendations tab", async () => {
    render(<PlanDetailView plan={testPlan} />);

    const recsTab = screen.getByRole("button", {
      name: /recommendations \(1\)/i,
    });
    expect(recsTab).toBeInTheDocument();

    fireEvent.click(recsTab);

    await waitFor(() =>
      expect(screen.getByText("Tauri WebDriver E2E Automation")).toBeInTheDocument(),
    );

    expect(screen.getByText("Medium impact")).toBeInTheDocument();
    expect(screen.getByText("Drive the packaged app with tauri-driver.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });

  it("accepts recommendation with optional note and updates UI optimistically", async () => {
    const setRecState = vi.spyOn(bridge, "setRecommendationState").mockResolvedValue(undefined);

    render(<PlanDetailView plan={testPlan} />);

    fireEvent.click(screen.getByRole("button", { name: /recommendations \(1\)/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    // Dialog should open
    expect(screen.getByTestId("recommendation-note-dialog")).toBeInTheDocument();
    const textarea = screen.getByRole("textbox", { name: /optional note/i });
    fireEvent.change(textarea, { target: { value: "Ready for next sprint" } });

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    // Dialog should close and bridge call should be made
    await waitFor(() =>
      expect(setRecState).toHaveBeenCalledWith(
        "00021",
        "Tauri WebDriver E2E Automation",
        "AcceptedWithNotes",
        undefined,
        "Ready for next sprint",
      ),
    );

    // UI should show optimistic update
    expect(screen.getByText("AcceptedWithNotes")).toBeInTheDocument();
    expect(screen.getByText("Notes: Ready for next sprint")).toBeInTheDocument();
    expect(screen.queryByTestId("recommendation-note-dialog")).not.toBeInTheDocument();
  });

  it("declines recommendation with note and records declineReason", async () => {
    const setRecState = vi.spyOn(bridge, "setRecommendationState").mockResolvedValue(undefined);

    render(<PlanDetailView plan={testPlan} />);

    fireEvent.click(screen.getByRole("button", { name: /recommendations \(1\)/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    expect(screen.getByTestId("recommendation-note-dialog")).toBeInTheDocument();
    const textarea = screen.getByRole("textbox", { name: /decline reason/i });
    fireEvent.change(textarea, { target: { value: "Out of scope for now" } });

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(setRecState).toHaveBeenCalledWith(
        "00021",
        "Tauri WebDriver E2E Automation",
        "Declined",
        "Out of scope for now",
        undefined,
      ),
    );

    expect(screen.getByText("Declined")).toBeInTheDocument();
    expect(screen.getByText("Decline reason: Out of scope for now")).toBeInTheDocument();
  });

  it("rolls back recommendation decision on bridge failure", async () => {
    vi.spyOn(bridge, "setRecommendationState").mockRejectedValue(
      bridgeError({
        message: "Daemon connection refused",
      }),
    );

    render(<PlanDetailView plan={testPlan} />);

    fireEvent.click(screen.getByRole("button", { name: /recommendations \(1\)/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(screen.getByTestId("plan-action-error")).toHaveTextContent(
        /Failed to update recommendation "Tauri WebDriver E2E Automation": Daemon connection refused/,
      ),
    );

    // Reverted back to Pending state, buttons still available
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });

  it("changes verification status using dropdown control", async () => {
    const setVerificationStatus = vi
      .spyOn(bridge, "setVerificationStatus")
      .mockResolvedValue(undefined);

    render(<PlanVerifications planId="00021" verifications={testPlan.verifications} />);

    await waitFor(() => expect(screen.getByTestId("plan-verifications")).toBeInTheDocument());

    const select = screen.getByTestId("verification-status-select-CheckResult");
    expect(select).toHaveValue("Pending");

    fireEvent.change(select, { target: { value: "Pass" } });

    await waitFor(() =>
      expect(setVerificationStatus).toHaveBeenCalledWith("00021", "CheckResult", "Pass"),
    );

    expect(select).toHaveValue("Pass");
  });

  it("rolls back verification status and shows error banner on update failure", async () => {
    vi.spyOn(bridge, "setVerificationStatus").mockRejectedValue(
      new Error("Failed to write to verification endpoint"),
    );

    render(<PlanVerifications planId="00021" verifications={testPlan.verifications} />);

    await waitFor(() => expect(screen.getByTestId("plan-verifications")).toBeInTheDocument());

    const select = screen.getByTestId("verification-status-select-CheckResult");
    expect(select).toHaveValue("Pending");

    fireEvent.change(select, { target: { value: "Fail" } });

    await waitFor(() =>
      expect(screen.getByTestId("verification-reports-error")).toHaveTextContent(
        /Failed to update verification CheckResult: Failed to write to verification endpoint/,
      ),
    );

    // Rolled back to Pending
    expect(select).toHaveValue("Pending");
  });
  it("shows PR status in the metadata tab's Pull Requests card", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([
      prStatus({
        prUrl: "https://github.com/SpaceCorps/Tendril-App/pull/2",
        planId: "00021",
        status: "Merged",
        branch: "tendril/00021-BuildDesktopOperator",
      }),
    ]);

    render(<PlanDetailView plan={testPlan} />);

    fireEvent.click(screen.getByRole("button", { name: /metadata & history/i }));

    expect(screen.getByText("Pull Requests")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Merged")).toBeInTheDocument());
    expect(screen.getByText("tendril/00021-BuildDesktopOperator")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("counts the plan's worktrees, commits and PRs on the Git tab button", async () => {
    render(<PlanDetailView plan={testPlan} />);

    // One worktree from the fixture, two recorded commits and one PR from testPlan.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Git \(4\)$/ })).toBeInTheDocument(),
    );
  });

  it("renders the worktree section and its commits when the Git tab is opened", async () => {
    render(<PlanDetailView plan={testPlan} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Git \(/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Git \(/ }));

    expect(screen.getByText("Worktrees")).toBeInTheDocument();
    // Scoped to the section's own copy-path control: the worktree is named after the
    // repo, which the header badge already renders.
    expect(screen.getByRole("button", { name: "Copy path to Tendril-App" })).toBeInTheDocument();
    expect(screen.getByText("Add the plan Git tab")).toBeInTheDocument();
    expect(screen.getByText("tendril/00021-BuildDesktopOperator@abc1234")).toBeInTheDocument();
  });

  // The badge is the whole point of fetching on mount: a warning that only appears
  // once you have clicked into the tab is not a warning. Asserted without clicking.
  it("badges the Git tab button when a commit is reachable from no ref", async () => {
    const lost = commitRow({ hash: "f".repeat(40), title: "Work held by nothing" });
    vi.spyOn(bridge, "getPlanGit").mockResolvedValue(
      planGit({
        unassociatedCommits: [lost],
        unassociatedCommitRefStatus: { [lost.hash]: "unreachable" },
      }),
    );

    render(<PlanDetailView plan={testPlan} />);

    const badge = await waitFor(() => screen.getByTestId("git-tab-at-risk"));
    expect(badge).toHaveAttribute("aria-label", "1 commit is at risk of being lost");
    expect(screen.queryByTestId("commits-at-risk")).not.toBeInTheDocument();
  });

  it("leaves the Git tab button unbadged when every commit is reachable", async () => {
    vi.spyOn(bridge, "getPlanGit").mockResolvedValue(
      planGit({ worktrees: [worktreeSection()], unassociatedCommits: [] }),
    );

    render(<PlanDetailView plan={testPlan} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Git \(/ })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("git-tab-at-risk")).not.toBeInTheDocument();
  });

  it("keeps the other tabs working when the Git fetch is rejected", async () => {
    vi.spyOn(bridge, "getPlanGit").mockRejectedValue(
      bridgeError({ message: "The daemon is unreachable" }),
    );

    render(<PlanDetailView plan={testPlan} />);

    // The other tabs are unaffected, and the action banner stays clear.
    fireEvent.click(screen.getByRole("button", { name: /metadata & history/i }));
    expect(screen.getByText("Repositories")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-action-error")).not.toBeInTheDocument();

    // The Git tab reports the failure in its own body, and carries no count.
    fireEvent.click(screen.getByRole("button", { name: /^Git$/ }));
    await waitFor(() => expect(screen.getByTestId("git-tab-error")).toBeInTheDocument());
    expect(screen.getByTestId("git-tab-error")).toHaveTextContent(/daemon is unreachable/);
  });
});
