import * as React from "react";
import { RotateCw } from "lucide-react";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { Textarea } from "../ui/textarea";
import { useTranslation } from "@/i18n/uiJobs";
import { DialogShell, DialogShortcutHint } from "./DialogShell";

/**
 * `RerunJobDialog.SupportsFeedback`, over what a job row carries: the arg types feedback can be folded
 * into (`ExecutePlan`, `RetryPlan`, `UpdatePlan`), and a `CreatePlan` whose plan now exists - which
 * reruns as an execution of that plan, and so can take a change request too. The daemon makes the
 * same decision from the args themselves; this only decides whether to offer the textarea.
 */
export function rerunSupportsFeedback(job: { type: string; planId?: string }): boolean {
  if (job.type === "ExecutePlan" || job.type === "RetryPlan" || job.type === "UpdatePlan") {
    return true;
  }
  return job.type === "CreatePlan" && Boolean(job.planId);
}

export interface RerunJobDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The job type as the title names it: V1's `$"Rerun {job.Type}"`. */
  typeLabel: string;
  /** Whether the rerun can take corrective feedback. See {@link rerunSupportsFeedback}. */
  supportsFeedback: boolean;
  /** Reruns the job. `feedback` is trimmed, and absent when the operator left the box empty. */
  onConfirm: (feedback?: string) => void | Promise<void>;
  isBusy?: boolean;
  /** The daemon's refusal, shown where the operator pressed the button. */
  error?: string | null;
}

/**
 * V1's `Apps/Jobs/Dialogs/RerunJobDialog.cs`, opened by the Jobs row menu's Rerun.
 *
 * A rerun deletes the job and starts it again from its original args. What the dialog adds is the
 * chance to say what to do differently: for a job that can take it, an optional feedback box, folded
 * into the new job's args as a `RetryPlan` change request or new `UpdatePlan` instructions; for one
 * that cannot, just the question.
 *
 * Unlike the confirms, the primary action is the default: a rerun destroys nothing the operator did
 * not ask to repeat, and V1 puts `Ctrl+Enter` on it. The textarea takes focus when there is one, as
 * V1's `.AutoFocus()` does.
 */
export function RerunJobDialog({
  isOpen,
  onClose,
  typeLabel,
  supportsFeedback,
  onConfirm,
  isBusy = false,
  error,
}: RerunJobDialogProps) {
  const { t } = useTranslation("uiJobs");
  const [feedback, setFeedback] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (isOpen) setFeedback("");
  }, [isOpen]);

  const confirm = () => {
    if (isBusy) return;
    const trimmed = feedback.trim();
    void onConfirm(supportsFeedback && trimmed ? trimmed : undefined);
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t("rerun.title", { type: typeLabel })}
      width="rem30"
      testId="rerun-job-dialog"
      initialFocusRef={supportsFeedback ? textareaRef : confirmRef}
      shortcut="Ctrl+Enter"
      onShortcut={isBusy ? undefined : confirm}
      footer={
        <>
          <Button variant="outline" onClick={onClose} data-testid="dialog-cancel" disabled={isBusy}>
            {t("actions.cancel")}
          </Button>
          <Button ref={confirmRef} onClick={confirm} data-testid="dialog-confirm" disabled={isBusy}>
            <RotateCw aria-hidden="true" />
            {isBusy ? t("rerun.busy") : t("rerun.confirm")}
            {!isBusy && <DialogShortcutHint shortcut="Ctrl+Enter" />}
          </Button>
        </>
      }
    >
      {supportsFeedback ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("rerun.intro")}</p>
          <Textarea
            ref={textareaRef}
            aria-label={t("rerun.feedbackAriaLabel")}
            placeholder={t("rerun.feedbackPlaceholder")}
            rows={6}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            disabled={isBusy}
            className="text-sm"
            data-testid="rerun-job-feedback"
          />
        </div>
      ) : (
        <p className="text-sm">{t("rerun.unchanged")}</p>
      )}
      {error && <Callout.Error className="mt-4">{error}</Callout.Error>}
    </DialogShell>
  );
}
