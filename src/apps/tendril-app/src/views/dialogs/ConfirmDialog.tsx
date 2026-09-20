import * as React from "react";
import { Button, Callout } from "@ivy-interactive/components/ui";
import { DialogShell } from "./DialogShell";
import { type DialogWidth } from "./fieldStyles";

export type ConfirmVariant = "destructive" | "warning" | "primary";

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** The consequence, in plain words. The confirm button is described by it. */
  body: React.ReactNode;
  confirmLabel: string;
  confirmVariant?: ConfirmVariant;
  onConfirm: () => void | Promise<void>;
  isBusy?: boolean;
  /** A backend rejection, shown where the operator pressed the button. */
  error?: string | null;
  confirmDisabled?: boolean;
  /** A non-destructive alternative, rendered between Cancel and the confirm. */
  secondaryAction?: React.ReactNode;
  testId?: string;
  /** Extra controls below the body, e.g. the delete confirmation field. */
  children?: React.ReactNode;
  /** V1's `.Width(Size.Rem(n))`; most of V1's confirm dialogs pass none and take Ivy's own. */
  width?: DialogWidth;
}

const VARIANT_CLASS: Record<ConfirmVariant, "destructive" | "warning" | "default"> = {
  destructive: "destructive",
  warning: "warning",
  primary: "default",
};

/**
 * The shared body of the confirm-only dialogs, and the app's single implementation of
 * Framework's confirmation contract.
 *
 * Framework asks for a confirmation with `Button.WithConfirm(message, title, confirmLabel,
 * destructive)` (`Ivy-Framework/src/Ivy/Views/Alerts/AlertExtensions.cs`), which builds:
 *
 *   Dialog(onClose → cancel, DialogHeader(title), DialogBody(message),
 *          DialogFooter(Button("Cancel").Outline(), Button(confirmLabel).Destructive()))
 *
 * so the contract this component implements is, point for point:
 *
 * 1. A modal dialog with a **title**, a one-question **body**, and a footer of exactly two roles —
 *    decline and confirm.
 * 2. **Cancel first**, `variant="outline"`. It is the leftmost control in the footer's DOM order,
 *    which is also its reading order (`DialogFooter` is `sm:flex-row sm:justify-end`).
 * 3. **Confirm last**, `variant="destructive"` when the action destroys something. The label is the
 *    verb, never "Ok" — Framework's default label is only a fallback its own call sites all replace
 *    (`WithConfirm(..., confirmLabel: "Delete", destructive: true)`).
 * 4. **Nothing to type.** Framework's confirm is armed the moment the dialog opens; there is no
 *    typed-name gate anywhere in it, and none here.
 * 5. **Escape cancels** and can never confirm; a click on the overlay does not dismiss at all. Both
 *    live in `DialogShell`, which is where Framework puts them too (`DialogWidget.tsx`).
 * 6. **The destructive button is not focused on open.** Framework prevents Radix's auto-focus
 *    outright unless a control opts in with `[autofocus]`, and its confirm buttons never do. Focus
 *    here goes to Cancel instead of nowhere, which is the same guarantee with a keyboard user
 *    actually inside the dialog: a stray Enter declines.
 *
 * Point 6 is also where V1 differs — it puts `.ShortcutKey("Enter").AutoFocus()` on the destructive
 * button of every one of these dialogs. Framework's rule wins: a delete that happens because a
 * keystroke arrived a moment late is not recoverable.
 *
 * 7. **Ctrl/Cmd+Enter confirms**, via `DialogShell`'s `shortcut` — the same declaration the seven
 *    form dialogs already carry (`UpdatePlanDialog`, `CreatePrDialog`, `CreateIssueDialog`, …), so
 *    the chord means "fire this dialog's primary action" everywhere rather than in one place.
 *
 *    This is the keyboard half of V1's `.ShortcutKey(...)` restored under the modifier, and it is
 *    what closes the Backspace flow: `PlanDetailView`/`ReviewView` bind Backspace to open the delete
 *    confirm, and until now the only way to answer it was the mouse or three Tab presses past
 *    Cancel, Skipped and Icebox.
 *
 *    It does **not** reopen the hazard point 6 exists for. That hazard is a *bare* Enter landing on
 *    an auto-focused destructive button; focus still goes to Cancel, bare Enter there still
 *    declines, and a two-key chord pressed inside an open modal is a deliberate answer, not a
 *    keystroke that arrived late. `onShortcut` is withheld entirely while the confirm is disabled or
 *    busy, so the chord can never submit what the button itself refuses.
 *
 * `secondaryAction` is the one addition to the two-button footer, for V1's Delete Plan, whose
 * alternatives are the *reversible* answers and are read before the destructive one.
 */
export function ConfirmDialog({
  isOpen,
  onClose,
  title,
  body,
  confirmLabel,
  confirmVariant = "primary",
  onConfirm,
  isBusy = false,
  error = null,
  confirmDisabled = false,
  secondaryAction,
  testId = "confirm-dialog",
  children,
  width = "default",
}: ConfirmDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const bodyId = React.useId();

  // The exact condition on the confirm button below, so the chord and the click can never disagree.
  // `JobsView`'s clear-jobs confirm is the live case: it renders with `confirmDisabled` while the
  // scope it would clear is empty, and a shortcut that ignored that would dispatch the clear the
  // button is refusing.
  const confirmArmed = !isBusy && !confirmDisabled;

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      testId={testId}
      width={width}
      initialFocusRef={cancelRef}
      shortcut="Ctrl+Enter"
      onShortcut={confirmArmed ? () => void onConfirm() : undefined}
      footer={
        <>
          <Button
            ref={cancelRef}
            variant="outline"
            onClick={onClose}
            data-testid="dialog-cancel"
            disabled={isBusy}
          >
            Cancel
          </Button>
          {secondaryAction}
          <Button
            variant={VARIANT_CLASS[confirmVariant]}
            onClick={() => void onConfirm()}
            data-testid="dialog-confirm"
            aria-describedby={bodyId}
            disabled={isBusy || confirmDisabled}
          >
            {isBusy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div id={bodyId} className="space-y-3">
        {body}
      </div>
      {children}
      {error && <Callout.Error className="mt-4">{error}</Callout.Error>}
    </DialogShell>
  );
}
