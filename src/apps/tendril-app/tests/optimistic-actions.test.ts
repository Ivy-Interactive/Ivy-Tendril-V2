import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextAfterRemoval, plansStore } from "../src/state/plansStore";
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

/**
 * The half of "delete the plan" that is not the bridge call: the row has to leave the list on the
 * answer that confirmed it, not on the `listPlans` that follows.
 *
 * The delay the operator reads as "delete does not work" is entirely that round trip, and
 * `jobsStore.deleteJob` already solves it the same way for jobs — await the bridge, mutate locally,
 * notify, reconcile in the background.
 */
describe("plansStore removal", () => {
  const queue = [
    planSummary({ id: "00009", title: "Newest", state: "Draft" }),
    planSummary({ id: "00007", title: "Middle", state: "Draft" }),
    planSummary({ id: "00003", title: "Oldest", state: "Draft" }),
  ];

  beforeEach(() => {
    plansStore.setPlans(queue.map((plan) => ({ ...plan })));
    plansStore.setSelectedPlan(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    plansStore.setPlans([]);
    plansStore.setSelectedPlan(null);
  });

  it("drops the plan from the list as soon as the daemon confirms, without waiting for a refetch", async () => {
    vi.spyOn(bridge, "deletePlan").mockResolvedValue(undefined);
    // Never resolves, which is the point: the list must already be right without it.
    const listPlans = vi.spyOn(bridge, "listPlans").mockReturnValue(new Promise(() => {}));

    await plansStore.removePlanOptimistic("00007");

    expect(plansStore.getState().plans.map((p) => p.id)).toEqual(["00009", "00003"]);
    // Still reconciled in the background, as every one of V1's mutating actions ends with
    // `refreshPlans()` — it just is not what makes the row disappear.
    expect(listPlans).toHaveBeenCalled();
  });

  it("notifies subscribers once, on the removal itself", async () => {
    vi.spyOn(bridge, "deletePlan").mockResolvedValue(undefined);
    vi.spyOn(bridge, "listPlans").mockReturnValue(new Promise(() => {}));

    const seen: number[] = [];
    const unsubscribe = plansStore.subscribe(() => seen.push(plansStore.getState().plans.length));
    await plansStore.removePlanOptimistic("00007");
    unsubscribe();

    // The first notify a subscriber sees already has the shortened list; `fetchPlans`'s own
    // `isLoading` notify follows it.
    expect(seen[0]).toBe(2);
  });

  it("leaves the plan exactly where it was when the daemon refuses", async () => {
    vi.spyOn(bridge, "deletePlan").mockRejectedValue(new Error("a job still holds this plan"));
    const listPlans = vi.spyOn(bridge, "listPlans").mockResolvedValue([]);

    await expect(plansStore.removePlanOptimistic("00007")).rejects.toThrow(
      "a job still holds this plan",
    );

    // A plan that vanished from the list and then came back is a lie the operator may act on, which
    // is why this one applies nothing before the daemon has agreed.
    expect(plansStore.getState().plans.map((p) => p.id)).toEqual(["00009", "00007", "00003"]);
    expect(listPlans).not.toHaveBeenCalled();
    // And no `Rollback:` banner over the dialog, which is already showing the daemon's own message.
    expect(plansStore.getState().error).toBeNull();
  });

  it("forgets the detail of a plan it just deleted", async () => {
    plansStore.setSelectedPlan(planDetail({ id: "00007", title: "Middle" }));
    vi.spyOn(bridge, "deletePlan").mockResolvedValue(undefined);
    vi.spyOn(bridge, "listPlans").mockReturnValue(new Promise(() => {}));

    await plansStore.removePlanOptimistic("00007");

    // Leaving it would render a ghost, and would convince `App.tsx`'s plan-nav effect that the next
    // plan is already loaded.
    expect(plansStore.getState().selectedPlan).toBeNull();
    expect(plansStore.pendingDetailId).toBeNull();
  });

  /**
   * The subtle one. `fetchPlans` already discards an answer that a newer fetch has superseded, but a
   * removal is not a fetch — so before this, a `listPlans` issued *before* the delete could answer
   * after it and write the deleted row straight back.
   */
  it("is not undone by a list read that was already in flight", async () => {
    let answerStaleList: (plans: ReturnType<typeof planSummary>[]) => void = () => {};
    let call = 0;
    vi.spyOn(bridge, "listPlans").mockImplementation(() => {
      call += 1;
      // The first read is the one in flight across the delete; the reconcile that follows the
      // removal never answers, so only the stale one can move the state.
      if (call === 1) return new Promise((resolve) => (answerStaleList = resolve));
      return new Promise(() => {});
    });
    vi.spyOn(bridge, "deletePlan").mockResolvedValue(undefined);

    const inFlight = plansStore.fetchPlans().catch(() => undefined);
    await plansStore.removePlanOptimistic("00007");

    answerStaleList(queue.map((plan) => ({ ...plan })));
    await inFlight;

    expect(plansStore.getState().plans.map((p) => p.id)).toEqual(["00009", "00003"]);
  });

  /**
   * And the other half of it: a read issued *after* the delete is the newest read by every measure a
   * sequence number has, so nothing but the store's own memory of the delete can stop a daemon that
   * has not finished committing it from putting the row back.
   */
  it("is not undone by a list read that answers before the daemon has committed the delete", async () => {
    vi.spyOn(bridge, "deletePlan").mockResolvedValue(undefined);
    vi.spyOn(bridge, "listPlans").mockResolvedValue(queue.map((plan) => ({ ...plan })));

    await plansStore.removePlanOptimistic("00007");
    await plansStore.fetchPlans();

    expect(plansStore.getState().plans.map((p) => p.id)).toEqual(["00009", "00003"]);
  });

  it("lets the plan come back once the daemon's own list agrees it is gone", async () => {
    vi.spyOn(bridge, "deletePlan").mockResolvedValue(undefined);
    const listPlans = vi.spyOn(bridge, "listPlans");

    listPlans.mockResolvedValue(queue.filter((plan) => plan.id !== "00007").map((p) => ({ ...p })));
    await plansStore.removePlanOptimistic("00007");
    await plansStore.fetchPlans();

    // Nothing here outlives the disagreement it exists to settle, so a plan genuinely recreated
    // under the same id is listed again.
    listPlans.mockResolvedValue(queue.map((plan) => ({ ...plan })));
    await plansStore.fetchPlans();

    expect(plansStore.getState().plans.map((p) => p.id)).toEqual(["00009", "00007", "00003"]);
  });
});

/**
 * The same promise for a plan that moves rather than goes: every queue in the app is derived from
 * `state.plans` by state, so a list answer that still calls a completed plan `Review` puts it back
 * in the review queue and back in the shell's badge.
 */
describe("plansStore transitions", () => {
  const queue = [
    planSummary({ id: "00031", title: "Newest review", state: "Review" }),
    planSummary({ id: "00012", title: "Older review", state: "Review" }),
  ];

  beforeEach(() => {
    plansStore.setPlans(queue.map((plan) => ({ ...plan })));
    plansStore.setSelectedPlan(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    plansStore.setPlans([]);
    plansStore.setSelectedPlan(null);
  });

  it("patches the row as soon as the daemon confirms, without waiting for a refetch", async () => {
    vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);
    vi.spyOn(bridge, "listPlans").mockReturnValue(new Promise(() => {}));

    await plansStore.transitionPlanOptimistic("00031", "Completed");

    expect(plansStore.getState().plans.find((p) => p.id === "00031")?.state).toBe("Completed");
  });

  it("keeps the plan in its old state when the daemon refuses", async () => {
    vi.spyOn(bridge, "updatePlanField").mockRejectedValue(new Error("verifications are failing"));

    await expect(plansStore.transitionPlanOptimistic("00031", "Completed")).rejects.toThrow(
      "verifications are failing",
    );

    expect(plansStore.getState().plans.find((p) => p.id === "00031")?.state).toBe("Review");
  });

  it("is not undone by a list read that still reports the old state", async () => {
    vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);
    vi.spyOn(bridge, "listPlans").mockResolvedValue(queue.map((plan) => ({ ...plan })));

    await plansStore.transitionPlanOptimistic("00031", "Completed");
    await plansStore.fetchPlans();

    expect(plansStore.getState().plans.find((p) => p.id === "00031")?.state).toBe("Completed");
  });

  /**
   * Reset reaches the same place through its own route. `POST /plans/:id/reset` removes the plan's
   * worktrees in the same request, so it cannot go through `updatePlanField` — but it is a queue
   * departure like any other, and going around the store is what left a reset plan sitting in the
   * review queue, the sidebar list and the nav badge until a list read happened to disagree.
   */
  it("patches a reset plan to Draft as soon as the daemon confirms", async () => {
    vi.spyOn(bridge, "resetPlan").mockResolvedValue(undefined);
    vi.spyOn(bridge, "listPlans").mockReturnValue(new Promise(() => {}));

    await plansStore.resetPlanOptimistic("00031");

    expect(plansStore.getState().plans.find((p) => p.id === "00031")?.state).toBe("Draft");
  });

  it("keeps a reset plan in its old state when the daemon refuses", async () => {
    vi.spyOn(bridge, "resetPlan").mockRejectedValue(new Error("cancel the running job first"));

    await expect(plansStore.resetPlanOptimistic("00031")).rejects.toThrow(
      "cancel the running job first",
    );

    expect(plansStore.getState().plans.find((p) => p.id === "00031")?.state).toBe("Review");
  });

  it("does not let a stale list read put a reset plan back in the review queue", async () => {
    vi.spyOn(bridge, "resetPlan").mockResolvedValue(undefined);
    vi.spyOn(bridge, "listPlans").mockResolvedValue(queue.map((plan) => ({ ...plan })));

    await plansStore.resetPlanOptimistic("00031");
    await plansStore.fetchPlans();

    expect(plansStore.getState().plans.find((p) => p.id === "00031")?.state).toBe("Draft");
  });

  /**
   * A reset leaves no pre-action snapshot behind, because it is the one transition that is an
   * **arrival**.
   *
   * `plansBeforeChange` exists so `nextAfterRemoval` can still read a *departing* plan's index after
   * the row has moved, and its consumer reads it on the same tick. Nothing ever retires it —
   * `setPlans` is the only clearer and no production path calls it — so whatever the last transition
   * wrote survives indefinitely, and `listIncluding`'s guard prefers a snapshot whenever the recorded
   * state differs from the live one. A reset guarantees that difference (Review to Draft) while the
   * plan is now *in* the Plans queue with its index intact, so the stale list is served to whatever
   * the operator does next: pressing Update Plan on a just-reset plan measured a queue that still
   * recorded it as Review, concluded it was in no queue at all, and bounced to the Plans page instead
   * of opening the next draft.
   */
  it("leaves no stale snapshot for the next action after a reset", async () => {
    vi.spyOn(bridge, "resetPlan").mockResolvedValue(undefined);
    vi.spyOn(bridge, "listPlans").mockReturnValue(new Promise(() => {}));

    await plansStore.resetPlanOptimistic("00031");

    // The reset plan is a Draft now, and the live list is the list that says so. Answering with the
    // pre-reset one calls it `Review` again — one action out of date, exactly what the guard on
    // `listIncluding` is meant to refuse.
    expect(plansStore.listIncluding("00031").find((p) => p.id === "00031")?.state).toBe("Draft");
  });

  /**
   * And the snapshot a genuine departure needs is still taken. Completing 00031 takes it out of the
   * review queue, so the list that still holds its index is the only one an advance can measure.
   */
  it("still snapshots the queue a completed plan departed from", async () => {
    vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);
    vi.spyOn(bridge, "listPlans").mockReturnValue(new Promise(() => {}));

    await plansStore.transitionPlanOptimistic("00031", "Completed");

    expect(plansStore.listIncluding("00031").find((p) => p.id === "00031")?.state).toBe("Review");
  });

  /**
   * Thaw is the other arrival, and reaches this through `transitionPlanOptimistic` rather than
   * `resetPlanOptimistic`, so the rule has to live in what they share. `IceboxView.thaw` writes
   * `Draft` on a plan that was in no queue and is now in the Plans one.
   */
  it("leaves no stale snapshot when a thawed plan joins the plans queue", async () => {
    plansStore.setPlans([
      planSummary({ id: "00031", title: "Frozen", state: "Icebox" }),
      planSummary({ id: "00012", title: "Older review", state: "Review" }),
    ]);
    vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);
    vi.spyOn(bridge, "listPlans").mockReturnValue(new Promise(() => {}));

    await plansStore.transitionPlanOptimistic("00031", "Draft");

    expect(plansStore.listIncluding("00031").find((p) => p.id === "00031")?.state).toBe("Draft");
  });
});

/**
 * `PlanSelectionHelper.ResolveSelection`'s keep-the-index rule, in the one shared spelling every
 * primary CTA now advances through.
 */
describe("nextAfterRemoval", () => {
  const queue = [
    planSummary({ id: "00009" }),
    planSummary({ id: "00007" }),
    planSummary({ id: "00003" }),
  ];

  it("opens whatever now sits at the departing plan's index", () => {
    expect(nextAfterRemoval(queue, "00007")?.id).toBe("00003");
  });

  it("clamps to the end when the last plan in the queue leaves", () => {
    expect(nextAfterRemoval(queue, "00003")?.id).toBe("00007");
  });

  it("opens the newest plan when the first one leaves, which is also its index", () => {
    expect(nextAfterRemoval(queue, "00009")?.id).toBe("00007");
  });

  it("selects nothing at all once the queue is empty", () => {
    expect(nextAfterRemoval([planSummary({ id: "00009" })], "00009")).toBeNull();
    expect(nextAfterRemoval([], "00009")).toBeNull();
  });

  // The same three spellings `resolvePlanSelection` accepts, since the id reaches this from args, a
  // row and a link alike.
  it("matches the departing plan by bare number or folder name", () => {
    expect(nextAfterRemoval(queue, "7")?.id).toBe("00003");
    expect(nextAfterRemoval(queue, "00007-SomePlan")?.id).toBe("00003");
  });

  it("falls back to the newest plan for an id the queue never held", () => {
    expect(nextAfterRemoval(queue, "00404")?.id).toBe("00009");
  });
});
