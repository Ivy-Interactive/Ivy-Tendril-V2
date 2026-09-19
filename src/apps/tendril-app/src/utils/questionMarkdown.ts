import { parseQuestions, type PlanQuestion } from "@ivy-interactive/components/tendril";
import type { InProgressQuestionAnswers } from "../types/chat";

export interface QuestionsFence {
  openLineIndex: number;
  openLine: string;
  closeLineIndex?: number;
  closeLine?: string;
  bodyLines: string[];
  body: string;
}

/**
 * Scans markdown content for code fences with info string "questions" following CommonMark rules.
 * Handles 3+ backticks or tildes, indentation up to 3 spaces, case-insensitive info string,
 * matching closing fence length and delimiter, and unterminated fences at EOF.
 */
export function scanQuestionsFences(markdown: string): QuestionsFence[] {
  if (!markdown) return [];

  const lines = markdown.split(/\r?\n/);
  const fences: QuestionsFence[] = [];

  let inFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  let openLineIndex = -1;
  let openLine = "";
  let currentBody: string[] = [];
  /** An open fence that is not a `questions` one. Its contents are skipped entirely. */
  let skipChar = "";
  let skipLength = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inFence && !skipChar) {
      // CommonMark: 0-3 spaces/tabs indentation, 3+ backticks or tildes
      const match = line.match(/^([ \t]{0,3})(`{3,}|~{3,})(.*)$/);
      if (match) {
        const delim = match[2];
        const char = delim[0];
        const info = match[3].trim();
        const firstWord = info.split(/\s+/)[0]?.toLowerCase();
        if (firstWord === "questions") {
          inFence = true;
          fenceChar = char;
          fenceLength = delim.length;
          openLineIndex = i;
          openLine = line;
          currentBody = [];
          continue;
        }
        /* A fence that is *not* `questions` still has to be entered and skipped, or a `questions`
           sample nested inside a documentation fence is read as a live question block. V1's
           `QuestionBlockParser` and the Rust scanner both ignore it; this one used to walk straight
           into it. Only the delimiter and length are kept — the body is discarded. */
        skipChar = char;
        skipLength = delim.length;
        continue;
      }
    } else if (skipChar) {
      const closeMatch = line.match(/^([ \t]{0,3})(`{3,}|~{3,})[ \t]*$/);
      if (closeMatch && closeMatch[2][0] === skipChar && closeMatch[2].length >= skipLength) {
        skipChar = "";
        skipLength = 0;
      }
      continue;
    } else {
      // Closing fence: 0-3 spaces/tabs indentation, same delimiter character, length >= opening fence length
      const closeMatch = line.match(/^([ \t]{0,3})(`{3,}|~{3,})[ \t]*$/);
      if (closeMatch) {
        const closeDelim = closeMatch[2];
        if (closeDelim[0] === fenceChar && closeDelim.length >= fenceLength) {
          fences.push({
            openLineIndex,
            openLine,
            closeLineIndex: i,
            closeLine: line,
            bodyLines: currentBody,
            body: currentBody.join("\n"),
          });
          inFence = false;
          fenceChar = "";
          fenceLength = 0;
          openLineIndex = -1;
          openLine = "";
          currentBody = [];
          continue;
        }
      }
      currentBody.push(line);
    }
  }

  if (inFence) {
    fences.push({
      openLineIndex,
      openLine,
      bodyLines: currentBody,
      body: currentBody.join("\n"),
    });
  }

  return fences;
}

/**
 * Extracts raw fence bodies for fenced code blocks with info string "questions".
 * Follows CommonMark fence rules (supporting 3+ backticks or tildes).
 */
export function extractQuestionsFences(markdown: string): string[] {
  if (!markdown) return [];
  return scanQuestionsFences(markdown)
    .filter((fence) => fence.closeLineIndex !== undefined || fence.bodyLines.length > 0)
    .map((fence) => fence.body);
}

/**
 * Extracts and parses all PlanQuestion items from questions fences in markdown content.
 * Returns only items from valid questions blocks.
 */
export function extractPlanQuestions(markdown: string): PlanQuestion[] {
  if (!markdown) return [];
  const fenceBodies = extractQuestionsFences(markdown);
  const questions: PlanQuestion[] = [];

  for (const body of fenceBodies) {
    const parsed = parseQuestions(body);
    if (parsed.kind === "questions") {
      questions.push(...parsed.questions);
    }
  }

  return questions;
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

  const fences = scanQuestionsFences(content);
  if (fences.length === 0) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const outputLines: string[] = [];
  let currentLineIndex = 0;

  for (const fence of fences) {
    while (currentLineIndex < fence.openLineIndex) {
      outputLines.push(lines[currentLineIndex]);
      currentLineIndex++;
    }

    outputLines.push(fence.openLine);
    currentLineIndex = fence.openLineIndex + 1;

    const patchedBodyLines = patchFenceBody(fence.bodyLines, answers);
    outputLines.push(...patchedBodyLines);

    if (fence.closeLineIndex !== undefined && fence.closeLine !== undefined) {
      outputLines.push(fence.closeLine);
      currentLineIndex = fence.closeLineIndex + 1;
    } else {
      currentLineIndex = lines.length;
    }
  }

  while (currentLineIndex < lines.length) {
    outputLines.push(lines[currentLineIndex]);
    currentLineIndex++;
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

/**
 * Merges confirmed questions blocks from server message content into local in-flight message content.
 * Replaces the matched questions fence in localContent with the confirmed fence from serverContent,
 * preserving all newly accumulated streaming text and deltas outside the fence.
 */
export function mergeConfirmedQuestionsBlock(localContent: string, serverContent: string): string {
  if (!localContent) return serverContent;
  if (!serverContent) return localContent;

  const serverFences = scanQuestionsFences(serverContent);
  const localFences = scanQuestionsFences(localContent);

  if (serverFences.length === 0 || localFences.length === 0) {
    return localContent;
  }

  const serverLines = serverContent.split(/\r?\n/);
  const localLines = localContent.split(/\r?\n/);

  for (let i = Math.min(serverFences.length, localFences.length) - 1; i >= 0; i--) {
    const sFence = serverFences[i];
    const lFence = localFences[i];

    const sCloseIndex = sFence.closeLineIndex ?? serverLines.length - 1;
    const serverFenceLines = serverLines.slice(sFence.openLineIndex, sCloseIndex + 1);

    const lCloseIndex = lFence.closeLineIndex ?? localLines.length - 1;
    const deleteCount = lCloseIndex - lFence.openLineIndex + 1;

    localLines.splice(lFence.openLineIndex, deleteCount, ...serverFenceLines);
  }

  return localLines.join("\n");
}
