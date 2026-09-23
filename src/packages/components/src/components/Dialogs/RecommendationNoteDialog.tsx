import * as React from "react";
import { Button } from "../ui/button";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { useTranslation } from "@/i18n/uiDialogs";
import { DialogShell } from "./DialogShell";

export interface RecommendationNoteDialogProps {
  isOpen: boolean;
  /** The recommendation's title, shown as the dialog's description. */
  title: string;
  /** The decision being recorded. Compared, never shown: only its wording is translated. */
  action: "Accept" | "Decline";
  initialNote?: string;
  /**
   * The recommendation's own text, shown above the note field.
   *
   * `AcceptWithNotesDialog`'s body is "Add notes to include with this recommendation:" followed by
   * the description, because the notes are *about* it and V1 will not make the operator write them
   * from memory. Rendered as markdown, as V1's `new Markdown(...).Article()` does, and with no link
   * handler for the reason V1 gives there: a Sheet stacked on an open Dialog is not a pattern this
   * codebase uses, so an inert link is a smaller failure than a live-looking one that does nothing.
   */
  recommendationDescription?: string;
  onClose: () => void;
  /** Called with the trimmed note, or `undefined` when none was written. */
  onSubmit: (note?: string) => void | Promise<void>;
}

/**
 * Accept or decline a recommendation with an operator note - V1's
 * `Recommendations/Dialogs/AcceptWithNotesDialog`, with Decline sharing its shape.
 *
 * `.Width(Size.Rem(40))` on V1's dialog, `.AutoFocus()` on its textarea and
 * `.ShortcutKey("Ctrl+Enter")` on its Accept button; all three here.
 */
export function RecommendationNoteDialog({
  isOpen,
  title,
  action,
  initialNote = "",
  recommendationDescription,
  onClose,
  onSubmit,
}: RecommendationNoteDialogProps) {
  const { t } = useTranslation("uiDialogs");
  const [noteText, setNoteText] = React.useState(initialNote);
  // V1's `.AutoFocus()` on the textarea. `DialogShell` honours `initialFocusRef` and otherwise
  // focuses the panel, so without this the operator had to click into the only field on the dialog.
  const noteRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
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

  const accept = action === "Accept";

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={accept ? t("recommendationNote.accept.title") : t("recommendationNote.decline.title")}
      description={title}
      testId="recommendation-note-dialog"
      ariaLabel={
        accept
          ? t("recommendationNote.accept.ariaLabel")
          : t("recommendationNote.decline.ariaLabel")
      }
      width="rem40"
      initialFocusRef={noteRef}
      // `.ShortcutKey("Ctrl+Enter")` on V1's Accept button. The modifier is what makes it safe next
      // to a multi-line field.
      shortcut="Ctrl+Enter"
      onShortcut={handleSubmit}
      footer={
        <>
          <Button variant="outline" onClick={onClose} data-testid="rec-dialog-cancel">
            {t("actions.cancel")}
          </Button>
          <Button
            variant={accept ? "default" : "destructive"}
            onClick={handleSubmit}
            data-testid="rec-dialog-submit"
          >
            {t("recommendationNote.submit")}
          </Button>
        </>
      }
    >
      {recommendationDescription && (
        <div
          data-testid="rec-dialog-description"
          className="mb-3 max-h-64 overflow-y-auto rounded-box border border-border p-3 text-sm"
        >
          <MarkdownRenderer content={recommendationDescription} />
        </div>
      )}
      <label
        htmlFor="rec-dialog-note"
        className="mb-1 block text-xs font-medium text-muted-foreground"
      >
        {accept
          ? t("recommendationNote.accept.noteLabel")
          : t("recommendationNote.decline.noteLabel")}
      </label>
      <textarea
        id="rec-dialog-note"
        ref={noteRef}
        aria-label={
          accept
            ? t("recommendationNote.accept.noteAriaLabel")
            : t("recommendationNote.decline.noteAriaLabel")
        }
        // V1's `.Rows(6)`.
        rows={6}
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        placeholder={
          accept
            ? t("recommendationNote.accept.placeholder")
            : t("recommendationNote.decline.placeholder")
        }
        className="w-full rounded-box border border-border bg-background p-3 text-sm text-foreground placeholder-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none"
      />
    </DialogShell>
  );
}
