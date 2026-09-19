/**
 * The Tendril process counts, ported from `Services/Plans/TendrilProcessStatusService.Compute`.
 *
 * V1 computes these once in a service and hands the result to every surface that shows the pipeline:
 * `Hooks/UseTendrilProcess.cs` feeds `TendrilProcessViewer` from it, and `DashboardApp` reads the
 * same snapshot for its status strip. They live here for the same reason - the Dashboard and the
 * Plans/Review wallpapers must not disagree about how much work is in flight.
 */
import type { Job, JobStatus, PlanSummary } from "../types/api";

/**
 * A job in one of these statuses has not finished, so its plan is still mid-flight. The set is
 * `TendrilProcessStatusService.Compute`'s `activeJobs` filter, which is also what
 * `DashboardApp.BuildActiveJobs` lists and what the status strip's In Progress count reports.
 */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = [
  "Pending",
  "Queued",
  "Running",
  "Blocked",
];

/**
 * The three promptware types `TendrilProcessStatusService.Compute` folds into one Updating counter.
 * A plan being expanded or split is being rewritten just as much as one being updated, and the
 * process viewer has one loop arrow for all three.
 */
export const UPDATING_JOB_TYPES = ["UpdatePlan", "ExpandPlan", "SplitPlan"];

/**
 * Plan states the Plans box counts, and the states the Review box counts
 * (`TendrilProcessStatusService.Compute`). Blocked plans sit with the drafts because a plan waiting
 * on a dependency is still a plan nobody has run; Failed plans sit with Review because a failure is
 * what the Review app exists to triage. This is also what the shell's own nav badges count
 * (`TendrilAppShell.BuildMenuItems`), so the strip and the badge beside it cannot disagree.
 */
const DRAFT_PLAN_STATES = ["Draft", "Blocked"];
const REVIEW_PLAN_STATES = ["Review", "Failed"];

/**
 * Unfinished jobs of the given promptware type.
 *
 * Counted per *job*, not per distinct plan: that is what `TendrilProcessStatusService.Compute` does
 * (`activeJobs.Count(j => j.Type == ...)`), and it is the honest number for a strip that reads
 * "how much work is in flight". Two retries queued against one plan are two runs to wait for, and
 * collapsing them to 1 understates the queue.
 */
export const activeJobCountForType = (jobs: Job[], types: readonly string[]): number =>
  jobs.filter((j) => types.includes(j.type) && ACTIVE_JOB_STATUSES.includes(j.status)).length;

/**
 * The two counts the status strip and the process viewer share, with V1's premature-state
 * correction applied (`TendrilProcessStatusService.Compute`).
 *
 * A plan whose job is still running has not necessarily had its `plan.yaml` state advanced yet, so
 * for a moment it reads as a Draft nobody has run or a Review nobody has looked at. V1 subtracts
 * those from both boxes rather than inviting the operator to act on a plan an agent is holding.
 *
 * V1 matches plan to job on the job's plan folder (and, for CreatePlan, on its allocated id). V2's
 * job DTO carries neither: `Job.planId` is the daemon's `reportedPlanId`, which only exists once an
 * agent has reported it. So this matches on what there is, and a job that has not reported its plan
 * simply corrects nothing — the pre-correction count, which is what V2 showed before.
 */
export function planStateCounts(
  plans: PlanSummary[],
  jobs: Job[],
): { draftCount: number; reviewCount: number } {
  const activePlanIds = new Set(
    jobs
      .filter((j) => ACTIVE_JOB_STATUSES.includes(j.status))
      .map((j) => j.planId)
      .filter((id): id is string => id != null && id !== ""),
  );

  let draftCount = 0;
  let reviewCount = 0;
  for (const plan of plans) {
    const isDraft = DRAFT_PLAN_STATES.includes(plan.state);
    const isReview = REVIEW_PLAN_STATES.includes(plan.state);
    if (!isDraft && !isReview) continue;
    if (activePlanIds.has(plan.id)) continue;
    if (isDraft) draftCount += 1;
    else reviewCount += 1;
  }

  return { draftCount, reviewCount };
}

/** The snapshot `TendrilProcessViewer` needs, i.e. the fields of V1's `TendrilProcessStatus`. */
export interface TendrilProcessStatus {
  draftCount: number;
  reviewCount: number;
  creatingPlansCount: number;
  updatingPlansCount: number;
  executingPlansCount: number;
  retryingPlansCount: number;
  creatingPrCount: number;
}

/**
 * `TendrilProcessStatusService.Compute`, restricted to the counters the process viewer reads.
 *
 * The arrows between the boxes are *jobs in flight*, not plans in a state: V1 derives all five from
 * the active job list by promptware type. Reading a plan's state instead misses the whole transient
 * window this widget exists to show — a plan is only ever `Creating` for the moments between the job
 * starting and the write landing, and a CreatePlan job has no plan to be in a state at all until it
 * produces one.
 */
export const computeProcessStatus = (plans: PlanSummary[], jobs: Job[]): TendrilProcessStatus => {
  const { draftCount, reviewCount } = planStateCounts(plans, jobs);

  return {
    draftCount,
    reviewCount,
    creatingPlansCount: activeJobCountForType(jobs, ["CreatePlan"]),
    updatingPlansCount: activeJobCountForType(jobs, UPDATING_JOB_TYPES),
    executingPlansCount: activeJobCountForType(jobs, ["ExecutePlan"]),
    retryingPlansCount: activeJobCountForType(jobs, ["RetryPlan"]),
    creatingPrCount: activeJobCountForType(jobs, ["CreatePr"]),
  };
};
