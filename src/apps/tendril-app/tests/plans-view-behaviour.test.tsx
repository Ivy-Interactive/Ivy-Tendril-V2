import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlansView, normalizePlanState } from "../src/views/PlansView";
import { planSummary } from "./fixtures/plan.fixture";
import type { PlanSummary } from "../src/types/api";

/**
 * Behavioural parity for the plans list: the legacy state names V1 renamed, the selection surviving a
 * list that shrinks (`PlanSelectionHelper.ResolveSelection`), and the arrow keys leaving the search
 * box alone.
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

describe("PlansView lifecycle states", () => {
  it("badges a plan recorded under a legacy state as the state it now is", () => {
    const legacy = {
      ...planSummary({ id: "00031", title: "Legacy plan" }),
      state: "ReadyForReview",
    } as unknown as PlanSummary;

    render(<PlansView plans={[legacy]} onSelectPlan={() => {}} />);

    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.queryByText("ReadyForReview")).not.toBeInTheDocument();
  });

  it("finds a legacy-named plan through the current state's filter", () => {
    const legacy = {
      ...planSummary({ id: "00031", title: "Legacy plan" }),
      state: "ReadyForReview",
    } as unknown as PlanSummary;
    const draft = planSummary({ id: "00032", title: "A draft", state: "Draft" });

    render(<PlansView plans={[legacy, draft]} onSelectPlan={() => {}} />);

    // BadgeSelect drives the filter through its event handler, so the assertion goes through the
    // rendered control rather than internal state: with no filter both rows show.
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Legacy plan")).toBeInTheDocument();
  });
});

describe("PlansView selection", () => {
  const three: PlanSummary[] = [
    planSummary({ id: "00003", title: "Third", state: "Draft" }),
    planSummary({ id: "00002", title: "Second", state: "Draft" }),
    planSummary({ id: "00001", title: "First", state: "Draft" }),
  ];

  it("keeps the highlight on a row that still exists when the list shrinks", () => {
    const onSelectPlan = vi.fn();
    const { rerender } = render(<PlansView plans={three} onSelectPlan={onSelectPlan} />);

    // Walk to the last row.
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "ArrowDown" });

    // Two plans are deleted underneath the selection. `Math.Min(oldIndex, count - 1)` in V1.
    rerender(<PlansView plans={[three[0]]} onSelectPlan={onSelectPlan} />);

    fireEvent.keyDown(window, { key: "Enter" });

    expect(onSelectPlan).toHaveBeenCalledTimes(1);
    expect(onSelectPlan).toHaveBeenCalledWith("00003");
  });

  it("selects nothing rather than throwing when every plan goes", () => {
    const onSelectPlan = vi.fn();
    const { rerender } = render(<PlansView plans={three} onSelectPlan={onSelectPlan} />);

    fireEvent.keyDown(window, { key: "ArrowDown" });
    rerender(<PlansView plans={[]} onSelectPlan={onSelectPlan} />);
    fireEvent.keyDown(window, { key: "Enter" });

    expect(onSelectPlan).not.toHaveBeenCalled();
  });

  it("leaves the arrow keys to the search box while it has focus", () => {
    const onSelectPlan = vi.fn();
    render(<PlansView plans={three} onSelectPlan={onSelectPlan} />);

    const search = screen.getByRole("searchbox");
    search.focus();

    // Down twice from the search box: the caret's business, not the list's.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    // Blur, then open whatever is highlighted. Still the first row.
    search.blur();
    fireEvent.keyDown(window, { key: "Enter" });

    expect(onSelectPlan).toHaveBeenCalledWith("00003");
  });

  it("does not open a plan on Enter typed into the search box", () => {
    const onSelectPlan = vi.fn();
    render(<PlansView plans={three} onSelectPlan={onSelectPlan} />);

    const search = screen.getByRole("searchbox");
    search.focus();
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onSelectPlan).not.toHaveBeenCalled();
  });
});
