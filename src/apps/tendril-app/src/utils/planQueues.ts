import type { Job, PlanSummary } from "../types/api";

/**
 * Which plans each page is responsible for, and the one rule they share: a plan a job is still
 * holding belongs to no queue.
 *
 * This lives outside the views because three callers need it and only two of them are views. `PlansView`
 * and `ReviewView` build their lists from it, and the shell needs the same numbers for its nav badges —
 * but the views are `React.lazy`, so importing a helper *from* one of them would pull that whole view
 * and its dialogs into the initial chunk. Deriving the badge separately is what let it drift: counting
 * by plan state alone, the shell read "2" over an empty Plans queue, because a plan whose execution is
 * only `Queued` or `Blocked` is still recorded `Draft`.
 */

/**
 * The V1 state names that were renamed, mapped to what they were renamed to.
 *
 * `Building` became `Creating` and `ReadyForReview` became `Review`. A `plan.yaml` written before the
 * rename still carries the old spelling, and nothing rewrites one on read, so every read point has to
 * accept both or a legacy plan arrives as a state this UI knows nothing about: no badge colour, absent
 * from the list it belongs in, and — worse — not `"Review"`, so the Review-only actions never appear
 * on a plan that is sitting in review.
 */
const LEGACY_LIFECYCLE_STATES: Record<string, string> = {
  Building: "Creating",
  ReadyForReview: "Review",
};

/**
 * A plan's state under its current name. Anything already current, or unrecognised, passes through
 * unchanged so an unknown state still renders as itself rather than disappearing.
 */
export const normalizePlanState = (state: string | undefined): string =>
  state ? (LEGACY_LIFECYCLE_STATES[state] ?? state) : "";

/**
 * The states the **Plans** page's list holds, from `PlansApp.Build`:
 * `.Where(p => p.Status is PlanStatus.Draft or PlanStatus.Blocked)`. A blocked plan is a draft
 * waiting on a dependency, which is why V1 triages it here and not on the Review page.
 */
export const PLANS_LIST_STATES = ["Draft", "Blocked"] as const;

/**
 * The states V1's **Review** app owns, from `ReviewApp.Build`:
 * `.Where(p => p.Status is PlanStatus.Review or PlanStatus.Failed)`. A failed execution needs the
 * same decision a passing one does, so V1 triages both on that page.
 *
 * `AppShell/Dialogs/PlanSearchDialog.ResolveTarget` states the same partition from the other side,
 * and it is the authority for which surfaces a plan gets:
 *
 * ```csharp
 * PlanStatus.Draft or PlanStatus.Blocked => (typeof(PlansApp),  new PlansAppArgs(plan.FolderName)),
 * PlanStatus.Review or PlanStatus.Failed => (typeof(ReviewApp), new ReviewAppArgs(plan.FolderName)),
 * PlanStatus.Icebox                      => (typeof(IceboxApp), null),
 * _                                      => null
 * ```
 */
export const REVIEW_QUEUE_STATES = ["Review", "Failed"] as const;

/** Whether a plan belongs to V1's Review app, under {@link normalizePlanState}'s current name. */
export const isReviewState = (state: string | undefined): boolean =>
  (REVIEW_QUEUE_STATES as readonly string[]).includes(normalizePlanState(state));

/**
 * `PlansApp.Build`'s `activePlanFolders`/`activeCreatePlanIds` and `ReviewApp.Build`'s
 * `activePlanFolders`: a job in one of these still holds the plan, so V1 drops it from the list rather
 * than offering a second write on top of the agent's. `Blocked` counts — that is a job queued behind
 * another, not a job that finished.
 */
const JOB_HOLDS_PLAN: ReadonlyArray<Job["status"]> = ["Running", "Queued", "Pending", "Blocked"];

/** The plan ids a job is currently holding. */
const heldPlanIds = (jobs?: Job[]): Set<string> =>
  new Set(
    (jobs ?? [])
      .filter((job) => JOB_HOLDS_PLAN.includes(job.status))
      .map((job) => job.planId)
      .filter((id): id is string => !!id),
  );

/** The plan id as a number, for ordering. Non-numeric ids sort last. */
const planIdOrder = (id: string): number => {
  const parsed = Number.parseInt(id, 10);
  return Number.isNaN(parsed) ? -1 : parsed;
};

/** Newest first, which is V1's `.OrderByDescending(p => p.Id)`. */
const newestFirst = (plans: PlanSummary[]): PlanSummary[] =>
  [...plans].sort((a, b) => planIdOrder(b.id) - planIdOrder(a.id));

/**
 * The **Plans** queue, exactly as `PlansApp.Build` assembles it: Draft or Blocked, minus the plans a
 * job is still working on, newest first.
 *
 * `jobs` absent means the caller has no job list to consult, in which case the state filter is all
 * there is.
 */
export const draftQueueFor = (plans: PlanSummary[], jobs?: Job[]): PlanSummary[] => {
  const held = heldPlanIds(jobs);
  return newestFirst(
    plans.filter(
      (p) =>
        (PLANS_LIST_STATES as readonly string[]).includes(normalizePlanState(p.state)) &&
        !held.has(p.id),
    ),
  );
};

/**
 * The **Review** queue, exactly as `ReviewApp.Build` assembles it: Review or Failed, minus the plans a
 * job is still running on, newest first.
 *
 * The exclusion is the part that is easy to drop and matters most. A plan under a RetryPlan is in
 * Executing and so filtered by state anyway, but one whose retry is only Queued or Blocked is still
 * sitting in Review, and offering Complete Plan or Create PR on it means approving work that has not
 * been done yet.
 */
export const reviewQueueFor = (plans: PlanSummary[], jobs?: Job[]): PlanSummary[] => {
  const held = heldPlanIds(jobs);
  return newestFirst(plans.filter((p) => isReviewState(p.state) && !held.has(p.id)));
};
