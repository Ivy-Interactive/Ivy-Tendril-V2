import { useMemo } from "react";
import type { ChatMessage } from "../types/chat";
import { extractPlanQuestions, extractQuestionsFences } from "../utils/questionMarkdown";

export { extractPlanQuestions, extractQuestionsFences };

export interface PendingQuestionItem {
  messageIndex: number;
  messageId: string;
  questionIds: string[];
  isScrolledOutOfView: boolean;
  direction?: "up" | "down";
}

export interface UsePendingChatQuestionsOptions {
  messages: ChatMessage[];
  visibleRange?: { startIndex: number; endIndex: number };
}

/**
 * Scans messages for assistant messages with pending question blocks and
 * determines whether each pending question is scrolled out of view.
 */
export function detectPendingQuestions(
  messages: ChatMessage[],
  visibleRange?: { startIndex: number; endIndex: number },
): PendingQuestionItem[] {
  const result: PendingQuestionItem[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.content) continue;

    const questions = extractPlanQuestions(msg.content);
    if (questions.length === 0) continue;

    const pendingQuestionIds = questions.filter((q) => !q.answerPresent).map((q) => q.id);

    if (pendingQuestionIds.length > 0) {
      let isScrolledOutOfView = false;
      let direction: "up" | "down" | undefined;

      if (visibleRange && visibleRange.startIndex >= 0 && visibleRange.endIndex >= 0) {
        if (i < visibleRange.startIndex) {
          isScrolledOutOfView = true;
          direction = "up";
        } else if (i > visibleRange.endIndex) {
          isScrolledOutOfView = true;
          direction = "down";
        }
      }

      result.push({
        messageIndex: i,
        messageId: msg.id,
        questionIds: pendingQuestionIds,
        isScrolledOutOfView,
        direction,
      });
    }
  }

  return result;
}

export function usePendingChatQuestions(
  options: UsePendingChatQuestionsOptions,
): PendingQuestionItem[] {
  const { messages, visibleRange } = options;

  return useMemo(
    () => detectPendingQuestions(messages, visibleRange),
    [messages, visibleRange?.startIndex, visibleRange?.endIndex],
  );
}

export default usePendingChatQuestions;
