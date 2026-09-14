import type { PlanQuestion } from "@ivy-interactive/components/tendril";
import { extractPlanQuestions } from "../utils/questionMarkdown";
import type { PlanDetail, RepoStatus } from "../types/api";

export type ExecuteGuardKind = "PendingAnnotations" | "UnansweredQuestions" | "DirtyRepo";

export interface ExecuteGuard {
  kind: ExecuteGuardKind;
  /** UnansweredQuestions: the questions still missing an answer. */
  questions?: PlanQuestion[];
  /** PendingAnnotations: how many answers/notes are not yet folded into the plan. */
  annotationCount?: number;
  /** DirtyRepo: repos reporting uncommitted changes. */
  dirtyRepos?: RepoStatus[];
}

export interface CollectExecuteGuardsInput {
  plan: PlanDetail;
  /** From `bridge.getRepoStatus`. Absent means "not known", which never blocks. */
  repoStatus?: RepoStatus[];
  /**
   * Overrides the derived count. The prop exists so a real annotation store can
   * feed this later without touching the dialog.
   */
  annotationCount?: number;
}

/**
 * Questions that must be answered before the plan is safe to execute.
 *
 * `optional: true` questions are shippable without an answer by definition, so
 * they never block.
 */
export function unansweredQuestions(plan: PlanDetail): PlanQuestion[] {
  let questions: PlanQuestion[];
  try {
    questions = extractPlanQuestions(plan.latestRevisionContent ?? "");
  } catch {
    // A malformed questions fence must not brick execution: the guard's job is
    // to warn, and a parse failure means there is nothing it can warn about.
    return [];
  }
  return questions.filter((q) => !q.answerPresent && !q.optional);
}

/**
 * Answers written into the plan but not yet folded into its body by UpdatePlan.
 *
 * V2 has no annotation store, so the nearest signal is an answered question on a
 * plan still sitting at its first revision: the answer exists, but no UpdatePlan
 * run has incorporated it.
 */
export function pendingAnnotationCount(plan: PlanDetail): number {
  if (plan.state !== "Draft" || plan.revisionCount !== 1) return 0;
  try {
    return extractPlanQuestions(plan.latestRevisionContent ?? "").filter((q) => q.answerPresent)
      .length;
  } catch {
    return 0;
  }
}

/**
 * The guards standing between an Execute click and job dispatch, in the order
 * they must be shown: **PendingAnnotations → UnansweredQuestions → DirtyRepo**.
 *
 * Cheapest fix first. Unincorporated answers just need an UpdatePlan run;
 * unanswered questions need someone to decide; a dirty repo is the one most
 * likely to be a deliberate "yes, I know", so it asks last, closest to dispatch.
 *
 * An empty result means execute immediately.
 */
export function collectExecuteGuards(input: CollectExecuteGuardsInput): ExecuteGuard[] {
  const { plan, repoStatus, annotationCount } = input;
  const guards: ExecuteGuard[] = [];

  const annotations = annotationCount ?? pendingAnnotationCount(plan);
  if (annotations > 0) {
    guards.push({ kind: "PendingAnnotations", annotationCount: annotations });
  }

  const questions = unansweredQuestions(plan);
  if (questions.length > 0) {
    guards.push({ kind: "UnansweredQuestions", questions });
  }

  // A repo that could not be inspected reports `isDirty: false` with an `error`,
  // so an unreadable repo degrades to "nothing known to be dirty" instead of
  // blocking execution forever.
  const dirtyRepos = (repoStatus ?? []).filter((r) => r.isDirty);
  if (dirtyRepos.length > 0) {
    guards.push({ kind: "DirtyRepo", dirtyRepos });
  }

  return guards;
}
