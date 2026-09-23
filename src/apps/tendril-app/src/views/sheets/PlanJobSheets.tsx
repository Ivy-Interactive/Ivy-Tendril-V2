import React, { useEffect, useState } from "react";
import { JobCostSheet } from "@ivy-interactive/components/dialogs";
import { JobDebugSheet } from "./JobDebugSheet";
import { bridge } from "../../api/bridge";
import type { Job, JobDetail } from "../../types/api";
import { useTranslation } from "../../i18n";
import { useEnumLabels } from "../../i18n/enumLabels";

export interface PlanJobSheetsProps {
  /** The jobs the page lists, so the cost sheet can show a row's figures before its detail lands. */
  jobs: Job[];
  /** The job whose Job Debug sheet is open, or null. */
  debugJobId: string | null;
  /** The job whose Cost & Tokens sheet is open, or null. */
  costJobId: string | null;
  onCloseDebug: () => void;
  onCloseCost: () => void;
}

/**
 * The two job sheets a plan page opens from its Jobs section: V1's `debugSheet` / `costSheet`
 * triggers (`Plans/ContentView.cs:86/96`, `Review/ContentView.cs:109/119`), each a
 * `Sheet(..., "Job Debug")` / `Sheet(..., "Cost & Tokens")` at `UxHelper.SheetWidth` over the job id.
 *
 * Both are the sheets the Jobs table opens: the connected `JobDebugSheet` (with its Report Bug and
 * Debug-with-agent buttons) and the library's `JobCostSheet`. The debug sheet needs the
 * job's full detail, so it is read when the sheet opens (`getJob`); the cost sheet shows the list
 * row's figures until that detail arrives, as the Jobs table does.
 */
export const PlanJobSheets: React.FC<PlanJobSheetsProps> = ({
  jobs,
  debugJobId,
  costJobId,
  onCloseDebug,
  onCloseCost,
}) => {
  const { t } = useTranslation("plans");
  const labels = useEnumLabels();
  const [details, setDetails] = useState<Record<string, JobDetail>>({});

  useEffect(() => {
    // Read again on every open, so a job that has moved on since is not shown as it was.
    const wanted = [debugJobId, costJobId].filter((id): id is string => id !== null);
    if (wanted.length === 0) return;
    let cancelled = false;
    for (const id of wanted) {
      bridge
        .getJob(id)
        .then((detail) => {
          if (!cancelled) setDetails((prev) => ({ ...prev, [id]: detail }));
        })
        // An unanswered read leaves the debug sheet on its own "not loaded" line and the cost
        // sheet on the list row's figures; neither needs an error of its own.
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [debugJobId, costJobId]);

  const costJob = costJobId
    ? (details[costJobId] ?? jobs.find((job) => job.id === costJobId))
    : undefined;

  return (
    <>
      <JobDebugSheet
        isOpen={debugJobId !== null}
        onClose={onCloseDebug}
        job={debugJobId ? details[debugJobId] : undefined}
      />
      <JobCostSheet
        isOpen={costJobId !== null}
        onClose={onCloseCost}
        title={
          costJob?.planId
            ? t("details.jobs.costTitleWithPlan", { planId: costJob.planId })
            : t("details.jobs.costTitle")
        }
        job={costJob}
        formatType={labels.jobType}
      />
    </>
  );
};
