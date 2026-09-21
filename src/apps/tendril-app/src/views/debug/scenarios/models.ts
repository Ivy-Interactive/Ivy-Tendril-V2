import type { PlanDetail, PlanSummary, RepoStatus } from "../../../types/api";
import type { PlanQuestion } from "@ivy-interactive/components/tendril";

/**
 * Model builders for the scenario catalogs.
 *
 * Deliberately *not* `tests/fixtures/plan.fixture`, which builds the same shapes. The catalogs are
 * app source: the harness renders them in the running app, so anything they import ships. Reaching
 * into `tests/` would pull test-only code into the app graph, and inverting it (fixtures importing
 * these) would make a test helper depend on a debug view. Two small builders in each place is the
 * cheaper of the three.
 *
 * Values are deliberately plausible rather than minimal - real-looking paths, titles and counts -
 * because the harness is read by a person judging whether a dialog looks right.
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
