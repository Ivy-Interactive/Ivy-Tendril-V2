import React, { useCallback, useEffect, useState } from "react";
import { bridge } from "../api/bridge";
import { onPlanEvent } from "../api/events";
import { bridgeErrorCode, describeBridgeError, type PrStatus } from "../types/api";
import { PR_STATE_CLASS } from "../utils/prStatus";
import { CARD_SURFACE } from "../utils/surfaces";

interface PlanPullRequestsProps {
  planId: string;
  /** The URLs recorded on the plan. These are the rows; the daemon's cache only adds status. */
  prs: string[];
}

/** `https://github.com/{owner}/{repo}/pull/{n}`, so `/pull/7/files` and `/pull/7` are one row. */
export function canonicalPrUrl(url: string): string | null {
  const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i.exec(url.trim());
  if (!match) return null;
  return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
}

function prNumber(url: string): string {
  const match = /\/pull\/(\d+)/.exec(url);
  return match ? `#${match[1]}` : url;
}

/** `PullRequestApp.ExtractRepo`: the first two path segments, i.e. `owner/repo`. */
export function prRepo(url: string): string {
  const match = /github\.com\/([^/]+)\/([^/]+)/i.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : url;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (isNaN(diffSec)) return "";
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

/**
 * The plan's pull requests with the status the daemon last resolved. A PR the daemon has not
 * reconciled yet still shows, as `Unknown` — the plan is the source of truth for which PRs exist.
 *
 * Refresh asks the daemon to reconcile now. The daemon runs one pass at a time, so a refresh that
 * collides with the periodic pass comes back as `PR_SYNC_IN_PROGRESS`: a notice, not an error, since
 * the running pass broadcasts its result anyway.
 */
export const PlanPullRequests: React.FC<PlanPullRequestsProps> = ({ planId, prs }) => {
  const [statuses, setStatuses] = useState<Record<string, PrStatus>>({});
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await bridge.listPullRequests();
      const mine: Record<string, PrStatus> = {};
      for (const row of all) {
        if (row.planId !== planId) continue;
        const key = canonicalPrUrl(row.prUrl) ?? row.prUrl;
        mine[key] = row;
      }
      setStatuses(mine);
      setError(null);
    } catch (err) {
      // A daemon that is down must not blank the URLs the plan already gave us.
      setError(describeBridgeError(err));
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A completed sync arrives on the plan channel, so the card refreshes without polling.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void onPlanEvent((payload) => {
      const type =
        payload && typeof payload === "object"
          ? (payload as { type?: unknown }).type
          : typeof payload === "string"
            ? payload
            : undefined;
      if (type === "pr_status_changed") void load();
    })
      .then((un) => {
        if (cancelled) un();
        else unsubscribe = un;
      })
      .catch(() => {
        // Without the event stream the card is merely not live; Refresh still works.
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [load]);

  const handleRefresh = async () => {
    setSyncing(true);
    setNotice(null);
    setError(null);
    try {
      const report = await bridge.syncPullRequests();
      if (report.errors.length > 0) {
        setNotice(`GitHub could not be reached for: ${report.errors.join("; ")}`);
      }
      await load();
    } catch (err) {
      if (bridgeErrorCode(err) === "PR_SYNC_IN_PROGRESS") {
        setNotice("A sync is already running; statuses will update when it finishes.");
      } else {
        setError(describeBridgeError(err));
      }
    } finally {
      setSyncing(false);
    }
  };

  const rows = prs.map((url) => {
    const key = canonicalPrUrl(url) ?? url;
    return { url, key, status: statuses[key] };
  });

  return (
    <div className={`${CARD_SURFACE} p-4`}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Pull Requests
        </h4>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={syncing}
          className="rounded-field border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          {syncing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {notice && <p className="mt-2 text-xs text-warning">{notice}</p>}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
        {rows.length > 0 ? (
          rows.map(({ url, key, status }) => (
            <li key={key} className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide ${
                  PR_STATE_CLASS[status?.status ?? "Unknown"] ?? PR_STATE_CLASS.Unknown
                }`}
              >
                {status?.status ?? "Unknown"}
              </span>
              {/* V1's PR table pairs a Repository column with the PR link; the repo is what
                  tells two PRs of a multi-repo plan apart. */}
              <span className="font-mono text-xs text-muted-foreground">{prRepo(url)}</span>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline font-mono text-xs"
                title={url}
              >
                {prNumber(url)}
              </a>
              {status?.branch && (
                <span className="font-mono text-xs text-muted-foreground">{status.branch}</span>
              )}
              {status?.lastChecked && (
                <span className="text-xs text-muted-foreground/70">
                  checked {formatRelativeTime(status.lastChecked)}
                </span>
              )}
            </li>
          ))
        ) : (
          <li className="text-muted-foreground/70">No PRs created</li>
        )}
      </ul>
    </div>
  );
};
