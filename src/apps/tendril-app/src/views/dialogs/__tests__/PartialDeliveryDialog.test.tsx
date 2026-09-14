import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PartialDeliveryDialog } from "../PartialDeliveryDialog";
import { PlanActionsController } from "../../../controllers/plan_actions";
import { bridge } from "../../../api/bridge";
import { planSummary, verification } from "../../../../tests/fixtures/plan.fixture";

const plan = planSummary({
  id: "00021",
  state: "Review",
  verifications: [
    verification("NpmLint", "Pass"),
    verification("RustTest", "Fail"),
    verification("Screenshots", "Pending"),
    verification("CheckResult", "Fail"),
  ],
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PartialDeliveryDialog", () => {
  it("names the failing verifications, and only those", () => {
    render(<PartialDeliveryDialog isOpen onClose={vi.fn()} plan={plan} />);

    const list = screen.getByTestId("failing-verifications");
    expect(list).toHaveTextContent("RustTest");
    expect(list).toHaveTextContent("CheckResult");
    expect(list).not.toHaveTextContent("NpmLint");
    expect(list).not.toHaveTextContent("Screenshots");
  });

  it("completes with the allowFailedVerifications flag set", async () => {
    const updateField = vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);
    const onCompleted = vi.fn();

    render(
      <PartialDeliveryDialog isOpen onClose={vi.fn()} plan={plan} onCompleted={onCompleted} />,
    );

    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(updateField).toHaveBeenCalledWith("00021", "state", "Completed", true),
    );
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith("00021"));
  });

  it("sends nothing until confirmed", () => {
    const updateField = vi.spyOn(bridge, "updatePlanField").mockResolvedValue(undefined);

    render(<PartialDeliveryDialog isOpen onClose={vi.fn()} plan={plan} />);

    expect(updateField).not.toHaveBeenCalled();
  });

  it("is only offered when a verification actually failed", () => {
    expect(PlanActionsController.canCompletePartial(plan).allowed).toBe(true);
    expect(
      PlanActionsController.canCompletePartial(
        planSummary({ state: "Review", verifications: [verification("NpmLint", "Pass")] }),
      ).allowed,
    ).toBe(false);
    expect(
      PlanActionsController.canCompletePartial(planSummary({ ...plan, state: "Draft" })).allowed,
    ).toBe(false);
  });
});
