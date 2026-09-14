import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecommendationNoteDialog } from "../src/components/RecommendationNoteDialog";
import { RecommendationCard, REC_STATUS_CLASS } from "../src/components/RecommendationCard";
import type { RecommendationItem } from "../src/types/api";

describe("RecommendationNoteDialog", () => {
  it("does not render when isOpen is false", () => {
    const { container } = render(
      <RecommendationNoteDialog
        isOpen={false}
        title="Test Rec"
        action="Accept"
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders with proper accessibility attributes and Accept labels", () => {
    render(
      <RecommendationNoteDialog
        isOpen={true}
        title="Automate Workflows"
        action="Accept"
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Accept Recommendation");
    expect(dialog).toHaveAttribute("data-testid", "recommendation-note-dialog");

    expect(screen.getByText("Accept Recommendation")).toBeInTheDocument();
    expect(screen.getByText("Automate Workflows")).toBeInTheDocument();
    expect(screen.getByText("Optional Operator Note:")).toBeInTheDocument();

    const textarea = screen.getByRole("textbox", { name: "Optional note" });
    expect(textarea).toHaveAttribute("id", "rec-dialog-note");

    const submitBtn = screen.getByRole("button", { name: "Submit" });
    expect(submitBtn.className).toContain("bg-emerald-600");
  });

  it("renders with Decline labels and red submit styling", () => {
    render(
      <RecommendationNoteDialog
        isOpen={true}
        title="Automate Workflows"
        action="Decline"
        onClose={() => {}}
        onSubmit={() => {}}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "Decline Recommendation");
    expect(screen.getByText("Decline Recommendation")).toBeInTheDocument();
    expect(screen.getByText("Decline Reason:")).toBeInTheDocument();

    const textarea = screen.getByRole("textbox", { name: "Decline reason" });
    expect(textarea).toHaveAttribute("id", "rec-dialog-note");

    const submitBtn = screen.getByRole("button", { name: "Submit" });
    expect(submitBtn.className).toContain("bg-red-600");
  });

  it("triggers onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(
      <RecommendationNoteDialog
        isOpen={true}
        title="Test Rec"
        action="Accept"
        onClose={onClose}
        onSubmit={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("submits undefined note when submitted with empty input", () => {
    const onSubmit = vi.fn();
    render(
      <RecommendationNoteDialog
        isOpen={true}
        title="Test Rec"
        action="Accept"
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).toHaveBeenCalledWith(undefined);
  });

  it("submits trimmed note when text is entered", () => {
    const onSubmit = vi.fn();
    render(
      <RecommendationNoteDialog
        isOpen={true}
        title="Test Rec"
        action="Accept"
        initialNote="Initial memo"
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveValue("Initial memo");

    fireEvent.change(textarea, { target: { value: "  Updated memo  " } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).toHaveBeenCalledWith("Updated memo");
  });
});

describe("RecommendationCard", () => {
  const baseRec: RecommendationItem = {
    title: "Support Dark Mode",
    description: "Implement dark theme palette.",
    impact: "High",
    state: "Pending",
  };

  it("renders card content, impact badge, and Pending status", () => {
    render(
      <RecommendationCard recommendation={baseRec} onAccept={() => {}} onDecline={() => {}} />,
    );

    expect(screen.getByTestId("recommendation-card-Support Dark Mode")).toBeInTheDocument();
    expect(screen.getByText("Support Dark Mode")).toBeInTheDocument();
    expect(screen.getByText("Implement dark theme palette.")).toBeInTheDocument();
    expect(screen.getByText("High impact")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toHaveClass(REC_STATUS_CLASS.Pending.split(" ")[0]);

    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });

  it("triggers onAccept and onDecline callbacks with recommendation title", () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();

    render(
      <RecommendationCard recommendation={baseRec} onAccept={onAccept} onDecline={onDecline} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onAccept).toHaveBeenCalledWith("Support Dark Mode");

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(onDecline).toHaveBeenCalledWith("Support Dark Mode");
  });

  it("disables buttons when disabled prop is true", () => {
    render(
      <RecommendationCard
        recommendation={baseRec}
        onAccept={() => {}}
        onDecline={() => {}}
        disabled={true}
      />,
    );

    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeDisabled();
  });

  it("renders notes for AcceptedWithNotes state and hides triage buttons", () => {
    const rec: RecommendationItem = {
      ...baseRec,
      state: "AcceptedWithNotes",
      declineReason: "Targeting v1.2 release",
    };

    render(<RecommendationCard recommendation={rec} onAccept={() => {}} onDecline={() => {}} />);

    expect(screen.getByText("AcceptedWithNotes")).toHaveClass(
      REC_STATUS_CLASS.AcceptedWithNotes.split(" ")[0],
    );
    expect(screen.getByText("Notes: Targeting v1.2 release")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
  });

  it("renders decline reason for Declined state and hides triage buttons", () => {
    const rec: RecommendationItem = {
      ...baseRec,
      state: "Declined",
      declineReason: "Not aligned with roadmap",
    };

    render(<RecommendationCard recommendation={rec} onAccept={() => {}} onDecline={() => {}} />);

    expect(screen.getByText("Declined")).toHaveClass(REC_STATUS_CLASS.Declined.split(" ")[0]);
    expect(screen.getByText("Decline reason: Not aligned with roadmap")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
  });
});
