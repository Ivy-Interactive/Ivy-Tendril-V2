import * as React from "react";
import {
  RerunJobDialog as RerunJobDialogView,
  rerunSupportsFeedback,
} from "@ivy-interactive/components/dialogs";
import { bridge } from "../../api/bridge";
import { useTranslation } from "../../i18n";
import { useEnumLabels } from "../../i18n/enumLabels";
import { jobsStore } from "../../state/jobsStore";
import { describeBridgeError, type Job } from "../../types/api";

export interface RerunJobDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The job to rerun. Absent, nothing renders. */
  job?: Pick<Job, "id" | "type" | "planId">;
  /** Called with the new job's id once the daemon has started it. */
  onRerun?: (jobId: string) => void;
}

/**
 * The connected half of V1's `RerunJobDialog` (`Apps/Jobs/Dialogs/RerunJobDialog.cs`).
 *
 * The rerun itself is the daemon's - `bridge.rerunJob`, `POST /api/jobs/:id/rerun` - because it reads
 * the job's stored args, folds the feedback in, deletes the job and starts the new one in one
 * request. What is left here is the request's busy state and failure, and the list refresh V1's
 * `onRerun` callback does (`refreshToken.Refresh()`).
 */
export function RerunJobDialog({ isOpen, onClose, job, onRerun }: RerunJobDialogProps) {
  const { t } = useTranslation("jobs");
  const labels = useEnumLabels();
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen]);

  if (!job) return null;

  const handleConfirm = async (feedback?: string) => {
    setIsBusy(true);
    setError(null);
    try {
      const started = await bridge.rerunJob(job.id, feedback);
      // The old row is gone and a new one exists: a structural change the list has to re-read.
      jobsStore.fetchJobs().catch(() => {});
      onRerun?.(started.jobId);
      onClose();
    } catch (err) {
      setError(t("errors.rerunFailed", { error: describeBridgeError(err) }));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <RerunJobDialogView
      isOpen={isOpen}
      onClose={onClose}
      typeLabel={job.type ? labels.jobType(job.type) : ""}
      supportsFeedback={rerunSupportsFeedback({ type: job.type, planId: job.planId })}
      onConfirm={handleConfirm}
      isBusy={isBusy}
      error={error}
    />
  );
}
