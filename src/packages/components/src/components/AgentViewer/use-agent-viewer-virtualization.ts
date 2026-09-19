import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { VirtualItem } from "@tanstack/react-virtual";

import { agentNodeKey, type RenderNode } from "./group-events.ts";
import { estimateAgentNodeHeight } from "./node-heights.ts";

/** Node count above which the viewer starts windowing. */
export const AGENT_VIEWER_VIRTUALIZATION_THRESHOLD = 60;

/**
 * Nodes rendered beyond the visible range, each side.
 *
 * Higher than `DataTable`'s 8 in node terms would be wasteful here because a node can be a whole
 * result summary rather than a 37px row; lower makes a fast scroll show blank space. Six is about a
 * viewport of collapsed tool calls.
 */
export const AGENT_VIEWER_OVERSCAN = 6;

export interface UseAgentViewerVirtualizationOptions {
  /**
   * The scrolling element — `.aov-body`. Owned by the caller because `useAutoScroll` needs the same
   * ref, and the two are mutually dependent: autoscroll moves the offset the virtualizer reads.
   */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** The nodes to render, in order. */
  nodes: readonly RenderNode[];
  /**
   * Identifies *which stream* the nodes came from. A change here means the viewer was pointed at
   * different output — another job, another turn — rather than handed more of the same.
   */
  sourceKey: string;
  /** `false` disables windowing outright, whatever the node count. */
  enabled?: boolean;
  threshold?: number;
  overscan?: number;
}

export interface UseAgentViewerVirtualizationResult {
  /** Whether the body is windowed. When `false` every field below is inert. */
  active: boolean;
  /** The nodes to render, ascending. `null` while inactive — render all of them. */
  virtualItems: VirtualItem[] | null;
  /** Height of the spacer the windowed items are positioned inside. */
  totalSize: number;
  /** Pass as each node wrapper's `ref`. Requires `data-index` on the same element. */
  measureNodeElement: (element: HTMLDivElement | null) => void;
}

/** What the previous render's node list was, in the only two respects a reset decision needs. */
interface NodeListShape {
  sourceKey: string;
  count: number;
  firstKey: string;
}

function shapeOf(sourceKey: string, nodes: readonly RenderNode[]): NodeListShape {
  return {
    sourceKey,
    count: nodes.length,
    firstKey: nodes.length > 0 ? agentNodeKey(nodes[0]) : "",
  };
}

/**
 * Whether `next` is `previous` with nodes added to the end.
 *
 * This is the question the reader's scroll position depends on, and it is the trap `DataTable`
 * documents from experience: it reset the virtualizer whenever the row identities changed, and a bug
 * in telling an append apart from a replacement meant every appended window called
 * `scrollToOffset(0)` and threw the reader back to the top. Agent output is *nothing but* appends —
 * every line the agent writes lands here — so a viewer that got this wrong would be unreadable the
 * moment output started arriving.
 *
 * `DataTable` answers it by joining every row id into one string and prefix-testing it. That is O(n)
 * per render, which is precisely the cost this windowing exists to remove: at 100k lines it would rebuild
 * a megabyte-scale string for every frame the agent emits. Two facts make an O(1) answer exact
 * instead. Nodes are only ever appended to the parsed list (see {@link agentNodeKey}), so no earlier
 * node can have moved; and `sourceKey` already names the stream, so a *different* stream is reported
 * rather than inferred. A shorter list, a different first node, or a different stream is a
 * replacement; anything else is an append.
 */
function isNodeAppend(previous: NodeListShape, next: NodeListShape): boolean {
  if (previous.sourceKey !== next.sourceKey) return false;
  if (previous.count === 0) return false;
  if (next.count < previous.count) return false;
  return previous.firstKey === next.firstKey;
}

/**
 * Windowing for `AgentViewer`'s render nodes.
 *
 * A measured variable-size virtualizer rather than a fixed-size one, because the nodes are of unequal
 * height by construction: a collapsed tool call is one line, an expanded one is however tall its
 * output is, a grouped run is one line until it is opened, and a result summary is three blocks.
 * {@link estimateAgentNodeHeight} sizes a node that has not mounted yet and `measureElement` corrects
 * every node that has.
 */
export function useAgentViewerVirtualization({
  scrollRef,
  nodes,
  sourceKey,
  enabled = true,
  threshold = AGENT_VIEWER_VIRTUALIZATION_THRESHOLD,
  overscan = AGENT_VIEWER_OVERSCAN,
}: UseAgentViewerVirtualizationOptions): UseAgentViewerVirtualizationResult {
  const count = nodes.length;
  const active = enabled && count > threshold;

  // Read through a ref so `estimateSize` and `getItemKey` stay referentially stable: virtual-core
  // rebuilds its measurement cache when either changes, and a fresh closure per render would rebuild
  // it on every appended line.
  const nodesRef = React.useRef(nodes);
  nodesRef.current = nodes;

  const estimateSize = React.useCallback((index: number) => {
    const node = nodesRef.current[index];
    return node ? estimateAgentNodeHeight(node) : 0;
  }, []);

  const getItemKey = React.useCallback((index: number) => {
    const node = nodesRef.current[index];
    return node ? agentNodeKey(node) : index;
  }, []);

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count,
    getScrollElement: () => (active ? scrollRef.current : null),
    estimateSize,
    overscan,
    getItemKey,
  });

  const shape = shapeOf(sourceKey, nodes);
  const lastShape = React.useRef(shape);
  React.useEffect(() => {
    const previous = lastShape.current;
    const next = shapeOf(sourceKey, nodesRef.current);
    if (
      previous.sourceKey === next.sourceKey &&
      previous.count === next.count &&
      previous.firstKey === next.firstKey
    ) {
      return;
    }
    lastShape.current = next;
    if (!active || isNodeAppend(previous, next)) return;
    // A replacement: the measurements belong to output that is no longer on screen.
    virtualizer.measure();
    // `scrollToOffset`, not `element.scrollTop = 0`: assigning scrollTop leaves the virtualizer's own
    // offset stale until a scroll event happens to arrive, so the window would keep rendering the
    // slice it was showing before. Autoscroll, if engaged, pulls this to the bottom straight after —
    // its own effect runs on the same content change and defers a frame.
    virtualizer.scrollToOffset(0);
  }, [active, sourceKey, shape.count, shape.firstKey, virtualizer]);

  // A node's height is a function of the width it was laid out at: prose wraps, so narrowing the
  // viewer makes every paragraph in it taller. react-virtual watches the scroll element's rect and
  // re-renders, but it *keeps* the heights it measured — so after a resize every node below the window
  // sits at an offset computed from its height at the old width, which is the scrollbar lying and the
  // scroll position drifting. Dropping the cache costs a re-measure of the window and nothing else.
  //
  // Width only. Height changes constantly (the sheet opening, the status row appearing, the window
  // itself growing) and none of those change what a node measures.
  React.useEffect(() => {
    const element = scrollRef.current;
    if (!active || !element || typeof ResizeObserver === "undefined") return;
    let lastWidth = element.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      virtualizer.measure();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, scrollRef, virtualizer]);

  return {
    active,
    virtualItems: active ? virtualizer.getVirtualItems() : null,
    totalSize: virtualizer.getTotalSize(),
    measureNodeElement: virtualizer.measureElement,
  };
}
