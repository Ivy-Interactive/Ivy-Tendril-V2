import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, cleanup, screen, fireEvent, within } from "@testing-library/react";
import { App } from "../src/App";
import { bridge } from "../src/api/bridge";
import { chatApi } from "../src/api/chatApi";
import { plansStore } from "../src/state/plansStore";
import { sidebarListStore } from "../src/state/sidebarListStore";
import { uiStore } from "../src/state/uiStore";
import { planDetail, planSummary } from "./fixtures/plan.fixture";

/**
 * The plan page's own fetch.
 *
 * `handleSelectPlan` fetches because a click knows which plan it opened, but a `plan-<id>` nav is
 * also *adopted*: the shell starts navigation on the persisted `lastPageNav`, and back/forward
 * replays an address the same way. Neither has a click behind it, so before this effect existed a
 * reload onto a plan page sat on "Loading plan <id>..." forever - indistinguishable from a plan with
 * no content. V1 cannot have the bug, because its page reads the plan through a `UseQuery` keyed on
 * the folder and a new key always fetches.
 */
describe("App plan-nav detail fetch", () => {
  beforeEach(() => {
    vi.spyOn(bridge, "listPlans").mockResolvedValue([]);
    vi.spyOn(bridge, "listJobs").mockResolvedValue([]);
    vi.spyOn(bridge, "listProjects").mockResolvedValue([]);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
    plansStore.setSelectedPlan(null);
    uiStore.setActiveNav("dashboard");
  });

  afterEach(() => {
    // `App` is a real mount holding store subscriptions and a 5s poll, and the stores are module
    // singletons shared with the rest of the worker, so it has to come down before the spies do.
    cleanup();
    plansStore.setSelectedPlan(null);
    uiStore.setActiveNav("dashboard");
    vi.restoreAllMocks();
  });

  it("fetches the plan a nav adopts without a click", async () => {
    const detail = planDetail({ id: "00004", title: "Adopted On Reload" });
    const getPlan = vi.spyOn(bridge, "getPlan").mockResolvedValue(detail);

    await act(async () => {
      render(<App />);
    });

    // The state a reload lands in: the address names a plan, and nothing has fetched it.
    await act(async () => {
      uiStore.setActiveNav("plan-00004");
    });

    await waitFor(() => expect(getPlan).toHaveBeenCalledWith("00004"));
    await waitFor(() => expect(plansStore.getState().selectedPlan?.id).toBe("00004"));
  });

  it("does not re-fetch a plan the store already holds", async () => {
    const detail = planDetail({ id: "00004" });
    plansStore.setSelectedPlan(detail);
    const getPlan = vi.spyOn(bridge, "getPlan").mockResolvedValue(detail);

    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      uiStore.setActiveNav("plan-00004");
    });

    // A click already left the detail in the store; fetching again would be a second round trip for
    // a page that can already render.
    expect(getPlan).not.toHaveBeenCalled();
  });

  it("says the plan could not be loaded rather than loading forever", async () => {
    vi.spyOn(bridge, "getPlan").mockRejectedValue(new Error("daemon unreachable"));

    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      uiStore.setActiveNav("plan-00009");
    });

    const banner = await screen.findByTestId("plan-load-error");
    expect(banner).toHaveTextContent(/could not load plan 00009/i);
    expect(banner).toHaveTextContent(/daemon unreachable/i);
    expect(screen.queryByText(/loading plan 00009/i)).not.toBeInTheDocument();
  });
});

/**
 * Where a CTA leaves the operator when the plan it acted on was in **no** queue.
 *
 * `advancePastPlan` answers "what now?" with the plan at the departing one's index in its own queue,
 * which assumes the plan was in that queue. Not every plan a CTA reaches is: a Completed or Skipped
 * plan is in neither list, and a plan a Queued or Blocked job holds is filtered out of both by
 * `heldPlanIds` — yet both are reachable from a `plan-<id>` page, where Delete is offered whatever the
 * state. `nextAfterRemoval` answers an index it never held with the newest plan in the queue, which
 * is `resolvePlanSelection`'s third branch: right for a page resolving its own arrival selection, and
 * wrong here, where it drops the operator on an unrelated plan they never asked to see — the
 * bounce-to-newest the keep-the-index rule exists to stop.
 */
describe("a CTA on a plan that is in no queue", () => {
  const drafts = [
    planSummary({ id: "00031", title: "Newest draft", state: "Draft" }),
    planSummary({ id: "00012", title: "Older draft", state: "Draft" }),
  ];

  beforeEach(() => {
    plansStore.setPlans([]);
  });

  afterEach(() => {
    plansStore.setPlans([]);
  });

  it("lands on the queue rather than an unrelated plan when a Completed plan is deleted", async () => {
    const completed = planSummary({ id: "00040", title: "Shipped", state: "Completed" });
    vi.spyOn(bridge, "listPlans").mockResolvedValue([...drafts, completed]);
    vi.spyOn(bridge, "getPlan").mockResolvedValue(
      planDetail({ id: "00040", title: "Shipped", state: "Completed" }),
    );
    vi.spyOn(bridge, "deletePlan").mockResolvedValue(undefined);
    vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([]);
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([]);
    vi.spyOn(bridge, "listAnnotations").mockResolvedValue([]);
    vi.spyOn(bridge, "getRepoStatus").mockResolvedValue([]);

    await act(async () => {
      render(<App />);
    });
    await act(async () => {
      uiStore.setActiveNav("plan-00040");
    });
    await waitFor(() => expect(plansStore.getState().selectedPlan?.id).toBe("00040"));

    fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete Plan/ }));
    const dialog = await screen.findByTestId("delete-plan-dialog");
    fireEvent.click(within(dialog).getByTestId("dialog-confirm"));

    // The Plans queue is `[00031, 00012]` and the deleted plan is in neither queue, so there is no
    // index to keep and no successor to open. Opening 00031 — the newest draft, which the operator
    // never asked for and did not act on — is the bug.
    await waitFor(() => expect(uiStore.getState().activeNav).toBe("plans"));
    expect(uiStore.getState().activeNav).not.toBe("plan-00031");
  });
});

/**
 * Reset to Draft on a plan's own page: the page stays put, and the sidebar still lets go.
 *
 * Reset is the one CTA on this page that deliberately does *not* advance — `ReviewView` states the
 * rule from the other side ("Draft is off this queue... On `plan-<id>` there is no queue to leave and
 * the page stays put"), and an operator who asked to start a plan over should be looking at it.
 *
 * Staying put was implemented as doing nothing but re-reading the detail, and that is the defect. The
 * plan has still left the Review queue, and on a `plan-<id>` page the Review list is a frozen
 * retained snapshot (`sidebarListStore.retainFor`) whose publisher unmounted on the navigation in.
 * `sidebarListStore.removeItem` is the only thing that can drop a row from it, and its one caller
 * app-wide is `advanceWithinQueue` — which reset never reaches. So the row stayed: a Review sidebar
 * listing a plan that is no longer in review, a badge counting one fewer than the rows under it, and
 * a click landing on an unrelated plan through `resolvePlanSelection`'s bounce-to-newest.
 */
describe("Reset to Draft from a plan's own page", () => {
  const reviewQueue = [
    planSummary({ id: "00030", title: "Newest review", state: "Review" }),
    planSummary({ id: "00021", title: "The one being reset", state: "Review" }),
    planSummary({ id: "00010", title: "Older review", state: "Review" }),
  ];

  /** The Review list as `ReviewView` published it before the navigation to `plan-00021`. */
  const publishReviewList = () =>
    sidebarListStore.publish({
      appId: "review",
      title: "Review",
      items: reviewQueue.map((plan) => ({ id: plan.id, title: plan.title, tag: `#${plan.id}` })),
      selectedId: "00021",
      buildSelectArgs: (id) => ({ planId: id }),
    });

  beforeEach(() => {
    plansStore.setPlans(reviewQueue.map((plan) => ({ ...plan })));
    vi.spyOn(bridge, "listPlans").mockResolvedValue(reviewQueue.map((plan) => ({ ...plan })));
    vi.spyOn(bridge, "listJobs").mockResolvedValue([]);
    vi.spyOn(bridge, "listProjects").mockResolvedValue([]);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
    vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([]);
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "listPullRequests").mockResolvedValue([]);
    vi.spyOn(bridge, "listAnnotations").mockResolvedValue([]);
    vi.spyOn(bridge, "getRepoStatus").mockResolvedValue([]);
    vi.spyOn(bridge, "getPlan").mockResolvedValue(
      planDetail({ id: "00021", title: "The one being reset", state: "Review" }),
    );
    vi.spyOn(bridge, "resetPlan").mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    sidebarListStore.resetForTesting();
    // Not `setPlans([])`: the plan-nav effect also skips its fetch while the store is still asking
    // for that id, and `detailRequestId` is exactly the kind of private bookkeeping `setPlans` is
    // right not to touch. Every test here navigates to the same plan, so the previous one's fetch
    // would make the next one's navigation a no-op.
    plansStore.resetForTesting();
    uiStore.setActiveNav("dashboard");
    vi.restoreAllMocks();
  });

  /** Opens `plan-00021` with the Review list retained behind it, then resets it to Draft. */
  const resetFromPlanPage = async () => {
    await act(async () => {
      render(<App />);
    });
    publishReviewList();
    await act(async () => {
      uiStore.setActiveNav("plan-00021");
    });
    await waitFor(() => expect(plansStore.getState().selectedPlan?.id).toBe("00021"));

    fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Reset to Draft/ }));
    const dialog = await screen.findByTestId("reset-to-draft-dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("dialog-confirm"));
    });
  };

  it("drops the reset plan's row from the retained review sidebar", async () => {
    await resetFromPlanPage();

    // 00021 is a Draft now, so a Review list has no row for it — and nothing else will ever take
    // that row away: the list is frozen and its publisher is three navigations gone.
    await waitFor(() =>
      expect(sidebarListStore.getState()?.items.map((item) => item.id)).toEqual(["00030", "00010"]),
    );
  });

  it("stays on the plan it just reset rather than advancing past it", async () => {
    await resetFromPlanPage();

    // The other half of the rule, and the reason this cannot simply call `advancePastPlan`: the
    // operator asked to start this plan over, so the page it is on is the page they want.
    expect(uiStore.getState().activeNav).toBe("plan-00021");
    await waitFor(() => expect(plansStore.getState().plans[1]?.state).toBe("Draft"));
  });

  it("keeps the row when the retained list is the plans queue, which a reset joins", async () => {
    // Reset is offered on Blocked too (`PlanActionsController.canReset`), and Blocked and Draft are
    // both Plans-queue states — so that plan keeps its row, and dropping it would be this same defect
    // pointed the other way.
    const blocked = planSummary({ id: "00021", title: "Waiting on a dep", state: "Blocked" });
    plansStore.setPlans([blocked]);
    vi.spyOn(bridge, "getPlan").mockResolvedValue(
      planDetail({ id: "00021", title: "Waiting on a dep", state: "Blocked" }),
    );

    await act(async () => {
      render(<App />);
    });
    sidebarListStore.publish({
      appId: "plans",
      title: "Plans",
      items: [{ id: "00021", title: "Waiting on a dep", tag: "#00021" }],
      selectedId: "00021",
      buildSelectArgs: (id) => ({ planId: id }),
    });
    await act(async () => {
      uiStore.setActiveNav("plan-00021");
    });
    await waitFor(() => expect(plansStore.getState().selectedPlan?.id).toBe("00021"));

    fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Reset to Draft/ }));
    const dialog = await screen.findByTestId("reset-to-draft-dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("dialog-confirm"));
    });

    expect(sidebarListStore.getState()?.items.map((item) => item.id)).toEqual(["00021"]);
  });
});
