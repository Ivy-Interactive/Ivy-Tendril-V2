import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SuggestChangesDialog } from "../SuggestChangesDialog";
import { bridge } from "../../../api/bridge";
import { planSummary } from "../../../../tests/fixtures/plan.fixture";

const plan = planSummary({ id: "00021", state: "Review" });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SuggestChangesDialog", () => {
  it("keeps submit disabled while the change request is empty or blank", () => {
    render(<SuggestChangesDialog isOpen onClose={vi.fn()} plan={plan} />);

    const confirm = screen.getByTestId("dialog-confirm");
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Change request"), { target: { value: "   " } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Change request"), {
      target: { value: "Fix the guard" },
    });
    expect(confirm).toBeEnabled();
  });

  it("carries the typed text into the job as changeRequest", async () => {
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "03007", status: "Queued" });
    const onJobStarted = vi.fn();

    render(
      <SuggestChangesDialog isOpen onClose={vi.fn()} plan={plan} onJobStarted={onJobStarted} />,
    );

    fireEvent.change(screen.getByLabelText("Change request"), {
      target: { value: "  The dirty-repo guard lists the wrong repos.  " },
    });
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(startJob).toHaveBeenCalledWith({
        type: "RetryPlan",
        folderPath: "00021",
        changeRequest: "The dirty-repo guard lists the wrong repos.",
      }),
    );
    await waitFor(() =>
      expect(onJobStarted).toHaveBeenCalledWith({ jobId: "03007", status: "Queued" }),
    );
  });

  it("never dispatches the canned change request the views used to hard-code", async () => {
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "03007", status: "Queued" });

    render(<SuggestChangesDialog isOpen onClose={vi.fn()} plan={plan} />);

    fireEvent.change(screen.getByLabelText("Change request"), {
      target: { value: "Reword the delete confirmation." },
    });
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => expect(startJob).toHaveBeenCalled());
    expect(startJob.mock.calls[0][0]).not.toMatchObject({
      changeRequest: "Please resolve failing issues.",
    });
  });

  it("surfaces a rejection and stays open", async () => {
    vi.spyOn(bridge, "startJob").mockRejectedValue(new Error("Service unavailable"));
    const onClose = vi.fn();

    render(<SuggestChangesDialog isOpen onClose={onClose} plan={plan} />);

    fireEvent.change(screen.getByLabelText("Change request"), { target: { value: "Retry it" } });
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Service unavailable"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
