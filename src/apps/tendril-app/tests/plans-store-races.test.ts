import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { plansStore } from "../src/state/plansStore";
import { bridge } from "../src/api/bridge";
import { planDetail, planSummary } from "../tests/fixtures/plan.fixture";

/**
 * V1 reads plan content through `UseQuery` keyed on the plan's folder path
 * (`Apps/Plans/ContentView.cs`, `options: QueryScope.View`), and a query discards the result of a key
 * it is no longer on. Plain promises have no such key, so the store has to say so itself.
 */
describe("plansStore stale responses", () => {
  beforeEach(() => {
    plansStore.setPlans([]);
    plansStore.setSelectedPlan(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    plansStore.setPlans([]);
    plansStore.setSelectedPlan(null);
  });

  it("keeps the plan that was asked for last when an older detail fetch answers second", async () => {
    const slow = planDetail({ id: "00021", title: "Opened first" });
    const fast = planDetail({ id: "00022", title: "Opened second" });

    let releaseSlow: (value: typeof slow) => void = () => {};
    vi.spyOn(bridge, "getPlan").mockImplementation((id: string) => {
      if (id === "00021") {
        return new Promise((resolve) => {
          releaseSlow = resolve;
        });
      }
      return Promise.resolve(fast);
    });

    const first = plansStore.fetchPlanDetail("00021");
    const second = plansStore.fetchPlanDetail("00022");

    await second;
    expect(plansStore.getState().selectedPlan?.id).toBe("00022");

    releaseSlow(slow);
    await first;

    // The superseded answer is handed back to its own caller but never becomes the selection.
    expect(plansStore.getState().selectedPlan?.id).toBe("00022");
  });

  it("does not let a superseded rejection post an error over a plan that loaded fine", async () => {
    let rejectSlow: (reason: Error) => void = () => {};
    vi.spyOn(bridge, "getPlan").mockImplementation((id: string) => {
      if (id === "00021") {
        return new Promise((_resolve, reject) => {
          rejectSlow = reject;
        });
      }
      return Promise.resolve(planDetail({ id: "00022" }));
    });

    const first = plansStore.fetchPlanDetail("00021").catch(() => undefined);
    await plansStore.fetchPlanDetail("00022");

    rejectSlow(new Error("service unreachable"));
    await first;

    expect(plansStore.getState().error).toBeNull();
    expect(plansStore.getState().selectedPlan?.id).toBe("00022");
  });

  it("keeps the newest plan list when an older listPlans answers second", async () => {
    const stale = [planSummary({ id: "00001", title: "Stale" })];
    const fresh = [planSummary({ id: "00002", title: "Fresh" })];

    let releaseStale: (value: typeof stale) => void = () => {};
    let call = 0;
    vi.spyOn(bridge, "listPlans").mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return new Promise((resolve) => {
          releaseStale = resolve;
        });
      }
      return Promise.resolve(fresh);
    });

    const first = plansStore.fetchPlans();
    await plansStore.fetchPlans();

    releaseStale(stale);
    await first;

    expect(plansStore.getState().plans.map((p) => p.id)).toEqual(["00002"]);
  });
});
