import React, { useCallback, useEffect, useState } from "react";
import { Badge, Button } from "@ivy-interactive/components/ui";
import { useFormatters, type Formatters } from "@ivy-interactive/components/i18n";
import { bridge } from "../api/bridge";
import { onPlanEvent } from "../api/events";
import { bridgeErrorCode, describeBridgeError, type PrState, type PrStatus } from "../types/api";
import { PR_STATE_COLOR } from "../utils/prStatus";
import { useTranslation, type TFunction } from "../i18n";

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

/** Each PR state's label key. The state itself stays the raw value, which also picks the colour. */
const PR_STATE_KEYS = {
  Open: "pullRequests.state.open",
  Closed: "pullRequests.state.closed",
  Merged: "pullRequests.state.merged",
  Unknown: "pullRequests.state.unknown",
} as const satisfies Record<PrState, string>;

/** A PR state as the operator reads it; a state this build does not know is shown as it is. */
function prStateLabel(t: TFunction<"plans">, state: string): string {
  return Object.hasOwn(PR_STATE_KEYS, state) ? t(PR_STATE_KEYS[state as PrState]) : state;
}

/**
 * "checked 5m ago": "just now" under a minute, then whole minutes, hours and days - never weeks or
 * months, which the hand-rolled helper this replaces never reached for either. An unparseable time
 * leaves the line with no time in it, as that helper did.
 */
function checkedAgo(t: TFunction<"plans">, format: Formatters, dateString: string): string {
  const diffSec = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (isNaN(diffSec)) return t("pullRequests.checked", { when: "" });
  if (diffSec < 60) return t("pullRequests.checkedJustNow");
  const when = format.relativeTime(dateString, {
    style: "narrow",
    numeric: "always",
    minUnit: "minute",
    maxUnit: "day",
  });
  return t("pullRequests.checked", { when });
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
  const { t } = useTranslation("plans");
  const format = useFormatters();
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

  // A completed sync arrives on the plan channel, so the list refreshes without polling.
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
        // Without the event stream the list is merely not live; Refresh still works.
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
        // The entries are the daemon's own text; only the sentence around them is translated.
        setNotice(t("pullRequests.unreachable", { repos: report.errors.join("; ") }));
      }
      await load();
    } catch (err) {
      if (bridgeErrorCode(err) === "PR_SYNC_IN_PROGRESS") {
        setNotice(t("pullRequests.syncInProgress"));
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
    <div>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("pullRequests.title")}
        </h4>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleRefresh}
          disabled={syncing}
          className="h-auto px-2 py-1 text-xs text-muted-foreground"
        >
          {syncing ? t("pullRequests.refreshing") : t("pullRequests.refresh")}
        </Button>
      </div>

      {notice && <p className="mt-2 text-xs text-warning">{notice}</p>}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
        {rows.length > 0 ? (
          rows.map(({ url, key, status }) => (
            <li key={key} className="flex flex-wrap items-center gap-2">
              <Badge color={PR_STATE_COLOR[status?.status ?? "Unknown"]} density="Small">
                {prStateLabel(t, status?.status ?? "Unknown")}
              </Badge>
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
                  {checkedAgo(t, format, status.lastChecked)}
                </span>
              )}
            </li>
          ))
        ) : (
          <li className="text-muted-foreground/70">{t("pullRequests.empty")}</li>
        )}
      </ul>
    </div>
  );
};
