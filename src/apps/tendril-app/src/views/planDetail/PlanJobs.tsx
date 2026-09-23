import React, { useMemo } from "react";
import { Bug } from "lucide-react";
import { IconButton } from "@ivy-interactive/components/ui";
import type { Job } from "../../types/api";
import { formatCost, formatTokens } from "../../utils/format";
import { useTranslation } from "../../i18n";
import { useEnumLabels } from "../../i18n/enumLabels";

export interface PlanJobsProps {
  /** Every job the page knows about; the section keeps the ones that ran for this plan. */
  jobs: Job[];
  planId: string;
  /** V1's `showDebug(id)`: the Job Debug sheet. */
  onOpenDebug: (jobId: string) => void;
  /** V1's `showCost(id)`: the Cost & Tokens sheet, which both the Cost and Tokens cells open. */
  onOpenCost: (jobId: string) => void;
}

/**
 * The jobs a plan has run, newest first: V1's `DetailsTabView` "Jobs" section, a
 * `PlanJobsDataTableView` (`Apps/Views/PlanJobsDataTableView.cs`) under a `Text.H4("Jobs")`, shown
 * only when the plan has any.
 *
 * V1's columns and its two ways into a job's sheets are kept: the row's **Debug** action opens the
 * Job Debug sheet, and the Cost and Tokens cells both open Cost & Tokens (`OnCellAction(t => t.Cost)`
 * and `t => t.Tokens`). This is how a plan's page reaches those sheets at all - V1 declares both
 * triggers in `Plans/ContentView.cs:86/96` and `Review/ContentView.cs:109/119` for exactly this
 * table.
 */
export const PlanJobs: React.FC<PlanJobsProps> = ({ jobs, planId, onOpenDebug, onOpenCost }) => {
  const { t } = useTranslation("plans");
  const labels = useEnumLabels();

  // `.OrderByDescending(j => j.StartedAt ?? DateTime.MaxValue).ThenByDescending(j => j.Id)`: a job
  // that has not started yet sorts first, as the newest thing the plan is waiting on.
  const planJobs = useMemo(
    () =>
      jobs
        .filter((job) => job.planId === planId)
        .sort((a, b) => {
          const at = a.startedAt ? Date.parse(a.startedAt) : Number.POSITIVE_INFINITY;
          const bt = b.startedAt ? Date.parse(b.startedAt) : Number.POSITIVE_INFINITY;
          if (at !== bt) return bt - at;
          return b.id.localeCompare(a.id, undefined, { numeric: true });
        }),
    [jobs, planId],
  );

  if (planJobs.length === 0) return null;

  const cellButton =
    "font-mono tabular-nums text-foreground hover:text-primary hover:underline focus:outline-none";

  return (
    <section data-testid="plan-jobs" className="space-y-2">
      <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {t("details.jobs.heading")}
      </h4>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted-foreground/70">
            <th scope="col" className="py-1 pr-3 font-medium">
              {t("details.jobs.columns.status")}
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              {t("details.jobs.columns.type")}
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              {t("details.jobs.columns.cost")}
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              {t("details.jobs.columns.tokens")}
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              {t("details.jobs.columns.message")}
            </th>
            <th scope="col" className="w-8 py-1">
              <span className="sr-only">{t("details.jobs.columns.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {planJobs.map((job) => (
            <tr
              key={job.id}
              data-testid={`plan-job-${job.id}`}
              className="border-t border-border/50 align-top"
            >
              <td className="py-1 pr-3 text-xs">{labels.jobStatus(job.status)}</td>
              <td className="py-1 pr-3 text-xs">{labels.jobType(job.type)}</td>
              <td className="py-1 pr-3 text-right text-xs">
                {job.cost !== undefined && (
                  <button
                    type="button"
                    className={cellButton}
                    title={t("details.jobs.costTooltip")}
                    data-testid={`plan-job-cost-${job.id}`}
                    onClick={() => onOpenCost(job.id)}
                  >
                    {formatCost(job.cost)}
                  </button>
                )}
              </td>
              <td className="py-1 pr-3 text-right text-xs">
                {job.tokens !== undefined && (
                  <button
                    type="button"
                    className={cellButton}
                    title={t("details.jobs.costTooltip")}
                    data-testid={`plan-job-tokens-${job.id}`}
                    onClick={() => onOpenCost(job.id)}
                  >
                    {formatTokens(job.tokens)}
                  </button>
                )}
              </td>
              <td className="min-w-0 py-1 pr-3 text-xs break-words text-muted-foreground">
                {job.statusMessage}
              </td>
              <td className="py-0.5 text-right">
                <IconButton
                  label={t("details.jobs.debug")}
                  tooltip={t("details.jobs.debugTooltip")}
                  size="xs"
                  tone="muted"
                  data-testid={`plan-job-debug-${job.id}`}
                  onClick={() => onOpenDebug(job.id)}
                >
                  <Bug className="size-3.5" aria-hidden="true" />
                </IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};
