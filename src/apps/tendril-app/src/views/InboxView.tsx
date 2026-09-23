import React, { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  CircleDot,
  EllipsisVertical,
  ExternalLink,
  FileText,
  Folder,
  FolderClosed,
  GitPullRequest,
  Hourglass,
  MessageCircle,
  RefreshCw,
  Settings,
  X,
  Zap,
} from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  NativeSelect,
  SidebarListRow,
  SidebarListRowExpandable,
  SidebarListRowSubItem,
  Toggle,
  type DataTableColumn,
  type DataTableRowAction,
  type SidebarListRowIcon,
} from "@ivy-interactive/components/ui";
import { BadgeSelect, type BadgeSelectOption } from "@ivy-interactive/components/tendril";
import { InboxIssueSheet } from "@ivy-interactive/components/dialogs";
import {
  selectRelativeTimeUnit,
  useFormatters,
  useLocale,
  type Formatters,
  type RelativeTimeUnit,
} from "@ivy-interactive/components/i18n";
import { i18n, useTranslation, type TFunction } from "../i18n";
import { bridge } from "../api/bridge";
import { describeBridgeError } from "../types/api";
import type { GitHubIssue, InboxProposal, ProjectSummary, SweepReport } from "../types/api";
import { ErrorBanner } from "../components/ErrorBanner";
import { NoContentView } from "../components/NoContentView";
import { AutoAcceptSettingsDialog } from "./dialogs/AutoAcceptSettingsDialog";
import { FileSheet } from "./sheets/FileSheet";
import { planLinkTarget } from "./planDetail/planLinks";

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

/**
 * Each interval as a duration, which `Intl` spells in the current language: `30s` and `15m` in
 * English (the labels this select always showed), `30 Sek.` and `15 Min.` in German.
 */
const POLL_INTERVAL_DURATIONS: Record<
  Exclude<PollInterval, "off">,
  [number, "second" | "minute"]
> = {
  "30s": [30, "second"],
  "1m": [1, "minute"],
  "5m": [5, "minute"],
  "15m": [15, "minute"],
};

function pollIntervalLabel(interval: PollInterval, t: TFunction<"inbox">, format: Formatters) {
  if (interval === "off") return t("freshness.autoRefresh.off");
  const [value, unit] = POLL_INTERVAL_DURATIONS[interval];
  return format.number(value, { style: "unit", unit, unitDisplay: "narrow" });
}

/**
 * A relative time in whole units from `minUnit` up to `maxUnit`, narrow ("3h ago"), or `null` for
 * a moment less than one `minUnit` ago - or in the future, or unparseable - which the callers say as
 * "just now". That is exactly how the hand-rolled "Nh ago" / "Nm ago" helpers this replaces counted.
 */
function relativeOrJustNow(
  format: Formatters,
  value: string | Date,
  minUnit: RelativeTimeUnit,
  maxUnit: RelativeTimeUnit,
): string | null {
  const time = (value instanceof Date ? value : new Date(value)).getTime();
  if (Number.isNaN(time)) return null;
  const now = Date.now();
  const deltaMs = time - now;
  if (deltaMs >= 0 || selectRelativeTimeUnit(deltaMs, { minUnit, maxUnit }).value === 0) {
    return null;
  }
  return format.relativeTime(time, { now, style: "narrow", numeric: "always", minUnit, maxUnit });
}

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
 * `(repository, number)`, case-folded: the pair the daemon dedups a sweep on
 * (`inbox::plan_sweep_actions`), and so the pair that says which listed issue a proposal is about.
 */
function issueKey(repository: string | undefined, number: number): string {
  return `${(repository ?? "").trim().toLowerCase()}#${number}`;
}

/**
 * A table row for a proposal whose issue the current page does not list. Built from what the sweep
 * stored, which covers everything the Issue and Repository columns and the details sheet read; the
 * state, labels and assignees it never stored are left empty rather than guessed.
 */
function issueFromProposal(proposal: InboxProposal): GitHubIssue {
  return {
    number: proposal.number,
    title: proposal.title,
    body: proposal.body,
    state: "",
    assignees: [],
    labels: [],
    commentsCount: 0,
    createdAt: proposal.discovered,
    updatedAt: proposal.updated,
    url: proposal.issueUrl,
    repository: {
      name: proposal.repository.split("/").pop() || proposal.repository,
      nameWithOwner: proposal.repository,
    },
  };
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
 * other half: with auto-accept on, an imported issue becomes a plan in the same pass and is never
 * marked as awaiting a decision in the table, so the count is the only evidence the sweep did
 * anything.
 */
export function describeSweep(report: SweepReport): string {
  if (report.outcome === "AlreadyRunning") return i18n.t("inbox:sweep.alreadyRunning");
  if (report.outcome === "NotMaster") return i18n.t("inbox:sweep.notMaster");

  const parts = [
    i18n.t("inbox:sweep.imported", {
      imported: report.imported.length,
      skipped: report.skipped,
    }),
  ];
  if (report.accepted > 0) {
    parts.push(
      i18n.t("inbox:sweep.accepted", {
        count: report.accepted,
        context: report.accepted === report.imported.length ? undefined : "partial",
      }),
    );
  }
  if (report.errors.length > 0) {
    // The first error is the daemon's own text, and stays as it is.
    parts.push(
      i18n.t("inbox:sweep.errors", { count: report.errors.length, error: report.errors[0] }),
    );
  }
  // Each sentence is its own key, and so is the joint between two of them: Japanese and Chinese
  // sentences end in 。 and take no space after it, which a hard-coded " " would force on them.
  return parts.reduce((previous, next) => i18n.t("inbox:sweep.join", { previous, next }));
}

/** V1 `InboxChatPrompt.Title`. */
export function inboxChatTitle(issues: GitHubIssue[]): string | undefined {
  if (issues.length === 0) return undefined;
  return issues.length === 1
    ? `#${issues[0].number}`
    : i18n.t("inbox:chatTitle", { count: issues.length });
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
 * V1's inbox sidebar rows (`Helpers/SidebarListRow.cs`), from the package's shared component - the
 * same three shapes the Shell and the Settings rail draw, which this view used to reimplement.
 *
 * These three wrappers exist only to fix what is constant for this rail: every row is a tab in the
 * `role="tablist"` above, and the expander is always V1's `Icons.Folder`. Everything visual - the
 * `Secondary`/`Ghost` tones, the suppressed zero badge, the 1rem sub-item indent and V1's
 * project-colour box - comes from the shared component.
 */
const RailRow: React.FC<{
  icon: SidebarListRowIcon;
  label: string;
  count?: number;
  selected: boolean;
  onClick: () => void;
  testId?: string;
}> = ({ icon, label, count, selected, onClick, testId }) => (
  <SidebarListRow
    icon={icon}
    label={label}
    count={count}
    selected={selected}
    onClick={onClick}
    role="tab"
    testId={testId}
  />
);

/**
 * V1 `SidebarListRow.BuildExpandable`. The icon is not a prop because V1's inbox passes
 * `Icons.Folder` at its single call site.
 */
const RailExpander: React.FC<{
  label: string;
  expanded: boolean;
  selected: boolean;
  onClick: () => void;
}> = ({ label, expanded, selected, onClick }) => (
  <SidebarListRowExpandable
    icon={Folder}
    label={label}
    expanded={expanded}
    selected={selected}
    onClick={onClick}
  />
);

/**
 * V1 `SidebarListRow.BuildSubItem`. Icon *or* colour, never both - which is why the "No projects in
 * settings" row keeps its folder icon and gets no dot, and why it is also the one sub-item here with
 * no `onClick`: the shared component renders a handler-less sub-item as static text rather than as a
 * tab nobody can select.
 */
const RailSubItem: React.FC<{
  label: string;
  icon?: SidebarListRowIcon;
  /** An Ivy `Colors` name, e.g. the project's configured colour. */
  color?: string;
  selected?: boolean;
  onClick?: () => void;
  testId?: string;
}> = ({ label, icon, color, selected = false, onClick, testId }) => (
  <SidebarListRowSubItem
    label={label}
    icon={icon}
    color={color}
    selected={selected}
    onClick={onClick}
    role={onClick ? "tab" : undefined}
    testId={testId}
  />
);

/**
 * The two of V1's issue row actions (`IssuesTableView`'s `RowActions`) that every issue row carries
 * unchanged, whether or not it is awaiting a decision; see `rowActionsFor` for the rows that are.
 */
const viewDetailsAction = (t: TFunction<"inbox">): DataTableRowAction<GitHubIssue> => ({
  tag: "view-details",
  label: t("issueTable.actions.viewDetails.label"),
  icon: <FileText aria-hidden="true" />,
  tooltip: t("issueTable.actions.viewDetails.tooltip"),
});

const openGitHubAction = (t: TFunction<"inbox">): DataTableRowAction<GitHubIssue> => ({
  tag: "open-github",
  label: t("issueTable.actions.openGitHub.label"),
  icon: <ExternalLink aria-hidden="true" />,
  tooltip: t("issueTable.actions.openGitHub.tooltip"),
});

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
 *
 * One table, as V1 has. The assigned-issues sweep's proposals used to render as a second list of
 * cards above it, which on My Issues showed the same assigned issues twice - once as a card with
 * Accept and Dismiss, once as a row with everything else. They are now a status on the row itself:
 * see `tableIssues`.
 */
export const InboxView: React.FC<InboxViewProps> = ({
  projects = [],
  onCreatePlan,
  onOpenNewPlanModal,
  onOpenChat,
}) => {
  const { t } = useTranslation("inbox");
  const format = useFormatters();
  const { language } = useLocale();
  const [selectedCategory, setSelectedCategory] = useState<InboxCategory>("my-issues");
  const [selectedProject, setSelectedProject] = useState<string>(projects[0]?.name || "");
  const [selectedRepo, setSelectedRepo] = useState<string>(projects[0]?.repos[0] || "");
  // V1's `Projects` row starts expanded (`UseState(true)` in `SidebarView.Build`).
  const [isProjectsExpanded, setIsProjectsExpanded] = useState<boolean>(true);

  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  // True from the first render, since the mount effect starts a fetch regardless: `tableIssues` reads
  // "not loading" as "`issues` is this page's answer", which an empty list before that fetch is not.
  const [isLoading, setIsLoading] = useState<boolean>(true);
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
  // The Awaiting decision filter's own page. That view is every pending proposal, which the daemon
  // hands over in full, so the table pages it client-side while the server page stays on the first.
  const [awaitingPage, setAwaitingPage] = useState<number>(1);
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
  /**
   * V1's `openFile` (`Inbox/ContentView.cs:160/196`): a local file an issue's markdown links to,
   * opened in the `FileSheet` over the issue sheet (`FileSheet.CreateLinkClickHandler(openFile)`).
   */
  const [openFile, setOpenFile] = useState<string | null>(null);

  /** `config.Settings.Inbox.AutoAcceptAssignedIssues`, behind the Auto-Accept badge. */
  const [autoAccept, setAutoAccept] = useState<boolean | null>(null);
  /** V1's `isAutoAcceptSettingsOpen`: the gear beside the badge opens the settings dialog. */
  const [isAutoAcceptSettingsOpen, setIsAutoAcceptSettingsOpen] = useState<boolean>(false);

  // Auto-imported assigned issues waiting on a human. Fetched separately from `issues` - these are
  // rows the daemon already swept, not a live GitHub query, and Accept/Dismiss act on the proposal's
  // own id - but shown in the same table: `tableIssues` joins the two on the issue.
  const [proposals, setProposals] = useState<InboxProposal[]>([]);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [checkSummary, setCheckSummary] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<number | null>(null);
  /** The toolbar's Awaiting decision toggle: narrows the table to the issues with a proposal. */
  const [awaitingOnly, setAwaitingOnly] = useState<boolean>(false);

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
          // `i18n.t` rather than the hook's `t`: a stored message keeps the language it was made in,
          // and `t` as a dependency would refetch the issues on every language change.
          setError(
            i18n.t("inbox:errors.noRemotes", {
              project: selectedProject,
              context: selectedProject ? undefined : "noProject",
            }),
          );
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
  // an explicit no-op (`src/api/changes.ts`), so without this a row is only ever marked as awaiting a
  // decision on Check Now or a remount. V1 had the equivalent push,
  // `_queryService.InvalidateByTag(MyIssuesQueryTag)` at the end of every pass
  // (`AssignedIssuesAutoImportService.cs:93`).
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

  const resetToFirstPage = () => {
    setPage(1);
    setAwaitingPage(1);
  };

  // V1 clears the selection, the search and both filters whenever the category or the project
  // changes (the two `UseEffect`s at the top of `InboxApp.Build`). A new category also starts at
  // page one, since V2 asks the daemon for a page rather than filtering one fetch.
  useEffect(() => {
    setSelectedIssueNumbers([]);
    setSearchQuery("");
    setSelectedLabels([]);
    setSelectedAssignees([]);
    setAwaitingOnly(false);
    setFireNotice(null);
    setPage(1);
    setAwaitingPage(1);
  }, [selectedCategory, selectedProject]);

  /**
   * The pending proposals, by the issue each is about, in the daemon's order (newest first).
   *
   * Empty off My Issues, for the reason V1 scopes the Auto-Accept badge and gear there
   * (`ContentView.cs:429`): proposals are what the assigned-issues sweep produced, they are not
   * filtered by category or project, and marking them under Reviews or a project's issues would
   * attach them to a list they have nothing to do with.
   */
  const proposalsByIssue = useMemo(() => {
    const byIssue = new Map<string, InboxProposal>();
    if (!isMyIssues) return byIssue;
    for (const proposal of proposals) {
      const key = issueKey(proposal.repository, proposal.number);
      if (!byIssue.has(key)) byIssue.set(key, proposal);
    }
    return byIssue;
  }, [isMyIssues, proposals]);

  /** The proposal awaiting a decision on this issue, if there is one. */
  const proposalFor = useCallback(
    (issue: GitHubIssue): InboxProposal | undefined =>
      proposalsByIssue.get(issueKey(issue.repository?.nameWithOwner, issue.number)),
    [proposalsByIssue],
  );

  // Off once the last proposal is decided, so the table does not sit filtered to nothing behind a
  // toggle that is no longer rendered - nor come back filtered when the next sweep finds something.
  const awaitingOnlyActive = awaitingOnly && proposalsByIssue.size > 0;
  useEffect(() => {
    if (proposalsByIssue.size === 0) setAwaitingOnly(false);
  }, [proposalsByIssue.size]);

  /**
   * The one list the table shows: this page's issues, with the ones awaiting a decision first.
   *
   * The two overlap almost entirely. The sweep asks `gh` for the open issues assigned to you and keeps
   * the ones in a configured project's repositories (`inbox::fetch_assigned_issues`); My Issues
   * searches `is:open is:issue assignee:@me` across every repository (`cmd_list_github_issues`). So a
   * proposal is nearly always about an issue this category lists, and showing it as a second list is
   * what put the same issue on screen twice. The row is marked instead, and moved up so the
   * decisions are the first thing on the page.
   *
   * A proposal whose issue is not listed here is either on another page or no longer in the list at
   * all: closed, or unassigned, since the sweep found it. Only the second needs a row of its own, and
   * the two can only be told apart when this page is the whole category (and has finished loading, so
   * `issues` is this page's answer rather than the previous one's). Even then the rows are added only
   * while the page still has room for them: the footer pages by the count, and a count one past the
   * page size would offer a page two that the daemon answers with nothing, with the added rows gone
   * too because the page is no longer the first. The Awaiting decision filter adds every unlisted
   * proposal regardless, which is what keeps each one reachable when this page cannot.
   */
  const tableIssues = useMemo(() => {
    if (proposalsByIssue.size === 0) return issues;
    const listed = new Map(
      issues.map((issue) => [issueKey(issue.repository?.nameWithOwner, issue.number), issue]),
    );
    let unlisted = 0;
    for (const key of proposalsByIssue.keys()) if (!listed.has(key)) unlisted += 1;
    const pageHasRoom =
      !isLoading && page === 1 && !hasMore && (totalCount ?? issues.length) + unlisted <= pageSize;
    // The filter's rows are every proposal whichever page is loaded, so they need no loaded page to
    // be told apart from: one row per proposal either way, filled in from the live issue once it is.
    const includeUnlisted = awaitingOnlyActive || pageHasRoom;
    const awaiting: GitHubIssue[] = [];
    for (const [key, proposal] of proposalsByIssue) {
      const issue = listed.get(key);
      if (issue) awaiting.push(issue);
      else if (includeUnlisted) awaiting.push(issueFromProposal(proposal));
    }
    const pinned = new Set(awaiting);
    return [...awaiting, ...issues.filter((issue) => !pinned.has(issue))];
  }, [
    issues,
    proposalsByIssue,
    isLoading,
    awaitingOnlyActive,
    page,
    hasMore,
    totalCount,
    pageSize,
  ]);

  /** Rows `tableIssues` built from a proposal because no listed issue carried it. */
  const unlistedCount = tableIssues.length - issues.length;

  // Extract distinct labels and assignees for the column filters
  const labelOptions = useMemo<BadgeSelectOption[]>(() => {
    const names = new Set<string>();
    issues.forEach((issue) => issue.labels.forEach((lbl) => names.add(lbl.name)));
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b, language))
      .map((name) => ({ value: name, label: name }));
  }, [issues, language]);

  const assigneeOptions = useMemo<BadgeSelectOption[]>(() => {
    const logins = new Set<string>();
    issues.forEach((issue) => issue.assignees.forEach((a) => logins.add(a.login)));
    return Array.from(logins)
      .sort((a, b) => a.localeCompare(b, language))
      .map((login) => ({ value: login, label: login }));
  }, [issues, language]);

  const filteredIssues = useMemo(() => {
    return tableIssues.filter((issue) => {
      // V1's project query is an issue search (`is:issue`), but V2's daemon serves this category
      // from `repos/{slug}/issues`, which GitHub answers with pull requests as well. Nothing
      // server-side drops them, so a PR would otherwise appear as a row on an Issues table - and
      // firing one off would create a plan for a pull request.
      if (!isReviews && issue.isPullRequest === true) return false;

      if (awaitingOnlyActive && !proposalFor(issue)) return false;

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
  }, [
    tableIssues,
    isReviews,
    awaitingOnlyActive,
    proposalFor,
    searchQuery,
    selectedLabels,
    selectedAssignees,
  ]);

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
   *
   * Resolved against `tableIssues` rather than `issues`, so a row built from a proposal (see
   * `tableIssues`) fires off like any other row once selected.
   */
  const [selectedIssueDetails, setSelectedIssueDetails] = useState<Record<string, GitHubIssue>>({});

  useEffect(() => {
    setSelectedIssueDetails((prev) => {
      const next: Record<string, GitHubIssue> = {};
      let changed = Object.keys(prev).length !== selectedIssueNumbers.length;
      for (const id of selectedIssueNumbers) {
        const listed = tableIssues.find((issue) => String(issue.number) === id);
        const resolved = listed ?? prev[id];
        if (resolved) next[id] = resolved;
        if (resolved !== prev[id]) changed = true;
      }
      return changed ? next : prev;
    });
  }, [selectedIssueNumbers, tableIssues]);

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
          t("fireNotice.partial", {
            fired: fired.size,
            total: distinct.length,
            number: failedOn,
            error: failure,
            context: failedOn !== undefined ? undefined : "unknownIssue",
          }),
        );
      } else {
        setFireNotice(t("fireNotice.success", { count: fired.size }));
      }
      setIsFiring(false);
    },
    [onCreatePlan, onOpenNewPlanModal, resolveProjectForIssue, t],
  );

  /** "Updated 5m ago": whole minutes under an hour, whole hours after that, "just now" under one. */
  const formatLastUpdated = (date: Date) => {
    const when = relativeOrJustNow(format, date, "minute", "hour");
    return when === null
      ? t("freshness.updated", { context: "justNow" })
      : t("freshness.updated", { when });
  };

  /**
   * V1's `Updated` column is `pr.UpdatedAt.Value.ToString("M/d")`: the month and day as numbers, in
   * the language's order (`9/2` in English, `2.9.` in German).
   */
  const formatMonthDay = (isoDate: string) =>
    format.date(isoDate, { month: "numeric", day: "numeric" });

  const issueLink = (issue: GitHubIssue, className = "") => (
    <button
      type="button"
      onClick={() => setSheetIssue(issue)}
      className={`truncate text-left text-sm font-medium text-foreground hover:underline ${className}`}
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
   * V1's Issue column, with a row awaiting your decision marked at the front of its cell. That mark
   * is what replaces the separate list the proposals used to be shown in; V1 had no proposals, so it
   * has no column for it either.
   *
   * In the cell rather than a Status column of its own, because the Issue column is the one that
   * would pay for it: it is V1's `45%` in a fixed-layout table beside V1's fixed Repository, Labels
   * and Assignees widths, so it gets whatever is left over, and a Status column would take its width
   * from every row to mark the few that need it. It also keeps the column set constant, which the
   * table needs to keep a resized or reordered column where the operator put it once the last
   * proposal is decided.
   *
   * An icon, not a text badge, for the same reason at the scale of one row: the title beside it is
   * how the operator knows what Accept or Dismiss would act on. Measured in Chromium, an "Awaiting
   * decision" badge is 94px, and the Issue cell is 154px in the shell at 1440x900; the icon and its
   * gap are 22px. What it means is on the toolbar's filter, which carries the same icon, and in the
   * tooltip, with what the card used to print: when the sweep found the issue and which project
   * Accept would plan it in.
   */
  const issueCell = (row: GitHubIssue) => {
    const proposal = proposalFor(row);
    if (!proposal) return issueLink(row);
    // Whole hours under a day, whole days after that, "just now" under an hour.
    const found = relativeOrJustNow(format, proposal.discovered, "hour", "day");
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          role="img"
          aria-label={t("issueTable.awaitingMark.ariaLabel")}
          className="inline-flex shrink-0 text-info"
          data-testid={`inbox-awaiting-mark-${proposal.id}`}
          title={t("issueTable.awaitingMark.tooltip", {
            when: found,
            project: proposal.project,
            context: found === null ? "justNow" : undefined,
          })}
        >
          <Hourglass className="size-3.5" aria-hidden="true" />
        </span>
        {issueLink(row, "min-w-0")}
      </div>
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
        header: t("issueTable.columns.issue"),
        width: "45%",
        accessor: (row) => row.number,
        cell: (_value, row) => issueCell(row),
      },
      {
        name: "repository",
        header: t("issueTable.columns.repository"),
        width: "180px",
        accessor: (row) => repoLabelOf(row),
        cell: (_value, row) => repositoryCell(row),
      },
      {
        name: "labels",
        header: t("issueTable.columns.labels"),
        width: "200px",
        accessor: (row) =>
          format.list(
            row.labels.map((l) => l.name),
            { type: "unit", style: "short" },
          ),
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
        header: t("issueTable.columns.assignees"),
        width: "150px",
        // A unit list: "alice, bob" in English, as the `join(", ")` it replaces, and each language's
        // own separator elsewhere.
        accessor: (row) =>
          format.list(
            row.assignees.map((a) => a.login),
            { type: "unit", style: "short" },
          ),
      },
    ],
    // Rebuilt when the proposals change, so the Issue cell's mark follows them, and when the
    // language does.
    [proposalFor, t, format],
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
        header: t("reviewTable.columns.pullRequest"),
        width: "50%",
        accessor: (row) => row.number,
        cell: (_value, row) => issueLink(row),
      },
      {
        name: "repository",
        header: t("reviewTable.columns.repository"),
        width: "180px",
        accessor: (row) => repoLabelOf(row),
        cell: (_value, row) => repositoryCell(row),
      },
      {
        name: "updated",
        header: t("reviewTable.columns.updated"),
        width: "100px",
        accessor: (row) => row.updatedAt,
        cell: (_value, row) => formatMonthDay(row.updatedAt),
      },
    ],
    [t, format],
  );

  /** The two actions every issue row shares, built once per language as the constants they were. */
  const viewDetails = useMemo(() => viewDetailsAction(t), [t]);
  const openGitHub = useMemo(() => openGitHubAction(t), [t]);

  /** V1's `RowActions`, in V1's order and with V1's labels, icons and tooltips. */
  const issueRowActions: DataTableRowAction<GitHubIssue>[] = useMemo(
    () => [
      {
        tag: "fire-off",
        label: t("issueTable.actions.fireOff.label"),
        icon: <Zap aria-hidden="true" />,
        tooltip: t("issueTable.actions.fireOff.tooltip"),
        disabled: isFiring,
      },
      viewDetails,
      openGitHub,
    ],
    [isFiring, t, viewDetails, openGitHub],
  );

  /**
   * A row awaiting a decision trades Fire off for the decision itself: Accept is the same
   * `CreatePlan` from the same issue, started by the daemon so the proposal is recorded as accepted,
   * and a Fire off beside it would start the plan while leaving the row awaiting a decision that had
   * in effect been made. Dismiss is what the card's second button did. Both disable while either is
   * in flight for that proposal, as the card's buttons did.
   *
   * Still three slots, so the actions column keeps the width every other row sizes it to: a fourth
   * button needed `w-48` instead of `w-28`, and in the shell at 1440x900 those 86px came out of the
   * Issue column on every row, leaving it 67px. Accept takes Fire off's slot and View Details keeps
   * its own. Open in GitHub moves into an overflow menu with Dismiss, which is the one that cannot
   * be undone from here (the daemon keeps `Dismissed` for good), so it is a labelled, destructive
   * menu entry rather than an icon one slot from Accept. The details sheet carries both as labelled
   * buttons too.
   *
   * The function form of `rowActions` is the table's own per-row hook (the legacy `perRowActions`),
   * so the other rows keep exactly V1's three. A parent with `children` is how the table renders a
   * per-row menu, as the Jobs table's does (`jobs/rows.tsx`).
   */
  const rowActionsFor = useCallback(
    (row: GitHubIssue): DataTableRowAction<GitHubIssue>[] => {
      const proposal = proposalFor(row);
      if (!proposal) return issueRowActions;
      const deciding = decidingId === proposal.id;
      return [
        {
          tag: "accept",
          label: t("issueTable.actions.accept.label"),
          icon: <Check aria-hidden="true" />,
          tooltip: t("issueTable.actions.accept.tooltip", { project: proposal.project }),
          disabled: deciding,
        },
        viewDetails,
        {
          tag: "awaiting-menu",
          label: t("issueTable.actions.more.label"),
          icon: <EllipsisVertical aria-hidden="true" />,
          tooltip: t("issueTable.actions.more.tooltip"),
          children: [
            openGitHub,
            {
              tag: "dismiss",
              label: t("issueTable.actions.dismiss.label"),
              icon: <X aria-hidden="true" />,
              variant: "destructive",
              disabled: deciding,
            },
          ],
        },
      ];
    },
    [decidingId, issueRowActions, proposalFor, t, viewDetails, openGitHub],
  );

  const reviewRowActions: DataTableRowAction<GitHubIssue>[] = useMemo(
    () => [
      {
        tag: "open-github",
        label: t("reviewTable.actions.openGitHub.label"),
        icon: <ExternalLink aria-hidden="true" />,
        tooltip: t("reviewTable.actions.openGitHub.tooltip"),
      },
      {
        tag: "view-details",
        label: t("reviewTable.actions.viewDetails.label"),
        icon: <FileText aria-hidden="true" />,
        tooltip: t("reviewTable.actions.viewDetails.tooltip"),
      },
    ],
    [t],
  );

  const activeProject = projects.find((p) => p.name === selectedProject);

  /** V1's `Text.H3(title).Bold()`: `My Issues`, `Reviews`, or `{project} Issues`. */
  const projectName = activeProject?.name || selectedProject;
  const title = isReviews
    ? t("header.title.reviews")
    : isMyIssues
      ? t("header.title.myIssues")
      : t("header.title.projectIssues", {
          project: projectName,
          context: projectName ? undefined : "noProject",
        });

  /**
   * The Issues categories are served from `repos/{slug}/issues`, which answers with pull requests
   * too, so `filteredIssues` drops them (see above) whether or not the user has typed a filter.
   * That drop is a client-side narrowing exactly like the search box is, and the footer has to
   * count it: leaving it out is what made a page of 50 render 44 rows under "Showing 1-50 of 51".
   */
  const dropsPullRequests = !isReviews && issues.some((issue) => issue.isPullRequest === true);

  /**
   * V1's search and column filters run over `allIssues`, the whole category, and its footer counts
   * whatever survived them. V2's run over the page the daemon returned, so while a filter is active
   * the footer has to count the filtered rows: reporting the server's total next to one visible row,
   * with a Next Page that fetches rows the filter would only hide, is worse than saying that
   * filtering searches what is loaded.
   */
  const isClientFiltered =
    searchQuery.trim().length > 0 ||
    selectedLabels.length > 0 ||
    selectedAssignees.length > 0 ||
    awaitingOnlyActive ||
    dropsPullRequests;

  // `unlistedCount` is only ever non-zero here when this page is the whole category and has room
  // for the rows it adds (see `tableIssues`), so adding it keeps the footer counting exactly the
  // rows on screen, on the one page there is.
  const rowCount = isClientFiltered
    ? filteredIssues.length
    : Math.min(
        totalCount ?? (hasMore ? page * pageSize + 1 : (page - 1) * pageSize + issues.length),
        GITHUB_SEARCH_RESULT_CAP,
      ) + unlistedCount;

  /** The proposal behind the issue the details sheet is showing, when it is awaiting a decision. */
  const sheetProposal = sheetIssue ? proposalFor(sheetIssue) : undefined;

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
        aria-label={t("rail.ariaLabel")}
        /* The rail scrolls itself once a config has more projects than fit, as the Settings section
           rail does, rather than being the thing that grows the frame. */
        className="flex w-48 shrink-0 flex-col gap-1 overflow-y-auto"
      >
        <RailRow
          icon={CircleDot}
          label={t("rail.myIssues")}
          count={counts["my-issues"]}
          selected={isMyIssues}
          testId="category-my-issues"
          onClick={() => setSelectedCategory("my-issues")}
        />
        <RailRow
          icon={GitPullRequest}
          label={t("rail.reviews")}
          count={counts["review-requests"]}
          selected={isReviews}
          testId="category-review-requests"
          onClick={() => setSelectedCategory("review-requests")}
        />
        <RailExpander
          label={t("rail.projects")}
          expanded={isProjectsExpanded}
          selected={selectedCategory === "project-issues"}
          onClick={() => setIsProjectsExpanded((prev) => !prev)}
        />
        {isProjectsExpanded &&
          (projects.length === 0 ? (
            <RailSubItem
              label={t("rail.noProjects")}
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
        {/* `shrink-0` on every piece of chrome in this column, here and below: the panel and the
            table are the two things that may give up height, and anything else that shrinks does it
            by clipping its own wrapped rows rather than by scrolling. */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 shrink-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("header.refresh")}
              title={t("header.refresh")}
              disabled={isLoading}
              onClick={() => void fetchIssues()}
            >
              <RefreshCw className={isLoading ? "animate-spin" : undefined} aria-hidden="true" />
            </Button>

            {/* V1 shows the Auto-Accept state and its controls on My Issues only. */}
            {isMyIssues && autoAccept !== null && (
              /* V1's label, but the setting does less here than it did there: V1 skipped the sweep
                 entirely while off, whereas V2's sweep always runs and the flag only chooses
                 between starting a plan and marking the issue for a decision in the table below
                 (`inbox/mod.rs` module docs). The tooltip says which, since "Off" no longer means
                 "nothing happens". */
              <Badge
                variant={autoAccept ? "primary" : "secondary"}
                density="Small"
                data-testid="inbox-auto-accept"
                title={
                  autoAccept ? t("header.autoAccept.onTooltip") : t("header.autoAccept.offTooltip")
                }
              >
                {autoAccept ? t("header.autoAccept.on") : t("header.autoAccept.off")}
              </Badge>
            )}
            {isMyIssues && (
              /* V1's gear beside the badge: ghost, small, tooltip only. It is the only way to reach
                 `inbox.checkIntervalMinutes`, which decides how often the daemon sweeps. */
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("header.autoAccept.settings")}
                title={t("header.autoAccept.settings")}
                data-testid="inbox-auto-accept-settings"
                onClick={() => setIsAutoAcceptSettingsOpen(true)}
              >
                <Settings aria-hidden="true" />
              </Button>
            )}
            {isMyIssues && (
              /* V1 houses `Check Now` in its Auto-Accept Settings dialog only. Kept out here too
                 because V2's proposals are its own thing: this is the button that marks rows as
                 awaiting a decision, and it reports what the sweep did just above the table. */
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="inbox-check-now"
                onClick={() => void handleCheckNow()}
                disabled={isChecking}
                title={t("header.checkNow.tooltip")}
              >
                <RefreshCw aria-hidden="true" />
                {isChecking ? t("header.checkNow.checking") : t("header.checkNow.label")}
              </Button>
            )}
          </div>

          {!isReviews && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={selectAll}>
                {t("bulk.selectAll")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={selectedCount === 0}
                onClick={deselectAll}
              >
                {t("bulk.deselectAll")}
              </Button>
              {/* V1: `{selectedCount} of {allIssues.Count} selected`, where `allIssues` is the whole
                  category, which V1 had loaded in full. V2 pages, so this counts against the same
                  denominator the footer prints - the server total normally, the rows that survived
                  a client-side narrowing when one is in effect. Reading the raw `totalCount` here
                  was the other half of "I made select all, its only 44": Select All could only
                  reach the 44 rows the PR drop left, and the label answered 51.

                  `Math.max` because a selection outlives the page it was made on: two pages of one
                  row each leave `selectedCount` at 2 while the current page holds 1, and "2 of 1"
                  is worse than the total it is counting towards. */}
              <span className="text-xs text-muted-foreground" data-testid="inbox-selection-summary">
                {t("bulk.summary", {
                  selected: selectedCount,
                  total: Math.max(selectedCount, rowCount),
                })}
              </span>
              {onOpenChat && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="inbox-open-chat"
                  title={t("bulk.openChat.tooltip")}
                  disabled={selectedCount === 0}
                  onClick={() =>
                    onOpenChat(buildInboxChatPrompt(selectedIssues), inboxChatTitle(selectedIssues))
                  }
                >
                  <MessageCircle aria-hidden="true" />
                  {selectedCount > 0
                    ? t("bulk.openChat.labelWithCount", { selected: selectedCount })
                    : t("bulk.openChat.label")}
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
                  ? t("bulk.fireOff.labelWithCount", { selected: selectedCount })
                  : t("bulk.fireOff.label")}
              </Button>
            </div>
          )}
        </div>

        {/* Freshness and, for a multi-repo project, which repo is being listed. */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {selectedCategory === "project-issues" && activeProjectRepos.length > 1 && (
            <div className="flex items-center gap-1.5">
              <label htmlFor="inbox-repo-select">{t("freshness.repo.label")}</label>
              <NativeSelect
                id="inbox-repo-select"
                aria-label={t("freshness.repo.ariaLabel")}
                density="Small"
                wrapperClassName="w-auto"
                className="w-auto"
                value={selectedRepo}
                onChange={(e) => {
                  setSelectedRepo(e.target.value);
                  resetToFirstPage();
                }}
              >
                {activeProjectRepos.map((r) => (
                  <option key={r} value={r}>
                    {r.split("/").pop()}
                  </option>
                ))}
              </NativeSelect>
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
              {lastUpdated ? formatLastUpdated(lastUpdated) : t("freshness.notYetUpdated")}
            </span>
          </span>

          <span className="flex items-center gap-1.5">
            <label htmlFor="inbox-poll-interval">{t("freshness.autoRefresh.label")}</label>
            <NativeSelect
              id="inbox-poll-interval"
              aria-label={t("freshness.autoRefresh.ariaLabel")}
              density="Small"
              wrapperClassName="w-auto"
              className="w-auto"
              value={pollInterval}
              onChange={(e) => handlePollIntervalChange(e.target.value as PollInterval)}
            >
              {(Object.keys(POLL_INTERVAL_MS) as PollInterval[]).map((opt) => (
                <option key={opt} value={opt}>
                  {pollIntervalLabel(opt, t, format)}
                </option>
              ))}
            </NativeSelect>
          </span>
        </div>

        {fireNotice && (
          <p data-testid="inbox-fire-notice" className="shrink-0 text-xs text-muted-foreground">
            {fireNotice}
          </p>
        )}

        {/* What the last Check Now found, and why a check or a decision failed. Scoped to My Issues
            with the rest of the Auto-Accept surface (see `proposalsByIssue`). The summary stays even
            when nothing was imported, since a silent failure looks identical to "nothing was
            assigned to you"; the rows it imported are marked in the table below, not listed here. */}
        {isMyIssues && checkSummary && (
          <p data-testid="inbox-check-summary" className="shrink-0 text-xs text-muted-foreground">
            {checkSummary}
          </p>
        )}

        {isMyIssues && proposalError && (
          <ErrorBanner data-testid="inbox-proposal-error" className="shrink-0">
            {proposalError}
          </ErrorBanner>
        )}

        {/* V1's order in `BuildIssuesView`: the spinner only while the list is still empty, then the
            error with its Retry, then the empty state, then the table. */}
        {/* An empty page past the first keeps the table, and with it the footer that is the only way
            back: `NoContentView` in its place would strand the operator on a page that does not
            exist. V1 pages one in-memory list, so it could never land there. */}
        {/* The error sits above the chain rather than in it, so a failed GitHub fetch still leaves
            the table up when there are proposals to show: those come from the daemon rather than
            from GitHub, and deciding on them worked through a GitHub outage while they were a list
            of their own. `fetchIssues` clears the error as it starts, so it never shows beside the
            spinner. */}
        {error && (
          <ErrorBanner data-testid="inbox-error" className="shrink-0 space-y-2">
            <div className="font-semibold text-destructive">{t("errors.loadFailed")}</div>
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
              {t("common:actions.retry")}
            </Button>
          </ErrorBanner>
        )}
        {isLoading && tableIssues.length === 0 ? (
          <div
            data-testid="inbox-loading"
            className="flex h-32 items-center justify-center text-xs text-muted-foreground"
          >
            {t("loading")}
          </div>
        ) : error && tableIssues.length === 0 ? null : tableIssues.length === 0 && page === 1 ? (
          <div data-testid="inbox-empty">
            {/* V1's `NoContentView` strings, per category, and V1 passes neither of them a `cta`:
                `BuildReviewsView`/`BuildIssuesView` return the header above a bare `NoContentView`. */}
            {isReviews ? (
              <NoContentView
                title={t("empty.reviews.title")}
                description={t("empty.reviews.description")}
              />
            ) : (
              <NoContentView
                title={t("empty.issues.title")}
                description={t("empty.issues.description")}
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
            //
            // The issue categories' `min-w-[53rem]` keeps the Issue column from collapsing. It is
            // V1's `45%`, but in a fixed layout a percentage only gets what the fixed columns
            // leave, and the selection column, V1's 180px/200px/150px and the actions column come
            // to 695px (measured in Chromium). In the shell's default 1280x800 window, beside its
            // 320px sidebar and this view's rail, the table's viewport is 689px wide, so the Issue
            // column was 0px: no number and no title on any row. That mattered less while the
            // proposals were cards printing their own titles; as rows, a title is how the operator
            // knows what Accept or Dismiss acts on. V1's grid scrolls sideways once its columns
            // outgrow it, and so does this table below 53rem, with the actions pinned to the right
            // edge (`data-table.css`). 53rem leaves the Issue column about 150px, and binds only
            // while the table would be narrower than 848px - which it is not in a 1440px window
            // (849px) - so wider windows lay out as before.
            className={`min-h-0 flex-1 [&_table.ivy-data-table]:table-fixed [&_table.ivy-data-table_th:last-child]:w-28 ${
              isReviews ? "" : "[&_table.ivy-data-table]:min-w-[53rem]"
            }`}
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
            rowActions={isReviews ? reviewRowActions : rowActionsFor}
            onRowAction={({ tag, row }) => {
              const proposal = proposalFor(row);
              if (tag === "accept" && proposal) void handleAcceptProposal(proposal.id);
              else if (tag === "dismiss" && proposal) void handleDismissProposal(proposal.id);
              else if (tag === "fire-off") void fireOffIssues([row]);
              else if (tag === "view-details") setSheetIssue(row);
              // V1 `IssuesTableView.OnRowAction`: `var url = ResolveIssueUrl(raw); if (url != null)`.
              else if (tag === "open-github") void handleOpenGitHub(resolveIssueUrl(row));
            }}
            // The daemon pages, so the footer reports and drives the server-side page - except
            // under the Awaiting decision filter, whose rows are every pending proposal whichever
            // server page is loaded. Paging those by the server's page would render all of them on
            // every page and fetch server pages that change nothing, so the table pages them itself.
            manualPagination={!awaitingOnlyActive}
            rowCount={rowCount}
            page={awaitingOnlyActive ? awaitingPage : page}
            onPageChange={awaitingOnlyActive ? setAwaitingPage : setPage}
            pageSize={pageSize}
            onPageSizeChange={(size) => {
              setPageSize(size);
              resetToFirstPage();
            }}
            emptyState={<span className="text-muted-foreground">{t("empty.filtered")}</span>}
            toolbar={{
              left: (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="search"
                    aria-label={t("filters.search.ariaLabel")}
                    placeholder={t("filters.search.placeholder")}
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      resetToFirstPage();
                    }}
                    className="w-72 rounded-field border border-input bg-transparent px-3 py-1.5 text-xs text-foreground placeholder-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  {/* Where the separate list's heading and count used to be: every proposal, on
                      this page or not, in the table it is being decided in. Hidden while there is
                      nothing to decide, like the row marks it counts, and carrying the same icon,
                      which is what says what those marks mean.

                      "Awaiting" rather than "Awaiting decision", with the rest in the tooltip, so
                      it fits the row the search box and V1's two filters already share. Measured in
                      Chromium in the shell at 1440x900, the longer label was 172px against the
                      146px that row had left, and pushed the assignee filter onto a second row that
                      came out of the table's height. The icon takes the pressed state's colour, so
                      it stays legible on the primary fill. */}
                  {proposalsByIssue.size > 0 && (
                    <Toggle
                      variant="outline"
                      density="Small"
                      dataTestId="inbox-awaiting-filter"
                      pressed={awaitingOnly}
                      onPressedChange={(pressed) => {
                        setAwaitingOnly(pressed);
                        resetToFirstPage();
                      }}
                      title={t("filters.awaiting.tooltip")}
                      className="group px-2 text-xs"
                    >
                      <Hourglass
                        className="text-info group-data-[state=on]:text-current"
                        aria-hidden="true"
                      />
                      {t("filters.awaiting.label")}
                      <Badge variant="info" density="Small">
                        {proposalsByIssue.size}
                      </Badge>
                    </Toggle>
                  )}
                  {/* V1 sets `AllowFiltering = true` on the table, which gives the Labels and
                      Assignees columns a filter each; `BadgeSelect` is how `PullRequestsView`
                      already renders that in V2. */}
                  {!isReviews && labelOptions.length > 0 && (
                    <div className="min-w-[160px]">
                      <BadgeSelect
                        id="inbox-label-filter"
                        options={labelOptions}
                        value={selectedLabels}
                        placeholder={t("filters.labelPlaceholder")}
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
                        placeholder={t("filters.assigneePlaceholder")}
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

      {/* V1's issue and review sheets (`ContentView.Build`'s two `UseTrigger` blocks), one library
          sheet told apart by `kind`. The GitHub url resolves the way the row action resolves it. */}
      <InboxIssueSheet
        kind={isReviews ? "review" : "issue"}
        item={
          sheetIssue && {
            number: sheetIssue.number,
            title: sheetIssue.title,
            body: sheetIssue.body,
            repoLabel: repoLabelOf(sheetIssue) || undefined,
            assignees: sheetIssue.assignees.map((a) => a.login),
            labels: sheetIssue.labels.map((l) => l.name),
            url: isReviews ? sheetIssue.url : resolveIssueUrl(sheetIssue),
          }
        }
        onClose={() => setSheetIssue(null)}
        onOpenGitHub={(url) => void handleOpenGitHub(url)}
        // The row's own decision, for the reason `rowActionsFor` gives; each closes the sheet.
        proposal={sheetProposal ? { project: sheetProposal.project } : null}
        isDeciding={sheetProposal !== undefined && decidingId === sheetProposal.id}
        onAccept={() => {
          if (sheetProposal) void handleAcceptProposal(sheetProposal.id);
          setSheetIssue(null);
        }}
        onDismiss={() => {
          if (sheetProposal) void handleDismissProposal(sheetProposal.id);
          setSheetIssue(null);
        }}
        onFireOff={() => {
          if (sheetIssue) void fireOffIssues([sheetIssue]);
          setSheetIssue(null);
        }}
        isFiring={isFiring}
        onFileClick={(href) => {
          const target = planLinkTarget(href);
          if (target?.kind === "file") setOpenFile(target.path);
        }}
      />
      {/* An issue belongs to no plan, so the read may reach the configured projects' repos. */}
      <FileSheet
        planId={null}
        path={openFile}
        onClose={() => setOpenFile(null)}
        onOpenFile={setOpenFile}
      />

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
