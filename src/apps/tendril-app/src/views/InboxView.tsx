import React, { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  ExternalLink,
  FileText,
  Folder,
  FolderClosed,
  GitPullRequest,
  MessageCircle,
  RefreshCw,
  Settings,
  Zap,
} from "lucide-react";
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
import { ivyColorVar } from "@ivy-interactive/components";
import { bridge } from "../api/bridge";
import { describeBridgeError } from "../types/api";
import type { GitHubIssue, InboxProposal, ProjectSummary, SweepReport } from "../types/api";
import { ErrorBanner } from "../components/ErrorBanner";
import { NoContentView } from "../components/NoContentView";
import { AutoAcceptSettingsDialog } from "./dialogs/AutoAcceptSettingsDialog";

export type InboxCategory = "my-issues" | "review-requests" | "project-issues";

export type PollInterval = "off" | "30s" | "1m" | "5m" | "15m";

/**
 * V1's `IssuesTableView` and `BuildReviewsView` both set `c.BatchSize = 50`, and V2's
 * `PullRequestsView` ports the same number for the same reason: an inbox page is long.
 */
const DEFAULT_PAGE_SIZE = 50;

/**
 * GitHub's search API serves at most 1000 results however large `total_count` is, and the daemon
 * derives `hasMore` from that full count. Paging past the cap therefore returns HTTP 422, which
 * arrives as a `GITHUB_ERROR` where the list used to be. Capping the reported row count leaves the
 * Next Page control disabled at the boundary instead.
 */
const GITHUB_SEARCH_RESULT_CAP = 1000;

const POLL_INTERVAL_MS: Record<PollInterval, number> = {
  off: 0,
  "30s": 30_000,
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
};

const POLL_INTERVAL_LABELS: Record<PollInterval, string> = {
  off: "Off",
  "30s": "30s",
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
};

/**
 * V1's inbox queries carry `new QueryOptions { Expiration = TimeSpan.FromSeconds(60) }`
 * (`InboxApp.Build`), so its list re-validates about once a minute with no operator action. One
 * minute is therefore the default here too; the persisted preference still wins once set.
 */
const DEFAULT_POLL_INTERVAL: PollInterval = "1m";

const POLL_INTERVAL_UI_STATE_KEY = "inbox_poll_interval";

/** `InboxChatPrompt.MaxDetailedIssues` - issues rendered in full before the prompt collapses the rest. */
const CHAT_MAX_DETAILED_ISSUES = 20;

/** `InboxChatPrompt.BodyPreviewLength` - characters of each issue body kept in the prompt. */
const CHAT_BODY_PREVIEW_LENGTH = 500;

/** V1 `InboxApp.TruncateBody`: trim, cap, and mark the cut with a single ellipsis character. */
function truncateBody(body: string | undefined, maxLength = CHAT_BODY_PREVIEW_LENGTH): string {
  const trimmed = (body ?? "").trim();
  if (!trimmed) return "";
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength)}…`;
}

function repoLabelOf(issue: GitHubIssue): string {
  return issue.repository?.nameWithOwner || issue.repository?.name || "";
}

/**
 * V1 `InboxApp.ResolveIssueUrl`: the issue's own url when it has one, otherwise one built from
 * `owner/name` and the number, otherwise nothing at all. V1's callers check for that nothing
 * (`if (url != null) client.OpenUrl(url)`), which is why every open path here goes through this.
 */
function resolveIssueUrl(issue: GitHubIssue): string | undefined {
  if (issue.url && issue.url.trim()) return issue.url;
  const nameWithOwner = issue.repository?.nameWithOwner?.trim();
  return nameWithOwner ? `https://github.com/${nameWithOwner}/issues/${issue.number}` : undefined;
}

/**
 * V1 `InboxChatPrompt.Build`, block for block: one framing line, then a section per issue capped at
 * `CHAT_MAX_DETAILED_ISSUES`, then a single line accounting for the remainder.
 */
export function buildInboxChatPrompt(issues: GitHubIssue[]): string {
  if (issues.length === 0) return "";

  const blocks: string[] = [
    `Let's discuss ${issues.length} GitHub issue${
      issues.length === 1 ? "" : "s"
    } I selected in the Tendril Inbox. Read them and help me decide what to do.`,
  ];

  for (const issue of issues.slice(0, CHAT_MAX_DETAILED_ISSUES)) {
    const repo = repoLabelOf(issue);
    const lines: string[] = [
      repo ? `## ${repo}#${issue.number}: ${issue.title}` : `## #${issue.number}: ${issue.title}`,
    ];
    // V1 `InboxChatPrompt.BuildIssueBlock` writes the line from `ResolveIssueUrl`, not the raw field.
    const url = resolveIssueUrl(issue);
    if (url) lines.push(`URL: ${url}`);
    const labels = issue.labels.map((l) => l.name).filter(Boolean);
    if (labels.length > 0) lines.push(`Labels: ${labels.join(", ")}`);
    const assignees = issue.assignees.map((a) => a.login).filter(Boolean);
    if (assignees.length > 0) lines.push(`Assignees: ${assignees.join(", ")}`);
    const body = truncateBody(issue.body);
    lines.push(body || "No description provided.");
    blocks.push(lines.join("\n"));
  }

  if (issues.length > CHAT_MAX_DETAILED_ISSUES) {
    blocks.push(
      `Plus ${
        issues.length - CHAT_MAX_DETAILED_ISSUES
      } more selected issues, which you can fetch with gh issue view.`,
    );
  }

  return blocks.join("\n\n");
}

/**
 * Everything one sweep is willing to say about itself.
 *
 * V1's `InboxRecoverySummary` exists because "recovery used to be silent, which is why roughly 60
 * resurrections in the #2710 storm produced no explanatory log entries at all". `SweepReport` is
 * V2's equivalent payload and it was being read two fields deep: a pass in which every project's
 * `gh` call failed reports `imported: []`, `skipped: 0` and a populated `errors`, which rendered as
 * "Imported 0, skipped 0." - indistinguishable from nothing being assigned to you. `accepted` is the
 * other half: with auto-accept on, an imported issue becomes a plan in the same pass and never
 * appears as a card below, so the count is the only evidence the sweep did anything.
 */
export function describeSweep(report: SweepReport): string {
  if (report.outcome === "AlreadyRunning") return "A check is already running.";
  if (report.outcome === "NotMaster") return "This daemon is not the master, so it did not check.";

  const parts = [`Imported ${report.imported.length}, skipped ${report.skipped}.`];
  if (report.accepted > 0) {
    parts.push(
      `${report.accepted} started a plan straight away${
        report.accepted === report.imported.length ? "" : " (the rest are below)"
      }.`,
    );
  }
  if (report.errors.length > 0) {
    parts.push(
      `${report.errors.length} error${report.errors.length === 1 ? "" : "s"}: ${report.errors[0]}`,
    );
  }
  return parts.join(" ");
}

/** V1 `InboxChatPrompt.Title`. */
export function inboxChatTitle(issues: GitHubIssue[]): string | undefined {
  if (issues.length === 0) return undefined;
  return issues.length === 1 ? `#${issues[0].number}` : `${issues.length} issues`;
}

/**
 * V1 `InboxApp.BuildInboxFileContent` writes the issue link and body into an inbox markdown file.
 * V2 has no inbox folder: the same intake happens as a `CreatePlan` job, whose `description` is
 * this string. Kept identical to the prefill `App.tsx` builds so both paths intake the same text.
 *
 * V1 drops the link entirely when no url resolves and heads the file with the issue number instead;
 * the same branch here keeps an empty pair of brackets out of the description.
 */
function buildIssueIntake(issue: GitHubIssue): string {
  const url = resolveIssueUrl(issue);
  const heading = url
    ? `Task from GitHub Issue #${issue.number} (${url}):`
    : `Task from GitHub Issue #${issue.number}:`;
  return `${heading}\n\n${issue.body}`;
}

/**
 * One row of V1's inbox sidebar (`SidebarListRow.Build`): a full-width button, `Secondary` while
 * selected and `Ghost` otherwise, with the count badge suppressed unless it is greater than zero.
 */
const RailRow: React.FC<{
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  count?: number;
  selected: boolean;
  onClick: () => void;
  testId?: string;
}> = ({ icon: IconCmp, label, count, selected, onClick, testId }) => (
  <button
    type="button"
    role="tab"
    aria-selected={selected}
    data-testid={testId}
    onClick={onClick}
    className={`flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-left text-xs transition-colors ${
      selected
        ? "bg-secondary text-secondary-foreground"
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    }`}
  >
    <IconCmp className="size-4 shrink-0" aria-hidden />
    <span className="truncate">{label}</span>
    {count !== undefined && count > 0 && (
      <Badge variant="secondary" density="Small" className="ml-auto">
        {count}
      </Badge>
    )}
  </button>
);

/** V1 `SidebarListRow.BuildExpandable`: icon, label, spacer, then a chevron for the open state. */
const RailExpander: React.FC<{
  label: string;
  expanded: boolean;
  selected: boolean;
  onClick: () => void;
}> = ({ label, expanded, selected, onClick }) => (
  <button
    type="button"
    aria-expanded={expanded}
    onClick={onClick}
    className={`flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-left text-xs transition-colors ${
      selected
        ? "bg-secondary text-secondary-foreground"
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    }`}
  >
    <Folder className="size-4 shrink-0" aria-hidden />
    <span className="truncate">{label}</span>
    {expanded ? (
      <ChevronDown className="ml-auto size-3 shrink-0" aria-hidden />
    ) : (
      <ChevronRight className="ml-auto size-3 shrink-0" aria-hidden />
    )}
  </button>
);

/**
 * V1 `SidebarListRow.BuildSubItem`: a 1rem indent, then either an icon or a small colour box, then
 * the label. Icon *or* colour, never both — which is why the "No projects in settings" row keeps its
 * folder icon and gets no dot.
 *
 * The colour box is V1's, literally: `new Box().Background(color).BorderRadius(BorderRadius.Rounded)
 * .Width(Size.Units(3)).Height(Size.Units(3))` — a 0.75rem square at Ivy's `Rounded` radius, which
 * resolves to 0.5rem, so it reads as a dot without being a circle. That is why this is
 * `size-3 rounded-box` and not `size-2 rounded-full`, and it is the same marker the Settings
 * sidebar draws (`views/settings/SidebarListRow.tsx`) for the same projects.
 *
 * `color` is an Ivy `Colors` name, resolved through the package's `ivyColorVar` — the one
 * name-to-token mapping in the codebase, shared with `Badge` and `TuiBadge`. A row with neither an
 * icon nor a colour keeps the old neutral marker.
 */
const RailSubItem: React.FC<{
  label: string;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** An Ivy `Colors` name, e.g. the project's configured colour. */
  color?: string;
  selected?: boolean;
  onClick?: () => void;
  testId?: string;
}> = ({ label, icon: IconCmp, color, selected = false, onClick, testId }) => {
  const shared = `flex w-full items-center gap-2 rounded-field py-1.5 pl-4 pr-2 text-left text-xs transition-colors ${
    selected
      ? "bg-secondary text-secondary-foreground"
      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
  }`;

  const marker = IconCmp ? (
    <IconCmp className="size-4 shrink-0" aria-hidden />
  ) : color ? (
    <span
      aria-hidden
      data-testid={testId ? `${testId}-dot` : undefined}
      data-color={color}
      className="size-3 shrink-0 rounded-box"
      style={{ backgroundColor: ivyColorVar(color) }}
    />
  ) : (
    <span
      aria-hidden
      className={`size-2 shrink-0 rounded-full ${selected ? "bg-primary" : "bg-muted-foreground/50"}`}
    />
  );

  if (!onClick) {
    return (
      <span className={`${shared} cursor-default`} data-testid={testId}>
        {marker}
        <span className="truncate">{label}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      data-testid={testId}
      onClick={onClick}
      className={shared}
    >
      {marker}
      <span className="truncate">{label}</span>
    </button>
  );
};

export interface InboxViewProps {
  projects?: ProjectSummary[];
  onCreatePlan?: (issue: GitHubIssue, project?: string) => void;
  onOpenNewPlanModal?: (prefill: {
    title: string;
    description: string;
    sourceUrl: string;
    project?: string;
  }) => void;
  /**
   * V1's `Open Chat` header button (`ContentView.BuildIssuesView`) hands the selected issues to
   * `ChatLauncher.Open` as a prompt. V2's chat has no prompt intake yet, so the button appears only
   * once a host wires this up.
   */
  onOpenChat?: (prompt: string, title?: string) => void;
}

/**
 * The GitHub inbox, following V1's `Apps/Inbox` decisions: a category rail on the left
 * (`SidebarView`), and on the right a header carrying the category title, the refresh control and
 * the bulk actions over a sortable, filterable table of issues (`ContentView` / `IssuesTableView`).
 */
export const InboxView: React.FC<InboxViewProps> = ({
  projects = [],
  onCreatePlan,
  onOpenNewPlanModal,
  onOpenChat,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<InboxCategory>("my-issues");
  const [selectedProject, setSelectedProject] = useState<string>(projects[0]?.name || "");
  const [selectedRepo, setSelectedRepo] = useState<string>(projects[0]?.repos[0] || "");
  // V1's `Projects` row starts expanded (`UseState(true)` in `SidebarView.Build`).
  const [isProjectsExpanded, setIsProjectsExpanded] = useState<boolean>(true);

  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Counts for the rail badges, cached per category as each is visited.
  const [counts, setCounts] = useState<{ [key in InboxCategory]?: number }>({});

  // Filter states
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);

  // Pagination state. V1 pages client-side over one fetch; V2's daemon pages, so the table's own
  // footer drives these through `manualPagination`.
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);

  // Background polling state
  const [pollInterval, setPollInterval] = useState<PollInterval>(DEFAULT_POLL_INTERVAL);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // V1 keeps the selection as a `HashSet<int>` of issue numbers; the row id here is that number.
  const [selectedIssueNumbers, setSelectedIssueNumbers] = useState<string[]>([]);
  const [isFiring, setIsFiring] = useState<boolean>(false);
  const [fireNotice, setFireNotice] = useState<string | null>(null);

  // The row/sheet the operator drilled into (V1's `UseTrigger<GitHubIssue>` sheet).
  const [sheetIssue, setSheetIssue] = useState<GitHubIssue | null>(null);

  /** `config.Settings.Inbox.AutoAcceptAssignedIssues`, behind the Auto-Accept badge. */
  const [autoAccept, setAutoAccept] = useState<boolean | null>(null);
  /** V1's `isAutoAcceptSettingsOpen`: the gear beside the badge opens the settings dialog. */
  const [isAutoAcceptSettingsOpen, setIsAutoAcceptSettingsOpen] = useState<boolean>(false);

  // Auto-imported assigned issues waiting on a human. Kept separate from `issues`: these are rows
  // the daemon already swept, not a live GitHub query, and the decision buttons act on the row id.
  const [proposals, setProposals] = useState<InboxProposal[]>([]);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [checkSummary, setCheckSummary] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<number | null>(null);

  const isReviews = selectedCategory === "review-requests";
  const isMyIssues = selectedCategory === "my-issues";

  // Update selectedProject and selectedRepo when projects prop changes
  useEffect(() => {
    if (projects.length > 0) {
      if (!selectedProject || !projects.some((p) => p.name === selectedProject)) {
        setSelectedProject(projects[0].name);
        setSelectedRepo(projects[0].repos[0] || "");
      } else if (!selectedRepo) {
        const proj = projects.find((p) => p.name === selectedProject);
        if (proj && proj.repos.length > 0) {
          setSelectedRepo(proj.repos[0]);
        }
      }
    }
  }, [projects, selectedProject, selectedRepo]);

  const activeProjectRepos = useMemo(() => {
    const proj = projects.find((p) => p.name === selectedProject);
    return proj?.repos || [];
  }, [projects, selectedProject]);

  // Load persisted polling interval preference on mount
  useEffect(() => {
    bridge
      .loadUiState(POLL_INTERVAL_UI_STATE_KEY)
      .then((value) => {
        if (value && value in POLL_INTERVAL_MS) {
          setPollInterval(value as PollInterval);
        }
      })
      .catch(() => {
        // Persisted preference is best-effort; the V1-matching default still applies.
      });
  }, []);

  // The Auto-Accept badge reads the same setting V1's badge reads. Re-read rather than assumed after
  // the settings dialog saves, which is what V1's `refreshToken.Refresh()` does for the same badge.
  const refreshAutoAccept = useCallback(() => {
    bridge
      .getConfig()
      .then((cfg) => setAutoAccept(cfg.inbox?.autoAcceptAssignedIssues ?? false))
      .catch(() => {
        // Without the config the badge simply does not claim a state.
      });
  }, []);

  useEffect(() => {
    refreshAutoAccept();
  }, [refreshAutoAccept]);

  const handlePollIntervalChange = (value: PollInterval) => {
    setPollInterval(value);
    bridge.saveUiState(POLL_INTERVAL_UI_STATE_KEY, value).catch(() => {
      // Best-effort persistence; the in-memory selection still applies.
    });
  };

  // Fetch issues whenever category, repo, or page/pageSize changes
  const fetchIssues = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      if (silent) {
        setIsBackgroundRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        if (selectedCategory === "project-issues" && !selectedRepo) {
          // V1 `InboxApp.FetchCurrentDataAsync`: a project whose git remotes resolve to no GitHub
          // repository is told so, and no query is issued (`InboxApp.cs:98-103`). Querying with an
          // empty repo instead produced either an empty table or a daemon-shaped error.
          setIssues([]);
          setTotalCount(0);
          setHasMore(false);
          setError(`No git remotes resolved for project ${selectedProject || "(none selected)"}.`);
          return;
        }

        const repoArg = selectedCategory === "project-issues" ? selectedRepo : undefined;
        const data = await bridge.listGitHubIssues(repoArg, selectedCategory, page, pageSize);

        // Backwards compatible: handle either a raw array or a GitHubIssuesPage envelope.
        const pageIssues = Array.isArray(data) ? data : data.issues;
        const pageTotalCount = Array.isArray(data) ? null : (data.totalCount ?? null);
        const pageHasMore = Array.isArray(data) ? pageIssues.length === pageSize : data.hasMore;

        setIssues(pageIssues);
        setTotalCount(pageTotalCount);
        setHasMore(pageHasMore);
        setCounts((prev) => ({ ...prev, [selectedCategory]: pageTotalCount ?? pageIssues.length }));
        setLastUpdated(new Date());
      } catch (err) {
        setError(describeBridgeError(err));
        setIssues([]);
        setTotalCount(null);
        setHasMore(false);
      } finally {
        if (silent) {
          setIsBackgroundRefreshing(false);
        } else {
          setIsLoading(false);
        }
      }
    },
    [selectedCategory, selectedProject, selectedRepo, page, pageSize],
  );

  useEffect(() => {
    void fetchIssues();
  }, [fetchIssues]);

  /**
   * V1 keeps `inbox:my-issues` and `inbox:review-requests` running as two standing queries, so both
   * sidebar badges carry a count from the first render whichever category is open
   * (`InboxApp.cs:202-203`). V2 fetches one category at a time, which left the Reviews badge blank
   * until Reviews was visited at least once. The inactive fixed category is therefore primed on
   * mount and again whenever the category changes.
   *
   * It is deliberately not re-primed on every poll tick, where V1's 60s query expiry would have
   * kept it live: the interval here goes down to 30s, and doubling every tick's GitHub calls to keep
   * a badge current is not a trade V1 was making.
   */
  const primeInactiveCategoryCounts = useCallback(async () => {
    const inactive = (["my-issues", "review-requests"] as InboxCategory[]).filter(
      (category) => category !== selectedCategory,
    );
    await Promise.all(
      inactive.map(async (category) => {
        try {
          const data = await bridge.listGitHubIssues(undefined, category, 1, DEFAULT_PAGE_SIZE);
          const rows = Array.isArray(data) ? data : data.issues;
          const total = Array.isArray(data) ? rows.length : (data.totalCount ?? rows.length);
          setCounts((prev) => ({ ...prev, [category]: total }));
        } catch {
          // A badge is not worth an error banner; the category's own fetch reports when opened.
        }
      }),
    );
  }, [selectedCategory]);

  useEffect(() => {
    void primeInactiveCategoryCounts();
  }, [primeInactiveCategoryCounts]);

  // Pending proposals are independent of the category/repo/page selection, so this fetch has no
  // dependencies and is not part of `fetchIssues`.
  const fetchProposals = useCallback(async () => {
    try {
      const rows = await bridge.listInboxProposals();
      setProposals(rows);
      setProposalError(null);
    } catch (err) {
      // A daemon too old to know the route, or one that is down, must not blank the issue list.
      setProposalError(describeBridgeError(err));
    }
  }, []);

  useEffect(() => {
    void fetchProposals();
  }, [fetchProposals]);

  const handleCheckNow = async () => {
    setIsChecking(true);
    setProposalError(null);
    try {
      const report = await bridge.checkInbox();
      setCheckSummary(describeSweep(report));
      // V1's Check Now awaits `onRefresh()` after the sweep (`AutoAcceptSettingsDialog.cs:50`), and
      // the sweep itself invalidates the my-issues query (`AssignedIssuesAutoImportService.cs:93`):
      // a pass that accepted an issue changes what is assigned to you, so the list is stale too.
      await Promise.all([fetchProposals(), fetchIssues({ silent: true })]);
    } catch (err) {
      setCheckSummary(null);
      setProposalError(describeBridgeError(err));
    } finally {
      setIsChecking(false);
    }
  };

  const handleAcceptProposal = async (id: number) => {
    setDecidingId(id);
    setProposalError(null);
    try {
      await bridge.acceptInboxProposal(id);
      await fetchProposals();
    } catch (err) {
      setProposalError(describeBridgeError(err));
    } finally {
      setDecidingId(null);
    }
  };

  const handleDismissProposal = async (id: number) => {
    setDecidingId(id);
    setProposalError(null);
    try {
      await bridge.dismissInboxProposal(id);
      await fetchProposals();
    } catch (err) {
      setProposalError(describeBridgeError(err));
    } finally {
      setDecidingId(null);
    }
  };

  // Background polling: silently refetch on the configured interval, skipping
  // ticks while the tab/window is hidden to preserve GitHub API rate limits.
  //
  // The proposals ride the same tick. A sweep that runs server-side on `inbox.checkIntervalMinutes`
  // creates rows nothing tells this view about: the app's filesystem-change handler for `inbox` is
  // an explicit no-op (`src/api/changes.ts`), so without this the panel only ever fills on Check Now
  // or a remount. V1 had the equivalent push, `_queryService.InvalidateByTag(MyIssuesQueryTag)` at
  // the end of every pass (`AssignedIssuesAutoImportService.cs:93`).
  useEffect(() => {
    if (pollInterval === "off") {
      return;
    }
    const intervalMs = POLL_INTERVAL_MS[pollInterval];
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") {
        return;
      }
      void fetchIssues({ silent: true });
      void fetchProposals();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [pollInterval, fetchIssues, fetchProposals]);

  const resetToFirstPage = () => setPage(1);

  // V1 clears the selection, the search and both filters whenever the category or the project
  // changes (the two `UseEffect`s at the top of `InboxApp.Build`). A new category also starts at
  // page one, since V2 asks the daemon for a page rather than filtering one fetch.
  useEffect(() => {
    setSelectedIssueNumbers([]);
    setSearchQuery("");
    setSelectedLabels([]);
    setSelectedAssignees([]);
    setFireNotice(null);
    setPage(1);
  }, [selectedCategory, selectedProject]);

  // Extract distinct labels and assignees for the column filters
  const labelOptions = useMemo<BadgeSelectOption[]>(() => {
    const names = new Set<string>();
    issues.forEach((issue) => issue.labels.forEach((lbl) => names.add(lbl.name)));
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name }));
  }, [issues]);

  const assigneeOptions = useMemo<BadgeSelectOption[]>(() => {
    const logins = new Set<string>();
    issues.forEach((issue) => issue.assignees.forEach((a) => logins.add(a.login)));
    return Array.from(logins)
      .sort((a, b) => a.localeCompare(b))
      .map((login) => ({ value: login, label: login }));
  }, [issues]);

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      // V1's project query is an issue search (`is:issue`), but V2's daemon serves this category
      // from `repos/{slug}/issues`, which GitHub answers with pull requests as well. Nothing
      // server-side drops them, so a PR would otherwise appear as a row on an Issues table - and
      // firing one off would create a plan for a pull request.
      if (!isReviews && issue.isPullRequest === true) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesNumber = `#${issue.number}`.includes(q) || String(issue.number) === q;
        const matchesTitle = issue.title.toLowerCase().includes(q);
        const matchesBody = issue.body.toLowerCase().includes(q);
        const matchesAuthor = issue.author?.login.toLowerCase().includes(q) || false;
        if (!matchesNumber && !matchesTitle && !matchesBody && !matchesAuthor) {
          return false;
        }
      }

      if (selectedLabels.length > 0) {
        const issueLabelNames = issue.labels.map((l) => l.name);
        const hasAllLabels = selectedLabels.every((sl) => issueLabelNames.includes(sl));
        if (!hasAllLabels) return false;
      }

      if (selectedAssignees.length > 0) {
        const issueAssigneeLogins = issue.assignees.map((a) => a.login);
        const hasAnyAssignee = selectedAssignees.some((sa) => issueAssigneeLogins.includes(sa));
        if (!hasAnyAssignee) return false;
      }

      return true;
    });
  }, [issues, isReviews, searchQuery, selectedLabels, selectedAssignees]);

  /**
   * V1's selection is a `HashSet<int>` resolved against `allIssues`, which is every issue in the
   * category: it fetched the lot and let the table page client-side, so
   * `allIssues.Where(i => selected.Contains(i.Number))` could never lose a row
   * (`ContentView.cs:402-404`). V2 holds one server page, so a selected issue has to be remembered
   * as it is selected. Without this, selecting on page 1, paging to page 2 and pressing a bulk
   * button showed `(3)` on the button and then did nothing at all, because the count came from the
   * id set while the action came from the listed rows.
   *
   * Note this is deliberately not filtered by the client-side search either: V1's `allIssues` is
   * unaffected by the table's own filtering, so an issue selected and then filtered out of view is
   * still fired off.
   */
  const [selectedIssueDetails, setSelectedIssueDetails] = useState<Record<string, GitHubIssue>>({});

  useEffect(() => {
    setSelectedIssueDetails((prev) => {
      const next: Record<string, GitHubIssue> = {};
      let changed = Object.keys(prev).length !== selectedIssueNumbers.length;
      for (const id of selectedIssueNumbers) {
        const listed = issues.find((issue) => String(issue.number) === id);
        const resolved = listed ?? prev[id];
        if (resolved) next[id] = resolved;
        if (resolved !== prev[id]) changed = true;
      }
      return changed ? next : prev;
    });
  }, [selectedIssueNumbers, issues]);

  const selectedIssues = useMemo(
    () =>
      selectedIssueNumbers
        .map((id) => selectedIssueDetails[id])
        .filter((issue): issue is GitHubIssue => issue !== undefined),
    [selectedIssueNumbers, selectedIssueDetails],
  );
  const selectedCount = selectedIssueNumbers.length;

  /**
   * V1 `ContentView.SelectAllIssues` / `DeselectAllIssues`. Select All can only reach the rows this
   * page fetched, where V1's reached the whole category; Deselect All clears the lot, as V1's does,
   * rather than only the rows that happen to be listed.
   */
  const selectAll = () =>
    setSelectedIssueNumbers((prev) => {
      const next = new Set(prev);
      filteredIssues.forEach((issue) => next.add(String(issue.number)));
      return Array.from(next);
    });

  const deselectAll = () => setSelectedIssueNumbers([]);

  /** V1 opens nothing when no url resolves; `openUrl("")` would open a blank window. */
  const handleOpenGitHub = async (url: string | undefined) => {
    if (!url) return;
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  /**
   * V1 `InboxApp.FireOffIssues` resolves the target project in a fixed order (`InboxApp.cs:171-173`):
   * on the Project category the selected project wins outright, otherwise the issue's own repository
   * decides (`FindProjectForGithubRepo`), and a repository that matches no project falls back to the
   * literal `Auto`, the daemon's auto-detect sentinel (`routes/inbox.rs`, `resolve_project`).
   *
   * The order matters. Preferring the repository match everywhere and then falling back to
   * `selectedProject` meant an issue on My Issues from an unconfigured repository was attributed to
   * whichever project happened to be first in the sidebar, rather than left for auto-detection.
   *
   * `ProjectSummary.repos` holds local clone paths, which end in `owner/name`, so the match V1 does
   * against configured remotes is available here.
   */
  const resolveProjectForIssue = useCallback(
    (issue: GitHubIssue): string => {
      if (selectedCategory === "project-issues" && selectedProject) return selectedProject;
      const nameWithOwner = issue.repository?.nameWithOwner;
      if (nameWithOwner) {
        const match = projects.find((p) =>
          p.repos.some((repo) => repo.replace(/\/+$/, "").endsWith(nameWithOwner)),
        );
        if (match) return match.name;
      }
      return "Auto";
    },
    [projects, selectedCategory, selectedProject],
  );

  /**
   * V1's `Fire off in Tendril` writes one inbox file per issue and never asks anything else. V2
   * keeps its confirmation step for a single issue - the New Plan dialog is where the project is
   * chosen and the description edited - and takes V1's straight-through path for a multi-issue
   * selection, where opening one dialog per issue would be nonsense.
   */
  const fireOffIssues = useCallback(
    async (list: GitHubIssue[]) => {
      const seen = new Set<number>();
      const distinct = list.filter((issue) => {
        if (seen.has(issue.number)) return false;
        seen.add(issue.number);
        return true;
      });
      if (distinct.length === 0) return;

      if (distinct.length === 1 && (onOpenNewPlanModal || onCreatePlan)) {
        const issue = distinct[0];
        const project = resolveProjectForIssue(issue);
        if (onOpenNewPlanModal) {
          onOpenNewPlanModal({
            title: issue.title,
            description: buildIssueIntake(issue),
            sourceUrl: resolveIssueUrl(issue) ?? "",
            project,
          });
        } else {
          onCreatePlan?.(issue, project);
        }
        return;
      }

      setIsFiring(true);
      setFireNotice(null);
      const fired = new Set<number>();
      let failure: string | null = null;

      for (const issue of distinct) {
        try {
          await bridge.startJob({
            type: "CreatePlan",
            project: resolveProjectForIssue(issue),
            description: buildIssueIntake(issue),
            priority: 0,
            sourceUrl: resolveIssueUrl(issue),
          });
          fired.add(issue.number);
        } catch (err) {
          failure = describeBridgeError(err);
          break;
        }
      }

      // V1 writes one inbox file per issue and skips any file that already exists
      // (`InboxApp.cs:169`), so re-running after a failure never fires the same issue twice. A
      // `CreatePlan` job has no such guard, so the issues that did land leave the selection even
      // when a later one failed: pressing the button again then fires only what is still pending.
      if (fired.size > 0) {
        setSelectedIssueNumbers((prev) => prev.filter((id) => !fired.has(Number(id))));
      }

      if (failure) {
        const failedOn = distinct[fired.size]?.number;
        setFireNotice(
          `Fired off ${fired.size} of ${distinct.length}. Failed on ` +
            `${failedOn !== undefined ? `#${failedOn}` : "an issue"}: ${failure}`,
        );
      } else {
        setFireNotice(`Fired off ${fired.size} issue${fired.size === 1 ? "" : "s"} in Tendril`);
      }
      setIsFiring(false);
    },
    [onCreatePlan, onOpenNewPlanModal, resolveProjectForIssue],
  );

  const formatRelativeTime = (isoDate: string) => {
    try {
      const date = new Date(isoDate);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHrs / 24);

      if (diffDays > 0) {
        return `${diffDays}d ago`;
      }
      if (diffHrs > 0) {
        return `${diffHrs}h ago`;
      }
      return "just now";
    } catch {
      return isoDate;
    }
  };

  const formatLastUpdated = (date: Date) => {
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return "Updated just now";
    if (diffMins < 60) return `Updated ${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    return `Updated ${diffHrs}h ago`;
  };

  /** V1's `Updated` column is `pr.UpdatedAt.Value.ToString("M/d")`. */
  const formatMonthDay = (isoDate: string) => {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const issueLink = (issue: GitHubIssue) => (
    <button
      type="button"
      onClick={() => setSheetIssue(issue)}
      className="truncate text-left text-sm font-medium text-foreground hover:underline"
      title={`#${issue.number} ${issue.title}`}
    >
      #{issue.number} {issue.title}
    </button>
  );

  const repositoryCell = (issue: GitHubIssue) => {
    const label = repoLabelOf(issue);
    if (!label) return null;
    // The chip `PullRequestsView` uses for the same `LabelsDisplayRenderer` column.
    return (
      <span
        className="rounded bg-muted/80 px-2 py-0.5 text-xs font-medium text-muted-foreground"
        title={label}
      >
        {label}
      </span>
    );
  };

  /**
   * V1 `IssuesTableView`: `Selected` (the table's own checkbox column), `Issue`, `Repository`,
   * `Labels`, `Assignees`, at 45px / 45% / 180px / 200px / 150px.
   */
  const issueColumns: DataTableColumn<GitHubIssue>[] = useMemo(
    () => [
      {
        name: "issue",
        header: "Issue",
        width: "45%",
        accessor: (row) => row.number,
        cell: (_value, row) => issueLink(row),
      },
      {
        name: "repository",
        header: "Repository",
        width: "180px",
        accessor: (row) => repoLabelOf(row),
        cell: (_value, row) => repositoryCell(row),
      },
      {
        name: "labels",
        header: "Labels",
        width: "200px",
        accessor: (row) => row.labels.map((l) => l.name).join(", "),
        // V1's sheet renders labels as `BadgeVariant.Outline` badges and its table column carries no
        // colour mapping at all, so the GitHub label hex is deliberately not used here.
        cell: (_value, row) => (
          <div className="flex flex-wrap items-center gap-1">
            {row.labels.map((l) => (
              <Badge key={l.name} variant="outline" density="Small">
                {l.name}
              </Badge>
            ))}
          </div>
        ),
        wrapText: true,
      },
      {
        name: "assignees",
        header: "Assignees",
        width: "150px",
        accessor: (row) => row.assignees.map((a) => a.login).join(", "),
      },
    ],
    [],
  );

  /**
   * V1 `BuildReviewsView`: `Pull Request`, `Repository`, `Branch`, `Updated` at 50% / 180px /
   * 160px / 100px. `GitHubIssue` carries no branch, and V1 hides that column whenever every row
   * lacks one, so it is absent here for the same reason.
   */
  const reviewColumns: DataTableColumn<GitHubIssue>[] = useMemo(
    () => [
      {
        name: "review",
        header: "Pull Request",
        width: "50%",
        accessor: (row) => row.number,
        cell: (_value, row) => issueLink(row),
      },
      {
        name: "repository",
        header: "Repository",
        width: "180px",
        accessor: (row) => repoLabelOf(row),
        cell: (_value, row) => repositoryCell(row),
      },
      {
        name: "updated",
        header: "Updated",
        width: "100px",
        accessor: (row) => row.updatedAt,
        cell: (_value, row) => formatMonthDay(row.updatedAt),
      },
    ],
    [],
  );

  /** V1's `RowActions`, in V1's order and with V1's labels, icons and tooltips. */
  const issueRowActions: DataTableRowAction<GitHubIssue>[] = useMemo(
    () => [
      {
        tag: "fire-off",
        label: "Fire off in Tendril",
        icon: <Zap aria-hidden="true" />,
        tooltip: "Fire off this issue in Tendril",
        disabled: isFiring,
      },
      {
        tag: "view-details",
        label: "View Details",
        icon: <FileText aria-hidden="true" />,
        tooltip: "View issue details",
      },
      {
        tag: "open-github",
        label: "Open in GitHub",
        icon: <ExternalLink aria-hidden="true" />,
        tooltip: "Open issue on GitHub",
      },
    ],
    [isFiring],
  );

  const reviewRowActions: DataTableRowAction<GitHubIssue>[] = useMemo(
    () => [
      {
        tag: "open-github",
        label: "Review on GitHub",
        icon: <ExternalLink aria-hidden="true" />,
        tooltip: "Open pull request on GitHub",
      },
      {
        tag: "view-details",
        label: "View Details",
        icon: <FileText aria-hidden="true" />,
        tooltip: "View review details",
      },
    ],
    [],
  );

  const activeProject = projects.find((p) => p.name === selectedProject);

  /** V1's `Text.H3(title).Bold()`: `My Issues`, `Reviews`, or `{project} Issues`. */
  const title = isReviews
    ? "Reviews"
    : isMyIssues
      ? "My Issues"
      : `${activeProject?.name || selectedProject || "Project"} Issues`;

  /**
   * V1's search and column filters run over `allIssues`, the whole category, and its footer counts
   * whatever survived them. V2's run over the page the daemon returned, so while a filter is active
   * the footer has to count the filtered rows: reporting the server's total next to one visible row,
   * with a Next Page that fetches rows the filter would only hide, is worse than saying that
   * filtering searches what is loaded.
   */
  const isClientFiltered =
    searchQuery.trim().length > 0 || selectedLabels.length > 0 || selectedAssignees.length > 0;

  const rowCount = isClientFiltered
    ? filteredIssues.length
    : Math.min(
        totalCount ?? (hasMore ? page * pageSize + 1 : (page - 1) * pageSize + issues.length),
        GITHUB_SEARCH_RESULT_CAP,
      );

  return (
    /* `h-full min-h-0` is the top of the height chain the issues table needs: the shell hands this
       view a content frame of definite height (`CONTENT_PADDED_CLASS` in `ShellLayout`, a `flex-1`
       child of an absolutely-positioned pane), so `h-full` resolves, and `min-h-0` on this and every
       scrolling descendant is what lets them shrink below their content — a flex child's default
       `min-height: auto` is precisely how a bounded table turns into a page that scrolls. */
    <div data-testid="inbox-view" className="flex h-full min-h-0 gap-4">
      {/* V1 composes the inbox as `new SidebarLayout(content, sidebar)`; `SidebarView` builds these
          rows. Categories are a rail, not a row of pills. */}
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label="Inbox categories"
        /* The rail scrolls itself once a config has more projects than fit, as the Settings section
           rail does, rather than being the thing that grows the frame. */
        className="flex w-48 shrink-0 flex-col gap-1 overflow-y-auto"
      >
        <RailRow
          icon={CircleDot}
          label="My issues"
          count={counts["my-issues"]}
          selected={isMyIssues}
          testId="category-my-issues"
          onClick={() => setSelectedCategory("my-issues")}
        />
        <RailRow
          icon={GitPullRequest}
          label="Reviews"
          count={counts["review-requests"]}
          selected={isReviews}
          testId="category-review-requests"
          onClick={() => setSelectedCategory("review-requests")}
        />
        <RailExpander
          label="Projects"
          expanded={isProjectsExpanded}
          selected={selectedCategory === "project-issues"}
          onClick={() => setIsProjectsExpanded((prev) => !prev)}
        />
        {isProjectsExpanded &&
          (projects.length === 0 ? (
            <RailSubItem
              label="No projects in settings"
              icon={FolderClosed}
              testId="inbox-no-projects"
            />
          ) : (
            projects.map((proj) => (
              <RailSubItem
                key={proj.name}
                label={proj.name}
                /*
                 * `SettingsApp.cs:120-121` reduces to "the configured colour, else `Colors.Slate`" —
                 * the unset case is a neutral dot, not the absence of one. Same rule as the Settings
                 * project rail, so a project reads as the same colour in both places.
                 */
                color={proj.color?.trim() || "Slate"}
                testId={`inbox-project-${proj.name}`}
                selected={selectedCategory === "project-issues" && selectedProject === proj.name}
                onClick={() => {
                  setSelectedProject(proj.name);
                  setSelectedRepo(proj.repos[0] || "");
                  setSelectedCategory("project-issues");
                }}
              />
            ))
          ))}
      </div>

      {/* A column, not a `space-y` block: the header, filter bar and proposals keep their intrinsic
          heights while the table below takes what is left, which is what `fillHeight` needs. */}
      <div data-testid="inbox-content" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        {/* Header: title, refresh and the Auto-Accept state on the left; the bulk actions on the
            right, in V1's order (`ContentView.BuildIssuesView`). */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh"
              title="Refresh"
              disabled={isLoading}
              onClick={() => void fetchIssues()}
            >
              <RefreshCw className={isLoading ? "animate-spin" : undefined} aria-hidden="true" />
            </Button>

            {/* V1 shows the Auto-Accept state and its controls on My Issues only. */}
            {isMyIssues && autoAccept !== null && (
              /* V1's label, but the setting does less here than it did there: V1 skipped the sweep
                 entirely while off, whereas V2's sweep always runs and the flag only chooses
                 between starting a plan and proposing one below (`inbox/mod.rs` module docs). The
                 tooltip says which, since "Off" no longer means "nothing happens". */
              <Badge
                variant={autoAccept ? "primary" : "secondary"}
                density="Small"
                data-testid="inbox-auto-accept"
                title={
                  autoAccept
                    ? "Newly assigned issues start a plan as soon as they are found"
                    : "Newly assigned issues are listed below for you to accept or dismiss"
                }
              >
                {autoAccept ? "Auto-Accept: On" : "Auto-Accept: Off"}
              </Badge>
            )}
            {isMyIssues && (
              /* V1's gear beside the badge: ghost, small, tooltip only. It is the only way to reach
                 `inbox.checkIntervalMinutes`, which decides how often the daemon sweeps. */
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Auto-Accept Settings"
                title="Auto-Accept Settings"
                data-testid="inbox-auto-accept-settings"
                onClick={() => setIsAutoAcceptSettingsOpen(true)}
              >
                <Settings aria-hidden="true" />
              </Button>
            )}
            {isMyIssues && (
              /* V1 houses `Check Now` in its Auto-Accept Settings dialog only. Kept out here too
                 because V2's proposals panel below is its own thing: this is the button that fills
                 it, and it reports what the sweep did where those rows appear. */
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="inbox-check-now"
                onClick={() => void handleCheckNow()}
                disabled={isChecking}
                title="Import GitHub issues assigned to you now, without waiting for the next scheduled check"
              >
                <RefreshCw aria-hidden="true" />
                {isChecking ? "Checking..." : "Check Now"}
              </Button>
            )}
          </div>

          {!isReviews && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={selectAll}>
                Select All
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={selectedCount === 0}
                onClick={deselectAll}
              >
                Deselect All
              </Button>
              {/* V1: `{selectedCount} of {allIssues.Count} selected`, where `allIssues` is the whole
                  category rather than the visible page, and is not narrowed by the table's own
                  search. The daemon's `totalCount` is that number; it is absent for a project's
                  issues, which come back as a bare array, so the page length stands in there. */}
              <span className="text-xs text-muted-foreground" data-testid="inbox-selection-summary">
                {selectedCount} of {totalCount ?? issues.length} selected
              </span>
              {onOpenChat && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="inbox-open-chat"
                  title="Discuss the selected issues with the coding agent"
                  disabled={selectedCount === 0}
                  onClick={() =>
                    onOpenChat(buildInboxChatPrompt(selectedIssues), inboxChatTitle(selectedIssues))
                  }
                >
                  <MessageCircle aria-hidden="true" />
                  {selectedCount > 0 ? `Open Chat (${selectedCount})` : "Open Chat"}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                data-testid="inbox-fire-off"
                disabled={selectedCount === 0 || isFiring}
                onClick={() => void fireOffIssues(selectedIssues)}
              >
                <Zap aria-hidden="true" />
                {selectedCount > 0
                  ? `Fire off in Tendril (${selectedCount})`
                  : "Fire off in Tendril"}
              </Button>
            </div>
          )}
        </div>

        {/* Freshness and, for a multi-repo project, which repo is being listed. */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {selectedCategory === "project-issues" && activeProjectRepos.length > 1 && (
            <div className="flex items-center gap-1.5">
              <label htmlFor="inbox-repo-select">Repo:</label>
              <select
                id="inbox-repo-select"
                aria-label="Filter by repository"
                value={selectedRepo}
                onChange={(e) => {
                  setSelectedRepo(e.target.value);
                  resetToFirstPage();
                }}
                className="rounded-field border border-input bg-transparent px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {activeProjectRepos.map((r) => (
                  <option key={r} value={r}>
                    {r.split("/").pop()}
                  </option>
                ))}
              </select>
            </div>
          )}

          <span className="flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${
                isBackgroundRefreshing ? "animate-pulse bg-success" : "bg-muted-foreground/40"
              }`}
              aria-hidden="true"
            />
            <span data-testid="inbox-last-updated">
              {lastUpdated ? formatLastUpdated(lastUpdated) : "Not yet updated"}
            </span>
          </span>

          <span className="flex items-center gap-1.5">
            <label htmlFor="inbox-poll-interval">Auto-refresh:</label>
            <select
              id="inbox-poll-interval"
              aria-label="Auto-refresh interval"
              value={pollInterval}
              onChange={(e) => handlePollIntervalChange(e.target.value as PollInterval)}
              className="rounded-field border border-input bg-transparent px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {(Object.keys(POLL_INTERVAL_LABELS) as PollInterval[]).map((opt) => (
                <option key={opt} value={opt}>
                  {POLL_INTERVAL_LABELS[opt]}
                </option>
              ))}
            </select>
          </span>
        </div>

        {fireNotice && (
          <p data-testid="inbox-fire-notice" className="text-xs text-muted-foreground">
            {fireNotice}
          </p>
        )}

        {/* Imported proposals awaiting a decision. Hidden entirely when there are none, so the panel
            costs nothing on the common path — but a check that failed still reports, since a silent
            failure looks identical to "nothing was assigned to you".

            Scoped to My Issues, for the reason V1 scopes the Auto-Accept badge and gear there
            (`ContentView.cs:429`): these rows are what the assigned-issues sweep produced, they are
            not filtered by category or project, and repeating them under Reviews or a project's
            issues would attach them to a list they have nothing to do with. */}
        {isMyIssues && checkSummary && proposals.length === 0 && !proposalError && (
          <p data-testid="inbox-check-summary" className="text-xs text-muted-foreground">
            {checkSummary}
          </p>
        )}

        {isMyIssues && proposalError && (
          <ErrorBanner data-testid="inbox-proposal-error">{proposalError}</ErrorBanner>
        )}

        {isMyIssues && proposals.length > 0 && (
          <div data-testid="inbox-proposals" className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                Assigned issues awaiting your decision
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {proposals.length}
                </span>
              </h2>
              {checkSummary && (
                <span data-testid="inbox-check-summary" className="text-xs text-muted-foreground">
                  {checkSummary}
                </span>
              )}
            </div>

            {proposals.map((proposal) => (
              <div
                key={proposal.id}
                data-testid={`proposal-card-${proposal.id}`}
                className="rounded-box border border-info/40 bg-info/5 p-3"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => void handleOpenGitHub(proposal.issueUrl)}
                      className="truncate text-sm font-medium text-foreground hover:underline"
                    >
                      #{proposal.number} {proposal.title}
                    </button>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {proposal.repository} → {proposal.project} ·{" "}
                      {formatRelativeTime(proposal.discovered)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      data-testid={`accept-proposal-${proposal.id}`}
                      onClick={() => void handleAcceptProposal(proposal.id)}
                      disabled={decidingId === proposal.id}
                    >
                      Accept
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid={`dismiss-proposal-${proposal.id}`}
                      onClick={() => void handleDismissProposal(proposal.id)}
                      disabled={decidingId === proposal.id}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* V1's order in `BuildIssuesView`: the spinner only while the list is still empty, then the
            error with its Retry, then the empty state, then the table. */}
        {/* An empty page past the first keeps the table, and with it the footer that is the only way
            back: `NoContentView` in its place would strand the operator on a page that does not
            exist. V1 pages one in-memory list, so it could never land there. */}
        {isLoading && issues.length === 0 ? (
          <div
            data-testid="inbox-loading"
            className="flex h-32 items-center justify-center text-xs text-muted-foreground"
          >
            Loading issues from GitHub...
          </div>
        ) : error ? (
          <ErrorBanner data-testid="inbox-error" className="space-y-2">
            <div className="font-semibold text-destructive">Failed to load GitHub issues</div>
            <p>{error}</p>
            {error.toLowerCase().includes("auth login") && (
              <div className="rounded bg-background p-2 font-mono text-xs text-muted-foreground">
                $ gh auth login
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void fetchIssues()}
            >
              Retry
            </Button>
          </ErrorBanner>
        ) : filteredIssues.length === 0 && issues.length === 0 && page === 1 ? (
          <div data-testid="inbox-empty">
            {/* V1's `NoContentView` strings, per category, and V1 passes neither of them a `cta`:
                `BuildReviewsView`/`BuildIssuesView` return the header above a bare `NoContentView`. */}
            {isReviews ? (
              <NoContentView
                title="All Caught Up!"
                description="No pull requests currently require your review."
              />
            ) : (
              <NoContentView
                title="No Issues Found"
                description="No issues match the selected view."
              />
            )}
          </div>
        ) : (
          <DataTable<GitHubIssue>
            data-testid="inbox-issue-table"
            // See `PullRequestsView`: fixed layout is what makes the declared widths binding and
            // keeps the row-actions column on screen instead of overflowing to the right.
            // `min-h-0 flex-1` claims the leftover height of the column above; with `fillHeight`
            // below, that is the bound the table's own viewport scrolls inside.
            className="min-h-0 flex-1 [&_table.ivy-data-table]:table-fixed [&_table.ivy-data-table_th:last-child]:w-28"
            columns={isReviews ? reviewColumns : issueColumns}
            rows={filteredIssues}
            getRowId={(row) => String(row.number)}
            allowSorting
            showColumnOptions
            /* As `JobsView` does: a `shrink-0` toolbar over a `flex-1 min-h-0` scroll viewport, so
               the rows scroll inside the table and the sticky header stays put. Without it the table
               grows to its row count and the page's scroller is the one that moves — which is the
               whole view scrolling to read a list. */
            fillHeight
            // V1 hand-rolls a 45px `Selected` column because the bulk buttons act on it; the
            // table's own selection column is that, plus a select-all in the header.
            selectable={!isReviews}
            selectedRowIds={isReviews ? undefined : selectedIssueNumbers}
            onSelectedRowIdsChange={setSelectedIssueNumbers}
            rowActions={isReviews ? reviewRowActions : issueRowActions}
            onRowAction={({ tag, row }) => {
              if (tag === "fire-off") void fireOffIssues([row]);
              else if (tag === "view-details") setSheetIssue(row);
              // V1 `IssuesTableView.OnRowAction`: `var url = ResolveIssueUrl(raw); if (url != null)`.
              else if (tag === "open-github") void handleOpenGitHub(resolveIssueUrl(row));
            }}
            // The daemon pages, so the footer reports and drives the server-side page.
            manualPagination
            rowCount={rowCount}
            page={page}
            onPageChange={setPage}
            pageSize={pageSize}
            onPageSizeChange={(size) => {
              setPageSize(size);
              resetToFirstPage();
            }}
            emptyState={
              <span className="text-muted-foreground">
                No issues match your current search and filter criteria.
              </span>
            }
            toolbar={{
              left: (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="search"
                    aria-label="Search issues"
                    placeholder="Search by title, #number, author, or description..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      resetToFirstPage();
                    }}
                    className="w-72 rounded-field border border-input bg-transparent px-3 py-1.5 text-xs text-foreground placeholder-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  {/* V1 sets `AllowFiltering = true` on the table, which gives the Labels and
                      Assignees columns a filter each; `BadgeSelect` is how `PullRequestsView`
                      already renders that in V2. */}
                  {!isReviews && labelOptions.length > 0 && (
                    <div className="min-w-[160px]">
                      <BadgeSelect
                        id="inbox-label-filter"
                        options={labelOptions}
                        value={selectedLabels}
                        placeholder="Filter by label..."
                        multiple={true}
                        events={["OnChange"]}
                        eventHandler={(_evt: string, _id: string, args?: unknown[]) => {
                          if (args && Array.isArray(args[0])) {
                            setSelectedLabels(args[0] as string[]);
                            resetToFirstPage();
                          }
                        }}
                      />
                    </div>
                  )}
                  {!isReviews && assigneeOptions.length > 0 && (
                    <div className="min-w-[160px]">
                      <BadgeSelect
                        id="inbox-assignee-filter"
                        options={assigneeOptions}
                        value={selectedAssignees}
                        placeholder="Filter by assignee..."
                        multiple={true}
                        events={["OnChange"]}
                        eventHandler={(_evt: string, _id: string, args?: unknown[]) => {
                          if (args && Array.isArray(args[0])) {
                            setSelectedAssignees(args[0] as string[]);
                            resetToFirstPage();
                          }
                        }}
                      />
                    </div>
                  )}
                </div>
              ),
            }}
          />
        )}
      </div>

      {/* V1's issue and review sheets (`ContentView.Build`'s two `UseTrigger` blocks). */}
      <Sheet
        open={sheetIssue !== null}
        onOpenChange={(open) => {
          if (!open) setSheetIssue(null);
        }}
      >
        {/* `UxHelper.SheetWidth`: full on mobile, three quarters on tablet, half on desktop, two
            fifths when wide. `inset-y-0` is repeated from the `side="right"` variant on purpose —
            see the same note in `PullRequestsView`. */}
        <SheetContent className="inset-y-0 w-full overflow-y-auto sm:w-3/4 sm:max-w-none lg:w-1/2 xl:w-2/5">
          <SheetHeader>
            <SheetTitle>
              {sheetIssue ? `#${sheetIssue.number} ${sheetIssue.title}` : "Issue"}
            </SheetTitle>
          </SheetHeader>
          {sheetIssue && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {repoLabelOf(sheetIssue) && (
                    <Badge variant="secondary" density="Small">
                      {repoLabelOf(sheetIssue)}
                    </Badge>
                  )}
                  {sheetIssue.assignees.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Assigned: {sheetIssue.assignees.map((a) => a.login).join(", ")}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isReviews ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleOpenGitHub(sheetIssue.url)}
                    >
                      <ExternalLink aria-hidden="true" />
                      Open on GitHub
                    </Button>
                  ) : (
                    <>
                      {/* V1's sheet shows the GitHub button only when a url resolves, and resolves
                          it the same way the row action does. */}
                      {resolveIssueUrl(sheetIssue) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleOpenGitHub(resolveIssueUrl(sheetIssue))}
                        >
                          <ExternalLink aria-hidden="true" />
                          GitHub
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        disabled={isFiring}
                        onClick={() => {
                          void fireOffIssues([sheetIssue]);
                          setSheetIssue(null);
                        }}
                      >
                        <Zap aria-hidden="true" />
                        Fire off in Tendril
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* V1 shows the label row on the issue sheet only; its review sheet carries a branch
                  badge instead, which `GitHubIssue` has no field for. */}
              {!isReviews && sheetIssue.labels.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {sheetIssue.labels.map((l) => (
                    <Badge key={l.name} variant="outline" density="Small">
                      {l.name}
                    </Badge>
                  ))}
                </div>
              )}

              {sheetIssue.body.trim() ? (
                <PlanMarkdown
                  id="inbox-issue-body"
                  content={sheetIssue.body}
                  article
                  dangerouslyAllowLocalFiles
                />
              ) : (
                <p className="text-sm text-muted-foreground">No description provided.</p>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* V1 renders this alongside the sheets in the same fragment, outside the header that opens it,
          so the dialog survives a category switch that unmounts the gear. */}
      <AutoAcceptSettingsDialog
        isOpen={isAutoAcceptSettingsOpen}
        onClose={() => setIsAutoAcceptSettingsOpen(false)}
        onSaved={refreshAutoAccept}
        // V1's dialog awaits `onRefresh()` after its own Check Now, which revalidates the issue
        // query, not just whatever the pass imported (`AutoAcceptSettingsDialog.cs:50`).
        onChecked={() => {
          void fetchProposals();
          void fetchIssues({ silent: true });
        }}
      />
    </div>
  );
};
