import { describe, it, expect } from "vitest";
import { scanQuestionsFences } from "../src/utils/questionMarkdown";

/**
 * The frontend's question-block scanner, against CommonMark's fence rules.
 *
 * There are three scanners for this format — V1's `QuestionBlockParser.MatchFence`, the Rust one in
 * `crates/tendril-core/src/questions/parser.rs`, and this one — and they have to agree, because a
 * disagreement shows the reader one set of options and the daemon another. That is not hypothetical:
 * the Rust scanner was missing CommonMark's indentation rule, so a plan whose options contained an
 * indented ```rust sample parsed as two options in the UI and one on the daemon, which then refused
 * every answer to that plan with "question must have between 2 and 4 options".
 *
 * This file covers the divergence that was left on *this* side: a fence that is not a `questions`
 * fence was never entered, so a `questions` sample nested inside a documentation fence was read as a
 * live question block.
 */

const fence = (...lines: string[]) => lines.join("\n");

describe("scanQuestionsFences and nested fences", () => {
  it("ignores a questions sample nested inside a longer documentation fence", () => {
    const markdown = fence(
      "# Reference",
      "",
      "````markdown",
      "```questions",
      "- id: not-a-real-question",
      "  question: This is documentation, not a question.",
      "```",
      "````",
      "",
      "Done.",
    );

    // V1 and the Rust scanner both ignore this. Reading it as live would put a documentation sample
    // in front of the user as something to answer, and write an answer back into the reference text.
    expect(scanQuestionsFences(markdown)).toEqual([]);
  });

  it("still finds a real block that follows a documentation fence", () => {
    const markdown = fence(
      "````markdown",
      "```questions",
      "- id: sample",
      "```",
      "````",
      "",
      "```questions",
      "- id: real",
      "  question: Which one?",
      "```",
    );

    const found = scanQuestionsFences(markdown);
    expect(found).toHaveLength(1);
    expect(found[0].body).toContain("id: real");
    expect(found[0].body).not.toContain("id: sample");
  });

  it("does not let a tilde documentation fence swallow a backtick questions block", () => {
    // Different delimiter characters never close each other, so the `~~~` block ends at its own
    // `~~~` and the `questions` block after it is real.
    const markdown = fence(
      "~~~text",
      "not a fence close: ```",
      "~~~",
      "",
      "```questions",
      "- id: real",
      "```",
    );

    const found = scanQuestionsFences(markdown);
    expect(found).toHaveLength(1);
    expect(found[0].body).toContain("id: real");
  });

  it("keeps an indented sample inside an option's description, as CommonMark requires", () => {
    // The exact shape that broke the daemon: an 8-space-indented ```rust pair inside a `description: |`
    // scalar. Indented three spaces or fewer would close the block; more than three cannot.
    const markdown = fence(
      "```questions",
      "- id: pagination-panic",
      "  question: How should this be fixed?",
      "  options:",
      "    - id: fix",
      "      description: |",
      "        ```rust",
      "        paging.total_items.div_ceil(paging.page_size.max(1)).max(1)",
      "        ```",
      "    - id: pin",
      "      description: Pin the dependency.",
      "```",
    );

    const found = scanQuestionsFences(markdown);
    expect(found).toHaveLength(1);
    expect(found[0].body).toContain("id: fix");
    expect(found[0].body).toContain("id: pin");
    expect(found[0].body).toContain("div_ceil");
  });

  it("closes on an indented run of three spaces or fewer, which CommonMark allows", () => {
    const markdown = fence("```questions", "- id: one", "   ```", "after");

    const found = scanQuestionsFences(markdown);
    expect(found).toHaveLength(1);
    expect(found[0].closeLineIndex).toBe(2);
    expect(found[0].body).not.toContain("after");
  });

  it("runs an unterminated block to the end of the document rather than dropping it", () => {
    const markdown = fence("```questions", "- id: one", "  question: Unterminated?");

    const found = scanQuestionsFences(markdown);
    expect(found).toHaveLength(1);
    expect(found[0].closeLineIndex).toBeUndefined();
    expect(found[0].body).toContain("Unterminated?");
  });
});
