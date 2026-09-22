import type { PlanDetail, PlanSummary, RepoStatus } from "../../types/api";
import type { PlanQuestion } from "@ivy-interactive/components/tendril";

/**
 * Model builders for the dialog stories.
 *
 * Deliberately *not* `tests/fixtures/plan.fixture`, which builds the same shapes. Stories are read
 * by Storybook's Vite build, which has no reason to resolve anything under `tests/`, and inverting
 * it (fixtures importing these) would make a test helper depend on a story. Two small builders in
 * each place is the cheaper of the three.
 *
 * Values are deliberately plausible rather than minimal - real-looking paths, titles and counts -
 * because a story is read by a person judging whether a dialog looks right.
 */

export function plan(overrides: Partial<PlanDetail> = {}): PlanDetail {
  return {
    id: "00412",
    title: "Port the dialog debug harness",
    state: "Draft",
    project: "Ivy-Tendril-V2",
    level: "Feature",
    repos: ["/repos/Ivy-Tendril-V2"],
    verifications: [],
    dependsOn: [],
    relatedPlans: [],
    commits: [],
    prs: [],
    revisionCount: 3,
    recommendations: [],
    ...overrides,
  };
}

export function summary(overrides: Partial<PlanSummary> = {}): PlanSummary {
  return {
    id: "00412",
    title: "Port the dialog debug harness",
    state: "Draft",
    project: "Ivy-Tendril-V2",
    level: "Feature",
    verifications: [],
    ...overrides,
  };
}

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
  overrides: Partial<RepoStatus> = {},
): RepoStatus {
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
