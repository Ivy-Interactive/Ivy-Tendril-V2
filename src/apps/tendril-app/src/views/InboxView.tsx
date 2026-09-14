import React, { useState, useEffect, useMemo, useCallback } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { bridge } from "../api/bridge";
import { describeBridgeError } from "../types/api";
import type { GitHubIssue, InboxProposal, ProjectSummary } from "../types/api";

export type InboxCategory = "my-issues" | "review-requests" | "project-issues";

export type PollInterval = "off" | "30s" | "1m" | "5m" | "15m";

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

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

const POLL_INTERVAL_UI_STATE_KEY = "inbox_poll_interval";

export interface InboxViewProps {
  projects?: ProjectSummary[];
  onCreatePlan?: (issue: GitHubIssue, project?: string) => void;
  onOpenNewPlanModal?: (prefill: {
    title: string;
    description: string;
    sourceUrl: string;
    project?: string;
  }) => void;
}

export const InboxView: React.FC<InboxViewProps> = ({
  projects = [],
  onCreatePlan,
  onOpenNewPlanModal,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<InboxCategory>("my-issues");
  const [selectedProject, setSelectedProject] = useState<string>(projects[0]?.name || "");
  const [selectedRepo, setSelectedRepo] = useState<string>(projects[0]?.repos[0] || "");

  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Counts for category badges
  const [counts, setCounts] = useState<{ [key in InboxCategory]?: number }>({});

  // Filter states
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);

  // Pagination state
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);

  // Background polling state
  const [pollInterval, setPollInterval] = useState<PollInterval>("off");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Auto-imported assigned issues waiting on a human. Kept separate from `issues`: these are rows
  // the daemon already swept, not a live GitHub query, and the decision buttons act on the row id.
  const [proposals, setProposals] = useState<InboxProposal[]>([]);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [checkSummary, setCheckSummary] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<number | null>(null);

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

  // Update repo list when project changes
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
        // Persisted preference is best-effort; default to "off" on failure.
      });
  }, []);

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
    [selectedCategory, selectedRepo, page, pageSize],
  );

  useEffect(() => {
    void fetchIssues();
  }, [fetchIssues]);

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
      setCheckSummary(
        report.outcome === "AlreadyRunning"
          ? "A check is already running."
          : `Imported ${report.imported.length}, skipped ${report.skipped}.`,
      );
      await fetchProposals();
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
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [pollInterval, fetchIssues]);

  const resetToFirstPage = () => setPage(1);

  // Extract distinct labels and assignees for filtering
  const availableLabels = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    issues.forEach((issue) => {
      issue.labels.forEach((lbl) => {
        if (!map.has(lbl.name)) {
          map.set(lbl.name, { name: lbl.name, color: lbl.color });
        }
      });
    });
    return Array.from(map.values());
  }, [issues]);

  const availableAssignees = useMemo(() => {
    const set = new Set<string>();
    issues.forEach((issue) => {
      issue.assignees.forEach((a) => set.add(a.login));
    });
    return Array.from(set);
  }, [issues]);

  // Filtered issues based on search, labels, and assignees
  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
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
  }, [issues, searchQuery, selectedLabels, selectedAssignees]);

  const toggleLabelFilter = (labelName: string) => {
    setSelectedLabels((prev) =>
      prev.includes(labelName) ? prev.filter((l) => l !== labelName) : [...prev, labelName],
    );
    resetToFirstPage();
  };

  const toggleAssigneeFilter = (login: string) => {
    setSelectedAssignees((prev) =>
      prev.includes(login) ? prev.filter((a) => a !== login) : [...prev, login],
    );
    resetToFirstPage();
  };

  const handleOpenGitHub = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  const handleCreatePlan = (issue: GitHubIssue) => {
    const prefill = {
      title: issue.title,
      description: `Task from GitHub Issue #${issue.number} (${issue.url}):\n\n${issue.body}`,
      sourceUrl: issue.url,
      project: selectedProject || undefined,
    };

    if (onOpenNewPlanModal) {
      onOpenNewPlanModal(prefill);
    } else if (onCreatePlan) {
      onCreatePlan(issue, selectedProject);
    }
  };

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

  return (
    <div data-testid="inbox-view" className="space-y-6">
      {/* Header & Project/Repo Switcher */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">GitHub Issue Inbox</h1>
          <p className="text-xs text-muted-foreground">
            Triage issues, review pull requests, and convert incoming work into autonomous plans.
          </p>
        </div>

        {/* Project & Repo Switcher */}
        {projects.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center space-x-2">
              <label htmlFor="inbox-project-select" className="text-xs text-muted-foreground">
                Project:
              </label>
              <select
                id="inbox-project-select"
                aria-label="Filter by project"
                value={selectedProject}
                onChange={(e) => {
                  const newProj = e.target.value;
                  setSelectedProject(newProj);
                  const proj = projects.find((p) => p.name === newProj);
                  if (proj && proj.repos.length > 0) {
                    setSelectedRepo(proj.repos[0]);
                  } else {
                    setSelectedRepo("");
                  }
                  resetToFirstPage();
                }}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
              >
                {projects.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {activeProjectRepos.length > 1 && (
              <div className="flex items-center space-x-2">
                <label htmlFor="inbox-repo-select" className="text-xs text-muted-foreground">
                  Repo:
                </label>
                <select
                  id="inbox-repo-select"
                  aria-label="Filter by repository"
                  value={selectedRepo}
                  onChange={(e) => {
                    setSelectedRepo(e.target.value);
                    resetToFirstPage();
                  }}
                  className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
                >
                  {activeProjectRepos.map((r) => (
                    <option key={r} value={r}>
                      {r.split("/").pop()}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border/80 pb-3" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={selectedCategory === "my-issues"}
          data-testid="category-my-issues"
          onClick={() => {
            setSelectedCategory("my-issues");
            resetToFirstPage();
          }}
          className={`flex items-center space-x-2 rounded-full px-4 py-1.5 text-xs font-medium transition ${
            selectedCategory === "my-issues"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-card text-muted-foreground hover:bg-muted"
          }`}
        >
          <span>My Issues</span>
          {counts["my-issues"] !== undefined && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                selectedCategory === "my-issues"
                  ? "bg-primary text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {counts["my-issues"]}
            </span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={selectedCategory === "review-requests"}
          data-testid="category-review-requests"
          onClick={() => {
            setSelectedCategory("review-requests");
            resetToFirstPage();
          }}
          className={`flex items-center space-x-2 rounded-full px-4 py-1.5 text-xs font-medium transition ${
            selectedCategory === "review-requests"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-card text-muted-foreground hover:bg-muted"
          }`}
        >
          <span>Review Requests</span>
          {counts["review-requests"] !== undefined && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                selectedCategory === "review-requests"
                  ? "bg-primary text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {counts["review-requests"]}
            </span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={selectedCategory === "project-issues"}
          data-testid="category-project-issues"
          onClick={() => {
            setSelectedCategory("project-issues");
            resetToFirstPage();
          }}
          className={`flex items-center space-x-2 rounded-full px-4 py-1.5 text-xs font-medium transition ${
            selectedCategory === "project-issues"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-card text-muted-foreground hover:bg-muted"
          }`}
        >
          <span>Project Issues</span>
          {counts["project-issues"] !== undefined && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                selectedCategory === "project-issues"
                  ? "bg-primary text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {counts["project-issues"]}
            </span>
          )}
        </button>
      </div>

      {/* Search Bar & Multi-Select Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <input
              type="search"
              aria-label="Search issues"
              placeholder="Search by title, #number, author, or description..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                resetToFirstPage();
              }}
              className="w-full rounded-lg border border-border bg-card/80 px-4 py-2 text-xs text-foreground placeholder-muted-foreground/70 focus:border-ring focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  resetToFirstPage();
                }}
                aria-label="Clear search"
                className="absolute right-3 top-2 text-xs text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                isBackgroundRefreshing ? "bg-success animate-pulse" : "bg-accent"
              }`}
              aria-hidden="true"
            />
            <span className="text-[11px] text-muted-foreground/70" data-testid="inbox-last-updated">
              {lastUpdated ? formatLastUpdated(lastUpdated) : "Not yet updated"}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <label htmlFor="inbox-poll-interval" className="text-xs text-muted-foreground">
              Auto-refresh:
            </label>
            <select
              id="inbox-poll-interval"
              aria-label="Auto-refresh interval"
              value={pollInterval}
              onChange={(e) => handlePollIntervalChange(e.target.value as PollInterval)}
              className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
            >
              {(Object.keys(POLL_INTERVAL_LABELS) as PollInterval[]).map((opt) => (
                <option key={opt} value={opt}>
                  {POLL_INTERVAL_LABELS[opt]}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => fetchIssues()}
            disabled={isLoading}
            className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
          >
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>

          {/* Refresh re-queries GitHub; this asks the daemon to run an import sweep, which is what
              turns assigned issues into proposals or plans. */}
          <button
            type="button"
            data-testid="inbox-check-now"
            onClick={() => void handleCheckNow()}
            disabled={isChecking}
            title="Import GitHub issues assigned to you now, without waiting for the next scheduled check"
            className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
          >
            {isChecking ? "Checking..." : "Check now"}
          </button>
        </div>

        {/* Filter Chips for Labels & Assignees */}
        {(availableLabels.length > 0 || availableAssignees.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="text-muted-foreground/70 text-[11px]">Filters:</span>

            {availableLabels.map((lbl) => {
              const isSelected = selectedLabels.includes(lbl.name);
              const hexColor = lbl.color.startsWith("#") ? lbl.color : `#${lbl.color}`;
              return (
                <button
                  key={lbl.name}
                  type="button"
                  onClick={() => toggleLabelFilter(lbl.name)}
                  aria-pressed={isSelected}
                  className={`inline-flex items-center space-x-1.5 rounded-full px-2.5 py-1 text-[11px] transition border ${
                    isSelected
                      ? "border-ring bg-success/10 text-success"
                      : "border-border bg-card/60 text-muted-foreground hover:border-ring"
                  }`}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: hexColor }}
                  />
                  <span>{lbl.name}</span>
                </button>
              );
            })}

            {availableAssignees.map((login) => {
              const isSelected = selectedAssignees.includes(login);
              return (
                <button
                  key={login}
                  type="button"
                  onClick={() => toggleAssigneeFilter(login)}
                  aria-pressed={isSelected}
                  className={`inline-flex items-center space-x-1 rounded-full px-2.5 py-1 text-[11px] transition border ${
                    isSelected
                      ? "border-info bg-info/10 text-info"
                      : "border-border bg-card/60 text-muted-foreground hover:border-ring"
                  }`}
                >
                  <span>@{login}</span>
                </button>
              );
            })}

            {(selectedLabels.length > 0 || selectedAssignees.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  setSelectedLabels([]);
                  setSelectedAssignees([]);
                  resetToFirstPage();
                }}
                className="text-[11px] text-muted-foreground/70 hover:text-muted-foreground underline"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Imported proposals awaiting a decision. Hidden entirely when there are none, so the panel
          costs nothing on the common path — but a check that failed still reports, since a silent
          failure looks identical to "nothing was assigned to you". */}
      {checkSummary && proposals.length === 0 && !proposalError && (
        <p data-testid="inbox-check-summary" className="text-[11px] text-muted-foreground/70">
          {checkSummary}
        </p>
      )}

      {proposalError && (
        <div
          role="alert"
          data-testid="inbox-proposal-error"
          className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          {proposalError}
        </div>
      )}

      {proposals.length > 0 && (
        <div data-testid="inbox-proposals" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Assigned issues awaiting your decision
              <span className="ml-2 text-[11px] font-normal text-muted-foreground/70">
                {proposals.length}
              </span>
            </h2>
            {checkSummary && (
              <span
                data-testid="inbox-check-summary"
                className="text-[11px] text-muted-foreground/70"
              >
                {checkSummary}
              </span>
            )}
          </div>

          {proposals.map((proposal) => (
            <div
              key={proposal.id}
              data-testid={`proposal-card-${proposal.id}`}
              className="rounded-xl border border-info/40 bg-info/5 p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => void handleOpenGitHub(proposal.issueUrl)}
                    className="truncate text-sm font-medium text-foreground hover:underline"
                  >
                    #{proposal.number} {proposal.title}
                  </button>
                  <p className="mt-1 text-[11px] text-muted-foreground/70">
                    {proposal.repository} → {proposal.project} ·{" "}
                    {formatRelativeTime(proposal.discovered)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    data-testid={`accept-proposal-${proposal.id}`}
                    onClick={() => void handleAcceptProposal(proposal.id)}
                    disabled={decidingId === proposal.id}
                    className="rounded-lg bg-success/10 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/20"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    data-testid={`dismiss-proposal-${proposal.id}`}
                    onClick={() => void handleDismissProposal(proposal.id)}
                    disabled={decidingId === proposal.id}
                    className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div
          role="alert"
          data-testid="inbox-error"
          className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive space-y-2"
        >
          <div className="font-semibold text-destructive">Failed to load GitHub issues</div>
          <p>{error}</p>
          {error.toLowerCase().includes("auth login") && (
            <div className="rounded bg-background p-2 font-mono text-[11px] text-muted-foreground">
              $ gh auth login
            </div>
          )}
          <button
            type="button"
            onClick={() => fetchIssues()}
            className="mt-2 rounded bg-destructive/10 px-3 py-1 font-medium text-destructive hover:bg-destructive/20"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div
          data-testid="inbox-loading"
          className="flex h-32 items-center justify-center text-xs text-muted-foreground/70"
        >
          Loading issues from GitHub...
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && filteredIssues.length === 0 && (
        <div
          data-testid="inbox-empty"
          className="rounded-2xl border border-dashed border-border p-8 text-center"
        >
          <p className="text-sm font-medium text-muted-foreground">No issues found</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {issues.length === 0
              ? "No open issues found in this category."
              : "No issues match your current search and filter criteria."}
          </p>
        </div>
      )}

      {/* Issues List Cards */}
      {!isLoading && !error && filteredIssues.length > 0 && (
        <div data-testid="inbox-issue-list" className="space-y-3">
          {filteredIssues.map((issue) => {
            const repoLabel =
              issue.repository?.nameWithOwner || issue.repository?.name || selectedProject;

            return (
              <div
                key={`${issue.number}-${issue.url}`}
                data-testid={`issue-card-${issue.number}`}
                className="group rounded-xl border border-border bg-card/60 p-4 transition hover:border-ring hover:bg-card"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  {/* Issue Info */}
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-success">
                        #{issue.number}
                      </span>
                      {issue.isPullRequest && (
                        <span className="rounded bg-purple/10 px-2 py-0.5 font-mono text-[10px] text-purple border border-purple/40">
                          PR
                        </span>
                      )}
                      <span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {repoLabel}
                      </span>
                      {issue.author && (
                        <span className="text-[11px] text-muted-foreground">
                          by <span className="text-muted-foreground">@{issue.author.login}</span>
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground/70">
                        {formatRelativeTime(issue.updatedAt)}
                      </span>
                      {issue.commentsCount > 0 && (
                        <span className="inline-flex items-center space-x-1 text-[11px] text-muted-foreground">
                          <span>💬</span>
                          <span>{issue.commentsCount}</span>
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-semibold text-foreground leading-snug break-words">
                      {issue.title}
                    </h3>

                    {issue.body && (
                      <p className="text-xs text-muted-foreground line-clamp-2 break-words">
                        {issue.body}
                      </p>
                    )}

                    {/* Labels and Assignees */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {issue.labels.map((l) => {
                        const hexColor = l.color.startsWith("#") ? l.color : `#${l.color}`;
                        return (
                          <span
                            key={l.name}
                            className="inline-flex items-center space-x-1 rounded-full px-2 py-0.5 text-[10px] font-medium border border-border"
                            style={{
                              backgroundColor: `${hexColor}22`,
                              color: hexColor,
                            }}
                          >
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: hexColor }}
                            />
                            <span>{l.name}</span>
                          </span>
                        );
                      })}

                      {issue.assignees.map((a) => (
                        <span
                          key={a.login}
                          className="rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          👤 @{a.login}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Actions: Open on GitHub & Create Plan */}
                  <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0 pt-2 sm:pt-0">
                    <button
                      type="button"
                      data-testid={`create-plan-btn-${issue.number}`}
                      onClick={() => handleCreatePlan(issue)}
                      className="inline-flex items-center space-x-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
                    >
                      <span>Create Plan</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenGitHub(issue.url)}
                      className="text-xs text-muted-foreground hover:text-foreground transition"
                      title="Open on GitHub"
                    >
                      View on GitHub ↗
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Bar */}
      {!isLoading && !error && (
        <div
          data-testid="inbox-pagination"
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground"
        >
          <span data-testid="inbox-pagination-summary">
            {totalCount !== null
              ? `Showing ${Math.min((page - 1) * pageSize + 1, totalCount)}-${Math.min(
                  page * pageSize,
                  totalCount,
                )} of ${totalCount}`
              : `Page ${page}`}
          </span>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <label htmlFor="inbox-page-size" className="text-muted-foreground/70">
                Per page:
              </label>
              <select
                id="inbox-page-size"
                aria-label="Page size"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  resetToFirstPage();
                }}
                className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground focus:border-ring focus:outline-none"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-card"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore || isLoading}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-card"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
