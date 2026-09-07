import { describe, it, expect } from "vitest";
import {
  detectPendingQuestions,
  extractQuestionsFences,
} from "../src/hooks/usePendingChatQuestions";
import type { ChatMessage } from "../src/types/chat";

describe("extractQuestionsFences", () => {
  it("extracts body from a standard 3-backtick questions fence", () => {
    const md = `Some text before

\`\`\`questions
questions:
  - id: q1
    title: Option 1?
\`\`\`

Some text after`;

    const fences = extractQuestionsFences(md);
    expect(fences).toHaveLength(1);
    expect(fences[0]).toContain("id: q1");
    expect(fences[0]).toContain("title: Option 1?");
  });

  it("extracts 4-backtick fence containing nested 3-backtick code block", () => {
    const md = `\`\`\`\`questions
questions:
  - id: code-choice
    title: Which code snippet?
    description: |
      \`\`\`csharp
      var x = 1;
      \`\`\`
\`\`\`\``;

    const fences = extractQuestionsFences(md);
    expect(fences).toHaveLength(1);
    expect(fences[0]).toContain("id: code-choice");
    expect(fences[0]).toContain("var x = 1;");
  });

  it("handles tilde fences and multiple fences", () => {
    const md = `~~~questions
questions:
  - id: tilde-q
    title: Tilde question?
~~~

\`\`\`questions
questions:
  - id: backtick-q
    title: Backtick question?
\`\`\``;

    const fences = extractQuestionsFences(md);
    expect(fences).toHaveLength(2);
    expect(fences[0]).toContain("tilde-q");
    expect(fences[1]).toContain("backtick-q");
  });

  it("ignores code blocks that are not questions", () => {
    const md = `\`\`\`typescript
const a = 1;
\`\`\``;

    expect(extractQuestionsFences(md)).toHaveLength(0);
  });
});

describe("detectPendingQuestions", () => {
  it("validates detection of unanswered question blocks in assistant messages", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-0",
        role: "assistant",
        content: `Here is a question:
\`\`\`questions
questions:
  - id: arch-style
    title: Which architecture style?
    options:
      - title: REST
        value: rest
      - title: GraphQL
        value: graphql
\`\`\``,
        timestamp: "2026-09-07T12:00:00Z",
      },
    ];

    const result = detectPendingQuestions(messages);
    expect(result).toHaveLength(1);
    expect(result[0].messageIndex).toBe(0);
    expect(result[0].messageId).toBe("msg-0");
    expect(result[0].questionIds).toEqual(["arch-style"]);
    expect(result[0].isScrolledOutOfView).toBe(false);
  });

  it("verifies that answered question blocks (answerPresent: true) are not marked pending", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-0",
        role: "assistant",
        content: `\`\`\`questions
questions:
  - id: arch-style
    title: Which architecture style?
    options:
      - title: REST
        value: rest
    answer:
      - rest
\`\`\``,
        timestamp: "2026-09-07T12:00:00Z",
      },
    ];

    const result = detectPendingQuestions(messages);
    expect(result).toHaveLength(0);
  });

  it("verifies handling of multiple question blocks within a single session", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-0",
        role: "assistant",
        content: `\`\`\`questions
questions:
  - id: q1
    title: Question 1?
\`\`\``,
        timestamp: "2026-09-07T12:00:00Z",
      },
      {
        id: "msg-1",
        role: "user",
        content: "Some user reply",
        timestamp: "2026-09-07T12:01:00Z",
      },
      {
        id: "msg-2",
        role: "assistant",
        content: `\`\`\`questions
questions:
  - id: q2
    title: Question 2?
\`\`\``,
        timestamp: "2026-09-07T12:02:00Z",
      },
    ];

    const result = detectPendingQuestions(messages);
    expect(result).toHaveLength(2);
    expect(result[0].messageIndex).toBe(0);
    expect(result[0].questionIds).toEqual(["q1"]);
    expect(result[1].messageIndex).toBe(2);
    expect(result[1].questionIds).toEqual(["q2"]);
  });

  it("verifies non-assistant messages or messages without question blocks are ignored", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-user",
        role: "user",
        content: `\`\`\`questions
questions:
  - id: user-q
    title: User asking something?
\`\`\``,
        timestamp: "2026-09-07T12:00:00Z",
      },
      {
        id: "msg-plain-assistant",
        role: "assistant",
        content: "Plain assistant text without any question block.",
        timestamp: "2026-09-07T12:01:00Z",
      },
    ];

    const result = detectPendingQuestions(messages);
    expect(result).toHaveLength(0);
  });

  it("calculates isScrolledOutOfView and direction based on visibleRange", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-0",
        role: "assistant",
        content: `\`\`\`questions
questions:
  - id: q0
    title: First?
\`\`\``,
        timestamp: "2026-09-07T12:00:00Z",
      },
      {
        id: "msg-1",
        role: "assistant",
        content: `\`\`\`questions
questions:
  - id: q1
    title: Second?
\`\`\``,
        timestamp: "2026-09-07T12:01:00Z",
      },
      {
        id: "msg-2",
        role: "assistant",
        content: `\`\`\`questions
questions:
  - id: q2
    title: Third?
\`\`\``,
        timestamp: "2026-09-07T12:02:00Z",
      },
    ];

    // Case 1: visibleRange covers msg-1 only (startIndex: 1, endIndex: 1)
    const result1 = detectPendingQuestions(messages, { startIndex: 1, endIndex: 1 });
    expect(result1[0].isScrolledOutOfView).toBe(true);
    expect(result1[0].direction).toBe("up");

    expect(result1[1].isScrolledOutOfView).toBe(false);
    expect(result1[1].direction).toBeUndefined();

    expect(result1[2].isScrolledOutOfView).toBe(true);
    expect(result1[2].direction).toBe("down");
  });
});
