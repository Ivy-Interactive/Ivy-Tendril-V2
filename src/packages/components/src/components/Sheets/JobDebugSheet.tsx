import React, { useState } from "react";
import { Bug, ClipboardCopy } from "lucide-react";
import { copyToClipboard } from "../../lib/clipboard";
import { Button } from "../ui/button";
import { HeaderLayout } from "../ui/panel-layout";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { i18n, useTranslation, type TFunction } from "@/i18n/uiDialogs";
import { useTranslation as useJobsTranslation } from "@/i18n/uiJobs";
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
 * V1 also carries a `Report Bug` button and, under `#if DEBUG`, a "Debug with {agent}" button that
 * opens a chat pre-loaded with these details and the `/tendril-debug-job` skill. Both are here as
 * callbacks - `onReportBug` and `onDebugWithAgent` - and each button renders only when its callback
 * is passed, because the dialogs they open (`ReportBugDialog`, `DebugWithAgentDialog`) and what those
 * dialogs do belong to the app. The agent prompt is built from {@link formatJobDebugDetails}, the
 * same block Copy Details puts on the clipboard, exactly as V1 feeds `FormatCopyDetails` to both.
 */

/** The fields of the debug panel, by stable id. Each names its label in the catalog. */
type JobDebugFieldId =
  | "jobId"
  | "planId"
  | "planTitle"
  | "status"
  | "type"
  | "project"
  | "provider"
  | "model"
  | "started"
  | "completed"
  | "lastOutput"
  | "duration"
  | "cost"
  | "tokens"
  | "processId"
  | "detached"
  | "workingDirectory"
  | "arguments"
  | "args"
  | "failureReason"
  | "permissionDenials"
  | "planFolder"
  | "jobLog"
  | "jobPrompt"
  | "jobRawLog"
  | "jobEventwireLog";

/** One row of the debug panel: V1's label, the rendered value, and whether it needs its own line. */
export interface JobDebugField {
  /** The row's stable identity - its React key - whatever language the label is in. */
  id: string;
  label: string;
  value: string;
  /** V1's `.Multiline(...)`: rendered under its label rather than beside it. */
  multiline?: boolean;
}

/**
 * The `t` a caller outside React gets when it passes none: it translates into the language current
 * at each call, so it is safe at module level. The sheet passes its own, which re-renders it when
 * the language changes.
 */
const translateAtCall: TFunction = i18n.getFixedT(null, "uiDialogs");

/**
 * The `t` the Copy Details text is built with, whatever the UI language: the paste goes into bug
 * reports and agent chats, which read V1's labels and V1's number formats (`$1234.5679`,
 * `24,000`), not the reader's.
 */
const translateInEnglish: TFunction = i18n.getFixedT("en", "uiDialogs");

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
 *
 * `t` decides the language of the labels and of the numbers (duration, cost, tokens): the sheet
 * passes the UI's, the Copy Details text English. The other values are the engine's record, shown
 * as it is in both - ids, paths, the command line, the UTC `"u"` timestamps, `true` for Detached,
 * and the raw `status` and `type`: the status line carries the daemon's own English message, and a
 * reader matches both against the logs and the CLI, which print them raw.
 */
export function buildJobDebugFields(
  job: JobDebugDetail,
  t: TFunction = translateAtCall,
): JobDebugField[] {
  const tokens = job.tokens;
  const field = (id: JobDebugFieldId, value: string, multiline = false): JobDebugField => ({
    id,
    label: t(`jobDebug.fields.${id}`),
    value,
    ...(multiline ? { multiline: true } : {}),
  });
  const fields: JobDebugField[] = [
    field("jobId", job.id),
    field("planId", job.planId ?? ""),
    field("planTitle", job.planTitle ?? "", true),
    // V1 folds the message into the status, so a failure reads as one line rather than two fields.
    field("status", job.statusMessage ? `${job.status}: ${job.statusMessage}` : job.status, true),
    field("type", job.type),
    field("project", job.project),
    field("provider", job.provider ?? ""),
    field("model", job.model ?? ""),
    field("started", formatUniversalTime(job.startedAt)),
    field("completed", formatUniversalTime(job.completedAt)),
    // The staleness anchor the Jobs table's Agent Output column counts from. Not one of V1's fields —
    // V1 keeps `LastOutputAt` in memory only, so its debug sheet has nothing to show — and it is the
    // first thing worth knowing about a job that looks stuck.
    field("lastOutput", formatUniversalTime(job.lastOutputAt)),
    field(
      "duration",
      job.durationSeconds === undefined
        ? ""
        : t("jobDebug.values.duration", { seconds: job.durationSeconds }),
    ),
    // Four decimals, not two: this is the diagnostic view, and a sub-cent run is exactly the case the
    // table's `$0.00` cannot distinguish from free. Ungrouped, as V1's fixed-point `$1234.5679` is.
    // Rounded by `toFixed` first, as V1 rounds it: `Intl` rounds a tie such as 0.00015 (50 tokens at
    // $3/M) up where `toFixed` rounds it down, so this way the catalog's format only adds the symbol
    // and the language's separators.
    field(
      "cost",
      job.cost === undefined
        ? ""
        : t("jobDebug.values.cost", { cost: Number(job.cost.toFixed(4)) }),
    ),
    field("tokens", tokens === undefined ? "" : t("jobDebug.values.tokens", { tokens })),
    field("processId", job.processId === undefined ? "" : String(job.processId)),
    // Only when true, matching how the daemon and the DTO both report it.
    field("detached", job.detached ? "true" : ""),
    field("workingDirectory", job.workingDirectory ?? "", true),
    field("arguments", job.cliCommand ?? "", true),
    field("args", job.args ?? "", true),
    field("failureReason", job.reportedFailureReason ?? "", true),
    field("permissionDenials", (job.permissionDenials ?? []).join("\n"), true),
    // Paths last, as V1 groups them: a pasted report reads as the run's story followed by where to
    // look. Each is present only if the daemon wrote that artifact.
    field("planFolder", job.planFolder ?? "", true),
    field("jobLog", job.jobLogPath ?? "", true),
    field("jobPrompt", job.jobPromptPath ?? "", true),
    field("jobRawLog", job.jobRawLogPath ?? "", true),
    field("jobEventwireLog", job.jobEventwirePath ?? "", true),
  ];

  return fields.filter((field) => field.value.length > 0);
}

/**
 * `FormatCopyDetails`: `Label: value` a line at a time, empty fields already dropped.
 *
 * The same record the panel renders, for the reason V1 gives — labels defined once, so what is pasted
 * into a bug report is what was on screen. The sheet builds it in English (see
 * {@link buildJobDebugFields}), so in another language the paste carries the same rows under V1's
 * labels.
 */
export function formatJobDebugDetails(fields: readonly JobDebugField[]): string {
  return fields.map((field) => `${field.label}: ${field.value}`).join("\n");
}

/**
 * The Copy Details text for a job, in English whatever the UI language: the same block the sheet's
 * Copy Details button puts on the clipboard, for a caller that needs it without the sheet.
 */
export function formatJobDebugDetailsForJob(job: JobDebugDetail): string {
  return formatJobDebugDetails(buildJobDebugFields(job, translateInEnglish));
}

/**
 * The prompt V1's "Debug with {agent}" opens a chat with (`JobDebugSheet.cs`, under `#if DEBUG`),
 * verbatim - its wording included, since the `/tendril-debug-job` skill is written against it. It is
 * instructions to an agent, not UI, so it is English in every language, followed by the job's Copy
 * Details block.
 */
export function formatJobDebugPrompt(job: JobDebugDetail, focus?: string): string {
  let prompt = `I want to debug job ${job.id} for what might have gone wrong of what we can improve. Use the /tendril-debug-job skill if available. \n\n`;
  const trimmed = focus?.trim();
  if (trimmed) prompt += `In particular, focus on: ${trimmed}\n\n`;
  return prompt + formatJobDebugDetailsForJob(job);
}

export interface JobDebugSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** The job's detail. Absent while the read is still out, which the sheet says rather than
   *  rendering a table of blanks. */
  job?: JobDebugDetail;
  /** V1's `Report Bug` button (`JobDebugSheet.cs`), which opens `ReportBugDialog`. Omitted, no button. */
  onReportBug?: () => void;
  /**
   * V1's "Debug with {agent}" button, which opens `DebugWithAgentDialog`. V1 compiles it in only
   * under `#if DEBUG`, so the host decides whether to pass it. Omitted, no button.
   */
  onDebugWithAgent?: () => void;
  /** The configured coding agent's name for that button, V1's `AgentBranding.Label`. */
  debugAgentLabel?: string;
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
export const JobDebugSheet: React.FC<JobDebugSheetProps> = ({
  isOpen,
  onClose,
  job,
  onReportBug,
  onDebugWithAgent,
  debugAgentLabel,
}) => {
  const { t } = useTranslation("uiDialogs");
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
              <SheetTitle>{t("jobDebug.title")}</SheetTitle>
            </SheetHeader>
          }
        >
          {job ? (
            <JobDebugBody
              job={job}
              onReportBug={onReportBug}
              onDebugWithAgent={onDebugWithAgent}
              debugAgentLabel={debugAgentLabel}
            />
          ) : (
            /* The detail is the sheet, so there is nothing to render until it lands - and if the
               daemon could not answer, this is the honest state rather than a table of blanks. */
            <span className="text-xs text-muted-foreground" data-testid="job-debug-pending">
              {t("jobDebug.loading")}
            </span>
          )}
        </HeaderLayout>
      </SheetContent>
    </Sheet>
  );
};

/** The details table itself, which is what used to be the whole component. */
const JobDebugBody: React.FC<
  Pick<JobDebugSheetProps, "onReportBug" | "onDebugWithAgent" | "debugAgentLabel"> & {
    job: JobDebugDetail;
  }
> = ({ job, onReportBug, onDebugWithAgent, debugAgentLabel }) => {
  const { t } = useTranslation("uiDialogs");
  const { t: tJobs } = useJobsTranslation("uiJobs");
  const fields = buildJobDebugFields(job, t);
  const [copied, setCopied] = useState(false);
  // The clipboard's own message when it gave one; `message` absent means the sheet's fallback.
  const [copyError, setCopyError] = useState<{ message?: string } | null>(null);

  const copy = async () => {
    setCopyError(null);
    try {
      await copyToClipboard(formatJobDebugDetails(buildJobDebugFields(job, translateInEnglish)));
      setCopied(true);
    } catch (err) {
      // A webview that refuses clipboard access is the one case worth a word: the whole point of the
      // button is that the text left the app, and a silent failure looks identical to success.
      setCopyError(err instanceof Error ? { message: err.message } : {});
    }
  };

  return (
    <HeaderLayout
      className="min-h-0 flex-1"
      header={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copy()}
            data-testid="job-debug-copy"
          >
            <ClipboardCopy aria-hidden="true" />
            {copied ? t("jobDebug.copied") : t("jobDebug.copy")}
          </Button>
          {/* V1's header, in V1's order: Copy Details, Report Bug, then the DEBUG-only agent. */}
          {onReportBug && (
            <Button
              type="button"
              size="sm"
              onClick={onReportBug}
              data-testid="job-debug-report-bug"
            >
              <Bug aria-hidden="true" />
              {tJobs("jobDebug.reportBug")}
            </Button>
          )}
          {onDebugWithAgent && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onDebugWithAgent}
              data-testid="job-debug-with-agent"
            >
              {tJobs("jobDebug.debugWithAgent", { agent: debugAgentLabel ?? "Agent" })}
            </Button>
          )}
          {copyError && (
            <span role="alert" className="text-xs text-destructive">
              {copyError.message ?? t("jobDebug.copyFailed")}
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
          <React.Fragment key={field.id}>
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
