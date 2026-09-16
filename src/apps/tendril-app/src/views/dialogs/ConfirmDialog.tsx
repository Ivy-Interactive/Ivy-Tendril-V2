import * as React from "react";
import { Button } from "@ivy-interactive/components/ui";
import { DialogShell } from "./DialogShell";
import { ALERT_CLASS, type DialogWidth } from "./fieldStyles";

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
 * The shared body of the confirm-only dialogs.
 *
 * Cancel is rendered **first** and holds the initial focus: the destructive
 * confirm is never the default-focused control, so a stray Enter cannot carry
 * out the action.
 *
 * That is a deliberate departure from V1, which puts `.ShortcutKey("Enter").AutoFocus()` on the
 * destructive button of every one of these dialogs (Delete Plan, Discard, Reset to Draft, Delete
 * Job, Stop All). Everything else here is V1's — the button order, the outline Cancel, the
 * destructive treatment, the copy — but a delete that happens because a keystroke arrived a moment
 * late is not recoverable, and the confirm has no keyboard path to it that Cancel is not on first.
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

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      testId={testId}
      width={width}
      initialFocusRef={cancelRef}
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
      {error && (
        <div role="alert" className={ALERT_CLASS}>
          {error}
        </div>
      )}
    </DialogShell>
  );
}
