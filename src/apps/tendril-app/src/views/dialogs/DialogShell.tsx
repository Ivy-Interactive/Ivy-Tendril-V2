import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ivy-interactive/components/ui";
import { DIALOG_WIDTH, type DialogWidth } from "./fieldStyles";

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
  /** V1's `.Width(Size.Rem(n))` on the `Dialog`; `default` is Ivy's own width. */
  width?: DialogWidth;
  /**
   * V1's `.ShortcutKey(...)` on the primary footer button, and `onShortcut` is that button's click.
   *
   * `Ctrl+Enter` is honoured everywhere in the dialog, a multi-line field included — that modifier is
   * why V1 puts it on the dialogs that have one. Bare `Enter` is ignored while a `textarea` or a
   * button holds focus: a newline is what Enter means in the first, and the second already fires its
   * own click, which would submit twice.
   */
  shortcut?: "Enter" | "Ctrl+Enter";
  onShortcut?: () => void;
  /**
   * Extra classes on the footer row. `flex-wrap` is the port of V1's `Layout.Wrap()`, which the
   * dialogs carrying three or four choices use so the last one does not fall off a narrow window.
   */
  footerClassName?: string;
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
 * 5. `shortcut` is the keyboard half of V1's primary footer button, gated so it
 *    can only ever fire the *non*-destructive action a dialog nominates.
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
  width = "default",
  shortcut,
  onShortcut,
  footerClassName,
}: DialogShellProps) {
  const invokerRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      invokerRef.current = document.activeElement as HTMLElement | null;
    }
  }, [isOpen]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || onShortcut === undefined) return;

    const wantsModifier = shortcut === "Ctrl+Enter";
    const hasModifier = event.ctrlKey || event.metaKey;
    if (wantsModifier !== hasModifier) return;

    if (!wantsModifier) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "TEXTAREA" || tag === "BUTTON") return;
    }

    event.preventDefault();
    onShortcut();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid={testId}
        className={DIALOG_WIDTH[width]}
        onKeyDown={handleKeyDown}
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
        <DialogFooter className={footerClassName}>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
