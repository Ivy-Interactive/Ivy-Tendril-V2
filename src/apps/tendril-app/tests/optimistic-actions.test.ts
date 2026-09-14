import { describe, it, expect, vi, beforeEach } from "vitest";
import { plansStore } from "../src/state/plansStore";
import { bridge } from "../src/api/bridge";
import { planDetail, planSummary } from "./fixtures/plan.fixture";

describe("Optimistic Actions & Error Rollback", () => {
  const initialPlan = planSummary({
    id: "00099",
    title: "Initial Title",
    state: "Draft",
    project: "DemoProject",
    level: "Feature",
    verifications: [{ name: "RustBuild", status: "Pending" }],
  });

  beforeEach(() => {
    plansStore.setPlans([initialPlan]);
    plansStore.setSelectedPlan(
      planDetail({
        ...initialPlan,
        repos: [],
        dependsOn: [],
        relatedPlans: [],
        commits: [],
        prs: [],
      }),
    );
  });

  it("optimistically updates a plan field and keeps changes on bridge success", async () => {
    const updatePlanFieldSpy = vi.spyOn(bridge, "updatePlanField").mockResolvedValueOnce(undefined);

    await plansStore.updateFieldOptimistic("00099", "title", "Brand New Title");

    const state = plansStore.getState();
    expect(state.plans[0].title).toBe("Brand New Title");
    expect(state.selectedPlan?.title).toBe("Brand New Title");
    expect(updatePlanFieldSpy).toHaveBeenCalledWith("00099", "title", "Brand New Title", undefined);
  });

  it("rolls back optimistic plan field update when bridge fails", async () => {
    vi.spyOn(bridge, "updatePlanField").mockRejectedValueOnce(new Error("Network disconnect"));

    await expect(
      plansStore.updateFieldOptimistic("00099", "title", "Failed Title"),
    ).rejects.toThrow("Network disconnect");

    // State should be rolled back to initial title
    const state = plansStore.getState();
    expect(state.plans[0].title).toBe("Initial Title");
    expect(state.selectedPlan?.title).toBe("Initial Title");
    expect(state.error).toContain("Rollback");
  });

  it("optimistically updates verification status and rolls back on failure", async () => {
    // 1. Successful verification change
    const setVerificationStatusSpy = vi
      .spyOn(bridge, "setVerificationStatus")
      .mockResolvedValueOnce(undefined);
    await plansStore.updateVerificationOptimistic("00099", "RustBuild", "Pass");

    let state = plansStore.getState();
    expect(state.plans[0].verifications[0].status).toBe("Pass");
    expect(setVerificationStatusSpy).toHaveBeenCalledWith("00099", "RustBuild", "Pass");

    // 2. Failed verification change -> rollback
    vi.spyOn(bridge, "setVerificationStatus").mockRejectedValueOnce(
      new Error("Conflict on server"),
    );

    await expect(
      plansStore.updateVerificationOptimistic("00099", "RustBuild", "Fail"),
    ).rejects.toThrow("Conflict on server");

    state = plansStore.getState();
    // Rollback to "Pass"
    expect(state.plans[0].verifications[0].status).toBe("Pass");
  });
});
