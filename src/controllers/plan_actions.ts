import { bridge } from "../api/bridge";
import type { PlanDetail, PlanSummary, StartJobResponse } from "../types/api";

export interface ActionGatingResult {
  allowed: boolean;
  reason?: string;
}

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
      return { allowed: false, reason: "Plan is already completed." };
    }
    if (plan.state === "Executing") {
      return { allowed: false, reason: "Plan is currently executing." };
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
              reason: `Blocked by dependency '${dep}' which is in state '${match.state}' (requires Completed).`,
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
   * - Must be in Review state
   * - All required verifications must have Pass status (none Fail or Pending)
   */
  public static canCreatePr(plan: PlanDetail | PlanSummary): ActionGatingResult {
    if (plan.state !== "Review") {
      return {
        allowed: false,
        reason: `Create PR is only allowed when plan is in Review (current: ${plan.state}).`,
      };
    }

    const verifications = plan.verifications || [];
    const failingVerifications = verifications.filter((v) => v.status === "Fail");
    if (failingVerifications.length > 0) {
      return {
        allowed: false,
        reason: `Cannot create PR: verifications failed (${failingVerifications.map((v) => v.name).join(", ")}).`,
      };
    }

    const pendingVerifications = verifications.filter((v) => v.status === "Pending");
    if (pendingVerifications.length > 0) {
      return {
        allowed: false,
        reason: `Cannot create PR: verifications still pending (${pendingVerifications.map((v) => v.name).join(", ")}).`,
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
      reason: `Retry is only allowed on plans in Review or Failed state (current: ${plan.state}).`,
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
      reason: `Plan refinement (Expand/Update/Split) is only allowed on Draft plans (current: ${plan.state}).`,
    };
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
      throw new Error(check.reason || "Execution blocked");
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
      throw new Error(check.reason || "Retry blocked");
    }

    return bridge.startJob({
      type: "RetryPlan",
      folderPath: plan.id,
      changeRequest,
    });
  }

  /**
   * Dispatches CreatePr job with gating checks.
   */
  public static async createPr(plan: PlanDetail | PlanSummary): Promise<StartJobResponse> {
    const check = this.canCreatePr(plan);
    if (!check.allowed) {
      throw new Error(check.reason || "Create PR blocked");
    }

    return bridge.startJob({
      type: "CreatePr",
      folderPath: plan.id,
    });
  }

  /**
   * Dispatches ExpandPlan job.
   */
  public static async expandPlan(plan: PlanDetail | PlanSummary): Promise<StartJobResponse> {
    const check = this.canRefine(plan);
    if (!check.allowed) {
      throw new Error(check.reason || "Refine blocked");
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
      throw new Error(check.reason || "Refine blocked");
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
      throw new Error(check.reason || "Refine blocked");
    }

    return bridge.startJob({
      type: "SplitPlan",
      folderPath: plan.id,
    });
  }
}
