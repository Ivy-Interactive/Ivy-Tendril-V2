import React, { useEffect, useState } from "react";

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${action} Recommendation`}
      data-testid="recommendation-note-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
        <h3 className="text-sm font-semibold text-foreground">
          {action === "Accept" ? "Accept Recommendation" : "Decline Recommendation"}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{title}</p>
        <div className="mt-4">
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
        </div>
        <div className="mt-4 flex justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className={`rounded px-4 py-1.5 text-xs font-medium text-white transition ${
              action === "Accept"
                ? "bg-primary hover:bg-primary/90"
                : "bg-destructive hover:bg-destructive/90"
            }`}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
};
