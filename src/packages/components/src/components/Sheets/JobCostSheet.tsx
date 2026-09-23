import React from "react";
import { formatTokens, NO_VALUE } from "../../lib/formatters";
import { Callout } from "../ui/callout";
import { SheetPanel } from "../ui/sheet-panel";
import { useFormatters, useTranslation, type TFunction } from "@/i18n/uiJobs";

type Formatters = ReturnType<typeof useFormatters>;

/**
 * A job's cost and token counts, as this sheet renders them.
 *
 * Declared here rather than imported from the app, on the rule `PlanGitView` states: the component
 * that renders a shape owns its declaration and cannot import from the app. The app's `Job` and
 * `JobDetail` are structurally compatible and pass straight through.
 */
export interface JobCostFacts {
  type: string;
  tokens?: number;
  cost?: number;
  costSource?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  executionProfile?: string;
  provider?: string;
}

/** A token bucket's id, and its label's key under `uiJobs:costSheet.buckets`. */
export type JobCostBucketKind = "input" | "output" | "cacheRead" | "cacheWrite" | "reasoning";

/** One token bucket: V1's `UsageRow`, minus the two rate-derived columns V2 cannot compute. */
export interface JobCostBucket {
  /** A stable id - the row's React key - rather than the label, which changes with the language. */
  kind: JobCostBucketKind;
  tokens: number;
}

/** V1's `Dash`: a details value, or the em-dash the table already uses for "nothing here". */
function dash(value: string | undefined | null): string {
  return value === undefined || value === null || value.trim() === "" ? NO_VALUE : value;
}

/**
 * The buckets, in V1's order. A bucket the daemon did not report is left out rather than shown as
 * zero: "no cache writes" and "cache writes not recorded" are different facts, and only one of them
 * is worth a row.
 */
export function buildJobCostBuckets(
  job: Pick<
    JobCostFacts,
    "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "reasoningTokens"
  >,
): JobCostBucket[] {
  const candidates: Array<[JobCostBucketKind, number | undefined]> = [
    ["input", job.inputTokens],
    ["output", job.outputTokens],
    ["cacheRead", job.cacheReadTokens],
    ["cacheWrite", job.cacheWriteTokens],
    ["reasoning", job.reasoningTokens],
  ];
  return candidates
    .filter(
      (entry): entry is [JobCostBucketKind, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
    )
    .map(([kind, tokens]) => ({ kind, tokens }));
}

/** Four decimal places and no grouping: V1's `$1234.5000`. */
const COST_DIGITS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
  useGrouping: false,
};

/**
 * V1's four-decimal dollar figure (`$${cost.toFixed(4)}`, "$4.2100"), with the current language's
 * decimal separator and currency placement. Four places because a single run's cost is often a
 * fraction of a cent, which two would round away.
 *
 * Rounded by `toFixed` first, so English stays V1's figure exactly: `Intl` rounds a halfway value on
 * its decimal form (0.00015 → "0.0002") where `toFixed` rounds the binary one (→ "0.0001"). Once
 * rounded, the value has exactly four places for `Intl` to print.
 */
function formatSheetCost(cost: number, format: Formatters): string {
  return format.currency(Number(cost.toFixed(4)), "USD", COST_DIGITS);
}

/**
 * V1's `BuildAgentCostValue`. Everything that is not an agent-reported charge — a computed one, one
 * that predates cost-source tracking, no charge at all — comes to the same thing for a reader: the
 * agent gave no figure.
 */
function agentReportedCost(
  job: Pick<JobCostFacts, "cost" | "costSource">,
  t: TFunction,
  format: Formatters,
): string {
  if (job.costSource?.toLowerCase() === "agent" && typeof job.cost === "number") {
    return formatSheetCost(job.cost, format);
  }
  return t("costSheet.notProvided");
}

/**
 * V1's `TotalCost`, prefixed `~` when the charge is Tendril's arithmetic rather than a figure anyone
 * quoted — the same tilde the Cost cell carries, for the same reason.
 */
function totalCost(
  job: Pick<JobCostFacts, "cost" | "costSource">,
  t: TFunction,
  format: Formatters,
): string {
  if (typeof job.cost !== "number" || !Number.isFinite(job.cost)) return NO_VALUE;
  const formatted = formatSheetCost(job.cost, format);
  return job.costSource?.toLowerCase() === "estimated"
    ? t("costSheet.estimated", { cost: formatted })
    : formatted;
}

export interface JobCostSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** The sheet's title. V1 names the sheet "Cost & Tokens"; the Jobs table adds the plan id. */
  title: string;
  /** The job's figures. Absent while the detail read is still out. */
  job?: JobCostFacts;
  /**
   * The Type row's label for a job type. The app passes its enum labels (`useEnumLabels().jobType`);
   * without one the raw value is shown, which is also what English shows.
   */
  formatType?: (type: string) => string;
}

/**
 * V1's Cost & Tokens sheet (`Apps/Views/Sheets/JobCostSheet.cs`), which the Jobs table's **Cost** and
 * **Tokens** cells both open (`JobsApp.DataTable.cs:149-162`, `JobsApp.cs:51`).
 *
 * What it is for: the two cells each show one number, and neither says where it came from. This breaks
 * the run into the buckets behind it — how many tokens of each kind, and whether the charge is one the
 * agent reported or one Tendril computed. That last distinction is the reason V1 built the sheet, and
 * it is the one thing the cells cannot express: a `~$4.21` and a `$4.31` look like the same kind of
 * fact and are not.
 *
 * What is *not* here, and why: V1 renders a per-million rate beside each bucket and multiplies it out.
 * Those rates come from `IModelPricingProvider`, which V2 has no equivalent of — the daemon sends the
 * finished figures and not the price list it used. Inventing rates to fill the column would be the one
 * way this sheet could lie, so the columns that need them are omitted rather than guessed, and the
 * sheet reports the totals it actually has. The rate columns arrive with the pricing endpoint.
 *
 * **It owns its panel**, the shared `SheetPanel` at V1's `UxHelper.SheetWidth`, so every caller — the
 * Jobs table, and the plan pages that show a job's cost — opens the same sheet.
 */
export const JobCostSheet: React.FC<JobCostSheetProps> = ({
  isOpen,
  onClose,
  title,
  job,
  formatType,
}) => {
  const { t } = useTranslation("uiJobs");
  return (
    <SheetPanel open={isOpen} onClose={onClose} title={title} data-testid="job-cost-sheet-panel">
      {job ? (
        <JobCostBody job={job} formatType={formatType} />
      ) : (
        /* The figures are the sheet, so there is nothing to render until they land. */
        <span className="text-xs text-muted-foreground" data-testid="job-cost-pending">
          {t("costSheet.loading")}
        </span>
      )}
    </SheetPanel>
  );
};

/**
 * The details list and breakdown table.
 *
 * Every details row is kept and dashed when empty, as V1 does, so which facts the sheet reports is
 * the same for every job and a blank Profile reads as "none recorded" rather than as a row the
 * reader has to notice is missing.
 */
const JobCostBody: React.FC<{ job: JobCostFacts; formatType?: (type: string) => string }> = ({
  job,
  formatType,
}) => {
  const { t } = useTranslation("uiJobs");
  const format = useFormatters();
  const buckets = buildJobCostBuckets(job);
  const bucketTotal = buckets.reduce((sum, bucket) => sum + bucket.tokens, 0);
  // The breakdown is the sum of what was reported; `tokens` is the daemon's own total. They agree on
  // a job with a full breakdown, and on one without the total is all there is to show.
  const total = buckets.length > 0 ? bucketTotal : job.tokens;

  // `[id, label, value]`: the id is the row's React key, so it stays put when the label is translated.
  const details: Array<[string, string, string]> = [
    ["model", t("costSheet.details.model"), dash(job.model)],
    ["provider", t("costSheet.details.provider"), dash(job.provider)],
    [
      "type",
      t("costSheet.details.type"),
      dash(job.type && (formatType ? formatType(job.type) : job.type)),
    ],
    ["profile", t("costSheet.details.profile"), dash(job.executionProfile)],
    ["agentCost", t("costSheet.details.agentCost"), agentReportedCost(job, t, format)],
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="job-cost-sheet">
      <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2 text-xs">
        {details.map(([id, label, value]) => (
          <React.Fragment key={id}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate font-mono text-foreground" title={value}>
              {value}
            </dd>
          </React.Fragment>
        ))}
      </dl>

      {buckets.length === 0 ? (
        /* V1's `NoUsageReason` branch: the details still render, and the breakdown says why it is
           absent instead of showing an empty table. */
        <Callout.Info data-testid="job-cost-no-usage">
          {typeof job.tokens === "number"
            ? t("costSheet.noUsage", { context: "total", total: formatTokens(job.tokens) })
            : t("costSheet.noUsage")}
        </Callout.Info>
      ) : (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-foreground">{t("costSheet.breakdown.title")}</h4>
          <table className="w-full text-xs" data-testid="job-cost-breakdown">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1 text-left font-medium">{t("costSheet.breakdown.tokenType")}</th>
                <th className="py-1 text-right font-medium">{t("costSheet.breakdown.tokens")}</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.kind} className="border-b border-border/50">
                  <td className="py-1 text-left text-foreground">
                    {t(`costSheet.buckets.${bucket.kind}`)}
                  </td>
                  <td className="py-1 text-right font-mono text-foreground">
                    {formatTokens(bucket.tokens)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <td className="py-1 text-left text-foreground">{t("costSheet.breakdown.total")}</td>
                <td className="py-1 text-right font-mono text-foreground">
                  {typeof total === "number" ? formatTokens(total) : NO_VALUE}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2 border-t border-border pt-3 text-xs">
        <dt className="text-muted-foreground">{t("costSheet.totalCost")}</dt>
        <dd className="min-w-0 font-mono text-foreground">{totalCost(job, t, format)}</dd>
      </dl>
    </div>
  );
};
