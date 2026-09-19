import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { PlanVerifications, orderByProjectConfig } from "../src/views/PlanVerifications";
import { bridge } from "../src/api/bridge";
import { plansStore } from "../src/state/plansStore";
import { planDetail, planSummary, verification } from "./fixtures/plan.fixture";
import type { ProjectSummary } from "../src/types/api";

/**
 * V1's `VerificationsPanelView` presents "always in project-config order, regardless of plan.yaml
 * storage order", via `PlanCommandHelpers.OrderByProjectConfig`. Every HTTP read point on the V2
 * service returns plan.yaml order, so the reordering lives here.
 */
describe("orderByProjectConfig", () => {
  const rows = [
    verification("RustTest", "Pass"),
    verification("RustClippy", "Pass"),
    verification("CheckResult", "Pending"),
  ];

  it("presents the project's run order regardless of plan.yaml order", () => {
    const ordered = orderByProjectConfig(rows, ["RustClippy", "CheckResult", "RustTest"]);
    expect(ordered.map((v) => v.name)).toEqual(["RustClippy", "CheckResult", "RustTest"]);
  });

  it("sorts names the project does not know to the end, keeping their relative order", () => {
    const ordered = orderByProjectConfig(
      [verification("Custom-B", "Pending"), ...rows, verification("Custom-A", "Pending")],
      ["RustClippy", "RustTest"],
    );
    expect(ordered.map((v) => v.name)).toEqual([
      "RustClippy",
      "RustTest",
      "Custom-B",
      "CheckResult",
      "Custom-A",
    ]);
  });

  it("matches names case-insensitively, as V1's OrdinalIgnoreCase map does", () => {
    const ordered = orderByProjectConfig(rows, ["rustclippy", "checkresult", "rusttest"]);
    expect(ordered.map((v) => v.name)).toEqual(["RustClippy", "CheckResult", "RustTest"]);
  });

  it("keeps plan.yaml order when the project cannot be resolved", () => {
    expect(orderByProjectConfig(rows, undefined).map((v) => v.name)).toEqual([
      "RustTest",
      "RustClippy",
      "CheckResult",
    ]);
    expect(orderByProjectConfig(rows, []).map((v) => v.name)).toEqual([
      "RustTest",
      "RustClippy",
      "CheckResult",
    ]);
  });
});

describe("PlanVerifications ordering and writes", () => {
  const project: ProjectSummary = {
    name: "Tendril-App",
    repos: ["/repos/Tendril-App"],
    verifications: ["CheckResult", "RustClippy", "RustTest"],
  };

  beforeEach(() => {
    vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([]);
    vi.spyOn(bridge, "listProjects").mockResolvedValue([project]);
    plansStore.setPlans([]);
    plansStore.setSelectedPlan(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    plansStore.setPlans([]);
    plansStore.setSelectedPlan(null);
  });

  it("renders the rows in the project's run order", async () => {
    render(
      <PlanVerifications
        planId="00021"
        project="Tendril-App"
        planState="Draft"
        verifications={[
          verification("RustTest", "Pass"),
          verification("RustClippy", "Pass"),
          verification("CheckResult", "Pending"),
        ]}
      />,
    );

    await waitFor(() => expect(bridge.listProjects).toHaveBeenCalled());
    await waitFor(() => {
      const names = screen
        .getAllByRole("checkbox")
        .map((box) => box.getAttribute("data-testid")?.replace("verification-checkbox-", ""));
      expect(names).toEqual(["CheckResult", "RustClippy", "RustTest"]);
    });
  });

  it("keeps plan.yaml order when the plan names no project", async () => {
    render(
      <PlanVerifications
        planId="00021"
        planState="Draft"
        verifications={[verification("RustTest", "Pass"), verification("CheckResult", "Pending")]}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("plan-verifications")).toBeInTheDocument());
    expect(bridge.listProjects).not.toHaveBeenCalled();
    const names = screen
      .getAllByRole("checkbox")
      .map((box) => box.getAttribute("data-testid")?.replace("verification-checkbox-", ""));
    expect(names).toEqual(["RustTest", "CheckResult"]);
  });

  /**
   * `plansStore.updateVerificationOptimistic` existed but nothing outside a test ever called it, so a
   * toggle here never reached the plan the rest of the app renders — and the Create PR / Accept
   * Partial Delivery gates, which read those statuses, kept answering from before the toggle.
   */
  it("writes the new status into the store, not only to the bridge", async () => {
    const setVerificationStatus = vi
      .spyOn(bridge, "setVerificationStatus")
      .mockResolvedValue(undefined);
    plansStore.setPlans([
      planSummary({ id: "00021", verifications: [verification("RustTest", "Pending")] }),
    ]);
    plansStore.setSelectedPlan(
      planDetail({ id: "00021", verifications: [verification("RustTest", "Pending")] }),
    );

    render(
      <PlanVerifications
        planId="00021"
        planState="Draft"
        verifications={[verification("RustTest", "Pending")]}
      />,
    );

    fireEvent.click(screen.getByTestId("verification-checkbox-RustTest"));

    await waitFor(() =>
      expect(setVerificationStatus).toHaveBeenCalledWith("00021", "RustTest", "Skipped"),
    );
    expect(plansStore.getState().selectedPlan?.verifications).toEqual([
      { name: "RustTest", status: "Skipped" },
    ]);
    expect(plansStore.getState().plans[0].verifications).toEqual([
      { name: "RustTest", status: "Skipped" },
    ]);
  });

  it("rolls the store back with the row when the write is refused", async () => {
    vi.spyOn(bridge, "setVerificationStatus").mockRejectedValue(new Error("service unreachable"));
    plansStore.setSelectedPlan(
      planDetail({ id: "00021", verifications: [verification("RustTest", "Pending")] }),
    );

    render(
      <PlanVerifications
        planId="00021"
        planState="Draft"
        verifications={[verification("RustTest", "Pending")]}
      />,
    );

    fireEvent.click(screen.getByTestId("verification-checkbox-RustTest"));

    await waitFor(() =>
      expect(screen.getByTestId("verification-reports-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("verification-checkbox-RustTest")).toBeChecked();
    expect(plansStore.getState().selectedPlan?.verifications).toEqual([
      { name: "RustTest", status: "Pending" },
    ]);
  });

  /**
   * A verification run writes its report without changing how many verifications there are, so keying
   * the read on the count alone left "No report yet" on a row whose report had just landed.
   */
  it("re-reads the reports when a verification's status moves", async () => {
    const listReports = vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([]);
    const { rerender } = render(
      <PlanVerifications planId="00021" verifications={[verification("RustTest", "Pending")]} />,
    );

    await waitFor(() => expect(listReports).toHaveBeenCalledTimes(1));

    rerender(
      <PlanVerifications planId="00021" verifications={[verification("RustTest", "Fail")]} />,
    );

    await waitFor(() => expect(listReports).toHaveBeenCalledTimes(2));
  });
});
