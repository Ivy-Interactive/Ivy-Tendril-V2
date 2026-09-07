import { describe, it, expect } from "vitest";
import { PlanActionsController } from "../src/controllers/plan_actions";
import { uiStore } from "../src/state/uiStore";
import type { PlanDetail, PlanSummary } from "../src/types/api";
import { planDetail } from "./fixtures/plan.fixture";

describe("Plan State Transitions & Action Gating Rules", () => {
  const basePlan = planDetail({
    title: "Test Plan",
    state: "Draft",
    repos: ["/repo"],
    verifications: [
      { name: "RustClippy", status: "Pass" },
      { name: "RustBuild", status: "Pass" },
      { name: "RustTest", status: "Pass" },
      { name: "CheckResult", status: "Pass" },
    ],
    dependsOn: ["00022-BootstrapApp"],
    relatedPlans: [],
    commits: [],
    prs: [],
  });

  describe("ExecutePlan Gating", () => {
    it("blocks ExecutePlan if a dependency plan is not Completed", () => {
      const depPlans: PlanSummary[] = [
        {
          id: "00022",
          title: "Bootstrap App",
          state: "Executing", // Not Completed!
          project: "Tendril-App",
          level: "Feature",
          verifications: [],
        },
      ];

      const result = PlanActionsController.canExecute(basePlan, depPlans);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Blocked by dependency '00022-BootstrapApp'");
      expect(result.reason).toContain("requires Completed");
    });

    it("allows ExecutePlan when all dependencies are Completed", () => {
      const depPlans: PlanSummary[] = [
        {
          id: "00022",
          title: "Bootstrap App",
          state: "Completed",
          project: "Tendril-App",
          level: "Feature",
          verifications: [],
        },
      ];

      const result = PlanActionsController.canExecute(basePlan, depPlans);
      expect(result.allowed).toBe(true);
    });

    it("blocks ExecutePlan if plan is already Completed", () => {
      const completedPlan = { ...basePlan, state: "Completed" as const };
      const result = PlanActionsController.canExecute(completedPlan);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("already completed");
    });
  });

  describe("CreatePr Gating", () => {
    it("blocks CreatePr if plan is not in Review state", () => {
      const draftPlan = { ...basePlan, state: "Draft" as const };
      const result = PlanActionsController.canCreatePr(draftPlan);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("only allowed when plan is in Review");
    });

    it("blocks CreatePr if any verification has status Fail", () => {
      const reviewPlan: PlanDetail = {
        ...basePlan,
        state: "Review",
        verifications: [
          { name: "RustBuild", status: "Pass" },
          { name: "RustTest", status: "Fail" },
        ],
      };
      const result = PlanActionsController.canCreatePr(reviewPlan);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("verifications failed");
      expect(result.reason).toContain("RustTest");
    });

    it("blocks CreatePr if any verification is still Pending", () => {
      const reviewPlan: PlanDetail = {
        ...basePlan,
        state: "Review",
        verifications: [
          { name: "RustBuild", status: "Pass" },
          { name: "RustTest", status: "Pending" },
        ],
      };
      const result = PlanActionsController.canCreatePr(reviewPlan);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("verifications still pending");
    });

    it("allows CreatePr when plan is in Review and all verifications Pass", () => {
      const reviewPlan: PlanDetail = {
        ...basePlan,
        state: "Review",
        verifications: [
          { name: "RustBuild", status: "Pass" },
          { name: "RustTest", status: "Pass" },
          { name: "RustClippy", status: "Pass" },
          { name: "CheckResult", status: "Pass" },
        ],
      };
      const result = PlanActionsController.canCreatePr(reviewPlan);
      expect(result.allowed).toBe(true);
    });
  });

  describe("RetryPlan & Refine Gating", () => {
    it("allows RetryPlan on Review or Failed states", () => {
      expect(PlanActionsController.canRetry({ ...basePlan, state: "Review" }).allowed).toBe(true);
      expect(PlanActionsController.canRetry({ ...basePlan, state: "Failed" }).allowed).toBe(true);
      expect(PlanActionsController.canRetry({ ...basePlan, state: "Draft" }).allowed).toBe(false);
      expect(PlanActionsController.canRetry({ ...basePlan, state: "Completed" }).allowed).toBe(false);
    });

    it("allows Expand/Update/SplitPlan only on Draft state", () => {
      expect(PlanActionsController.canRefine({ ...basePlan, state: "Draft" }).allowed).toBe(true);
      expect(PlanActionsController.canRefine({ ...basePlan, state: "Executing" }).allowed).toBe(false);
      expect(PlanActionsController.canRefine({ ...basePlan, state: "Review" }).allowed).toBe(false);
    });
  });

  describe("Inbox Navigation & Tab Lifecycle", () => {
    it("activates inbox and maintains tab lifecycle in uiStore", () => {
      uiStore.setActiveNav("inbox");
      expect(uiStore.getState().activeNav).toBe("inbox");
      expect(uiStore.getState().activeTabIds).toContain("inbox");

      uiStore.openTab("plan-00042");
      expect(uiStore.getState().activeTabIds).toContain("plan-00042");

      uiStore.closeTab("plan-00042");
      expect(uiStore.getState().activeTabIds).not.toContain("plan-00042");
      expect(uiStore.getState().activeNav).toBe("inbox");
    });
  });
});
