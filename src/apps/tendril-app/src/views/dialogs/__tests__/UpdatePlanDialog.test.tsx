import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UpdatePlanDialog } from "../UpdatePlanDialog";
import { bridge } from "../../../api/bridge";
import { planSummary } from "../../../../tests/fixtures/plan.fixture";
import { job } from "../../../../tests/fixtures/job.fixture";

const plan = planSummary({ id: "00021", state: "Draft" });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UpdatePlanDialog", () => {
  it("carries the instructions into the job", async () => {
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "03007", status: "Queued" });

    render(<UpdatePlanDialog isOpen onClose={vi.fn()} plan={plan} />);

    fireEvent.change(screen.getByLabelText("Update instructions"), {
      target: { value: "  Narrow the scope to the guard chain.  " },
    });
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(startJob).toHaveBeenCalledWith({
        type: "UpdatePlan",
        folderPath: "00021",
        instructions: "Narrow the scope to the guard chain.",
      }),
    );
  });

  /**
   * V1's `hasActiveJob` check, which warns and makes the submit a no-op: a second UpdatePlan on the
   * same folder is refused by the service, so the dialog says so before the round trip.
   */
  it("warns and refuses to submit while an UpdatePlan is already in flight", () => {
    const startJob = vi.spyOn(bridge, "startJob");

    render(
      <UpdatePlanDialog
        isOpen
        onClose={vi.fn()}
        plan={plan}
        planJobs={[job({ id: "00158", type: "UpdatePlan", planId: "00021", status: "Running" })]}
      />,
    );

    expect(screen.getByTestId("update-plan-already-running")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Update instructions"), {
      target: { value: "Fold in the answers" },
    });
    expect(screen.getByTestId("dialog-confirm")).toBeDisabled();
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    expect(startJob).not.toHaveBeenCalled();
  });

  it("does not mistake another plan's UpdatePlan, or a finished one, for this plan's", () => {
    render(
      <UpdatePlanDialog
        isOpen
        onClose={vi.fn()}
        plan={plan}
        planJobs={[
          job({ id: "00158", type: "UpdatePlan", planId: "00022", status: "Running" }),
          job({ id: "00159", type: "UpdatePlan", planId: "00021", status: "Completed" }),
          job({ id: "00160", type: "ExecutePlan", planId: "00021", status: "Running" }),
        ]}
      />,
    );

    expect(screen.queryByTestId("update-plan-already-running")).not.toBeInTheDocument();
  });

  it("submits on Ctrl+Enter, which is the shortcut V1 puts on this dialog's primary", async () => {
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "03007", status: "Queued" });

    render(<UpdatePlanDialog isOpen onClose={vi.fn()} plan={plan} />);

    const field = screen.getByLabelText("Update instructions");
    fireEvent.change(field, { target: { value: "Fold in the answers" } });
    // Bare Enter is a newline in a textarea and must not submit.
    fireEvent.keyDown(field, { key: "Enter" });
    expect(startJob).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(startJob).toHaveBeenCalledTimes(1));
  });
});
