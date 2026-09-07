import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReviewView } from "../src/views/ReviewView";
import { bridge } from "../src/api/bridge";
import { planSummary } from "./fixtures/plan.fixture";
import {
  bridgeError,
  recommendation,
} from "./fixtures/recommendation.fixture";

const reviewPlan = planSummary({
  id: "00021",
  state: "Review",
  verifications: [
    { name: "RustClippy", status: "Pass" },
    { name: "RustTest", status: "Pass" },
  ],
});

function renderReview(
  overrides: {
    onCreatePr?: (planId: string) => void | Promise<void>;
    onRetry?: (planId: string, feedback: string) => void | Promise<void>;
  } = {}
) {
  return render(
    <ReviewView
      plans={[reviewPlan]}
      onSelectPlan={() => {}}
      onCreatePr={overrides.onCreatePr ?? (() => {})}
      onRetry={overrides.onRetry ?? (() => {})}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReviewView recommendations", () => {
  it("renders the plan's real recommendations from the bridge", async () => {
    const listRecommendations = vi
      .spyOn(bridge, "listRecommendations")
      .mockResolvedValue([
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
      expect(
        screen.getByText("Tauri WebDriver E2E Automation")
      ).toBeInTheDocument()
    );

    expect(listRecommendations).toHaveBeenCalledWith("00021");
    expect(screen.getByText("Deep Link Protocol Handler")).toBeInTheDocument();
    expect(screen.getByText("Declined: Not now")).toBeInTheDocument();
    // A declined recommendation offers no further triage buttons.
    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(1);
  });

  it("shows an empty state when ExecutePlan registered no recommendations", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);

    renderReview();

    await waitFor(() =>
      expect(screen.getByTestId("no-recommendations")).toBeInTheDocument()
    );
  });

  it("reports a failure to load recommendations instead of showing none", async () => {
    vi.spyOn(bridge, "listRecommendations").mockRejectedValue(
      bridgeError({
        code: "DISCONNECTED",
        message: "Tendril service is not running",
        details: null,
      })
    );

    renderReview();

    await waitFor(() =>
      expect(screen.getByTestId("recommendations-error")).toHaveTextContent(
        /Tendril service is not running/
      )
    );
    expect(screen.queryByTestId("no-recommendations")).not.toBeInTheDocument();
  });

  it("persists an accept decision through the bridge and keeps it on success", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([
      recommendation(),
    ]);
    const setRecommendationState = vi
      .spyOn(bridge, "setRecommendationState")
      .mockResolvedValue(undefined);

    renderReview();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() =>
      expect(setRecommendationState).toHaveBeenCalledWith(
        "00021",
        "Tauri WebDriver E2E Automation",
        "Accepted",
        undefined
      )
    );
    await waitFor(() => expect(screen.getByText("Accepted")).toBeInTheDocument());
    expect(
      screen.queryByTestId("review-action-error")
    ).not.toBeInTheDocument();
  });

  it("rolls the decision back and reports why when the write is rejected", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([
      recommendation(),
    ]);
    vi.spyOn(bridge, "setRecommendationState").mockRejectedValue(bridgeError());

    renderReview();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() =>
      expect(screen.getByTestId("review-action-error")).toHaveTextContent(
        /Could not mark "Tauri WebDriver E2E Automation" as Accepted/
      )
    );
    // Rolled back: still Pending, so the triage buttons are still offered.
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.queryByText("Accepted")).not.toBeInTheDocument();
  });

  it("records a decline as Declined", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([
      recommendation(),
    ]);
    const setRecommendationState = vi
      .spyOn(bridge, "setRecommendationState")
      .mockResolvedValue(undefined);

    renderReview();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    await waitFor(() =>
      expect(setRecommendationState).toHaveBeenCalledWith(
        "00021",
        "Tauri WebDriver E2E Automation",
        "Declined",
        undefined
      )
    );
  });
});

describe("ReviewView lifecycle actions", () => {
  it("surfaces a Create PR failure rather than appearing to succeed", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    const onCreatePr = vi
      .fn()
      .mockRejectedValue(
        bridgeError({
          code: "START_JOB_FAILED",
          message: "Plan 00021 has a failing verification",
          details: null,
        })
      );

    renderReview({ onCreatePr });

    fireEvent.click(
      screen.getByRole("button", { name: /approve & create pr/i })
    );

    await waitFor(() =>
      expect(screen.getByTestId("review-action-error")).toHaveTextContent(
        /Create PR failed: Plan 00021 has a failing verification/
      )
    );
  });

  it("keeps the change request in the form when RetryPlan is refused", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    const onRetry = vi
      .fn()
      .mockRejectedValue(
        bridgeError({
          code: "DISCONNECTED",
          message: "Tendril service is not running",
          details: null,
        })
      );

    renderReview({ onRetry });

    fireEvent.click(
      screen.getByRole("button", { name: /request changes \(retry\)/i })
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Fix the failing clippy lint." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /submit change request/i })
    );

    await waitFor(() =>
      expect(screen.getByTestId("review-action-error")).toHaveTextContent(
        /Retry Plan failed/
      )
    );
    expect(onRetry).toHaveBeenCalledWith("00021", "Fix the failing clippy lint.");
    // The form stays open with the text intact so it can be resubmitted.
    expect(screen.getByRole("textbox")).toHaveValue(
      "Fix the failing clippy lint."
    );
  });

  it("clears the form once RetryPlan is accepted", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    const onRetry = vi.fn().mockResolvedValue(undefined);

    renderReview({ onRetry });

    fireEvent.click(
      screen.getByRole("button", { name: /request changes \(retry\)/i })
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Please rerun the verifications." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /submit change request/i })
    );

    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(
      screen.queryByTestId("review-action-error")
    ).not.toBeInTheDocument();
  });
});
