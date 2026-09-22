import React from "react";
import { Progress } from "@ivy-interactive/components/ui";

import { agentsApi } from "../../api/agentsApi";
import { useTranslation } from "../../i18n";
import type { AgentUsageSnapshot, AgentUsageWindow } from "../../types/agents";
import {
  formatCountdown,
  formatPercent,
  formatRelative,
  formatWindow,
  isUsageStale,
  minutesUntil,
  usageSeverity,
  type UsageSeverity,
} from "./agentUsage";

/**
 * `CodingAgentSetupView.cs:279-322` - the rate-limit windows above the profile models.
 *
 * Two windows and no more (`snapshot.Windows.Take(2)`), because the providers that publish usage
 * publish a short window and a long one and the third is always a variant of the long one. Which
 * variant it is goes in `note`, not in a third column.
 *
 * It renders nothing at all when the agent's provider publishes no usage - four of the seven do not,
 * and the route answers `null` for them. An empty strip would read as "no quota left".
 */

/** V1's `RefreshInterval = TimeSpan.FromSeconds(60)`, and the daemon's own cache TTL. */
export const USAGE_REFRESH_MS = 60_000;

/**
 * `Colors.Destructive` / `Colors.Warning` / no colour, on both the value text and the bar.
 *
 * `bg-*` on the bar rather than a variant, because `Progress` colours its indicator `bg-primary` and
 * takes no tone - and the indicator is the child, so the override has to reach it.
 */
const SEVERITY_TEXT: Record<UsageSeverity, string> = {
  critical: "text-destructive",
  low: "text-warning",
  ok: "text-foreground",
};

const SEVERITY_BAR: Record<UsageSeverity, string> = {
  critical: "[&>div]:bg-destructive",
  low: "[&>div]:bg-warning",
  ok: "",
};

/**
 * `WindowMetric`: the window's name, what is left of it, a bar, and when it rolls over.
 *
 * V1 computes the remaining share as `RemainingPercent ?? 100 - UsedPercent`; the daemon already
 * resolves that, so `remainingPercent` is read directly and clamped only for the bar, which cannot
 * draw outside 0-100 even if a provider reports having overshot its own limit.
 */
const WindowMetric: React.FC<{ window: AgentUsageWindow; now: Date }> = ({ window, now }) => {
  const { t } = useTranslation("settingsAgents");
  const remaining = window.remainingPercent;
  const severity = usageSeverity(remaining);
  const countdown = window.resetsAt ? formatCountdown(window.resetsAt, now) : "";
  // A window that has already rolled over is a sentence of its own rather than "resets in" + "now",
  // which reads as English word order in every other language.
  const resetsNow = window.resetsAt ? (minutesUntil(window.resetsAt, now) ?? 1) <= 0 : false;
  const vars = { window: formatWindow(window.windowMinutes), percent: formatPercent(remaining) };

  return (
    <div className="w-38 space-y-0.5" data-testid={`usage-window-${window.windowMinutes}`}>
      <p className="text-xs text-muted-foreground">{t("usage.window", vars)}</p>
      <p className={`text-sm ${SEVERITY_TEXT[severity]}`}>{t("usage.left", vars)}</p>
      <Progress
        value={Math.min(100, Math.max(0, remaining))}
        aria-label={t("usage.ariaLabel", vars)}
        className={SEVERITY_BAR[severity]}
      />
      {countdown !== "" && (
        <p className="text-xs text-muted-foreground">
          {t("usage.resetsIn", { countdown, context: resetsNow ? "now" : undefined })}
        </p>
      )}
    </div>
  );
};

export interface AgentUsageStripProps {
  /** The resolved agent id, i.e. what `resolveFinalAgent` returned - not the card key. */
  agent: string;
  /** Swapped in tests, where a fake clock is what makes a countdown assertable. */
  nowFn?: () => Date;
}

export const AgentUsageStrip: React.FC<AgentUsageStripProps> = ({ agent, nowFn }) => {
  const { t } = useTranslation("settingsAgents");
  const [snapshot, setSnapshot] = React.useState<AgentUsageSnapshot | null>(null);
  /* Read once per refresh and held, rather than called during render: a countdown computed from a
     fresh `new Date()` on every render would change whenever anything else in the pane re-rendered,
     which is both a different number each time and not what the snapshot beside it describes. */
  const readClock = React.useCallback(() => (nowFn ? nowFn() : new Date()), [nowFn]);
  const [now, setNow] = React.useState(readClock);

  React.useEffect(() => {
    let cancelled = false;
    // Cleared on every agent change, so switching cards never shows the previous agent's quota
    // against the new agent's name while the fetch is in flight.
    setSnapshot(null);

    const read = () => {
      setNow(readClock());
      agentsApi
        .getUsage(agent)
        .then((next) => {
          if (!cancelled) setSnapshot(next);
        })
        .catch(() => {
          // An unreachable daemon draws no strip, exactly as an agent with no usage provider does.
          if (!cancelled) setSnapshot(null);
        });
    };

    read();
    const timer = window.setInterval(read, USAGE_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [agent, readClock]);

  if (!snapshot || snapshot.windows.length === 0) return null;

  const stale = isUsageStale(snapshot.capturedAt, now);

  return (
    <div className="mb-4 space-y-1" data-testid="agent-usage-strip">
      <div className="flex flex-wrap gap-8">
        {snapshot.windows.slice(0, 2).map((window) => (
          <WindowMetric key={window.windowMinutes} window={window} now={now} />
        ))}
      </div>
      {/* V1 never renders `Note`, which leaves "12% left" on a weekly window ambiguous between three
          different weekly limits. It is one muted line and it names the wall. */}
      {snapshot.note && (
        <p className="text-xs text-muted-foreground" data-testid="agent-usage-note">
          {snapshot.note}
        </p>
      )}
      {stale && (
        <p className="text-xs text-muted-foreground" data-testid="agent-usage-stale">
          {t("usage.asOf", { relative: formatRelative(snapshot.capturedAt, now) })}
        </p>
      )}
    </div>
  );
};
