import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReviewView } from "../src/views/ReviewView";
import { bridge } from "../src/api/bridge";
import { planSummary } from "./fixtures/plan.fixture";
import { bridgeError, recommendation } from "./fixtures/recommendation.fixture";

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
