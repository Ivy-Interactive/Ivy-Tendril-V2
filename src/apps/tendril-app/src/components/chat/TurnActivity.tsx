import React, { useMemo } from "react";
import {
  ToolUseCard,
  ToolUseGroup,
  groupToolUseEvents,
  parseEventWireStream,
} from "@ivy-interactive/components/tendril";

export interface TurnActivityProps {
  /** The turn's event stream, one JSON event per line, as persisted on `ChatMessage.rawStream`. */
  rawStream?: string;
}

/**
 * What an assistant turn *did*, as opposed to what it said: its tool calls, their results, the
 * thinking that sat between them, and any error the run reported.
 *
 * V1 renders a settled turn entirely from its raw stream - `msg.rawStream ? <AssistantTurn
 * stream={msg.rawStream}/> : <BlockMarkdown content={msg.content}/>` in `ChatWidget.tsx` - so the
 * tool disclosure is part of every turn in the thread, not a debugging view. Here the reply text
 * still comes from `content`, because a chat answer's `questions` fence is patched on `content`
 * while an answer is in flight and rendering the stream instead would drop that patch. So this
 * component contributes the half of `AssistantTurn` that `content` cannot carry, and the markdown
 * body follows it.
 *
 * A stream with no tool calls renders nothing: V1 drops activity groups whose `toolCount` is zero,
 * which is also why bare thinking is not shown on its own.
 */
export const TurnActivity: React.FC<TurnActivityProps> = ({ rawStream }) => {
  const nodes = useMemo(() => {
    if (!rawStream || rawStream.trim().length === 0) return [];
    const events = parseEventWireStream(rawStream);
    if (!events.some((event) => event.kind === "tool-use")) return [];
    return groupToolUseEvents(events).filter((node) => {
      if (node.kind === "tool-group") return true;
      return node.event.kind === "tool-use" || node.event.kind === "thinking";
    });
  }, [rawStream]);

  if (nodes.length === 0) return null;

  return (
    <div data-testid="chat-turn-activity" className="mb-2 flex flex-col gap-1.5">
      {nodes.map((node) => {
        if (node.kind === "tool-group") {
          return <ToolUseGroup key={`group-${node.index}`} tools={node.tools} />;
        }
        if (node.event.kind === "tool-use") {
          return <ToolUseCard key={`tool-${node.index}`} tool={node.event.tool} />;
        }
        return (
          <div
            key={`thinking-${node.index}`}
            data-testid="chat-turn-thinking"
            className="whitespace-pre-wrap text-xs italic text-muted-foreground"
          >
            {node.event.kind === "thinking" ? node.event.text : null}
          </div>
        );
      })}
    </div>
  );
};

export default TurnActivity;
