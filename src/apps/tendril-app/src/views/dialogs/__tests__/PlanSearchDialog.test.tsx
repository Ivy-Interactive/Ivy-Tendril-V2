import { describe, it, expect, vi, afterEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import {
  MAX_PLAN_SEARCH_RESULTS,
  PlanSearchDialog,
  planSearchRowBadges,
} from "../PlanSearchDialog";
import { bridge } from "../../../api/bridge";
import { planSummary } from "../../../../tests/fixtures/plan.fixture";
import type { PlanSummary } from "../../../types/api";

/**
 * V1 `AppShell/Dialogs/PlanSearchDialog.cs`.
 *
 * The dialog exists because the sidebar lists follow V1 and hold only a slice of the plans (Plans:
 * Draft and Blocked; Review: Review and Failed; Icebox: Icebox). Everything here that looks like a
 * detail - which badges a row gets, how many rows there are, what an empty box shows - is V1's; the
 * one thing that is load-bearing for the regression is that the search carries no state filter.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const open = (search: (q: string) => Promise<PlanSummary[]>, onSelectPlan = vi.fn()) => {
  const onClose = vi.fn();
  render(<PlanSearchDialog isOpen onClose={onClose} onSelectPlan={onSelectPlan} search={search} />);
  return { onClose, onSelectPlan };
};

const type = (text: string) =>
  fireEvent.change(screen.getByTestId("plan-search-input"), { target: { value: text } });

describe("PlanSearchDialog", () => {
  it("reaches the states no sidebar list holds, and asks the daemon for them without a status filter", async () => {
    // The regression this dialog closes: these five states are in no list, so a search that
    // inherited a state filter would leave them unreachable from anywhere in the UI.
    const listPlans = vi
      .spyOn(bridge, "listPlans")
      .mockResolvedValue([
        planSummary({ id: "00092", title: "Ship the tunnel bridge", state: "Completed" }),
        planSummary({ id: "00093", title: "Ship the icon pipeline", state: "Skipped" }),
        planSummary({ id: "00094", title: "Ship the shell frame", state: "Executing" }),
      ]);

    // No `search` prop: this is the real default path, `bridge.listPlans({ q })`.
    render(<PlanSearchDialog isOpen onClose={vi.fn()} onSelectPlan={vi.fn()} />);
    type("ship");

    expect(await screen.findByText("Ship the tunnel bridge")).toBeInTheDocument();
    expect(screen.getByText("Ship the icon pipeline")).toBeInTheDocument();
    expect(screen.getByText("Ship the shell frame")).toBeInTheDocument();

    expect(listPlans).toHaveBeenCalledWith({ q: "ship" });
    for (const [query] of listPlans.mock.calls) {
      expect(query).not.toHaveProperty("status");
      expect(query).not.toHaveProperty("state");
    }
  });

  it("shows the box alone until something is typed, and never queries for an empty one", async () => {
    // V1: `string.IsNullOrWhiteSpace(query.Value) ? [] : database.SearchPlans(...)`.
    const search = vi.fn(async () => [planSummary()]);
    open(search);

    expect(screen.getByTestId("plan-search-input")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-search-empty")).not.toBeInTheDocument();

    type("   ");
    await waitFor(() =>
      expect(screen.queryByTestId("plan-search-pending")).not.toBeInTheDocument(),
    );
    expect(search).not.toHaveBeenCalled();
  });

  it("reports a query with nothing behind it in V1's words", async () => {
    open(async () => []);
    type("nothing matches this");

    expect(await screen.findByTestId("plan-search-empty")).toHaveTextContent("No plans found.");
  });

  it("withholds the no-results line until the query has answered", async () => {
    let release: ((plans: PlanSummary[]) => void) | undefined;
    open(() => new Promise((resolve) => (release = resolve)));
    type("slow");

    // V2 only: the query is IPC here, so "No plans found." before it lands would be a lie.
    await waitFor(() => expect(release).toBeDefined());
    expect(screen.getByTestId("plan-search-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-search-empty")).not.toBeInTheDocument();

    release!([]);
    expect(await screen.findByTestId("plan-search-empty")).toBeInTheDocument();
  });

  it("keeps V1's fifteen-row ceiling", async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      planSummary({
        id: String(100 + i).padStart(5, "0"),
        title: `Plan number ${i}`,
        state: "Completed",
      }),
    );
    open(async () => many);
    type("plan");

    await screen.findByText("Plan number 0");
    expect(screen.getAllByRole("button", { name: /Plan number/ })).toHaveLength(
      MAX_PLAN_SEARCH_RESULTS,
    );
  });

  it("closes before it navigates, and hands the caller the plan id", async () => {
    const order: string[] = [];
    const onSelectPlan = vi.fn(() => order.push("navigate"));
    const onClose = vi.fn(() => order.push("close"));
    render(
      <PlanSearchDialog
        isOpen
        onClose={onClose}
        onSelectPlan={onSelectPlan}
        search={async () => [
          planSummary({ id: "00092", title: "Completed work", state: "Completed" }),
        ]}
      />,
    );
    type("completed");

    fireEvent.click(await screen.findByRole("button", { name: /Completed work/ }));

    // V1: `dialogOpen.Set(false)` then the navigation.
    expect(order).toEqual(["close", "navigate"]);
    expect(onSelectPlan).toHaveBeenCalledWith("00092");
  });

  it("drops a slow early keystroke's answer in favour of the later query", async () => {
    const pending: ((plans: PlanSummary[]) => void)[] = [];
    open((q) => new Promise((resolve) => pending.push((plans) => resolve(plans.filter(() => q)))));

    type("wor");
    await waitFor(() => expect(pending).toHaveLength(1));
    type("worktree");
    await waitFor(() => expect(pending).toHaveLength(2));

    pending[1]([planSummary({ id: "00092", title: "Worktree cleanup", state: "Completed" })]);
    expect(await screen.findByText("Worktree cleanup")).toBeInTheDocument();

    // The first request answers last; its result belongs to a query that is no longer in the box.
    pending[0]([planSummary({ id: "00001", title: "Stale answer", state: "Draft" })]);
    await waitFor(() => expect(screen.queryByText("Stale answer")).not.toBeInTheDocument());
    expect(screen.getByText("Worktree cleanup")).toBeInTheDocument();
  });

  it("reports a failed query rather than passing it off as no results", async () => {
    open(async () => {
      throw new Error("Database error: locked");
    });
    type("anything");

    expect(await screen.findByTestId("plan-search-error")).toHaveTextContent(
      "Database error: locked",
    );
    expect(screen.queryByTestId("plan-search-empty")).not.toBeInTheDocument();
  });

  it("starts empty when it is reopened", async () => {
    const search = vi.fn(async () => [planSummary({ id: "00092", title: "Old hit" })]);
    const Host = () => {
      const [isOpen, setIsOpen] = React.useState(true);
      return (
        <>
          <button onClick={() => setIsOpen(true)}>reopen</button>
          <PlanSearchDialog
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            onSelectPlan={() => {}}
            search={search}
          />
        </>
      );
    };
    render(<Host />);
    type("old");
    expect(await screen.findByText("Old hit")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId("plan-search-dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("plan-search-dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByText("reopen"));
    // V1 constructs the dialog with a fresh `UseState("")`, so a reopen shows neither the old query
    // nor its rows.
    expect(await screen.findByTestId("plan-search-input")).toHaveValue("");
    expect(screen.queryByText("Old hit")).not.toBeInTheDocument();
  });
});

/**
 * V1 `PlanSearchDialog.BuildRowBadges`: a result carries the badges its owning sidebar list would
 * give it, and a status no list owns falls back to a status badge - which is the only place those
 * plans are ever drawn.
 */
describe("planSearchRowBadges", () => {
  it("gives a draft the Plans list's badges", () => {
    // `PlansApp.BuildRowBadges`: no state badge on a Draft, then the projects, then the level.
    expect(planSearchRowBadges(planSummary({ state: "Draft", level: "Feature" }))).toEqual([
      { label: "Tendril-App", kind: "project" },
      { label: "Feature", kind: "neutral" },
    ]);
  });

  it("gives a review plan the Review list's verification badge", () => {
    // `ReviewApp.BuildRowBadges`: the fixture has a failing gate, so Unverified.
    expect(planSearchRowBadges(planSummary({ state: "Review" }))).toEqual([
      { label: "Tendril-App", kind: "project" },
      { label: "Unverified", kind: "warning" },
    ]);
  });

  it("marks a failed plan as failed as well as unverified", () => {
    expect(planSearchRowBadges(planSummary({ state: "Failed" }))).toEqual([
      { label: "Tendril-App", kind: "project" },
      { label: "Unverified", kind: "warning" },
      { label: "Failed", kind: "warning" },
    ]);
  });

  it("marks Completed as a success, as V1 does", () => {
    expect(planSearchRowBadges(planSummary({ state: "Completed" }))).toEqual([
      { label: "Tendril-App", kind: "project" },
      { label: "Completed", kind: "success" },
    ]);
  });

  it("gives every state no list owns a plain status badge", () => {
    for (const state of ["Skipped", "Icebox", "Creating", "Updating", "Executing"] as const) {
      expect(planSearchRowBadges(planSummary({ state }))).toEqual([
        { label: "Tendril-App", kind: "project" },
        { label: state, kind: "neutral" },
      ]);
    }
  });

  it("splits a multi-project plan the way every other row builder does", () => {
    expect(
      planSearchRowBadges(planSummary({ state: "Completed", project: "Ivy, Tendril" })),
    ).toEqual([
      { label: "Ivy", kind: "project" },
      { label: "Tendril", kind: "project" },
      { label: "Completed", kind: "success" },
    ]);
  });
});
