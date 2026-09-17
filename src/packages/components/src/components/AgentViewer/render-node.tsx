import React from "react";
import Markdown from "react-markdown";

import type { RenderNode } from "./group-events.ts";
import { ToolUseCard } from "./tool-use-card.tsx";
import { ToolUseGroup } from "./tool-use-group.tsx";
import { ResultSummary } from "./result-summary.tsx";
import { BlockHandler } from "../PlanMarkdown/BlockHandler.tsx";
import { AlertBlockquote } from "../PlanMarkdown/AlertBlockquote.tsx";
import { tagQuestionBlocks } from "../PlanMarkdown/questionsSource.ts";
import { QuestionsAnswerContext, type AnswerCallback } from "../PlanMarkdown/questionsContext.ts";
import { StatusDot } from "../ui/TuiBadge";
import { getMarkdownPlugins } from "@/lib/math";
import { useMathReady } from "@/hooks/use-math-ready";

/** Which optional node kinds the viewer is showing. */
export interface AgentNodeVisibility {
  showThinking: boolean;
  showSystemEvents: boolean;
  showStatusEvents: boolean;
}

/**
 * Whether a node renders anything at all.
 *
 * Hidden nodes are dropped from the list *before* it reaches the virtualizer rather than rendering as
 * `null` inside it. A windowed list has to be able to size the node at each index without rendering
 * it, and a node that renders nothing is 0px tall while its kind's estimate says otherwise — keeping
 * them in would make the total size, and so the scrollbar and every offset below the window, wrong by
 * however many hidden nodes the stream contains. Dropping them also means `showThinking` off is
 * genuinely cheaper rather than just invisible.
 */
export function isAgentNodeVisible(
  node: RenderNode,
  visibility: AgentNodeVisibility,
  suppressedIndex: number,
): boolean {
  if (node.kind === "tool-group") return true;
  if (node.index === suppressedIndex) return false;
  switch (node.event.kind) {
    case "system":
      return visibility.showSystemEvents;
    case "thinking":
      return visibility.showThinking;
    case "status":
      return visibility.showStatusEvents;
    default:
      return true;
  }
}

interface AgentNodeProps {
  node: RenderNode;
  answerCallback?: AnswerCallback;
}

/**
 * One render node's content, without the wrapper that positions it.
 *
 * Shared by the windowed and the unwindowed body so the two cannot drift: whichever path is active,
 * a node is the same box, which is also what lets the height estimates in `node-heights.ts` describe
 * both.
 */
export const AgentNode: React.FC<AgentNodeProps> = ({ node, answerCallback }) => {
  // Before the early returns below, because it is a hook. KaTeX loads on demand, so assistant text
  // containing maths typesets on the render this subscription triggers rather than never - see
  // `src/hooks/use-math-ready.ts`.
  useMathReady();

  if (node.kind === "tool-group") {
    return <ToolUseGroup tools={node.tools} />;
  }

  const event = node.event;
  switch (event.kind) {
    case "tool-use":
      return (
        <ToolUseCard
          tool={{
            name: event.tool.name,
            input: event.tool.input,
            result: event.tool.result,
            isError: event.tool.isError,
          }}
        />
      );
    case "system":
      return (
        <div className="aov-system">
          session: {event.sessionId ?? "init"}
          {event.model ? ` (${event.model})` : ""}
        </div>
      );
    case "thinking":
      return <div className="aov-thinking">{event.text}</div>;
    case "status":
      return (
        <div className="aov-status-event" data-testid="agent-status-event">
          <StatusDot tone="info" className="aov-status-event-dot" />
          <span className="aov-status-event-text">{event.text}</span>
        </div>
      );
    case "assistant-text": {
      const taggedText = tagQuestionBlocks(event.text);
      return (
        <div className="aov-markdown aov-assistant">
          <QuestionsAnswerContext.Provider value={answerCallback}>
            <Markdown
              {...getMarkdownPlugins(taggedText)}
              components={{
                code: BlockHandler,
                blockquote: AlertBlockquote,
                pre: ({ children }) => <>{children}</>,
              }}
            >
              {taggedText}
            </Markdown>
          </QuestionsAnswerContext.Provider>
        </div>
      );
    }
    case "result":
      return <ResultSummary wire={event.wire} />;
    case "error":
      return (
        <div className="aov-result error">
          <div className="aov-result-header">
            <span className="aov-result-title">❌ Error</span>
          </div>
          <div className="aov-result-body">{event.message}</div>
        </div>
      );
    default:
      return null;
  }
};
