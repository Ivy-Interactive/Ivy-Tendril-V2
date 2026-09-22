import React, { useEffect, useMemo, useRef, useState } from "react";
import { EllipsisVertical, Pause, Trash } from "lucide-react";
import {
  Button,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HeaderLayout,
  resolveRemoteSort,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Spinner,
  StackedProgress,
  useRemoteDataTable,
  type RemoteTableFetcher,
  type RemoteTableFilter,
  useResponsiveDensity,
  Densities,
} from "@ivy-interactive/components/ui";
import { queryJobsPage } from "../api/tableQuery";
import { describeBridgeError, type Job, type JobDetail } from "../types/api";
import { isActiveStatus, jobsStore } from "../state/jobsStore";
import { ErrorBanner } from "../components/ErrorBanner";
import { ConfirmDialog } from "./dialogs";
import { parseProjects } from "./PlansView";
import {
  JOB_CLEAR_SCOPES,
  countJobsByStatus,
  describeClearPrompt,
  type JobClearScope,
} from "./jobs/clear";
import { JOBS_INITIAL_SORT, SORT_COLUMNS, useColumnValues, useJobColumns } from "./jobs/columns";
import {
  buildJobRowActions,
  buildJobRows,
  buildStatusSegments,
  promptSource,
  type JobRow,
  type JobRowActionCapabilities,
} from "./jobs/rows";

export {
  AGENT_OUTPUT_STARTING,
  agentOutputLabel,
  flattenMarkdownLinks,
  formatJobCost,
  formatTimeSpan,
  formatTokens,
  jobStatusMessage,
  truncatePrompt,
  type AgentOutputState,
} from "./jobs/format";
export {
  RERUN_UNAVAILABLE_REASON,
  buildJobRowActions,
  buildJobRows,
  buildStatusSegments,
  promptDisplay,
  type BuildJobRowsOptions,
  type JobRow,
  type JobRowActionCapabilities,
} from "./jobs/rows";
export {
  JOB_CLEAR_SCOPES,
  countJobsByStatus,
  describeClearPrompt,
  type JobClearPrompt,
  type JobClearScope,
} from "./jobs/clear";

/**
 * V1's Jobs table, as a table.
 *
 * `Apps/Jobs/JobsApp.cs` composes exactly one thing: the `DataTable` built by
 * `JobsApp.DataTable.cs`. Everything here is that table - its column set and order, its row menu,
 * its header actions and its status progress bar - over V2's shared `DataTable`, which is the
 * component the structural-parity pass exists to reach ("Tables are tables").
 *
 * What V1 has and V2 cannot yet reach is called out at each site rather than faked: the row menu's
 * Rerun (V1's `RerunJobDialog` needs `JobItem.TypedArgs`, which the Tauri DTO drops), the full-prompt
 * sheet and the Cost & Tokens sheet.
 */

/**
 * The output sheet's body. Lazy for the reason every view in this app is: it is the only thing here
 * that pulls in `AgentViewer`, and it is fetched when a row is opened rather than with the table.
 */
const JobOutput = React.lazy(() =>
  import("./JobSessionView").then((m) => ({ default: m.JobSessionView })),
);

/**
 * V1's Job Debug sheet. Lazy for the same reason as the output sheet: it is opened from one row action
 * and has no business in the table's own chunk.
 */
const JobDebug = React.lazy(() =>
  import("@ivy-interactive/components/dialogs").then((m) => ({ default: m.JobDebugSheet })),
);

/** V1's Cost & Tokens sheet, opened by the Cost and Tokens cells. Lazy for the same reason. */
const JobCost = React.lazy(() =>
  import("./JobCostSheet").then((m) => ({ default: m.JobCostSheet })),
);

/**
 * V1's Full Prompt sheet (`Apps/Jobs/Sheets/PromptSheet.cs`), whose entire body is
 * `new CodeBlock(promptText, Languages.Text).WrapLines()`. Lazy because `CodeBlock` is the door to
 * the syntax-highlighter chunk, which has no business loading with a table of jobs.
 */
const JobPromptBlock = React.lazy(() =>
  import("@ivy-interactive/components/tendril").then((m) => ({ default: m.CodeBlock })),
);

/**
 * `JobsApp.DataTable.cs:93`: `c.BatchSize = 50`. A job list is long and mostly history.
 *
 * In V1 this is the *infinite scroll* window, not a page: the framework's grid fetches fifty rows and
 * appends fifty more each time the visible region comes within ten of the end
 * (`widgets/dataTables/hooks/useDataLoading.ts`), and `LoadAllRows` is never set. V2's table does the
 * same through `useRemoteDataTable({ infinite: true })` and `DataTable`'s `onLoadMore`.
 */
const JOBS_PAGE_SIZE = 50;

/**
 * V1's `RefreshCoalescer` window (`JobsApp.Hooks.cs:13`, `JobRefreshWindow =
 * TimeSpan.FromMilliseconds(400)`): how long a structural change waits for the rest of its burst
 * before the table refetches.
 */
const JOBS_REFRESH_WINDOW_MS = 400;

export interface JobsViewProps {
  jobs: Job[];
  /** Fetched details, for the `detached` flag the list projection omits. */
  jobDetails?: Record<string, JobDetail>;
  /* No `isLoading` here, deliberately. `jobsStore.isLoading` describes `bridge.listJobs`, whose
     result this view uses only as the live-cell overlay; the *table* is fed by `fetchJobsPage`
     through `useRemoteDataTable`, which reports its own request. Passing the first as the table's
     loading state made every 5s poll and every job event swap the empty state for a skeleton and
     back - the flicker on an empty Jobs table - because a request the table does not render was
     driving the table's chrome. */
  /** Opens the plan. See the Plan Id column for how V1's three-way routing collapses. */
  onSelectPlan?: (planId: string) => void;
  /** The two bulk sweeps' confirms, which the shell owns because they are shell-level dialogs. */
  onStopAllQueued: () => void;
  onStopAll: () => void;
}

export const JobsView: React.FC<JobsViewProps> = ({
  jobs,
  jobDetails,
  onSelectPlan,
  onStopAllQueued,
  onStopAll,
}) => {
  /**
   * The job whose output sheet is open. V1 opens `Sheets/OutputSheet.cs` **over** the table
   * (`JobsApp.cs:39` `showOutput`), so the list stays underneath and the operator keeps their place
   * in it; navigating away to a page was the structural divergence this replaces.
   */
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  /** V1's `showDebug(id)`: the Job Debug sheet, over the table. See {@link JobDebugSheet}. */
  const [debugJobId, setDebugJobId] = useState<string | null>(null);
  /**
   * V1's `showCost(id)`: the Cost & Tokens sheet, which **both** the Cost and Tokens cells open
   * (`JobsApp.DataTable.cs:149-162`). One piece of state for the two columns, because they are two
   * ways into the same sheet rather than two sheets.
   */
  const [costJobId, setCostJobId] = useState<string | null>(null);
  /**
   * V1's `showPrompt(text)`: the full, untruncated prompt. Keyed by job id rather than holding the
   * text, so the sheet re-reads the row it belongs to and cannot go stale against a refetch.
   */
  const [promptJobId, setPromptJobId] = useState<string | null>(null);
  /**
   * The toolbar's filter, `c.AllowFiltering = true`: the expression as typed, and the wire filter it
   * parsed to.
   *
   * Both, because they answer different questions. The text is what the editor shows and what "is a
   * filter applied" is read from; the tree is what goes to the daemon, which is where the filtering
   * happens — over the whole table rather than over the fifty rows on screen.
   */
  /** V1's responsive density: Large by default, Medium on a desktop viewport. */
  const density = useResponsiveDensity(Densities.Large, Densities.Medium);
  const [filterExpression, setFilterExpression] = useState("");
  const [filter, setFilter] = useState<RemoteTableFilter | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /**
   * The clear the operator picked from the header menu, and how many rows it would take.
   *
   * `null` count means "not counted yet". The confirm button stays disabled until it is a number,
   * because the whole point of the dialog is the figure in it: "Clear 12 failed jobs" and "Clear failed
   * jobs" are different decisions, and offering the second while the first is a moment away is how
   * someone clears four hundred rows they thought were four.
   */
  const [pendingClear, setPendingClear] = useState<JobClearScope | null>(null);
  const [clearCount, setClearCount] = useState<number | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  /**
   * The one thing V1's per-cell update stream buys that a re-render does not.
   *
   * `BuildDataTableUpdates` exists because Ivy pushes widget state to a browser over a wire: a
   * rebuild re-serialises the whole table, so V1 pushes six cells per interesting job every second
   * instead, and diffs against what it last sent so an unchanged cell costs nothing. None of that
   * applies here - `App.tsx` already re-reads the list on `job.status_changed` / `job.completed` /
   * `job.failed` and on a 5s poll, and React's own diff is the "only what changed" mechanism.
   * Porting a cell-update channel on top of that would be a second source of truth for six cells.
   *
   * What does not arrive on any event is the *passage of time*: Timer counts up from `startedAt` and
   * Agent Output counts up from `lastOutputAt` while nothing about the job changes. So this is V1's
   * one-second interval, narrowed to its cause - it runs only while some row is Running, and stops when
   * none is.
   *
   * It re-renders and nothing more. Both cells are read off a timestamp the daemon already served, so a
   * tick costs one `buildJobRows` over the loaded window and never a refetch - which matters, because
   * refetching would drop the accumulated windows and return the reader to the top once a second. See
   * the structural signature below for the only thing that is allowed to refetch.
   */
  const hasRunningJob = jobs.some((job) => job.status === "Running");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!hasRunningJob) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [hasRunningJob]);

  /**
   * The table's rows, a window at a time.
   *
   * This is V1's `c.BatchSize = 50` infinite scroll: fifty jobs arrive, fifty more when the reader
   * comes within ten rows of the end, and the table never holds history nobody has scrolled to. The
   * `jobs` prop is no longer the row source — it could not be, because `jobsStore` holds only the
   * newest fifty and every poll replaces them, so a scrolled-open window would collapse every five
   * seconds. It is still the *live* source; see the overlay below.
   *
   * `POST /api/jobs/query`, so the sort, the filter and the window all execute in SQLite and the reply
   * carries the *filtered* total. That is what makes the row count irrelevant to the client: one window
   * per view, whether the table holds fifty jobs or fifty million. The sort columns are translated to
   * the daemon's schema on the way out — see {@link JOB_SORT_COLUMNS} and `resolveRemoteSort`.
   */
  const fetchJobsPage = useMemo<RemoteTableFetcher<Job>>(
    () => (request) =>
      queryJobsPage({ ...request, sort: resolveRemoteSort(SORT_COLUMNS, request.sort) }),
    [],
  );
  const table = useRemoteDataTable<Job>({
    fetchPage: fetchJobsPage,
    pageSize: JOBS_PAGE_SIZE,
    initialSort: JOBS_INITIAL_SORT,
    filter,
    infinite: true,
    getRowKey: (job) => job.id,
  });

  /**
   * V1's `BuildDataTableUpdates` (`JobsApp.DataTable.cs:361-394`), which streams six cells a second —
   * `Timer, Cost, Tokens, AgentOutput, Status, StatusMessage` — for jobs that are moving, instead of
   * rebuilding the table.
   *
   * The `jobs` prop is exactly that stream: `jobsStore` re-reads the newest fifty on every job event
   * and on a 5s poll, which is the set that can have changed. Overlaying it by id is what keeps a
   * Running row's cost and status live without refetching the window under the reader's scroll.
   *
   * A whole replacement rather than a field merge, deliberately: a live job is a complete record, and
   * merging would let a value the fetched page happened to carry outlive the daemon's own answer. The
   * consequence is that every cell reading a moving field needs that field on `Job` — `lastOutputAt` is
   * one, and a bridge DTO that dropped it would leave Agent Output reading the fetched page's frozen
   * stamp, which counts up forever and so reports a chatty agent as a silent one.
   */
  const liveJobs = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const windowJobs = useMemo(
    () => table.rows.map((row) => liveJobs.get(row.id) ?? row),
    [table.rows, liveJobs],
  );

  /**
   * V1's `ComputeStructuralSignature` gate (`JobsApp.Hooks.cs:66-68`): `Id;Status;PlanFile;
   * ReportedPlanId;Type;Project` per job, and a rebuild only when it differs from what is rendered.
   *
   * A cell that changed (a cost, a token count, a status message) is handled by the overlay above and
   * must not refetch, because refetching drops the accumulated windows and returns the reader to the
   * top. A *structural* change — a new job, a status transition — genuinely changes which rows exist
   * and where, and is the one case V1 rebuilds for too.
   */
  const structuralSignature = useMemo(
    () =>
      jobs
        .map(
          (job) => `${job.id};${job.status};${job.planId ?? ""};${job.type};${job.project ?? ""}`,
        )
        .join("|"),
    [jobs],
  );
  const lastSignature = useRef<string | null>(null);
  const refreshTable = table.refresh;
  useEffect(() => {
    const previous = lastSignature.current;
    lastSignature.current = structuralSignature;
    // The first sighting only records a baseline: the table's own first window is already in flight.
    if (previous === null || previous === structuralSignature) return;
    /* V1's `RefreshCoalescer` (`JobsApp.Hooks.cs:13`, `JobRefreshWindow = 400ms`). A plan starting
       moves several jobs at once and each transition is its own structural change, so without this
       one burst costs one refetch per job. Trailing rather than leading: the last signature in the
       burst is the one worth fetching for. */
    const timer = setTimeout(refreshTable, JOBS_REFRESH_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [structuralSignature, refreshTable]);

  const rows = useMemo(
    () => buildJobRows(windowJobs, { details: jobDetails }),
    // `tick` is a dependency in substance: it is what makes a Running row's Timer advance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [windowJobs, jobDetails, tick],
  );

  /**
   * The values each closed-set column can hold, from `POST /api/tables/jobs/values`.
   *
   * These used to be derived from the rows in hand, which was right only for as long as the filter was
   * evaluated in the client: the two agreed about which values existed because they read the same rows.
   * With the filter running in SQLite over the whole table, a list built from the loaded window offers a
   * user the values on screen — and the value they want is usually not one of them. `SELECT DISTINCT` is
   * the only source that can answer for a table the client has not read.
   *
   * They feed the filter editor's vocabulary rather than a control per column, so an operator can see
   * what `[Status] in (…)` accepts without knowing the job schema.
   */
  const statusOptions = useColumnValues("status");
  const typeOptions = useColumnValues("type");
  // Split, because the column stores a *joined* list: `SELECT DISTINCT Project` answers "web, api" as
  // one value, and the facet has to offer "web" and "api" — which is also why the Project filter's
  // condition is `contains` rather than `equals`.
  const projectOptions = useColumnValues("project", parseProjects);

  const capabilities: JobRowActionCapabilities = {
    canDelete: jobsStore.canDeleteJob(),
    canForceStart: jobsStore.canForceStartJob(),
  };

  const runAction = async (action: () => Promise<unknown>, label: string) => {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      // V1 refreshes and says nothing when `StopJob`/`ForceStartJob` fail. Saying nothing here would
      // leave the operator believing a job they could not stop had stopped.
      setActionError(`${label} failed: ${describeBridgeError(err)}`);
    }
  };

  const clearPrompt = pendingClear
    ? describeClearPrompt(pendingClear, clearCount)
    : // Not rendered while `pendingClear` is null; the placeholder keeps the dialog's props unconditional.
      { body: "", confirmLabel: "Clear", confirmDisabled: true };

  /** Opens a clear's confirm and asks the daemon how many rows it covers. */
  const openClearDialog = (scope: JobClearScope) => {
    setClearError(null);
    setClearCount(null);
    setPendingClear(scope);
  };

  useEffect(() => {
    if (!pendingClear) return;
    let cancelled = false;
    void countJobsByStatus(pendingClear.statuses)
      .then((count) => {
        if (!cancelled) setClearCount(count);
      })
      .catch((err: unknown) => {
        // The dialog stays open with the reason on it rather than closing: an operator who asked to
        // clear failed jobs should be told the daemon could not be reached, not silently returned to
        // the table.
        if (!cancelled) setClearError(`Could not count jobs: ${describeBridgeError(err)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingClear]);

  /**
   * V1's Plan Id cell action (`JobsApp.DataTable.cs:95-141`) picks between three targets: a plan
   * sheet for a job still active (to keep the user in Jobs), `PlansApp` for a Draft or Blocked plan,
   * and `ReviewApp` for one in Review or Failed.
   *
   * V2 has one plan surface, the plan tab, which every other view already routes to regardless of
   * state, and its review nav takes no plan argument. So all three collapse onto one call here. This
   * is a real divergence rather than a shortcut, and it becomes portable the moment there is a
   * per-plan review route to send the Review/Failed case to.
   */
  const openPlan = (planId: string) => {
    if (planId && onSelectPlan) onSelectPlan(planId);
  };

  /**
   * V1's `showOutput(id)`: the job's output sheet. The detail is pulled at the same time because the
   * list projection omits `reportedFailureReason`, `permissionDenials` and `detached` - V1's sheet
   * reads the live `JobItem` from `IJobService` and needs no such call.
   */
  const openJobOutput = (jobId: string) => {
    setOpenJobId(jobId);
    jobsStore.fetchJobDetail(jobId).catch(() => {
      // Supplementary: the sheet falls back to the list row.
    });
  };

  /**
   * V1's `showDebug(id)`. The detail is not supplementary here as it is for the output sheet — it *is*
   * the sheet: `args`, `workingDirectory`, `reportedFailureReason` and `permissionDenials` are all
   * detail-only fields, and a debug panel built from the list row would show none of them.
   */
  const openJobDebug = (jobId: string) => {
    setDebugJobId(jobId);
    jobsStore.fetchJobDetail(jobId).catch(() => {
      // Reported by the sheet's own empty state rather than swallowed silently.
    });
  };

  /**
   * V1's `showCost(id)`. The detail is fetched for the same reason the output sheet fetches it: the
   * list projection carries `cost` and `tokens` but not `provider`, and the sheet names the provider.
   */
  const openJobCost = (jobId: string) => {
    setCostJobId(jobId);
    jobsStore.fetchJobDetail(jobId).catch(() => {
      // Supplementary: the sheet falls back to the list row, which carries the figures themselves.
    });
  };

  /**
   * V1's `showPrompt(GetFullPrompt(job))`. V1 resolves the text from the job's typed args and falls
   * back to the plan's `InitialPrompt`; the daemon has already done that resolution and put the
   * result on the row, so this only has to open the sheet on it.
   */
  const openJobPrompt = (jobId: string) => {
    setPromptJobId(jobId);
    jobsStore.fetchJobDetail(jobId).catch(() => {
      // Supplementary: `prompt` is already on the list row.
    });
  };

  const columns = useJobColumns({
    onSelectPlan,
    openPlan,
    openJobOutput,
    openJobCost,
    openJobPrompt,
    statusOptions,
    typeOptions,
    projectOptions,
  });

  /**
   * A query the daemon refused, or a daemon that is not there.
   *
   * Worth a line of its own rather than an empty table: with the filter and the sort executing in
   * SQLite, "no rows" and "the daemon said `unknown column 'costt'`" look identical and mean opposite
   * things. The daemon's 400 names the column or the function that was wrong, which is the whole value
   * of the message to whoever typed the expression.
   */
  const tableError = table.error ? describeBridgeError(table.error) : null;

  const queuedCount = jobs.filter((job) => job.status === "Queued").length;
  const activeCount = jobs.filter((job) => isActiveStatus(job.status)).length;
  const segments = useMemo(() => buildStatusSegments(jobs), [jobs]);
  const canClear = jobsStore.canClearJobs();

  const jobToDelete = deleteJobId ? jobs.find((job) => job.id === deleteJobId) : undefined;

  // The sheet reads the list row, or the fetched detail for a job the list no longer carries (it is
  // capped, and Clear removes rows). `JobSessionView` merges the store's own copy over this anyway.
  const openJob = openJobId
    ? (jobs.find((job) => job.id === openJobId) ?? jobDetails?.[openJobId])
    : undefined;
  const openJobTitle = openJob
    ? openJob.planId
      ? `${openJob.type} ${openJob.planId}`
      : openJob.type
    : "Job Output";

  /**
   * The debug sheet's subject. Only the fetched detail will do — the list row is a `Job`, and every
   * field the panel exists to show is on `JobDetail`. A row whose detail has not arrived (or could not
   * be fetched) gets the sheet's own "nothing to show yet" line rather than a half-empty table.
   */
  const debugJob = debugJobId ? jobDetails?.[debugJobId] : undefined;

  /**
   * The Cost & Tokens and Prompt sheets' subjects. Unlike the debug sheet, the *list row* already
   * carries what each one shows - the figures and the prompt text - so the fetched detail is
   * preferred where it has arrived and the row is used until it does. Neither sheet has a loading
   * state for that reason: there is nothing to wait for.
   */
  const costJob = costJobId
    ? (jobDetails?.[costJobId] ?? jobs.find((job) => job.id === costJobId))
    : undefined;
  const promptJob = promptJobId
    ? (jobDetails?.[promptJobId] ?? jobs.find((job) => job.id === promptJobId))
    : undefined;
  /** V1 titles the prompt sheet "Full Prompt" and the cost sheet "Cost & Tokens". */
  const costJobTitle = costJob?.planId ? `Cost & Tokens — ${costJob.planId}` : "Cost & Tokens";
  /** The untruncated text behind the Prompt cell - the same walk the cell does, without the cut. */
  const promptText = promptJob ? promptSource(promptJob) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="jobs-view">
      {tableError && (
        <ErrorBanner data-testid="jobs-table-error">
          Could not read the jobs table: {tableError}
        </ErrorBanner>
      )}

      {actionError && (
        <ErrorBanner data-testid="jobs-action-error" onDismiss={() => setActionError(null)}>
          {actionError}
        </ErrorBanner>
      )}

      <DataTable<JobRow>
        data-testid="jobs-table"
        // `.Width(Size.Full()).Height(Size.Full())` on V1's table, and the same fixed layout the
        // other ported tables use so the declared column widths are binding.
        className="min-h-0 flex-1 [&_table.ivy-data-table]:table-fixed"
        // `.Density(new Responsive<Density?> { Default = Large, Desktop = Medium })`
        // (`JobsApp.DataTable.cs:40`), through the hook that gives V2's flat density a breakpoint:
        // roomier rows where a finger is the pointer, tighter where a mouse is.
        density={density}
        columns={columns}
        /* The window, unfiltered and unsorted here. Both happen in SQLite over the whole table — a
           client-side predicate would narrow the fifty rows on screen and quietly claim the other
           2.5 million matched nothing, and a client-side sort would shuffle one window inside an order
           the other windows were chosen by. */
        rows={rows}
        getRowId={(row) => row.id}
        /* `table.loading` unqualified: `useRemoteDataTable` already narrows it to "and there are no
           rows yet" for an infinite table, so repeating that here only hid which flag was at fault. */
        loading={table.loading}
        /* Infinite scroll, `c.BatchSize = 50`. `paginated={false}` because V1's table has no pager at
           all: scrolling is the pager, and `hasMore` is what says whether there is anything left to
           scroll to. `fillHeight` is `.Height(Size.Full())` — it is also what makes the header sticky
           mean anything, by giving the body its own bounded scroll viewport instead of scrolling the
           page. Windowing is left on its `"auto"` default, which engages past fifty rendered rows -
           i.e. from the second window on, which is exactly when the DOM needs bounding. */
        paginated={false}
        hasMore={table.hasMore}
        loadingMore={table.loadingMore}
        onLoadMore={table.loadMore}
        fillHeight
        /* `c.AllowSorting = true`, and every header click goes to the daemon: `manualSorting` with the
           hook's own `sort`/`onSortChange`, so a sort is an `ORDER BY` over the whole table rather than
           a reordering of the rows on screen. `JOBS_INITIAL_SORT` is V1's declared
           `.SortDirection(t => t.Id, Descending)`. */
        allowSorting
        manualSorting
        sort={table.sort}
        onSortChange={table.setSort}
        // `c.ShowIndexColumn = false` and `c.SelectionMode = SelectionModes.None`: neither the row
        // number nor a checkbox column. `selectable` defaults to false, and no index column exists.
        selectable={false}
        /* `c.AllowFiltering = true` with `c.ShowSearch = false`: one filter expression at the top-left
           of the toolbar and deliberately no search box, which is exactly what the framework's grid
           renders (`DataTableWidget.tsx`) and what V1's config asks for. The conditions are the
           daemon's — see `filter-expression.ts` — and they are evaluated in SQLite. */
        showFilter
        filterExpression={filterExpression}
        onFilterExpressionChange={(expression, next) => {
          setFilterExpression(expression);
          setFilter(next);
        }}
        // The show/hide-columns menu, which is how the hidden `Id` column is reachable at all.
        showColumnOptions
        rowActions={(row) => buildJobRowActions(row, capabilities)}
        onRowAction={({ tag, row }) => {
          if (tag === "stop-job") {
            void runAction(() => jobsStore.cancelJob(row.id), "Stop");
          } else if (tag === "force-start-job") {
            void runAction(() => jobsStore.forceStartJob(row.id), "Force start");
          } else if (tag === "debug-job") {
            openJobDebug(row.id);
          } else if (tag === "delete-job") {
            setDeleteError(null);
            setDeleteJobId(row.id);
          }
          // `rerun-job` is unreachable: the entry is disabled. See `RERUN_UNAVAILABLE_REASON`.
        }}
        onRowClick={(row) => openJobOutput(row.id)}
        emptyState={
          /* Which of the two it is turns on whether a filter is narrowing anything, not on the row
             count: a filtered-to-nothing table and an empty one look identical and mean opposite
             things. V1 supplies no empty state at all - the framework's `EmptyView` slot is declared
             and never rendered - so an empty Jobs table there is a collapsed header. */
          filterExpression.length > 0 ? (
            <span className="text-muted-foreground" data-testid="jobs-empty-filtered">
              No jobs match the current filters.
            </span>
          ) : (
            <span className="text-muted-foreground" data-testid="jobs-empty">
              No jobs yet. Starting a plan, a retry or a PR creates one.
            </span>
          )
        }
        toolbar={{
          /* V1's `HeaderLeft` is empty: the filter editor is the framework's own toolbar row, and the
             per-column filters that replaced it live in the header. Nothing else belongs here. */
          // `.HeaderRight(...)`: the status progress bar, then one ghost overflow menu holding the
          // two sweeps and the two clears. These were four loose buttons in the page header before;
          // V1 puts them here, so here is where they are.
          right: (
            <div className="flex items-center gap-3">
              {segments.length > 0 && (
                <div className="hidden w-56 sm:block">
                  <StackedProgress
                    aria-label="Jobs by status"
                    segments={segments}
                    showLabels
                    density={Densities.Small}
                    data-testid="jobs-status-progress"
                  />
                </div>
              )}
              {/* V1's menu always has the two Clears in it, so it is never empty. Here it can be:
                  nothing is running, nothing is queued, and `bridge.clearJobs` does not exist. A
                  trigger that opens an empty menu is worse than no trigger. */}
              {(queuedCount > 0 || activeCount > 0 || canClear) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Job list actions"
                      data-testid="jobs-header-menu"
                    >
                      <EllipsisVertical aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {/* Each sweep is hidden when its count is zero, as V1's `if (queuedCount > 0)` /
                      `if (activeJobCount > 0)` do, so neither ever reads "(0)". */}
                    {queuedCount > 0 && (
                      <DropdownMenuItem
                        data-testid="jobs-stop-all-queued"
                        onClick={() => onStopAllQueued()}
                      >
                        <Pause aria-hidden="true" />
                        Stop All Queued ({queuedCount})
                      </DropdownMenuItem>
                    )}
                    {activeCount > 0 && (
                      <DropdownMenuItem data-testid="jobs-stop-all" onClick={() => onStopAll()}>
                        <Pause aria-hidden="true" />
                        Stop All ({activeCount})
                      </DropdownMenuItem>
                    )}
                    {/* V1 offers its two clears unconditionally, and so does this - the whole list of
                      them, one per terminal status plus the sweep. See {@link JOB_CLEAR_SCOPES} for why
                      that is an extension of V1's own primitive rather than a new mechanism, and for
                      why no non-terminal status is in it.

                      Still gated on the capability, because `bridge.clearJobs` does not exist yet -
                      see `jobsStore.canClearJobs`. Every item below is destructive, so none of them
                      acts on the click: each opens the confirm, which names the count. */}
                    {canClear &&
                      JOB_CLEAR_SCOPES.map((scope) => (
                        <DropdownMenuItem
                          key={scope.scope}
                          data-testid={`jobs-clear-${scope.scope.toLowerCase()}`}
                          onClick={() => openClearDialog(scope)}
                        >
                          <Trash aria-hidden="true" />
                          {scope.label}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ),
        }}
      />

      {/* V1's output sheet (`JobsApp.cs:39-49`): opened over the table, titled
          `$"{job.Type} {ExtractPlanId(job.PlanFile)}"` - and "Job Output" for a job the service no
          longer has - at `UxHelper.SheetWidth`. `inset-y-0` is repeated from the `side="right"`
          variant for the same reason the other ported sheets repeat it. */}
      <Sheet
        open={openJobId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenJobId(null);
        }}
      >
        {/* `HeaderLayout`, which is the framework's structure for a panel with fixed chrome over
            scrolling content (`widgets/layouts/HeaderLayoutWidget.tsx`): the title stays put, the body
            scrolls under it, and the header takes a shadow once it does — so a reader can see that the
            output continues above the fold. `p-0` on the sheet because the layout owns the padding, which
            is what the framework's own `remove-parent-padding` does to its container. */}
        <SheetContent
          data-testid="job-output-sheet"
          className="inset-y-0 flex w-full flex-col overflow-hidden p-0 sm:w-3/4 sm:max-w-none lg:w-1/2 xl:w-2/5"
        >
          {/* `scrollContent={false}` hands the scrolling to the log, and is what puts the metrics
              footer back in the footer. The scrolling branch wraps its children in Radix's viewport,
              which injects a `display: table` div of its own (`react-scroll-area/dist/index.mjs:130`) —
              a definite height dies there, so `AgentViewer`'s `height="full"` resolved against an
              auto-height ancestor and the viewer sized to its content instead of to the sheet. The
              footer is `flex: 0 0 auto` against a body that gives up its height, so it was pinned to
              the bottom of a box that ended wherever the log happened to end: mid-sheet, with dead
              space under it. `AgentTerminalView` makes the same trade for xterm.js, and for the same
              reason — the viewer windows its own rows and an outer scroller fights the virtualizer for
              the scroll position. `contentClassName` re-establishes the flex column the default `p-4`
              wrapper would otherwise break.

              `showDivider={false}`: the sheet title already reads as chrome against the body, and the
              rule under it was the first of three stacked down this sheet. Per call site, so the Job
              Debug sheet below and the other `HeaderLayout` consumers keep theirs. */}
          <HeaderLayout
            className="min-h-0 flex-1"
            showDivider={false}
            scrollContent={false}
            contentClassName="flex h-full min-h-0 flex-col"
            header={
              <SheetHeader className="pl-2 pr-8">
                <SheetTitle>{openJobTitle}</SheetTitle>
              </SheetHeader>
            }
          >
            {openJob && (
              <React.Suspense
                fallback={
                  <div className="flex h-32 items-center justify-center text-muted-foreground">
                    <Spinner size="lg" className="text-success" aria-hidden="true" />
                  </div>
                }
              >
                {/* Deleting from inside the sheet leaves it pointing at a job that no longer
                    exists, so the same callback that closed the tab now closes the sheet. */}
                <JobOutput job={openJob} layout="sheet" onCloseTab={() => setOpenJobId(null)} />
              </React.Suspense>
            )}
          </HeaderLayout>
        </SheetContent>
      </Sheet>

      {/* V1's Job Debug sheet (`JobsApp.cs:62-70`), opened by the Debug row action. The panel is
          the sheet's own now rather than assembled here, so there is one Job Debug sheet rather
          than one per call site. */}
      <React.Suspense fallback={null}>
        <JobDebug
          isOpen={debugJobId !== null}
          onClose={() => setDebugJobId(null)}
          job={debugJob ?? undefined}
        />
      </React.Suspense>

      {/* V1's Cost & Tokens sheet (`JobsApp.cs:51`), opened by the Cost *and* Tokens cells
          (`JobsApp.DataTable.cs:149-162`) at the same `UxHelper.SheetWidth` as the sheets above. */}
      <Sheet
        open={costJobId !== null}
        onOpenChange={(open) => {
          if (!open) setCostJobId(null);
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
                <SheetTitle>{costJobTitle}</SheetTitle>
              </SheetHeader>
            }
          >
            {costJob ? (
              <React.Suspense
                fallback={
                  <div className="flex h-32 items-center justify-center text-muted-foreground">
                    <Spinner size="lg" className="text-success" aria-hidden="true" />
                  </div>
                }
              >
                <JobCost job={costJob} />
              </React.Suspense>
            ) : null}
          </HeaderLayout>
        </SheetContent>
      </Sheet>

      {/* V1's Full Prompt sheet (`JobsApp.cs:51`), opened by the Prompt cell. Its whole body is one
          wrapped code block, which is what `PromptSheet.cs` renders. */}
      <Sheet
        open={promptJobId !== null}
        onOpenChange={(open) => {
          if (!open) setPromptJobId(null);
        }}
      >
        <SheetContent
          data-testid="job-prompt-sheet"
          className="inset-y-0 flex w-full flex-col overflow-hidden p-0 sm:w-3/4 sm:max-w-none lg:w-1/2 xl:w-2/5"
        >
          <HeaderLayout
            className="min-h-0 flex-1"
            header={
              <SheetHeader className="pr-8">
                <SheetTitle>Full Prompt</SheetTitle>
              </SheetHeader>
            }
          >
            {promptText ? (
              <React.Suspense
                fallback={
                  <div className="flex h-32 items-center justify-center text-muted-foreground">
                    <Spinner size="lg" className="text-success" aria-hidden="true" />
                  </div>
                }
              >
                {/* `WrapLines()`: a prompt is prose, so it wraps rather than scrolling sideways. */}
                <JobPromptBlock content={promptText} wrapLines />
              </React.Suspense>
            ) : (
              /* A job type that carries no prose of its own - `ExpandPlan`, `SplitPlan` - reaches the
                 sheet with nothing to show. Saying so beats an empty box. */
              <span className="text-xs text-muted-foreground" data-testid="job-prompt-empty">
                This job recorded no prompt text.
              </span>
            )}
          </HeaderLayout>
        </SheetContent>
      </Sheet>

      {/* The bulk clears' confirm. V1 fires `ClearCompletedJobs()` straight off the menu item with no
          dialog at all; that is the one place this deliberately does not follow it, because a bulk delete
          of unbounded size is exactly what Framework's confirmation contract exists for. One dialog
          serves all five scopes - they differ only in a noun and a count. */}
      <ConfirmDialog
        isOpen={pendingClear !== null}
        onClose={() => {
          setPendingClear(null);
          setClearError(null);
        }}
        title={pendingClear?.label ?? "Clear Jobs"}
        // The copy and the arming rule both live in {@link describeClearPrompt}: the sentence *is* the
        // safety mechanism here, so it is a function with its own tests rather than a ternary in JSX.
        body={<p data-testid="jobs-clear-body">{clearPrompt.body}</p>}
        confirmLabel={clearPrompt.confirmLabel}
        confirmVariant="destructive"
        confirmDisabled={clearPrompt.confirmDisabled}
        isBusy={isClearing}
        error={clearError}
        testId="jobs-clear-dialog"
        onConfirm={async () => {
          if (!pendingClear) return;
          setIsClearing(true);
          setClearError(null);
          try {
            await jobsStore.clearJobs(pendingClear.scope);
            // A clear changes *which rows exist*, which is precisely the case the structural-signature
            // gate refetches for (V1's `ComputeStructuralSignature`). It is asked for directly rather
            // than left to that gate: the gate watches the newest fifty, and a clear can empty a window
            // the reader has scrolled to without touching any of them.
            refreshTable();
            setPendingClear(null);
          } catch (err) {
            setClearError(`Clear failed: ${describeBridgeError(err)}`);
          } finally {
            setIsClearing(false);
          }
        }}
      />

      {/* `JobsApp.DataTable.cs:296-317`, copy included. The handler is `jobsStore.deleteJob`, which
          carries V1's "stop a Running or Queued job first, then delete, then re-read" sequence. */}
      <ConfirmDialog
        isOpen={deleteJobId !== null}
        onClose={() => {
          setDeleteJobId(null);
          setDeleteError(null);
        }}
        title="Delete Job"
        body={<p>Are you sure you want to delete this job? This cannot be undone.</p>}
        confirmLabel="Delete"
        confirmVariant="destructive"
        isBusy={isDeleting}
        error={deleteError}
        testId="jobs-delete-dialog"
        onConfirm={async () => {
          if (!jobToDelete) return;
          setIsDeleting(true);
          setDeleteError(null);
          try {
            await jobsStore.deleteJob(jobToDelete.id);
            setDeleteJobId(null);
          } catch (err) {
            setDeleteError(`Delete failed: ${describeBridgeError(err)}`);
          } finally {
            setIsDeleting(false);
          }
        }}
      />
    </div>
  );
};
