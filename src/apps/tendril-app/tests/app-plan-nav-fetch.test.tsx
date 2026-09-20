import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, cleanup, screen } from "@testing-library/react";
import { App } from "../src/App";
import { bridge } from "../src/api/bridge";
import { chatApi } from "../src/api/chatApi";
import { plansStore } from "../src/state/plansStore";
import { uiStore } from "../src/state/uiStore";
import { planDetail } from "./fixtures/plan.fixture";

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
