import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ResetToDraftDialog } from "../ResetToDraftDialog";
import { bridge } from "../../../api/bridge";
import { planSummary } from "../../../../tests/fixtures/plan.fixture";

const plan = planSummary({ id: "00021", state: "Failed" });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ResetToDraftDialog", () => {
  it("calls nothing before the operator confirms", () => {
    const resetPlan = vi.spyOn(bridge, "resetPlan").mockResolvedValue(undefined);

    render(<ResetToDraftDialog isOpen onClose={vi.fn()} plan={plan} />);

    expect(screen.getByTestId("reset-to-draft-dialog")).toBeInTheDocument();
    expect(resetPlan).not.toHaveBeenCalled();
  });

  it("resets state and worktrees in one request on confirmation", async () => {
    const resetPlan = vi.spyOn(bridge, "resetPlan").mockResolvedValue(undefined);
    const onReset = vi.fn();

    render(<ResetToDraftDialog isOpen onClose={vi.fn()} plan={plan} onReset={onReset} />);

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => expect(resetPlan).toHaveBeenCalledWith("00021"));
    expect(resetPlan).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onReset).toHaveBeenCalledWith("00021"));
  });

  it("does not reset on Escape", async () => {
    const resetPlan = vi.spyOn(bridge, "resetPlan").mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(<ResetToDraftDialog isOpen onClose={onClose} plan={plan} />);
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(resetPlan).not.toHaveBeenCalled();
  });
});
