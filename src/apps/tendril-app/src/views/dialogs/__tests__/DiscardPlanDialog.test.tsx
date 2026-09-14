import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DiscardPlanDialog } from "../DiscardPlanDialog";
import { bridge } from "../../../api/bridge";
import { planSummary } from "../../../../tests/fixtures/plan.fixture";

const plan = planSummary({ id: "00021", state: "Review" });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DiscardPlanDialog", () => {
  it("calls nothing before the operator confirms", () => {
    const updateField = vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);

    render(<DiscardPlanDialog isOpen onClose={vi.fn()} plan={plan} />);

    expect(screen.getByTestId("discard-plan-dialog")).toBeInTheDocument();
    expect(updateField).not.toHaveBeenCalled();
  });

  it("moves the plan to Skipped on confirmation", async () => {
    const updateField = vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);
    const onDiscarded = vi.fn();

    render(<DiscardPlanDialog isOpen onClose={vi.fn()} plan={plan} onDiscarded={onDiscarded} />);

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => expect(updateField).toHaveBeenCalledWith("00021", "state", "Skipped"));
    expect(updateField).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onDiscarded).toHaveBeenCalledWith("00021"));
  });

  it("does not discard on Escape", async () => {
    const updateField = vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(<DiscardPlanDialog isOpen onClose={onClose} plan={plan} />);
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(updateField).not.toHaveBeenCalled();
  });
});
