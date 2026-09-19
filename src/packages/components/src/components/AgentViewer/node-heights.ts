import type { RenderNode } from "./group-events.ts";

/**
 * First-paint height estimates for the viewer's render nodes, in px, derived from `agent-output.css`.
 *
 * These are what the virtualizer sizes an unmeasured node at, so they are what the scrollbar and the
 * scroll offset of everything below the window are computed from before a node has mounted.
 * `DataTable` learned this the expensive way: its `DATA_TABLE_ROW_HEIGHT_ESTIMATES` were 3–11px taller
 * than anything a row could render at, which made a fresh table's scroll height a lie and its
 * load-more threshold fire early, and `measureElement` correcting each row on mount is exactly what
 * kept the drift invisible. `node-heights.test.ts` therefore derives every number below from the
 * stylesheet rather than restating it, so a padding change that forgets this table fails there.
 *
 * Unlike a table row these nodes are **not** of one height — a collapsed tool call is one line and a
 * result summary is three blocks — which is why this is a per-kind table and the virtualizer is a
 * measured variable-size one rather than a fixed-size one.
 *
 * Each number is the height of a **single-line** instance of that node: the smallest thing it can
 * render at. Multi-line prose measures taller, and {@link estimateAgentNodeHeight} accounts for the
 * lines it can count without laying anything out (hard newlines). Erring short is deliberate: an
 * estimate below the truth makes the scrollbar grow as content is measured, whereas one above it makes
 * the viewer claim space that does not exist and leaves a gap under the last node.
 */
export const AGENT_NODE_HEIGHT_ESTIMATES = {
  /** `.aov-tool` collapsed: its own vertical padding around one `.aov-tool-header` line. */
  "tool-use": 30,
  /** `.aov-tool-group` collapsed: the same box as a tool card, one header line. */
  "tool-group": 30,
  /** `.aov-assistant` margins around one `.aov-markdown` line. 30 since those margins were halved to
   *  4px to tighten the tool-card -> prose gap; see the note at `.aov-assistant`. */
  "assistant-text": 30,
  /** `.aov-system`: padding around one line at the shell's own metrics. */
  system: 26,
  /** `.aov-thinking`: one line, no vertical padding. */
  thinking: 22,
  /** `.aov-status-event`: padding and border around one 12px line. */
  status: 29,
  /** `.aov-result`: margin, border and padding around a header, a body and a stats row. */
  result: 116,
  /** `.aov-result` again, header and body only — an error carries no stats row. */
  error: 90,
} as const satisfies Record<string, number>;

export type AgentNodeHeightKind = keyof typeof AGENT_NODE_HEIGHT_ESTIMATES;

/**
 * `.aov-body`'s `gap`. While windowed the body is not a flex column — items are absolutely positioned
 * at the offsets the virtualizer computes — so the gap is reproduced as each wrapper's
 * `padding-bottom` and is therefore part of the height that gets measured. It has to be part of the
 * estimate for the same reason.
 */
export const AGENT_VIEWER_NODE_GAP = 4;

/**
 * `.aov-markdown`'s line box: `font-size: 14px × line-height: 1.6`, rounded the way a browser reports
 * `offsetHeight`. Used to scale a prose node by the lines it is known to have.
 */
export const AGENT_MARKDOWN_LINE_HEIGHT = 22;

/** `.aov-thinking` inherits the shell's `font-size: 14px × line-height: 1.55`. */
export const AGENT_SHELL_LINE_HEIGHT = 22;

/** Which entry of {@link AGENT_NODE_HEIGHT_ESTIMATES} a render node is sized from. */
export function agentNodeHeightKind(node: RenderNode): AgentNodeHeightKind {
  if (node.kind === "tool-group") return "tool-group";
  switch (node.event.kind) {
    case "tool-use":
      return "tool-use";
    case "assistant-text":
      return "assistant-text";
    case "system":
      return "system";
    case "thinking":
      return "thinking";
    case "status":
      return "status";
    case "result":
      return "result";
    case "error":
      return "error";
  }
}

/**
 * Lines a string occupies before any wrapping — one more than its hard newlines.
 *
 * Wrapping cannot be predicted without the rendered width, and guessing at it is how an estimate ends
 * up above the truth. Counting the newlines that *are* known is free and takes a 200-line agent
 * message from a 38px estimate to something within a wrap or two of its real height, which is the
 * difference between a scrollbar that settles and one that visibly re-scales all the way down.
 */
function hardLineCount(text: string): number {
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) lines++;
  }
  return lines;
}

/**
 * What the virtualizer should assume a node is tall before it has been measured, gap included.
 *
 * Only ever an estimate: every rendered node carries `measureElement`, so the moment one mounts its
 * real `offsetHeight` replaces this.
 */
export function estimateAgentNodeHeight(node: RenderNode): number {
  const kind = agentNodeHeightKind(node);
  const base = AGENT_NODE_HEIGHT_ESTIMATES[kind];

  if (node.kind === "single" && node.event.kind === "assistant-text") {
    const extra = (hardLineCount(node.event.text) - 1) * AGENT_MARKDOWN_LINE_HEIGHT;
    return base + extra + AGENT_VIEWER_NODE_GAP;
  }
  if (node.kind === "single" && node.event.kind === "thinking") {
    const extra = (hardLineCount(node.event.text) - 1) * AGENT_SHELL_LINE_HEIGHT;
    return base + extra + AGENT_VIEWER_NODE_GAP;
  }

  return base + AGENT_VIEWER_NODE_GAP;
}
