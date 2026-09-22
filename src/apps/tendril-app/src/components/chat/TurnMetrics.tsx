import React from "react";
import { AgentMetricsFooter, type StreamMetrics } from "@ivy-interactive/components/tendril";

export interface TurnMetricsProps {
  /** The turn's analytics, folded out of its stream by `parseTurnStream`. */
  metrics: StreamMetrics;
  /**
   * Whether this turn is the one the session is generating right now.
   *
   * What stops the clock, and it is this rather than the presence of a `result` wire. A turn that
   * was interrupted, crashed, or was cut off by a daemon restart never reports a result, so keying
   * completion off that wire leaves every such turn ticking forever: a week-old persisted message
   * would read "Elapsed 191h 52m" and hold a live one-second interval per row. Only the live turn is
   * unfinished; everything else in the thread is over, however it ended.
   */
  isLiveTurn: boolean;
}

/**
 * What the turn cost and how long it took, under the message that spent it.
 *
 * The same figures `AgentViewer` puts under a run, with the same estimated-vs-reported convention —
 * a chat turn is a run, and the reader has no other place to see its bill. Renders nothing when the
 * stream has said nothing worth a line: the footer itself drops out rather than growing an empty bar.
 *
 * `-ml-1` cancels the 4px left padding `.aov-metrics` carries for the viewer's framing, so the strip
 * lines up with the left edge of the markdown body above it.
 */
export const TurnMetrics: React.FC<TurnMetricsProps> = ({ metrics, isLiveTurn }) => (
  <div data-testid="chat-turn-metrics" className="-ml-1 mt-1">
    <AgentMetricsFooter metrics={metrics} isComplete={!isLiveTurn} showDivider={false} />
  </div>
);
