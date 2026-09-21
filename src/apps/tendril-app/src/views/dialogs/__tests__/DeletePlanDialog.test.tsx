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
  /**
   * Framework's `WithConfirm` arms its confirm the moment the dialog opens and has no typed-name
   * affordance at all. V2 used to gate this one delete behind typing the plan id, which made it the
   * only delete in the app with a second ritual.
   */
  it("asks for nothing to be typed, and the confirm is live on open", () => {
    render(<DeletePlanDialog isOpen onClose={vi.fn()} plan={plan} />);

    expect(screen.getByTestId("dialog-confirm")).toBeEnabled();
    expect(screen.queryByLabelText("Confirm plan id")).not.toBeInTheDocument();
    expect(screen.getByTestId("delete-plan-dialog").querySelector("input")).toBeNull();
  });

  it("deletes once, and only once, when confirmed", async () => {
    const deletePlan = vi.spyOn(bridge, "deletePlan").mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    const onClose = vi.fn();

    render(<DeletePlanDialog isOpen onClose={onClose} plan={plan} onDeleted={onDeleted} />);

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

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(deletePlan).not.toHaveBeenCalled();
  });

  /**
   * V1 offers both states that keep the folder, in this order, before the delete that does not, and
   * Framework's contract puts the decline first and the destructive answer last.
   */
  it("offers Skipped and Icebox between Cancel and the delete", () => {
    render(<DeletePlanDialog isOpen onClose={vi.fn()} plan={plan} />);

    const footer = screen.getByTestId("dialog-cancel").parentElement as HTMLElement;
    // Accessible names, not `textContent`: the confirm carries a `DialogShortcutHint` key cap, and
    // that cap is `aria-hidden` precisely so it decorates the button without joining its name. Reading
    // raw text here would assert "DeleteCtrl\u21b5" and turn every future affordance into a failure in a
    // test about footer *order*.
    const buttons = [...footer.querySelectorAll("button")];
    expect(buttons).toHaveLength(4);
    ["Cancel", "Move to Skipped", "Move to Icebox", "Delete"].forEach((name, i) =>
      expect(buttons[i]).toHaveAccessibleName(name),
    );
  });

  it("moves the plan to Skipped instead, without deleting", async () => {
    const deletePlan = vi.spyOn(bridge, "deletePlan").mockResolvedValue(undefined);
    const updateField = vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);
    const onSkipped = vi.fn();

    render(<DeletePlanDialog isOpen onClose={vi.fn()} plan={plan} onSkipped={onSkipped} />);

    fireEvent.click(screen.getByTestId("dialog-skip"));

    // Four arguments because the write goes through `plansStore.transitionPlanOptimistic`, which
    // passes `allowFailedVerifications` on for the callers that set it (`PartialDeliveryDialog`).
    await waitFor(() =>
      expect(updateField).toHaveBeenCalledWith("00021", "state", "Skipped", undefined),
    );
    expect(deletePlan).not.toHaveBeenCalled();
    expect(onSkipped).toHaveBeenCalledWith("00021");
  });

  it("moves the plan to Icebox instead, without deleting", async () => {
    const deletePlan = vi.spyOn(bridge, "deletePlan").mockResolvedValue(undefined);
    const updateField = vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);
    const onArchived = vi.fn();

    render(<DeletePlanDialog isOpen onClose={vi.fn()} plan={plan} onArchived={onArchived} />);

    fireEvent.click(screen.getByTestId("dialog-archive"));

    await waitFor(() =>
      expect(updateField).toHaveBeenCalledWith("00021", "state", "Icebox", undefined),
    );
    expect(deletePlan).not.toHaveBeenCalled();
    expect(onArchived).toHaveBeenCalledWith("00021");
  });

  /**
   * The keyboard-only delete: `PlanDetailView`/`ReviewView` bind Backspace to open this dialog, and
   * the chord is what answers it. Before this the only way out of the dialog with the keyboard was
   * three Tab presses past Cancel, Skipped and Icebox, or Escape.
   *
   * The chord deletes rather than picking one of the two alternatives: Delete is the dialog's
   * primary action, and Skipped/Icebox are `secondaryAction`s with no shortcut of their own.
   */
  it.each([
    ["Cmd+Enter", { key: "Enter", metaKey: true }],
    ["Ctrl+Enter", { key: "Enter", ctrlKey: true }],
  ])("deletes on %s, completing the Backspace flow", async (_label, event) => {
    const deletePlan = vi.spyOn(bridge, "deletePlan").mockResolvedValue(undefined);
    const updateField = vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);
    const onDeleted = vi.fn();

    render(<DeletePlanDialog isOpen onClose={vi.fn()} plan={plan} onDeleted={onDeleted} />);

    fireEvent.keyDown(screen.getByRole("dialog"), event);

    await waitFor(() => expect(deletePlan).toHaveBeenCalledWith("00021"));
    expect(deletePlan).toHaveBeenCalledTimes(1);
    expect(updateField).not.toHaveBeenCalled();
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("00021"));
  });

  it("stays open with the backend's message when the service refuses", async () => {
    vi.spyOn(bridge, "deletePlan").mockRejectedValue({
      code: "Conflict",
      message: "Plan 00021 is Executing and cannot be deleted",
    });
    const onDeleted = vi.fn();
    const onClose = vi.fn();

    render(<DeletePlanDialog isOpen onClose={onClose} plan={plan} onDeleted={onDeleted} />);

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
