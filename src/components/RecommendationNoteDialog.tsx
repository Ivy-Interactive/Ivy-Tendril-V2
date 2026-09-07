import React, { useEffect, useState } from "react";

export interface RecommendationNoteDialogProps {
  isOpen: boolean;
  title: string;
  action: "Accept" | "Decline";
  initialNote?: string;
  onClose: () => void;
  onSubmit: (note?: string) => void | Promise<void>;
}

export const RecommendationNoteDialog: React.FC<
  RecommendationNoteDialogProps
> = ({
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
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <h3 className="text-sm font-semibold text-slate-100">
          {action === "Accept"
            ? "Accept Recommendation"
            : "Decline Recommendation"}
        </h3>
        <p className="mt-1 text-xs text-slate-400">{title}</p>
        <div className="mt-4">
          <label
            htmlFor="rec-dialog-note"
            className="block text-xs font-medium text-slate-300 mb-1"
          >
            {action === "Accept"
              ? "Optional Operator Note:"
              : "Decline Reason:"}
          </label>
          <textarea
            id="rec-dialog-note"
            aria-label={
              action === "Accept" ? "Optional note" : "Decline reason"
            }
            rows={3}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder={
              action === "Accept"
                ? "Enter optional notes..."
                : "Enter reason for declining..."
            }
            className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div className="mt-4 flex justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className={`rounded px-4 py-1.5 text-xs font-medium text-white transition ${
              action === "Accept"
                ? "bg-emerald-600 hover:bg-emerald-500"
                : "bg-red-600 hover:bg-red-500"
            }`}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
};
