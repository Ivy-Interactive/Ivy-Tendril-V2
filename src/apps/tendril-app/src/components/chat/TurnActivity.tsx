import React from "react";
import {
  EventWireStreamParser,
  ToolUseCard,
  ToolUseGroup,
  agentNodeKey,
  groupToolUseEvents,
  type RenderNode,
  type StreamMetrics,
} from "@ivy-interactive/components/tendril";

export type TurnSegment =
  | { kind: "text"; key: string; text: string }
  | { kind: "thinking"; key: string; text: string }
  | { kind: "tool"; key: string; node: RenderNode };

export interface ParsedTurn {
  nodes: RenderNode[];
  hasToolUse: boolean;
  metrics: StreamMetrics;
  hasResult: boolean;
}

export interface TurnActivityProps {
  /** The turn's segments in stream order, from {@link buildTurnSegments}. */
  segments: TurnSegment[];
  /** Renders one markdown segment. The caller owns the renderer and its question contexts. */
  renderText: (text: string, key: string) => React.ReactNode;
}

/**
 * Everything one pass over a turn's stream yields: its render nodes and its own analytics.
 *
 * One pass, because a chat turn re-parses its whole stream on every appended line and there are two
 * consumers of it — the body's segments and the metrics footer. `EventWireStreamParser` folds both
 * at once, so an arriving event costs one parse rather than two.
 */
export function parseTurnStream(rawStream: string | undefined): ParsedTurn | null {
  if (!rawStream || rawStream.trim().length === 0) return null;
  const parser = new EventWireStreamParser();
  parser.push(rawStream.split("\n"));
  return {
    nodes: groupToolUseEvents(parser.events),
    hasToolUse: parser.events.some((event) => event.kind === "tool-use"),
    metrics: parser.metrics,
    hasResult: parser.resultIndex >= 0,
  };
}

/**
 * How much of `content` the stream's own text has already accounted for, or `null` when `content`
 * did not start with it.
 *
 * The daemon appends every text event into one string rather than replacing it
 * (`chat/execution/streaming.rs`), joining whole messages with a blank line and chunks verbatim. So
 * `content` for a text → tool → text turn is both utterances, and rendering the stream's first text
 * node beside a tail of the full `content` would print the opening prose twice.
 */
function consumePrefix(content: string, spoken: string[]): number | null {
  let at = 0;
  for (const text of spoken) {
    if (content.startsWith(text, at)) {
      at += text.length;
    } else if (content.startsWith(text.trimEnd(), at)) {
      at += text.trimEnd().length;
    } else {
      return null;
    }
    if (content.startsWith("\n\n", at)) at += 2;
    else if (content.startsWith("\n", at)) at += 1;
  }
  return at;
}

/**
 * The turn's stream as an ordered list of things to render: its tool calls, the thinking between
 * them, and the text it spoke where it spoke it.
 *
 * `content` is the authority on the prose, because an in-flight `questions` fence is patched onto it
 * and a finished turn may carry a failure reason the stream never said. But `content` is the *whole*
 * turn's text, not its last utterance, so it is reconciled against the stream by prefix: the leading
 * text nodes render from the stream, and the tail segment gets only the remainder of `content` that
 * they did not already cover. A stream whose text is not a prefix of `content` cannot be reconciled,
 * so it yields no segments at all and the caller renders `content` as one body — never both.
 */
export function buildTurnSegments(parsed: ParsedTurn | null, content: string): TurnSegment[] {
  if (!parsed || !parsed.hasToolUse) return [];

  const segments: TurnSegment[] = [];
  const spoken: string[] = [];

  for (const node of parsed.nodes) {
    const key = agentNodeKey(node);
    if (node.kind === "tool-group" || node.event.kind === "tool-use") {
      segments.push({ kind: "tool", key, node });
    } else if (node.event.kind === "thinking") {
      segments.push({ kind: "thinking", key, text: node.event.text });
    } else if (node.event.kind === "assistant-text" && node.event.text.trim().length > 0) {
      segments.push({ kind: "text", key, text: node.event.text });
      spoken.push(node.event.text);
    }
  }

  if (content.trim().length === 0) return segments;

  /* Only a text segment in final position is the tail. A text node with a tool after it is a
     leading utterance: its prose is settled, and the remainder of `content` belongs after the tool,
     not in place of it. */
  const tailIndex = segments.at(-1)?.kind === "text" ? segments.length - 1 : -1;
  const leading = tailIndex >= 0 ? spoken.slice(0, -1) : spoken;
  const consumed = consumePrefix(content, leading);
  if (consumed === null) return [];

  const remainder = content.slice(consumed);
  if (remainder.trim().length === 0) {
    return tailIndex >= 0 ? segments.slice(0, tailIndex) : segments;
  }

  /* The tail is keyed off whatever precedes it rather than off its own node, and identically in
     both branches. The trailing prose exists before the stream's closing text node arrives — it is
     already in `content` — so keying it off that node would change the key the moment the node
     landed, flipping the renderer's id and remounting it mid-stream. */
  const precedingIndex = tailIndex >= 0 ? tailIndex - 1 : segments.length - 1;
  const preceding = segments[precedingIndex];
  const tail: TurnSegment = {
    kind: "text",
    key: `${preceding ? preceding.key : "start"}-tail`,
    text: remainder,
  };
  if (tailIndex >= 0) segments[tailIndex] = tail;
  else segments.push(tail);
  return segments;
}

/**
 * An assistant turn, in the order it happened: what it said, what it did, and the thinking in
 * between.
 *
 * A stream with no tool calls renders nothing and the caller falls back to `content` on its own:
 * V1 drops activity groups whose `toolCount` is zero, which is also why bare thinking is not shown
 * on its own.
 */
export const TurnActivity: React.FC<TurnActivityProps> = ({ segments, renderText }) => {
  if (segments.length === 0) return null;

  return (
    <div data-testid="chat-turn-activity" className="flex flex-col gap-2">
      {segments.map((segment) => {
        if (segment.kind === "tool") {
          const node = segment.node;
          return (
            <div key={segment.key} data-testid="chat-turn-tool">
              {node.kind === "tool-group" ? (
                <ToolUseGroup tools={node.tools} />
              ) : node.event.kind === "tool-use" ? (
                <ToolUseCard tool={node.event.tool} />
              ) : null}
            </div>
          );
        }
        if (segment.kind === "thinking") {
          return (
            <div
              key={segment.key}
              data-testid="chat-turn-thinking"
              className="whitespace-pre-wrap text-xs italic text-muted-foreground"
            >
              {segment.text}
            </div>
          );
        }
        return (
          <div key={segment.key} data-testid="chat-turn-text" data-segment-key={segment.key}>
            {renderText(segment.text, segment.key)}
          </div>
        );
      })}
    </div>
  );
};
