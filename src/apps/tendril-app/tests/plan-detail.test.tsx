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
import { chatApi } from "../src/api/chatApi";
import type { PlanDetail, PlanGitData } from "../src/types/api";

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
    // The workspace's Chat slot looks for the plan's own session on mount.
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders recommendations cards and switches to recommendations tab", async () => {
    render(<PlanDetailView plan={testPlan} />);

    const recsTab = screen.getByRole("tab", {
      name: /recommendations \(1\)/i,
    });
    expect(recsTab).toBeInTheDocument();

    fireEvent.click(recsTab);

    await waitFor(() =>
      expect(screen.getByText("Tauri WebDriver E2E Automation")).toBeInTheDocument(),
    );

    // `RecommendationsTabView` badges the bare impact value, not "<impact> impact".
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Drive the packaged app with tauri-driver.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });

  it("accepts recommendation with optional note and updates UI optimistically", async () => {
    const setRecState = vi.spyOn(bridge, "setRecommendationState").mockResolvedValue(undefined);

    render(<PlanDetailView plan={testPlan} />);

    fireEvent.click(screen.getByRole("tab", { name: /recommendations \(1\)/i }));

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

    fireEvent.click(screen.getByRole("tab", { name: /recommendations \(1\)/i }));

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

    fireEvent.click(screen.getByRole("tab", { name: /recommendations \(1\)/i }));

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

  // V1's `VerificationsPanelView` gives each verification a checkbox, not a status picker: a
  // checked box is Pending and an unchecked one Skipped, and Pass/Fail are only ever written by
  // the runner. The old dropdown let an operator declare an outcome no execution produced.
  it("skips a verification by unchecking it, while the plan is still a draft", async () => {
    const setVerificationStatus = vi
      .spyOn(bridge, "setVerificationStatus")
      .mockResolvedValue(undefined);

    render(
      <PlanVerifications planId="00021" planState="Draft" verifications={testPlan.verifications} />,
    );

    await waitFor(() => expect(screen.getByTestId("plan-verifications")).toBeInTheDocument());

    const checkbox = screen.getByTestId("verification-checkbox-CheckResult");
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(setVerificationStatus).toHaveBeenCalledWith("00021", "CheckResult", "Skipped"),
    );

    expect(checkbox).not.toBeChecked();
  });

  it("disables the checkboxes once the plan has left Draft", async () => {
    render(
      <PlanVerifications
        planId="00021"
        planState="Review"
        verifications={testPlan.verifications}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("plan-verifications")).toBeInTheDocument());
    expect(screen.getByTestId("verification-checkbox-CheckResult")).toBeDisabled();
  });

  it("rolls back verification status and shows error banner on update failure", async () => {
    vi.spyOn(bridge, "setVerificationStatus").mockRejectedValue(
      new Error("Failed to write to verification endpoint"),
    );

    render(
      <PlanVerifications planId="00021" planState="Draft" verifications={testPlan.verifications} />,
    );

    await waitFor(() => expect(screen.getByTestId("plan-verifications")).toBeInTheDocument());

    const checkbox = screen.getByTestId("verification-checkbox-CheckResult");
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(screen.getByTestId("verification-reports-error")).toHaveTextContent(
        /Failed to update verification CheckResult: Failed to write to verification endpoint/,
      ),
    );

    // Rolled back to Pending, so the box is checked again.
    expect(checkbox).toBeChecked();
  });
  it("shows PR status in the Details tab's Pull Requests card", async () => {
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([
      prStatus({
        prUrl: "https://github.com/SpaceCorps/Tendril-App/pull/2",
        planId: "00021",
        status: "Merged",
        branch: "tendril/00021-BuildDesktopOperator",
      }),
    ]);

    render(<PlanDetailView plan={testPlan} />);

    fireEvent.click(screen.getByRole("tab", { name: "Details" }));

    expect(screen.getByText("Pull Requests")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Merged")).toBeInTheDocument());
    expect(screen.getByText("tendril/00021-BuildDesktopOperator")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("counts the plan's worktrees, commits and PRs on the Git tab button", async () => {
    render(<PlanDetailView plan={testPlan} />);

    // One worktree from the fixture, two recorded commits and one PR from testPlan.
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /^Git \(4\)$/ })).toBeInTheDocument(),
    );
  });

  it("renders the worktree section and its commits when the Git tab is opened", async () => {
    render(<PlanDetailView plan={testPlan} />);

    await waitFor(() => expect(screen.getByRole("tab", { name: /^Git \(/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: /^Git \(/ }));

    expect(screen.getByText("Worktrees")).toBeInTheDocument();
    // Scoped to the section's own copy-path control: the worktree is named after the
    // repo, which the header badge already renders.
    expect(screen.getByRole("button", { name: "Copy path to Tendril-App" })).toBeInTheDocument();
    expect(screen.getByText("Add the plan Git tab")).toBeInTheDocument();
    expect(screen.getByText("tendril/00021-BuildDesktopOperator@abc1234")).toBeInTheDocument();
  });

  // The badge is the whole point of fetching on mount: a warning that only appears
  // once you have clicked into the tab is not a warning. Asserted without clicking.
  //
  // It used to be a bare dot carrying an `aria-label`. A `PlanTabDto` has only a label and a badge,
  // so the count is now the tab's badge and the label says what it counts — which is what a screen
  // reader gets instead of a dot.
  it("badges the Git tab when a commit is reachable from no ref", async () => {
    const lost = commitRow({ hash: "f".repeat(40), title: "Work held by nothing" });
    vi.spyOn(bridge, "getPlanGit").mockResolvedValue(
      planGit({
        unassociatedCommits: [lost],
        unassociatedCommitRefStatus: { [lost.hash]: "unreachable" },
      }),
    );

    render(<PlanDetailView plan={testPlan} />);

    await waitFor(() => expect(screen.getByRole("tab", { name: /1 at risk/ })).toBeInTheDocument());
    expect(screen.queryByTestId("commits-at-risk")).not.toBeInTheDocument();
  });

  it("leaves the Git tab unbadged when every commit is reachable", async () => {
    vi.spyOn(bridge, "getPlanGit").mockResolvedValue(
      planGit({ worktrees: [worktreeSection()], unassociatedCommits: [] }),
    );

    render(<PlanDetailView plan={testPlan} />);

    await waitFor(() => expect(screen.getByRole("tab", { name: /^Git \(/ })).toBeInTheDocument());
    expect(screen.queryByRole("tab", { name: /at risk/ })).not.toBeInTheDocument();
  });

  it("keeps the other tabs working when the Git fetch is rejected", async () => {
    vi.spyOn(bridge, "getPlanGit").mockRejectedValue(
      bridgeError({ message: "The daemon is unreachable" }),
    );

    render(<PlanDetailView plan={testPlan} />);

    // The other tabs are unaffected, and the action banner stays clear.
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("Repositories")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-action-error")).not.toBeInTheDocument();

    // The Git tab reports the failure in its own body, and carries no count. It appears only once
    // the rejection has landed -- an unanswered fetch now shows no tab at all, which is what stopped
    // the tab flickering in from unlabelled to counted on every plan.
    await waitFor(() => expect(screen.getByRole("tab", { name: /^Git$/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: /^Git$/ }));
    await waitFor(() => expect(screen.getByTestId("git-tab-error")).toBeInTheDocument());
    expect(screen.getByTestId("git-tab-error")).toHaveTextContent(/daemon is unreachable/);
  });
});

/**
 * Audit item B5: six of this view's panes were wrapped in `CARD_SURFACE`, a hand-written
 * `rounded-box border border-border bg-card/40`.
 *
 * None becomes the shared `Card`. The shared `Card` is `rounded-box border bg-card
 * text-card-foreground shadow` - byte-for-byte the string the Ivy Framework's own `Card` renders,
 * so V1's `new Card()` *is* V2's `<Card>` and there is no lighter shared variant. It is heavier
 * than what these panes had, and V1 draws no card at any of the six: `DetailsTabView.cs:68` drops
 * `ToDetails()` into a bare `Layout.Vertical().Gap(4)`, `ChangesTabView` and `GitTabView` open with
 * bare vertical layouts, and `RecommendationsTabView.cs:22` is `Layout.Vertical().Padding(2)`.
 *
 * So the surface is removed rather than swapped. These pin that, because the change is invisible to
 * every accessible query and a later refactor could quietly put the box back.
 */
describe("PlanDetailView tab panes draw no card", () => {
  const testPlan = planDetail({ id: "00021", title: "Build Desktop Operator Experience" });

  beforeEach(() => {
    vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const unboxed = (el: Element | null | undefined) => {
    expect(el).toBeTruthy();
    expect(el!.className).not.toContain("bg-card");
    expect(el!.className).not.toContain("rounded-box");
  };

  it("renders the Details list without a surface, as `DetailsTabView` does", () => {
    render(<PlanDetailView plan={testPlan} />);
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));

    unboxed(screen.getByText("Plan ID").closest("dl"));
  });

  it("renders the Repositories and Commits panels without a surface", () => {
    render(<PlanDetailView plan={testPlan} />);
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));

    unboxed(screen.getByText("Repositories").parentElement);
    unboxed(screen.getByText("Commits").parentElement);
  });

  it("renders the Recommendations pane without a surface", () => {
    render(<PlanDetailView plan={testPlan} />);
    fireEvent.click(screen.getByRole("tab", { name: /Recommendations/ }));

    unboxed(screen.getByText("Plan Recommendations").closest("div")?.parentElement);
  });
});

/**
 * An absent plan body says *why* it is absent.
 *
 * The bug these pin: plans 00003 and 00004 in a real `~/.tendril` showed nothing but
 * `# No revision content available`, rendered as the plan's own markdown. On disk both had a
 * `Revisions/` directory with no file in it, `revisionCount: 0`, and a `plan.yaml` whose `updated`
 * still equalled its `created` -- their CreatePlan jobs (00010, 00013) were killed by stop-all
 * between `tendril plan create`, which makes the folder, and `tendril plan write-revision`, which
 * writes `001.md`. The daemon returned exactly that: `revision_count: 0`, empty content.
 *
 * Nothing had failed, so no error path fired; the placeholder was the only thing that spoke, and it
 * spoke in the plan's own voice. A plan whose body genuinely read "No revision content available"
 * would have looked identical.
 */
describe("PlanDetailView with no revision content", () => {
  beforeEach(() => {
    vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Plan 00003/00004's shape exactly: a folder, no revision, nothing running. */
  const undrafted = (overrides: Partial<PlanDetail> = {}) =>
    planDetail({
      id: "00003",
      state: "Draft",
      revisionCount: 0,
      latestRevisionContent: "",
      dependsOn: [],
      recommendations: [],
      ...overrides,
    });

  it("never renders the placeholder as plan markdown", () => {
    render(<PlanDetailView plan={undrafted()} />);

    // The exact string the fallback used to inject into the document.
    expect(screen.queryByText("No revision content available")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /No revision content available/ }),
    ).not.toBeInTheDocument();
  });

  it("says the revision was never written when the plan has none", () => {
    render(<PlanDetailView plan={undrafted()} />);

    expect(screen.getByTestId("revision-never-written")).toBeInTheDocument();
    expect(screen.getByTestId("revision-never-written")).toHaveTextContent(/no revisions/i);
  });

  /**
   * The empty state offers the control, it does not name one.
   *
   * Reported against a real husk plan: "it suggests to click 'update plan' but there is really no
   * update plan button". The copy read "Run Update Plan to draft it", and on this exact plan that
   * was a dead end. The badged *Update Plan* secondary is gated on `pendingWork > 0` -- unresolved
   * annotations plus answered questions -- and a plan with no revision has neither, because there is
   * no body to annotate or answer against. What remained was an unlabeled wand glyph in the topbar,
   * which folds into an overflow menu below 720px.
   *
   * So the callout carries the button itself, and the prose no longer names one.
   */
  it("offers an Update Plan button on a husk rather than naming one in prose", () => {
    render(<PlanDetailView plan={undrafted()} />);

    const empty = screen.getByTestId("revision-never-written");
    // The dead-end instruction is gone.
    expect(empty).not.toHaveTextContent(/run update plan/i);

    const button = screen.getByTestId("revision-never-written-update");
    expect(empty).toContainElement(button);
    expect(button).toHaveTextContent(/update plan/i);

    fireEvent.click(button);
    expect(screen.getByTestId("update-plan-dialog")).toBeInTheDocument();
  });

  /**
   * The button tracks the same predicate as the topbar's wand, so it cannot offer a dialog the plan
   * is not eligible for. `canRefine` allows only `Draft`; a `Blocked` plan with no revision still
   * gets the explanation, just not the offer.
   */
  it("withholds the button when the plan cannot be refined", () => {
    render(<PlanDetailView plan={undrafted({ state: "Blocked" })} />);

    expect(screen.getByTestId("revision-never-written")).toBeInTheDocument();
    expect(screen.queryByTestId("revision-never-written-update")).not.toBeInTheDocument();
  });

  it("says the agent is still drafting while a CreatePlan job holds the plan", () => {
    render(
      <PlanDetailView
        plan={undrafted()}
        jobs={[
          {
            id: "job-9",
            type: "CreatePlan",
            planId: "00003",
            project: "Tendril-App",
            status: "Running",
          },
        ]}
      />,
    );

    expect(screen.getByTestId("revision-writing")).toBeInTheDocument();
    expect(screen.queryByTestId("revision-never-written")).not.toBeInTheDocument();
  });

  /**
   * The case that must not be reported as "never written": the count says a revision is on disk, so
   * an empty body is a read fault, and telling the operator to draft a plan that already exists
   * would be the wrong instruction.
   */
  it("reports an empty body as a read failure when a revision exists on disk", () => {
    render(<PlanDetailView plan={undrafted({ revisionCount: 2 })} />);

    expect(screen.getByTestId("revision-unreadable")).toBeInTheDocument();
    expect(screen.queryByTestId("revision-never-written")).not.toBeInTheDocument();
  });

  it("renders the plan body and no empty state once a revision exists", () => {
    render(
      <PlanDetailView
        plan={undrafted({ revisionCount: 1, latestRevisionContent: "# Real Plan\n\n## Problem\n" })}
      />,
    );

    expect(screen.queryByTestId("revision-never-written")).not.toBeInTheDocument();
    expect(screen.queryByTestId("revision-writing")).not.toBeInTheDocument();
    expect(screen.queryByTestId("revision-unreadable")).not.toBeInTheDocument();
  });
});

/**
 * The Git tab belongs to a review, and appears exactly once.
 *
 * Two reports, one cause. The tab was added whenever `gitItemCount === null || gitItemCount > 0`,
 * and the count is `null` until `getPlanGit` answers -- so every plan opened with a bare "Git" tab
 * that relabelled itself to "Git (4)" a moment later. That is the flicker. And it was added for
 * every plan, although everything it renders (worktrees, commit reachability, PRs) is state an
 * *execution* produced, which a Draft has none of.
 *
 * `isReviewState` is the existing notion of a review here -- `Review` or `Failed`, the states
 * `ReviewApp.Build` hands its page -- and is what already gates Diff View and Recommendations.
 */
describe("PlanDetailView Git tab visibility", () => {
  beforeEach(() => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([]);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows no Git tab for a draft, and does not read git state for one", async () => {
    const getPlanGit = vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());

    render(<PlanDetailView plan={planDetail({ state: "Draft", dependsOn: [] })} />);

    await waitFor(() => expect(screen.getByRole("tab", { name: "Details" })).toBeInTheDocument());
    expect(screen.queryByRole("tab", { name: /^Git/ })).not.toBeInTheDocument();
    expect(getPlanGit).not.toHaveBeenCalled();
  });

  /**
   * The flicker itself: before the fetch answers there must be no Git tab at all, rather than an
   * unlabelled one that gains a count.
   */
  it("does not show an uncounted Git tab before the fetch answers", async () => {
    let release: (data: PlanGitData) => void = () => {};
    vi.spyOn(bridge, "getPlanGit").mockReturnValue(
      new Promise<PlanGitData>((resolve) => {
        release = resolve;
      }),
    );

    render(<PlanDetailView plan={planDetail({ state: "Review", dependsOn: [] })} />);

    // In flight: no tab, and in particular not the bare "Git" the old null-count clause added.
    expect(screen.queryByRole("tab", { name: /^Git/ })).not.toBeInTheDocument();

    release(planGit());

    // It appears once, already carrying its count, and never as a bare "Git".
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /^Git \(4\)$/ })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("tab", { name: /^Git$/ })).not.toBeInTheDocument();
  });

  /** A failed read still gets a tab: its body is the only place that failure is reported. */
  it("keeps the Git tab for a review when the fetch is rejected", async () => {
    vi.spyOn(bridge, "getPlanGit").mockRejectedValue(
      bridgeError({ message: "The daemon is unreachable" }),
    );

    render(<PlanDetailView plan={planDetail({ state: "Review", dependsOn: [] })} />);

    await waitFor(() => expect(screen.getByRole("tab", { name: /^Git$/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: /^Git$/ }));
    expect(screen.getByTestId("git-tab-error")).toHaveTextContent(/daemon is unreachable/);
  });

  /**
   * `var activeTab = tabs.Any(t => t.Id == selectedTab.Value) ? selectedTab.Value : PlanTab;` --
   * a plan leaving Review takes its Git tab with it, and the page must fall back to Plan rather
   * than render a pane whose tab is gone.
   */
  it("falls back to the Plan tab when Git disappears while it is open", async () => {
    vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());
    const reviewed = planDetail({ state: "Review", dependsOn: [] });
    const { rerender } = render(<PlanDetailView plan={reviewed} />);

    await waitFor(() => expect(screen.getByRole("tab", { name: /^Git \(/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: /^Git \(/ }));
    expect(screen.getByText("Worktrees")).toBeInTheDocument();

    rerender(<PlanDetailView plan={{ ...reviewed, state: "Draft" }} />);

    expect(screen.queryByRole("tab", { name: /^Git/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Worktrees")).not.toBeInTheDocument();
    // The Plan tab's body, not a blank pane: the fixture revision's own H1 renders. Matched as a
    // heading because the workspace header carries the same title as plain text.
    expect(screen.getByRole("tab", { name: "Plan" })).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("heading", { name: "Build Desktop Operator Experience" }),
    ).toBeInTheDocument();
  });
});
