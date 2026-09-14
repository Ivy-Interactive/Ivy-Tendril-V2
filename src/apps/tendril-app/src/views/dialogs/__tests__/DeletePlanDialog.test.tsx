import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DeletePlanDialog } from "../DeletePlanDialog";
import { bridge } from "../../../api/bridge";
import { planDetail } from "../../../../tests/fixtures/plan.fixture";

const plan = planDetail({ id: "00021", state: "Draft" });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DeletePlanDialog", () => {
  it("keeps the destructive confirm disabled until the plan id is typed", () => {
    render(<DeletePlanDialog isOpen onClose={vi.fn()} plan={plan} />);

    const confirm = screen.getByTestId("dialog-confirm");
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Confirm plan id"), { target: { value: "0002" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Confirm plan id"), { target: { value: "00021" } });
    expect(confirm).toBeEnabled();
  });

  it("deletes once, and only once, when confirmed", async () => {
    const deletePlan = vi.spyOn(bridge, "deletePlan").mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    const onClose = vi.fn();

    render(<DeletePlanDialog isOpen onClose={onClose} plan={plan} onDeleted={onDeleted} />);

    fireEvent.change(screen.getByLabelText("Confirm plan id"), { target: { value: "00021" } });
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => expect(deletePlan).toHaveBeenCalledTimes(1));
    expect(deletePlan).toHaveBeenCalledWith("00021");
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("00021"));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape without deleting anything", async () => {
    const deletePlan = vi.spyOn(bridge, "deletePlan").mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(<DeletePlanDialog isOpen onClose={onClose} plan={plan} />);

    fireEvent.change(screen.getByLabelText("Confirm plan id"), { target: { value: "00021" } });
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(deletePlan).not.toHaveBeenCalled();
  });

  it("archives to Icebox instead, without deleting", async () => {
    const deletePlan = vi.spyOn(bridge, "deletePlan").mockResolvedValue(undefined);
    const updateField = vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);
    const onArchived = vi.fn();

    render(<DeletePlanDialog isOpen onClose={vi.fn()} plan={plan} onArchived={onArchived} />);

    fireEvent.click(screen.getByTestId("dialog-archive"));

    await waitFor(() => expect(updateField).toHaveBeenCalledWith("00021", "state", "Icebox"));
    expect(deletePlan).not.toHaveBeenCalled();
    expect(onArchived).toHaveBeenCalledWith("00021");
  });

  it("stays open with the backend's message when the service refuses", async () => {
    vi.spyOn(bridge, "deletePlan").mockRejectedValue({
      code: "Conflict",
      message: "Plan 00021 is Executing and cannot be deleted",
    });
    const onDeleted = vi.fn();
    const onClose = vi.fn();

    render(<DeletePlanDialog isOpen onClose={onClose} plan={plan} onDeleted={onDeleted} />);

    fireEvent.change(screen.getByLabelText("Confirm plan id"), { target: { value: "00021" } });
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Plan 00021 is Executing and cannot be deleted",
      ),
    );
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
