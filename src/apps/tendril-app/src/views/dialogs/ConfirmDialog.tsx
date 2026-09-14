import * as React from "react";
import { Button } from "@ivy-interactive/components/ui";
import { DialogShell } from "./DialogShell";

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
}: ConfirmDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const bodyId = React.useId();

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      testId={testId}
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
        <div
          role="alert"
          className="mt-4 rounded-box border border-destructive/50 bg-destructive/10 p-3 text-sm text-foreground"
        >
          {error}
        </div>
      )}
    </DialogShell>
  );
}
