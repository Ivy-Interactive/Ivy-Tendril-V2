import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfirmDialog } from "@ivy-interactive/components/dialogs";
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

/**
 * The footer's buttons by the names a screen reader announces, which is what the order-and-labels
 * assertions below have always meant.
 *
 * They read `textContent` until the confirm grew its `Ctrl+Enter` key cap. The cap is `aria-hidden`
 * and so absent from the accessible name, but `textContent` sees straight through `aria-hidden` and
 * reported "DeleteCtrl↵" — a change in decoration failing an assertion about labelling. Reading the
 * computed name instead asserts the thing the contract actually cares about (point 3: "the label is
 * the verb") and stays true whatever hint rides along with it.
 */
function footerButtonNames(): (string | null)[] {
  return footerButtons().map((button) => button.getAttribute("aria-label") ?? computeName(button));
}

/**
 * The accessible name of a button whose only contributors are text nodes and `aria-hidden`
 * subtrees, which is every footer button here. `getByRole(..., { name })` is the usual way to ask,
 * but these tests assert the *order* of the whole row, so the name has to be read off each element.
 */
function computeName(button: HTMLElement): string {
  return [...button.childNodes]
    .filter((node) => !(node instanceof HTMLElement && node.getAttribute("aria-hidden") === "true"))
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();
}

function Harness({
  onConfirm = vi.fn(),
  onClose,
  confirmDisabled,
  isBusy,
}: {
  onConfirm?: () => void;
  onClose?: () => void;
  confirmDisabled?: boolean;
  isBusy?: boolean;
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
      confirmDisabled={confirmDisabled}
      isBusy={isBusy}
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

    expect(footerButtonNames()).toEqual(["Cancel", "Delete"]);
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
    expect(footerButtonNames()).toEqual(["Cancel", "Move to Skipped", "Move to Icebox", "Delete"]);
    expect(buttons.filter((b) => b.className.includes("bg-destructive"))).toHaveLength(1);
    expect(buttons[3]).toHaveClass("bg-destructive");
  });
});

/**
 * Point 7 of the contract, asserted on `ConfirmDialog` itself because that is where it is bound: the
 * chord belongs to every confirm dialog in the app, not to the plan delete that prompted it.
 *
 * `DialogShell` reads `event.ctrlKey || event.metaKey`, so Cmd and Ctrl are both the chord on both
 * platforms; the tests fire each one rather than stubbing `navigator` per platform. The keydown goes
 * to the dialog element because that is where `onKeyDown` lives and where a real press inside the
 * focus trap bubbles from.
 */
describe("Ctrl/Cmd+Enter confirms", () => {
  it("fires the primary action on Cmd+Enter", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", metaKey: true });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("fires the primary action on Ctrl+Enter", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", ctrlKey: true });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  /**
   * Point 6's hazard is a bare Enter reaching the destructive button, and the modifier is what keeps
   * the two apart: with focus parked on Cancel, an unmodified Enter is a decline.
   */
  it("ignores a bare Enter, so the chord and a stray keystroke stay different things", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  /**
   * `JobsView`'s clear-jobs confirm renders disabled while its scope is empty. A shortcut that
   * bypassed `confirmDisabled` would submit exactly what the button is refusing.
   */
  it("is inert while the primary action is disabled", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} confirmDisabled />);

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Enter", metaKey: true });
    fireEvent.keyDown(dialog, { key: "Enter", ctrlKey: true });

    expect(screen.getByTestId("dialog-confirm")).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  /** The in-flight case: the button reads "Working…" and is disabled, so the chord must be too. */
  it("is inert while the dialog is busy, so a second press cannot double-submit", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} isBusy />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", metaKey: true });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  /** An auto-repeat from a held chord is one press, not a stream of confirmations. */
  it("ignores auto-repeat", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Enter", metaKey: true });
    fireEvent.keyDown(dialog, { key: "Enter", metaKey: true, repeat: true });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  /** Point 5 is unchanged: adding a confirm chord must not turn Escape into anything but a cancel. */
  it("leaves Escape as the cancel", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<Harness onConfirm={onConfirm} onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

/**
 * Point 8: the chord is *visible*. Point 7 bound the key and rendered nothing, which made the whole
 * affordance discoverable only by reading `ConfirmDialog.tsx` — the complaint that prompted this.
 *
 * The cap must track `confirmArmed` exactly, in both directions. Rendered while the chord is
 * withheld it advertises a dead key; withheld while the chord is live it is the bug these tests
 * exist to prevent coming back.
 */
function confirmHint(): HTMLElement | null {
  return screen.getByTestId("dialog-confirm").querySelector(".tui-kbd");
}

describe("the Ctrl/Cmd+Enter chord is advertised on the confirm", () => {
  it("renders a key cap inside the confirm button", () => {
    render(<Harness />);

    expect(confirmHint()).not.toBeNull();
  });

  /**
   * The reason `TuiKbd` is the primitive here and `ShortcutKeys`/`Kbd` is not: the cap decorates the
   * button without joining its name, so point 3's "the label is the verb" survives and every
   * `getByRole("button", { name })` in the suite keeps resolving.
   */
  it("keeps the cap out of the button's accessible name", () => {
    render(<Harness />);

    expect(confirmHint()).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Delete" })).toBe(
      screen.getByTestId("dialog-confirm"),
    );
  });

  /** `JobsView`'s clear-jobs confirm renders disabled with an empty scope; the cap must go with it. */
  it("shows no cap while the primary action is disabled", () => {
    render(<Harness confirmDisabled />);

    expect(screen.getByTestId("dialog-confirm")).toBeDisabled();
    expect(confirmHint()).toBeNull();
  });

  it("shows no cap while the dialog is busy", () => {
    render(<Harness isBusy />);

    expect(confirmHint()).toBeNull();
  });
});
