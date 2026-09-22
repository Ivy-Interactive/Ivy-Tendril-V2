import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfirmDialog } from "@ivy-interactive/components/dialogs";

/**
 * The accessibility contract lives in `DialogShell`, so it is asserted once here
 * rather than per dialog. `ConfirmDialog` is the vehicle: it is the composition
 * every destructive dialog uses, and the one where a default-focused confirm
 * would do real damage.
 *
 * Radix portals `DialogContent` into `document.body`, so every query goes through
 * `screen` rather than the `render` container.
 */
function Harness({ onConfirm = vi.fn() }: { onConfirm?: () => void }) {
  const [isOpen, setIsOpen] = React.useState(false);
  return (
    <>
      <button type="button" data-testid="invoker" onClick={() => setIsOpen(true)}>
        Open
      </button>
      <ConfirmDialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Delete everything?"
        body={<p>This cannot be undone.</p>}
        confirmLabel="Delete Permanently"
        confirmVariant="destructive"
        onConfirm={onConfirm}
      />
    </>
  );
}

describe("DialogShell accessibility contract", () => {
  it("is a modal dialog with an accessible name", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("invoker"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Delete everything?")).toBeInTheDocument();
  });

  it("moves focus into the dialog on open, onto Cancel rather than the destructive confirm", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("invoker"));

    const dialog = await screen.findByRole("dialog");
    const cancel = screen.getByTestId("dialog-cancel");
    const confirm = screen.getByTestId("dialog-confirm");

    await waitFor(() => expect(document.activeElement).toBe(cancel));
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(confirm);
  });

  it("returns focus to the invoker on close", async () => {
    render(<Harness />);
    const invoker = screen.getByTestId("invoker");

    invoker.focus();
    fireEvent.click(invoker);
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByTestId("dialog-cancel"));

    await waitFor(() => expect(document.activeElement).toBe(invoker));
  });

  it("cancels on Escape and never confirms", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByTestId("invoker"));
    await screen.findByRole("dialog");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("associates the confirm button with the body text", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("invoker"));
    await screen.findByRole("dialog");

    const describedBy = screen.getByTestId("dialog-confirm").getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      "This cannot be undone.",
    );
  });

  it("leaves the body interactive again once closed", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("invoker"));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByTestId("dialog-cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Radix sets pointer-events: none on body while a modal is open; a dialog
    // that leaks it makes the whole app unclickable.
    expect(document.body.style.pointerEvents).not.toBe("none");
  });
});
