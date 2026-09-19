import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PlansView, normalizePlanState } from "../src/views/PlansView";
import { sidebarListStore } from "../src/state/sidebarListStore";
import { planSummary } from "./fixtures/plan.fixture";
import { job } from "./fixtures/job.fixture";
import type { PlanSummary } from "../src/types/api";

/**
 * Behavioural parity for the Plans page: the legacy state names V1 renamed, and the list it
 * publishes into the shell sidebar instead of drawing itself (`PlansApp.BuildSidebarList`).
 */
describe("normalizePlanState", () => {
  // V1's `PlanMigration_001_RenameLegacyStateNames`: Building -> Creating, ReadyForReview -> Review.
  it("maps the two renamed V1 states onto their current names", () => {
    expect(normalizePlanState("Building")).toBe("Creating");
    expect(normalizePlanState("ReadyForReview")).toBe("Review");
  });

  it("passes a current or unknown state through unchanged", () => {
    expect(normalizePlanState("Review")).toBe("Review");
    expect(normalizePlanState("SomethingNew")).toBe("SomethingNew");
    expect(normalizePlanState(undefined)).toBe("");
  });
});

describe("PlansView sidebar list", () => {
  const drafts: PlanSummary[] = [
    planSummary({ id: "00003", title: "Third", state: "Draft" }),
    planSummary({ id: "00001", title: "First", state: "Draft" }),
    planSummary({ id: "00002", title: "Second", state: "Draft" }),
  ];

  beforeEach(() => {
    sidebarListStore.resetForTesting();
  });

  it("publishes the Draft and Blocked plans as the shell's `plans` list, newest first", () => {
    render(
      <PlansView
        plans={[
          ...drafts,
          planSummary({ id: "00009", title: "Blocked one", state: "Blocked" }),
          // Neither of these is on this page in V1: the list is Draft or Blocked only.
          planSummary({ id: "00010", title: "In review", state: "Review" }),
          planSummary({ id: "00011", title: "Done", state: "Completed" }),
        ]}
        onSelectPlan={() => {}}
      />,
    );

    const list = sidebarListStore.getState();
    expect(list?.appId).toBe("plans");
    expect(list?.title).toBe("Plans");
    expect(list?.items.map((i) => i.id)).toEqual(["00009", "00003", "00002", "00001"]);
    expect(list?.items.map((i) => i.tag)).toEqual(["#9", "#3", "#2", "#1"]);
    // `PlansApp` sets neither `OnSearch` nor `OnNew`: the shell's search icon opens the plan search
    // dialog, and New Plan is the shell's own button.
    expect(list?.onSearch).toBeUndefined();
    expect(list?.onNew).toBeUndefined();
    expect(list?.collapsedMenu).toBeFalsy();
  });

  it("drops a plan a job still holds, as `activePlanFolders` does", () => {
    render(
      <PlansView
        plans={drafts}
        jobs={[
          job({ id: "j1", planId: "00002", status: "Queued" }),
          // A finished job releases the plan again.
          job({ id: "j2", planId: "00001", status: "Completed" }),
        ]}
        onSelectPlan={() => {}}
      />,
    );

    expect(sidebarListStore.getState()?.items.map((i) => i.id)).toEqual(["00003", "00001"]);
  });

  it("badges a row as `BuildRowBadges` does, under the state's current name", () => {
    const legacy = {
      ...planSummary({ id: "00031", title: "Legacy plan", level: "Bugfix" }),
      state: "Blocked",
    } as unknown as PlanSummary;

    render(
      <PlansView
        plans={[legacy, planSummary({ id: "00032", title: "A draft", state: "Draft" })]}
        onSelectPlan={() => {}}
      />,
    );

    const items = sidebarListStore.getState()?.items ?? [];
    // Newest first, so the draft leads and the blocked plan follows.
    expect(items.map((i) => i.id)).toEqual(["00032", "00031"]);
    expect(items[1].badges).toEqual([
      { label: "Blocked", kind: "warning" },
      { label: "Tendril-App", kind: "project" },
      { label: "Bugfix", kind: "neutral" },
    ]);
    // Draft carries no state badge: it is where every plan starts.
    expect(items[0].badges?.map((b) => b.label)).toEqual(["Tendril-App", "Feature"]);
  });

  it("renders no list of its own: the content area is the selection", () => {
    render(<PlansView plans={drafts} onSelectPlan={() => {}} />);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Third")).not.toBeInTheDocument();
    expect(screen.getByTestId("plans-no-selection")).toHaveTextContent(
      "Select a plan from the sidebar",
    );
  });

  it("shows V1's empty state when there is nothing to list", () => {
    render(<PlansView plans={[]} onSelectPlan={() => {}} />);

    expect(screen.getByText("No plans")).toBeInTheDocument();
    expect(screen.getByText("Plans you create will appear here")).toBeInTheDocument();
  });

  it("opens the plan a sidebar row selects, and marks that row selected", () => {
    const onSelectPlan = vi.fn();
    render(<PlansView plans={drafts} onSelectPlan={onSelectPlan} />);

    // What the shell does with a click: `BuildSelectArgs(id)` then navigate to `appId`.
    let args: unknown;
    act(() => {
      args = sidebarListStore.getState()?.buildSelectArgs("00002");
    });

    expect(args).toEqual({ planId: "00002" });
    expect(onSelectPlan).toHaveBeenCalledWith("00002");
    expect(sidebarListStore.getState()?.selectedId).toBe("00002");
  });

  it("lets the host drive the selected row", () => {
    render(<PlansView plans={drafts} selectedPlanId="00001" onSelectPlan={() => {}} />);

    expect(sidebarListStore.getState()?.selectedId).toBe("00001");
  });
});
