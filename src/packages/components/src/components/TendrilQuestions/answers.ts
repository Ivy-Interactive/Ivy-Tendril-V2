import type { PlanQuestion } from "../PlanMarkdown/questionsSchema";
import { answerEntries, otherEntry } from "../PlanMarkdown/questionsSchema";

/** Draft or document answers keyed by question id. An empty list means unanswered. */
export type AnswerMap = Record<string, string[]>;

export const hasEntries = (entries: string[] | undefined): entries is string[] =>
  entries !== undefined && entries.length > 0;

/** The answers the document already carries, which is what a fresh draft starts from. */
export function documentAnswers(questions: PlanQuestion[]): AnswerMap {
  const answers: AnswerMap = {};
  for (const question of questions) {
    if (question.answerPresent) answers[question.id] = answerEntries(question);
  }
  return answers;
}

/** Which questions have a typed (non-option) entry in the document, so their Other field opens. */
export function documentOtherOpen(questions: PlanQuestion[]): Record<string, boolean> {
  const open: Record<string, boolean> = {};
  for (const question of questions) {
    if (question.answerPresent && otherEntry(question) !== undefined) open[question.id] = true;
  }
  return open;
}

/** The option's title for an entry naming an option, else the entry itself (the user's own words). */
export function entryTitle(question: PlanQuestion, entry: string): string {
  return question.options?.find((option) => option.value === entry)?.title ?? entry;
}

/** A block is submittable once it carries at least one answer, drafted here or in the document. */
export function canSubmitAnswers(questions: PlanQuestion[], answers: AnswerMap): boolean {
  return questions.some((question) => hasEntries(answers[question.id]) || question.answerPresent);
}

/** Required questions with no drafted entry and no answer already in the document. */
export function unansweredRequired(questions: PlanQuestion[], answers: AnswerMap): PlanQuestion[] {
  return questions.filter(
    (question) =>
      !question.optional && !hasEntries(answers[question.id]) && !question.answerPresent,
  );
}

const TITLE_TRUNCATE_LENGTH = 60;

const truncateTitle = (title: string): string =>
  title.length > TITLE_TRUNCATE_LENGTH ? `${title.slice(0, TITLE_TRUNCATE_LENGTH - 1)}…` : title;

/**
 * The footer note explaining why Submit is disabled or what a partial submit leaves to the agent.
 * Shared by `ChatQuestionsBlock` and `TendrilQuestions` so both surfaces read identically.
 */
export function submitNote(questions: PlanQuestion[], answers: AnswerMap): string | undefined {
  const hasAnyAnswers = questions.some(
    (question) => hasEntries(answers[question.id]) || question.answerPresent,
  );
  if (!hasAnyAnswers) return "Answer a question to submit.";

  const missing = unansweredRequired(questions, answers);
  if (missing.length === 0) return undefined;
  if (missing.length === 1) {
    const title = missing[0].title || missing[0].id;
    return `Unanswered: "${truncateTitle(title)}". Submitting leaves it to me.`;
  }
  return `${missing.length} questions unanswered. Submitting leaves them to me.`;
}

/**
 * The markdown summary that travels with a submission, so the conversation records what was
 * decided in words rather than ids.
 */
export function buildAnswersSummary(questions: PlanQuestion[], answers: AnswerMap): string {
  const lines = ["Answers:"];
  for (const question of questions) {
    const entries = answers[question.id] ?? (question.answerPresent ? answerEntries(question) : []);
    const label = question.title || question.id;
    if (entries.length > 0) {
      lines.push(
        `- **${label}**: ${entries.map((entry) => entryTitle(question, entry)).join(", ")}`,
      );
    } else if (question.optional) {
      lines.push(`- **${label}**: *(skipped)*`);
    } else {
      lines.push(`- **${label}**: *(no preference, your call)*`);
    }
  }
  return lines.join("\n");
}

const SKIPPED_MARKER = "*(skipped)*";
const NO_PREFERENCE_MARKER = "*(no preference, your call)*";

/** One question's outcome as read back out of a submitted summary. */
export interface ParsedAnswer {
  label: string;
  /**
   * Everything the question settled on, as the one string the summary records. A multi-select
   * reads "Lint, Test", which is what was decided; splitting it would turn a typed answer like
   * "Yes, but only on Tuesdays" into two decisions that were never made.
   */
  value: string;
  skipped: boolean;
  noPreference: boolean;
}

/**
 * Reads a summary `buildAnswersSummary` produced back into its pairs, so a submission that reached
 * the conversation as markdown can be presented as the structured answers it records. Returns
 * undefined for anything that is not such a summary, which is what tells a plain user message apart
 * from an answers submission; a line whose own bold markers would make the split ambiguous is
 * refused outright, so the whole message falls back to raw text rather than being misread.
 */
export function parseAnswersSummary(content: string): ParsedAnswer[] | undefined {
  const lines = content.trim().split("\n");
  if (lines.shift()?.trim() !== "Answers:") return undefined;
  if (lines.length === 0) return undefined;

  const parsed: ParsedAnswer[] = [];
  for (const line of lines) {
    const match = /^- \*\*(.+?)\*\*: (.*)$/.exec(line.trim());
    if (!match) return undefined;
    const [, label, rest] = match;
    if (label.includes("**") || rest.includes("**: ")) return undefined;
    if (rest === SKIPPED_MARKER) {
      parsed.push({ label, value: "", skipped: true, noPreference: false });
    } else if (rest === NO_PREFERENCE_MARKER) {
      parsed.push({ label, value: "", skipped: false, noPreference: true });
    } else {
      const value = rest.trim();
      if (value.length === 0) return undefined;
      parsed.push({ label, value, skipped: false, noPreference: false });
    }
  }
  return parsed;
}
