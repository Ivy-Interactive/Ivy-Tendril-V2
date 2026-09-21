import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  dataTableLinkClass,
  Spinner,
  type DataTableColumn,
  type DataTableFilterOption,
  type RemoteSortColumn,
} from "@ivy-interactive/components/ui";
import { fetchTableColumnValues } from "../../api/tableQuery";
import {
  JOB_STATUS_COLOR,
  JOB_TYPE_COLOR,
  UNMAPPED_COLOR,
  projectColor,
} from "../../utils/jobStatus";
import { parseProjects } from "../PlansView";
import { NO_TIME, NO_VALUE, formatMonthDayTime, formatTimeSpan, formatTokens } from "./format";
import type { JobRow } from "./rows";

/**
 * How the table is drawn and ordered: the column declarations, the `Jobs` columns SQLite sorts by,
 * and the `SELECT DISTINCT` vocabulary the filter editor offers for the three closed-set columns.
 * The cells' side of `./rows.tsx`.
 */

/**
 * The table's initial order, and V1's declared one: `.SortDirection(t => t.Id, SortDirection.Descending)`
 * (`JobsApp.DataTable.cs:85`) — newest job first.
 *
 * Executed by SQLite now rather than in the client. V1 reached the same order through
 * `OrderByDescending(ExtractJobNumber(r.Id))`, a *numeric* extraction, and `ORDER BY Id DESC` is a
 * *lexicographic* one; they agree for every id the daemon issues, because `allocate_job_id`
 * (`jobs/manager.rs:414`) formats them as `{:05}` and equal-width numeric strings sort the same either
 * way. They would diverge past job 99999, where a six-digit id sorts below a five-digit one — a real but
 * distant divergence, and one no client-side sort could fix now that the client holds a window rather
 * than the table.
 */
export const JOBS_INITIAL_SORT = { column: "id", direction: "Descending" } as const;

/**
 * Each column of the table, and the `Jobs` column SQLite must order by when its header is clicked.
 *
 * `JobRow`'s field names are a *rendering*, not a schema, so four of them have to say what they mean to
 * the database. Two are renames the filter already declares (`planId` → `PlanFile`, `prompt` →
 * `ReportedPlanTitle`) and are repeated here only because `resolveRemoteSort` reads a list of names
 * rather than the rendered columns — the fetcher is built before them. Two are genuinely derived:
 *
 * - **Timer** counts up from `StartedAt` for a running job and shows the recorded duration for a
 *   finished one, so `DurationSeconds` is the closest total order the table has. Running rows have no
 *   duration yet, so they group at the `NULL` end rather than interleaving by elapsed time.
 * - **Agent Output** counts up from `LastOutputAt` for a running job, so the column has no total order
 *   of its own: `Status` is what groups the three forms the cell takes (an elapsed silence, `Done`,
 *   `-`). Ordering by `LastOutputAt` instead would be a real order over running rows and meaningless
 *   over every other row, which is the larger part of any job list. V1 cannot express it either — it
 *   sorts the rendered string.
 *
 * Everything else resolves by name: the daemon matches a column case- and underscore-insensitively, so
 * `statusMessage` reaches `StatusMessage`.
 */
export const SORT_COLUMNS: RemoteSortColumn[] = [
  { name: "id" },
  { name: "status" },
  { name: "planId", sortColumn: "planFile" },
  { name: "prompt", sortColumn: "reportedPlanTitle" },
  { name: "type" },
  { name: "project" },
  { name: "timer", sortColumn: "durationSeconds" },
  { name: "agentOutput", sortColumn: "status" },
  { name: "cost" },
  { name: "tokens" },
  { name: "timestamp", sortColumn: "completedAt" },
  { name: "statusMessage" },
];

/**
 * One column's distinct values, from `POST /api/tables/jobs/values`.
 *
 * `SELECT DISTINCT` over the whole `Jobs` table, not over the rows the client happens to hold — which is
 * the only way a filter vocabulary can be right once the table is paged. The daemon caps and can search
 * the list server-side, so it stays one small response on a column with a million distinct values.
 *
 * A failure leaves the list empty rather than surfacing: this is the filter editor's *help*, and a
 * daemon that cannot answer it has already failed the table's own query, which is where the operator is
 * told (see `jobs-table-error`). Fetched once per mount: a job list's statuses, types and projects do
 * not turn over inside a session, and re-reading them on every poll would be three requests a second
 * for a list that never changes.
 *
 * @param split For a column that stores a joined list, how one stored value becomes several offered
 *   ones. `Project` holds "web, api".
 */
export function useColumnValues(
  column: string,
  split?: (value: string) => string[],
): DataTableFilterOption[] {
  const [options, setOptions] = useState<DataTableFilterOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchTableColumnValues("jobs", column)
      .then((page) => {
        if (cancelled) return;
        const values = page.values.map(String).flatMap((value) => split?.(value) ?? [value]);
        setOptions(
          Array.from(new Set(values.filter((value) => value.length > 0)))
            .sort((a, b) => a.localeCompare(b))
            .map((value) => ({ value, label: value })),
        );
      })
      .catch(() => {
        /* See above: the table's own error is the one worth showing. */
      });
    return () => {
      cancelled = true;
    };
    // `split` is a module-level function at every call site, so it is stable by construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column]);

  return options;
}

/**
 * What the column declarations close over. The three option lists are passed in rather than fetched
 * here so they stay where they were in the view's hook order; see {@link useColumnValues}.
 */
export interface JobColumnsOptions {
  /** Present only when the shell can route to a plan: the Plan Id cell is a link when it is. */
  onSelectPlan?: (planId: string) => void;
  /** V1's Plan Id cell action. */
  openPlan: (planId: string) => void;
  /** V1's `showOutput(id)`: the output sheet, over the table. */
  openJobOutput: (jobId: string) => void;
  /** V1's `showCost(id)`: the Cost & Tokens sheet, opened by the Cost *and* Tokens cells. */
  openJobCost: (jobId: string) => void;
  /** V1's `showPrompt(...)`: the full, untruncated prompt. */
  openJobPrompt: (jobId: string) => void;
  statusOptions: DataTableFilterOption[];
  typeOptions: DataTableFilterOption[];
  projectOptions: DataTableFilterOption[];
}

export function useJobColumns({
  onSelectPlan,
  openPlan,
  openJobOutput,
  openJobCost,
  openJobPrompt,
  statusOptions,
  typeOptions,
  projectOptions,
}: JobColumnsOptions): DataTableColumn<JobRow>[] {
  /**
   * V1's columns, in V1's order, at V1's widths, with the headers Ivy derives from the property
   * names via `SplitPascalCase` (so `PlanId` reads "Plan Id" and `StatusMessage` "Status Message").
   * `Id` is present and hidden, as `.Hidden(t => t.Id)` leaves it: reachable from the column options
   * and absent from the DOM until then.
   */
  const columns = useMemo<DataTableColumn<JobRow>[]>(
    () => [
      // `.Filterable(t => t.Id, false)` (`:83`) as well as `.Hidden(...)`: no filter control.
      { name: "id", header: "Id", width: "90px", hidden: true },
      {
        name: "status",
        header: "Status",
        width: "100px",
        // A closed set, so the editor can offer its values: `[Status] in ("Running", "Queued")` is the
        // `inSet` condition the framework's editor cannot type but its proto has had all along.
        filter: { kind: "select", options: statusOptions, placeholder: "All" },
        accessor: (row) => row.status,
        cell: (_value, row) => (
          <div className="flex items-center gap-1">
            {/* V1's `LabelsDisplayRenderer` over `Constants.JobStatusColors` — the colour *is* the way
                this column is read at a glance, so it is V1's colour and not an approximation. */}
            <Badge color={JOB_STATUS_COLOR[row.status] ?? UNMAPPED_COLOR} density="Small">
              {row.status}
            </Badge>
            {/* Not a V1 column: V1 has no notion of a detached job. `JobSessionView` shows the same
                badge for one, and a row that a previous daemon started is worth flagging where the
                Stop action is offered. */}
            {row.detached && (
              <Badge
                color="Orange"
                density="Small"
                data-testid={`job-detached-${row.id}`}
                title={`Detached (PID ${row.processId ?? "unknown"}) — monitoring an active process started before the last daemon restart`}
              >
                Detached
              </Badge>
            )}
          </div>
        ),
      },
      {
        name: "planId",
        header: "Plan Id",
        width: "80px",
        // Both columns the cell can be showing, ORed. The value rendered is `reportedPlanId` when the
        // promptware reported one and the id read off `planFile` otherwise, so filtering either alone
        // silently missed whichever jobs took the other route — and `[Plan Id] = "00681"` matched
        // nothing at all, because `planFile` holds a folder path rather than a bare id.
        filter: {
          kind: "text",
          column: "reportedPlanId",
          alsoColumns: ["planFile"],
          placeholder: "Id…",
        },
        // V1's Plan Id cell action navigates (`JobsApp.DataTable.cs:95-141`), so this is the framework's
        // *link* cell: `cursor: pointer` on the cell and blue underlined text in it.
        clickable: Boolean(onSelectPlan),
        // The handler sits on the column so the whole cell navigates, not just the few characters the
        // id occupies. A row with no plan declares none: an empty Plan Id cell has nowhere to go, and
        // clicking it must fall through to the row rather than navigate to "".
        onCellClick: onSelectPlan
          ? (row) => {
              if (row.planId) openPlan(row.planId);
            }
          : undefined,
        accessor: (row) => row.planId,
        cell: (_value, row) =>
          row.planId ? (
            onSelectPlan ? (
              /* Still an element rather than bare text: this is the framework's *link* cell, so it
                 carries the blue underline, and it stays focusable for keyboard reach. The click is
                 the column's - this only has to not swallow it. */
              <span
                className={`font-mono text-xs ${dataTableLinkClass}`}
                data-testid={`job-plan-${row.id}`}
              >
                {row.planId}
              </span>
            ) : (
              <span className="font-mono text-xs text-muted-foreground">{row.planId}</span>
            )
          ) : null,
      },
      {
        name: "prompt",
        header: "Prompt",
        width: "250px",
        // V1's free-text `[Prompt] contains "…"`, as a box. The cell reads `ReportedPlanTitle` when the
        // agent has reported a plan and the launch arguments otherwise, so the filter has to reach both
        // columns or it silently misses whichever jobs took the other route — which for a batch of
        // `CreatePlan`s imported from the Inbox is all of them.
        filter: { kind: "text", column: "reportedPlanTitle", alsoColumns: ["args"] },
        // V1's Prompt cell action opens a `PromptSheet` with the untruncated prompt
        // (`JobsApp.cs:51`), resolved from the job's typed args or the plan's `InitialPrompt`.
        clickable: true,
        onCellClick: (row) => openJobPrompt(row.id),
        accessor: (row) => row.prompt,
        // The cell still truncates to V1's 500 characters and still carries the full text as a
        // `title`; the sheet is what shows it wrapped and selectable, which a tooltip cannot.
        cell: (_value, row) => (
          <span className="text-sm text-foreground" title={row.prompt || undefined}>
            {row.prompt}
          </span>
        ),
      },
      {
        name: "type",
        header: "Type",
        width: "100px",
        filter: { kind: "select", options: typeOptions, placeholder: "All" },
        accessor: (row) => row.type,
        // `Constants.JobTypeColors`, all eleven hues (`JobsApp.DataTable.cs:68-74`). Reachable because
        // the design system publishes a token per Ivy colour and `Badge`'s `color` tints from it — so
        // this is a categorical palette the theme already owns, not a decorative ramp invented here.
        cell: (_value, row) => (
          <Badge color={JOB_TYPE_COLOR[row.type] ?? UNMAPPED_COLOR} density="Small">
            {row.type}
          </Badge>
        ),
      },
      {
        name: "project",
        header: "Project",
        width: "150px",
        // `contains`, because a job can name several projects and the cell (and the column) holds them
        // joined: "web, api" is equal to neither "web" nor "api".
        filter: {
          kind: "select",
          options: projectOptions,
          placeholder: "All",
          function: "contains",
        },
        accessor: (row) => row.project,
        cell: (_value, row) => (
          <div className="flex flex-wrap items-center gap-1">
            {/* V1 colours each project from configuration; see {@link projectColor} for why this is
                derived from the name instead. Coloured either way, because that is what makes two
                projects tellable apart in a list of a hundred rows. */}
            {parseProjects(row.project).map((project) => (
              <Badge key={project} color={projectColor(project)} density="Small">
                {project}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        name: "timer",
        header: "Timer",
        width: "80px",
        // Derived from `StartedAt` for a running job, so the database's closest total order is the
        // recorded duration. See {@link SORT_COLUMNS}.
        sortColumn: "durationSeconds",
        // Filtered as the recorded duration in seconds, so `> 300` asks for runs over five minutes.
        // V1 could only match its formatted `1:04` as a string.
        filter: { kind: "text", column: "durationSeconds", placeholder: "Seconds…" },
        accessor: (row) => row.timerSeconds,
        cell: (_value, row) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.timerSeconds === null ? NO_TIME : formatTimeSpan(row.timerSeconds)}
          </span>
        ),
      },
      {
        name: "agentOutput",
        header: "Agent Output",
        width: "100px",
        // How long since the agent last wrote a line, not its status message — that has its own column.
        // `Status` is what groups the three forms this cell takes; see {@link SORT_COLUMNS}.
        sortColumn: "status",
        // The cell counts up from `lastOutputAt`, so that is what a filter on it means.
        filter: { kind: "text", column: "lastOutputAt", placeholder: "Date…" },
        // V1's cell action here opens the output sheet rather than navigating, which is the framework's
        // plain clickable cell: the cursor, and no link styling.
        clickable: true,
        // V1's cell action is `showOutput(id)`: the output sheet, over the table. On the column, so
        // the whole cell opens it - the label here is often just "-", which is a very small target.
        onCellClick: (row) => openJobOutput(row.id),
        accessor: (row) => row.agentOutput,
        cell: (_value, row) => (
          <span
            className="flex items-center gap-1 text-xs text-muted-foreground"
            data-testid={`job-output-${row.id}`}
          >
            {row.agentOutput === "running" ? (
              <>
                <Spinner size="xs" className="text-info" aria-hidden="true" />
                {/* Monospace so a figure that ticks every second does not reflow the cell around it. */}
                <span className="font-mono">{row.agentOutputLabel}</span>
              </>
            ) : row.agentOutput === "done" ? (
              <span className="text-success">{row.agentOutputLabel}</span>
            ) : (
              row.agentOutputLabel
            )}
          </span>
        ),
      },
      {
        name: "cost",
        header: "Cost",
        width: "80px",
        align: "Right",
        // The real numeric column, so `> 5` means five dollars. V1 filtered its rendered `~$1.23`.
        filter: { kind: "text", column: "cost", placeholder: "Amount…" },
        // V1's Cost cell action is `showCost(id)` - the Cost & Tokens sheet, which is where the `~`
        // on this cell is explained. Same destination as Tokens below, as in V1.
        clickable: true,
        onCellClick: (row) => openJobCost(row.id),
        accessor: (row) => row.costValue,
        cell: (_value, row) => (
          <span
            className="font-mono text-xs text-foreground"
            data-testid={`job-cost-${row.id}`}
            title={row.cost === null ? "No cost was reported for this job" : undefined}
          >
            {row.cost ?? NO_VALUE}
          </span>
        ),
      },
      {
        name: "tokens",
        header: "Tokens",
        width: "80px",
        align: "Right",
        filter: { kind: "text", column: "tokens", placeholder: "Count…" },
        // V1's Tokens cell action is `showCost(id)` as well (`JobsApp.DataTable.cs:156`): the one
        // sheet breaks both figures down, so both cells lead to it.
        clickable: true,
        onCellClick: (row) => openJobCost(row.id),
        accessor: (row) => row.tokens,
        cell: (_value, row) => (
          <span
            className="font-mono text-xs text-foreground"
            data-testid={`job-tokens-${row.id}`}
            title={
              row.tokens === null
                ? undefined
                : [row.tokens.toLocaleString("en-US"), row.tokenBreakdown]
                    .filter(Boolean)
                    .join(" — ")
            }
          >
            {row.tokens === null ? NO_VALUE : formatTokens(row.tokens)}
          </span>
        ),
      },
      {
        name: "timestamp",
        header: "Timestamp",
        width: "110px",
        sortColumn: "completedAt",
        // The stored RFC 3339 stamp, so `starts with "2026-09-17"` asks for a day and `>` for a cutoff.
        filter: { kind: "text", column: "completedAt", placeholder: "Date…" },
        accessor: (row) => row.completedAtMs,
        // `FormatTimestamp`: `MM-dd HH:mm` in the viewer's local time, "-" until the job finishes.
        cell: (_value, row) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.completedAtMs === null ? NO_TIME : formatMonthDayTime(row.completedAtMs)}
          </span>
        ),
      },
      {
        name: "statusMessage",
        header: "Status Message",
        width: "auto",
        filter: { kind: "text" },
        accessor: (row) => row.statusMessage,
        cell: (_value, row) => (
          <span className="text-xs text-muted-foreground" title={row.statusMessage || undefined}>
            {row.statusMessage}
          </span>
        ),
      },
    ],
    // `onSelectPlan` and the sheet opener are the only closures the cells capture; the three option
    // lists are the only other thing a column declaration reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSelectPlan, statusOptions, typeOptions, projectOptions],
  );

  return columns;
}
