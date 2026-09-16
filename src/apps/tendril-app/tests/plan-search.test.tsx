import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { App } from "../src/App";
import { bridge } from "../src/api/bridge";
import { chatApi } from "../src/api/chatApi";
import { navigation } from "../src/state/navigation";
import { plansStore } from "../src/state/plansStore";
import { sidebarListStore, DEFAULT_SEARCH_LABEL } from "../src/state/sidebarListStore";
import { planSummary, planDetail } from "./fixtures/plan.fixture";
import type { PlanQuery, PlanSummary } from "../src/types/api";

/**
 * The shell half of V1's `AppShell/Dialogs/PlanSearchDialog.cs`: the sidebar section's search icon
 * (and its `Cmd/Ctrl+K`) opens the plan search for every list that supplies no `onSearch`, which is
 * every plan list.
 *
 * This is the regression the dialog closes, end to end. The sidebar lists follow V1 and hold only a
 * slice of the plans - Plans lists Draft and Blocked, Review lists Review and Failed, Icebox lists
 * Icebox - so a `Completed` or `Skipped` plan is in none of them. Before the dialog the section's
 * search navigated to Plans, which meant those plans were reachable from nowhere in the UI.
 */

/** In the Plans list, and so reachable without the dialog. */
const draft = planSummary({ id: "00074", title: "Draft the shell frame", state: "Draft" });
/** In no list at all. These two are the whole reason the dialog exists. */
const completed = planSummary({ id: "00092", title: "Ship the tunnel bridge", state: "Completed" });
const skipped = planSummary({ id: "00093", title: "Ship the icon pipeline", state: "Skipped" });

describe("shell plan search", () => {
  /** Every `?q=` the shell asked the daemon for. */
  let queries: (PlanQuery | undefined)[] = [];

  beforeEach(() => {
    queries = [];
    navigation.resetForTesting();
    sidebarListStore.resetForTesting();
    plansStore.setPlans([]);

    vi.spyOn(bridge, "listPlans").mockImplementation(async (query?: PlanQuery) => {
      queries.push(query);
      const results: PlanSummary[] = query?.q ? [completed, skipped] : [draft];
      return results;
    });
    vi.spyOn(bridge, "getPlan").mockResolvedValue(
      planDetail({ id: completed.id, title: completed.title, state: "Completed" }),
    );
    vi.spyOn(bridge, "listJobs").mockResolvedValue([]);
    vi.spyOn(bridge, "listProjects").mockResolvedValue([]);
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
  });

  afterEach(() => {
    // `App` is a real mount with store subscriptions and a job poll, and the stores are module
    // singletons shared with every other file in this worker.
    cleanup();
    vi.restoreAllMocks();
    navigation.resetForTesting();
    sidebarListStore.resetForTesting();
  });

  const mount = async () => {
    render(<App />);
    // The sidebar's plan list is what the search has to reach past, so wait for it to arrive.
    await screen.findByText(draft.title);
  };

  it("finds a Completed and a Skipped plan the sidebar cannot reach, and opens the one that is picked", async () => {
    await mount();

    // Neither plan is anywhere in the shell: not in the sidebar list, not on the page.
    expect(screen.queryByText(completed.title)).not.toBeInTheDocument();
    expect(screen.queryByText(skipped.title)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(DEFAULT_SEARCH_LABEL));

    const input = await screen.findByTestId("plan-search-input");
    fireEvent.change(input, { target: { value: "ship" } });

    expect(await screen.findByText(completed.title)).toBeInTheDocument();
    expect(screen.getByText(skipped.title)).toBeInTheDocument();

    // The search must not inherit a state filter: with one, these are exactly the plans it would
    // filter out, and the dialog would have nothing to add over the sidebar.
    const searches = queries.filter((query) => query?.q);
    expect(searches.length).toBeGreaterThan(0);
    for (const query of searches) {
      expect(query).toEqual({ q: "ship" });
    }

    fireEvent.click(screen.getByRole("button", { name: new RegExp(completed.title) }));

    // A pick is the same navigation a sidebar row click is: the plan's own page, with the plan id in
    // the address as `PlansAppArgs` rather than smuggled in through the nav id.
    await waitFor(() => expect(window.location.pathname).toBe(`/plan-${completed.id}`));
    expect(new URLSearchParams(window.location.search).get("planId")).toBe(completed.id);
    expect(screen.queryByTestId("plan-search-dialog")).not.toBeInTheDocument();
  });

  it("opens on Ctrl+K instead of navigating to Plans", async () => {
    await mount();

    // V1 binds Cmd/Ctrl+K to the sidebar section's search. It used to navigate to the Plans page
    // here, which is the list that cannot show most of a user's plans.
    // Dispatched on an element rather than `window`: the section's own Cmd+K listener asks the
    // event's target whether it is an editable node, which `window` cannot answer.
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });

    expect(await screen.findByTestId("plan-search-dialog")).toBeInTheDocument();
    expect(window.location.pathname).not.toBe("/plans");
  });
});
