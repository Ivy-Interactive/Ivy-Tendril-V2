import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../ui/ui.css";
import "./agent-output.css";
import "../PlanMarkdown/plan-markdown.css";
import type { EventHandler } from "./types.ts";
import { getHeight, getWidth } from "@/lib/styles";
import { useAutoScroll } from "./use-auto-scroll.ts";
import { deriveStatus } from "./status.ts";
import { AnimatedStatus } from "./animated-status.tsx";
import { agentNodeKey, groupToolUseEvents, type RenderNode } from "./group-events.ts";
import { AgentNode, isAgentNodeVisible, type AgentNodeVisibility } from "./render-node.tsx";
import { AgentMetricsFooter } from "./metrics-footer.tsx";
import { useAgentEventStream, suppressedTextIndex } from "./use-event-stream.ts";
import { useAgentViewerVirtualization } from "./use-agent-viewer-virtualization.ts";
import type { AnswerCallback } from "../PlanMarkdown/questionsContext.ts";

type StreamSubscriber = (streamId: string, onData: (data: unknown) => void) => () => void;

interface AgentViewerProps {
  id: string;
  width?: string;
  height?: string;
  eventHandler: EventHandler;
  events?: string[];
  jsonStream?: string;
  /**
   * Eventwire lines as an append-only array — the form to use for output that is still arriving.
   *
   * `jsonStream` is a whole stream and is re-folded from scratch whenever it changes, so a caller that
   * grows it line by line pays for the whole run on every line: at 100k lines that is a 6.9MB string
   * re-split and re-parsed per append. Handing over the array instead lets the viewer fold only what
   * it has not seen. Index `i` must keep holding the same line; to *replace* the output, change `id`.
   */
  jsonLines?: readonly string[];
  stream?: { id: string };
  subscribeToStream?: StreamSubscriber;
  autoScroll?: boolean;
  showThinking?: boolean;
  showSystemEvents?: boolean;
  showStatusLabel?: boolean;
  statusLabelOverride?: string;
  showStatusEvents?: boolean;
  /**
   * The run's analytics under the log: elapsed time, tokens, and cost, each marked as reported or
   * worked out. On by default — a reader watching an agent spend their money is entitled to see it.
   */
  showMetrics?: boolean;
  /**
   * Whether the metrics strip draws its own rule against the log above it.
   *
   * The rule is the boundary between scrolling content and fixed chrome, so it earns its place
   * wherever the viewer is one element among others. It stops earning it where the viewer *is* the
   * surface and the framing already rules off its edges: the job output sheet stacks a sheet-title
   * divider and a metadata divider above this one within the first 50px, and three parallel full-width
   * lines read as a form rather than a hierarchy. Per instance rather than a change to the stylesheet,
   * because the onboarding project-agent run draws the viewer inside a card and still needs it.
   */
  showMetricsDivider?: boolean;
  /**
   * When the run began, from whoever owns it rather than from its log.
   *
   * Threaded straight to {@link AgentMetricsFooterProps.startedAt}; see that prop for why the
   * stream's own first timestamp is not always the run's start. A caller with no run record behind
   * it — a chat pane, a story — passes nothing and the stream stands in, as before.
   */
  startedAt?: string | null;
  /**
   * Whether more output is still expected.
   *
   * Only the elapsed timer cares, and only for one case the stream cannot settle by itself: a run that
   * was killed or timed out never reported a terminal result, so nothing in its lines says it is over,
   * and a timer left to tick against its start would read "18h" for yesterday's dead job. Left unset,
   * the stream decides — a reported result means finished, anything else means live.
   */
  live?: boolean;
  groupToolCalls?: boolean;
  /**
   * `false` renders every node, whatever the count. Only worth setting for a test or a caller that
   * needs the whole log in the DOM (a print view, a text export); a windowed body is otherwise
   * strictly better.
   */
  virtualized?: boolean;
  /**
   * A ceiling on the scrolling body's height, applied **only** while windowed — the same bargain
   * `DataTable` strikes with `DATA_TABLE_MAX_BODY_HEIGHT`.
   *
   * Windowing needs a bounded viewport: the virtualizer renders what fits in the scroll element, so a
   * viewer that has been left to grow with its content has a viewport the size of the whole log and
   * renders all of it. A caller that already gives the viewer a definite height — a page, a flex row
   * with a floor — needs nothing here. One that drops it into a container of its own choosing (a sheet
   * that scrolls, a card) has to say how tall it may get, or windowing is inert exactly where it is
   * needed most. Left unset while unwindowed so a short log still sizes to its content.
   */
  maxBodyHeight?: number | string;
}

export const AgentViewer: React.FC<AgentViewerProps> = ({
  id,
  width,
  height,
  eventHandler,
  events: enabledEvents = [],
  jsonStream,
  jsonLines,
  stream,
  subscribeToStream,
  autoScroll = true,
  showThinking = false,
  showSystemEvents = false,
  showStatusLabel = true,
  statusLabelOverride,
  showStatusEvents = true,
  showMetrics = true,
  showMetricsDivider = true,
  startedAt,
  live,
  groupToolCalls = false,
  virtualized = true,
  maxBodyHeight,
}) => {
  // Append-only, and held in a ref rather than in state so a subscription frame costs the frame: an
  // array rebuilt per line (`setState([...prev, data])`) is another quadratic in the length of the run.
  const streamedLinesRef = useRef<string[]>([]);
  // Monotonic on purpose. A count would collide with itself the moment the lines are dropped and
  // refilled — same number, no re-render, a frame silently lost.
  const [, bumpStreamed] = useState(0);

  useEffect(() => {
    if (!stream?.id || !subscribeToStream) return;
    const unsubscribe = subscribeToStream(stream.id, (data) => {
      if (typeof data === "string") {
        streamedLinesRef.current.push(data);
        bumpStreamed((n) => n + 1);
      }
    });
    return unsubscribe;
  }, [stream?.id, subscribeToStream]);

  // Lines received over the subscription belong to the stream that was being shown when they arrived,
  // so a new `id` or a replaced `jsonStream` drops them. Done during render rather than in an effect
  // so the fold below never sees one stream's tail appended to another's body, and idempotent for the
  // same reason the fold itself is.
  const shownRef = useRef<{ id: string; jsonStream: string | undefined }>({ id, jsonStream });
  if (shownRef.current.id !== id || shownRef.current.jsonStream !== jsonStream) {
    shownRef.current = { id, jsonStream };
    streamedLinesRef.current = [];
  }

  const {
    events: parsedEvents,
    version,
    resultIndex,
    metrics,
    sourceKey,
  } = useAgentEventStream({
    id,
    jsonStream,
    jsonLines,
    streamedLines: streamedLinesRef.current,
  });

  // Every derived value below keys off `version` rather than `parsedEvents`, which is a live array
  // mutated in place. `parsedEvents` stays in the dependency lists because it is what the bodies read.
  const derived = useMemo(
    () => deriveStatus(parsedEvents),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parsedEvents, version],
  );
  const statusText = statusLabelOverride ?? derived.text;
  const isComplete = derived.complete;
  // A caller that knows the run is over outranks the stream, which cannot tell a run still thinking
  // from one that died without saying so.
  const noMoreOutput = isComplete || live === false;

  const { scrollRef, disableAutoScroll } = useAutoScroll({
    content: version,
    enabled: autoScroll,
    smooth: false,
  });

  const handleComplete = useCallback(
    (resultJson: string) => {
      if (enabledEvents.includes("OnComplete")) {
        eventHandler("OnComplete", id, [resultJson]);
      }
    },
    [enabledEvents, eventHandler, id],
  );

  const handleAnswer = useCallback<AnswerCallback>(
    (questionId, answer) => {
      if (enabledEvents.includes("OnAnswersChange") && eventHandler) {
        const value =
          answer === undefined
            ? null
            : answer === null
              ? []
              : Array.isArray(answer)
                ? answer
                : [answer];
        eventHandler("OnAnswersChange", id, [{ questionId, answer: value }]);
      }
    },
    [enabledEvents, eventHandler, id],
  );

  const answerCallback = enabledEvents.includes("OnAnswersChange") ? handleAnswer : undefined;

  useEffect(() => {
    const last = parsedEvents[parsedEvents.length - 1];
    if (last && last.kind === "result") {
      handleComplete(JSON.stringify(last.wire));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedEvents, version, handleComplete]);

  const shellStyle: React.CSSProperties = {
    boxSizing: "border-box",
    minWidth: 0,
    // The outermost half of the horizontal containment described in `agent-output.css`: whatever the
    // viewer is dropped into, it may not grow past it. Ahead of `getWidth` so an explicit `width` prop
    // still wins.
    maxWidth: "100%",
    display: "flex",
    flexDirection: "column",
    // Contains vertically — the body is what scrolls, and a shell that let its content push past its
    // own height would break every framing that gives it one. Horizontally it must *not* clip: prose
    // wraps, but a node that legitimately cannot be re-wrapped (a shell command, a stack trace, a blob
    // of single-line JSON) keeps its line breaks and offers its own horizontal scroller instead, and
    // `overflow: hidden` here swallowed exactly that — the line was cut off at the right edge with no
    // way to reach the rest of it. `auto` rather than `visible` because a `visible` paired with a
    // `hidden` computes to `auto` anyway, so this says what actually happens.
    overflowY: "hidden",
    overflowX: "auto",
    ...getWidth(width),
    ...getHeight(height),
  };

  const visibility: AgentNodeVisibility = useMemo(
    () => ({ showThinking, showSystemEvents, showStatusEvents }),
    [showThinking, showSystemEvents, showStatusEvents],
  );

  const visibleNodes = useMemo<RenderNode[]>(() => {
    const nodes: RenderNode[] = groupToolCalls
      ? groupToolUseEvents(parsedEvents)
      : parsedEvents.map((event, index) => ({ kind: "single" as const, index, event }));
    const suppressed = suppressedTextIndex(parsedEvents, resultIndex);
    return nodes.filter((node) => isAgentNodeVisible(node, visibility, suppressed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupToolCalls, parsedEvents, resultIndex, version, visibility]);

  const { active, virtualItems, totalSize, measureNodeElement } = useAgentViewerVirtualization({
    scrollRef,
    nodes: visibleNodes,
    sourceKey,
    enabled: virtualized,
  });

  return (
    <div style={shellStyle} className="aov-shell">
      <div
        ref={scrollRef}
        className={`aov-body${active ? " aov-body-windowed" : ""}`}
        style={active && maxBodyHeight !== undefined ? { maxHeight: maxBodyHeight } : undefined}
        onWheel={autoScroll ? disableAutoScroll : undefined}
        onTouchMove={autoScroll ? disableAutoScroll : undefined}
      >
        {virtualItems ? (
          // One spacer of the full run's height, with the window positioned inside it, so the
          // scrollbar describes the whole log while the DOM only ever holds a viewport of it.
          <div className="aov-virtual-canvas" style={{ height: totalSize }}>
            {virtualItems.map((item) => {
              const node = visibleNodes[item.index];
              if (!node) return null;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={measureNodeElement}
                  className="aov-virtual-node"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <AgentNode node={node} answerCallback={answerCallback} />
                </div>
              );
            })}
          </div>
        ) : (
          visibleNodes.map((node) => (
            <AgentNode key={agentNodeKey(node)} node={node} answerCallback={answerCallback} />
          ))
        )}
        {showStatusLabel && !isComplete && (
          <div className="aov-status-row">
            <AnimatedStatus statusText={statusText} isComplete={isComplete} />
          </div>
        )}
      </div>
      {/* Outside the body, which is the whole design: the footer's elapsed time ticks once a second,
          and a tick inside the windowed body would re-render and re-measure a viewport of nodes every
          second. See `metrics-footer.tsx`. */}
      {showMetrics && (
        <AgentMetricsFooter
          metrics={metrics}
          isComplete={noMoreOutput}
          showDivider={showMetricsDivider}
          startedAt={startedAt}
        />
      )}
    </div>
  );
};
