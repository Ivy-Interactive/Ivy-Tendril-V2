import { formatList } from "@ivy-interactive/components/i18n";
import { bridge } from "../api/bridge";
import { i18n } from "../i18n";
import { planStateLabel } from "../i18n/enumLabels";
import type {
  CreateIssueFields,
  CreatePrOptions,
  PlanDetail,
  PlanSummary,
  StartJobResponse,
} from "../types/api";

export interface ActionGatingResult {
  allowed: boolean;
  reason?: string;
}

/** States where a job holds the plan folder, so nothing may move or remove it. */
const IN_FLIGHT_STATES = ["Executing", "Creating", "Updating"];

/** States a plan is finished in. */
const TERMINAL_STATES = ["Completed", "Skipped"];

/**
 * The reasons below are shown to the operator - as a disabled action's tooltip, or as the error a
 * refused dispatch throws - so they are translated, into the language current when they are asked
 * for. The state they name is the plan's raw state, labelled; the gates themselves compare raw values.
 */
const t = i18n.getFixedT(null, "plans");

/** A list of verification names, `A, B` in English - the separator the reasons always used. */
const nameList = (names: string[]) => formatList(names, { type: "unit", style: "short" });

export class PlanActionsController {
  /**
   * Check if a plan can be executed (ExecutePlan).
   * Gating:
   * - Must be in Draft or Blocked (or Creating) state
   * - All dependencies in dependsOn must be Completed
   * - If dependency plans are provided in context, check they are Completed with PRs merged
   */
  public static canExecute(
    plan: PlanDetail | PlanSummary,
    dependencyPlans: PlanSummary[] = [],
  ): ActionGatingResult {
    if (plan.state === "Completed") {
      return { allowed: false, reason: t("planActions.canExecute.alreadyCompleted") };
    }
    if (plan.state === "Executing") {
      return { allowed: false, reason: t("planActions.canExecute.executing") };
    }

    const dependsOn = "dependsOn" in plan && plan.dependsOn ? plan.dependsOn : [];
    if (dependsOn.length > 0) {
      for (const dep of dependsOn) {
        // Find matching dependency plan
        const match = dependencyPlans.find(
          (p) => p.id === dep || dep.startsWith(p.id) || p.id === dep.split("-")[0],
        );
        if (match) {
          if (match.state !== "Completed") {
            return {
              allowed: false,
              reason: t("planActions.canExecute.blockedByDependency", {
                dependency: dep,
                state: planStateLabel(match.state),
              }),
            };
          }
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Check if CreatePr is allowed.
   * Gating:
   * - Must be in Review or Failed state
   * - All required verifications must have Pass status (none Fail or Pending)
   */
  public static canCreatePr(plan: PlanDetail | PlanSummary): ActionGatingResult {
    if (plan.state !== "Review" && plan.state !== "Failed") {
      return {
        allowed: false,
        reason: t("planActions.canCreatePr.wrongState", { state: planStateLabel(plan.state) }),
      };
    }

    const verifications = plan.verifications || [];
    const failingVerifications = verifications.filter((v) => v.status === "Fail");
    if (failingVerifications.length > 0) {
      return {
        allowed: false,
        reason: t("planActions.canCreatePr.verificationsFailed", {
          names: nameList(failingVerifications.map((v) => v.name)),
        }),
      };
    }

    const pendingVerifications = verifications.filter((v) => v.status === "Pending");
    if (pendingVerifications.length > 0) {
      return {
        allowed: false,
        reason: t("planActions.canCreatePr.verificationsPending", {
          names: nameList(pendingVerifications.map((v) => v.name)),
        }),
      };
    }

    return { allowed: true };
  }

  /**
   * Check if RetryPlan is allowed.
   * Available when plan is in Review or Failed state.
   */
  public static canRetry(plan: PlanDetail | PlanSummary): ActionGatingResult {
    if (plan.state === "Review" || plan.state === "Failed") {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: t("planActions.canRetry.wrongState", { state: planStateLabel(plan.state) }),
    };
  }

  /**
   * Check if ExpandPlan, UpdatePlan, or SplitPlan is allowed.
   * Available when plan is in Draft state.
   */
  public static canRefine(plan: PlanDetail | PlanSummary): ActionGatingResult {
    if (plan.state === "Draft") {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: t("planActions.canRefine.wrongState", { state: planStateLabel(plan.state) }),
    };
  }

  /**
   * Check if the plan may be deleted permanently.
   * Refused while a job holds the plan folder. The `DELETE` endpoint enforces
   * the same rule with a 409; this only keeps the button from lying.
   */
  public static canDelete(plan: PlanDetail | PlanSummary): ActionGatingResult {
    if (IN_FLIGHT_STATES.includes(plan.state)) {
      return {
        allowed: false,
        reason: t("planActions.canDelete.inFlight", { state: planStateLabel(plan.state) }),
      };
    }
    return { allowed: true };
  }

  /**
   * Check if the plan may be sent back to Draft.
   * Only meaningful for a plan that has been executed and stalled: Review,
   * Failed or Blocked.
   */
  public static canReset(plan: PlanDetail | PlanSummary): ActionGatingResult {
    if (TERMINAL_STATES.includes(plan.state)) {
      return {
        allowed: false,
        reason: t("planActions.canReset.terminal", { state: planStateLabel(plan.state) }),
      };
    }
    if (IN_FLIGHT_STATES.includes(plan.state)) {
      return {
        allowed: false,
        reason: t("planActions.canReset.inFlight", { state: planStateLabel(plan.state) }),
      };
    }
    if (plan.state === "Review" || plan.state === "Failed" || plan.state === "Blocked") {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: t("planActions.canReset.wrongState", { state: planStateLabel(plan.state) }),
    };
  }

  /**
   * Check if a partial delivery may be accepted: completing the plan despite
   * failing verifications. Only offered when there is a failure to accept —
   * otherwise plain completion suffices.
   */
  public static canCompletePartial(plan: PlanDetail | PlanSummary): ActionGatingResult {
    if (plan.state !== "Review" && plan.state !== "Failed") {
      return {
        allowed: false,
        reason: t("planActions.canCompletePartial.wrongState", {
          state: planStateLabel(plan.state),
        }),
      };
    }
    const failing = (plan.verifications || []).filter((v) => v.status === "Fail");
    if (failing.length === 0) {
      return {
        allowed: false,
        reason: t("planActions.canCompletePartial.noFailures"),
      };
    }
    return { allowed: true };
  }

  /**
   * Check if CompletePlan is allowed.
   * Available when plan is in Review or Failed state.
   */
  public static canComplete(plan: PlanDetail | PlanSummary): ActionGatingResult {
    if (plan.state === "Completed") {
      return { allowed: false, reason: t("planActions.canComplete.alreadyCompleted") };
    }
    if (IN_FLIGHT_STATES.includes(plan.state)) {
      return {
        allowed: false,
        reason: t("planActions.canComplete.inFlight", { state: planStateLabel(plan.state) }),
      };
    }
    return { allowed: true };
  }

  /**
   * Completes a plan:
   * If the plan has commits, starts a CreatePr job configured with auto-merge and branch deletion
   * so that git changes are integrated into the main repository and the plan completes through the job.
   * If the plan has no commits, transitions the plan directly to Completed.
   */
  public static async completePlan(
    plan: PlanDetail | PlanSummary,
    options?: CreatePrOptions,
  ): Promise<StartJobResponse | void> {
    const check = this.canComplete(plan);
    if (!check.allowed) {
      throw new Error(check.reason || t("planActions.errors.completeBlocked"));
    }

    let commits = "commits" in plan && Array.isArray(plan.commits) ? plan.commits : [];
    if (commits.length === 0 && !("commits" in plan)) {
      try {
        const detail = await bridge.getPlan(plan.id);
        if (detail?.commits && Array.isArray(detail.commits)) {
          commits = detail.commits;
        }
      } catch {
        // ignore
      }
    }

    if (commits.length > 0) {
      return bridge.startJob({
        type: "CreatePr",
        folderPath: plan.id,
        solveMergeConflicts: true,
        merge: true,
        deleteBranch: true,
        includeArtifacts: true,
        ...options,
      });
    }

    await bridge.updatePlanField(plan.id, "state", "Completed", true);
  }

  /**
   * Dispatches ExecutePlan job with gating checks.
   */
  public static async executePlan(
    plan: PlanDetail | PlanSummary,
    dependencyPlans: PlanSummary[] = [],
    note?: string,
  ): Promise<StartJobResponse> {
    const check = this.canExecute(plan, dependencyPlans);
    if (!check.allowed) {
      throw new Error(check.reason || t("planActions.errors.executeBlocked"));
    }

    return bridge.startJob({
      type: "ExecutePlan",
      folderPath: plan.id,
      note,
    });
  }

  /**
   * Dispatches RetryPlan job with gating checks.
   */
  public static async retryPlan(
    plan: PlanDetail | PlanSummary,
    changeRequest: string,
  ): Promise<StartJobResponse> {
    const check = this.canRetry(plan);
    if (!check.allowed) {
      throw new Error(check.reason || t("planActions.errors.retryBlocked"));
    }

    return bridge.startJob({
      type: "RetryPlan",
      folderPath: plan.id,
      changeRequest,
    });
  }

  /**
   * Dispatches CreatePr job with gating checks.
   *
   * Every option is spread onto the job args under its own key, matching
   * `CreatePrArgs`. Omitting `options` keeps the promptware defaults (merge on,
   * delete branch on), which is what the bare call used to send.
   */
  public static async createPr(
    plan: PlanDetail | PlanSummary,
    options?: CreatePrOptions,
  ): Promise<StartJobResponse> {
    const check = this.canCreatePr(plan);
    if (!check.allowed) {
      throw new Error(check.reason || t("planActions.errors.createPrBlocked"));
    }

    return bridge.startJob({
      type: "CreatePr",
      folderPath: plan.id,
      ...options,
    });
  }

  /**
   * Dispatches a CreateIssue job from the plan.
   *
   * `fields.repo` is a **local repository path** — `CreateIssueArgs.repo` is the
   * working directory the promptware runs `gh` in, not an `owner/name` slug.
   */
  public static async createIssue(
    plan: PlanDetail | PlanSummary,
    fields: CreateIssueFields,
  ): Promise<StartJobResponse> {
    if (!fields.repo) {
      throw new Error(t("planActions.errors.repositoryRequired"));
    }

    return bridge.startJob({
      type: "CreateIssue",
      folderPath: plan.id,
      repo: fields.repo,
      ...(fields.assignee ? { assignee: fields.assignee } : {}),
      ...(fields.comment ? { comment: fields.comment } : {}),
      ...(fields.labels && fields.labels.length > 0 ? { labels: fields.labels } : {}),
      ...(fields.titleOverride ? { titleOverride: fields.titleOverride } : {}),
      ...(fields.bodyOverride ? { bodyOverride: fields.bodyOverride } : {}),
      ...(fields.issueSource ? { issueSource: fields.issueSource } : {}),
    });
  }

  /**
   * Dispatches ExpandPlan job.
   */
  public static async expandPlan(plan: PlanDetail | PlanSummary): Promise<StartJobResponse> {
    const check = this.canRefine(plan);
    if (!check.allowed) {
      throw new Error(check.reason || t("planActions.errors.refineBlocked"));
    }

    return bridge.startJob({
      type: "ExpandPlan",
      folderPath: plan.id,
    });
  }

  /**
   * Dispatches UpdatePlan job.
   */
  public static async updatePlan(
    plan: PlanDetail | PlanSummary,
    instructions: string,
  ): Promise<StartJobResponse> {
    const check = this.canRefine(plan);
    if (!check.allowed) {
      throw new Error(check.reason || t("planActions.errors.refineBlocked"));
    }

    return bridge.startJob({
      type: "UpdatePlan",
      folderPath: plan.id,
      instructions,
    });
  }

  /**
   * Dispatches SplitPlan job.
   */
  public static async splitPlan(plan: PlanDetail | PlanSummary): Promise<StartJobResponse> {
    const check = this.canRefine(plan);
    if (!check.allowed) {
      throw new Error(check.reason || t("planActions.errors.refineBlocked"));
    }

    return bridge.startJob({
      type: "SplitPlan",
      folderPath: plan.id,
    });
  }
}
