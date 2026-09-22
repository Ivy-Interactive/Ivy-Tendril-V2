import React from "react";
import { Clock, Coins, Hash, type LucideIcon } from "lucide-react";

import { formatElapsed, formatTokenCount } from "../ui/StatusLine";
import { useElapsedMs } from "../ui/use-elapsed";
import { formatCurrency, useTranslation } from "@/i18n/uiShell";
import type { StreamMetrics } from "./stream-metrics.ts";

const COST_FORMAT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
  useGrouping: false,
};

/**
 * A run's cost as this footer and `result-summary.tsx` both print it, so the two cannot disagree
 * about the same number: four decimals, because the interesting costs are cents, and no grouping.
 *
 * Rounded by `toFixed` before it is formatted. `Intl` rounds a number's shortest decimal form and
 * `toFixed` its exact binary value, and the two part on ties ($4.69485 is $4.6948 by `toFixed`,
 * $4.6949 by `Intl`); rounding first keeps every figure what the `$${usd.toFixed(4)}` this replaced
 * printed, in the current language's digits.
 */
export const formatRunCost = (usd: number): string =>
  formatCurrency(Number(usd.toFixed(4)), "USD", COST_FORMAT);

interface MetricProps {
  label: string;
  /** The figure's own glyph, so the strip can be read at a glance rather than word by word. */
  icon: LucideIcon;
  value: string;
  /** Renders the "~" and says so on hover. */
  estimated?: boolean;
  /** The label and where the figure came from, for the reader who hovers to ask. */
  title: string;
  testId: string;
}

/**
 * One figure, and — this is the whole point of the component — whether anybody actually measured it.
 *
 * An estimate carries a "~", `data-estimated="true"` and its own explanation on hover, the same
 * convention `JobsView` uses for `JobCostSources.Estimated`. A number worked out from a character
 * count or a price list that presents itself as a measurement is worse than no number, because the
 * reader has no way to tell it apart from one they could act on.
 *
 * The icon is decorative: it repeats what the label already says, so it is `aria-hidden` and the
 * label stays the accessible name.
 */
const Metric: React.FC<MetricProps> = ({
  label,
  icon: Icon,
  value,
  estimated = false,
  title,
  testId,
}) => (
  <span className="aov-metric" data-estimated={estimated} data-testid={testId} title={title}>
    <Icon className="aov-metric-icon" aria-hidden="true" />
    <span className="aov-metric-label">{label}</span>
    <span className="aov-metric-value">
      {estimated ? "~" : ""}
      {value}
    </span>
  </span>
);

export interface AgentMetricsFooterProps {
  metrics: StreamMetrics;
  /** Whether the run has reported its terminal result — what stops the elapsed timer. */
  isComplete: boolean;
  /**
   * `false` drops the rule over the strip, for a framing that already rules off the viewer's edge.
   * See {@link AgentViewerProps.showMetricsDivider}; the padding stays either way, because it is what
   * keeps these figures off the last line of the log.
   */
  showDivider?: boolean;
  /**
   * When the run actually began, from whoever owns the run rather than from its log.
   *
   * `metrics.startedAt` is the timestamp of the first line folded out of the event stream, which is
   * only the run's start while the log holds exactly one run. A job id that was reissued after its
   * row was cleared inherits the kept log of the job before it, and the footer then anchors on that
   * run's first line: a job two minutes old reported "20h 25m". The daemon's own `startedAt` for
   * the job is authoritative, so a caller that has one passes it and the stream is the fallback.
   */
  startedAt?: string | null;
}

/**
 * The analytics under a run: how long it took, how many tokens it burned, what it cost.
 *
 * Deliberately **outside** the viewer's scrolling body. Two reasons, and both matter:
 *
 * 1. The body is windowed. Every node inside it is sized by `node-heights.ts` before it mounts and
 *    measured after, and a footer is not a node of the log — it would need a height estimate, an index
 *    the virtualizer could place, and a position at the end of a list it does not belong to.
 * 2. The elapsed time ticks once a second. State that ticks re-renders the component holding it, so it
 *    is held *here*, in a leaf: the windowed body is a sibling and never re-renders for a tick, which
 *    it must not, because re-measuring a viewport of nodes every second is exactly the cost windowing
 *    was introduced to remove.
 *
 * Renders nothing when the stream has said nothing worth a line, so a viewer waiting on its first
 * output does not grow an empty bar.
 */
export const AgentMetricsFooter: React.FC<AgentMetricsFooterProps> = ({
  metrics,
  isComplete,
  showDivider = true,
  startedAt,
}) => {
  const { t } = useTranslation("uiShell");
  // The agent's own duration outranks our reading of the clock, and once the run is over the span
  // between its first and last event is the measurement — neither is an estimate, so neither carries a
  // "~"; they differ only in who did the measuring, which the hover text says.
  const streamSpan =
    metrics.startedAt && metrics.endedAt
      ? Date.parse(metrics.endedAt) - Date.parse(metrics.startedAt)
      : Number.NaN;
  const reportedMs = metrics.durationMs;
  const frozenMs =
    reportedMs != null ? reportedMs : isComplete && Number.isFinite(streamSpan) ? streamSpan : null;
  const elapsedMs = useElapsedMs(startedAt ?? metrics.startedAt, frozenMs, isComplete);

  // A finished run whose whole life was one event has a span of 0 and nothing to say about duration;
  // "0s" under it is noise, not information.
  const showElapsed = elapsedMs != null && (elapsedMs > 0 || !isComplete);
  const tokens = metrics.tokens != null && metrics.tokens > 0 ? metrics.tokens : null;
  const costUsd = metrics.costUsd != null && metrics.costUsd > 0 ? metrics.costUsd : null;

  if (!showElapsed && tokens == null && costUsd == null) return null;

  return (
    <div
      className={`aov-metrics${showDivider ? "" : " aov-metrics-flush"}`}
      data-testid="agent-metrics-footer"
    >
      {showElapsed && (
        <Metric
          label={t("metrics.elapsed.label")}
          icon={Clock}
          value={formatElapsed(elapsedMs)}
          title={
            reportedMs != null
              ? t("metrics.elapsed.reportedTooltip")
              : isComplete
                ? t("metrics.elapsed.measuredTooltip")
                : t("metrics.elapsed.runningTooltip")
          }
          testId="agent-metrics-elapsed"
        />
      )}
      {tokens != null && (
        <Metric
          label={t("metrics.tokens.label")}
          icon={Hash}
          value={formatTokenCount(tokens)}
          estimated={metrics.tokensEstimated}
          title={
            metrics.tokensEstimated
              ? t("metrics.tokens.estimatedTooltip")
              : t("metrics.tokens.reportedTooltip")
          }
          testId="agent-metrics-tokens"
        />
      )}
      {costUsd != null && (
        <Metric
          label={t("metrics.cost.label")}
          icon={Coins}
          value={formatRunCost(costUsd)}
          estimated={metrics.costEstimated}
          title={
            metrics.costEstimated
              ? t("metrics.cost.estimatedTooltip")
              : t("metrics.cost.billedTooltip")
          }
          testId="agent-metrics-cost"
        />
      )}
    </div>
  );
};
