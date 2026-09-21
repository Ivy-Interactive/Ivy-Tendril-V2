import type { Annotation } from "../types/api";

/**
 * The instructions the Update Plan CTA sends with its job — a port of
 * `Apps/Plans/ContentView.BuildUpdatePrompt`.
 *
 * V1's own note on why the two halves are shaped differently: *"Annotations have to be quoted here
 * because they live only in the UI; answers do not, because they are already written into the revision
 * the agent is about to read. It only needs telling that they are there, and what to do with the
 * questions that were left alone."*
 *
 * The wording is verbatim rather than paraphrased. Two clauses are load-bearing and would be easy to
 * lose: the answers half tells the agent to *delete* each answered question from its block once it has
 * been folded in — which is what makes the Update Plan badge fall back to zero — and it tells the agent
 * to carry an unanswered question forward untouched, which is what stops an update from quietly
 * deciding a question the operator left open on purpose.
 *
 * An empty result is possible and correct: no annotations and no answers means there is nothing to fold
 * in, and the CTA that sends this is not offered in that case.
 */
export function buildUpdatePrompt(annotations: Annotation[], answeredQuestions = 0): string {
  const lines: string[] = [];

  if (answeredQuestions > 0) {
    const noun = answeredQuestions === 1 ? "question" : "questions";
    lines.push(
      `I answered ${answeredQuestions} ${noun} in this plan's \`questions\` blocks.`,
      "The answers are already in the revision as `answer` keys. Treat each one as my",
      "decision: fold it into the plan as concrete prose or steps, then delete that",
      "question from its block, dropping the block once its last question goes.",
      "Carry any question I left unanswered forward unchanged — do not answer it for",
      "me, and do not reword it.",
    );
    if (annotations.length > 0) lines.push("");
  }

  if (annotations.length === 0) return lines.join("\n").trimEnd();

  lines.push(
    "I reviewed the plan and left inline annotations on specific passages.",
    "Revise the plan to address every annotation below. Each item quotes the",
    "passage I selected, followed by my comment about it.",
  );

  annotations.forEach((annotation, index) => {
    lines.push("");
    lines.push(
      annotation.author
        ? `## Annotation ${index + 1} (by ${annotation.author})`
        : `## Annotation ${index + 1}`,
    );
    lines.push("Selected text:");
    // Split on `\n` and strip a trailing `\r`, as V1 does: a selection copied from a CRLF document
    // must not put a stray carriage return inside the block quote.
    for (const line of annotation.selectedText.split("\n")) {
      lines.push(`> ${line.replace(/\r+$/, "")}`);
    }
    lines.push("");
    lines.push(`Comment: ${annotation.comment}`);
  });

  return lines.join("\n").trimEnd();
}
