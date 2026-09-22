import React, { useState } from "react";
import { ClipboardCopy } from "lucide-react";
import { copyToClipboard } from "../../lib/clipboard";
import { Button } from "../ui/button";
import { HeaderLayout } from "../ui/panel-layout";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
/**
 * A job as this sheet renders it.
 *
 * Declared here rather than imported from the app's `JobDebugDetail`, on the rule `PlanGitView` states:
 * the component that renders a shape owns its declaration and cannot import from the app. Every
 * field is optional except the four a job always has, because the sheet renders each row only when
 * it is present - which is what makes it useful at every point in a job's life.
 */
export interface JobDebugDetail {
  id: string;
  type: string;
  status: string;
  project: string;
  planId?: string;
  planTitle?: string;
  statusMessage?: string;
  startedAt?: string;
  completedAt?: string;
  lastOutputAt?: string;
  durationSeconds?: number;
  /** The agent process, while one is alive. V1's `ProcessId` / `Detached`. */
  processId?: number;
  detached?: boolean;
  tokens?: number;
  cost?: number;
  model?: string;
  agent?: string;
  permissionDenials?: string[];
  args?: string;
  workingDirectory?: string;
  reportedFailureReason?: string;
  provider?: string;
  cliCommand?: string;
  planFolder?: string;
  jobLogPath?: string;
  jobPromptPath?: string;
  jobRawLogPath?: string;
  jobEventwirePath?: string;
}

/**
 * V1's Job Debug sheet (`Apps/Views/Sheets/JobDebugSheet.cs`), which the Jobs table's **Debug** row
 * action opens (`JobsApp.DataTable.cs:201`).
 *
 * What it is for, which is what decides the shape here: one place to read everything the engine
 * recorded about a run, and one button that puts the same thing on the clipboard so it can be pasted
 * into a bug report or handed to an agent. V1's sheet is a `.ToDetails()` table over a flat record plus
 * a `Copy Details` button over the *same* record — `FormatCopyDetails` projects the model the table
 * renders, so the two can never disagree. That is reproduced literally: {@link buildJobDebugFields} is
 * the record, and both the panel and {@link formatJobDebugDetails} read it.
 *
 * V1 also carries a `Report Bug` dialog and, under `#if DEBUG`, a "Debug with {agent}" button that
 * opens a chat pre-loaded with these details and the `/tendril-debug-job` skill. Neither is here: the
 * first needs `ReportBugDialog`, the second needs `ChatLauncher`, and both are their own ports. The
 * Copy Details text is deliberately the *same* block V1 feeds that agent prompt, so pasting it into a
 * chat by hand reaches the same place.
 */

/** One row of the debug panel: V1's label, the rendered value, and whether it needs its own line. */
export interface JobDebugField {
  label: string;
  value: string;
  /** V1's `.Multiline(...)`: rendered under its label rather than beside it. */
  multiline?: boolean;
}

/** `"u"`, the format V1 stamps `Started`/`Completed` with: sortable, unambiguous, UTC. */
function formatUniversalTime(value: string | undefined): string {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return `${new Date(parsed).toISOString().slice(0, 19).replace("T", " ")}Z`;
}

/**
 * `JobDebugSheet.BuildData` over the fields V2's DTO carries, in V1's order and under V1's labels.
 *
 * Empty values are dropped rather than rendered blank, which is V1's `.RemoveEmpty()` on the details
 * view and the `Where(!IsNullOrEmpty)` in its copy projection — a debug panel of twenty "—" rows buries
 * the three fields that were actually populated.
 *
 * **Two of V1's fields are still absent, and not because this projection drops them:** V2's `JobItem`
 * has no `SessionId` and no `ExitCode` — neither field exists on the job, in the database or on the
 * wire, so there is nothing for the DTO to carry. (V1's `ExitCode` is `[JsonIgnore]` too; its sheet
 * reads it in-process.) Reported here rather than faked, because a debug panel that invents a field is
 * worse than one that is missing it.
 *
 * `Arguments` is V1's field and V1's label: `JobItem.CliCommand`, the command line the agent was
 * actually launched with. `Args` is kept beside it — the `JobArgs` JSON the job was submitted with,
 * which V1 does not show and which answers a different question about the same run.
 *
 * The four log paths and the plan folder come from `tendril_core::jobs::logger` by way of the DTO, and
 * only when the file exists, so a path here is one that can be opened. V1 groups them last for a
 * readable paste; so does this.
 */
export function buildJobDebugFields(job: JobDebugDetail): JobDebugField[] {
  const tokens = job.tokens;
  const fields: JobDebugField[] = [
    { label: "Job Id", value: job.id },
    { label: "Plan Id", value: job.planId ?? "" },
    { label: "Prompt/Title", value: job.planTitle ?? "", multiline: true },
    // V1 folds the message into the status, so a failure reads as one line rather than two fields.
    {
      label: "Status",
      value: job.statusMessage ? `${job.status}: ${job.statusMessage}` : job.status,
      multiline: true,
    },
    { label: "Type", value: job.type },
    { label: "Project", value: job.project },
    { label: "Provider", value: job.provider ?? "" },
    { label: "Model", value: job.model ?? "" },
    { label: "Started", value: formatUniversalTime(job.startedAt) },
    { label: "Completed", value: formatUniversalTime(job.completedAt) },
    // The staleness anchor the Jobs table's Agent Output column counts from. Not one of V1's fields —
    // V1 keeps `LastOutputAt` in memory only, so its debug sheet has nothing to show — and it is the
    // first thing worth knowing about a job that looks stuck.
    { label: "Last Output", value: formatUniversalTime(job.lastOutputAt) },
    {
      label: "Duration",
      value: job.durationSeconds === undefined ? "" : `${job.durationSeconds}s`,
    },
    // Four decimals, not two: this is the diagnostic view, and a sub-cent run is exactly the case the
    // table's `$0.00` cannot distinguish from free.
    { label: "Cost", value: job.cost === undefined ? "" : `$${job.cost.toFixed(4)}` },
    { label: "Tokens", value: tokens === undefined ? "" : tokens.toLocaleString("en-US") },
    { label: "Process Id", value: job.processId === undefined ? "" : String(job.processId) },
    // Only when true, matching how the daemon and the DTO both report it.
    { label: "Detached", value: job.detached ? "true" : "" },
    { label: "Working Directory", value: job.workingDirectory ?? "", multiline: true },
    { label: "Arguments", value: job.cliCommand ?? "", multiline: true },
    { label: "Args", value: job.args ?? "", multiline: true },
    { label: "Failure Reason", value: job.reportedFailureReason ?? "", multiline: true },
    {
      label: "Permission Denials",
      value: (job.permissionDenials ?? []).join("\n"),
      multiline: true,
    },
    // Paths last, as V1 groups them: a pasted report reads as the run's story followed by where to
    // look. Each is present only if the daemon wrote that artifact.
    { label: "Plan Folder", value: job.planFolder ?? "", multiline: true },
    { label: "Job Log", value: job.jobLogPath ?? "", multiline: true },
    { label: "Job Prompt", value: job.jobPromptPath ?? "", multiline: true },
    { label: "Job Raw Log", value: job.jobRawLogPath ?? "", multiline: true },
    { label: "Job Eventwire Log", value: job.jobEventwirePath ?? "", multiline: true },
  ];

  return fields.filter((field) => field.value.length > 0);
}

/**
 * `FormatCopyDetails`: `Label: value` a line at a time, empty fields already dropped.
 *
 * The same record the panel renders, for the reason V1 gives — labels defined once, so what is pasted
 * into a bug report is what was on screen.
 */
export function formatJobDebugDetails(fields: readonly JobDebugField[]): string {
  return fields.map((field) => `${field.label}: ${field.value}`).join("\n");
}

export interface JobDebugSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** The job's detail. Absent while the read is still out, which the sheet says rather than
   *  rendering a table of blanks. */
  job?: JobDebugDetail;
}

/**
 * The sheet's body: V1's details table, and its `Copy Details` button.
 *
 * `HeaderLayout` for the same reason the output sheet uses it — the actions stay put while a long
 * `Args` blob scrolls under them.
 */
/**
 * V1's Job Debug sheet (`JobsApp.cs:62-70`), opened by the Debug row action.
 *
 * **It owns its panel.** It used to be a body that `JobsView` wrapped in a `<Sheet>`, which made it
 * the odd one out: `ErrorSheet` is a sheet, this was a detail table that only became one at its
 * call site. So it could not be looked at on its own without a harness inventing the chrome, and
 * two callers could have given it different panels. The `<Sheet>` below is `JobsView`'s own,
 * moved — same `UxHelper.SheetWidth` ladder, same "Job Debug" title V1 uses, and the same
 * `HeaderLayout` that keeps the title still while a long `Args` blob scrolls under it.
 */
export const JobDebugSheet: React.FC<JobDebugSheetProps> = ({ isOpen, onClose, job }) => {
  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        data-testid="job-debug-sheet"
        className="inset-y-0 flex w-full flex-col overflow-hidden p-0 sm:w-3/4 sm:max-w-none lg:w-1/2 xl:w-2/5"
      >
        <HeaderLayout
          className="min-h-0 flex-1"
          header={
            <SheetHeader className="pr-8">
              <SheetTitle>Job Debug</SheetTitle>
            </SheetHeader>
          }
        >
          {job ? (
            <JobDebugBody job={job} />
          ) : (
            /* The detail is the sheet, so there is nothing to render until it lands - and if the
               daemon could not answer, this is the honest state rather than a table of blanks. */
            <span className="text-xs text-muted-foreground" data-testid="job-debug-pending">
              Loading job details…
            </span>
          )}
        </HeaderLayout>
      </SheetContent>
    </Sheet>
  );
};

/** The details table itself, which is what used to be the whole component. */
const JobDebugBody: React.FC<{ job: JobDebugDetail }> = ({ job }) => {
  const fields = buildJobDebugFields(job);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const copy = async () => {
    setCopyError(null);
    try {
      await copyToClipboard(formatJobDebugDetails(fields));
      setCopied(true);
    } catch (err) {
      // A webview that refuses clipboard access is the one case worth a word: the whole point of
      // the button is that the text left the app, and a silent failure looks identical to success.
      setCopyError(err instanceof Error ? err.message : "Could not copy to the clipboard");
    }
  };

  return (
    <HeaderLayout
      className="min-h-0 flex-1"
      header={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copy()}
            data-testid="job-debug-copy"
          >
            <ClipboardCopy aria-hidden="true" />
            {copied ? "Copied" : "Copy Details"}
          </Button>
          {copyError && (
            <span role="alert" className="text-xs text-destructive">
              {copyError}
            </span>
          )}
        </div>
      }
    >
      <dl
        className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2 text-xs"
        data-testid="job-debug-fields"
      >
        {fields.map((field) => (
          <React.Fragment key={field.label}>
            <dt className="text-muted-foreground">{field.label}</dt>
            <dd
              className={
                field.multiline
                  ? "min-w-0 whitespace-pre-wrap break-words font-mono text-foreground"
                  : "min-w-0 truncate font-mono text-foreground"
              }
              title={field.multiline ? undefined : field.value}
            >
              {field.value}
            </dd>
          </React.Fragment>
        ))}
      </dl>
    </HeaderLayout>
  );
};
