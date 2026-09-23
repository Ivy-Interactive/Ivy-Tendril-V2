import React from "react";
import { formatTokens, NO_VALUE } from "../../lib/formatters";
import { Callout } from "../ui/callout";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { HeaderLayout } from "../ui/panel-layout";
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

/**
 * V1's Cost & Tokens sheet (`Apps/Views/Sheets/JobCostSheet.cs`), which the Jobs table's **Cost** and
 * **Tokens** cells both open (`JobsApp.DataTable.cs:149-162`).
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
 */

/** V1's `Dash`: a details value, or the em-dash the table already uses for "nothing here". */
function dash(value: string | undefined | null): string {
  return value === undefined || value === null || value.trim() === "" ? NO_VALUE : value;
}

/** One token bucket: V1's `UsageRow`, minus the two rate-derived columns V2 cannot compute. */
export interface JobCostBucket {
  kind: string;
  tokens: number;
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
  const candidates: Array<[string, number | undefined]> = [
    ["Input", job.inputTokens],
    ["Output", job.outputTokens],
    ["Cache read", job.cacheReadTokens],
    ["Cache write", job.cacheWriteTokens],
    ["Reasoning", job.reasoningTokens],
  ];
  return candidates
    .filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
    )
    .map(([kind, tokens]) => ({ kind, tokens }));
}

/**
 * V1's `BuildAgentCostValue`. Everything that is not an agent-reported charge — a computed one, one
 * that predates cost-source tracking, no charge at all — comes to the same thing for a reader: the
 * agent gave no figure.
 */
function agentReportedCost(job: Pick<JobCostFacts, "cost" | "costSource">): string {
  if (job.costSource?.toLowerCase() === "agent" && typeof job.cost === "number") {
    return `$${job.cost.toFixed(4)}`;
  }
  return "Not Provided";
}

/**
 * V1's `TotalCost`, prefixed `~` when the charge is Tendril's arithmetic rather than a figure anyone
 * quoted — the same tilde the Cost cell carries, for the same reason.
 */
function totalCost(job: Pick<JobCostFacts, "cost" | "costSource">): string {
  if (typeof job.cost !== "number" || !Number.isFinite(job.cost)) return NO_VALUE;
  const formatted = `$${job.cost.toFixed(4)}`;
  return job.costSource?.toLowerCase() === "estimated" ? `~${formatted}` : formatted;
}

export interface JobCostSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** The sheet's title, which V1 sets to the job's own title rather than a fixed word. */
  title: string;
  /** The job's figures. Absent while the detail read is still out. */
  job?: JobCostFacts;
}

/**
 * The sheet's body: V1's details list, then its breakdown table.
 *
 * Every details row is kept and dashed when empty, as V1 does, so which facts the sheet reports is
 * the same for every job and a blank Profile reads as "none recorded" rather than as a row the
 * reader has to notice is missing.
 */
/**
 * V1's Cost & Tokens sheet (`JobsApp.cs:51`), opened by the Cost *and* Tokens cells.
 *
 * **It owns its panel**, like every other sheet here. It used to be a body `JobsView` wrapped in a
 * `<Sheet>`, which meant it could not be looked at without a harness inventing chrome it does not
 * have, and two callers could have given it different panels. The `<Sheet>` below is `JobsView`'s
 * own, moved: the same `UxHelper.SheetWidth` ladder as the Debug and Output sheets, and the job's
 * title rather than a fixed one.
 */
export const JobCostSheet: React.FC<JobCostSheetProps> = ({ isOpen, onClose, title, job }) => {
  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        data-testid="job-cost-sheet-panel"
        className="inset-y-0 flex w-full flex-col overflow-hidden p-0 sm:w-3/4 sm:max-w-none lg:w-1/2 xl:w-2/5"
      >
        <HeaderLayout
          className="min-h-0 flex-1"
          header={
            <SheetHeader className="pr-8">
              <SheetTitle>{title}</SheetTitle>
            </SheetHeader>
          }
        >
          {job ? (
            <JobCostBody job={job} />
          ) : (
            <span className="text-xs text-muted-foreground" data-testid="job-cost-pending">
              Loading job details…
            </span>
          )}
        </HeaderLayout>
      </SheetContent>
    </Sheet>
  );
};

/** The details list and breakdown table, which is what used to be the whole component. */
const JobCostBody: React.FC<{ job: JobCostFacts }> = ({ job }) => {
  const buckets = buildJobCostBuckets(job);
  const bucketTotal = buckets.reduce((sum, bucket) => sum + bucket.tokens, 0);
  // The breakdown is the sum of what was reported; `tokens` is the daemon's own total. They agree on
  // a job with a full breakdown, and on one without the total is all there is to show.
  const total = buckets.length > 0 ? bucketTotal : job.tokens;

  const details: Array<[string, string]> = [
    ["Model", dash(job.model)],
    ["Provider", dash(job.provider)],
    ["Type", dash(job.type)],
    ["Profile", dash(job.executionProfile)],
    ["Cost Reported by Agent", agentReportedCost(job)],
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="job-cost-sheet">
      <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2 text-xs">
        {details.map(([label, value]) => (
          <React.Fragment key={label}>
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
          No per-token breakdown was recorded for this job
          {typeof job.tokens === "number"
            ? `, only a total of ${formatTokens(job.tokens)} tokens`
            : ""}
          .
        </Callout.Info>
      ) : (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-foreground">Breakdown</h4>
          <table className="w-full text-xs" data-testid="job-cost-breakdown">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1 text-left font-medium">Token type</th>
                <th className="py-1 text-right font-medium">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.kind} className="border-b border-border/50">
                  <td className="py-1 text-left text-foreground">{bucket.kind}</td>
                  <td className="py-1 text-right font-mono text-foreground">
                    {formatTokens(bucket.tokens)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <td className="py-1 text-left text-foreground">Total</td>
                <td className="py-1 text-right font-mono text-foreground">
                  {typeof total === "number" ? formatTokens(total) : NO_VALUE}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2 border-t border-border pt-3 text-xs">
        <dt className="text-muted-foreground">Total cost</dt>
        <dd className="min-w-0 font-mono text-foreground">{totalCost(job)}</dd>
      </dl>
    </div>
  );
};
