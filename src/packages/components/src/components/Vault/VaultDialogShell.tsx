import React from "react";
import { Button, type ButtonProps } from "../ui/button/button";
import { Callout } from "../ui/callout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export interface VaultDialogShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  testId: string;
  /** A failed request: rendered inline so the dialog can stay open with the user's input intact. */
  error?: string | null;
  submitLabel: string;
  submitDisabled?: boolean;
  submitVariant?: ButtonProps["variant"];
  /** Leading icon on the confirm button, matching the icon the original puts on it. */
  submitIcon?: React.ReactNode;
  onSubmit: () => void;
  children?: React.ReactNode;
}

/**
 * The frame every vault dialog shares: title, scrollable body, inline error, Cancel + one primary
 * action. Escape and the header close button cancel; submitting is always an explicit click, and a
 * server error never discards what was typed.
 *
 * Focus is moved onto the dialog itself rather than its first tabbable node, so opening a dialog
 * never lands on a destructive confirm.
 */
export const VaultDialogShell: React.FC<VaultDialogShellProps> = ({
  open,
  onClose,
  title,
  description,
  testId,
  error,
  submitLabel,
  submitDisabled = false,
  submitVariant,
  submitIcon,
  onSubmit,
  children,
}) => (
  <Dialog
    open={open}
    onOpenChange={(next) => {
      if (!next) onClose();
    }}
  >
    <DialogContent
      data-testid={testId}
      aria-modal="true"
      {...(description === undefined ? { "aria-describedby": undefined } : {})}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        (event.currentTarget as HTMLElement | null)?.focus();
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description !== undefined && (
          <DialogDescription className="mt-1">{description}</DialogDescription>
        )}
      </DialogHeader>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-2 text-sm text-foreground">
        {children}
        {error && <Callout.Error data-testid={`${testId}-error`}>{error}</Callout.Error>}
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant={submitVariant}
          size="sm"
          disabled={submitDisabled}
          aria-disabled={submitDisabled}
          onClick={onSubmit}
        >
          {submitIcon}
          {submitLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
