import React, { useEffect, useRef, useState } from "react";
import { Button } from "@ivy-interactive/components/ui";
import { DialogShell } from "@ivy-interactive/components/dialogs";

export interface JobFeedbackDialogProps {
  isOpen: boolean;
  action: "relaunch" | "retry";
  jobId: string;
  jobType?: string;
  prompt?: string;
  onClose: () => void;
  onSubmit: (feedback?: string) => void | Promise<void>;
}

export const JobFeedbackDialog: React.FC<JobFeedbackDialogProps> = ({
  isOpen,
  action,
  jobId,
  jobType,
  prompt,
  onClose,
  onSubmit,
}) => {
  const [feedback, setFeedback] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setFeedback("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    const trimmed = feedback.trim();
    void onSubmit(trimmed ? trimmed : undefined);
  };

  const isRelaunch = action === "relaunch";
  const title = isRelaunch ? `Relaunch Job #${jobId}` : `Retry Last Step #${jobId}`;
  const description = isRelaunch
    ? `Relaunch this ${jobType || "job"} entirely from the beginning.`
    : `Retry the last step of this ${jobType || "job"} in its worktree.`;
  const submitLabel = isRelaunch ? "Relaunch" : "Retry";

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      testId="job-feedback-dialog"
      ariaLabel={title}
      initialFocusRef={inputRef}
      shortcut="Ctrl+Enter"
      onShortcut={handleSubmit}
      footer={
        <>
          <Button variant="outline" onClick={onClose} data-testid="job-feedback-cancel">
            Cancel
          </Button>
          <Button variant="default" onClick={handleSubmit} data-testid="job-feedback-submit">
            {submitLabel}
          </Button>
        </>
      }
    >
      {prompt && (
        <div className="mb-3 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground line-clamp-3">
          <span className="font-medium text-foreground">Task: </span>
          {prompt}
        </div>
      )}
      <label
        htmlFor="job-feedback-input"
        className="block text-xs font-medium text-muted-foreground mb-1"
      >
        Optional instructions or feedback for the agent:
      </label>
      <textarea
        id="job-feedback-input"
        data-testid="job-feedback-input"
        ref={inputRef}
        aria-label="Optional feedback"
        rows={4}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder={
          isRelaunch
            ? "Add optional guidance or changes before relaunching..."
            : "Describe what went wrong or how to resolve the last step..."
        }
        className="w-full rounded-box border border-border bg-background p-3 text-sm text-foreground placeholder-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none"
      />
    </DialogShell>
  );
};
