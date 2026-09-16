import { describe, it, expect } from "vitest";
import { buildUpdatePrompt } from "../update_prompt";
import type { Annotation } from "../../types/api";

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann-1",
    startOffset: 0,
    endOffset: 7,
    selectedText: "Problem",
    comment: "Narrow this down.",
    isResolved: false,
    ...overrides,
  };
}

describe("buildUpdatePrompt", () => {
  it("says nothing at all when there is nothing to fold in", () => {
    expect(buildUpdatePrompt([], 0)).toBe("");
  });

  /**
   * The answers half. Two clauses carry the behaviour rather than the tone: delete the question once it
   * has been folded in — which is what makes the Update Plan badge fall back to zero — and leave an
   * unanswered one exactly as it is.
   */
  it("tells the agent the answers are already in the revision, and what to do with them", () => {
    const prompt = buildUpdatePrompt([], 2);

    expect(prompt).toContain("I answered 2 questions in this plan's `questions` blocks.");
    expect(prompt).toContain("The answers are already in the revision as `answer` keys.");
    expect(prompt).toContain("then delete that");
    expect(prompt).toContain(
      "question from its block, dropping the block once its last question goes.",
    );
    expect(prompt).toContain("Carry any question I left unanswered forward unchanged");
    expect(prompt).toContain("do not answer it for");
    // No annotations, so the annotation instructions are absent entirely.
    expect(prompt).not.toContain("annotations");
  });

  it("says question rather than questions for one", () => {
    expect(buildUpdatePrompt([], 1)).toContain("I answered 1 question in this plan's");
  });

  /** Annotations live only in the UI, so unlike answers they have to be quoted into the prompt. */
  it("quotes each annotation's passage and comment, numbered", () => {
    const prompt = buildUpdatePrompt([
      annotation(),
      annotation({ id: "ann-2", selectedText: "Approach", comment: "Say how." }),
    ]);

    expect(prompt).toContain(
      "I reviewed the plan and left inline annotations on specific passages.",
    );
    expect(prompt).toContain("## Annotation 1");
    expect(prompt).toContain("Selected text:");
    expect(prompt).toContain("> Problem");
    expect(prompt).toContain("Comment: Narrow this down.");
    expect(prompt).toContain("## Annotation 2");
    expect(prompt).toContain("> Approach");
    expect(prompt).toContain("Comment: Say how.");
  });

  it("attributes an annotation that carries an author", () => {
    const prompt = buildUpdatePrompt([annotation({ author: "Anonymous Otter" })]);
    expect(prompt).toContain("## Annotation 1 (by Anonymous Otter)");
  });

  it("quotes every line of a multi-line selection, without the carriage returns", () => {
    const prompt = buildUpdatePrompt([annotation({ selectedText: "first line\r\nsecond line" })]);

    expect(prompt).toContain("> first line\n> second line");
    expect(prompt).not.toContain("\r");
  });

  it("carries both halves, answers first, separated by a blank line", () => {
    const prompt = buildUpdatePrompt([annotation()], 1);

    const answersAt = prompt.indexOf("I answered 1 question");
    const annotationsAt = prompt.indexOf("I reviewed the plan");
    expect(answersAt).toBeGreaterThanOrEqual(0);
    expect(annotationsAt).toBeGreaterThan(answersAt);
    expect(prompt).toContain("me, and do not reword it.\n\nI reviewed the plan");
  });

  it("leaves no trailing blank line", () => {
    expect(buildUpdatePrompt([annotation()], 1)).toBe(
      buildUpdatePrompt([annotation()], 1).trimEnd(),
    );
  });
});
