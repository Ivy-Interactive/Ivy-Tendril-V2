import { describe, it, expect } from "vitest";
import { PlanActionsController } from "../src/controllers/planActions";
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
      expect(PlanActionsController.canRetry({ ...basePlan, state: "Completed" }).allowed).toBe(
        false,
      );
    });

    it("allows Expand/Update/SplitPlan only on Draft state", () => {
      expect(PlanActionsController.canRefine({ ...basePlan, state: "Draft" }).allowed).toBe(true);
      expect(PlanActionsController.canRefine({ ...basePlan, state: "Executing" }).allowed).toBe(
        false,
      );
      expect(PlanActionsController.canRefine({ ...basePlan, state: "Review" }).allowed).toBe(false);
    });
  });

  describe("Inbox Navigation & Tab Lifecycle", () => {
    /* Updated for V1's strip (`TendrilAppShell.BuildStripTabs` / `AppShellRouter` rule 4): navigating
       a page creates no tab, and a plan is a page. This test previously asserted the opposite - that
       `setActiveNav` accumulates a tab per nav, and that a plan opens one - which is exactly what made
       every screen pile up in the session strip. The lifecycle it checks is now the real one: a
       session pane is the only thing that becomes a tab, and closing the last one reveals the page. */
    it("navigates the inbox without creating a tab, and keeps the session tab lifecycle", () => {
      uiStore.setActiveNav("inbox");
      expect(uiStore.getState().activeNav).toBe("inbox");
      expect(uiStore.getState().sessionTabs).toEqual([]);

      // A plan is a page too, so it does not open a tab either.
      uiStore.navigate({ appId: "plan-00042", args: { planId: "00042" } });
      expect(uiStore.getState().sessionTabs).toEqual([]);
      expect(uiStore.getState().pageArgs).toEqual({ planId: "00042" });

      // A review action is an `allowDuplicateTabs` app, so it is a session pane.
      uiStore.setActiveNav("inbox");
      uiStore.navigate({ appId: "review-action", args: { sessionId: "ra:00042" } });
      expect(uiStore.getState().sessionTabs.map((tab) => tab.id)).toEqual(["ra:00042"]);
      expect(uiStore.getState().activeNav).toBe("ra:00042");

      uiStore.closeTab("ra:00042");
      expect(uiStore.getState().sessionTabs).toEqual([]);
      expect(uiStore.getState().activeNav).toBe("inbox");
    });
  });
});
