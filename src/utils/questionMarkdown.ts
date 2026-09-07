import { parseQuestions } from "@spacecorps/components-storybook/tendril";
import { extractQuestionsFences } from "../hooks/usePendingChatQuestions";
import type { InProgressQuestionAnswers } from "../types/chat";

/**
 * Determines whether a question answer interaction is a write-in text response (such as typing in "Other"
 * or free-text) vs a discrete option selection (such as radio or checkbox click).
 *
 * Rules:
 * - If the question has predefined options and every non-empty value in answer matches an existing option value,
 *   the interaction is a discrete option selection (false).
 * - If the question has no options (pure free-text) or the answer contains a value not in the question's predefined
 *   options, the interaction is a write-in text response (true).
 * - If the answer is empty or null (clearing an answer), treat it as immediate (false) unless a debounced write-in
 *   was pending (hasPendingDebounce = true).
 */
export function isWriteInAnswer(
  content: string,
  questionId: string,
  answer: string | string[] | null | undefined,
  hasPendingDebounce?: boolean,
): boolean {
  const values: string[] =
    answer === undefined || answer === null
      ? []
      : Array.isArray(answer)
        ? answer.map(String).filter((v) => v.length > 0)
        : String(answer).length > 0
          ? [String(answer)]
          : [];

  if (values.length === 0) {
    return Boolean(hasPendingDebounce);
  }

  const fenceBodies = extractQuestionsFences(content);
  for (const body of fenceBodies) {
    const parsed = parseQuestions(body);
    if (parsed.kind === "questions") {
      const question = parsed.questions.find((q) => q.id === questionId);
      if (question) {
        const options = question.options || [];
        if (options.length > 0) {
          const optionValues = new Set(options.map((o) => o.value));
          const allMatchOptions = values.every((v) => optionValues.has(v));
          return !allMatchOptions;
        }
        return true;
      }
    }
  }

  return true;
}

/**
 * Format answer values for YAML insertion.
 * Single answer -> JSON string scalar e.g. "sqlite"
 * Multiple answers -> JSON array string e.g. ["auth", "logging"]
 */
function formatAnswerYaml(values: string[]): string {
  if (values.length === 1) {
    return JSON.stringify(values[0]);
  }
  return `[${values.map((v) => JSON.stringify(v)).join(", ")}]`;
}

/**
 * Patches markdown content containing questions blocks with in-progress answers.
 * If answers are empty or content has no questions blocks, returns content as-is.
 */
export function patchQuestionsMarkdown(
  content: string,
  answers?: InProgressQuestionAnswers | null,
): string {
  if (!content || !answers || Object.keys(answers).length === 0) {
    return content;
  }

  // Regex to detect opening fence: 0-3 spaces, 3+ backticks or tildes, info string starting with questions
  const fenceOpenRegex = /^([ \t]{0,3})(`{3,}|~{3,})[ \t]*(\S*)/;
  const lines = content.split("\n");
  const outputLines: string[] = [];

  let inQuestionsFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  let fenceBodyLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inQuestionsFence) {
      const match = line.match(fenceOpenRegex);
      if (match) {
        const char = match[2][0];
        const len = match[2].length;
        const info = match[3] || "";
        if (info.toLowerCase().startsWith("questions")) {
          inQuestionsFence = true;
          fenceChar = char;
          fenceLength = len;
          fenceBodyLines = [];
          outputLines.push(line);
          continue;
        }
      }
      outputLines.push(line);
    } else {
      // Check for closing fence
      const closeRegex = new RegExp(`^[ \\t]{0,3}\\${fenceChar}{${fenceLength},}[ \\t]*$`);
      if (closeRegex.test(line)) {
        // Process fenceBodyLines
        const patchedBodyLines = patchFenceBody(fenceBodyLines, answers);
        outputLines.push(...patchedBodyLines);
        outputLines.push(line);

        inQuestionsFence = false;
        fenceChar = "";
        fenceLength = 0;
        fenceBodyLines = [];
      } else {
        fenceBodyLines.push(line);
      }
    }
  }

  // If fence was unterminated, process any accumulated body lines
  if (inQuestionsFence && fenceBodyLines.length > 0) {
    const patchedBodyLines = patchFenceBody(fenceBodyLines, answers);
    outputLines.push(...patchedBodyLines);
  }

  return outputLines.join("\n");
}

function patchFenceBody(lines: string[], answers: InProgressQuestionAnswers): string[] {
  const questionHeaderRegex = /^([ \t]*)(?:-\s+)?id:[ \t]*["']?([^"'\s]+)["']?/;
  const isQuestionStart = (line: string) => questionHeaderRegex.exec(line);

  interface QuestionSpan {
    questionId: string;
    startIndex: number;
    endIndex: number;
    indent: string;
    hasDash: boolean;
  }

  const spans: QuestionSpan[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = isQuestionStart(lines[i]);
    if (match) {
      const indent = match[1];
      const hasDash = lines[i].trimStart().startsWith("-");
      const qId = match[2];
      if (spans.length > 0) {
        spans[spans.length - 1].endIndex = i;
      }
      spans.push({
        questionId: qId,
        startIndex: i,
        endIndex: lines.length,
        indent,
        hasDash,
      });
    }
  }

  if (spans.length === 0) {
    return lines;
  }

  const result = [...lines];

  // Process spans from bottom to top so insertions/deletions do not shift earlier indices
  for (let s = spans.length - 1; s >= 0; s--) {
    const span = spans[s];
    const qId = span.questionId;
    if (!(qId in answers)) {
      continue;
    }

    const answerValues = answers[qId] || [];
    const questionLines = result.slice(span.startIndex, span.endIndex);

    let answerLineIndex = -1;
    let answerLineCount = 1;
    for (let j = 0; j < questionLines.length; j++) {
      if (/^[ \t]*answer:[ \t]*/.test(questionLines[j])) {
        answerLineIndex = span.startIndex + j;
        let k = j + 1;
        while (k < questionLines.length && /^[ \t]+-\s+/.test(questionLines[k])) {
          k++;
        }
        answerLineCount = k - j;
        break;
      }
    }

    if (answerValues.length > 0) {
      const formatted = formatAnswerYaml(answerValues);
      if (answerLineIndex >= 0) {
        const existingIndent = result[answerLineIndex].match(/^([ \t]*)/)?.[1] || "";
        result.splice(answerLineIndex, answerLineCount, `${existingIndent}answer: ${formatted}`);
      } else {
        let propIndent = span.indent;
        if (span.hasDash) {
          propIndent = `${span.indent}    `;
          for (let j = 1; j < questionLines.length; j++) {
            const m = questionLines[j].match(/^([ \t]+)\S/);
            if (m && m[1].length > span.indent.length) {
              propIndent = m[1];
              break;
            }
          }
        }
        result.splice(span.startIndex + 1, 0, `${propIndent}answer: ${formatted}`);
      }
    } else {
      if (answerLineIndex >= 0) {
        result.splice(answerLineIndex, answerLineCount);
      }
    }
  }

  return result;
}
