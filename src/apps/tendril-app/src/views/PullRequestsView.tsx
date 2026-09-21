import React, { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, FileText, GitBranch, RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  type DataTableColumn,
  type DataTableRowAction,
} from "@ivy-interactive/components/ui";
import {
  BadgeSelect,
  PlanMarkdown,
  type BadgeSelectOption,
} from "@ivy-interactive/components/tendril";
import { bridge } from "../api/bridge";
import { onPrStatusEvent } from "../api/events";
import { bridgeErrorCode, describeBridgeError, type PrStatus } from "../types/api";
import { ErrorBanner } from "../components/ErrorBanner";
import { NoContentView } from "../components/NoContentView";
import { useWireframeBaseUrl } from "../api/proxyOrigin";
import { projectColor } from "../utils/jobStatus";
import { PR_STATE_COLOR } from "../utils/prStatus";
import { formatCost, formatTokensCompact } from "../utils/format";

/** The original's `BatchSize` — a cross-plan PR list is long, so the page holds more than the default 10. */
const DEFAULT_PAGE_SIZE = 50;

const STATUS_OPTIONS: BadgeSelectOption[] = [
  { value: "Open", label: "Open" },
  { value: "Merged", label: "Merged" },
  { value: "Closed", label: "Closed" },
  { value: "Unknown", label: "Unknown" },
];

/**
 * Blank rather than a figure for a plan with no priceable cost and no recorded tokens — the
 * original's `costValue > 0` / `tokenValue > 0` guards. The emptiness is this table's decision and
 * stays here; how a number that *is* there gets spelled is {@link formatTokensCompact}'s and
 * {@link formatCost}'s.
 *
 * The local token ladder these replace claimed to be "the Dashboard's format, so the app has one
 * token format rather than two", and was not: it had no millions branch, so a 1.4M-token plan read
 * `1400.0k` in this column and `1.4M` on the Dashboard card it was copied from.
 */
const tokensCell = (tokens: number): string => (tokens > 0 ? formatTokensCompact(tokens) : "");

const costCell = (cost: number): string => (cost > 0 ? formatCost(cost) : "");

/**
 * What a status cell means, and how old it is.
 *
 * `Unknown` is not "open": `pr_sync` records it when a tracked URL is absent from its repository's
 * `gh pr list --limit 100` window, or when the `gh` call failed outright. The badge alone reads as a
 * fourth PR state, so the cell says which of those it is and when the daemon last looked. Nothing in
 * the table said this before, and a grey chip is exactly what an operator skims past.
 */
function statusTooltip(row: PrStatus): string {
  const checked = row.lastChecked ? `last checked ${row.lastChecked}` : "never checked";
  if (row.status === "Unknown") {
    return `Unknown: the daemon could not resolve this pull request (${checked}). Resync to try again.`;
  }
  if (row.status === "Merged") {
    // The first of pr_sync's three guards: a merge is terminal on GitHub's side.
    return `Merged (${checked}). Merged pull requests are never re-checked.`;
  }
  return `${row.status} as of ${checked}.`;
}

export interface PullRequestsViewProps {
  /** Opens the plan's own tab, as PlansView's callback does. */
  onSelectPlan: (planId: string) => void;
  /** Opens NewPlanModal with the follow-up already filled in. */
  onOpenNewPlanModal: (prefill: {
    title?: string;
    description?: string;
    sourceUrl?: string;
    project?: string;
  }) => void;
}

/**
 * Every PR recorded on a plan, in one table — the question a per-plan card cannot answer: across all
 * plans, which PRs are still open? Status, cost and token totals come from the daemon; this view
 * only reads them, and the URL filter deliberately stays server-side in `parse_pr_url` rather than
 * being re-expressed here as a regex.
 */
export const PullRequestsView: React.FC<PullRequestsViewProps> = ({
  onSelectPlan,
  onOpenNewPlanModal,
}) => {
  const [rows, setRows] = useState<PrStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [sheetRow, setSheetRow] = useState<PrStatus | null>(null);
  // The daemon's origin, not the app's -- see useWireframeBaseUrl.
  const wireframeBaseUrl = useWireframeBaseUrl(sheetRow?.planId);
  const [revision, setRevision] = useState<string | null>(null);
  const [revisionError, setRevisionError] = useState<string | null>(null);

  // `cancelled` is read at settle time rather than captured per call site, so a fetch still in
  // flight when the view unmounts does not write to state afterwards.
  const cancelledRef = React.useRef(false);

  const load = useCallback(async () => {
    try {
      const list = await bridge.listPullRequests();
      if (cancelledRef.current) return;
      setRows(list);
      setError(null);
    } catch (err) {
      if (cancelledRef.current) return;
      setError(describeBridgeError(err));
    } finally {
      if (!cancelledRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, [load]);

  // A finished sync pass broadcasts a change, so the table is live without polling.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void onPrStatusEvent(() => {
      void load();
    })
      .then((unsub) => {
        if (cancelled) unsub();
        else unsubscribe = unsub;
      })
      .catch(() => {
        // Without the event stream the table is merely not live; Resync still works.
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [load]);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    setSyncError(null);
    setNotice(null);
    try {
      const report = await bridge.syncPullRequests();
      // A sync pass is the longest call this page makes — one `gh` invocation per repository — so the
      // same unmount guard `load` uses applies here, or navigating away mid-pass writes to a view
      // that is gone.
      if (cancelledRef.current) return;
      // `pr_sync` never fails a pass over one unreachable repository — a `gh` that is missing,
      // unauthenticated or rate-limited lands in `report.errors`, one entry per `owner/repo`, and the
      // pass returns success. So the operator's Resync can appear to have worked while every status
      // on screen is untouched. `checked === 0` with errors is exactly that case, and it is worth
      // saying plainly rather than leaving them to read a list of repository names.
      if (report.errors.length > 0) {
        const scope =
          report.checked === 0 ? "No status could be refreshed" : "Some statuses are unchanged";
        setNotice(
          `${scope}: GitHub could not be reached for ${report.errors.join("; ")}. ` +
            `Check that the \`gh\` CLI is installed and authenticated (\`gh auth status\`).`,
        );
      } else if (report.checked === 0 && report.tracked > 0) {
        // The freshness and terminal-merge guards, said out loud: a pass that skipped everything is
        // not a failure, but a silent no-op invites a second click that will also do nothing.
        setNotice(
          `Nothing to refresh: ${report.skippedFresh} recently checked, ` +
            `${report.skippedMerged} already merged.`,
        );
      }
      await load();
    } catch (err) {
      // A collision with the periodic pass is not something the operator did wrong, and the running
      // pass broadcasts its result anyway — so it is a notice, not an error banner.
      if (cancelledRef.current) return;
      if (bridgeErrorCode(err) === "PR_SYNC_IN_PROGRESS") {
        setNotice("A sync pass is already running.");
      } else {
        setSyncError(describeBridgeError(err));
      }
    } finally {
      if (!cancelledRef.current) setIsSyncing(false);
    }
  }, [load]);

  const openPlanSheet = useCallback(async (row: PrStatus) => {
    setSheetRow(row);
    setRevision(null);
    setRevisionError(null);
    try {
      setRevision(await bridge.getRevision(row.planId));
    } catch (err) {
      setRevisionError(describeBridgeError(err));
    }
  }, []);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(row.status)) {
        return false;
      }
      if (!query) return true;
      return [
        row.planId,
        row.planTitle,
        row.project,
        `${row.owner}/${row.repo}`,
        row.branch ?? "",
      ].some((field) => field.toLowerCase().includes(query));
    });
  }, [rows, search, selectedStatuses]);

  // The percentage widths below sum to 52% and the fixed ones to 470px, deliberately under budget:
  // the row-actions column is 144px on top of that, and a budget of 100% + fixed pushed it out of
  // the viewport entirely — the table overflowed and the four actions were unreachable.
  const columns: DataTableColumn<PrStatus>[] = useMemo(
    () => [
      {
        name: "plan",
        header: "Plan",
        width: "24%",
        // Numeric so the default Descending sort orders 00610 above 00099 rather than lexically.
        accessor: (row) => Number.parseInt(row.planId, 10) || 0,
        cell: (_value, row) => (
          <button
            type="button"
            onClick={() => void openPlanSheet(row)}
            className="truncate text-left text-sm text-success hover:underline"
            title={`#${row.planId} ${row.planTitle}`}
          >
            #{row.planId} {row.planTitle}
          </button>
        ),
      },
      {
        name: "project",
        header: "Project",
        // Wide enough for `Ivy-Tendril-V2`; at 110px every row read `Ivy-Tendril-...`, so the column
        // carried no information at all.
        width: "140px",
        accessor: (row) => row.project,
        // V1 renders this column through the same `LabelsDisplayRenderer`, coloured from
        // `ProjectHelper.BuildColorMapping(config)` (`PullRequestApp.cs:144-147`). Jobs' Project
        // column already does this; see {@link projectColor} for why the colour is derived from the
        // name rather than read from the DTO.
        cell: (_value, row) => (
          <Badge color={projectColor(row.project)} density="Small">
            {row.project}
          </Badge>
        ),
      },
      {
        name: "status",
        header: "Status",
        width: "100px",
        accessor: (row) => row.status,
        cell: (_value, row) => (
          <Badge title={statusTooltip(row)} color={PR_STATE_COLOR[row.status]} density="Small">
            {row.status || "Unknown"}
          </Badge>
        ),
      },
      {
        name: "pr",
        header: "PR",
        // A PR number is five characters; the original's 25% was a copy-paste from the text columns.
        width: "70px",
        accessor: (row) => row.number,
        cell: (_value, row) => (
          <button
            type="button"
            onClick={() => void openUrl(row.prUrl)}
            className="font-mono text-xs text-success hover:underline"
            title={row.prUrl}
          >
            #{row.number}
          </button>
        ),
      },
      {
        name: "tokens",
        header: "Tokens",
        width: "80px",
        align: "Right",
        accessor: (row) => row.tokens,
        cell: (_value, row) => tokensCell(row.tokens),
      },
      {
        name: "cost",
        header: "Cost",
        width: "80px",
        align: "Right",
        accessor: (row) => row.cost,
        cell: (_value, row) => costCell(row.cost),
      },
      {
        name: "repository",
        header: "Repository",
        width: "15%",
        accessor: (row) => `${row.owner}/${row.repo}`,
        // `owner/repo` and a `tendril/00610-...` branch are both longer than any column that fits on
        // screen, so the truncated cells carry the full value as a tooltip.
        cell: (_value, row) => (
          <span title={`${row.owner}/${row.repo}`}>
            {row.owner}/{row.repo}
          </span>
        ),
      },
      {
        name: "branch",
        header: "Branch",
        width: "13%",
        accessor: (row) => row.branch ?? "",
        cell: (_value, row) => (
          <span className="font-mono text-xs" title={row.branch ?? ""}>
            {row.branch ?? ""}
          </span>
        ),
      },
    ],
    [openPlanSheet],
  );

  const rowActions: DataTableRowAction<PrStatus>[] = useMemo(
    () => [
      { tag: "view-plan", label: "View Plan", icon: <FileText aria-hidden="true" /> },
      { tag: "follow-up", label: "Follow Up", icon: <GitBranch aria-hidden="true" /> },
      { tag: "open-pr", label: "Open PR", icon: <ExternalLink aria-hidden="true" /> },
      {
        tag: "resync",
        label: "Resync",
        icon: <RefreshCw aria-hidden="true" />,
        disabled: isSyncing,
      },
    ],
    [isSyncing],
  );

  return (
    <div className="space-y-6" data-testid="pull-requests-view">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Pull Requests</h1>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}
      {syncError && <ErrorBanner>{syncError}</ErrorBanner>}
      {notice && <p className="text-xs text-warning">{notice}</p>}

      {!isLoading && rows.length === 0 && !error ? (
        <NoContentView
          title="No pull requests"
          description="No plan has a pull request recorded yet. Create one from the Review tab and it will appear here."
        />
      ) : (
        <DataTable<PrStatus>
          // `table-fixed` is what makes the declared column widths binding. Under the default auto
          // layout a long branch name or `owner/repo` sets the column's minimum, the table grows past
          // its scroll container, and the row-actions column — which declares no width — ends up off
          // the right edge, unreachable. Fixed layout also lets the library's own
          // `td.ivy-data-table-nowrap` ellipsis rule take effect, which needs a constrained width.
          // The selector reaches the inner `<table>` because `DataTable` puts `className` on its
          // wrapper and hardcodes the table's own class.
          //
          // The row-actions header ships as `w-0`, which fixed layout takes literally: the four icon
          // buttons then overflow their cell and paint over the Branch text. It is the last header,
          // and sizing the header alone is enough — fixed layout reads column widths from the first
          // row only.
          className="[&_table.ivy-data-table]:table-fixed [&_table.ivy-data-table_th:last-child]:w-36"
          columns={columns}
          rows={filteredRows}
          getRowId={(row) => `${row.planId}-${row.number}`}
          loading={isLoading}
          allowSorting
          showColumnOptions
          defaultSort={{ column: "plan", direction: "Descending" }}
          defaultPageSize={DEFAULT_PAGE_SIZE}
          rowActions={rowActions}
          onRowAction={({ tag, row }) => {
            if (tag === "view-plan") onSelectPlan(row.planId);
            else if (tag === "open-pr") void openUrl(row.prUrl);
            else if (tag === "resync") void handleSync();
            else if (tag === "follow-up") {
              onOpenNewPlanModal({
                title: `Follow up on ${row.planTitle}`,
                // CreatePlan reads the `[number]` marker and pulls the referenced plan in as context.
                description: `[Follows up on plan [${row.planId}]]\n\nPR: ${row.prUrl}\n\n`,
                sourceUrl: row.prUrl,
                project: row.project,
              });
            }
          }}
          // A failed list is not an empty one. Without this the table said the operator's search
          // matched nothing while the banner above it said the daemon was unreachable, and the two
          // read as unrelated.
          emptyState={
            <span className="text-muted-foreground">
              {error
                ? "The pull request list could not be loaded, so nothing can be shown."
                : "No pull requests match your current search query or filter criteria."}
            </span>
          }
          toolbar={{
            left: (
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  role="searchbox"
                  aria-label="Search pull requests"
                  placeholder="Search by plan, project, repository, or branch..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-72 rounded-field border border-border bg-card px-4 py-2 text-sm text-foreground placeholder-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <div className="min-w-[180px]">
                  <BadgeSelect
                    id="pr-status-filter"
                    options={STATUS_OPTIONS}
                    value={selectedStatuses}
                    placeholder="Filter by status..."
                    multiple={true}
                    // BadgeSelect only emits events it was opted into, so omitting this leaves the
                    // filter inert — the trigger opens and closes but no selection ever arrives.
                    events={["OnChange"]}
                    eventHandler={(_evt: string, _id: string, args?: unknown[]) => {
                      if (args && Array.isArray(args[0])) {
                        setSelectedStatuses(args[0] as string[]);
                      }
                    }}
                  />
                </div>
              </div>
            ),
            right: (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleSync()}
                disabled={isSyncing}
                className="h-auto px-3 py-1.5 text-xs text-muted-foreground"
              >
                {/* "All" rather than "Resync": the row action carries that label, and one pass
                    covers every PR, so the toolbar control says which scope it has. */}
                {isSyncing ? "Resyncing..." : "Resync All"}
              </Button>
            ),
          }}
        />
      )}

      <Sheet
        open={sheetRow !== null}
        onOpenChange={(open) => {
          if (!open) setSheetRow(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>
              {sheetRow ? `#${sheetRow.planId} ${sheetRow.planTitle}` : "Plan"}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            {revisionError ? (
              <p className="text-xs text-destructive">{revisionError}</p>
            ) : revision === null ? (
              <p className="text-sm text-muted-foreground">Loading revision...</p>
            ) : revision.trim() === "" ? (
              <p className="text-sm text-muted-foreground">Plan not found or empty.</p>
            ) : (
              <PlanMarkdown
                id="pr-plan-revision"
                content={revision}
                // The sheet shows a plan's revision, so its wireframes resolve the same way they
                // do on the plan page itself.
                wireframeBaseUrl={wireframeBaseUrl}
                article
                dangerouslyAllowLocalFiles
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};
