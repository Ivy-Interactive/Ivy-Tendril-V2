import type { PresentationEvent, ToolUsePresentation } from "./types.ts";

export type RenderNode =
  | { kind: "single"; index: number; event: PresentationEvent }
  | { kind: "tool-group"; index: number; tools: ToolUsePresentation[] };

/**
 * A render node's identity, stable across appends.
 *
 * `index` is the node's position in the parsed event list, and that list only ever grows at the end:
 * a `tool_result` mutates the tool object its `tool_call` already put there, delta text accumulates
 * into the one `assistant-text` node it opened, and a second `result` replaces the first in place.
 * So a node keeps this key for its whole life, which is what lets the virtualizer keep a measurement
 * and a scroll offset across a stream that is still arriving.
 *
 * The kind is part of it because a `tool-group` and the `single` tool call it replaces once a second
 * call arrives share a start index, and they are not the same box.
 */
export function agentNodeKey(node: RenderNode): string {
  return node.kind === "tool-group" ? `g${node.index}` : `s${node.index}`;
}

export function groupToolUseEvents(events: PresentationEvent[]): RenderNode[] {
  const nodes: RenderNode[] = [];
  let toolRun: { startIndex: number; tools: ToolUsePresentation[] } | null = null;

  const flushToolRun = () => {
    if (toolRun !== null) {
      if (toolRun.tools.length === 1) {
        nodes.push({
          kind: "single",
          index: toolRun.startIndex,
          event: { kind: "tool-use", tool: toolRun.tools[0] },
        });
      } else {
        nodes.push({
          kind: "tool-group",
          index: toolRun.startIndex,
          tools: toolRun.tools,
        });
      }
      toolRun = null;
    }
  };

  events.forEach((event, idx) => {
    if (event.kind === "tool-use") {
      if (toolRun === null) {
        toolRun = { startIndex: idx, tools: [event.tool] };
      } else {
        toolRun.tools.push(event.tool);
      }
    } else {
      flushToolRun();
      nodes.push({ kind: "single", index: idx, event });
    }
  });

  flushToolRun();
  return nodes;
}

export function aggregateToolStatus(tools: ToolUsePresentation[]): "running" | "success" | "error" {
  let hasRunning = false;
  for (const tool of tools) {
    if (tool.isError) return "error";
    if (tool.result === undefined) hasRunning = true;
  }
  return hasRunning ? "running" : "success";
}
