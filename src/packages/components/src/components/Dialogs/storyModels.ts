import type { PlanQuestion } from "../PlanMarkdown/questionsSchema";
import type { DirtyRepo } from "./DirtyRepoDialog";

/**
 * Model builders for the dialog stories.
 *
 * Values are deliberately plausible rather than minimal - real-looking paths, titles and counts -
 * because a story is read by a person judging whether a dialog looks right, not only rendered by a
 * test.
 */

/**
 * A dirty repo.
 *
 * `changeCount` is separate from `changes.length` on purpose: the service caps the list it sends,
 * so the true total is the count, and `DirtyRepoDialog` measures "+N more" against it. Passing a
 * count larger than the list is the only way to reproduce a repo mid-refactor.
 */
export function repo(
  path: string,
  changes: string[],
  overrides: Partial<DirtyRepo> = {},
): DirtyRepo {
  return { path, isDirty: true, changes, ...overrides };
}

export function question(overrides: Partial<PlanQuestion> = {}): PlanQuestion {
  return {
    id: "q1",
    title: "Should the harness ship in release builds?",
    multiple: false,
    other: false,
    optional: false,
    answerPresent: false,
    ...overrides,
  };
}
