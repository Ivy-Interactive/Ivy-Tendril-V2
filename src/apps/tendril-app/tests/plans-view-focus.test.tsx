import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlansView } from "../src/views/PlansView";
import { planSummary } from "./fixtures/plan.fixture";
import type { PlanSummary } from "../src/types/api";

describe("PlansView focus-visible styling", () => {
  const mockPlans: PlanSummary[] = [
    planSummary({ id: "00010", title: "First Plan", state: "Draft" }),
    planSummary({ id: "00011", title: "Second Plan", state: "Draft" }),
  ];

  it("gives every plan card a focus-visible ring distinct from ring-2 for the selected state", () => {
    render(<PlansView plans={mockPlans} onSelectPlan={() => {}} onNewPlan={() => {}} />);

    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.className).toContain("focus-visible:ring-2");
    }
  });

  it("keeps the highlighted card's selected ring alongside the new focus-visible ring", () => {
    render(<PlansView plans={mockPlans} onSelectPlan={() => {}} onNewPlan={() => {}} />);

    const cards = screen.getAllByRole("listitem");
    const highlighted = cards[0];
    expect(highlighted.className).toContain("ring-1");
    expect(highlighted.className).toContain("ring-emerald-500");
    expect(highlighted.className).toContain("focus-visible:ring-2");
  });
});
