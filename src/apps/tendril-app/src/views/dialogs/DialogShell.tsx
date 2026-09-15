import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ivy-interactive/components/ui";

export interface DialogShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  testId: string;
  /** Focused when the dialog opens. Never the destructive confirm. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  footer: React.ReactNode;
  children?: React.ReactNode;
  /** Overrides the accessible name Radix would otherwise derive from `title` via `aria-labelledby`. */
  ariaLabel?: string;
}

/**
 * The wrapper every lifecycle dialog composes, so the accessibility contract is
 * implemented once instead of per dialog:
 *
 * 1. Focus moves into the dialog on open, onto `initialFocusRef` — which every
 *    confirm dialog points at *Cancel*. Radix's default is "first tabbable
 *    node", which would land on the header close button, or in a body-less
 *    dialog could reach the confirm. A focused destructive button turns a stray
 *    Enter into a deletion.
 * 2. Focus returns to whatever opened the dialog on close. Radix restores to a
 *    `DialogTrigger`, but these dialogs open from controlled state, so the
 *    invoker is captured and restored explicitly.
 * 3. Escape cancels, via Radix's `onOpenChange(false)`. It must never confirm.
 * 4. `role="dialog"`/`aria-modal` come from Radix; a `DialogTitle` is always
 *    rendered, since Radix warns without one.
 */
export function DialogShell({
  isOpen,
  onClose,
  title,
  description,
  testId,
  initialFocusRef,
  footer,
  children,
  ariaLabel,
}: DialogShellProps) {
  const invokerRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      invokerRef.current = document.activeElement as HTMLElement | null;
    }
  }, [isOpen]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid={testId}
        // Radix gives `role="dialog"` and hides the rest of the tree with
        // `aria-hidden`, but this version emits no `aria-modal`, so it is set
        // here. A dialog with only one of the two reads as inert markup to some
        // screen readers.
        aria-modal="true"
        // Radix points `aria-describedby` at a `DialogDescription` it assumes is
        // there, and warns when it is not. A dialog with no `description` has
        // nothing to describe it, so the attribute is dropped deliberately —
        // which is also how Radix asks to be told the omission is intended.
        {...(description === undefined ? { "aria-describedby": undefined } : {})}
        {...(ariaLabel !== undefined ? { "aria-label": ariaLabel } : {})}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const target = initialFocusRef?.current ?? (event.currentTarget as HTMLElement | null);
          target?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          invokerRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description !== undefined && (
            <DialogDescription className="mt-1">{description}</DialogDescription>
          )}
        </DialogHeader>
        {children !== undefined && (
          <div className="flex-1 overflow-y-auto px-6 pb-2 text-sm text-foreground">{children}</div>
        )}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
