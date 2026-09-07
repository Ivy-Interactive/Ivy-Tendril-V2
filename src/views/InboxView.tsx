import React, { useState, useEffect, useMemo, useCallback } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { bridge } from "../api/bridge";
import { describeBridgeError } from "../types/api";
import type { GitHubIssue, ProjectSummary } from "../types/api";

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
        const pageTotalCount = Array.isArray(data) ? null : data.totalCount ?? null;
        const pageHasMore = Array.isArray(data)
          ? pageIssues.length === pageSize
          : data.hasMore;

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
    [selectedCategory, selectedRepo, page, pageSize]
  );

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

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
      fetchIssues({ silent: true });
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
      prev.includes(labelName) ? prev.filter((l) => l !== labelName) : [...prev, labelName]
    );
    resetToFirstPage();
  };

  const toggleAssigneeFilter = (login: string) => {
    setSelectedAssignees((prev) =>
      prev.includes(login) ? prev.filter((a) => a !== login) : [...prev, login]
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">GitHub Issue Inbox</h1>
          <p className="text-xs text-slate-400">
            Triage issues, review pull requests, and convert incoming work into autonomous plans.
          </p>
        </div>

        {/* Project & Repo Switcher */}
        {projects.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center space-x-2">
              <label htmlFor="inbox-project-select" className="text-xs text-slate-400">
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
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
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
                <label htmlFor="inbox-repo-select" className="text-xs text-slate-400">
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
                  className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
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
      <div className="flex flex-wrap gap-2 border-b border-slate-800/80 pb-3" role="tablist">
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
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-slate-900 text-slate-300 hover:bg-slate-800"
          }`}
        >
          <span>My Issues</span>
          {counts["my-issues"] !== undefined && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                selectedCategory === "my-issues"
                  ? "bg-emerald-700 text-emerald-100"
                  : "bg-slate-800 text-slate-400"
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
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-slate-900 text-slate-300 hover:bg-slate-800"
          }`}
        >
          <span>Review Requests</span>
          {counts["review-requests"] !== undefined && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                selectedCategory === "review-requests"
                  ? "bg-emerald-700 text-emerald-100"
                  : "bg-slate-800 text-slate-400"
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
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-slate-900 text-slate-300 hover:bg-slate-800"
          }`}
        >
          <span>Project Issues</span>
          {counts["project-issues"] !== undefined && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                selectedCategory === "project-issues"
                  ? "bg-emerald-700 text-emerald-100"
                  : "bg-slate-800 text-slate-400"
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
              className="w-full rounded-lg border border-slate-800 bg-slate-900/80 px-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  resetToFirstPage();
                }}
                aria-label="Clear search"
                className="absolute right-3 top-2 text-xs text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                isBackgroundRefreshing ? "bg-emerald-400 animate-pulse" : "bg-slate-700"
              }`}
              aria-hidden="true"
            />
            <span className="text-[11px] text-slate-500" data-testid="inbox-last-updated">
              {lastUpdated ? formatLastUpdated(lastUpdated) : "Not yet updated"}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <label htmlFor="inbox-poll-interval" className="text-xs text-slate-400">
              Auto-refresh:
            </label>
            <select
              id="inbox-poll-interval"
              aria-label="Auto-refresh interval"
              value={pollInterval}
              onChange={(e) => handlePollIntervalChange(e.target.value as PollInterval)}
              className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
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
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
          >
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {/* Filter Chips for Labels & Assignees */}
        {(availableLabels.length > 0 || availableAssignees.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="text-slate-500 text-[11px]">Filters:</span>

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
                      ? "border-emerald-500 bg-emerald-950/60 text-emerald-300"
                      : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700"
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
                      ? "border-blue-500 bg-blue-950/60 text-blue-300"
                      : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700"
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
                className="text-[11px] text-slate-500 hover:text-slate-300 underline"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Error State */}
      {error && (
        <div
          role="alert"
          data-testid="inbox-error"
          className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-xs text-red-300 space-y-2"
        >
          <div className="font-semibold text-red-200">Failed to load GitHub issues</div>
          <p>{error}</p>
          {error.toLowerCase().includes("auth login") && (
            <div className="rounded bg-slate-950 p-2 font-mono text-[11px] text-slate-300">
              $ gh auth login
            </div>
          )}
          <button
            type="button"
            onClick={() => fetchIssues()}
            className="mt-2 rounded bg-red-900/60 px-3 py-1 font-medium text-red-100 hover:bg-red-800"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div data-testid="inbox-loading" className="flex h-32 items-center justify-center text-xs text-slate-500">
          Loading issues from GitHub...
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && filteredIssues.length === 0 && (
        <div
          data-testid="inbox-empty"
          className="rounded-2xl border border-dashed border-slate-800 p-8 text-center"
        >
          <p className="text-sm font-medium text-slate-300">No issues found</p>
          <p className="mt-1 text-xs text-slate-500">
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
                className="group rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition hover:border-slate-700 hover:bg-slate-900"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  {/* Issue Info */}
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-emerald-400">
                        #{issue.number}
                      </span>
                      {issue.isPullRequest && (
                        <span className="rounded bg-purple-950/80 px-2 py-0.5 font-mono text-[10px] text-purple-300 border border-purple-800/60">
                          PR
                        </span>
                      )}
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                        {repoLabel}
                      </span>
                      {issue.author && (
                        <span className="text-[11px] text-slate-400">
                          by <span className="text-slate-300">@{issue.author.login}</span>
                        </span>
                      )}
                      <span className="text-[11px] text-slate-500">
                        {formatRelativeTime(issue.updatedAt)}
                      </span>
                      {issue.commentsCount > 0 && (
                        <span className="inline-flex items-center space-x-1 text-[11px] text-slate-400">
                          <span>💬</span>
                          <span>{issue.commentsCount}</span>
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-semibold text-slate-100 leading-snug break-words">
                      {issue.title}
                    </h3>

                    {issue.body && (
                      <p className="text-xs text-slate-400 line-clamp-2 break-words">
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
                            className="inline-flex items-center space-x-1 rounded-full px-2 py-0.5 text-[10px] font-medium border border-slate-800"
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
                          className="rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-300"
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
                      className="inline-flex items-center space-x-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500"
                    >
                      <span>Create Plan</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenGitHub(issue.url)}
                      className="text-xs text-slate-400 hover:text-slate-200 transition"
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
          className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3 text-xs text-slate-400"
        >
          <span data-testid="inbox-pagination-summary">
            {totalCount !== null
              ? `Showing ${Math.min((page - 1) * pageSize + 1, totalCount)}-${Math.min(
                  page * pageSize,
                  totalCount
                )} of ${totalCount}`
              : `Page ${page}`}
          </span>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <label htmlFor="inbox-page-size" className="text-slate-500">
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
                className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
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
              className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-slate-900"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore || isLoading}
              className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-slate-900"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
