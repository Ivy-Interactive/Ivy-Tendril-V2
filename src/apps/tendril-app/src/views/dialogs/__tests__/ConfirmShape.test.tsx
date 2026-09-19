import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfirmDialog } from "../ConfirmDialog";
import { DeletePlanDialog } from "../DeletePlanDialog";
import { planDetail } from "../../../../tests/fixtures/plan.fixture";

/**
 * Framework's confirmation contract, asserted on the one component that implements it.
 *
 * `Ivy-Framework/src/Ivy/Views/Alerts/AlertExtensions.cs` (`WithConfirmView.Build`) builds every
 * confirmation in a Framework app as:
 *
 *   Dialog(onClose → cancel, DialogHeader(title), DialogBody(message),
 *          DialogFooter(Button("Cancel").Outline(), Button(confirmLabel).Destructive()))
 *
 * and `Ivy-Framework/src/frontend/src/widgets/dialogs/DialogWidget.tsx` supplies the two behaviours
 * the C# side cannot: Escape closes (Radix's `onOpenChange` → the dialog's `OnClose`), a click on
 * the overlay does not (`onInteractOutside` is prevented), and nothing is auto-focused unless it
 * asks to be — which no confirm button does.
 *
 * These are shape assertions on purpose: they fail if someone reorders the footer, restyles the
 * confirm, adds a second gate in front of it, or lets a stray click dismiss the question.
 */
function footerButtons(): HTMLButtonElement[] {
  const footer = screen.getByTestId("dialog-cancel").parentElement as HTMLElement;
  return [...footer.querySelectorAll("button")] as HTMLButtonElement[];
}

function Harness({
  onConfirm = vi.fn(),
  onClose,
}: {
  onConfirm?: () => void;
  onClose?: () => void;
}) {
  const [isOpen, setIsOpen] = React.useState(true);
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={() => {
        setIsOpen(false);
        onClose?.();
      }}
      title="Delete Plan"
      body={<p>Are you sure you want to permanently delete plan #00021?</p>}
      confirmLabel="Delete"
      confirmVariant="destructive"
      onConfirm={onConfirm}
    />
  );
}

describe("Framework's confirmation contract", () => {
  it("titles the dialog and states the question in the body", () => {
    render(<Harness />);

    expect(screen.getByRole("dialog")).toHaveAccessibleName("Delete Plan");
    expect(
      screen.getByText("Are you sure you want to permanently delete plan #00021?"),
    ).toBeInTheDocument();
  });

  it("puts exactly Cancel then the confirm in the footer, in that order", () => {
    render(<Harness />);

    expect(footerButtons().map((b) => b.textContent)).toEqual(["Cancel", "Delete"]);
  });

  it("styles Cancel as the outline decline and the confirm as destructive", () => {
    render(<Harness />);

    const [cancel, confirm] = footerButtons();
    expect(cancel).toHaveClass("border", "bg-background");
    expect(cancel).not.toHaveClass("bg-destructive");
    expect(confirm).toHaveClass("bg-destructive", "text-destructive-foreground");
  });

  it("labels the confirm with the verb rather than Framework's fallback Ok", () => {
    render(<Harness />);

    expect(screen.queryByRole("button", { name: "Ok" })).not.toBeInTheDocument();
    expect(screen.getByTestId("dialog-confirm")).toHaveTextContent("Delete");
  });

  it("arms the confirm on open, with nothing to type first", () => {
    render(<Harness />);

    expect(screen.getByTestId("dialog-confirm")).toBeEnabled();
    expect(screen.getByRole("dialog").querySelectorAll("input, textarea")).toHaveLength(0);
  });

  it("does not focus the destructive confirm", async () => {
    render(<Harness />);

    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("dialog-cancel")));
    expect(document.activeElement).not.toBe(screen.getByTestId("dialog-confirm"));
  });

  it("cancels on Escape, and Escape can never confirm", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<Harness onConfirm={onConfirm} onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  /**
   * `DialogWidget.tsx`: `onInteractOutside={(e) => e.preventDefault()}`. A click on the overlay is
   * not an answer — neither "yes" nor "no" — so the dialog stays up and waits for one.
   */
  it("does not dismiss on a click outside", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<Harness onConfirm={onConfirm} onClose={onClose} />);

    const dialog = screen.getByRole("dialog");
    fireEvent.pointerDown(document.body, { button: 0, ctrlKey: false });
    fireEvent.mouseDown(document.body, { button: 0, ctrlKey: false });
    fireEvent.click(document.body);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dialog).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms only on a click of the confirm button", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId("dialog-cancel"));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

/**
 * The plan delete is the one confirmation with more than two answers, because V1's has them
 * (`Apps/Plans/Dialogs/DeletePlanDialog.cs`) and they are the app's only writes of Skipped and
 * Icebox. It still has to read as Framework's shape: decline first, destructive last, and only the
 * destructive one styled as such.
 */
describe("the plan delete keeps Framework's shape with V1's alternatives", () => {
  it("declines first, destroys last, and styles only the delete destructively", () => {
    render(<DeletePlanDialog isOpen onClose={vi.fn()} plan={planDetail({ id: "00021" })} />);

    const buttons = footerButtons();
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Cancel",
      "Move to Skipped",
      "Move to Icebox",
      "Delete",
    ]);
    expect(buttons.filter((b) => b.className.includes("bg-destructive"))).toHaveLength(1);
    expect(buttons[3]).toHaveClass("bg-destructive");
  });
});
