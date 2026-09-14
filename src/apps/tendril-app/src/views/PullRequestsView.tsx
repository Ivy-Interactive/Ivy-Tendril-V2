import React, { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, FileText, GitBranch, RefreshCw } from "lucide-react";
import {
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
import { bridgeErrorCode, describeBridgeError, type PrState, type PrStatus } from "../types/api";
import { EmptyState } from "../components/EmptyState";

/** The original's `BatchSize` — a cross-plan PR list is long, so the page holds more than the default 10. */
const DEFAULT_PAGE_SIZE = 50;

const STATUS_OPTIONS: BadgeSelectOption[] = [
  { value: "Open", label: "Open" },
  { value: "Merged", label: "Merged" },
  { value: "Closed", label: "Closed" },
  { value: "Unknown", label: "Unknown" },
];

/** Shared with the per-plan card in `PlanPullRequests`, so the table and the card agree on colour. */
const STATE_CLASS: Record<PrState, string> = {
  Open: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  Merged: "bg-violet-500/10 text-violet-300 border-violet-500/30",
  Closed: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  Unknown: "bg-slate-700/40 text-slate-400 border-slate-600/40",
};

/** The Dashboard's format, so the app has one token format rather than two. */
function formatTokens(tokens: number): string {
  if (tokens <= 0) return "";
  return tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

/** Blank rather than `$0.00` for a plan with no priceable cost — the original's `costValue > 0` guard. */
function formatCost(cost: number): string {
  return cost > 0 ? `$${cost.toFixed(2)}` : "";
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
      if (report.errors.length > 0) {
        setNotice(`GitHub could not be reached for: ${report.errors.join("; ")}`);
      }
      await load();
    } catch (err) {
      // A collision with the periodic pass is not something the operator did wrong, and the running
      // pass broadcasts its result anyway — so it is a notice, not an error banner.
      if (bridgeErrorCode(err) === "PR_SYNC_IN_PROGRESS") {
        setNotice("A sync pass is already running.");
      } else {
        setSyncError(describeBridgeError(err));
      }
    } finally {
      setIsSyncing(false);
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
        cell: (_value, row) => (
          <span className="rounded bg-muted/80 px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {row.project}
          </span>
        ),
      },
      {
        name: "status",
        header: "Status",
        width: "100px",
        accessor: (row) => row.status,
        cell: (_value, row) => (
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              STATE_CLASS[row.status] ?? STATE_CLASS.Unknown
            }`}
          >
            {row.status || "Unknown"}
          </span>
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
        cell: (_value, row) => formatTokens(row.tokens),
      },
      {
        name: "cost",
        header: "Cost",
        width: "80px",
        align: "Right",
        accessor: (row) => row.cost,
        cell: (_value, row) => formatCost(row.cost),
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

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          {error}
        </div>
      )}
      {syncError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          {syncError}
        </div>
      )}
      {notice && <p className="text-xs text-amber-300">{notice}</p>}

      {!isLoading && rows.length === 0 && !error ? (
        <EmptyState
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
          emptyState={
            <span className="text-muted-foreground">
              No pull requests match your current search query or filter criteria.
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
                  className="w-72 rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground placeholder-muted-foreground/70 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
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
              <button
                type="button"
                onClick={() => void handleSync()}
                disabled={isSyncing}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted disabled:opacity-50"
              >
                {/* "All" rather than "Resync": the row action carries that label, and one pass
                    covers every PR, so the toolbar control says which scope it has. */}
                {isSyncing ? "Resyncing..." : "Resync All"}
              </button>
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
        {/* `inset-y-0` is repeated from `SheetContent`'s own `side="right"` variant on purpose. The
            components package's built `style.css` carries the theme and base layers but no utility
            classes, so a utility named only inside that package is never generated — Tailwind emits
            utilities from the *app's* sources. `inset-y-0` appears nowhere else in this app, so the
            sheet had no `top`/`bottom` at all and rendered one viewport below the fold. Naming it
            here is what brings the rule into existence. */}
        <SheetContent className="inset-y-0 w-full overflow-y-auto sm:max-w-2xl">
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
