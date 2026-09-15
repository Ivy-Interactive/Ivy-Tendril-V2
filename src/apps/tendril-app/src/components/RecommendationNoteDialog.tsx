import React, { useEffect, useState } from "react";
import { Button } from "@ivy-interactive/components/ui";
import { DialogShell } from "../views/dialogs/DialogShell";

export interface RecommendationNoteDialogProps {
  isOpen: boolean;
  title: string;
  action: "Accept" | "Decline";
  initialNote?: string;
  onClose: () => void;
  onSubmit: (note?: string) => void | Promise<void>;
}

export const RecommendationNoteDialog: React.FC<RecommendationNoteDialogProps> = ({
  isOpen,
  title,
  action,
  initialNote = "",
  onClose,
  onSubmit,
}) => {
  const [noteText, setNoteText] = useState(initialNote);

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

  const heading = action === "Accept" ? "Accept Recommendation" : "Decline Recommendation";

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={heading}
      description={title}
      testId="recommendation-note-dialog"
      ariaLabel={`${action} Recommendation`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} data-testid="rec-dialog-cancel">
            Cancel
          </Button>
          <Button
            variant={action === "Accept" ? "default" : "destructive"}
            onClick={handleSubmit}
            data-testid="rec-dialog-submit"
          >
            Submit
          </Button>
        </>
      }
    >
      <label
        htmlFor="rec-dialog-note"
        className="block text-xs font-medium text-muted-foreground mb-1"
      >
        {action === "Accept" ? "Optional Operator Note:" : "Decline Reason:"}
      </label>
      <textarea
        id="rec-dialog-note"
        aria-label={action === "Accept" ? "Optional note" : "Decline reason"}
        rows={3}
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        placeholder={
          action === "Accept" ? "Enter optional notes..." : "Enter reason for declining..."
        }
        className="w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground placeholder-muted-foreground/70 focus:border-ring focus:outline-none"
      />
    </DialogShell>
  );
};
