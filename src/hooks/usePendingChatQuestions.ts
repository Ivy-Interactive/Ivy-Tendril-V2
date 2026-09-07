import { useMemo } from "react";
import { parseQuestions } from "@spacecorps/components-storybook/tendril";
import type { ChatMessage } from "../types/chat";

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
 * Extracts raw fence bodies for fenced code blocks with info string "questions".
 * Follows CommonMark fence rules (supporting 3+ backticks or tildes).
 */
export function extractQuestionsFences(markdown: string): string[] {
  if (!markdown) return [];

  const lines = markdown.split(/\r?\n/);
  const bodies: string[] = [];
  let inFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  let currentBody: string[] = [];

  for (const line of lines) {
    const trimmedStart = line.trimStart();
    const indent = line.length - trimmedStart.length;

    if (!inFence) {
      if (indent <= 3) {
        const match = trimmedStart.match(/^(`{3,}|~{3,})(.*)$/);
        if (match) {
          const delim = match[1];
          const char = delim[0];
          const info = match[2].trim();
          const firstWord = info.split(/\s+/)[0];
          if (firstWord === "questions") {
            inFence = true;
            fenceChar = char;
            fenceLength = delim.length;
            currentBody = [];
            continue;
          }
        }
      }
    } else {
      if (indent <= 3) {
        const closeMatch = trimmedStart.match(/^(`{3,}|~{3,})\s*$/);
        if (
          closeMatch &&
          closeMatch[1][0] === fenceChar &&
          closeMatch[1].length >= fenceLength
        ) {
          bodies.push(currentBody.join("\n"));
          inFence = false;
          currentBody = [];
          continue;
        }
      }
      currentBody.push(line);
    }
  }

  if (inFence && currentBody.length > 0) {
    bodies.push(currentBody.join("\n"));
  }

  return bodies;
}

/**
 * Scans messages for assistant messages with pending question blocks and
 * determines whether each pending question is scrolled out of view.
 */
export function detectPendingQuestions(
  messages: ChatMessage[],
  visibleRange?: { startIndex: number; endIndex: number }
): PendingQuestionItem[] {
  const result: PendingQuestionItem[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.content) continue;

    const fenceBodies = extractQuestionsFences(msg.content);
    if (fenceBodies.length === 0) continue;

    const pendingQuestionIds: string[] = [];

    for (const body of fenceBodies) {
      const parsed = parseQuestions(body);
      if (parsed.kind === "questions") {
        for (const q of parsed.questions) {
          if (!q.answerPresent) {
            pendingQuestionIds.push(q.id);
          }
        }
      }
    }

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
  options: UsePendingChatQuestionsOptions
): PendingQuestionItem[] {
  const { messages, visibleRange } = options;

  return useMemo(
    () => detectPendingQuestions(messages, visibleRange),
    [messages, visibleRange?.startIndex, visibleRange?.endIndex]
  );
}

export default usePendingChatQuestions;
