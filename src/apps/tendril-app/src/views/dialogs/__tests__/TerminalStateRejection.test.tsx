import { describe, it, expect, vi, afterEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DeletePlanDialog } from "../DeletePlanDialog";
import { PartialDeliveryDialog } from "../PartialDeliveryDialog";
import { ResetToDraftDialog } from "../ResetToDraftDialog";
import { bridge } from "../../../api/bridge";
import type { PlanLifecycleState, PlanSummary } from "../../../types/api";
import { planSummary, verification } from "../../../../tests/fixtures/plan.fixture";

/**
 * The crux of the port: a backend rejection must be surfaced, not painted over.
 *
 * These dialogs deliberately avoid `plansStore.updateFieldOptimistic`, which
 * mutates first and rolls back on rejection. For a destructive transition a
 * flicker to the new state and back is a lie the operator may act on — so the
 * harness records **every** state the plan is rendered with and asserts the
 * requested one never appears among them.
 */
function StateHarness({
  plan,
  seen,
  children,
}: {
  plan: PlanSummary;
  seen: PlanLifecycleState[];
  children: (plan: PlanSummary, apply: (next: PlanLifecycleState) => void) => React.ReactNode;
}) {
  const [state, setState] = React.useState<PlanLifecycleState>(plan.state);
  seen.push(state);
  return (
    <>
      <span data-testid="plan-state">{state}</span>
      {children({ ...plan, state }, setState)}
    </>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("terminal-state rejections are surfaced, never optimistically applied", () => {
  it("keeps a Completed plan Completed when reset is refused with a 409", async () => {
    vi.spyOn(bridge, "resetPlan").mockRejectedValue({
      code: "Conflict",
      message: "Plan 00021 is Completed and cannot be reset",
    });
    const seen: PlanLifecycleState[] = [];
    const onClose = vi.fn();

    render(
      <StateHarness plan={planSummary({ id: "00021", state: "Completed" })} seen={seen}>
        {(plan, apply) => (
          <ResetToDraftDialog isOpen onClose={onClose} plan={plan} onReset={() => apply("Draft")} />
        )}
      </StateHarness>,
    );

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Plan 00021 is Completed and cannot be reset",
      ),
    );

    expect(screen.getByTestId("plan-state")).toHaveTextContent("Completed");
    expect(seen).not.toContain("Draft");
    // The dialog stays open, so the message is where the operator pressed.
    expect(screen.getByTestId("reset-to-draft-dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  /**
   * "Move to Skipped" is the surviving path to `Skipped` now that Discard is gone, and it is the one
   * answer in the delete dialog that writes a *state* rather than removing the folder — so it is the
   * one that can come back with a terminal-state 409.
   */
  it("keeps a Completed plan Completed when Move to Skipped is refused", async () => {
    vi.spyOn(bridge, "updatePlanField").mockRejectedValue({
      code: "Conflict",
      message: "Plan 00021 is already Completed",
    });
    const seen: PlanLifecycleState[] = [];

    render(
      <StateHarness plan={planSummary({ id: "00021", state: "Completed" })} seen={seen}>
        {(plan, apply) => (
          <DeletePlanDialog
            isOpen
            onClose={vi.fn()}
            plan={plan}
            onSkipped={() => apply("Skipped")}
          />
        )}
      </StateHarness>,
    );

    fireEvent.click(screen.getByTestId("dialog-skip"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Plan 00021 is already Completed"),
    );
    expect(screen.getByTestId("plan-state")).toHaveTextContent("Completed");
    expect(seen).not.toContain("Skipped");
  });

  it("keeps the plan in Review when completion is refused for failing verifications", async () => {
    vi.spyOn(bridge, "updatePlanField").mockRejectedValue({
      code: "Conflict",
      message: "Cannot complete plan with failed verifications",
      details: "RustTest",
    });
    const seen: PlanLifecycleState[] = [];

    render(
      <StateHarness
        plan={planSummary({
          id: "00021",
          state: "Review",
          verifications: [verification("RustTest", "Fail")],
        })}
        seen={seen}
      >
        {(plan, apply) => (
          <PartialDeliveryDialog
            isOpen
            onClose={vi.fn()}
            plan={plan}
            onCompleted={() => apply("Completed")}
          />
        )}
      </StateHarness>,
    );

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Cannot complete plan with failed verifications (RustTest)",
      ),
    );
    expect(screen.getByTestId("plan-state")).toHaveTextContent("Review");
    expect(seen).not.toContain("Completed");
  });

  it("re-enables the confirm after a rejection so the operator can retry", async () => {
    vi.spyOn(bridge, "resetPlan").mockRejectedValue({
      code: "Conflict",
      message: "Plan 00021 is Completed and cannot be reset",
    });

    render(
      <ResetToDraftDialog
        isOpen
        onClose={vi.fn()}
        plan={planSummary({ id: "00021", state: "Completed" })}
      />,
    );

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByTestId("dialog-confirm")).toBeEnabled();
    expect(screen.getByTestId("dialog-cancel")).toBeEnabled();
  });
});
