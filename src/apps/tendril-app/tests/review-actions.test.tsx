import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReviewView } from "../src/views/ReviewView";
import { bridge } from "../src/api/bridge";
import { planDetail, planSummary, verificationReport } from "./fixtures/plan.fixture";
import { bridgeError, recommendation } from "./fixtures/recommendation.fixture";
import type { DraftComment, Job } from "../src/types/api";

const reviewPlan = planSummary({
  id: "00021",
  state: "Review",
  verifications: [
    { name: "RustClippy", status: "Pass" },
    { name: "RustTest", status: "Pass" },
  ],
});

function renderReview() {
  return render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} />);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReviewView recommendations", () => {
  it("renders the plan's real recommendations from the bridge", async () => {
    const listRecommendations = vi.spyOn(bridge, "listRecommendations").mockResolvedValue([
      recommendation(),
      recommendation({
        title: "Deep Link Protocol Handler",
        description: "Register tendril:// links.",
        impact: "Small",
        state: "Declined",
        declineReason: "Not now",
      }),
    ]);

    renderReview();

    await waitFor(() =>
      expect(screen.getByText("Tauri WebDriver E2E Automation")).toBeInTheDocument(),
    );

    expect(listRecommendations).toHaveBeenCalledWith("00021");
    expect(screen.getByText("Deep Link Protocol Handler")).toBeInTheDocument();
    expect(screen.getByText("Decline reason: Not now")).toBeInTheDocument();
    // A declined recommendation offers no further triage buttons.
    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(1);
  });

  it("shows an empty state when ExecutePlan registered no recommendations", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);

    renderReview();

    await waitFor(() => expect(screen.getByTestId("no-recommendations")).toBeInTheDocument());
  });

  it("reports a failure to load recommendations instead of showing none", async () => {
    vi.spyOn(bridge, "listRecommendations").mockRejectedValue(
      bridgeError({
        code: "DISCONNECTED",
        message: "Tendril service is not running",
        details: null,
      }),
    );

    renderReview();

    await waitFor(() =>
      expect(screen.getByTestId("recommendations-error")).toHaveTextContent(
        /Tendril service is not running/,
      ),
    );
    expect(screen.queryByTestId("no-recommendations")).not.toBeInTheDocument();
  });

  it("persists an accept decision through the bridge and keeps it on success", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([recommendation()]);
    const setRecommendationState = vi
      .spyOn(bridge, "setRecommendationState")
      .mockResolvedValue(undefined);

    renderReview();
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByTestId("recommendation-note-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(setRecommendationState).toHaveBeenCalledWith(
        "00021",
        "Tauri WebDriver E2E Automation",
        "Accepted",
        undefined,
        undefined,
      ),
    );
    await waitFor(() => expect(screen.getByText("Accepted")).toBeInTheDocument());
    expect(screen.queryByTestId("review-action-error")).not.toBeInTheDocument();
  });

  it("rolls the decision back and reports why when the write is rejected", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([recommendation()]);
    vi.spyOn(bridge, "setRecommendationState").mockRejectedValue(bridgeError());

    renderReview();
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByTestId("recommendation-note-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(screen.getByTestId("review-action-error")).toHaveTextContent(
        /Could not mark "Tauri WebDriver E2E Automation" as Accepted/,
      ),
    );
    // Rolled back: still Pending, so the triage buttons are still offered.
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.queryByText("Accepted")).not.toBeInTheDocument();
  });

  it("records a decline as Declined", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([recommendation()]);
    const setRecommendationState = vi
      .spyOn(bridge, "setRecommendationState")
      .mockResolvedValue(undefined);

    renderReview();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(screen.getByTestId("recommendation-note-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(setRecommendationState).toHaveBeenCalledWith(
        "00021",
        "Tauri WebDriver E2E Automation",
        "Declined",
        undefined,
        undefined,
      ),
    );
  });

  it("accepts recommendation with note and records AcceptedWithNotes", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([recommendation()]);
    const setRecommendationState = vi
      .spyOn(bridge, "setRecommendationState")
      .mockResolvedValue(undefined);

    renderReview();
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    expect(screen.getByTestId("recommendation-note-dialog")).toBeInTheDocument();
    const textarea = screen.getByRole("textbox", { name: /optional note/i });
    fireEvent.change(textarea, { target: { value: "Ship in next release" } });

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(setRecommendationState).toHaveBeenCalledWith(
        "00021",
        "Tauri WebDriver E2E Automation",
        "AcceptedWithNotes",
        undefined,
        "Ship in next release",
      ),
    );

    expect(screen.getByText("AcceptedWithNotes")).toBeInTheDocument();
    expect(screen.getByText("Notes: Ship in next release")).toBeInTheDocument();
    expect(screen.queryByTestId("recommendation-note-dialog")).not.toBeInTheDocument();
  });

  it("declines recommendation with reason and records declineReason", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([recommendation()]);
    const setRecommendationState = vi
      .spyOn(bridge, "setRecommendationState")
      .mockResolvedValue(undefined);

    renderReview();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    expect(screen.getByTestId("recommendation-note-dialog")).toBeInTheDocument();
    const textarea = screen.getByRole("textbox", { name: /decline reason/i });
    fireEvent.change(textarea, { target: { value: "Out of scope for this milestone" } });

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(setRecommendationState).toHaveBeenCalledWith(
        "00021",
        "Tauri WebDriver E2E Automation",
        "Declined",
        "Out of scope for this milestone",
        undefined,
      ),
    );

    expect(screen.getByText("Declined")).toBeInTheDocument();
    expect(screen.getByText("Decline reason: Out of scope for this milestone")).toBeInTheDocument();
  });

  it("canceling the dialog leaves recommendation in Pending", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([recommendation()]);
    const setRecommendationState = vi
      .spyOn(bridge, "setRecommendationState")
      .mockResolvedValue(undefined);

    renderReview();
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByTestId("recommendation-note-dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByTestId("recommendation-note-dialog")).not.toBeInTheDocument();
    expect(setRecommendationState).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });
});

/**
 * The triage buttons no longer dispatch: each opens a dialog that owns its own
 * options and its own failure. So the assertions moved from the toolbar's
 * `review-action-error` banner to the dialog's `role="alert"`, which is where
 * the operator is looking when they press confirm.
 */
describe("ReviewView lifecycle actions", () => {
  it("surfaces a Create PR failure rather than appearing to succeed", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    const startJob = vi.spyOn(bridge, "startJob").mockRejectedValue(
      bridgeError({
        code: "START_JOB_FAILED",
        message: "Plan 00021 has a failing verification",
        details: null,
      }),
    );

    renderReview();

    fireEvent.click(screen.getByRole("button", { name: /^create pr$/i }));

    const dialog = await screen.findByTestId("create-pr-dialog");
    // Opening the dialog is not consent to open the PR.
    expect(startJob).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Plan 00021 has a failing verification/),
    );
    expect(dialog).toBeInTheDocument();
  });

  it("keeps the change request in the dialog when RetryPlan is refused", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    const startJob = vi.spyOn(bridge, "startJob").mockRejectedValue(
      bridgeError({
        code: "DISCONNECTED",
        message: "Tendril service is not running",
        details: null,
      }),
    );

    renderReview();

    fireEvent.click(screen.getByRole("button", { name: /^request changes$/i }));

    const textarea = await screen.findByLabelText("Change request");
    fireEvent.change(textarea, { target: { value: "Fix the failing clippy lint." } });
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Tendril service is not running/),
    );
    expect(startJob).toHaveBeenCalledWith({
      type: "RetryPlan",
      folderPath: "00021",
      changeRequest: "Fix the failing clippy lint.",
    });
    // The dialog stays open with the text intact so it can be resubmitted.
    expect(screen.getByLabelText("Change request")).toHaveValue("Fix the failing clippy lint.");
  });

  it("closes the dialog once RetryPlan is accepted", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "startJob").mockResolvedValue({ jobId: "03007", status: "Queued" });

    renderReview();

    fireEvent.click(screen.getByRole("button", { name: /^request changes$/i }));

    const textarea = await screen.findByLabelText("Change request");
    fireEvent.change(textarea, { target: { value: "Please rerun the verifications." } });
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(screen.queryByTestId("suggest-changes-dialog")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("review-action-error")).not.toBeInTheDocument();
  });
});

/**
 * `ReviewApp.Build`'s queue, which is not just a state filter: it also drops the plans a job still
 * holds (`activePlanFolders`). A plan whose retry is only Queued or Blocked is still recorded as being
 * in Review, so without this it sits in the queue offering Complete Plan on work an agent has not
 * finished.
 */
describe("ReviewView queue", () => {
  const otherPlan = planSummary({ id: "00022", title: "Second plan", state: "Review" });

  function job(overrides: Partial<Job> = {}): Job {
    return {
      id: "03100",
      type: "RetryPlan",
      planId: "00021",
      project: "Tendril-App",
      status: "Running",
      ...overrides,
    };
  }

  it("hides a plan a job still holds", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);

    render(<ReviewView plans={[reviewPlan, otherPlan]} jobs={[job()]} onSelectPlan={() => {}} />);

    expect(await screen.findAllByText("Second plan")).not.toHaveLength(0);
    expect(screen.queryByText(reviewPlan.title)).not.toBeInTheDocument();
  });

  it("counts a Blocked job as still holding the plan, since it is queued behind another", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);

    render(
      <ReviewView
        plans={[reviewPlan, otherPlan]}
        jobs={[job({ status: "Blocked" })]}
        onSelectPlan={() => {}}
      />,
    );

    expect(await screen.findAllByText("Second plan")).not.toHaveLength(0);
    expect(screen.queryByText(reviewPlan.title)).not.toBeInTheDocument();
  });

  it("keeps the plan once its job has finished", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);

    render(
      <ReviewView
        plans={[reviewPlan, otherPlan]}
        jobs={[job({ status: "Completed" })]}
        onSelectPlan={() => {}}
      />,
    );

    expect(await screen.findAllByText(reviewPlan.title)).not.toHaveLength(0);
  });
});

/**
 * `ContentView.AddPrimaryAction`, whose three branches are a plan with commits (PR), a plan whose
 * completion is blocked (Skip Plan) and everything else (Complete Plan).
 */
describe("ReviewView primary action", () => {
  it("pushes a PR update directly rather than opening the Create PR dialog", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "getPlan").mockResolvedValue(
      planDetail({
        id: "00021",
        state: "Review",
        verifications: [{ name: "RustClippy", status: "Pass" }],
        commits: ["abc1234"],
        sourceUrl: "https://github.com/SpaceCorps/Tendril-App/pull/2",
      }),
    );
    const startJob = vi.spyOn(bridge, "startJob").mockResolvedValue({
      jobId: "03200",
      status: "Queued",
    });

    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: /update pr/i }));

    // V1: "There's nothing to configure for an update", so no dialog, and these four options
    // literally.
    await waitFor(() =>
      expect(startJob).toHaveBeenCalledWith({
        type: "CreatePr",
        folderPath: "00021",
        solveMergeConflicts: true,
        merge: false,
        deleteBranch: false,
        includeArtifacts: true,
      }),
    );
    expect(screen.queryByTestId("create-pr-dialog")).not.toBeInTheDocument();
  });

  it("offers Skip Plan and says why when pre-execution rejected the plan's premise", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "getPlan").mockResolvedValue(
      planDetail({ id: "00021", state: "Review", commits: [], prs: [] }),
    );
    vi.spyOn(bridge, "getVerificationReport").mockResolvedValue(
      verificationReport({ name: "PreExecution", result: "Fail" }),
    );

    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} />);

    expect(await screen.findByRole("button", { name: /skip plan/i })).toBeInTheDocument();
    expect(
      screen.getByText(/Pre-execution validation found no changes needed/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /complete plan/i })).not.toBeInTheDocument();
  });

  it("does not block a plan that delivered something, even after a pre-execution Fail", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    // The no-commits-and-no-PRs conjunct: a plan that recorded a PR did real work, so the block does
    // not apply to it.
    vi.spyOn(bridge, "getPlan").mockResolvedValue(
      planDetail({
        id: "00021",
        state: "Review",
        commits: [],
        prs: ["https://github.com/SpaceCorps/Tendril-App/pull/2"],
      }),
    );
    vi.spyOn(bridge, "getVerificationReport").mockResolvedValue(
      verificationReport({ name: "PreExecution", result: "Fail" }),
    );

    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} />);

    expect(await screen.findByRole("button", { name: /complete plan/i })).toBeInTheDocument();
    expect(screen.queryByTestId("review-completion-blocked")).not.toBeInTheDocument();
  });

  it("leaves the plan completable when there is no pre-execution report at all", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "getPlan").mockResolvedValue(
      planDetail({ id: "00021", state: "Review", commits: [], prs: [] }),
    );
    // `read_report` answers NOT_FOUND for a verification that never ran, which is the common case: a
    // plan is never blocked on a guess.
    vi.spyOn(bridge, "getVerificationReport").mockRejectedValue(
      bridgeError({ code: "NOT_FOUND", message: "No verification report", details: null }),
    );

    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} />);

    expect(await screen.findByRole("button", { name: /complete plan/i })).toBeInTheDocument();
  });
});

/**
 * `SuggestChangesDialog.HandleSubmit` clears the plan's draft comments the moment RetryPlan starts, in
 * two places at once: `ClearDraftCommentsAsync` on the service and `_draftCommentsState.Set(new
 * List<DraftComment>())` on the count the page is holding. V2 has no `CommentsChanged` subscription to
 * fall back on, so the second one is the only thing that stops the badge counting sent feedback.
 */
describe("ReviewView inline diff comments", () => {
  const comments: DraftComment[] = [
    {
      filePath: "src/main.rs",
      changeKey: "1:2",
      lineNumber: 12,
      content: "This unwrap can panic.",
      author: "op",
      isResolved: false,
    },
  ];

  it("drops the Request Changes badge once RetryPlan has been accepted", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "listDiffComments").mockResolvedValue(comments);
    const clearDiffComments = vi.spyOn(bridge, "clearDiffComments").mockResolvedValue(undefined);
    vi.spyOn(bridge, "startJob").mockResolvedValue({ jobId: "03300", status: "Queued" });

    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} />);

    expect(await screen.findByTestId("request-changes-comment-count")).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: /^request changes/i }));
    fireEvent.click(await screen.findByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(screen.queryByTestId("suggest-changes-dialog")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("request-changes-comment-count")).not.toBeInTheDocument();
    // The service-side half of the same decision.
    expect(clearDiffComments).toHaveBeenCalledWith("00021");
  });

  it("keeps the badge when RetryPlan is refused, because nothing was sent", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "listDiffComments").mockResolvedValue(comments);
    vi.spyOn(bridge, "startJob").mockRejectedValue(
      bridgeError({
        code: "DISCONNECTED",
        message: "Tendril service is not running",
        details: null,
      }),
    );

    render(<ReviewView plans={[reviewPlan]} onSelectPlan={() => {}} />);

    expect(await screen.findByTestId("request-changes-comment-count")).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: /^request changes/i }));
    fireEvent.click(await screen.findByTestId("dialog-confirm"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByTestId("request-changes-comment-count")).toHaveTextContent("1");
  });
});
