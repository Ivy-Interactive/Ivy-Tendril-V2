import React, { useEffect, useRef, useState } from "react";
import { Button } from "@ivy-interactive/components/ui";
import { DialogShell } from "@ivy-interactive/components/dialogs";
import { useTranslation } from "../i18n";

export interface RecommendationNoteDialogProps {
  isOpen: boolean;
  title: string;
  action: "Accept" | "Decline";
  initialNote?: string;
  /**
   * The recommendation's own text, shown above the note field.
   *
   * `AcceptWithNotesDialog`'s body is "Add notes to include with this recommendation:" followed by
   * the description, because the notes are *about* it and V1 will not make the operator write them
   * from memory. Rendered as plain text rather than markdown for the reason V1 states in that file:
   * a Sheet stacked on an open Dialog is not a pattern this codebase uses, so an inert link is a
   * smaller failure than a live-looking one that does nothing.
   */
  recommendationDescription?: string;
  onClose: () => void;
  onSubmit: (note?: string) => void | Promise<void>;
}

export const RecommendationNoteDialog: React.FC<RecommendationNoteDialogProps> = ({
  isOpen,
  title,
  action,
  initialNote = "",
  recommendationDescription,
  onClose,
  onSubmit,
}) => {
  const { t } = useTranslation("review");
  const [noteText, setNoteText] = useState(initialNote);
  // V1's `.AutoFocus()` on the textarea. `DialogShell` honours `initialFocusRef` and otherwise
  // focuses the panel, so without this the operator had to click into the only field on the dialog.
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setNoteText(initialNote);
    }
  }, [isOpen, initialNote]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = () => {
    const trimmed = noteText.trim();
    void onSubmit(trimmed ? trimmed : undefined);
  };

  // `action` is the decision itself, compared below; only its wording goes through the catalog.
  const mode = action === "Accept" ? "accept" : "decline";

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t(`noteDialog.${mode}.title`)}
      description={title}
      testId="recommendation-note-dialog"
      ariaLabel={t(`noteDialog.${mode}.ariaLabel`)}
      initialFocusRef={noteRef}
      // `.ShortcutKey("Ctrl+Enter")` on V1's Accept button. `DialogShell` has carried the shortcut
      // machinery all along and this dialog never opted in, so the only way to submit was the mouse.
      // The modifier is what makes it safe next to a multi-line field.
      shortcut="Ctrl+Enter"
      onShortcut={handleSubmit}
      footer={
        <>
          <Button variant="outline" onClick={onClose} data-testid="rec-dialog-cancel">
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant={action === "Accept" ? "default" : "destructive"}
            onClick={handleSubmit}
            data-testid="rec-dialog-submit"
          >
            {t("noteDialog.submit")}
          </Button>
        </>
      }
    >
      {recommendationDescription && (
        <p
          data-testid="rec-dialog-description"
          className="mb-3 whitespace-pre-wrap text-xs text-muted-foreground"
        >
          {recommendationDescription}
        </p>
      )}
      <label
        htmlFor="rec-dialog-note"
        className="block text-xs font-medium text-muted-foreground mb-1"
      >
        {t(`noteDialog.${mode}.noteLabel`)}
      </label>
      <textarea
        id="rec-dialog-note"
        ref={noteRef}
        aria-label={t(`noteDialog.${mode}.noteAriaLabel`)}
        rows={3}
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        placeholder={t(`noteDialog.${mode}.placeholder`)}
        className="w-full rounded-box border border-border bg-background p-3 text-sm text-foreground placeholder-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none"
      />
    </DialogShell>
  );
};
