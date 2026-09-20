import React from "react";

import { formatElapsed, formatTokenCount } from "../ui/StatusLine";
import { useElapsedMs } from "../ui/use-elapsed";
import type { StreamMetrics } from "./stream-metrics.ts";

/**
 * A cost in the shape `result-summary.tsx` prints it, so the footer and the result's own stats row
 * cannot disagree about the same number. Four decimals because the interesting costs are cents.
 */
function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

interface MetricProps {
  label: string;
  value: string;
  /** Renders the "~" and says so on hover. */
  estimated?: boolean;
  /** Where the figure came from, for the reader who hovers to ask. */
  provenance: string;
  testId: string;
}

/**
 * One figure, and — this is the whole point of the component — whether anybody actually measured it.
 *
 * An estimate carries a "~", `data-estimated="true"` and its own explanation on hover, the same
 * convention `JobsView` uses for `JobCostSources.Estimated`. A number worked out from a character
 * count or a price list that presents itself as a measurement is worse than no number, because the
 * reader has no way to tell it apart from one they could act on.
 */
const Metric: React.FC<MetricProps> = ({ label, value, estimated = false, provenance, testId }) => (
  <span
    className="aov-metric"
    data-estimated={estimated}
    data-testid={testId}
    title={`${label}: ${provenance}`}
  >
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
}) => {
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
  const elapsedMs = useElapsedMs(metrics.startedAt, frozenMs, isComplete);

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
          label="Elapsed"
          value={formatElapsed(elapsedMs)}
          provenance={
            reportedMs != null
              ? "the duration the agent reported"
              : isComplete
                ? "measured from the first event to the last"
                : "measured from the first event"
          }
          testId="agent-metrics-elapsed"
        />
      )}
      {tokens != null && (
        <Metric
          label="Tokens"
          value={formatTokenCount(tokens)}
          estimated={metrics.tokensEstimated}
          provenance={
            metrics.tokensEstimated
              ? "estimated from the stream so far; the agent reports its own count when it finishes"
              : "reported by the agent"
          }
          testId="agent-metrics-tokens"
        />
      )}
      {costUsd != null && (
        <Metric
          label="Cost"
          value={formatCost(costUsd)}
          estimated={metrics.costEstimated}
          provenance={
            metrics.costEstimated
              ? "priced from the token counts at this model's list price, which cannot know your plan or tier"
              : "billed by the agent"
          }
          testId="agent-metrics-cost"
        />
      )}
    </div>
  );
};
